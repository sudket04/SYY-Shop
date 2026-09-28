// P0 Receive Goods v2 — atomic + idempotent across client retries.
function p0ReceiveGoodsV2(token, userAgent, d) {
  var auth = p0Session_(token, userAgent, 'staff');
  if (!auth.ok) return { success:false, message:auth.message };
  return p0ReceiveGoodsIdempotent_(d || {}, auth.session.username);
}

function p0SafeClientRequestId_(v) {
  return String(v || '').replace(/[^A-Za-z0-9_-]/g,'').slice(0,64);
}

function p0HashText_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text || ''));
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,'').slice(0,24);
}

function p0ReceiveRequestId_(d) {
  var provided = p0SafeClientRequestId_(d && d.clientRequestId);
  if (provided) return provided;
  var items = (Array.isArray(d && d.items) ? d.items : []).map(function(it){
    return { productCode:String((it && it.productCode) || ''), qty:parseFloat((it && it.qtyReceivedNow) || 0) || 0 };
  }).sort(function(a,b){ return a.productCode.localeCompare(b.productCode); });
  return 'AUTO_' + p0HashText_([
    String((d && d.poId) || ''),
    String((d && d.invoiceNo) || '').trim().toUpperCase(),
    String((d && d.receiptDate) || ''),
    String((d && d.deliveryNoteNo) || '').trim().toUpperCase(),
    JSON.stringify(items)
  ].join('|'));
}

function p0ReceiveGoodsIdempotent_(d, callerUsername) {
  function fail(msg,title){return {success:false,title:title||'ข้อมูลไม่ครบ',message:msg};}
  if (!d.poId) return fail('ไม่พบเลขที่ใบสั่งซื้อ');
  if (!String(d.invoiceNo||'').trim()) return fail('กรุณากรอกเลขที่ Invoice');
  if (!String(d.receiptDate||'').trim()) return fail('กรุณาระบุวันที่รับสินค้า');
  if (!String(d.receiverName||'').trim()) return fail('กรุณากรอกชื่อผู้รับสินค้า');

  var requestId = p0ReceiveRequestId_(d);
  var receiptTxnId = 'RCV-' + String(d.poId) + '-' + requestId;
  var reqItems = Array.isArray(d.items) ? d.items : [];
  if (!reqItems.length) return fail('ไม่มีรายการสินค้าที่จะรับ');

  var receiveMap={};
  reqItems.forEach(function(it){
    if(!it||!it.productCode)return;
    var q=parseFloat(it.qtyReceivedNow||0);
    if(isFinite(q)&&q>0)receiveMap[String(it.productCode)]=q;
  });
  if(!Object.keys(receiveMap).length)return fail('กรุณาระบุจำนวนที่รับอย่างน้อย 1 รายการ');

  for(var attempt=1;attempt<=3;attempt++){
    var poDoc=p0GetPoDoc_(d.poId);
    if(!poDoc)return fail('ไม่พบใบสั่งซื้อนี้');
    var f=poDoc.fields||{}, currentStatus=parseFirestoreValue(f.Status)||'Pending';
    var poItems=[]; try{poItems=JSON.parse(parseFirestoreValue(f.Items_JSON)||'[]');}catch(ignore){poItems=[];}
    var receipts=[]; try{receipts=JSON.parse(parseFirestoreValue(f.Receipts_JSON)||'[]');}catch(ignore2){receipts=[];}

    var prior=receipts.filter(function(r){return r && (r.clientRequestId===requestId || r.txnId===receiptTxnId);})[0];
    if(prior){
      return {success:true,title:'สำเร็จ',message:'รายการรับสินค้านี้ถูกบันทึกแล้ว',status:currentStatus,receiptTxnId:receiptTxnId,idempotent:true,purchaseOrder:{poId:String(d.poId),status:currentStatus,items:poItems,receipts:receipts},stockChanges:[]};
    }
    if(currentStatus==='Received')return fail('ใบสั่งซื้อนี้ได้รับสินค้าครบแล้ว ไม่สามารถบันทึกรับซ้ำได้');
    if(currentStatus==='Cancelled')return fail('ใบสั่งซื้อนี้ถูกยกเลิกแล้ว ไม่สามารถรับสินค้าได้');

    var allComplete=true, lines=[];
    poItems=poItems.map(function(it){
      var ordered=parseFloat(it.qty||0), already=parseFloat(it.receivedQty||0), remaining=Math.max(ordered-already,0);
      var requested=receiveMap.hasOwnProperty(it.productCode)?receiveMap[it.productCode]:0;
      var receiveNow=Math.max(0,Math.min(requested,remaining)), newReceived=already+receiveNow;
      if(newReceived<ordered)allComplete=false;
      if(receiveNow>0)lines.push({productCode:String(it.productCode),productName:String(it.productName||''),qty:receiveNow,costPrice:parseFloat(it.costPrice||0)});
      it.receivedQty=newReceived; return it;
    });
    if(!lines.length)return fail('ไม่มีจำนวนคงเหลือที่สามารถรับเพิ่มได้');
    if(!allComplete&&!String(d.deliveryNoteNo||'').trim())return fail('กรุณากรอกเลขที่ใบส่งของชั่วคราว เนื่องจากได้รับสินค้าไม่ครบตามจำนวนที่สั่งซื้อ');

    var stockMap=getProductStockMap_(lines.map(function(x){return x.productCode;}));
    var missing=lines.filter(function(x){return !stockMap[x.productCode];}).map(function(x){return x.productCode;});
    if(missing.length)return fail('ไม่พบสินค้า: '+missing.join(', '),'ไม่พบข้อมูล');

    var nowIso=new Date().toISOString(), user=callerUsername||getCurrentUsername_(), writes=[];
    lines.forEach(function(line,i){
      var info=stockMap[line.productCode];
      writes.push({transform:{document:fsDocPath_('Master_Products',line.productCode),fieldTransforms:[{fieldPath:'Current_Stock',increment:{doubleValue:line.qty}}]},currentDocument:{updateTime:info.updateTime}});
      writes.push({update:{name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,receiptTxnId+'-'+String(i+1).padStart(2,'0')),fields:mapToFirestoreFields({Doc_No:receiptTxnId,Type:'IN',Product_Code:line.productCode,Product_Name:line.productName||info.name,Qty:line.qty,Stock_Before:info.stock,Stock_After:info.stock+line.qty,Unit_Price:line.costPrice,Cost_Price:line.costPrice,Reason:'รับของตาม PO',Ref_No:String(d.poId),Invoice_No:String(d.invoiceNo||''),User:user,Timestamp:nowIso})},currentDocument:{exists:false}});
    });

    var receiptLines=lines.map(function(x){return {productCode:x.productCode,productName:x.productName,qtyReceivedNow:x.qty};});
    receipts.push({txnId:receiptTxnId,clientRequestId:requestId,date:String(d.receiptDate),invoiceNo:String(d.invoiceNo),receiverName:String(d.receiverName),deliveryNoteNo:allComplete?'':String(d.deliveryNoteNo||''),isFinal:allComplete,items:receiptLines});
    var newStatus=allComplete?'Received':'PartiallyReceived';
    writes.push({update:{name:fsDocPath_('Purchase_Orders',String(d.poId)),fields:mapToFirestoreFields({Items_JSON:JSON.stringify(poItems),Receipts_JSON:JSON.stringify(receipts),Status:newStatus,Updated_At:nowIso})},updateMask:{fieldPaths:['Items_JSON','Receipts_JSON','Status','Updated_At']},currentDocument:{updateTime:poDoc.updateTime}});

    var commit=fsCommit_(writes);
    if(commit.ok)return {success:true,title:'สำเร็จ',status:newStatus,receiptTxnId:receiptTxnId,message:allComplete?'บันทึกรับสินค้าครบถ้วน และอัปเดตสต็อกเรียบร้อย':'บันทึกรับสินค้าบางส่วน และอัปเดตสต็อกเรียบร้อย',stockChanges:lines.map(function(line){var info=stockMap[line.productCode];return {productCode:line.productCode,before:info.stock,after:info.stock+line.qty,delta:line.qty};}),purchaseOrder:{poId:String(d.poId),status:newStatus,items:poItems,receipts:receipts}};
    if(!isPreconditionFailure_(commit.message))return {success:false,title:'ล้มเหลว',message:commit.message||'บันทึกรับสินค้าไม่สำเร็จ'};
  }
  return {success:false,title:'ข้อมูลถูกเปลี่ยนระหว่างทำรายการ',message:'มีผู้ใช้อื่นแก้ไขสต๊อกหรือใบสั่งซื้อพร้อมกัน กรุณาเปิดข้อมูลใหม่แล้วลองอีกครั้ง'};
}
