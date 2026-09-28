// ============================================================
// SYY Shop P0 Hardening Layer
// Intercepts only gaps not already covered by P0Core.gs.
// ============================================================

function p0GatewayV2(token, fnName, args, userAgent) {
  try {
    var session = getSession_(token, userAgent);
    if (!session) return { __authError:true, success:false, message:'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };
    var a = Array.isArray(args) ? args : [];
    var result;

    if (fnName === 'receiveGoods') {
      if (!p0RoleAllowed_(session.role,'staff')) return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
      result = p0ReceiveGoodsIdempotent_(a[0] || {}, session.username);
      if (ACTIVITY_ACTIONS && ACTIVITY_ACTIONS.receiveGoods) logActivity_(session.username,'receiveGoods',[a[0] || {},session.username],result);
      return result;
    }
    if (fnName === 'adjustProductStock') {
      if (!p0RoleAllowed_(session.role,'staff')) return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
      return p0AdjustProductStock_(a[0] || {}, session.username);
    }
    if (fnName === 'createUserAccount') {
      if (!p0RoleAllowed_(session.role,'admin')) return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
      return p0CreateUserAccount_(a[0],a[1],a[2]);
    }
    return p0Gateway(token,fnName,a,userAgent);
  } catch (e) {
    console.error('p0GatewayV2 ['+fnName+']:',e);
    return p0Fail_(friendlyErrorMessage_(e),'ข้อผิดพลาด');
  }
}

function p0StableReceiveId_(d) {
  var provided=String((d&&d.clientRequestId)||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,64);
  if(provided)return provided;
  var items=(Array.isArray(d&&d.items)?d.items:[]).map(function(it){return {c:String((it&&it.productCode)||''),q:parseFloat((it&&it.qtyReceivedNow)||0)||0};}).sort(function(a,b){return a.c.localeCompare(b.c);});
  var raw=[String((d&&d.poId)||''),String((d&&d.invoiceNo)||'').trim().toUpperCase(),String((d&&d.receiptDate)||''),String((d&&d.deliveryNoteNo)||'').trim().toUpperCase(),JSON.stringify(items)].join('|');
  var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw);
  return 'AUTO_'+Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,'').slice(0,24);
}

function p0ReceiveGoodsIdempotent_(d,callerUsername) {
  d=d||{};
  if(!d.poId)return p0Fail_('ไม่พบเลขที่ใบสั่งซื้อ','ข้อมูลไม่ครบ');
  if(!String(d.invoiceNo||'').trim())return p0Fail_('กรุณากรอกเลขที่ Invoice','ข้อมูลไม่ครบ');
  if(!String(d.receiptDate||'').trim())return p0Fail_('กรุณาระบุวันที่รับสินค้า','ข้อมูลไม่ครบ');
  if(!String(d.receiverName||'').trim())return p0Fail_('กรุณากรอกชื่อผู้รับสินค้า','ข้อมูลไม่ครบ');
  var req=Array.isArray(d.items)?d.items:[];if(!req.length)return p0Fail_('ไม่มีรายการสินค้าที่จะรับ','ข้อมูลไม่ครบ');
  var requestId=p0StableReceiveId_(d),txnId='RCV-'+String(d.poId)+'-'+requestId;

  for(var attempt=1;attempt<=3;attempt++){
    var po=p0GetDoc_('Purchase_Orders',d.poId);if(!po)return p0Fail_('ไม่พบใบสั่งซื้อนี้');
    var f=po.fields||{},status=parseFirestoreValue(f.Status)||'Pending',poItems=[],receipts=[];
    try{poItems=JSON.parse(parseFirestoreValue(f.Items_JSON)||'[]');}catch(e){}
    try{receipts=JSON.parse(parseFirestoreValue(f.Receipts_JSON)||'[]');}catch(e2){}
    var prior=receipts.filter(function(r){return r&&(r.clientRequestId===requestId||r.txnId===txnId);})[0];
    if(prior)return {success:true,title:'สำเร็จ',message:'รายการรับสินค้านี้ถูกบันทึกแล้ว',status:status,poId:d.poId,idempotent:true,receiptTxnId:txnId,stockChanges:[],purchaseOrder:{poId:d.poId,status:status,items:poItems,receipts:receipts}};
    if(status==='Received')return p0Fail_('ใบสั่งซื้อนี้ได้รับสินค้าครบแล้ว');
    if(status==='Cancelled')return p0Fail_('ใบสั่งซื้อนี้ถูกยกเลิกแล้ว');

    var receiveMap={};req.forEach(function(it){var c=String(it.productCode||''),q=Math.max(0,parseFloat(it.qtyReceivedNow||0));if(c)receiveMap[c]=(receiveMap[c]||0)+q;});
    var allComplete=true,lines=[];
    poItems=poItems.map(function(it){var ordered=parseFloat(it.qty||0),old=parseFloat(it.receivedQty||0),remaining=Math.max(ordered-old,0),now=Math.min(remaining,receiveMap[it.productCode]||0),next=old+now;if(next<ordered)allComplete=false;if(now>0)lines.push({productCode:it.productCode,productName:it.productName,qty:now,costPrice:parseFloat(it.costPrice||0)});it.receivedQty=next;return it;});
    if(!lines.length)return p0Fail_('กรุณาระบุจำนวนที่รับอย่างน้อย 1 รายการ','ข้อมูลไม่ครบ');
    if(!allComplete&&!String(d.deliveryNoteNo||'').trim())return p0Fail_('กรุณากรอกเลขที่ใบส่งของชั่วคราว เนื่องจากได้รับสินค้าไม่ครบ','ข้อมูลไม่ครบ');

    var stockMap=getProductStockMap_(lines.map(function(x){return x.productCode;})),missing=[];lines.forEach(function(x){if(!stockMap[x.productCode])missing.push(x.productCode);});if(missing.length)return p0Fail_('ไม่พบสินค้ารหัส: '+missing.join(', '));
    var vendorId=parseFirestoreValue(f.Vendor_ID)||'',vendor=p0VendorSnapshot_(vendorId),nowIso=new Date().toISOString(),writes=[];
    lines.forEach(function(x,i){var info=stockMap[x.productCode],after=info.stock+x.qty;
      writes.push({transform:{document:fsDocPath_('Master_Products',x.productCode),fieldTransforms:[{fieldPath:'Current_Stock',increment:{doubleValue:x.qty}}]},currentDocument:{updateTime:info.updateTime}});
      writes.push({update:{name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,txnId+'-'+String(i+1).padStart(2,'0')),fields:{Doc_No:{stringValue:txnId},Type:{stringValue:'IN'},Product_Code:{stringValue:x.productCode},Product_Name:{stringValue:String(x.productName||info.name)},Qty:{doubleValue:x.qty},Stock_Before:{doubleValue:info.stock},Stock_After:{doubleValue:after},Cost_Price:{doubleValue:parseFloat(x.costPrice||info.costPrice||0)},Reason:{stringValue:'รับของตาม PO'},Ref_No:{stringValue:String(d.poId)},Vendor_ID:{stringValue:vendor.id},Vendor_Name:{stringValue:vendor.name},Invoice_No:{stringValue:String(d.invoiceNo||'')},Receipt_Date:{stringValue:String(d.receiptDate||'')},User:{stringValue:callerUsername||getCurrentUsername_()},Timestamp:{stringValue:nowIso}}},currentDocument:{exists:false}});
    });
    var receiptItems=lines.map(function(x){return {productCode:x.productCode,productName:x.productName,qtyReceivedNow:x.qty};});
    receipts.push({txnId:txnId,clientRequestId:requestId,date:d.receiptDate,invoiceNo:String(d.invoiceNo||''),receiverName:String(d.receiverName||''),deliveryNoteNo:allComplete?'':String(d.deliveryNoteNo||''),isFinal:allComplete,items:receiptItems});
    var newStatus=allComplete?'Received':'PartiallyReceived';
    writes.push({update:{name:po.name,fields:{Items_JSON:{stringValue:JSON.stringify(poItems)},Receipts_JSON:{stringValue:JSON.stringify(receipts)},Status:{stringValue:newStatus},Updated_At:{stringValue:nowIso}}},updateMask:{fieldPaths:['Items_JSON','Receipts_JSON','Status','Updated_At']},currentDocument:{updateTime:po.updateTime}});
    var commit=fsCommit_(writes);
    if(commit.ok){p0InvalidateProducts_();p0InvalidateDashboard_();return {success:true,title:'สำเร็จ',message:allComplete?'บันทึกรับสินค้าครบถ้วน และอัปเดตสต็อกเรียบร้อย':'บันทึกรับสินค้าบางส่วน และอัปเดตสต็อกเรียบร้อย',status:newStatus,poId:d.poId,receiptTxnId:txnId,stockChanges:lines.map(function(x){var info=stockMap[x.productCode];return {productCode:x.productCode,before:info.stock,after:info.stock+x.qty,qty:x.qty};}),purchaseOrder:{poId:d.poId,status:newStatus,items:poItems,receipts:receipts}};}
    if(!isPreconditionFailure_(commit.message)||attempt===3)return p0Fail_('บันทึกรับสินค้าไม่สำเร็จ: '+commit.message,'ล้มเหลว');
    Utilities.sleep(120*attempt);
  }
  return p0Fail_('บันทึกรับสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง');
}

function p0AdjustProductStock_(d,callerUsername){
  d=d||{};var code=String(d.productCode||'').trim(),target=parseFloat(d.newStock),reason=String(d.reason||'').trim(),note=String(d.note||'').trim();
  if(!code)return p0Fail_('ไม่พบรหัสสินค้า');if(!isFinite(target)||target<0)return p0Fail_('ยอดสต๊อกใหม่ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');if(reason.length<3)return p0Fail_('กรุณาระบุเหตุผลในการปรับยอดสต๊อก');
  for(var attempt=1;attempt<=3;attempt++){
    var stockMap=getProductStockMap_([code]),info=stockMap[code];if(!info)return p0Fail_('ไม่พบสินค้า '+code);var delta=target-info.stock;if(delta===0)return {success:true,message:'ยอดสต๊อกไม่เปลี่ยนแปลง',productCode:code,before:info.stock,after:target,delta:0,product:p0GetProductMapped_(code)};
    var nowIso=new Date().toISOString(),docNo='ADJ'+Utilities.formatDate(new Date(),'Asia/Bangkok','yyMMdd-HHmmss')+'-'+Utilities.getUuid().replace(/-/g,'').slice(0,4).toUpperCase();
    var writes=[{update:{name:fsDocPath_('Master_Products',code),fields:{Current_Stock:{doubleValue:target}}},updateMask:{fieldPaths:['Current_Stock']},currentDocument:{updateTime:info.updateTime}},{update:{name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,docNo+'-01'),fields:{Doc_No:{stringValue:docNo},Type:{stringValue:delta>0?'IN':'OUT'},Product_Code:{stringValue:code},Product_Name:{stringValue:info.name},Qty:{doubleValue:Math.abs(delta)},Stock_Before:{doubleValue:info.stock},Stock_After:{doubleValue:target},Cost_Price:{doubleValue:info.costPrice||0},Reason:{stringValue:'ปรับยอดสต๊อก: '+reason},Ref_No:{stringValue:'STOCK-ADJUST'},Note:{stringValue:note},User:{stringValue:callerUsername||getCurrentUsername_()},Timestamp:{stringValue:nowIso}}},currentDocument:{exists:false}}];
    var commit=fsCommit_(writes);if(commit.ok){p0InvalidateProducts_();p0InvalidateDashboard_();return {success:true,message:'ปรับยอดสต๊อกเรียบร้อย',productCode:code,before:info.stock,after:target,delta:delta,docNo:docNo,product:p0GetProductMapped_(code)};}if(!isPreconditionFailure_(commit.message)||attempt===3)return p0Fail_('ปรับยอดไม่สำเร็จ: '+commit.message);Utilities.sleep(100*attempt);
  }
  return p0Fail_('ปรับยอดไม่สำเร็จ กรุณาลองใหม่');
}

function p0CreateUserAccount_(email,fullName,role){
  var cleanEmail=String(email||'').trim().toLowerCase(),cleanName=String(fullName||'').trim(),cleanRole=String(role||'').trim();
  if(!cleanEmail||cleanEmail.indexOf('@')<0)return p0Fail_('กรุณากรอกอีเมลให้ถูกต้อง');if(!cleanName)return p0Fail_('กรุณากรอกชื่อเต็ม');if(['viewer','staff','admin'].indexOf(cleanRole)<0)return p0Fail_('กรุณาเลือกสิทธิ์ผู้ใช้ให้ถูกต้อง');if(findUserByEmail_(cleanEmail))return p0Fail_('อีเมลนี้มีบัญชีผู้ใช้อยู่แล้วในระบบ');
  var username=generateUsernameFromEmail_(cleanEmail),temp=generateTempPassword_(),salt=makeSalt_(),obj={Username:username,Full_Name:cleanName,Email:cleanEmail,Password_Hash:hashPassword_(temp,salt),Salt:salt,Role:cleanRole,Status:'Active',Totp_Enabled:'false',Totp_Secret_Enc:'',Recovery_Codes:'[]',Failed_Attempts:0,Locked_Until:'',Last_Login:'',Password_Changed_At:'',Must_Change_Password:'true'};
  var r=p0SaveMasterData_(AUTH_USERS_COLLECTION,'U',null,obj,null);if(!r.success)return r;clearCollectionCache(AUTH_USERS_COLLECTION);var sent=sendAccountEmail_(cleanEmail,cleanName,username,temp,false);return {success:true,message:sent?'สร้างบัญชีผู้ใช้สำเร็จ และส่งอีเมลแจ้งรหัสผ่านเรียบร้อยแล้ว':'สร้างบัญชีผู้ใช้สำเร็จ แต่ส่งอีเมลไม่สำเร็จ กรุณาแจ้งรหัสผ่านให้ผู้ใช้ด้วยตนเอง',username:username,tempPassword:sent?undefined:temp,id:r.id,user:{docId:r.id,username:username,fullName:cleanName,email:cleanEmail,role:cleanRole,status:'Active',totpEnabled:false,lastLogin:'',mustChangePassword:true}};
}
