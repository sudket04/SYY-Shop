// ============================================================
// SYY Shop P0 Hardening Layer
// Intercepts only gaps not already covered by P0Core.gs.
// ============================================================

var P0_TXN_REQUEST_COLLECTION = 'P0_Transaction_Requests';
var P0_ATOMIC_MAX_PRODUCT_LINES = 249; // 2 writes/product + up to 2 control writes <= Firestore 500 writes
var P0_SAFE_CACHE_CHUNK_CHARS = 18000; // conservative for Thai/UTF-8 + JSON escaping under CacheService 100KB/key

function p0TuneRuntime_() {
  // P0Core originally chunks by JavaScript character count. CacheService limits are byte based;
  // Thai and emoji can use multiple UTF-8 bytes, so 45k chars can silently exceed one cache key.
  if (typeof P0_CACHE_CHUNK_CHARS !== 'undefined') {
    var current = parseInt(P0_CACHE_CHUNK_CHARS,10) || P0_SAFE_CACHE_CHUNK_CHARS;
    P0_CACHE_CHUNK_CHARS = Math.min(current,P0_SAFE_CACHE_CHUNK_CHARS);
  }
}

function p0AuditWrite_(username, action, label, docId, success) {
  try {
    var now = new Date();
    var id = 'P0LOG-' + Utilities.formatDate(now,'Asia/Bangkok','yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().replace(/-/g,'').slice(0,8);
    var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
      '/databases/(default)/documents/' + ACTIVITY_LOG_COLLECTION + '?documentId=' + encodeURIComponent(id);
    UrlFetchApp.fetch(url, {
      method:'post', headers:getAuthHeader(), muteHttpExceptions:true,
      payload:JSON.stringify({ fields:mapToFirestoreFields({
        Username:String(username||''), Action:String(action||''), Label:String(label||''),
        DocId:String(docId||''), Success:success ? 'true' : 'false', Timestamp:now.toISOString()
      }) })
    });
  } catch (e) { console.error('p0AuditWrite_:', e); }
}

function p0DeletePrimaryImageSecure_(token,userAgent,productCode) {
  var auth=productGalleryAuth_(token,userAgent,true);
  if(!auth.ok)return {success:false,message:auth.message};
  var images=productGalleryRead_(String(productCode||'').trim());
  if(!images.length)return productGalleryResult_(productCode,[],'ไม่มีรูปสินค้า');
  return deleteProductGalleryImage(token,userAgent,productCode,images[0].id);
}

function p0SanitizeRequestId_(value) {
  return String(value||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,64);
}

function p0DigestShort_(raw, length) {
  var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(raw||''));
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,'').slice(0,length||24);
}

function p0GatewayV2(token, fnName, args, userAgent) {
  try {
    p0TuneRuntime_();
    var session = getSession_(token, userAgent);
    if (!session) return { __authError:true, success:false, message:'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };
    var a = Array.isArray(args) ? args : [];
    var result;

    if (fnName === 'saveProduct') {
      if (!p0RoleAllowed_(session.role,'staff')) return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
      result = p0SaveProductFast_(a[0] || {});
      if (ACTIVITY_ACTIONS && ACTIVITY_ACTIONS.saveProduct) logActivity_(session.username,'saveProduct',a,result);
      return result;
    }

    if (fnName === 'issueStock') {
      if (!p0RoleAllowed_(session.role,'staff')) return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
      var issuePayload = {}, src = a[0] || {};
      Object.keys(src).forEach(function(k){ issuePayload[k] = src[k]; });
      // Never trust a client request to allow negative stock.
      issuePayload.allowNegative = false;
      result = p0IssueStockIdempotent_(issuePayload, session.username);
      if (ACTIVITY_ACTIONS && ACTIVITY_ACTIONS.issueStock) logActivity_(session.username,'issueStock',[issuePayload,session.username],result);
      return result;
    }

    // Gallery/image operations route to the self-authorizing gallery layer.
    if (fnName === 'getProductGallery') return getProductGallery(token,userAgent,a[0]);
    if (fnName === 'uploadProductGalleryImage' || fnName === 'uploadProductImage') {
      if (!p0RoleAllowed_(session.role,'staff')) return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
      result = uploadProductGalleryImage(token,userAgent,a[0],a[1]);
      p0AuditWrite_(session.username,'uploadProductImage','อัปโหลดรูปสินค้า',a[0],!!(result&&result.success));
      return result;
    }
    if (fnName === 'deleteProductGalleryImage') {
      if (!p0RoleAllowed_(session.role,'staff')) return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
      result = deleteProductGalleryImage(token,userAgent,a[0],a[1]);
      p0AuditWrite_(session.username,'deleteProductImage','ลบรูปสินค้า',a[0],!!(result&&result.success));
      return result;
    }
    if (fnName === 'deleteProductImage') {
      if (!p0RoleAllowed_(session.role,'staff')) return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
      result = p0DeletePrimaryImageSecure_(token,userAgent,a[0]);
      p0AuditWrite_(session.username,'deleteProductImage','ลบรูปหลักสินค้า',a[0],!!(result&&result.success));
      return result;
    }
    if (fnName === 'setProductGalleryPrimary') {
      if (!p0RoleAllowed_(session.role,'staff')) return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
      result = setProductGalleryPrimary(token,userAgent,a[0],a[1]);
      p0AuditWrite_(session.username,'setProductGalleryPrimary','เปลี่ยนรูปหลักสินค้า',a[0],!!(result&&result.success));
      return result;
    }

    if (fnName === 'receiveGoods') {
      if (!p0RoleAllowed_(session.role,'staff')) return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
      result = p0ReceiveGoodsIdempotent_(a[0] || {}, session.username);
      if (ACTIVITY_ACTIONS && ACTIVITY_ACTIONS.receiveGoods) logActivity_(session.username,'receiveGoods',[a[0] || {},session.username],result);
      return result;
    }
    if (fnName === 'adjustProductStock') {
      if (!p0RoleAllowed_(session.role,'staff')) return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
      result = p0AdjustProductStockFast_(a[0] || {}, session.username);
      p0AuditWrite_(session.username,'adjustProductStock','ปรับยอดสต๊อก',(a[0]||{}).productCode,!!(result&&result.success));
      return result;
    }
    if (fnName === 'createUserAccount') {
      if (!p0RoleAllowed_(session.role,'admin')) return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
      result = p0CreateUserAccount_(a[0],a[1],a[2]);
      p0AuditWrite_(session.username,'createUserAccount','สร้างบัญชีผู้ใช้',(result&&result.id)||'',!!(result&&result.success));
      return result;
    }
    return p0Gateway(token,fnName,a,userAgent);
  } catch (e) {
    console.error('p0GatewayV2 ['+fnName+']:',e);
    return p0Fail_(friendlyErrorMessage_(e),'ข้อผิดพลาด');
  }
}

function p0CanonicalReceivePayload_(d) {
  var items=(Array.isArray(d&&d.items)?d.items:[]).map(function(it){
    return {c:String((it&&it.productCode)||''),q:parseFloat((it&&it.qtyReceivedNow)||0)||0};
  }).sort(function(a,b){return a.c.localeCompare(b.c);});
  return [String((d&&d.poId)||''),String((d&&d.invoiceNo)||'').trim().toUpperCase(),String((d&&d.receiptDate)||''),String((d&&d.deliveryNoteNo)||'').trim().toUpperCase(),JSON.stringify(items)].join('|');
}

function p0StableReceiveId_(d) {
  var provided=p0SanitizeRequestId_(d&&d.clientRequestId);
  return (provided?'REQ_':'AUTO_') + p0DigestShort_((provided?provided+'|':'')+p0CanonicalReceivePayload_(d),24);
}

function p0ReceiveGoodsIdempotent_(d,callerUsername) {
  d=d||{};
  if(!d.poId)return p0Fail_('ไม่พบเลขที่ใบสั่งซื้อ','ข้อมูลไม่ครบ');
  if(!String(d.invoiceNo||'').trim())return p0Fail_('กรุณากรอกเลขที่ Invoice','ข้อมูลไม่ครบ');
  if(!String(d.receiptDate||'').trim())return p0Fail_('กรุณาระบุวันที่รับสินค้า','ข้อมูลไม่ครบ');
  if(!String(d.receiverName||'').trim())return p0Fail_('กรุณากรอกชื่อผู้รับสินค้า','ข้อมูลไม่ครบ');
  var req=Array.isArray(d.items)?d.items:[];if(!req.length)return p0Fail_('ไม่มีรายการสินค้าที่จะรับ','ข้อมูลไม่ครบ');
  var clientRequestId=p0SanitizeRequestId_(d.clientRequestId),requestId=p0StableReceiveId_(d),txnId='RCV-'+String(d.poId)+'-'+requestId;

  for(var attempt=1;attempt<=3;attempt++){
    var po=p0GetDoc_('Purchase_Orders',d.poId);if(!po)return p0Fail_('ไม่พบใบสั่งซื้อนี้');
    var f=po.fields||{},status=parseFirestoreValue(f.Status)||'Pending',poItems=[],receipts=[];
    try{poItems=JSON.parse(parseFirestoreValue(f.Items_JSON)||'[]');}catch(e){}
    try{receipts=JSON.parse(parseFirestoreValue(f.Receipts_JSON)||'[]');}catch(e2){}
    var prior=receipts.filter(function(r){return r&&(r.txnId===txnId||(clientRequestId&&r.clientRequestId===clientRequestId&&r.requestHash===requestId));})[0];
    if(prior)return {success:true,title:'สำเร็จ',message:'รายการรับสินค้านี้ถูกบันทึกแล้ว',status:status,poId:d.poId,idempotent:true,receiptTxnId:txnId,stockChanges:[],purchaseOrder:{poId:d.poId,status:status,items:poItems,receipts:receipts}};
    if(status==='Received')return p0Fail_('ใบสั่งซื้อนี้ได้รับสินค้าครบแล้ว');
    if(status==='Cancelled')return p0Fail_('ใบสั่งซื้อนี้ถูกยกเลิกแล้ว');

    var receiveMap={};req.forEach(function(it){var c=String(it.productCode||''),q=Math.max(0,parseFloat(it.qtyReceivedNow||0));if(c)receiveMap[c]=(receiveMap[c]||0)+q;});
    var allComplete=true,rawLines=[];
    poItems=poItems.map(function(it){
      var code=String(it.productCode||''),ordered=parseFloat(it.qty||0),old=parseFloat(it.receivedQty||0),remaining=Math.max(ordered-old,0),available=receiveMap[code]||0,now=Math.min(remaining,available),next=old+now;
      receiveMap[code]=Math.max(0,available-now);
      if(next<ordered)allComplete=false;
      if(now>0)rawLines.push({productCode:code,productName:it.productName,qty:now,costPrice:parseFloat(it.costPrice||0)});
      it.receivedQty=next;return it;
    });
    if(!rawLines.length)return p0Fail_('กรุณาระบุจำนวนที่รับอย่างน้อย 1 รายการ','ข้อมูลไม่ครบ');
    if(!allComplete&&!String(d.deliveryNoteNo||'').trim())return p0Fail_('กรุณากรอกเลขที่ใบส่งของชั่วคราว เนื่องจากได้รับสินค้าไม่ครบ','ข้อมูลไม่ครบ');

    // Aggregate duplicate product lines before touching inventory. This avoids writing the same
    // product document multiple times in one Firestore commit and prevents double allocation.
    var lineMap={};rawLines.forEach(function(x){
      if(!lineMap[x.productCode])lineMap[x.productCode]={productCode:x.productCode,productName:x.productName,qty:0,costValue:0};
      lineMap[x.productCode].qty+=x.qty;lineMap[x.productCode].costValue+=x.qty*(parseFloat(x.costPrice)||0);
    });
    var lines=Object.keys(lineMap).map(function(code){var x=lineMap[code];x.costPrice=x.qty?x.costValue/x.qty:0;return x;});
    if(lines.length>P0_ATOMIC_MAX_PRODUCT_LINES)return p0Fail_('รายการรับสินค้ามากเกินขีดจำกัดของธุรกรรมเดียว ('+P0_ATOMIC_MAX_PRODUCT_LINES+' SKU) กรุณาแบ่งการรับสินค้าเป็นหลายครั้ง','รายการมากเกินไป');

    var stockMap=getProductStockMap_(lines.map(function(x){return x.productCode;})),missing=[];lines.forEach(function(x){if(!stockMap[x.productCode])missing.push(x.productCode);});if(missing.length)return p0Fail_('ไม่พบสินค้ารหัส: '+missing.join(', '));
    var vendorId=parseFirestoreValue(f.Vendor_ID)||'',vendor=p0VendorSnapshot_(vendorId),nowIso=new Date().toISOString(),writes=[];
    lines.forEach(function(x,i){var info=stockMap[x.productCode],after=info.stock+x.qty;
      writes.push({transform:{document:fsDocPath_('Master_Products',x.productCode),fieldTransforms:[{fieldPath:'Current_Stock',increment:{doubleValue:x.qty}}]},currentDocument:{updateTime:info.updateTime}});
      writes.push({update:{name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,txnId+'-'+String(i+1).padStart(3,'0')),fields:{Doc_No:{stringValue:txnId},Type:{stringValue:'IN'},Product_Code:{stringValue:x.productCode},Product_Name:{stringValue:String(x.productName||info.name)},Qty:{doubleValue:x.qty},Stock_Before:{doubleValue:info.stock},Stock_After:{doubleValue:after},Cost_Price:{doubleValue:parseFloat(x.costPrice||info.costPrice||0)},Reason:{stringValue:'รับของตาม PO'},Ref_No:{stringValue:String(d.poId)},Vendor_ID:{stringValue:vendor.id},Vendor_Name:{stringValue:vendor.name},Invoice_No:{stringValue:String(d.invoiceNo||'')},Receipt_Date:{stringValue:String(d.receiptDate||'')},User:{stringValue:callerUsername||getCurrentUsername_()},Timestamp:{stringValue:nowIso}}},currentDocument:{exists:false}});
    });
    var receiptItems=lines.map(function(x){return {productCode:x.productCode,productName:x.productName,qtyReceivedNow:x.qty};});
    receipts.push({txnId:txnId,clientRequestId:clientRequestId,requestHash:requestId,date:d.receiptDate,invoiceNo:String(d.invoiceNo||''),receiverName:String(d.receiverName||''),deliveryNoteNo:allComplete?'':String(d.deliveryNoteNo||''),isFinal:allComplete,items:receiptItems});
    var newStatus=allComplete?'Received':'PartiallyReceived';
    writes.push({update:{name:po.name,fields:{Items_JSON:{stringValue:JSON.stringify(poItems)},Receipts_JSON:{stringValue:JSON.stringify(receipts)},Status:{stringValue:newStatus},Updated_At:{stringValue:nowIso}}},updateMask:{fieldPaths:['Items_JSON','Receipts_JSON','Status','Updated_At']},currentDocument:{updateTime:po.updateTime}});
    var commit=fsCommit_(writes);
    if(commit.ok){p0InvalidateProducts_();p0InvalidateDashboard_();return {success:true,title:'สำเร็จ',message:allComplete?'บันทึกรับสินค้าครบถ้วน และอัปเดตสต็อกเรียบร้อย':'บันทึกรับสินค้าบางส่วน และอัปเดตสต็อกเรียบร้อย',status:newStatus,poId:d.poId,receiptTxnId:txnId,stockChanges:lines.map(function(x){var info=stockMap[x.productCode];return {productCode:x.productCode,before:info.stock,after:info.stock+x.qty,qty:x.qty};}),purchaseOrder:{poId:d.poId,status:newStatus,items:poItems,receipts:receipts}};}
    if(!isPreconditionFailure_(commit.message)||attempt===3)return p0Fail_('บันทึกรับสินค้าไม่สำเร็จ: '+commit.message,'ล้มเหลว');
    Utilities.sleep(120*attempt);
  }
  return p0Fail_('บันทึกรับสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง');
}

function p0ReadCommittedRequest_(ledgerId) {
  var doc=p0GetDoc_(P0_TXN_REQUEST_COLLECTION,ledgerId);if(!doc)return null;
  try {var raw=parseFirestoreValue((doc.fields||{}).Result_JSON)||'';var out=JSON.parse(raw);if(out&&out.success){out.idempotent=true;return out;}} catch(e) {}
  return null;
}

function p0IssueStockIdempotent_(d,callerUsername) {
  d=d||{};
  var raw=(Array.isArray(d.items)?d.items:[]).filter(function(it){return it&&it.productCode&&parseFloat(it.qty||0)>0;});
  if(!raw.length)return p0Fail_('ไม่มีรายการที่จะตัดสต๊อก');
  var reason=String(d.reason||'').trim();if(ISSUE_REASONS.indexOf(reason)<0)return p0Fail_('กรุณาเลือกเหตุผลที่ตัดสต๊อกให้ถูกต้อง');

  var merged={};raw.forEach(function(it){var c=String(it.productCode);if(!merged[c])merged[c]={productCode:c,productName:it.productName||'',qty:0};merged[c].qty+=parseFloat(it.qty||0);});
  var baseLines=Object.keys(merged).map(function(k){return merged[k];});
  if(baseLines.length>P0_ATOMIC_MAX_PRODUCT_LINES)return p0Fail_('รายการตัดสต๊อกมากเกินขีดจำกัดของธุรกรรมเดียว ('+P0_ATOMIC_MAX_PRODUCT_LINES+' SKU) กรุณาแบ่งเป็นหลายรายการ','รายการมากเกินไป');

  var user=callerUsername||getCurrentUsername_();
  var requestId=p0SanitizeRequestId_(d.clientRequestId)||('SRV_'+Utilities.getUuid().replace(/-/g,''));
  var ledgerId='ISSUE__'+p0DigestShort_(user+'|'+requestId,32);
  var prior=p0ReadCommittedRequest_(ledgerId);if(prior)return prior;
  var docNo='SI'+Utilities.formatDate(new Date(),'Asia/Bangkok','yyMMdd-HHmmss')+'-'+p0DigestShort_(requestId,6).toUpperCase();

  for(var attempt=1;attempt<=3;attempt++){
    prior=p0ReadCommittedRequest_(ledgerId);if(prior)return prior;
    var quoteInfo=p0LoadQuoteForIssue_(d.quoteId);if(quoteInfo&&quoteInfo.error)return p0Fail_(quoteInfo.error);if(quoteInfo&&quoteInfo.already)return p0Fail_('ใบเสนอราคานี้ถูกตัดสต๊อกแล้ว (เลขที่ '+quoteInfo.docNo+')');
    var stockMap=getProductStockMap_(baseLines.map(function(x){return x.productCode;})),lines=[],ins=[],missing=[];
    baseLines.forEach(function(x){var info=stockMap[x.productCode];if(!info){missing.push(x.productCode);return;}var after=info.stock-x.qty;if(after<0)ins.push({productCode:x.productCode,productName:x.productName||info.name,stock:info.stock,need:x.qty});lines.push({productCode:x.productCode,productName:x.productName||info.name,qty:x.qty,before:info.stock,after:after,minStock:info.minStock,costPrice:info.costPrice,unitPrice:quoteInfo&&quoteInfo.priceMap.hasOwnProperty(x.productCode)?quoteInfo.priceMap[x.productCode]:info.sellingPrice,updateTime:info.updateTime});});
    if(missing.length)return p0Fail_('ไม่พบสินค้ารหัส: '+missing.join(', '));
    if(ins.length)return p0Fail_('จำนวนที่ตัดเกินสต๊อกคงเหลือ: '+ins.map(function(x){return x.productName+' (คงเหลือ '+x.stock+' ต้องการ '+x.need+')';}).join(', '));

    var nowIso=new Date().toISOString();
    var result={success:true,title:'สำเร็จ',message:'ตัดสต๊อกเรียบร้อย',docNo:docNo,quotationMarked:!!quoteInfo,requestId:requestId,results:lines.map(function(l){return {productCode:l.productCode,productName:l.productName,qty:l.qty,before:l.before,after:l.after,belowMin:l.after<=l.minStock};})};
    var writes=[];
    lines.forEach(function(l,i){
      writes.push({transform:{document:fsDocPath_('Master_Products',l.productCode),fieldTransforms:[{fieldPath:'Current_Stock',increment:{doubleValue:-l.qty}}]},currentDocument:{updateTime:l.updateTime}});
      writes.push({update:{name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,docNo+'-'+String(i+1).padStart(3,'0')),fields:{Doc_No:{stringValue:docNo},Type:{stringValue:'OUT'},Product_Code:{stringValue:l.productCode},Product_Name:{stringValue:String(l.productName)},Qty:{doubleValue:l.qty},Stock_Before:{doubleValue:l.before},Stock_After:{doubleValue:l.after},Unit_Price:{doubleValue:parseFloat(l.unitPrice||0)},Cost_Price:{doubleValue:parseFloat(l.costPrice||0)},Reason:{stringValue:reason},Ref_No:{stringValue:String(d.refNo||'')},Note:{stringValue:String(d.note||'')},User:{stringValue:user},Timestamp:{stringValue:nowIso},Request_Id:{stringValue:requestId}}},currentDocument:{exists:false}});
    });
    if(quoteInfo&&quoteInfo.doc){writes.push({update:{name:quoteInfo.doc.name,fields:{Stock_Issued:{stringValue:'true'},Stock_Issue_Doc:{stringValue:docNo},Stock_Issued_By:{stringValue:user},Stock_Issued_At:{stringValue:nowIso}}},updateMask:{fieldPaths:['Stock_Issued','Stock_Issue_Doc','Stock_Issued_By','Stock_Issued_At']},currentDocument:{updateTime:quoteInfo.doc.updateTime}});}
    writes.push({update:{name:fsDocPath_(P0_TXN_REQUEST_COLLECTION,ledgerId),fields:mapToFirestoreFields({Action:'issueStock',Request_Id:requestId,Username:user,Result_JSON:JSON.stringify(result),CreatedAt:nowIso})},currentDocument:{exists:false}});

    var commit=fsCommit_(writes);
    if(commit.ok){p0InvalidateProducts_();p0InvalidateDashboard_();return result;}
    prior=p0ReadCommittedRequest_(ledgerId);if(prior)return prior;
    if(!isPreconditionFailure_(commit.message)||attempt===3)return p0Fail_('บันทึกไม่สำเร็จ: '+commit.message,'ล้มเหลว');
    Utilities.sleep(120*attempt);
  }
  return p0Fail_('บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง');
}

function p0AdjustProductStock_(d,callerUsername){return p0AdjustProductStockFast_(d,callerUsername);}

function p0CreateUserAccount_(email,fullName,role){
  var cleanEmail=String(email||'').trim().toLowerCase(),cleanName=String(fullName||'').trim(),cleanRole=String(role||'').trim();
  if(!cleanEmail||cleanEmail.indexOf('@')<0)return p0Fail_('กรุณากรอกอีเมลให้ถูกต้อง');if(!cleanName)return p0Fail_('กรุณากรอกชื่อเต็ม');if(['viewer','staff','admin'].indexOf(cleanRole)<0)return p0Fail_('กรุณาเลือกสิทธิ์ผู้ใช้ให้ถูกต้อง');if(findUserByEmail_(cleanEmail))return p0Fail_('อีเมลนี้มีบัญชีผู้ใช้อยู่แล้วในระบบ');
  var username=generateUsernameFromEmail_(cleanEmail),temp=generateTempPassword_(),salt=makeSalt_(),obj={Username:username,Full_Name:cleanName,Email:cleanEmail,Password_Hash:hashPassword_(temp,salt),Salt:salt,Role:cleanRole,Status:'Active',Totp_Enabled:'false',Totp_Secret_Enc:'',Recovery_Codes:'[]',Failed_Attempts:0,Locked_Until:'',Last_Login:'',Password_Changed_At:'',Must_Change_Password:'true'};
  var r=p0SaveMasterData_(AUTH_USERS_COLLECTION,'U',null,obj,null);if(!r.success)return r;clearCollectionCache(AUTH_USERS_COLLECTION);var sent=sendAccountEmail_(cleanEmail,cleanName,username,temp,false);return {success:true,message:sent?'สร้างบัญชีผู้ใช้สำเร็จ และส่งอีเมลแจ้งรหัสผ่านเรียบร้อยแล้ว':'สร้างบัญชีผู้ใช้สำเร็จ แต่ส่งอีเมลไม่สำเร็จ กรุณาแจ้งรหัสผ่านให้ผู้ใช้ด้วยตนเอง',username:username,tempPassword:sent?undefined:temp,id:r.id,user:{docId:r.id,username:username,fullName:cleanName,email:cleanEmail,role:cleanRole,status:'Active',totpEnabled:false,lastLogin:'',mustChangePassword:true}};
}
