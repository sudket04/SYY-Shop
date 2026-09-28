// SYY Shop P0 backend hardening
// - secure P0 gateway
// - O(1) master ID counters after one-time seed
// - atomic PO receiving (stock + movement + PO)
// - audited stock adjustment
// - bounded dashboard bootstrap (4 calendar years)

var P0_MASTER_COUNTER_COLLECTION = 'Master_Id_Counters';
var P0_COUNTER_LOCK_MS = 25000;
var P0_DASHBOARD_YEARS_BACK = 4;

function p0RoleRank_(role) {
  return ({ viewer:1, staff:2, admin:3 })[String(role || '').toLowerCase()] || 0;
}

function p0Session_(token, userAgent, minRole) {
  var session = getSession_(String(token || ''), String(userAgent || ''));
  if (!session) return { ok:false, message:'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };
  if (p0RoleRank_(session.role) < p0RoleRank_(minRole || 'viewer')) {
    return { ok:false, message:'สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้' };
  }
  return { ok:true, session:session };
}

function p0Gateway(token, fnName, args, userAgent) {
  try {
    fnName = String(fnName || '');
    args = Array.isArray(args) ? args : [];
    var writes = {
      saveProduct      : ['Master_Products','P','staff'],
      saveBrand        : ['Master_Brands','B','staff'],
      saveCategory     : ['Master_Categories','C','staff'],
      saveVendor       : ['Master_Vendors','V','staff'],
      saveCustomer     : ['Master_Customers','C','staff'],
      saveZone         : ['Master_Zones','Z','staff'],
      saveCar          : ['Master_Cars','CAR','staff']
    };

    if (fnName === 'getDashboardBootstrap') {
      var a0 = p0Session_(token, userAgent, 'viewer');
      return a0.ok ? p0DashboardBootstrap_() : { success:false, message:a0.message };
    }
    if (fnName === 'receiveGoods') {
      var a1 = p0Session_(token, userAgent, 'staff');
      return a1.ok ? p0ReceiveGoodsAtomic_(args[0] || {}, a1.session.username) : { success:false, message:a1.message };
    }
    if (fnName === 'adjustProductStock') {
      var a2 = p0Session_(token, userAgent, 'staff');
      return a2.ok ? p0AdjustProductStock_(args[0] || {}, a2.session.username) : { success:false, message:a2.message };
    }
    if (fnName === 'savePurchaseOrder') {
      var a3 = p0Session_(token, userAgent, 'staff');
      return a3.ok ? p0SavePurchaseOrder_(args[0] || {}, a3.session.username) : { success:false, message:a3.message };
    }
    if (writes[fnName]) {
      var cfg = writes[fnName];
      var auth = p0Session_(token, userAgent, cfg[2]);
      if (!auth.ok) return { success:false, message:auth.message };
      var d = args[0] || {};
      var isNew = !(d.docId || d.productCode);
      if (isNew) {
        var reserved = p0ReserveNextMasterId_(cfg[0], cfg[1]);
        if (!reserved.ok) return { success:false, title:'ล้มเหลว', message:reserved.message };
        d = p0Clone_(d);
        d.docId = reserved.id;
      }
      var fn = this[fnName];
      if (typeof fn !== 'function') return { success:false, message:'ไม่พบฟังก์ชัน '+fnName };
      var res = fn(d);
      if (res && res.success && res.id) {
        res.p0Optimized = true;
        if (fnName === 'saveProduct') res.record = getProductById(res.id);
      }
      return res;
    }
    return { success:false, message:'P0 gateway ไม่อนุญาตฟังก์ชันนี้' };
  } catch (e) {
    console.error('p0Gateway [' + fnName + '] error:', e);
    return { success:false, message:(typeof friendlyErrorMessage_ === 'function' ? friendlyErrorMessage_(e) : e.message) };
  }
}

function p0Clone_(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

function p0SafeFetchAllPages_(collectionName) {
  var docs = [], pageToken = '', pages = 0;
  do {
    var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
      '/databases/(default)/documents/' + collectionName + '?pageSize=300' +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var res = UrlFetchApp.fetch(url, { method:'get', headers:getAuthHeader(), muteHttpExceptions:true });
    if (res.getResponseCode() !== 200) {
      return { ok:false, docs:docs, message:'HTTP '+res.getResponseCode()+': '+res.getContentText() };
    }
    var json = JSON.parse(res.getContentText());
    (json.documents || []).forEach(function(doc){
      docs.push({ id:doc.name.split('/').pop(), fields:doc.fields || {}, updateTime:doc.updateTime || '' });
    });
    pageToken = json.nextPageToken || '';
    pages++;
    if (pages > 10000) return { ok:false, docs:docs, truncated:true, message:'เกินขีดจำกัด pagination safety 10,000 หน้า' };
  } while (pageToken);
  return { ok:true, docs:docs, pages:pages, truncated:false };
}

function p0CounterDocUrl_(collectionName) {
  return 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
    '/databases/(default)/documents/' + P0_MASTER_COUNTER_COLLECTION + '/' + encodeURIComponent(collectionName);
}

function p0ScanMaxId_(collectionName, prefix) {
  var fetched = p0SafeFetchAllPages_(collectionName);
  if (!fetched.ok) throw new Error('seed counter ไม่สำเร็จ: ' + fetched.message);
  var max = 0, width = 4;
  fetched.docs.forEach(function(doc){
    var id = String(doc.id || '');
    if (id.indexOf(prefix) !== 0) return;
    var n = id.substring(prefix.length);
    if (!/^\d+$/.test(n)) return;
    width = Math.max(width, n.length);
    max = Math.max(max, parseInt(n,10));
  });
  return { max:max, width:width };
}

function p0ReserveNextMasterId_(collectionName, prefix) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(P0_COUNTER_LOCK_MS)) return { ok:false, message:'ระบบกำลังออกเลขรหัสให้ผู้ใช้อื่น กรุณาลองใหม่อีกครั้ง' };
  try {
    var url = p0CounterDocUrl_(collectionName);
    for (var attempt=0; attempt<8; attempt++) {
      var getRes = UrlFetchApp.fetch(url, { method:'get', headers:getAuthHeader(), muteHttpExceptions:true });
      if (getRes.getResponseCode() === 404) {
        var seeded = p0ScanMaxId_(collectionName, prefix);
        var nextSeed = seeded.max + 1;
        var createUrl = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
          '/databases/(default)/documents/' + P0_MASTER_COUNTER_COLLECTION + '?documentId=' + encodeURIComponent(collectionName);
        var createRes = UrlFetchApp.fetch(createUrl, {
          method:'post', headers:getAuthHeader(), muteHttpExceptions:true,
          payload:JSON.stringify({ fields:mapToFirestoreFields({ Value:nextSeed, Prefix:prefix, Width:seeded.width, UpdatedAt:new Date().toISOString() }) })
        });
        if (createRes.getResponseCode() === 200) {
          return { ok:true, id:prefix + String(nextSeed).padStart(seeded.width,'0'), seeded:true };
        }
        if (createRes.getResponseCode() === 409) continue;
        return { ok:false, message:'สร้าง Master counter ไม่สำเร็จ: '+createRes.getContentText() };
      }
      if (getRes.getResponseCode() !== 200) return { ok:false, message:'อ่าน Master counter ไม่สำเร็จ: '+getRes.getContentText() };

      var doc = JSON.parse(getRes.getContentText());
      var f = doc.fields || {};
      var current = parseInt(parseFirestoreValue(f.Value) || 0,10);
      var width = Math.max(4, parseInt(parseFirestoreValue(f.Width) || 4,10));
      var next = current + 1;
      var commit = fsCommit_([{
        update:{
          name:fsDocPath_(P0_MASTER_COUNTER_COLLECTION, collectionName),
          fields:mapToFirestoreFields({ Value:next, Prefix:prefix, Width:width, UpdatedAt:new Date().toISOString() })
        },
        updateMask:{ fieldPaths:['Value','Prefix','Width','UpdatedAt'] },
        currentDocument:{ updateTime:doc.updateTime }
      }]);
      if (commit.ok) return { ok:true, id:prefix + String(next).padStart(width,'0'), seeded:false };
      if (!isPreconditionFailure_(commit.message)) return { ok:false, message:'อัปเดต Master counter ไม่สำเร็จ: '+commit.message };
    }
    return { ok:false, message:'ไม่สามารถจองรหัสใหม่ได้หลัง retry หลายครั้ง' };
  } catch (e) {
    return { ok:false, message:e.message };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function p0SavePurchaseOrder_(d, username) {
  d = d || {};
  var items = Array.isArray(d.items) ? d.items : [];
  if (!d.vendorId) return { success:false, title:'ข้อมูลไม่ครบ', message:'กรุณาระบุผู้จัดจำหน่าย' };
  if (!items.length) return { success:false, title:'ข้อมูลไม่ครบ', message:'กรุณาเลือกสินค้าอย่างน้อย 1 รายการ' };
  var totalQty=0, totalAmount=0;
  items = items.map(function(it){
    var qty=Math.max(0,parseFloat(it.qty||0)), cost=Math.max(0,parseFloat(it.costPrice||0));
    totalQty += qty; totalAmount += qty*cost;
    return { productCode:String(it.productCode||''), productName:String(it.productName||''), qty:qty, costPrice:cost, receivedQty:0 };
  }).filter(function(it){ return it.productCode && it.qty>0; });
  if (!items.length) return { success:false, title:'ข้อมูลไม่ครบ', message:'จำนวนที่จะสั่งต้องมากกว่า 0' };
  var rid = p0ReserveNextMasterId_('Purchase_Orders','PO');
  if (!rid.ok) return { success:false, title:'ล้มเหลว', message:rid.message };
  var dataObject = {
    Vendor_ID:String(d.vendorId||''), Order_Date:String(d.orderDate||new Date().toISOString().slice(0,10)),
    Status:String(d.status||'Pending'), Items_JSON:JSON.stringify(items), Receipts_JSON:'[]',
    Total_Qty:totalQty, Total_Amount:totalAmount, Note:String(d.note||''), Created_By:String(username||'')
  };
  var res = saveMasterData('Purchase_Orders','PO',rid.id,dataObject,null);
  if (res && res.success) {
    res.p0Optimized = true;
    res.purchaseOrder = {
      poId:rid.id, vendorId:String(d.vendorId||''), orderDate:dataObject.Order_Date, status:dataObject.Status,
      items:items, receipts:[], totalQty:totalQty, totalAmount:totalAmount, note:dataObject.Note
    };
  }
  return res;
}

function p0GetPoDoc_(poId) {
  var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/Purchase_Orders/' + encodeURIComponent(poId);
  var res = UrlFetchApp.fetch(url,{method:'get',headers:getAuthHeader(),muteHttpExceptions:true});
  if (res.getResponseCode() !== 200) return null;
  var doc=JSON.parse(res.getContentText());
  return { name:doc.name, updateTime:doc.updateTime, fields:doc.fields||{} };
}

function p0ReceiveGoodsAtomic_(d, callerUsername) {
  function fail(msg,title){return {success:false,title:title||'ข้อมูลไม่ครบ',message:msg};}
  d=d||{};
  if (!d.poId) return fail('ไม่พบเลขที่ใบสั่งซื้อ');
  if (!String(d.invoiceNo||'').trim()) return fail('กรุณากรอกเลขที่ Invoice');
  if (!String(d.receiptDate||'').trim()) return fail('กรุณาระบุวันที่รับสินค้า');
  if (!String(d.receiverName||'').trim()) return fail('กรุณากรอกชื่อผู้รับสินค้า');
  var reqItems=Array.isArray(d.items)?d.items:[];
  if (!reqItems.length) return fail('ไม่มีรายการสินค้าที่จะรับ');

  var receiveMap={};
  reqItems.forEach(function(it){
    if (!it || !it.productCode) return;
    var q=parseFloat(it.qtyReceivedNow||0);
    if (isFinite(q) && q>0) receiveMap[String(it.productCode)] = q;
  });
  if (!Object.keys(receiveMap).length) return fail('กรุณาระบุจำนวนที่รับอย่างน้อย 1 รายการ');

  var receiptTxnId='RCV-'+String(d.poId)+'-'+Utilities.getUuid().replace(/-/g,'').slice(0,10).toUpperCase();
  for (var attempt=1; attempt<=3; attempt++) {
    var poDoc=p0GetPoDoc_(d.poId);
    if (!poDoc) return fail('ไม่พบใบสั่งซื้อนี้');
    var f=poDoc.fields||{}, currentStatus=parseFirestoreValue(f.Status)||'Pending';
    if (currentStatus==='Received') return fail('ใบสั่งซื้อนี้ได้รับสินค้าครบแล้ว ไม่สามารถบันทึกรับซ้ำได้');
    if (currentStatus==='Cancelled') return fail('ใบสั่งซื้อนี้ถูกยกเลิกแล้ว ไม่สามารถรับสินค้าได้');

    var poItems=[]; try{poItems=JSON.parse(parseFirestoreValue(f.Items_JSON)||'[]');}catch(ignore){poItems=[];}
    var receipts=[]; try{receipts=JSON.parse(parseFirestoreValue(f.Receipts_JSON)||'[]');}catch(ignore2){receipts=[];}
    if (receipts.some(function(r){return r && r.txnId===receiptTxnId;})) {
      return {success:true,title:'สำเร็จ',message:'รายการรับสินค้านี้ถูกบันทึกแล้ว',status:currentStatus,idempotent:true};
    }

    var allComplete=true, lines=[];
    poItems=poItems.map(function(it){
      var ordered=parseFloat(it.qty||0), already=parseFloat(it.receivedQty||0), remaining=Math.max(ordered-already,0);
      var requested=receiveMap.hasOwnProperty(it.productCode)?receiveMap[it.productCode]:0;
      var receiveNow=Math.max(0,Math.min(requested,remaining));
      var newReceived=already+receiveNow;
      if (newReceived<ordered) allComplete=false;
      if (receiveNow>0) lines.push({productCode:String(it.productCode),productName:String(it.productName||''),qty:receiveNow,costPrice:parseFloat(it.costPrice||0)});
      it.receivedQty=newReceived; return it;
    });
    if (!lines.length) return fail('ไม่มีจำนวนคงเหลือที่สามารถรับเพิ่มได้');
    if (!allComplete && !String(d.deliveryNoteNo||'').trim()) return fail('กรุณากรอกเลขที่ใบส่งของชั่วคราว เนื่องจากได้รับสินค้าไม่ครบตามจำนวนที่สั่งซื้อ');

    var stockMap=getProductStockMap_(lines.map(function(x){return x.productCode;}));
    var missing=lines.filter(function(x){return !stockMap[x.productCode];}).map(function(x){return x.productCode;});
    if (missing.length) return fail('ไม่พบสินค้า: '+missing.join(', '),'ไม่พบข้อมูล');

    var nowIso=new Date().toISOString(), user=callerUsername||getCurrentUsername_(), writes=[];
    lines.forEach(function(line,i){
      var info=stockMap[line.productCode];
      writes.push({
        transform:{ document:fsDocPath_('Master_Products',line.productCode), fieldTransforms:[{ fieldPath:'Current_Stock', increment:{doubleValue:line.qty} }] },
        currentDocument:{ updateTime:info.updateTime }
      });
      var mvId=receiptTxnId+'-'+String(i+1).padStart(2,'0');
      writes.push({
        update:{ name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,mvId), fields:mapToFirestoreFields({
          Doc_No:receiptTxnId, Type:'IN', Product_Code:line.productCode, Product_Name:line.productName||info.name,
          Qty:line.qty, Stock_Before:info.stock, Stock_After:info.stock+line.qty,
          Unit_Price:line.costPrice, Cost_Price:line.costPrice, Reason:'รับของตาม PO', Ref_No:String(d.poId),
          Invoice_No:String(d.invoiceNo||''), User:user, Timestamp:nowIso
        }) },
        currentDocument:{ exists:false }
      });
    });

    var receiptLines=lines.map(function(x){return {productCode:x.productCode,productName:x.productName,qtyReceivedNow:x.qty};});
    receipts.push({ txnId:receiptTxnId,date:String(d.receiptDate),invoiceNo:String(d.invoiceNo),receiverName:String(d.receiverName),
      deliveryNoteNo:allComplete?'':String(d.deliveryNoteNo||''),isFinal:allComplete,items:receiptLines });
    var newStatus=allComplete?'Received':'PartiallyReceived';
    writes.push({
      update:{ name:fsDocPath_('Purchase_Orders',String(d.poId)), fields:mapToFirestoreFields({
        Items_JSON:JSON.stringify(poItems), Receipts_JSON:JSON.stringify(receipts), Status:newStatus, Updated_At:nowIso
      }) },
      updateMask:{ fieldPaths:['Items_JSON','Receipts_JSON','Status','Updated_At'] },
      currentDocument:{ updateTime:poDoc.updateTime }
    });

    var commit=fsCommit_(writes);
    if (commit.ok) {
      return {
        success:true,title:'สำเร็จ',status:newStatus,receiptTxnId:receiptTxnId,
        message:allComplete?'บันทึกรับสินค้าครบถ้วน และอัปเดตสต็อกเรียบร้อย':'บันทึกรับสินค้าบางส่วน และอัปเดตสต็อกเรียบร้อย',
        stockChanges:lines.map(function(line){var info=stockMap[line.productCode];return {productCode:line.productCode,before:info.stock,after:info.stock+line.qty,delta:line.qty};}),
        purchaseOrder:{poId:String(d.poId),status:newStatus,items:poItems,receipts:receipts}
      };
    }
    if (!isPreconditionFailure_(commit.message)) return {success:false,title:'ล้มเหลว',message:commit.message||'บันทึกรับสินค้าไม่สำเร็จ'};
  }
  return {success:false,title:'ข้อมูลถูกเปลี่ยนระหว่างทำรายการ',message:'มีผู้ใช้อื่นแก้ไขสต๊อกหรือใบสั่งซื้อพร้อมกัน กรุณาเปิดข้อมูลใหม่แล้วลองอีกครั้ง'};
}

function p0AdjustProductStock_(d, callerUsername) {
  d=d||{};
  var code=String(d.productCode||'').trim();
  var reason=String(d.reason||'').trim(), note=String(d.note||'').trim();
  var target=parseFloat(d.newStock);
  if (!code) return {success:false,message:'ไม่พบรหัสสินค้า'};
  if (!isFinite(target) || target<0) return {success:false,message:'ยอดสต๊อกใหม่ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'};
  if (reason.length<3) return {success:false,message:'กรุณาระบุเหตุผลในการปรับยอดสต๊อก'};
  for(var attempt=1;attempt<=3;attempt++){
    var map=getProductStockMap_([code]), info=map[code];
    if(!info) return {success:false,message:'ไม่พบสินค้า '+code};
    var delta=target-info.stock;
    if(delta===0) return {success:true,message:'ยอดสต๊อกไม่เปลี่ยนแปลง',before:info.stock,after:target};
    var nowIso=new Date().toISOString(), docNo='ADJ'+Utilities.formatDate(new Date(),'Asia/Bangkok','yyMMdd-HHmmss')+'-'+Utilities.getUuid().replace(/-/g,'').slice(0,4).toUpperCase();
    var writes=[
      { update:{ name:fsDocPath_('Master_Products',code), fields:{Current_Stock:{doubleValue:target}} }, updateMask:{fieldPaths:['Current_Stock']}, currentDocument:{updateTime:info.updateTime} },
      { update:{ name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,docNo+'-01'), fields:mapToFirestoreFields({
          Doc_No:docNo,Type:delta>0?'IN':'OUT',Product_Code:code,Product_Name:info.name,Qty:Math.abs(delta),Stock_Before:info.stock,Stock_After:target,
          Unit_Price:0,Cost_Price:info.costPrice,Reason:'ปรับยอดสต๊อก: '+reason,Ref_No:'STOCK-ADJUST',Note:note,User:callerUsername||getCurrentUsername_(),Timestamp:nowIso
        }) }, currentDocument:{exists:false} }
    ];
    var c=fsCommit_(writes);
    if(c.ok) return {success:true,message:'ปรับยอดสต๊อกเรียบร้อย',productCode:code,before:info.stock,after:target,delta:delta,docNo:docNo};
    if(!isPreconditionFailure_(c.message)) return {success:false,message:c.message||'ปรับยอดไม่สำเร็จ'};
  }
  return {success:false,message:'สต๊อกถูกเปลี่ยนพร้อมกันหลายครั้ง กรุณาลองใหม่'};
}

function p0QueryMovementsYears_() {
  var now=new Date(), startYear=now.getFullYear()-(P0_DASHBOARD_YEARS_BACK-1);
  var cutoff=new Date(startYear,0,1,0,0,0,0).toISOString();
  var out=[];
  var query={structuredQuery:{
    from:[{collectionId:STOCK_MOVEMENT_COLLECTION}],
    where:{fieldFilter:{field:{fieldPath:'Timestamp'},op:'GREATER_THAN_OR_EQUAL',value:{stringValue:cutoff}}},
    orderBy:[{field:{fieldPath:'Timestamp'},direction:'ASCENDING'}]
  }};
  var url='https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:runQuery';
  var res=UrlFetchApp.fetch(url,{method:'post',headers:getAuthHeader(),payload:JSON.stringify(query),muteHttpExceptions:true});
  if(res.getResponseCode()!==200){console.error('p0QueryMovementsYears_ HTTP '+res.getResponseCode()+': '+res.getContentText());return out;}
  (JSON.parse(res.getContentText())||[]).forEach(function(row){
    if(!row.document)return; var f=row.document.fields||{};
    out.push({docNo:parseFirestoreValue(f.Doc_No)||'',type:parseFirestoreValue(f.Type)||'OUT',productCode:parseFirestoreValue(f.Product_Code)||'',productName:parseFirestoreValue(f.Product_Name)||'',
      qty:parseFloat(parseFirestoreValue(f.Qty)||0),stockAfter:parseFloat(parseFirestoreValue(f.Stock_After)||0),unitPrice:parseFloat(parseFirestoreValue(f.Unit_Price)||0),costPrice:parseFloat(parseFirestoreValue(f.Cost_Price)||0),
      reason:parseFirestoreValue(f.Reason)||'',refNo:parseFirestoreValue(f.Ref_No)||'',note:parseFirestoreValue(f.Note)||'',user:parseFirestoreValue(f.User)||'',timestamp:parseFirestoreValue(f.Timestamp)||''});
  });
  return out;
}

function p0DashboardBootstrap_() {
  var products=getAllProducts(), movements=p0QueryMovementsYears_(), poVendorMap={}, pendingPoCount=0, pendingPoValue=0;
  try{
    getPurchaseOrders().forEach(function(po){
      poVendorMap[po.poId]=po.vendorName;
      if(['Pending','Ordered','PartiallyReceived'].indexOf(po.status)>-1){pendingPoCount++;pendingPoValue+=parseFloat(po.totalAmount||0);}
    });
  }catch(e){console.error('p0DashboardBootstrap_ PO:',e);}
  var outCount=0,lowCount=0,stockValue=0;
  products.forEach(function(p){
    var st=parseFloat(p.currentStock||0),mn=parseFloat(p.minStock||0),cost=parseFloat(p.costPrice||0);
    stockValue+=st*cost; if(st<=0)outCount++; else if(st<=mn)lowCount++;
  });
  return { products:products,movements:movements,poVendorMap:poVendorMap,p0Summary:{
    stockValue:stockValue,outOfStockCount:outCount,lowStockCount:lowCount,pendingPoCount:pendingPoCount,pendingPoValue:pendingPoValue,
    movementWindowYears:P0_DASHBOARD_YEARS_BACK
  }};
}

function p0Diagnostics(token,userAgent){
  var a=p0Session_(token,userAgent,'admin'); if(!a.ok)return {success:false,message:a.message};
  return {success:true,version:'P0-2026-09-29',checks:{atomicReceive:true,masterCounter:true,stockAdjustment:true,boundedDashboard:true}};
}
