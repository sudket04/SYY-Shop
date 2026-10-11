// Browser RPC surface: doGet, apiGateway and the five pre-login auth endpoints.
// Helpers, business workers and maintenance handlers end in '_' so HtmlService
// cannot invoke them directly. Keep API operation names in API_REGISTRY unchanged.
// ==========================================
// 0. ฟังก์ชัน URL ของ Web App
// ==========================================
function getWebAppUrl_() {
  try {
    return ScriptApp.getService().getUrl();
  } catch (e) {
    return "";
  }
}

// ==========================================
// 1. ระบบจัดการหน้าเว็บ (Routing)
// ==========================================
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'home';
  var token = (e && e.parameter && e.parameter.token) ? e.parameter.token : '';
  var mode   = (e && e.parameter && e.parameter.mode)   ? e.parameter.mode   : '';
  var rtoken = (e && e.parameter && e.parameter.rtoken) ? e.parameter.rtoken : '';

  // ★ NEW: ดึง User-Agent จาก request headers เพื่อผูก session กับเบราว์เซอร์ที่ login ไว้
  //   e.parameter ไม่มี user-agent ตรงๆ — Apps Script HtmlService ไม่ส่ง header มาให้ doGet โดยตรง
  //   จึงต้องอ่านจาก property ที่ Apps Script รองรับเท่าที่มี (ดูหมายเหตุด้านล่าง)
  var userAgent = (e && e.parameter && e.parameter.ua) ? e.parameter.ua : '';

  var files = {
    'login'      : 'login',
    'home'       : 'index',
    'brands'     : 'Master_Brands',
    'categories' : 'Master_Categories',
    'vendors'    : 'Master_Vendors',
    'zones'      : 'Master_Zones',
    'products'   : 'Master_Products',
    'cars'       : 'Master_Cars',
    'orders'     : 'Purchase_Orders',
    'taxinvoice' : 'Master_Tax_Invoice',
    'quotation'  : 'Quotation',
    'customers'  : 'Master_Customers',
    'profile'    : 'Profile',
    'manageusers': 'Manage_Users',
    'stockissue' : 'StockIssue'
  };

  var session = getSession_(token, userAgent);

  // ★ FIX: เดิมเช็ค session เฉพาะ page==='home' เท่านั้น — เปิด URL ตรงๆ เช่น ?page=manageusers
  //   โดยไม่มี token เลยก็ยังได้ template หน้านั้นเต็มๆ กลับมา (ช่องโหว่จริง ดูรายละเอียดที่ callApi()
  //   ใน Shared.html ประกอบ) ทุกหน้าที่ไม่ใช่ login ต้องมี session ที่ถูกต้องเท่านั้น ไม่งั้นบังคับไปหน้า login เสมอ
  if (page !== 'login' && !session) {
    page = 'login';
  }

  if (page === 'login') {
    var loginTemplate = HtmlService.createTemplateFromFile(files['login']);
    loginTemplate.webAppUrl = getWebAppUrl_();
    loginTemplate.resetMode = mode;
    loginTemplate.resetToken = rtoken;
    return loginTemplate
      .evaluate()
      .setTitle('เข้าสู่ระบบ — SYY Shop Control')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var template = HtmlService.createTemplateFromFile(files[page] || 'index');
  template.webAppUrl = getWebAppUrl_();
  template.authToken = token;
  template.frameChannel = /^[A-Za-z0-9-]{16,80}$/.test(String(e.parameter.channel || "")) ? e.parameter.channel : "";
  template.userRole  = session.role;
  template.userName  = session.fullName || session.username;
  template.username  = session.username;
  template.resetMode  = mode;
  template.resetToken = rtoken;

  return template
    .evaluate()
    .setTitle('SYY Shop Control')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==========================================
// ตั้งค่า Project ID
// ==========================================
var PROJECT_ID = "syy-shop";

// ==========================================
// 2. Helper: Authorization Header
// ==========================================
function getAuthHeader_() {
  return {
    "Authorization": "Bearer " + ScriptApp.getOAuthToken(),
    "Content-Type" : "application/json"
  };
}

// ==========================================
// 2a. ★ รูปสินค้า — Google Drive (แทน Firebase Storage เดิม ซึ่งต้องอัปเกรดเป็น Blaze plan
//   ผูกบัตรเครดิตก่อนถึงจะเปิดใช้ได้ แม้จะอยู่ในโควตาฟรีก็ตาม — Drive ไม่ต้องผูกบัตรเลย และสิทธิ์
//   "https://www.googleapis.com/auth/drive" มีประกาศอยู่ใน appsscript.json แล้ว ไม่ต้องขอสิทธิ์เพิ่ม)
//   เก็บไฟล์จริงไว้ในโฟลเดอร์ Drive เดียว (สร้างอัตโนมัติครั้งแรก จำ folder id ไว้ใน Script Properties)
//   ตั้งชื่อไฟล์ตาม productCode เสมอ — อัปโหลดใหม่ = ลบไฟล์เก่าทิ้งก่อนแล้วสร้างไฟล์ใหม่ (ไม่ใช่แก้ไฟล์เดิม
//   เพราะ Drive file id เปลี่ยนทุกครั้งที่สร้างไฟล์ใหม่ — ได้ cache-busting ให้ฟรีในตัว ไม่ต้องแปะ ?t=)
//   ต่างจาก Storage เดิมตรงที่ Drive ไม่มี "path คงที่" ให้คำนวณ URL จาก productCode ตรงๆ ได้ (ต้องรู้
//   file id) จึงเก็บ URL ไว้ใน collection แยกต่างหาก "Product_Images" (1 doc/สินค้า คีย์ = productCode)
//   ไม่ยุ่งกับ Master_Products เลย — กัน saveProduct (ซึ่ง PATCH แบบไม่มี updateMask) ไปทับ/ลบทิ้งโดยไม่ตั้งใจ
// ==========================================
var PRODUCT_IMAGE_FOLDER_PROP_KEY = "PRODUCT_IMAGE_DRIVE_FOLDER_ID";
var PRODUCT_IMAGE_FOLDER_NAME     = "SYY Shop - Product Images";
var PRODUCT_IMAGES_COLLECTION     = "Product_Images";

function getProductImageFolder_() {
  var props    = PropertiesService.getScriptProperties();
  var folderId = props.getProperty(PRODUCT_IMAGE_FOLDER_PROP_KEY);
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) { /* โฟลเดอร์เดิมหายไปแล้ว สร้างใหม่ด้านล่าง */ }
  }
  var existing = DriveApp.getFoldersByName(PRODUCT_IMAGE_FOLDER_NAME);
  var folder   = existing.hasNext() ? existing.next() : DriveApp.createFolder(PRODUCT_IMAGE_FOLDER_NAME);
  props.setProperty(PRODUCT_IMAGE_FOLDER_PROP_KEY, folder.getId());
  return folder;
}

function normalizeProductImageData_(imageUrl, driveFileId, imageUrls, driveFileIds, primaryIndex) {
  var urls = Array.isArray(imageUrls) ? imageUrls.slice(0, 3) : [];
  var ids  = Array.isArray(driveFileIds) ? driveFileIds.slice(0, 3) : [];

  // Backward compatibility: เอกสารเดิมมีเพียง Image_Url / Drive_File_Id
  if (!urls.length && imageUrl) urls = [String(imageUrl)];
  if (!ids.length && driveFileId) ids = [String(driveFileId)];

  // ทำให้ URL/File ID เดินคู่กัน และไม่ปล่อย sparse array ลง Firestore
  var len = Math.min(3, Math.max(urls.length, ids.length));
  var pairs = [];
  for (var i = 0; i < len; i++) {
    var u = urls[i] ? String(urls[i]) : '';
    var id = ids[i] ? String(ids[i]) : '';
    // URL เป็นตัวกำหนดว่าช่องนี้มีรูปจริง ถ้าไม่มี URL ไม่เก็บ orphan metadata
    if (u) pairs.push({ url: u, id: id });
  }

  urls = pairs.map(function(p) { return p.url; });
  ids  = pairs.map(function(p) { return p.id; });
  primaryIndex = parseInt(primaryIndex, 10) || 0;
  primaryIndex = Math.max(0, Math.min(primaryIndex, Math.max(0, urls.length - 1)));

  return {
    urls: urls,
    ids: ids,
    primaryIndex: primaryIndex,
    primaryUrl: urls[primaryIndex] || urls[0] || '',
    primaryId: ids[primaryIndex] || ids[0] || ''
  };
}

function saveProductImageDoc_(productCode, imageUrl, driveFileId, imageUrls, driveFileIds, primaryIndex, expectedUpdateTime) {
  var data = normalizeProductImageData_(imageUrl, driveFileId, imageUrls, driveFileIds, primaryIndex);
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
          + "/databases/(default)/documents/" + PRODUCT_IMAGES_COLLECTION + "/" + encodeURIComponent(productCode);
  var payload = {
    Image_Url: data.primaryUrl,             // legacy compatibility
    Drive_File_Id: data.primaryId,          // legacy compatibility
    Image_Urls: data.urls,                  // V2 gallery, max 3
    Drive_File_Ids: data.ids,
    Primary_Index: data.primaryIndex
  };
  if (expectedUpdateTime === undefined) throw new Error("ต้องระบุเวอร์ชันข้อมูลรูปสินค้า");
  url += expectedUpdateTime ? "?currentDocument.updateTime="+encodeURIComponent(expectedUpdateTime) : "?currentDocument.exists=false";
  payload.Images_JSON = JSON.stringify(data.urls.map(function(url,i){return {url:url,fileId:data.ids[i]||""};}));
  var res = UrlFetchApp.fetch(url, {
    method: "patch",
    headers: getAuthHeader_(),
    payload: JSON.stringify({ fields: mapToFirestoreFields_(payload) }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('บันทึกข้อมูลรูปสินค้าไม่สำเร็จ (' + res.getResponseCode() + ')');
  }
  clearCollectionCache_(PRODUCT_IMAGES_COLLECTION);
  try {CacheService.getScriptCache().remove("pimgv2_"+productCode);}catch(e){}
  data.updateTime=JSON.parse(res.getContentText()).updateTime || "";
  return data;
}

function deleteProductImageDoc_(productCode, expectedUpdateTime) {
  if(expectedUpdateTime===undefined) throw new Error("ต้องระบุเวอร์ชันข้อมูลรูปสินค้า");
  if(!expectedUpdateTime) return;
  var url="https://firestore.googleapis.com/v1/"+fsDocPath_(PRODUCT_IMAGES_COLLECTION,productCode)+"?currentDocument.updateTime="+encodeURIComponent(expectedUpdateTime);
  var res=UrlFetchApp.fetch(url,{method:"delete",headers:getAuthHeader_(),muteHttpExceptions:true});
  if([200,204].indexOf(res.getResponseCode())<0) throw new Error("ลบข้อมูลรูปไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่");
  clearCollectionCache_(PRODUCT_IMAGES_COLLECTION);
  try{CacheService.getScriptCache().remove("pimgv2_"+productCode);}catch(e){}
}

// ★ อ่าน URL รูปของสินค้าทั้งหมดครั้งเดียวเป็น map ให้ getAllProducts() ใช้
// รองรับทั้ง schema เดิม (Image_Url) และ V2 gallery โดยไม่เพิ่ม N+1 reads
function getProductImageUrlMap_() {
  var map={};
  fetchCollectionDocsCached_(PRODUCT_IMAGES_COLLECTION).forEach(function(doc){
    var data=imageDataFromFields_(doc.fields);
    map[doc.id]={primary:data.primaryUrl,urls:data.urls,primaryIndex:data.primaryIndex,updateTime:doc.updateTime||""};
  });
  return map;
}

function getProductImageUrlSingle_(productCode) {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + PRODUCT_IMAGES_COLLECTION + "/" + encodeURIComponent(productCode);
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader_(), muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      var f = (JSON.parse(res.getContentText()).fields || {});
      var data = normalizeProductImageData_(
        parseFirestoreValue_(f.Image_Url),
        parseFirestoreValue_(f.Drive_File_Id),
        parseFirestoreValue_(f.Image_Urls),
        parseFirestoreValue_(f.Drive_File_Ids),
        parseFirestoreValue_(f.Primary_Index)
      );
      return data.primaryUrl;
    }
  } catch (e) {
    console.error("getProductImageUrlSingle_ error:", e);
  }
  return "";
}

/**
 * อ่าน metadata รูปสินค้าและ normalize schema เก่า → schema V2 ในหน่วยความจำ
 * จะเขียน V2 ลง Firestoreเมื่อผู้ใช้แก้ไขรูปจริงเท่านั้น (lazy migration)
 */
function getProductImageDocData_(productCode) {
  var url="https://firestore.googleapis.com/v1/"+fsDocPath_(PRODUCT_IMAGES_COLLECTION,productCode);
  var res=UrlFetchApp.fetch(url,{method:"get",headers:getAuthHeader_(),muteHttpExceptions:true});
  if(res.getResponseCode()===404) return {urls:[],ids:[],primaryIndex:0,updateTime:""};
  if(res.getResponseCode()!==200) throw new Error("อ่านข้อมูลรูปสินค้าไม่สำเร็จ กรุณาลองใหม่");
  var doc=JSON.parse(res.getContentText()),data=imageDataFromFields_(doc.fields);
  if(!doc.updateTime) throw new Error("ไม่พบเวอร์ชันข้อมูลรูปสินค้า");
  data.updateTime=doc.updateTime;
  return data;
}

function uploadProductImage_(productCode, base64Data, slot) {
  try {
    var cur=getProductImageDocData_(productCode),items=cur.urls.map(function(url){return {url:url};});
    slot=slot==null ? items.length : Number(slot);
    if(!Number.isInteger(slot)||slot<0||slot>items.length||slot>=3) throw new Error("ตำแหน่งรูปไม่ถูกต้อง");
    items[slot]={base64:base64Data};
    return commitProductImageDraft_(productCode,{items:items,primaryIndex:cur.primaryIndex,expectedUpdateTime:cur.updateTime});
  } catch(e) {return {success:false,message:e.message};}
}

function deleteProductImage_(productCode, slot) {
  try {
    var cur=getProductImageDocData_(productCode),items=cur.urls.map(function(url){return {url:url};}), primary=cur.primaryIndex;
    if(slot==null||slot==="") items=[];
    else {
      slot=Number(slot); if(!Number.isInteger(slot)||slot<0||slot>=items.length) throw new Error("ไม่พบรูปที่ต้องการลบ");
      items.splice(slot,1); if(primary===slot) primary=0; else if(primary>slot) primary--;
    }
    return commitProductImageDraft_(productCode,{items:items,primaryIndex:primary,expectedUpdateTime:cur.updateTime});
  }catch(e){return {success:false,message:e.message};}
}

function setPrimaryProductImage_(productCode, slot) {
  try{
    var cur=getProductImageDocData_(productCode);slot=Number(slot);
    if(!Number.isInteger(slot)||slot<0||slot>=cur.urls.length) throw new Error("ไม่พบรูป");
    return commitProductImageDraft_(productCode,{items:cur.urls.map(function(url){return {url:url};}),primaryIndex:slot,expectedUpdateTime:cur.updateTime});
  }catch(e){return {success:false,message:e.message};}
}


function moveProductImage_(productCode, fromSlot, toSlot) {
  try {
    productCode = String(productCode || "").trim();
    if (!productCode) return { success: false, message: "ไม่พบรหัสสินค้า" };
    var cur = getProductImageDocData_(productCode);
    fromSlot = parseInt(fromSlot, 10);
    toSlot = parseInt(toSlot, 10);
    if (isNaN(fromSlot) || isNaN(toSlot)) return { success: false, message: "ตำแหน่งรูปไม่ถูกต้อง" };
    if (fromSlot < 0 || toSlot < 0 || fromSlot >= cur.urls.length || toSlot >= cur.urls.length) {
      return { success: false, message: "ตำแหน่งรูปอยู่นอกช่วง" };
    }
    if (fromSlot === toSlot) {
      var same = normalizeProductImageData_("", "", cur.urls, cur.ids, cur.primaryIndex);
      return { success: true, imageUrl: same.primaryUrl, imageUrls: same.urls, primaryIndex: same.primaryIndex };
    }

    var oldPrimary = cur.primaryIndex;
    var movedUrl = cur.urls.splice(fromSlot, 1)[0];
    var movedId = cur.ids.splice(fromSlot, 1)[0] || "";
    cur.urls.splice(toSlot, 0, movedUrl);
    cur.ids.splice(toSlot, 0, movedId);

    if (oldPrimary === fromSlot) cur.primaryIndex = toSlot;
    else if (fromSlot < oldPrimary && toSlot >= oldPrimary) cur.primaryIndex = oldPrimary - 1;
    else if (fromSlot > oldPrimary && toSlot <= oldPrimary) cur.primaryIndex = oldPrimary + 1;

    return commitProductImageDraft_(productCode,{items:cur.urls.map(function(url){return {url:url};}),primaryIndex:cur.primaryIndex,expectedUpdateTime:cur.updateTime});
  } catch (e) {
    return { success: false, message: e.message };
  }
}


/**
 * Phase A: บันทึก Product Gallery จาก draft ฝั่ง browser ครั้งเดียวตอนกดบันทึกสินค้า
 * - ไม่เปลี่ยน schema Product_Images เดิม
 * - รูปเดิมที่ยังถูกอ้างอิงจะ reuse URL/File ID เดิม
 * - รูปใหม่สร้างใน Drive ก่อน แล้วค่อยเขียน metadata; ถ้า metadata ล้มเหลวจะ trash ไฟล์ใหม่
 * - ไฟล์เดิมที่ผู้ใช้ลบออกจะ trash หลัง metadata สำเร็จเท่านั้น
 */
function commitProductImageDraft_(productCode, draft) {
  var newFileIds = [], lock=LockService.getScriptLock();
  if(!lock.tryLock(10000)) return {success:false,message:"ระบบกำลังบันทึกรูป กรุณาลองใหม่"};
  try {
    productCode = String(productCode || "").trim();
    if (!productCode) return { success: false, message: "ไม่พบรหัสสินค้า" };
    draft = draft || {};
    var items = Array.isArray(draft.items) ? draft.items.slice(0, 3) : [];
    readExistingDocument_("Master_Products",productCode);
    var cur = getProductImageDocData_(productCode);
    if(draft.expectedUpdateTime===undefined || String(draft.expectedUpdateTime||"")!==cur.updateTime) throw new Error("รูปสินค้าเปลี่ยนแปลงแล้ว กรุณาปิดฟอร์มและรีเฟรชก่อนแก้ไขรูป");
    if(!Array.isArray(draft.items) || draft.items.length>3) throw new Error("เพิ่มรูปได้สูงสุด 3 รูป");
    var oldByUrl = {};
    cur.urls.forEach(function(url, i) { if (url) oldByUrl[url] = cur.ids[i] || ""; });

    var folder = null, urls = [], ids = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var existingUrl = String(it.url || "").trim();
      var base64 = String(it.base64 || "").trim();
      if (base64) {
        var bytes = Utilities.base64Decode(base64);
        if (bytes.length > 5 * 1024 * 1024) throw new Error("ไฟล์รูปใหญ่เกิน 5MB หลังประมวลผล");
        if (!(bytes.length > 3 && (bytes[0] & 255) === 255 && (bytes[1] & 255) === 216 && (bytes[2] & 255) === 255)) {
          throw new Error("รูปหลังประมวลผลไม่ใช่ JPEG ที่ถูกต้อง");
        }
        if (!folder) folder = getProductImageFolder_();
        var file = folder.createFile(Utilities.newBlob(bytes, "image/jpeg", productCode + "_" + (i + 1) + ".jpg"));
        newFileIds.push(file.getId());
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        var fileId = file.getId();
        urls.push("https://lh3.googleusercontent.com/d/" + fileId);
        ids.push(fileId);

      } else if (existingUrl && Object.prototype.hasOwnProperty.call(oldByUrl, existingUrl)) {
        urls.push(existingUrl);
        ids.push(oldByUrl[existingUrl]);
      } else {throw new Error("รูปเดิมไม่ตรงกับข้อมูลล่าสุด กรุณารีเฟรช");}
    }

    var primaryIndex = Math.max(0, Math.min(parseInt(draft.primaryIndex, 10) || 0, Math.max(0, urls.length - 1)));
    var saved;
    try {
      if (!urls.length) {
        deleteProductImageDoc_(productCode,cur.updateTime);
        saved = { primaryUrl: "", urls: [], ids: [], primaryIndex: 0 };
      } else {
        saved = saveProductImageDoc_(productCode, "", "", urls, ids, primaryIndex,cur.updateTime);
      }
    } catch (saveErr) {
      trashUnreferencedImageFiles_(productCode,newFileIds);
      throw saveErr;
    }

    var retained = {};
    (saved.ids || ids).forEach(function(id) { if (id) retained[id] = true; });
    trashUnreferencedImageFiles_(productCode,cur.ids);
    return {
      success: true,
      imageUrl: saved.primaryUrl || "",
      imageUrls: (saved.urls || []).slice(0, 3),
      imageUpdateTime:saved.updateTime || "",
      primaryIndex: saved.primaryIndex || 0
    };
  } catch (e) {
    trashUnreferencedImageFiles_(productCode,newFileIds);
    return { success: false, message: e.message };
  } finally {lock.releaseLock();}
}

// ==========================================
// 2b. ★ Cache Layer — ลด Firestore Reads (Firebase Spark Plan / Free Quota)
// ==========================================
var CACHE_TTL_SECONDS = 21600;
var CACHEABLE_COLLECTIONS = [
  "Master_Brands", "Master_Categories", "Master_Vendors", "Master_Zones", "Master_Cars",
  "Master_Customers", "Master_Products", "Product_Images", "Master_Users"
];
var CACHE_CHUNK_MAX_BYTES = 80000;

function cacheTtlForCollection_(collectionName) {
  if (collectionName === "Master_Products") return 900;      // 15 นาที + invalidate ทุก write
  if (collectionName === "Product_Images") return 1800;     // 30 นาที + invalidate ทุก write
  if (collectionName === "Master_Customers") return 3600;   // 1 ชั่วโมง + invalidate ทุก write
  return CACHE_TTL_SECONDS;
}

function collectionCacheBaseKey_(collectionName) {return 'docs_v3_'+collectionName;}

function splitCollectionCacheChunks_(docs) {
  docs = docs || [];
  if (!docs.length) return ["[]"];
  var chunks = [], parts = [], bytes = 2; // [ ]
  for (var i = 0; i < docs.length; i++) {
    var piece = JSON.stringify(docs[i]);
    var pieceBytes = Utilities.newBlob(piece).getBytes().length;
    if (pieceBytes + 2 > 95000) return null; // single document too large for CacheService
    var separatorBytes = parts.length ? 1 : 0;
    if (parts.length && bytes + separatorBytes + pieceBytes > CACHE_CHUNK_MAX_BYTES) {
      chunks.push("[" + parts.join(",") + "]");
      parts = []; bytes = 2; separatorBytes = 0;
    }
    parts.push(piece);
    bytes += separatorBytes + pieceBytes;
  }
  if (parts.length) chunks.push("[" + parts.join(",") + "]");
  return chunks;
}

function readCollectionCache_(collectionName) {
  if(CACHEABLE_COLLECTIONS.indexOf(collectionName)<0)return null;
  try {
    var generation=collectionGeneration_(collectionName),cache=CacheService.getScriptCache(),base=collectionCacheBaseKey_(collectionName);
    if(cache.get(base+'__disabled'))return null;var raw=cache.get(base+'__manifest');if(!raw)return null;
    var manifest=JSON.parse(raw);if(manifest.generation!==generation || !manifest.id || manifest.count<1 || manifest.count>=500)return null;
    var keys=[];for(var i=0;i<manifest.count;i++)keys.push(base+'__'+manifest.id+'__'+i);
    var chunks=cache.getAll(keys),docs=[];
    for(var j=0;j<keys.length;j++){if(!chunks[keys[j]])return null;docs=docs.concat(JSON.parse(chunks[keys[j]]));}
    return collectionGeneration_(collectionName)===generation?docs:null;
  }catch(e){return null;}
}

function writeCollectionCache_(collectionName,docs,expectedGeneration) {
  if(CACHEABLE_COLLECTIONS.indexOf(collectionName)<0)return false;
  try {
    var generation=expectedGeneration===undefined?collectionGeneration_(collectionName):expectedGeneration;
    var chunks=splitCollectionCacheChunks_(docs||[]);if(!chunks || chunks.length>=500 || collectionGeneration_(collectionName)!==generation)return false;
    var cache=CacheService.getScriptCache(),base=collectionCacheBaseKey_(collectionName),id=Utilities.getUuid(),values={},ttl=cacheTtlForCollection_(collectionName);
    if(cache.get(base+'__disabled'))return false;chunks.forEach(function(chunk,i){values[base+'__'+id+'__'+i]=chunk;});
    cache.putAll(values,ttl);
    if(cache.get(base+'__disabled')||collectionGeneration_(collectionName)!==generation)return false;
    cache.put(base+'__manifest',JSON.stringify({generation:generation,id:id,count:chunks.length}),ttl);
    return !cache.get(base+'__disabled')&&collectionGeneration_(collectionName)===generation;
  }catch(e){return false;}
}

function peekCollectionDocsCache_(collectionName) {
  return readCollectionCache_(collectionName);
}

function queryByEqualityField_(collectionName, fieldPath, value) {
  var docs = [];
  try {
    var query = {
      structuredQuery: {
        from  : [{ collectionId: collectionName }],
        where : { fieldFilter: { field: { fieldPath: fieldPath }, op: "EQUAL", value: { stringValue: String(value) } } },
        limit : 10
      }
    };
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents:runQuery";
    var res = UrlFetchApp.fetch(url, {
      method: "post", headers: getAuthHeader_(), payload: JSON.stringify(query), muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) throw new Error("โหลดข้อมูลไม่สำเร็จ (" + res.getResponseCode() + ")");
    if (res.getResponseCode() === 200) {
      (JSON.parse(res.getContentText()) || []).forEach(function(row) {
        if (row.document) docs.push({ id: row.document.name.split('/').pop(), fields: row.document.fields || {},updateTime:row.document.updateTime||"" });
      });
    } else {
      console.error("queryByEqualityField_ " + collectionName + "." + fieldPath + " HTTP " + res.getResponseCode());
    }
  } catch (e) { console.error("queryByEqualityField_ read failed", e); throw e; }
  return docs;
}

function fetchAllPagesRaw_(collectionName, firstPageJson) {
  var docs = [], pageToken = "", guard = 0, json = firstPageJson || null;
  try {
    do {
      if (!json) {
        var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
                + "/databases/(default)/documents/" + collectionName + "?pageSize=300"
                + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
        var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader_(), muteHttpExceptions: true });
        if (res.getResponseCode() !== 200) {
          console.error("fetchAllPagesRaw " + collectionName + " HTTP " + res.getResponseCode());
          return { ok: false, docs: [] };
        }
        json = JSON.parse(res.getContentText());
      }
      (json.documents || []).forEach(function(doc) {
        docs.push({ id: doc.name.split('/').pop(), fields: doc.fields || {}, updateTime:doc.updateTime || "" });
      });
      pageToken = json.nextPageToken || "";
      json = null;
      guard++;
    } while (pageToken && guard < 50);
  } catch (e) {
    console.error("fetchAllPagesRaw error:", e);
    return { ok: false, docs: [] };
  }
  return { ok: !pageToken, docs: pageToken ? [] : docs };
}

function fetchCollectionsParallel_(collectionNames) {
  var result = {}, toFetch = [], requests = [], generations = {};
  collectionNames.forEach(function(name) {
    var cached = readCollectionCache_(name);
    if (cached !== null) { result[name] = cached; return; }
    generations[name]=collectionGeneration_(name);
    toFetch.push(name);
    requests.push({
      url: "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
         + "/databases/(default)/documents/" + name + "?pageSize=300",
      method: "get", headers: getAuthHeader_(), muteHttpExceptions: true
    });
  });
  if (!requests.length) return result;
  try {
    var responses = UrlFetchApp.fetchAll(requests);
    responses.forEach(function(res, i) {
      var name = toFetch[i];
      if (res.getResponseCode() !== 200) throw new Error("โหลด " + name + " ไม่สำเร็จ");
      var first = JSON.parse(res.getContentText());
      // ใช้ first page เดิมต่อทันที ไม่อ่าน 300 docs หน้าแรกซ้ำเมื่อมี pagination
      var fetched = fetchAllPagesRaw_(name, first);
      if (!fetched.ok) throw new Error("โหลด " + name + " ไม่ครบ");
      if(collectionGeneration_(name)!==generations[name]){result[name]=fetchCollectionDocsCached_(name);return;}
      var docs = fetched.docs;
      result[name] = docs;
      if (fetched.ok) writeCollectionCache_(name, docs, generations[name]);
      if(collectionGeneration_(name)!==generations[name])result[name]=fetchCollectionDocsCached_(name);
    });
  } catch (e) {
    console.error("fetchCollectionsParallel error:", e);
    throw e;
  }
  return result;
}

function fetchCollectionDocsCached_(collectionName) {
  var cached=readCollectionCache_(collectionName);if(cached!==null)return cached;
  for(var attempt=0;attempt<2;attempt++){
    var generation=collectionGeneration_(collectionName),fetched=fetchAllPagesRaw_(collectionName);
    if(!fetched.ok)throw new Error('โหลด '+collectionName+' ไม่สำเร็จ กรุณาลองใหม่');
    if(collectionGeneration_(collectionName)!==generation)continue;
    writeCollectionCache_(collectionName,fetched.docs,generation);
    if(collectionGeneration_(collectionName)===generation)return fetched.docs;
  }
  throw new Error('ข้อมูลกำลังเปลี่ยนแปลง กรุณารีเฟรชอีกครั้ง');
}

function clearCollectionCache_(collectionName){
 if(CACHEABLE_COLLECTIONS.indexOf(collectionName)<0)return true;
 var cache=CacheService.getScriptCache(),base=collectionCacheBaseKey_(collectionName),disabled=base+'__disabled';
 try{cache.put(disabled,'1',21600);}catch(e){}
 var changed=false;try{PropertiesService.getScriptProperties().setProperty('cache_gen_'+collectionName,Utilities.getUuid());changed=true;}catch(e){console.error('Cache generation unavailable; bypass collection cache',collectionName);}
 try{var raw=cache.get(base+'__manifest'),keys=[base,base+'__manifest'];if(raw){var m=JSON.parse(raw);for(var i=0;i<m.count&&i<500;i++)keys.push(base+'__'+m.id+'__'+i);}cache.removeAll(keys);if(changed)cache.remove(disabled);}catch(e){}
 // Business write already succeeded; never tell the caller to repeat it after a cache failure.
 return changed;
}

// ==========================================
// 3. ระบบรันเลข ID อัตโนมัติ
// ==========================================

// ★ FIX: เลขที่เอกสาร (เลขที่ใบกำกับภาษี/ใบเสนอราคา) เดิมคำนวณด้วยการอ่านเลขสูงสุดที่มีอยู่แล้ว +1
//   แล้วเขียนเป็น field ธรรมดา — Firestore ไม่ได้บังคับว่าค่า field ต้องไม่ซ้ำกัน ต่างจาก document ID
//   ที่บังคับไม่ซ้ำอยู่แล้วโดยตัว Firestore เอง (saveMasterData ใช้ประโยชน์จากตรงนี้อยู่แล้วตอนกัน
//   docId ชนกัน) ถ้า 2 คำขอบันทึกพร้อมกันพอดี ทั้งคู่จะคำนวณเลขเดียวกันได้ (เลขที่ใบกำกับภาษีซ้ำ
//   มีผลทางบัญชี/สรรพากรจริง) — ฟังก์ชันนี้ใช้หลักการเดียวกับ getNextAutoId (อาศัย document ID
//   ที่ Firestore บังคับไม่ซ้ำ) มา "จอง" เลขที่แบบ atomic ก่อนเขียนเอกสารจริง
//   คืน true = จองสำเร็จ (เลขนี้ยังไม่มีใครใช้), false = มีคนจองเลขนี้ไปก่อนแล้ว (409) ต้องลองเลขถัดไป
var DOC_NO_RESERVATION_COLLECTION = "Doc_No_Reservations";
function reserveDocNo_(docType, docNoValue) {
  var safeId = docType + "__" + String(docNoValue).replace(/[^A-Za-z0-9]/g, "_");
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
          + "/databases/(default)/documents/" + DOC_NO_RESERVATION_COLLECTION
          + "?documentId=" + encodeURIComponent(safeId);
  var res = UrlFetchApp.fetch(url, {
    method            : "post",
    headers           : getAuthHeader_(),
    payload           : JSON.stringify({
      fields: {
        Doc_No      : { stringValue: String(docNoValue) },
        Reserved_At : { stringValue: new Date().toISOString() }
      }
    }),
    muteHttpExceptions: true
  });
  if(res.getResponseCode()===200)return true;
  if(res.getResponseCode()===409)return false;
  throw new Error('จองเลขเอกสารไม่สำเร็จ กรุณาลองใหม่ภายหลัง');
}

// ★ FIX (โควตา Firestore Reads): ก่อนหน้านี้ "เลขถัดไปของเดือนนี้" (getNextInvoiceRunningNumber/
//   getNextQuoteRunningNumber) คำนวณด้วยการสแกนทั้ง collection Master_Tax_Invoice/Quotation ทุกครั้ง
//   ที่บันทึก 1 ใบ — และถูกเรียกซ้ำในลูป retry สูงสุด 10 รอบ (เผื่อเลขชน) ทำให้ 1 ใบอาจอ่านทั้งประวัติ
//   ซ้ำได้ถึง 10 รอบ สองตารางนี้โตไม่จำกัดตลอดอายุร้านและถูกเขียนบ่อยที่สุดในระบบ จึงเป็นตัวกินโควตา
//   Reads มากที่สุด — เปลี่ยนมาใช้ "ตัวนับ" แบบเอกสารเดียวต่อเดือน (Doc_Running_Numbers) แทน:
//     - เดือนที่มีตัวนับอยู่แล้ว (ใช้งานปกติ 29-30 วันจาก 30 วัน): อ่าน 1 ครั้ง + เขียน 1 ครั้งต่อใบ
//       แทนการสแกนทั้ง collection
//     - เดือนแรกที่ยังไม่เคยมีตัวนับ (เอกสารแรกของเดือน หรือเดือนแรกที่เริ่มใช้ระบบนี้): สแกนครั้งเดียว
//       ผ่าน seedFn (คือฟังก์ชัน getNextInvoiceRunningNumber/getNextQuoteRunningNumber เดิม ยังเก็บไว้
//       ไม่ลบ) เพื่อตั้งต้นตัวนับให้ตรงกับเลขสูงสุดที่เคยออกไปแล้วจริง กันเลขชนกับของเก่า — หลังจากนั้น
//       เดือนเดียวกันจะไม่สแกนซ้ำอีกเลย
//   reserveDocNo_ ยังคงเป็นตัวกันชนสุดท้ายเหมือนเดิม (defense-in-depth) เผื่อกรณีนอกเหนือคาดคิด
var RUNNING_NUMBER_COLLECTION = "Doc_Running_Numbers";
function nextRunningNumber_(docType, periodKey, seedFn) {
  var docId  = docType + "_" + periodKey;
  var getUrl = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
             + "/databases/(default)/documents/" + RUNNING_NUMBER_COLLECTION + "/" + docId;

  for (var attempt = 0; attempt < 5; attempt++) {
    var getRes = UrlFetchApp.fetch(getUrl, { method: "get", headers: getAuthHeader_(), muteHttpExceptions: true });

    if (getRes.getResponseCode() === 200) {
      // ตัวนับของเดือนนี้มีอยู่แล้ว — increment แบบผูก precondition กับ updateTime ที่เพิ่งอ่านมา
      // กันสองคำขอพร้อมกันอ่านค่าเดิมแล้วเขียนทับกัน (ใครมาทีหลัง precondition จะไม่ตรง ต้องวนใหม่)
      var doc     = JSON.parse(getRes.getContentText());
      var current = parseInt(parseFirestoreValue_((doc.fields || {}).Value) || 0, 10);
      var next    = current + 1;
      var commit  = fsCommit_([{
        update: {
          name  : fsDocPath_(RUNNING_NUMBER_COLLECTION, docId),
          fields: { Value: { integerValue: String(next) } }
        },
        updateMask      : { fieldPaths: ["Value"] },
        currentDocument  : { updateTime: doc.updateTime }
      }]);
      if (commit.ok) return next;
      if (!isPreconditionFailure_(commit.message)) {
        console.error("nextRunningNumber_ commit error:", commit.message);
        return null; // Do not reserve a number after a failed counter write.
      }
      continue; // ชนกับคนอื่นที่ increment พร้อมกันพอดี — วนอ่าน-เขียนใหม่
    }

    if (getRes.getResponseCode() === 404) {
      // ยังไม่เคยมีตัวนับของเดือนนี้ — ตั้งต้นด้วยเลขสูงสุดที่เคยออกไปแล้วจริง (สแกนครั้งเดียว)
      var seeded    = (seedFn ? seedFn() : 0) || 1;
      var createRes = UrlFetchApp.fetch(
        "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
          + "/databases/(default)/documents/" + RUNNING_NUMBER_COLLECTION
          + "?documentId=" + encodeURIComponent(docId),
        {
          method: "post", headers: getAuthHeader_(), muteHttpExceptions: true,
          payload: JSON.stringify({ fields: { Value: { integerValue: String(seeded) } } })
        }
      );
      if (createRes.getResponseCode() === 200) return seeded;
      if(createRes.getResponseCode()!==409)return null;
      continue; // สร้างไม่สำเร็จ (409 = มีคนสร้างตัวนับของเดือนนี้ไปพร้อมกันพอดี) — วนไปอ่าน/increment ใหม่จากบนสุด
    }

    console.error("nextRunningNumber_ GET HTTP " + getRes.getResponseCode() + ": " + getRes.getContentText());
    return null; // Caller fails safely without rescanning history.
  }
  return null;
}

function getNextAutoId_(collectionName, prefix, forceFresh) {
  try {
    var docs = forceFresh ? fetchAllPagesRaw_(collectionName).docs
                          : fetchCollectionDocsCached_(collectionName);
    var maxNum = 0;
    docs.forEach(function(doc) {
      var numStr = doc.id.startsWith(prefix) ? doc.id.substring(prefix.length) : "";
      if (/^\d+$/.test(numStr)) {
        var num = parseInt(numStr, 10);
        if (num > maxNum) maxNum = num;
      }
    });
    return prefix + (maxNum + 1).toString().padStart(4, '0');
  } catch (e) {
    console.error("getNextAutoId error:", e);
    return prefix + "0001";
  }
}


function autoIdSequenceKey_(collectionName, prefix) {
  return "AUTO_ID_SEQ__" + String(collectionName).replace(/[^A-Za-z0-9_]/g, "_")
       + "__" + String(prefix).replace(/[^A-Za-z0-9_]/g, "_");
}

function allocateNextAutoId_(collectionName, prefix, forceReseed) {
  var lock = LockService.getScriptLock();
  var ownsLock=!referenceMutationLocked_;if(ownsLock)lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var key = autoIdSequenceKey_(collectionName, prefix);
    var current = forceReseed ? NaN : parseInt(props.getProperty(key), 10);
    if (isNaN(current)) {
      var seededNext = getNextAutoId_(collectionName, prefix, true);
      var seededDigits = String(seededNext).substring(String(prefix).length);
      current = /^\d+$/.test(seededDigits) ? Math.max(0, parseInt(seededDigits, 10) - 1) : 0;
    }
    current++;
    props.setProperty(key, String(current));
    return prefix + String(current).padStart(4, '0');
  } finally {
    try { if(ownsLock)lock.releaseLock(); } catch (e) {}
  }
}

// ==========================================
// 4. แปลงข้อมูลเป็น Firestore Format
// ==========================================
var FORCE_STRING_FIELDS = ["Part_Number", "Product_Name", "Brand_Name", "Category_Name",
                            "Vendor_name", "Phone", "Area", "Build", "Floor", "Rack_no", "Rack_Level",
                            "Tax_ID", "Branch", "Invoice_No", "Buyer_Tax_ID", "Buyer_Branch",
                            "Customer_Name", "Address_No", "Address_Moo", "Address_Road",
                            "Subdistrict", "District", "Province", "Postal_Code", "Invoice_Date",
                            "Quote_No", "Customer_Tax_ID", "Customer_Phone", "Customer_Branch",
                            "Customer_PO", "Quote_Date", "Valid_Until", "Barcode"];

function mapToFirestoreFields_(dataObject) {
  var fields = {};
  for (var key in dataObject) {
    if (!dataObject.hasOwnProperty(key)) continue;
    var val = dataObject[key];

    if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.filter(function(v) { return v !== null && v !== undefined && v !== ""; })
                      .map(function(v) { return { stringValue: String(v) }; })
        }
      };
      continue;
    }

    if (val !== null && typeof val === 'object') {
      val = JSON.stringify(val);
    }

    if (FORCE_STRING_FIELDS.indexOf(key) > -1) {
      fields[key] = { "stringValue": String(val != null ? val : "") };
      continue;
    }

    var isNumber = (typeof val === 'number' && !isNaN(val))
                || (typeof val === 'string' && val.trim() !== "" && !isNaN(Number(val)));
    if (isNumber && typeof val !== 'boolean') {
      fields[key] = { "doubleValue": parseFloat(val) };
    } else {
      fields[key] = { "stringValue": String(val != null ? val : "") };
    }
  }
  return fields;
}

// ==========================================
// 5. Helper: แปลง Firestore field value → JS value
// ==========================================
function parseFirestoreValue_(f) {
  if (!f) return "";
  if (f.stringValue  !== undefined) return f.stringValue;
  if (f.doubleValue  !== undefined) return parseFloat(f.doubleValue);
  if (f.integerValue !== undefined) return parseInt(f.integerValue, 10);
  if (f.booleanValue !== undefined) return f.booleanValue;
  if (f.arrayValue   !== undefined) {
    return (f.arrayValue.values || []).map(parseFirestoreValue_);
  }
  return "";
}

// ==========================================
// 6. ดึงรายการ Master (Dropdown + เช็คซ้ำ)
// ==========================================
function getFirestoreRawList_(collectionName) {
  var list = [];
  try {
    var docs = fetchCollectionDocsCached_(collectionName);
    docs.forEach(function(doc) {
      var f = doc.fields || {};
      var displayName =
          (f.Customer_Name ? f.Customer_Name.stringValue : null) ||
          (f.Brand_Name    ? f.Brand_Name.stringValue    : null) ||
          (f.Category_Name ? f.Category_Name.stringValue : null) ||
          (f.Vendor_name   ? f.Vendor_name.stringValue   : null) ||
          (f.Area          ? f.Area.stringValue          : null) ||
          (f.Product_Name  ? f.Product_Name.stringValue  : null) || "";

      list.push({
        id        : doc.id,
        updateTime:doc.updateTime||"",
        Name      : displayName.trim(),
        name      : normalizedDuplicateKey_(displayName)
      });
    });
  } catch (e) { console.error("getFirestoreRawList_ read failed", e); throw e; }
  return list;
}

// ==========================================
// 7. ลบเอกสาร
// ==========================================
function deleteFirestoreDocument_(collectionName,docId) {
  if(!referenceMutationLocked_)return withReferenceMutationLock_(function(){return deleteFirestoreDocument_(collectionName,docId);});
  try {
    var document=readExistingDocument_(collectionName,docId);assertDeleteAllowed_(collectionName,docId,document);
    var url='https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents/'+collectionName+'/'+encodeURIComponent(docId)+'?currentDocument.updateTime='+encodeURIComponent(document.updateTime);
    var res=UrlFetchApp.fetch(url,{method:'delete',headers:getAuthHeader_(),muteHttpExceptions:true});
    if(res.getResponseCode()!==200)return {success:false,message:'ลบไม่สำเร็จหรือข้อมูลเปลี่ยนแปลงแล้ว กรุณารีเฟรชก่อนลองใหม่'};
    clearCollectionCache_(collectionName);return {success:true,title:'สำเร็จ',message:'ลบข้อมูลเรียบร้อย'};
  }catch(e){return {success:false,title:'ลบไม่ได้',message:e.message};}
}

// ==========================================
// 8. บันทึก / อัปเดต ข้อมูล (UPSERT)
// ==========================================
function saveMasterData_(collectionName, prefix, docId, dataObject, checkDuplicateName, editOptions) {
  try {
    dataObject=Object.assign({},dataObject);
    var expected=dataObject._expectedUpdateTime;delete dataObject._expectedUpdateTime;
    if(docId && !editOptions){
      var existing=readExistingDocument_(collectionName,docId);
      if(expected && expected!==existing.updateTime)return {success:false,title:'ข้อมูลเปลี่ยนแปลง',message:'ข้อมูลถูกแก้ไขแล้ว กรุณารีเฟรชก่อนบันทึก'};
      editOptions={updateTime:existing.updateTime};
    }
    if (checkDuplicateName) {
      var field={Master_Brands:'Brand_Name',Master_Categories:'Category_Name',Master_Vendors:'Vendor_name',Master_Customers:'Customer_Name'}[collectionName];
      if(field && hasNormalizedDuplicate_(collectionName,field,checkDuplicateName,docId))return {success:false,title:'ข้อมูลซ้ำ!',message:'ชื่อนี้มีในระบบแล้ว'};
      var list        = field ? [] : getFirestoreRawList_(collectionName);
      var compareName = normalizedDuplicateKey_(checkDuplicateName);
      var isDuplicate = list.some(function(item) {
        return item.name === compareName && item.id !== docId;
      });
      if (isDuplicate) {
        return { success: false, title: "ข้อมูลซ้ำ!", message: 'ชื่อ "' + checkDuplicateName + '" มีในระบบแล้ว' };
      }
    }

    var payload = { fields: mapToFirestoreFields_(dataObject) };

    if (!docId) {
      var newId  = allocateNextAutoId_(collectionName, prefix, false);
      var lastErr = "";

      for (var attempt = 0; attempt < 10; attempt++) {
        var createUrl = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
                      + "/databases/(default)/documents/" + collectionName
                      + "?documentId=" + encodeURIComponent(newId);
        var createRes = UrlFetchApp.fetch(createUrl, {
          method            : "post",
          headers           : getAuthHeader_(),
          payload           : JSON.stringify(payload),
          muteHttpExceptions: true
        });

        var code = createRes.getResponseCode();
        if (code === 200) {
          clearCollectionCache_(collectionName);
          if(collectionName===AUTH_USERS_COLLECTION)CacheService.getScriptCache().remove("auth_legacy_index_"+PROJECT_ID);
          return { success: true, title: "สำเร็จ", message: "บันทึกข้อมูลเรียบร้อย", id: newId, data: dataObject, updateTime:JSON.parse(createRes.getContentText()).updateTime||"" };
        }
        if (code === 409) {
          newId = allocateNextAutoId_(collectionName, prefix, attempt === 0);
          continue;
        }
        lastErr = createRes.getContentText();
        break;
      }
      return { success: false, title: "ล้มเหลว", message: lastErr || "ไม่สามารถสร้างรหัสใหม่ได้ กรุณาลองอีกครั้ง" };
    }

    var id  = docId;
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + collectionName + "/" + id;

    if (editOptions) {
      var params = (editOptions.fieldPaths || Object.keys(dataObject)).map(function(field) {
        return "updateMask.fieldPaths=" + encodeURIComponent(field);
      });
      params.push(editOptions.updateTime
        ? "currentDocument.updateTime=" + encodeURIComponent(editOptions.updateTime)
        : "currentDocument.exists=true");
      url += "?" + params.join("&");
    }

    var res = UrlFetchApp.fetch(url, {
      method            : "patch",
      headers           : getAuthHeader_(),
      payload           : JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() === 200) {
      clearCollectionCache_(collectionName);
      return { success: true, title: "สำเร็จ", message: "บันทึกข้อมูลเรียบร้อย", id: id, data: dataObject, updateTime:JSON.parse(res.getContentText()).updateTime||"" };
    }
    if (editOptions && /FAILED_PRECONDITION|NOT_FOUND/.test(res.getContentText())) {
      return { success: false, title: "ข้อมูลเปลี่ยนแปลง", message: "ข้อมูลถูกแก้ไขหรือลบโดยผู้ใช้อื่น กรุณารีเฟรชและตรวจสอบก่อนบันทึกอีกครั้ง" };
    }
    return { success: false, title: "ล้มเหลว", message: res.getContentText() };
  } catch (e) {
    return { success: false, title: "ข้อผิดพลาด", message: e.message };
  }
}

function bumpAutoId_(currentId, prefix) {
  var numStr = String(currentId).indexOf(prefix) === 0 ? String(currentId).substring(prefix.length) : "";
  var num    = /^\d+$/.test(numStr) ? parseInt(numStr, 10) : 0;
  var width  = numStr.length || 4;
  return prefix + (num + 1).toString().padStart(width, '0');
}

function buildMapFromDocs_(docs, nameField) {
  var map = {};
  (docs || []).forEach(function(doc) {
    var f = doc.fields || {};
    map[doc.id] = f[nameField] ? parseFirestoreValue_(f[nameField]) : doc.id;
  });
  return map;
}

function buildZoneMapFromDocs_(docs) {
  var map = {};
  (docs || []).forEach(function(doc) {
    var f     = doc.fields || {};
    var label = zoneDisplayLabel_(f, doc.id);
    map[doc.id] = label || doc.id;
  });
  return map;
}

function zoneDisplayLabel_(f, id) {
  var area = parseFirestoreValue_(f.Area) || id || "";
  var build = parseFirestoreValue_(f.Build) || "";
  var floor = parseFirestoreValue_(f.Floor) || "";
  var rack = parseFirestoreValue_(f.Rack_no) || "";
  var level = parseFirestoreValue_(f.Rack_Level) || "";
  var label = area;
  if (build || floor) label += " — " + [build, floor].filter(Boolean).join(" ");
  if (rack) label += " (Rack " + rack + (level ? " · ระดับ " + level : "") + ")";
  return label;
}

function buildCarMapFromDocs_(docs) {
  var map = {};
  (docs || []).forEach(function(doc) {
    var f     = doc.fields || {};
    var brand = parseFirestoreValue_(f.Brand)    || "";
    var model = parseFirestoreValue_(f.Model)    || "";
    var year  = parseFirestoreValue_(f.Year)     || "";
    var type  = parseFirestoreValue_(f.Type_Car) || "";
    var label = [brand, model].filter(Boolean).join(" ");
    if (year) label += " (" + year + ")";
    if (type) label += " — " + type;
    map[doc.id] = label || doc.id;
  });
  return map;
}

// ==========================================
// 10. ★ getAllProducts
// ==========================================
function getAllProducts_(options) {
  var products = [];
  try {
    var masters = fetchCollectionsParallel_(
      ["Master_Brands", "Master_Categories", "Master_Vendors", "Master_Zones", "Master_Cars"]
    );
    var brandMap  = buildMapFromDocs_(masters["Master_Brands"],     "Brand_Name");
    var catMap    = buildMapFromDocs_(masters["Master_Categories"], "Category_Name");
    var vendorMap = buildMapFromDocs_(masters["Master_Vendors"],    "Vendor_name");
    var zoneMap   = buildZoneMapFromDocs_(masters["Master_Zones"]);
    var carMap    = buildCarMapFromDocs_(masters["Master_Cars"]);
    var imageMap  = getProductImageUrlMap_();
    var productDocs = fetchCollectionDocsCached_("Master_Products");

    productDocs.forEach(function(doc) {
      var id = doc.id, f = doc.fields || {};
      var brandId  = parseFirestoreValue_(f.Brand_ID)         || "";
      var catId    = parseFirestoreValue_(f.Category_ID)      || "";
      var vendorId = parseFirestoreValue_(f.Default_Vendor_ID)|| "";
      var zoneId   = parseFirestoreValue_(f.Zone_ID)          || "";
      var carIds = parseFirestoreValue_(f.Car_IDs);
      if (!carIds || (Array.isArray(carIds) && carIds.length === 0)) {
        var legacyCarId = parseFirestoreValue_(f.Car_ID);
        carIds = legacyCarId ? [legacyCarId] : [];
      } else if (!Array.isArray(carIds)) carIds = [carIds];
      var carModelNames = carIds.map(function(cid) { return carMap[cid] || cid; }).filter(Boolean);

      var imageState = imageMap[id] || {};
      if (typeof imageState === "string") {
        imageState = { primary: imageState, urls: imageState ? [imageState] : [], primaryIndex: 0 };
      }
      var imageUrls = Array.isArray(imageState.urls) ? imageState.urls.slice(0, 3) : [];
      var primaryIndex = parseInt(imageState.primaryIndex, 10) || 0;

      products.push({
        id           : id, // alias สำหรับ UI เก่าที่อ้าง p.id
        productCode  : id,
        productName  : parseFirestoreValue_(f.Product_Name) || "",
        partType     : parseFirestoreValue_(f.Part_Type)    || "",
        partNumber   : String(parseFirestoreValue_(f.Part_Number) || ""),
        barcode      : String(parseFirestoreValue_(f.Barcode) || ""),
        barcodeGenerated : parseFirestoreValue_(f.Barcode_Generated) === "true",
        imageUrl     : imageState.primary || imageUrls[primaryIndex] || imageUrls[0] || "",
        imageUrls    : imageUrls,
        primaryImageIndex: primaryIndex,
        imageUpdateTime:imageState.updateTime || "",
        brandId      : brandId,
        brandName    : brandMap[brandId] || brandId,
        categoryId   : catId,
        categoryName : catMap[catId] || catId,
        vendorId     : vendorId,
        vendorName   : vendorMap[vendorId] || vendorId,
        zoneId       : zoneId,
        zoneName     : zoneId === "PENDING" ? "รอดำเนินการ" : (zoneMap[zoneId] || zoneId),
        carIds       : carIds,
        carModel     : carModelNames.join(', '),
        costPrice    : parseFloat(parseFirestoreValue_(f.Cost_Price) || 0),
        sellingPrice : parseFloat(parseFirestoreValue_(f.Selling_Price) || 0),
        currentStock : parseFloat(parseFirestoreValue_(f.Current_Stock) || 0),
        minStock     : parseFloat(parseFirestoreValue_(f.Min_Stock) || 0),
        status       : parseFirestoreValue_(f.Status) || "Active"
      });
    });
  } catch (e) { console.error("getAllProducts_ read failed", e); throw e; }
  return options && options.includeMasters ? {products:products,masters:getAllMasterDropdowns_(masters)} : products;
}

// ==========================================
// 11. ★ getProductById
// ==========================================
function getProductById_(productCode) {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Master_Products/" + productCode;
    var res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: getAuthHeader_(),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() === 200) {
      var doc = JSON.parse(res.getContentText());
      var f   = doc.fields || {};

      var brandId  = parseFirestoreValue_(f.Brand_ID)          || "";
      var catId    = parseFirestoreValue_(f.Category_ID)       || "";
      var vendorId = parseFirestoreValue_(f.Default_Vendor_ID) || "";
      var zoneId   = parseFirestoreValue_(f.Zone_ID)           || "";

      var carIds = parseFirestoreValue_(f.Car_IDs);
      if (!carIds || (Array.isArray(carIds) && carIds.length === 0)) {
        var legacyCarId = parseFirestoreValue_(f.Car_ID);
        carIds = legacyCarId ? [legacyCarId] : [];
      } else if (!Array.isArray(carIds)) {
        carIds = [carIds];
      }

      var masters   = readProductReferenceDocs_({Master_Brands:[brandId],Master_Categories:[catId],Master_Vendors:[vendorId],Master_Zones:zoneId==='PENDING'?[]:[zoneId],Master_Cars:carIds});
      var brandMap  = buildMapFromDocs_(masters["Master_Brands"],     "Brand_Name");
      var catMap    = buildMapFromDocs_(masters["Master_Categories"], "Category_Name");
      var vendorMap = buildMapFromDocs_(masters["Master_Vendors"],    "Vendor_name");
      var zoneMap   = buildZoneMapFromDocs_(masters["Master_Zones"]);
      var carMap    = buildCarMapFromDocs_(masters["Master_Cars"]);
      var carModelNames = carIds.map(function(cid) { return carMap[cid] || cid; }).filter(Boolean);
      var imgState = getProductImageDocData_(productCode);

      return {
        productCode  : productCode,
        productName  : parseFirestoreValue_(f.Product_Name)        || "",
        partType     : parseFirestoreValue_(f.Part_Type)           || "",
        partNumber   : String(parseFirestoreValue_(f.Part_Number) || ""),
        barcode      : String(parseFirestoreValue_(f.Barcode) || ""),
        barcodeGenerated : parseFirestoreValue_(f.Barcode_Generated) === "true",
        imageUrl     : imgState.urls[imgState.primaryIndex] || imgState.urls[0] || "",
        imageUrls    : imgState.urls.slice(0, 3),
        primaryImageIndex: imgState.primaryIndex,
        imageUpdateTime:imgState.updateTime || "",
        brandId      : brandId,
        brandName    : brandMap[brandId]   || brandId,
        categoryId   : catId,
        categoryName : catMap[catId]       || catId,
        vendorId     : vendorId,
        vendorName   : vendorMap[vendorId] || vendorId,
        zoneId       : zoneId,
        zoneName     : zoneId === "PENDING" ? "รอดำเนินการ" : (zoneMap[zoneId] || zoneId),
        carIds       : carIds,
        carModel     : carModelNames.join(', '),
        costPrice    : parseFloat(parseFirestoreValue_(f.Cost_Price)    || 0),
        sellingPrice : parseFloat(parseFirestoreValue_(f.Selling_Price) || 0),
        currentStock : parseFloat(parseFirestoreValue_(f.Current_Stock) || 0),
        minStock     : parseFloat(parseFirestoreValue_(f.Min_Stock)     || 0),
        status       : parseFirestoreValue_(f.Status)              || "Active"
      };
    }
  } catch (e) {
    console.error("getProductById error:", e);
  }
  return null;
}

// ==========================================
// 12. ★ getAllMasterDropdowns
// ==========================================
function getAllMasterDropdowns_(preloadedMasters) {

  function buildBrands() {
    return buildSimpleList("Master_Brands", function(f, id) {
      return parseFirestoreValue_(f.Brand_Name) || id;
    });
  }

  function buildCategories() {
    return buildSimpleList("Master_Categories", function(f, id) {
      return parseFirestoreValue_(f.Category_Name) || id;
    });
  }

  function buildVendors() {
    return buildSimpleList("Master_Vendors", function(f, id) {
      var name  = parseFirestoreValue_(f.Vendor_name) || id;
      var phone = parseFirestoreValue_(f.Phone) || "";
      return phone ? name + " (" + phone + ")" : name;
    });
  }

  function buildZones() {
    return buildSimpleList("Master_Zones", function(f, id) {
      return zoneDisplayLabel_(f, id);
    });
  }

  function buildCars() {
    return buildSimpleList("Master_Cars", function(f, id) {
      var brand = parseFirestoreValue_(f.Brand)    || "";
      var model = parseFirestoreValue_(f.Model)    || "";
      var year  = parseFirestoreValue_(f.Year)     || "";
      var type  = parseFirestoreValue_(f.Type_Car) || "";
      var parts = [brand, model].filter(Boolean).join(" ");
      if (year) parts += " (" + year + ")";
      if (type) parts += " — " + type;
      return parts || id;
    });
  }

  function buildSimpleList(collectionName, labelFn) {
    var list = [];
    try {
      var docs = (PRELOADED_MASTER_DOCS && PRELOADED_MASTER_DOCS[collectionName])
                   ? PRELOADED_MASTER_DOCS[collectionName]
                   : fetchCollectionDocsCached_(collectionName);
      docs.forEach(function(doc) {
        var f       = doc.fields || {};
        var display = labelFn(f, doc.id);
        list.push({
          id   : doc.id,
          Name : display,
          name : display.toLowerCase()
        });
      });
    } catch (e) {
      console.error("getAllMasterDropdowns " + collectionName + " error:", e);
    }
    return list;
  }

  var PRELOADED_MASTER_DOCS = preloadedMasters || fetchCollectionsParallel_(
    ["Master_Brands", "Master_Categories", "Master_Vendors", "Master_Zones", "Master_Cars"]
  );

  return {
    brands     : buildBrands(),
    categories : buildCategories(),
    vendors    : buildVendors(),
    zones      : buildZones(),
    cars       : buildCars()
  };
}

// ==========================================
// 13. saveProduct
// ==========================================
function saveProduct_(d) {
  d = d || {};
  if (typeof d.productName!=="string" || !d.productName.trim() || d.productName.length>500) return {success:false, message:"กรุณาระบุชื่อสินค้า"};
  var numeric = ["costPrice","sellingPrice","currentStock","minStock"];
  if (numeric.some(function(k) {return d[k] != null && !validBusinessNumber_(d[k],0,false);})) return {success:false, message:"ราคาและจำนวนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป"};
  if (["Active","Inactive"].indexOf(d.status || "Active") < 0) return {success:false, message:"สถานะสินค้าไม่ถูกต้อง"};
  var refs = {brandId:"Master_Brands",categoryId:"Master_Categories",vendorId:"Master_Vendors",zoneId:"Master_Zones"};
  try {
    Object.keys(refs).forEach(function(k) {if (d[k] && d[k] !== "PENDING") readExistingDocument_(refs[k], d[k]);});
    (Array.isArray(d.carIds) ? d.carIds : []).forEach(function(id) {readExistingDocument_("Master_Cars", id);});
  } catch (e) {return {success:false, message:"ข้อมูลอ้างอิงไม่ถูกต้อง: " + e.message};}
  var carIds = Array.isArray(d.carIds) ? d.carIds.filter(Boolean) : [];

  var dataObject = {
    Product_Name      : String(d.productName   || "").trim(),
    Part_Type         : String(d.partType      || "").trim() || "PENDING", // ★ ไม่บังคับเลือก — ว่างไว้ได้ (แสดงเป็น "รอดำเนินการ" เหมือน Zone_ID)
    Part_Number       : String(d.partNumber    || "").trim(),
    Barcode           : String(d.barcode       || "").trim(),
    Brand_ID          : String(d.brandId       || ""),
    Category_ID       : String(d.categoryId    || ""),
    Default_Vendor_ID : String(d.vendorId      || ""),
    Zone_ID           : String(d.zoneId        || "").trim() || "PENDING",
    Car_IDs           : carIds,
    Cost_Price        : Number(d.costPrice || 0),
    Selling_Price     : Number(d.sellingPrice || 0),
    Current_Stock     : Number(d.currentStock || 0),
    Min_Stock         : Number(d.minStock || 0),
    Status            : String(d.status        || "Active")
  };

  var docId = d.productCode || d.docId || null;

  // ★ FIX (โควตา Firestore Reads): เดิมสแกน Master_Products ทั้ง collection ทุกครั้งที่บันทึกสินค้า
  //   1 ครั้ง (เพื่อเช็ค Part_Number/Barcode ซ้ำ + หาเอกสารเดิมของตัวเอง) — เปลี่ยนเป็น targeted query
  //   (.where เทียบค่าตรงตัว) แยกฟิลด์ + อ่านเอกสารเดิมด้วย ID ตรงๆ ผ่าน getProductRawFields_ ที่มีอยู่
  //   แล้ว แทนการสแกนหา ลด reads จากทั้งร้านเหลือแค่ไม่กี่ document ต่อการบันทึก 1 ครั้ง
  //   หมายเหตุ: query เทียบค่าตรงตัว (case-sensitive) ต่างจาก scan เดิมที่ไม่สนตัวพิมพ์เล็ก/ใหญ่ —
  //   Barcode เป็นตัวเลขล้วนไม่กระทบ ส่วน Part_Number ถ้าพิมพ์ตัวพิมพ์ต่างกันอาจไม่ถูกจับว่าซ้ำ (data
  //   quality guard เท่านั้น ไม่ใช่ข้อจำกัดด้านความปลอดภัย)
  var existingDoc = null;
  if (docId) {
    try { existingDoc = readExistingDocument_("Master_Products", docId); }
    catch (e) { return { success:false, message:e.message }; }
  }
  var existingFields = existingDoc ? existingDoc.fields || {} : null;
  var editOptions = null;
  if (existingDoc) {
    // Older clients have no stock baseline: their cached stock is never written back.
    var stockChanged = d.originalStock !== undefined && d.originalStock !== null &&
      Number(d.currentStock) !== Number(d.originalStock);
    if (stockChanged) {
      if (!isFinite(Number(d.originalStock)) || !isFinite(Number(d.currentStock)) || Number(d.currentStock) < 0) {
        return { success:false, message:"จำนวนสต๊อกต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป" };
      }
      if (Number(d.originalStock) !== Number(parseFirestoreValue_(existingFields.Current_Stock) || 0)) {
        return { success:false, message:"สต๊อกเปลี่ยนแปลงแล้ว กรุณารีเฟรชและตรวจสอบจำนวนก่อนแก้ไขสต๊อก" };
      }
      editOptions = { updateTime:existingDoc.updateTime };
    } else {
      delete dataObject.Current_Stock;
      editOptions = {};
    }
  } else if (!isFinite(Number(d.currentStock || 0)) || dataObject.Current_Stock < 0) {
    return { success:false, message:"จำนวนสต๊อกต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป" };
  }

  try {
    var duplicateFields=[['Product_Name','ชื่อสินค้า'],['Part_Number','Part Number'],['Barcode','บาร์โค้ด']];
    for(var i=0;i<duplicateFields.length;i++){
      var key=duplicateFields[i][0];
      if(dataObject[key] && hasNormalizedDuplicate_('Master_Products',key,dataObject[key],docId))
        return {success:false,title:'ข้อมูลซ้ำ!',message:duplicateFields[i][1]+' มีอยู่ในระบบแล้ว'};
    }
  }catch(e){return {success:false,message:'ตรวจสอบข้อมูลซ้ำไม่สำเร็จ กรุณาลองใหม่'};}

  // ★ Barcode_Generated ไม่ได้อยู่ในฟอร์มแก้ไขสินค้า (ตั้งค่าแยกผ่าน generateProductBarcode())
  //   แต่ saveProduct → saveMasterData เป็น PATCH แบบไม่มี updateMask (ทับทั้งเอกสาร) — ถ้าไม่จัดการ
  //   ตรงนี้ การแก้ไขสินค้าเรื่องอื่น (เช่นราคา) จะลบธง "สร้างเอง" ทิ้งเงียบๆ ทุกครั้ง ทำให้เมนูพิมพ์
  //   บาร์โค้ดหายไปทั้งที่บาร์โค้ดยังเป็นอันที่ระบบสร้างอยู่เหมือนเดิม — คงธงไว้ถ้าค่าบาร์โค้ดไม่เปลี่ยน
  //   จากที่ระบบเคยสร้างให้, ถือเป็นบาร์โค้ดจริงถ้าผู้ใช้พิมพ์/แก้ไขค่าใหม่เอง
  dataObject.Barcode_Generated = "false";
  if (existingFields) {
    var existingBarcode   = String(parseFirestoreValue_(existingFields.Barcode) || "").trim();
    var existingGenerated = parseFirestoreValue_(existingFields.Barcode_Generated) === "true";
    if (existingGenerated && existingBarcode && existingBarcode === dataObject.Barcode) {
      dataObject.Barcode_Generated = "true";
    }
  }

  var saveRes = saveMasterData_("Master_Products", "P", docId, dataObject, null, editOptions);
  if (saveRes && saveRes.success) {
    try { saveRes.product = getProductById_(saveRes.id); }
    catch (e) {saveRes.refreshWarning = "บันทึกแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณารีเฟรช";}
    if (saveRes.product) saveRes.product.id = saveRes.id;else saveRes.refreshWarning="บันทึกแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณารีเฟรช";
  }
  return saveRes;
}

// Reads for edits fail closed: never recreate a deleted record or allocate a new document number.
function readExistingDocument_(collection, docId) {
  if(!validDocumentId_(String(docId || ""))) throw new Error("รหัสเอกสารไม่ถูกต้อง");
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
    + "/databases/(default)/documents/" + collection + "/" + encodeURIComponent(docId);
  var res = UrlFetchApp.fetch(url, { method:"get", headers:getAuthHeader_(), muteHttpExceptions:true });
  if (res.getResponseCode() !== 200) throw new Error("อ่านข้อมูลเดิมไม่สำเร็จ กรุณารีเฟรชก่อนแก้ไขอีกครั้ง");
  var doc = JSON.parse(res.getContentText());
  if (!doc.updateTime) throw new Error("ตรวจสอบเวอร์ชันข้อมูลเดิมไม่สำเร็จ กรุณาลองใหม่");
  return doc;
}

function getProductRawFields_(docId) {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Master_Products/" + docId;
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader_(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText()).fields || {};
  } catch (e) {
    return null;
  }
}

/**
 * ★ สร้างบาร์โค้ดให้สินค้าที่ยังไม่มีบาร์โค้ดจริงจากโรงงาน — ใช้ช่วง EAN-13 20-29
 *   ที่ GS1 กันไว้สำหรับใช้ภายในร้านเท่านั้น (In-Store use) จึงมั่นใจได้ว่าไม่ชนกับบาร์โค้ด
 *   สินค้าจริงใบไหนในโลก และยังเป็นมาตรฐาน EAN-13 ให้เครื่องสแกน/POS ทั่วไปอ่านได้ปกติ
 *   เลข 10 หลักถัดจาก prefix ดึงจากตัวเลขในรหัสสินค้าเอง (unique อยู่แล้ว) จึงไม่ต้องมีตัวนับแยก
 */
function generateProductBarcode_(productCode) {
  try {
    productCode = String(productCode || "").trim();
    if (!productCode) return { success: false, message: "ไม่พบรหัสสินค้า" };

    var fields = getProductRawFields_(productCode);
    if (!fields) return { success: false, message: "ไม่พบสินค้านี้ในระบบ — อาจถูกลบไปแล้ว" };

    var existing  = String(parseFirestoreValue_(fields.Barcode) || "").trim();
    var generated = parseFirestoreValue_(fields.Barcode_Generated) === "true";

    if (existing && generated) {
      return { success: true, message: "สินค้านี้มีบาร์โค้ดที่สร้างไว้แล้ว", barcode: existing, generated: true };
    }
    if (existing && !generated) {
      return { success: false, message: 'สินค้านี้มีบาร์โค้ดจริงอยู่แล้ว ("' + existing + '") ไม่ต้องสร้างใหม่' };
    }

    var numPart = productCode.replace(/\D/g, "");
    if (!numPart) numPart = String(Math.abs(hashCode_(productCode)));
    numPart = ("0000000000" + numPart).slice(-10); // เติม 0 ด้านหน้าให้ครบ 10 หลัก (หรือตัดเอา 10 หลักท้ายถ้ายาวเกิน) กันชนกันของรหัสที่ตัวเลขเป็น prefix ของกันเอง

    var body12  = "20" + numPart;
    var barcode = body12 + computeEan13CheckDigit_(body12);

    // กันชนซ้ำ (ทางทฤษฎีแทบเป็นไปไม่ได้เพราะดึงจากรหัสสินค้าที่ unique อยู่แล้ว แต่เช็คไว้ให้ชัวร์)
    var dupBarcode = checkBarcodeDuplicate_(barcode, productCode);
    if (dupBarcode) return { success: false, message: "สร้างบาร์โค้ดชนกับสินค้าอื่น กรุณาลองใหม่หรือกรอกเอง" };

    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Master_Products/" + productCode
            + "?updateMask.fieldPaths=Barcode&updateMask.fieldPaths=Barcode_Generated";
    var res = UrlFetchApp.fetch(url, {
      method  : "patch",
      headers : getAuthHeader_(),
      payload : JSON.stringify({ fields: mapToFirestoreFields_({ Barcode: barcode, Barcode_Generated: "true" }) }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      return { success: false, message: "บันทึกบาร์โค้ดไม่สำเร็จ: " + res.getContentText() };
    }
    clearCollectionCache_("Master_Products");

    return { success: true, message: "สร้างบาร์โค้ดสำเร็จ", barcode: barcode, generated: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function computeEan13CheckDigit_(body12) {
  var sum = 0;
  for (var i = 0; i < 12; i++) {
    var d = parseInt(body12.charAt(i), 10);
    sum += (i % 2 === 0) ? d : d * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

function hashCode_(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return h;
}

function checkPartNumberDuplicate_(partNumber, excludeDocId) {
  var value = String(partNumber || "").trim();
  if (!value) return null;
  var duplicate = queryByEqualityField_("Master_Products", "Part_Number", value)
    .some(function(doc) { return doc.id !== excludeDocId; });
  if (!duplicate) {
    var cached = peekCollectionDocsCache_("Master_Products");
    if (cached) {
      var lower = value.toLowerCase();
      duplicate = cached.some(function(doc) {
        return doc.id !== excludeDocId && String(parseFirestoreValue_((doc.fields || {}).Part_Number) || "").trim().toLowerCase() === lower;
      });
    }
  }
  return duplicate ? { success:false, title:"ข้อมูลซ้ำ!", message:'รหัสจากผู้ผลิต (Part Number) "' + value + '" มีอยู่ในระบบแล้ว' } : null;
}

function checkBarcodeDuplicate_(barcode, excludeDocId) {
  var value = String(barcode || "").trim();
  if (!value) return null;
  var duplicate = queryByEqualityField_("Master_Products", "Barcode", value)
    .some(function(doc) { return doc.id !== excludeDocId; });
  return duplicate ? { success:false, title:"ข้อมูลซ้ำ!", message:'บาร์โค้ด "' + value + '" มีอยู่ในระบบแล้ว' } : null;
}

function deleteProduct_(docId) {
  return deleteFirestoreDocument_("Master_Products", docId);
}

// ==========================================
// 14. Master — Brands
// ==========================================
function saveBrand_(d) {
  var dataObject = {
    _expectedUpdateTime:d.expectedUpdateTime||"",
    Brand_Name  : String(d.brandName   || ""),
    Description : String(d.description || ""),
    Status      : String(d.status      || "Active")
  };
  return saveMasterData_("Master_Brands", "B", d.docId || null, dataObject, d.brandName);
}
function getBrands_()        { return getFirestoreRawList_("Master_Brands"); }
function deleteBrand_(docId) { return deleteFirestoreDocument_("Master_Brands", docId); }

// ==========================================
// 15. Master — Categories
// ==========================================
function saveCategory_(d) {
  var dataObject = {
    _expectedUpdateTime:d.expectedUpdateTime||"",
    Category_Name: String(d.categoryName || ""),
    Description  : String(d.description  || ""),
    Status       : String(d.status       || "Active")
  };
  return saveMasterData_("Master_Categories", "C", d.docId || null, dataObject, d.categoryName);
}
function getCategories_()        { return getFirestoreRawList_("Master_Categories"); }
// ★ FIX: แก้ typo "eleteCategory" → "deleteCategory" (เดิมขาดตัว d ทำให้ apiGateway/ปุ่มลบเรียกไม่เจอ)
function deleteCategory_(docId)  { return deleteFirestoreDocument_("Master_Categories", docId); }
// ==========================================
// 16. Master — Vendors
// ==========================================
function buildFullAddress_(f) {
  var parts = [];
  if (f.addressNo)   parts.push("เลขที่ " + f.addressNo);
  if (f.addressMoo)  parts.push("หมู่ " + f.addressMoo);
  if (f.addressRoad) parts.push("ถนน" + f.addressRoad);
  if (f.subdistrict) parts.push("ตำบล/แขวง" + f.subdistrict);
  if (f.district)    parts.push("อำเภอ/เขต" + f.district);
  if (f.province)    parts.push("จังหวัด" + f.province);
  if (f.postalCode)  parts.push(f.postalCode);
  var joined = parts.join(" ");
  return joined || f.address || "";
}

function saveVendor_(d) {
  var taxId = String(d.taxId || "").replace(/\D/g, '');

  if (!taxId) {
    return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณากรอกเลขประจำตัวผู้เสียภาษีอากร (จำเป็นสำหรับออกใบกำกับภาษี)" };
  }
  if (taxId.length !== 13) {
    return { success: false, title: "ข้อมูลไม่ถูกต้อง", message: "เลขประจำตัวผู้เสียภาษีอากรต้องมี 13 หลัก (กรอกมา " + taxId.length + " หลัก)" };
  }

  var dataObject = {
    _expectedUpdateTime:d.expectedUpdateTime||"",
    Vendor_name  : String(d.vendorName  || ""),
    Contact_name : String(d.contact     || ""),
    Phone        : String(d.phone       || ""),
    Email        : String(d.email       || ""),
    Address_No   : String(d.addressNo   || ""),
    Address_Moo   : String(d.addressMoo  || ""),
    Address_Road  : String(d.addressRoad || ""),
    Subdistrict   : String(d.subdistrict || ""),
    District      : String(d.district    || ""),
    Province      : String(d.province    || ""),
    Postal_Code   : String(d.postalCode  || ""),
    Address      : String(d.address     || ""),
    Tax_ID       : taxId,
    Branch       : String(d.branch || "").trim() || "สำนักงานใหญ่",
    Status       : String(d.status      || "Active")
  };
  return saveMasterData_("Master_Vendors", "V", d.docId || null, dataObject, d.vendorName);
}

function getVendorsFull_() {
  var list = [];
  try {
    var docs = fetchCollectionDocsCached_("Master_Vendors");
    docs.forEach(function(doc) {
      var f = doc.fields || {};
      list.push({
        id           : doc.id,
        updateTime:doc.updateTime||"",
        Vendor_name  : parseFirestoreValue_(f.Vendor_name)  || "",
        Contact_name : parseFirestoreValue_(f.Contact_name) || "",
        Phone        : parseFirestoreValue_(f.Phone)        || "",
        Email        : parseFirestoreValue_(f.Email)        || "",
        Address_No   : parseFirestoreValue_(f.Address_No)   || "",
        Address_Moo   : parseFirestoreValue_(f.Address_Moo)  || "",
        Address_Road  : parseFirestoreValue_(f.Address_Road) || "",
        Subdistrict   : parseFirestoreValue_(f.Subdistrict)  || "",
        District      : parseFirestoreValue_(f.District)     || "",
        Province      : parseFirestoreValue_(f.Province)      || "",
        Postal_Code   : parseFirestoreValue_(f.Postal_Code)    || "",
        Address      : buildFullAddress_({
          addressNo: parseFirestoreValue_(f.Address_No), addressMoo: parseFirestoreValue_(f.Address_Moo),
          addressRoad: parseFirestoreValue_(f.Address_Road), subdistrict: parseFirestoreValue_(f.Subdistrict),
          district: parseFirestoreValue_(f.District), province: parseFirestoreValue_(f.Province),
          postalCode: parseFirestoreValue_(f.Postal_Code), address: parseFirestoreValue_(f.Address)
        }),
        Tax_ID       : String(parseFirestoreValue_(f.Tax_ID) || ""),
        Branch       : parseFirestoreValue_(f.Branch)        || "",
        Status       : parseFirestoreValue_(f.Status)       || ""
      });
    });
  } catch (e) { console.error("getVendorsFull_ read failed", e); throw e; }
  return list;
}

function deleteVendor_(docId) { return deleteFirestoreDocument_("Master_Vendors", docId); }

// ==========================================
// ★ Master — Customers
// ==========================================
var CUSTOMER_TYPES = ["ลูกค้าทั่วไป", "อู่ซ่อมรถ", "บริษัท/องค์กร", "หน่วยงานราชการ"];

function saveCustomer_(d) {
  var taxId = String(d.taxId || "").replace(/\D/g, '');

  if (taxId && taxId.length !== 13) {
    return { success: false, title: "ข้อมูลไม่ถูกต้อง", message: "เลขประจำตัวผู้เสียภาษีอากรต้องมี 13 หลัก (กรอกมา " + taxId.length + " หลัก) หรือเว้นว่างไว้ถ้าไม่มี" };
  }

  var customerName = String(d.customerName || "").trim();
  if (!customerName) {
    return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณากรอกชื่อลูกค้า" };
  }

  var docId = d.docId || null;

  // ★ FIX: เดิมเช็คซ้ำแค่ชื่อลูกค้า (ผ่าน checkDuplicateName ใน saveMasterData) ไม่เคยเช็คเลขประจำตัว
  //   ผู้เสียภาษีเลย — ทำให้ลูกค้าคนละชื่อ (เช่น พิมพ์ชื่อผิด/สาขาเดียวกันแต่คนละบันทึก) ใส่เลขผู้เสียภาษี
  //   เดียวกันซ้ำได้ ซึ่งเป็นปัญหาตอนออกใบกำกับภาษี — เดิมสแกนทั้ง collection มาเช็ค เปลี่ยนเป็น
  //   targeted query (.where เทียบค่าตรงตัว) แทน — Tax_ID เป็นตัวเลขล้วนอยู่แล้ว (ตัดอักขระอื่นออกหมด
  //   ด้านบน) จึงเทียบตรงตัวได้ไม่มีปัญหาตัวพิมพ์เล็ก/ใหญ่เหมือน Part_Number ของสินค้า
  if (taxId) {
    var dupTaxId;
    try{dupTaxId=hasNormalizedDuplicate_('Master_Customers','Tax_ID',taxId,docId);}
    catch(e){return {success:false,message:'ตรวจสอบข้อมูลซ้ำไม่สำเร็จ กรุณาลองใหม่'};}
    if (dupTaxId) {
      return { success: false, title: "ข้อมูลซ้ำ!", message: 'เลขประจำตัวผู้เสียภาษีอากร "' + taxId + '" มีอยู่ในระบบแล้ว' };
    }
  }

  // ★ หน้าใบกำกับภาษี (เพิ่มลูกค้าด่วน) ไม่มีช่องให้เลือกประเภทลูกค้าตั้งใจ — ลูกค้าที่มาจากทางนั้น
  //   จึงไม่ส่ง customerType มาเลย ในกรณีนี้ให้ตั้งค่าเริ่มต้นเป็น "ลูกค้าทั่วไป" แทนการปฏิเสธ
  //   ส่วนหน้าจัดการลูกค้า (Master_Customers) ยังคงบังคับเลือกที่ฝั่ง client เหมือนเดิม จึงไม่กระทบ
  var customerType = String(d.customerType || "").trim();
  if (!customerType) {
    customerType = CUSTOMER_TYPES[0];
  } else if (CUSTOMER_TYPES.indexOf(customerType) === -1) {
    return { success: false, title: "ข้อมูลไม่ถูกต้อง", message: "ประเภทลูกค้าไม่ถูกต้อง" };
  }

  var dataObject = {
    _expectedUpdateTime:d.expectedUpdateTime||"",
    Customer_Name : customerName,
    Customer_Type : customerType,
    Address_No    : String(d.addressNo   || ""),
    Address_Moo   : String(d.addressMoo  || ""),
    Address_Road  : String(d.addressRoad || ""),
    Subdistrict   : String(d.subdistrict || ""),
    District      : String(d.district    || ""),
    Province      : String(d.province    || ""),
    Postal_Code   : String(d.postalCode  || ""),
    Address       : String(d.address || ""),
    Tax_ID        : taxId,
    Branch        : String(d.branch  || "").trim() || "ไม่ระบุ",
    Phone         : String(d.phone   || ""),
    Status        : String(d.status  || "Active")
  };
  return saveMasterData_("Master_Customers", "C", docId, dataObject, d.customerName);
}

function getCustomersFull_() {
  var list = [];
  try {
    var docs = fetchCollectionDocsCached_("Master_Customers");
    docs.forEach(function(doc) {
      var f = doc.fields || {};
      list.push({
        id            : doc.id,
        updateTime:doc.updateTime||"",
        Customer_Name : parseFirestoreValue_(f.Customer_Name) || "",
        Customer_Type : parseFirestoreValue_(f.Customer_Type) || "",
        Address_No    : parseFirestoreValue_(f.Address_No)    || "",
        Address_Moo   : parseFirestoreValue_(f.Address_Moo)   || "",
        Address_Road  : parseFirestoreValue_(f.Address_Road)  || "",
        Subdistrict   : parseFirestoreValue_(f.Subdistrict)   || "",
        District      : parseFirestoreValue_(f.District)      || "",
        Province      : parseFirestoreValue_(f.Province)       || "",
        Postal_Code   : parseFirestoreValue_(f.Postal_Code)     || "",
        Address       : buildFullAddress_({
          addressNo: parseFirestoreValue_(f.Address_No), addressMoo: parseFirestoreValue_(f.Address_Moo),
          addressRoad: parseFirestoreValue_(f.Address_Road), subdistrict: parseFirestoreValue_(f.Subdistrict),
          district: parseFirestoreValue_(f.District), province: parseFirestoreValue_(f.Province),
          postalCode: parseFirestoreValue_(f.Postal_Code), address: parseFirestoreValue_(f.Address)
        }),
        Tax_ID        : String(parseFirestoreValue_(f.Tax_ID) || ""),
        Branch        : parseFirestoreValue_(f.Branch)        || "",
        Phone         : parseFirestoreValue_(f.Phone)         || "",
        Status        : parseFirestoreValue_(f.Status)        || ""
      });
    });
  } catch (e) { console.error("getCustomersFull_ read failed", e); throw e; }
  return list;
}


function getCustomerById_(docId) {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Master_Customers/" + encodeURIComponent(docId);
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader_(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var f = JSON.parse(res.getContentText()).fields || {};
    var obj = {
      id            : docId,
      Customer_Name : parseFirestoreValue_(f.Customer_Name) || "",
      Customer_Type : parseFirestoreValue_(f.Customer_Type) || "",
      Address_No     : parseFirestoreValue_(f.Address_No) || "",
      Address_Moo    : parseFirestoreValue_(f.Address_Moo) || "",
      Address_Road   : parseFirestoreValue_(f.Address_Road) || "",
      Subdistrict    : parseFirestoreValue_(f.Subdistrict) || "",
      District       : parseFirestoreValue_(f.District) || "",
      Province       : parseFirestoreValue_(f.Province) || "",
      Postal_Code    : parseFirestoreValue_(f.Postal_Code) || "",
      Tax_ID         : String(parseFirestoreValue_(f.Tax_ID) || ""),
      Branch         : parseFirestoreValue_(f.Branch) || "",
      Phone          : parseFirestoreValue_(f.Phone) || "",
      Status         : parseFirestoreValue_(f.Status) || ""
    };
    obj.Address = buildFullAddress_({
      addressNo: obj.Address_No, addressMoo: obj.Address_Moo, addressRoad: obj.Address_Road,
      subdistrict: obj.Subdistrict, district: obj.District, province: obj.Province,
      postalCode: obj.Postal_Code, address: parseFirestoreValue_(f.Address)
    });
    return obj;
  } catch (e) {
    console.error("getCustomerById_ error:", e);
    return null;
  }
}

function deleteCustomer_(docId) { return deleteFirestoreDocument_("Master_Customers", docId); }

// ==========================================
// ★ Master — Tax Invoice
// ==========================================
var TAX_INVOICE_SELLER = {
  name    : "บริษัท ส.ยืนยงอะไหล่ยนต์ จำกัด",
  branch  : "สำนักงานใหญ่ 000",
  address : "82-86 หมู่ที่ 3 ตำบลพยุหะ อำเภอพยุหะคีรี จังหวัดนครสวรรค์",
  taxId   : "0605563000707"
};

function calcTaxInvoiceTotals_(items) {
  var subtotal = 0;
  (items || []).forEach(function(it) {
    var qty   = parseFloat(it.qty)       || 0;
    var price = parseFloat(it.unitPrice) || 0;
    subtotal += qty * price;
  });
  var vat   = Math.round(subtotal * 0.07 * 100) / 100;
  var total = Math.round((subtotal + vat) * 100) / 100;
  return { subtotal: Math.round(subtotal * 100) / 100, vat: vat, total: total };
}

function isValidBusinessDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  var date = new Date(value + "T00:00:00Z");
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

var TAX_INVOICE_PREFIX = "SYY";

function buildInvoiceNoForMonth_(invoiceDateStr, runningNumber) {
  var d = invoiceDateStr ? new Date(invoiceDateStr + "T00:00:00") : new Date();
  if (isNaN(d.getTime())) d = new Date();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var yyBuddhist = String(d.getFullYear() + 543).slice(-2);
  return TAX_INVOICE_PREFIX + " " + String(runningNumber).padStart(4, '0') + "/" + mm + "/" + yyBuddhist;
}

// ★ ใช้เป็น key ของตัวนับเลขที่เอกสารราย "เดือน" (ดู nextRunningNumber_) — mm-yy พ.ศ. เช่น "09-69"
function docPeriodKey_(dateStr) {
  var d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  if (isNaN(d.getTime())) d = new Date();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var yyBuddhist = String(d.getFullYear() + 543).slice(-2);
  return mm + "-" + yyBuddhist;
}

function getNextInvoiceRunningNumber_(invoiceDateStr, excludeDocId) {
  var targetSuffix = buildInvoiceNoForMonth_(invoiceDateStr, 1).split('/').slice(1).join('/');
  var fetched = {ok:true,docs:readDocumentNumberSeeds_('Master_Tax_Invoice','Invoice_No')};
  var maxNum = 0;
  if (fetched.ok) {
    fetched.docs.forEach(function(doc) {
      if (doc.id === excludeDocId) return;
      var f = doc.fields || {};
      var no = String(parseFirestoreValue_(f.Invoice_No) || "");
      var m = no.match(/^SYY\s+(\d+)\/(\d{2}\/\d{2})$/);
      if (m && m[2] === targetSuffix) {
        var num = parseInt(m[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
  }
  return maxNum + 1;
}

function saveTaxInvoice_(d) {
  d = d || {};
  var items = Array.isArray(d.items) ? d.items : [];
  if (!items.length) {
    return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณาเพิ่มรายการสินค้า/บริการอย่างน้อย 1 รายการ" };
  }
  if (items.some(function(it) {
    return !it || !String(it.name || "").trim() || !isFinite(Number(it.qty)) || Number(it.qty) <= 0 ||
      it.unitPrice === "" || it.unitPrice === null || it.unitPrice === undefined ||
      !isFinite(Number(it.unitPrice)) || Number(it.unitPrice) < 0;
  })) return {success:false, message:"รายการสินค้าต้องมีชื่อ จำนวนมากกว่า 0 และราคาตั้งแต่ 0 ขึ้นไป"};
  var cleanItems = items.filter(function(it) {
    return String(it.name || "").trim() && parseFloat(it.qty) > 0 && parseFloat(it.unitPrice) >= 0;
  }).map(function(it) {
    return {
      name      : String(it.name).trim(),
      qty       : parseFloat(it.qty) || 0,
      unit      : String(it.unit || "").trim(),
      unitPrice : parseFloat(it.unitPrice) || 0
    };
  });
  if (!cleanItems.length) {
    return { success: false, title: "ข้อมูลไม่ครบ", message: "รายการสินค้าต้องมีชื่อและจำนวนมากกว่า 0 อย่างน้อย 1 รายการ" };
  }

  if (!String(d.buyerName || "").trim()) {
    return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณากรอกชื่อผู้ซื้อ" };
  }

  var buyerTaxId = String(d.buyerTaxId || "").replace(/\D/g, '');
  if (buyerTaxId && buyerTaxId.length !== 13) {
    return { success: false, title: "ข้อมูลไม่ถูกต้อง", message: "เลขผู้เสียภาษีของผู้ซื้อต้องมี 13 หลัก (กรอกมา " + buyerTaxId.length + " หลัก)" };
  }

  var totals = calcTaxInvoiceTotals_(cleanItems);

  var invoiceDate = String(d.invoiceDate || "").trim() || businessDate_();
  if (!isValidBusinessDate_(invoiceDate)) {
    return { success:false, message:"วันที่ใบกำกับภาษีไม่ถูกต้อง" };
  }

  var invoiceNo = "";
  var existingDoc = null;
  if (d.docId) {
    try {
      existingDoc = readExistingDocument_("Master_Tax_Invoice", d.docId);
      invoiceNo = parseFirestoreValue_((existingDoc.fields || {}).Invoice_No) || "";
      if (!invoiceNo) return { success:false, message:"ไม่พบเลขที่เอกสารเดิม กรุณาตรวจสอบก่อนแก้ไข" };
    } catch (e) {
      return { success:false, message:e.message };
    }
  }

  var dataObject = {
    Invoice_Date  : invoiceDate,
    Buyer_Name    : String(d.buyerName    || "").trim(),
    Buyer_Address : String(d.buyerAddress || "").trim(),
    Buyer_Tax_ID  : buyerTaxId,
    Buyer_Branch  : String(d.buyerBranch === undefined && existingDoc
      ? parseFirestoreValue_((existingDoc.fields || {}).Buyer_Branch) || ""
      : d.buyerBranch || "").trim() || "ไม่ระบุ",
    Items_JSON    : JSON.stringify(cleanItems),
    Subtotal      : totals.subtotal,
    Vat_Amount    : totals.vat,
    Grand_Total   : totals.total,
    Note          : String(d.note || "")
  };

  var invoiceYearBE = new Date(invoiceDate + "T00:00:00").getFullYear() + 543;

  if (d.docId && invoiceNo) {
    dataObject.Invoice_No = invoiceNo;
    var editRes = saveMasterData_("Master_Tax_Invoice", "TX", d.docId, dataObject, null, {updateTime:existingDoc.updateTime});
    if (editRes.success) {
      try { updateTaxInvoiceYearsMeta_(invoiceYearBE); } catch (metaError) { editRes.refreshWarning="เอกสารบันทึกแล้ว แต่ปีในรายการยังไม่อัปเดต กรุณาแจ้งผู้ดูแลระบบ"; }
      editRes.invoice = mapTaxInvoiceQueryDoc_({name:"Master_Tax_Invoice/" + editRes.id, fields:mapToFirestoreFields_(dataObject)});
    }
    return editRes;
  }

  var periodKey = docPeriodKey_(invoiceDate);
  var lastErr = "";
  for (var attempt = 0; attempt < 10; attempt++) {
    // ★ FIX (โควตา Firestore Reads): ใช้ตัวนับแทนการสแกน Master_Tax_Invoice ทั้ง collection ทุกครั้ง
    //   (ดูคำอธิบายเต็มที่ nextRunningNumber_) — seedFn (getNextInvoiceRunningNumber เดิม) จะถูกเรียก
    //   แค่ครั้งเดียวตอนตัวนับของเดือนนี้ยังไม่เคยถูกสร้างเท่านั้น
    var runningNum = nextRunningNumber_("TaxInvoice", periodKey, function() {
      return getNextInvoiceRunningNumber_(invoiceDate, d.docId || null);
    });
    if(runningNum===null)return {success:false,message:'ระบบเลขเอกสารไม่พร้อม กรุณาลองใหม่ภายหลัง'};
    var candidateNo = buildInvoiceNoForMonth_(invoiceDate, runningNum);

    // ★ จองเลขที่แบบ atomic ก่อนบันทึกจริง — กันเลขซ้ำเมื่อมีคนออกใบกำกับภาษีพร้อมกัน (ดู reserveDocNo_)
    if (!reserveDocNo_("TaxInvoice", candidateNo)) continue;

    dataObject.Invoice_No = candidateNo;
    var res = saveMasterData_("Master_Tax_Invoice", "TX", d.docId || null, dataObject, null);
    if (res.success) {
      try { updateTaxInvoiceYearsMeta_(invoiceYearBE); } catch (metaError) { res.refreshWarning="เอกสารบันทึกแล้ว แต่ปีในรายการยังไม่อัปเดต กรุณาแจ้งผู้ดูแลระบบ"; }
      res.invoice = mapTaxInvoiceQueryDoc_({name:"Master_Tax_Invoice/" + res.id, fields:mapToFirestoreFields_(dataObject)});
      return res;
    }
    lastErr = res.message;
    if (String(res.message || "").indexOf("ALREADY_EXISTS") === -1 &&
        String(res.message || "").indexOf("409") === -1) {
      break;
    }
  }
  return { success: false, title: "ล้มเหลว", message: lastErr || "ไม่สามารถออกเลขที่ใบกำกับภาษีได้ กรุณาลองอีกครั้ง" };
}

var META_COLLECTION      = "Meta_Counters";
var TAX_INVOICE_YEARS_ID = "tax_invoice_years";

function updateTaxInvoiceYearsMeta_(yearBE) { appendYearMeta_(TAX_INVOICE_YEARS_ID,yearBE); }

function getTaxInvoiceAvailableYears_() {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + META_COLLECTION + "/" + TAX_INVOICE_YEARS_ID;
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader_(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200 && res.getResponseCode() !== 404) throw new Error("โหลดปีเอกสารไม่สำเร็จ");
    if (res.getResponseCode() === 200) {
      var doc = JSON.parse(res.getContentText());
      var years = parseFirestoreValue_((doc.fields || {}).Years) || [];
      years = years.map(function(y) { return parseInt(y, 10); }).sort(function(a, b) { return b - a; });
      if (years.length) return years;
    }
  } catch (e) {
    throw e;
  }
  return [new Date().getFullYear() + 543];
}

function mapTaxInvoiceQueryDoc_(doc) {
  var f = doc.fields || {};
  var items = [];
  try { items = JSON.parse(parseFirestoreValue_(f.Items_JSON) || "[]"); } catch (e) { items = []; }
  return {
    id           : doc.name.split('/').pop(),
    invoiceNo    : parseFirestoreValue_(f.Invoice_No)    || "",
    invoiceDate  : parseFirestoreValue_(f.Invoice_Date)  || "",
    buyerName    : parseFirestoreValue_(f.Buyer_Name)    || "",
    buyerAddress : parseFirestoreValue_(f.Buyer_Address) || "",
    buyerTaxId   : String(parseFirestoreValue_(f.Buyer_Tax_ID) || ""),
    buyerBranch  : parseFirestoreValue_(f.Buyer_Branch)  || "",
    items        : items,
    subtotal     : parseFloat(parseFirestoreValue_(f.Subtotal)    || 0),
    vatAmount    : parseFloat(parseFirestoreValue_(f.Vat_Amount)  || 0),
    grandTotal   : parseFloat(parseFirestoreValue_(f.Grand_Total) || 0),
    note         : parseFirestoreValue_(f.Note) || ""
  };
}

function getTaxInvoiceListByYear_(yearBE){var out=[],cursor='';do{var p=getTaxInvoiceListData_(yearBE,{pageSize:200,cursor:cursor});out=out.concat(p.invoices);cursor=p.pageInfo.nextCursor;}while(cursor);return out;}

// ★ FIX (โควตา Firestore Reads): ใช้ตอนเลือกมุมมอง "ทั้งหมด" (ทุกปีรวมกัน) — เดิมสแกนทั้ง
//   Master_Tax_Invoice โดยไม่จำกัด (โตไม่มีที่สิ้นสุดตามอายุร้าน) เปลี่ยนเป็น runQuery + orderBy +
//   limit (เอาล่าสุดก่อน) เหมือน getActivityLog/getStockMovements — ครอบคลุมการใช้งานจริงเกือบทั้งหมด
//   เพราะร้านที่ออกใบกำกับภาษีเกิน 1,500 ใบสะสม ปกติจะกรองดูทีละปีอยู่แล้วไม่ได้ใช้มุมมอง "ทั้งหมด" นี้
function getTaxInvoiceList_(){var out=[],cursor='';do{var p=getTaxInvoiceListData_('all',{pageSize:200,cursor:cursor});out=out.concat(p.invoices);cursor=p.pageInfo.nextCursor;}while(cursor);return out;}

function getTaxInvoiceListData_(yearFilter,options){var page=queryDocumentPage_('Master_Tax_Invoice','Invoice_Date',yearFilter,options);return {invoices:page.docs.map(function(doc){return mapTaxInvoiceQueryDoc_(doc);}),pageInfo:page.pageInfo,availableYears:options&&options.cursor?undefined:getTaxInvoiceAvailableYears_()};}

function getTaxInvoicePageData_(yearFilter,options){var result=getTaxInvoiceListData_(yearFilter,options);result.customers=getCustomersFull_();result.products=getAllProducts_();result.seller=TAX_INVOICE_SELLER;return result;}

function deleteTaxInvoice_(docId) { return deleteFirestoreDocument_("Master_Tax_Invoice", docId); }

// ==========================================
// ★ Master — Quotation (ใบเสนอราคา)
//   ขอบเขตจริง (ตัดจากดีไซน์ต้นฉบับที่มี Reservation/ATP/Sales Order/Credit Limit
//   ออกไปทั้งหมด — ระบบยังไม่มี collection พวกนั้นจริง เอกสารนี้จึง "ไม่กระทบสต๊อก"
//   ทุกกรณี ตรงตามที่ดีไซน์ต้นฉบับตั้งใจไว้จริงๆ อยู่แล้ว)
// ==========================================
var QUOTATION_COLLECTION = "Quotations";
var QUOTATION_PREFIX     = "QT";
var QUOTATION_MARGIN_MIN = 15;   // % กำไรขั้นต้นขั้นต่ำก่อนเตือน (แจ้งเตือนอย่างเดียว ไม่บล็อกการบันทึก)
var QUOTATION_STATUSES   = ["ร่าง", "ส่งลูกค้าแล้ว", "ปิดงาน-ขายสำเร็จ", "ยกเลิก/ไม่ได้งาน"];

function calcQuoteTotals_(items, discPctRaw) {
  var subtotal = 0, costTotal = 0;
  (items || []).forEach(function(it) {
    var qty   = parseFloat(it.qty)       || 0;
    var price = parseFloat(it.unitPrice) || 0;
    var cost  = parseFloat(it.costPrice) || 0;
    subtotal  += qty * price;
    costTotal += qty * cost;
  });
  var discPct    = Math.max(0, Math.min(100, parseFloat(discPctRaw) || 0));
  var discAmount = Math.round(subtotal * discPct) / 100;
  var afterDisc  = Math.round((subtotal - discAmount) * 100) / 100;
  var vat        = Math.round(afterDisc * 0.07 * 100) / 100;
  var grandTotal = Math.round((afterDisc + vat) * 100) / 100;
  var profit     = Math.round((afterDisc - costTotal) * 100) / 100;
  var marginPct  = afterDisc > 0 ? Math.round((profit / afterDisc) * 1000) / 10 : 0;
  return {
    subtotal   : Math.round(subtotal * 100) / 100,
    discPct    : discPct,
    discAmount : discAmount,
    afterDisc  : afterDisc,
    vat        : vat,
    grandTotal : grandTotal,
    costTotal  : Math.round(costTotal * 100) / 100,
    profit     : profit,
    marginPct  : marginPct
  };
}

function buildQuoteNoForMonth_(quoteDateStr, runningNumber) {
  var d = quoteDateStr ? new Date(quoteDateStr + "T00:00:00") : new Date();
  if (isNaN(d.getTime())) d = new Date();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var yyBuddhist = String(d.getFullYear() + 543).slice(-2);
  return QUOTATION_PREFIX + " " + String(runningNumber).padStart(4, '0') + "/" + mm + "/" + yyBuddhist;
}

function getNextQuoteRunningNumber_(quoteDateStr, excludeDocId) {
  var targetSuffix = buildQuoteNoForMonth_(quoteDateStr, 1).split('/').slice(1).join('/');
  var fetched = {ok:true,docs:readDocumentNumberSeeds_(QUOTATION_COLLECTION,'Quote_No')};
  var maxNum = 0;
  if (fetched.ok) {
    fetched.docs.forEach(function(doc) {
      if (doc.id === excludeDocId) return;
      var f = doc.fields || {};
      var no = String(parseFirestoreValue_(f.Quote_No) || "");
      var m = no.match(/^QT\s+(\d+)\/(\d{2}\/\d{2})$/);
      if (m && m[2] === targetSuffix) {
        var num = parseInt(m[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
  }
  return maxNum + 1;
}

/**
 * บันทึกใบเสนอราคา — สแนปช็อตข้อมูลลูกค้า ณ เวลาที่เสนอ (กันข้อมูลลูกค้าเปลี่ยนย้อนหลัง
 * เหมือน saveTaxInvoice) แก้ไขซ้ำ (มี d.docId) จะคงเลขที่เดิม/สถานะเดิม/ผู้สร้างเดิมไว้
 * เพราะ saveMasterData ใช้ PATCH แบบเขียนทับทั้งฉบับ — ฟิลด์ไหนไม่ส่งไปจะหาย
 */
function saveQuotation_(d, callerUsername) {
  d = d || {};
  var items = Array.isArray(d.items) ? d.items : [];
  if (items.some(function(it) {
    return !it || !String(it.productCode || "").trim() || !isFinite(Number(it.qty)) || Number(it.qty) <= 0 ||
      it.unitPrice === "" || it.unitPrice === null || it.unitPrice === undefined ||
      !isFinite(Number(it.unitPrice)) || Number(it.unitPrice) < 0 ||
      !isFinite(Number(it.costPrice || 0)) || Number(it.costPrice || 0) < 0;
  })) return {success:false, message:"รายการสินค้าต้องมีจำนวนมากกว่า 0 และราคาตั้งแต่ 0 ขึ้นไป"};
  var cleanItems = items.filter(function(it) {
    return it && String(it.productCode || "").trim() && parseFloat(it.qty) > 0 && parseFloat(it.unitPrice) >= 0;
  }).map(function(it) {
    return {
      productCode : String(it.productCode).trim(),
      productName : String(it.productName || "").trim(),
      partNumber  : String(it.partNumber  || "").trim(),
      qty         : parseFloat(it.qty)       || 0,
      unitPrice   : parseFloat(it.unitPrice) || 0,
      costPrice   : parseFloat(it.costPrice) || 0
    };
  });
  if (!cleanItems.length) {
    return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ" };
  }
  if (!String(d.customerId || "").trim()) {
    return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณาเลือกลูกค้า" };
  }

  var existingDoc = null;
  if (d.docId) {
    try { existingDoc = readExistingDocument_(QUOTATION_COLLECTION, d.docId); }
    catch (e) { return {success:false, message:e.message}; }
  }
  var ef = existingDoc ? existingDoc.fields || {} : {};
  // Preserve the customer snapshot when editing the same document/customer.
  var cust = existingDoc && parseFirestoreValue_(ef.Customer_ID) === d.customerId ? {
    Customer_Name:parseFirestoreValue_(ef.Customer_Name) || "",
    Customer_Type:parseFirestoreValue_(ef.Customer_Type) || "",
    Address:parseFirestoreValue_(ef.Customer_Address) || "",
    Tax_ID:parseFirestoreValue_(ef.Customer_Tax_ID) || "",
    Branch:parseFirestoreValue_(ef.Customer_Branch) || "",
    Phone:parseFirestoreValue_(ef.Customer_Phone) || ""
  } : getCustomerById_(d.customerId);
  if (!cust) return { success: false, title: "ไม่พบข้อมูล", message: "ไม่พบลูกค้ารายนี้ในระบบ — อาจถูกลบไปแล้ว" };

  var quoteDate  = String(d.quoteDate || "").trim() || businessDate_();
  if (!isValidBusinessDate_(quoteDate)) {
    return {success:false, message:"วันที่ใบเสนอราคาไม่ถูกต้อง"};
  }
  var validDays  = parseInt(d.validDays, 10) || 15;
  var validUntil = addCalendarDays_(quoteDate,validDays);

  var totals = calcQuoteTotals_(cleanItems, d.discPct);
  var user   = callerUsername || getCurrentUsername_();
  var nowIso = new Date().toISOString();

  var quoteNo = "", status = "ร่าง", createdUser = user, createdAt = nowIso;
  if (existingDoc) {
    quoteNo     = parseFirestoreValue_(ef.Quote_No) || "";
    if (!quoteNo) return {success:false, message:"ไม่พบเลขที่เอกสารเดิม กรุณาตรวจสอบก่อนแก้ไข"};
    status      = parseFirestoreValue_(ef.Status) || "ร่าง";
    createdUser = parseFirestoreValue_(ef.User) || user;
    createdAt   = parseFirestoreValue_(ef.Timestamp) || nowIso;
  }

  var dataObject = {
    Quote_Date       : quoteDate,
    Valid_Days       : validDays,
    Valid_Until      : validUntil,
    Customer_ID      : d.customerId,
    Customer_Name    : cust.Customer_Name,
    Customer_Type    : cust.Customer_Type,
    Customer_Address : cust.Address,
    Customer_Tax_ID  : cust.Tax_ID,
    Customer_Branch  : cust.Branch,
    Customer_Phone   : cust.Phone,
    Vehicle_Note     : String(d.vehicleNote || "").trim(),
    Customer_PO      : String(d.customerPo  || "").trim(),
    Items_JSON       : JSON.stringify(cleanItems),
    Disc_Pct         : totals.discPct,
    Subtotal         : totals.subtotal,
    Disc_Amount      : totals.discAmount,
    Vat_Amount       : totals.vat,
    Grand_Total      : totals.grandTotal,
    Cost_Total       : totals.costTotal,
    Profit_Total     : totals.profit,
    Margin_Pct       : totals.marginPct,
    Status           : status,
    Note             : String(d.note || "").trim(),
    User             : createdUser,
    Timestamp        : createdAt,
    Updated_At       : nowIso
  };

  var quoteYearBE = new Date(quoteDate + "T00:00:00").getFullYear() + 543;

  if (d.docId && quoteNo) {
    dataObject.Quote_No = quoteNo;
    var editRes = saveMasterData_(QUOTATION_COLLECTION, QUOTATION_PREFIX, d.docId, dataObject, null, {updateTime:existingDoc.updateTime});
    if (editRes.success) {
      try { updateQuotationYearsMeta_(quoteYearBE); } catch (metaError) { editRes.refreshWarning="เอกสารบันทึกแล้ว แต่ปีในรายการยังไม่อัปเดต กรุณาแจ้งผู้ดูแลระบบ"; }
      var savedFields = Object.assign({}, ef, mapToFirestoreFields_(dataObject));
      editRes.quotation = mapQuotationDoc_({id:editRes.id, fields:savedFields});
    }
    return editRes;
  }

  var periodKey = docPeriodKey_(quoteDate);
  var lastErr = "";
  for (var attempt = 0; attempt < 10; attempt++) {
    // ★ FIX (โควตา Firestore Reads): ใช้ตัวนับแทนการสแกน Quotation ทั้ง collection ทุกครั้ง
    //   (ดูคำอธิบายเต็มที่ nextRunningNumber_) — seedFn (getNextQuoteRunningNumber เดิม) จะถูกเรียก
    //   แค่ครั้งเดียวตอนตัวนับของเดือนนี้ยังไม่เคยถูกสร้างเท่านั้น
    var runningNum = nextRunningNumber_("Quotation", periodKey, function() {
      return getNextQuoteRunningNumber_(quoteDate, d.docId || null);
    });
    if(runningNum===null)return {success:false,message:'ระบบเลขเอกสารไม่พร้อม กรุณาลองใหม่ภายหลัง'};
    var candidateNo = buildQuoteNoForMonth_(quoteDate, runningNum);

    // ★ จองเลขที่แบบ atomic ก่อนบันทึกจริง — กันเลขซ้ำเมื่อมีคนออกใบเสนอราคาพร้อมกัน (ดู reserveDocNo_)
    if (!reserveDocNo_("Quotation", candidateNo)) continue;

    dataObject.Quote_No = candidateNo;
    var res = saveMasterData_(QUOTATION_COLLECTION, QUOTATION_PREFIX, d.docId || null, dataObject, null);
    if (res.success) {
      try { updateQuotationYearsMeta_(quoteYearBE); } catch (metaError) { res.refreshWarning="เอกสารบันทึกแล้ว แต่ปีในรายการยังไม่อัปเดต กรุณาแจ้งผู้ดูแลระบบ"; }
      res.quotation = mapQuotationDoc_({id:res.id, fields:mapToFirestoreFields_(dataObject)});
      return res;
    }
    lastErr = res.message;
    if (String(res.message || "").indexOf("ALREADY_EXISTS") === -1 &&
        String(res.message || "").indexOf("409") === -1) {
      break;
    }
  }
  return { success: false, title: "ล้มเหลว", message: lastErr || "ไม่สามารถออกเลขที่ใบเสนอราคาได้ กรุณาลองอีกครั้ง" };
}

function mapQuotationDoc_(doc) {
  var f = doc.fields || {};
  var items = [];
  try { items = JSON.parse(parseFirestoreValue_(f.Items_JSON) || "[]"); } catch (e) {}
  return {
    id              : doc.id,
    quoteNo         : parseFirestoreValue_(f.Quote_No)          || doc.id,
    quoteDate       : parseFirestoreValue_(f.Quote_Date)        || "",
    validUntil      : parseFirestoreValue_(f.Valid_Until)       || "",
    validDays       : parseFloat(parseFirestoreValue_(f.Valid_Days)) || 0,
    customerId      : parseFirestoreValue_(f.Customer_ID)       || "",
    customerName    : parseFirestoreValue_(f.Customer_Name)     || "",
    customerType    : parseFirestoreValue_(f.Customer_Type)     || "",
    customerAddress : parseFirestoreValue_(f.Customer_Address)  || "",
    customerTaxId   : parseFirestoreValue_(f.Customer_Tax_ID)   || "",
    customerBranch  : parseFirestoreValue_(f.Customer_Branch)   || "",
    customerPhone   : parseFirestoreValue_(f.Customer_Phone)    || "",
    vehicleNote     : parseFirestoreValue_(f.Vehicle_Note)      || "",
    customerPo      : parseFirestoreValue_(f.Customer_PO)       || "",
    items           : items,
    discPct         : parseFloat(parseFirestoreValue_(f.Disc_Pct))     || 0,
    subtotal        : parseFloat(parseFirestoreValue_(f.Subtotal))     || 0,
    discAmount      : parseFloat(parseFirestoreValue_(f.Disc_Amount))  || 0,
    vat             : parseFloat(parseFirestoreValue_(f.Vat_Amount))   || 0,
    grandTotal      : parseFloat(parseFirestoreValue_(f.Grand_Total))  || 0,
    costTotal       : parseFloat(parseFirestoreValue_(f.Cost_Total))   || 0,
    profit          : parseFloat(parseFirestoreValue_(f.Profit_Total)) || 0,
    marginPct       : parseFloat(parseFirestoreValue_(f.Margin_Pct))   || 0,
    status          : parseFirestoreValue_(f.Status)    || "ร่าง",
    note            : parseFirestoreValue_(f.Note)      || "",
    user            : parseFirestoreValue_(f.User)      || "",
    timestamp       : parseFirestoreValue_(f.Timestamp) || "",
    updatedAt       : parseFirestoreValue_(f.Updated_At)|| "",
    stockIssued     : parseFirestoreValue_(f.Stock_Issued) === "true",
    stockIssueDoc   : parseFirestoreValue_(f.Stock_Issue_Doc) || "",
    stockIssuedBy   : parseFirestoreValue_(f.Stock_Issued_By) || "",
    stockIssuedAt   : parseFirestoreValue_(f.Stock_Issued_At) || ""
  };
}

// ★ FIX (โควตา Firestore Reads): ใช้ตอนเลือกมุมมอง "ทั้งหมด" (ทุกปีรวมกัน) — เดิมสแกนทั้ง
//   collection โดยไม่จำกัด (โตไม่มีที่สิ้นสุดตามอายุร้าน) เปลี่ยนเป็น runQuery + orderBy + limit
//   (เอาล่าสุดก่อน) เหมือน getTaxInvoiceList — ใช้งานปกติควรกรองดูทีละปีผ่าน getQuotationListByYear แทน
function getQuotationList_(){var out=[],cursor='';do{var p=getQuotationListData_('all',{pageSize:200,cursor:cursor});out=out.concat(p.quotations);cursor=p.pageInfo.nextCursor;}while(cursor);return out;}

// ★ FIX (โควตา Firestore Reads): กรองเฉพาะใบเสนอราคาของปีที่เลือกด้วย range query บน Quote_Date
//   ฝั่ง server เลย (pattern เดียวกับ getTaxInvoiceListByYear) แทนการอ่านทั้งหมดมากรองฝั่ง client
function getQuotationListByYear_(yearBE){var out=[],cursor='';do{var p=getQuotationListData_(yearBE,{pageSize:200,cursor:cursor});out=out.concat(p.quotations);cursor=p.pageInfo.nextCursor;}while(cursor);return out;}

var QUOTATION_YEARS_ID = "quotation_years";

// ★ เก็บรายชื่อปี (พ.ศ.) ที่มีใบเสนอราคาอยู่จริง ไว้ใช้สร้างตัวเลือกปีในหน้าเว็บ (pattern เดียวกับ
//   updateTaxInvoiceYearsMeta_ ของใบกำกับภาษี) — เรียกครั้งเดียวตอนบันทึกสำเร็จ ไม่ใช่ทุกครั้งที่โหลดหน้า
function updateQuotationYearsMeta_(yearBE) { appendYearMeta_(QUOTATION_YEARS_ID,yearBE); }

function getQuotationAvailableYears_() {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + META_COLLECTION + "/" + QUOTATION_YEARS_ID;
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader_(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200 && res.getResponseCode() !== 404) throw new Error("โหลดปีเอกสารไม่สำเร็จ");
    if (res.getResponseCode() === 200) {
      var doc = JSON.parse(res.getContentText());
      var years = parseFirestoreValue_((doc.fields || {}).Years) || [];
      years = years.map(function(y) { return parseInt(y, 10); }).sort(function(a, b) { return b - a; });
      if (years.length) return years;
    } else if (res.getResponseCode() === 404) {
      // ★ meta ปียังไม่เคยถูกสร้าง (ใบเสนอราคาเก่าก่อนหน้านี้ไม่เคยบันทึก meta ปีไว้ ต่างจากใบกำกับ
      //   ภาษีที่มี meta นี้มาตั้งแต่แรก) — สแกนหาปีทั้งหมดที่มีข้อมูลอยู่จริงครั้งเดียวเพื่อตั้งต้น
      //   หลังจากนี้ทุกครั้งจะอ่านแค่ meta doc เอกสารเดียว ไม่สแกนซ้ำอีกเลย
      return seedQuotationYearsMeta_();
    }
  } catch (e) {
    throw e;
  }
  return [new Date().getFullYear() + 543];
}

function seedQuotationYearsMeta_() {
  var fetched=fetchAllPagesRaw_(QUOTATION_COLLECTION),seen={};
  if(!fetched.ok)throw new Error("อ่านปีใบเสนอราคาไม่ครบ");
  fetched.docs.forEach(function(doc){var date=parseFirestoreValue_((doc.fields||{}).Quote_Date);if(validDateOnly_(date)) seen[new Date(date+"T00:00:00Z").getUTCFullYear()+543]=true;});
  var years=Object.keys(seen).map(Number);if(!years.length)years=[new Date().getFullYear()+543];
  years.forEach(updateQuotationYearsMeta_);
  return getQuotationAvailableYears_();
}

// ★ FIX (โควตา Firestore Reads): รับ yearFilter เพิ่ม — ค่าเริ่มต้น (ไม่ส่ง/undefined) ใช้ปีปัจจุบัน
//   แทนการดึงใบเสนอราคาทั้งหมดทุกปีเหมือนเดิม (getQuotationList เต็มยังเรียกได้ถ้าส่ง "all" มาชัดเจน)
function getQuotationListData_(yearFilter,options){var page=queryDocumentPage_('Quotations','Quote_Date',yearFilter,options);return {quotations:page.docs.map(function(doc){return mapQuotationDoc_({id:doc.name.split('/').pop(),fields:doc.fields||{}});}),pageInfo:page.pageInfo,availableYears:options&&options.cursor?undefined:getQuotationAvailableYears_()};}

function getQuotationPageData_(yearFilter,options){var result=getQuotationListData_(yearFilter,options);result.customers=getCustomersFull_();result.products=getAllProducts_();result.seller=TAX_INVOICE_SELLER;result.marginMin=QUOTATION_MARGIN_MIN;result.statuses=QUOTATION_STATUSES;return result;}

function updateQuotationStatus_(docId, status) {
  if (QUOTATION_STATUSES.indexOf(status) === -1) {
    return { success: false, title: "ไม่ถูกต้อง", message: "สถานะไม่ถูกต้อง" };
  }
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + QUOTATION_COLLECTION + "/" + docId
            + "?updateMask.fieldPaths=Status&updateMask.fieldPaths=Updated_At";
    var res = UrlFetchApp.fetch(url, {
      method  : "patch",
      headers : getAuthHeader_(),
      payload : JSON.stringify({ fields: mapToFirestoreFields_({ Status: status, Updated_At: new Date().toISOString() }) }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      clearCollectionCache_(QUOTATION_COLLECTION);
      return { success: true, title: "สำเร็จ", message: "เปลี่ยนสถานะเรียบร้อย" };
    }
    return { success: false, title: "ล้มเหลว", message: res.getContentText() };
  } catch (e) {
    return { success: false, title: "ข้อผิดพลาด", message: e.message };
  }
}

function deleteQuotation_(docId) { return deleteFirestoreDocument_(QUOTATION_COLLECTION, docId); }

/**
 * ★ ทำเครื่องหมายว่าใบเสนอราคานี้ถูกตัดสต๊อกไปแล้ว (เรียกจากหน้าตัดสต๊อกหลังยืนยันตัดสต๊อกสำเร็จ
 *   ที่มาจากปุ่ม "ตัดสต๊อกจากใบนี้" ในหน้าใบเสนอราคา) — ใช้ updateMask ให้กระทบแค่ 4 ฟิลด์นี้
 *   ไม่ทับข้อมูลอื่นของใบเสนอราคา (ต่างจาก saveMasterData ที่ PATCH แบบไม่มี updateMask)
 */
function markQuotationStockIssued_(docId, docNo, callerUsername) {
  try{
    var movement=readExistingDocument_(STOCK_MOVEMENT_COLLECTION,String(docNo)+"-1"),fields=movement.fields||{};
    if(parseFirestoreValue_(fields.Quote_Id)!==docId || parseFirestoreValue_(fields.User)!==callerUsername) return {success:false,message:"รายการตัดสต๊อกไม่ตรงกับใบเสนอราคา"};
    var quote=readExistingDocument_(QUOTATION_COLLECTION,docId),f=quote.fields||{};
    if(parseFirestoreValue_(f.Stock_Issued)!=="true") return {success:false,message:"ข้อมูลอ้างอิงการตัดสต๊อกไม่ครบ กรุณาแจ้งผู้ดูแลระบบ"};
    return {success:true};
  }catch(e){return {success:false,message:e.message};}
}

// ==========================================
// 17. Master — Zones
// ==========================================
function saveZone_(d) {
  d = d || {};
  var area = String(d.area || "").trim();
  var rack = String(d.rackNo || "").trim();
  var level = String(d.rackLevel || "").trim();
  if (!area) return {success:false, message:"กรุณากรอกพื้นที่"};
  if (level && !/^[1-5]$/.test(level)) return {success:false, message:"ระดับแร็คต้องเป็น 1–5 เท่านั้น"};
  if (level && !rack) return {success:false, message:"กรุณาระบุเลขแร็คก่อนเลือกระดับแร็ค"};
  var existing = null;
  if (d.docId) {
    try { existing = readExistingDocument_("Master_Zones", d.docId); }
    catch (e) { return {success:false, message:e.message}; }
  }
  var oldFields = existing ? existing.fields || {} : {};
  if (d.rackLevel === undefined && rack && rack === String(parseFirestoreValue_(oldFields.Rack_no) || "").trim()) {
    level = String(parseFirestoreValue_(oldFields.Rack_Level) || "");
  }
  // An unchanged legacy rack may remain unspecified; new or changed racks require a level.
  var legacyRack = existing && !parseFirestoreValue_(oldFields.Rack_Level) &&
    String(parseFirestoreValue_(oldFields.Rack_no) || "").trim() === rack;
  if (rack && !level && !legacyRack) return {success:false, message:"กรุณาเลือกระดับแร็ค 1–5"};
  var dataObject = {
    Area    : area,
    Build   : String(d.build   || ""),
    Floor   : String(d.floor   || ""),
    Rack_no : rack,
    Rack_Level : level,
    Note    : String(d.note    || ""),
    Car_ID  : String(d.carId === undefined ? parseFirestoreValue_(oldFields.Car_ID) || "" : d.carId),
    Status  : String(d.status || parseFirestoreValue_(oldFields.Status) || "Active")
  };
  // Preserve the existing Area uniqueness policy; rack levels do not relax duplicate checks.
  return saveMasterData_("Master_Zones", "Z", d.docId || null, dataObject, area,
    existing ? {updateTime:existing.updateTime} : null);
}

function getZoneById_(docId) {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Master_Zones/" + docId;
    var res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: getAuthHeader_(),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      var doc = JSON.parse(res.getContentText());
      var f   = doc.fields || {};
      return {
        id      : docId,
        Area    : parseFirestoreValue_(f.Area)    || "",
        Build   : parseFirestoreValue_(f.Build)   || "",
        Floor   : parseFirestoreValue_(f.Floor)   || "",
        Rack_no : parseFirestoreValue_(f.Rack_no) || "",
        Rack_Level : parseFirestoreValue_(f.Rack_Level) || "",
        Note    : parseFirestoreValue_(f.Note)    || "",
        Car_ID  : parseFirestoreValue_(f.Car_ID)  || "",
        Status  : parseFirestoreValue_(f.Status)  || ""
      };
    }
  } catch (e) {
    console.error("getZoneById error:", e);
  }
  return null;
}

function getZonesFull_() {
  var list = [];
  try {
    var docs = fetchCollectionDocsCached_("Master_Zones");
    docs.forEach(function(doc) {
      var f = doc.fields || {};
      list.push({
        id      : doc.id,
        Area    : parseFirestoreValue_(f.Area)    || "",
        Build   : parseFirestoreValue_(f.Build)   || "",
        Floor   : parseFirestoreValue_(f.Floor)   || "",
        Rack_no : parseFirestoreValue_(f.Rack_no) || "",
        Rack_Level : parseFirestoreValue_(f.Rack_Level) || "",
        Note    : parseFirestoreValue_(f.Note)    || "",
        Car_ID  : parseFirestoreValue_(f.Car_ID)  || "",
        Status  : parseFirestoreValue_(f.Status)  || ""
      });
    });
  } catch (e) { console.error("getZonesFull_ read failed", e); throw e; }
  return list;
}

function deleteZone_(docId) { return deleteFirestoreDocument_("Master_Zones", docId); }

// ==========================================
// 18. Master — Cars
// ==========================================
function saveCar_(d) {
  var dataObject = {
    _expectedUpdateTime:d.expectedUpdateTime||"",
    Brand    : String(d.brand   || ""),
    Type_Car : String(d.typeCar || ""),
    Model    : String(d.model   || ""),
    Year     : String(d.year    || ""),
    Model_Code:String(d.modelCode||""),Note:String(d.note||"")
  };
  if(d.docId){
    try{var existing=readExistingDocument_('Master_Cars',d.docId);if(d.modelCode===undefined)delete dataObject.Model_Code;if(d.note===undefined)delete dataObject.Note;}
    catch(e){return {success:false,message:e.message};}
  }
  if(dataObject.Model_Code){try{if(hasNormalizedDuplicate_('Master_Cars','Model_Code',dataObject.Model_Code,d.docId))return {success:false,message:'รหัสรุ่นนี้มีอยู่แล้ว'};}catch(e){return {success:false,message:'ตรวจสอบข้อมูลซ้ำไม่สำเร็จ'};}}
  return saveMasterData_("Master_Cars", "CAR", d.docId || null, dataObject, null);
}

function getCarsFull_() {
  var list = [];
  try {
    var docs = fetchCollectionDocsCached_("Master_Cars");
    docs.forEach(function(doc) {
      var f = doc.fields || {};
      list.push({
        id       : doc.id,
        updateTime:doc.updateTime||"",
        Model_Code:parseFirestoreValue_(f.Model_Code)||"",
        Note:parseFirestoreValue_(f.Note)||"",
        Brand    : parseFirestoreValue_(f.Brand)    || "",
        Type_Car : parseFirestoreValue_(f.Type_Car) || "",
        Model    : parseFirestoreValue_(f.Model)    || "",
        Year     : parseFirestoreValue_(f.Year)     || ""
      });
    });
  } catch (e) { console.error("getCarsFull_ read failed", e); throw e; }
  return list;
}

function deleteCar_(docId) { return deleteFirestoreDocument_("Master_Cars", docId); }

// ==========================================
// 19. Include HTML
// ==========================================
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ==========================================
// 19b. ★ ระบบสำรองข้อมูล (Backup / Restore)
// ==========================================
var BACKUP_FOLDER_NAME  = "SYY Shop - Backups";
var BACKUP_KEEP_COUNT   = 8;
var BACKUP_COLLECTIONS  = [
  "Master_Brands", "Master_Categories", "Master_Vendors", "Master_Customers",
  "Master_Zones", "Master_Cars", "Master_Products", "Master_Tax_Invoice", "Purchase_Orders",
  "Quotations", "Stock_Movements", "Product_Images", "Master_Users",
  "Doc_Running_Numbers", "Doc_No_Reservations", "Meta_Counters", "Activity_Log"
];

function getOrCreateBackupFolder_() {
  var folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

function backupAllDataToBackup_() {
  var result={success:false,collections:{},errors:[]},transaction="",assetFolder=null,manifest=null;
  var endpoint="https://firestore.googleapis.com/v1/projects/"+PROJECT_ID+"/databases/(default)/documents";
  try {
    var folder=getOrCreateBackupFolder_();assertPrivateBackupFolder_(folder);
    var properties=backupScriptProperties_();
    var begin=UrlFetchApp.fetch(endpoint+":beginTransaction",{method:"post",headers:getAuthHeader_(),payload:JSON.stringify({options:{readOnly:{}}}),muteHttpExceptions:true});
    if(begin.getResponseCode()!==200)throw new Error("เริ่ม Backup snapshot ไม่สำเร็จ");
    transaction=JSON.parse(begin.getContentText()).transaction;
    if(!transaction)throw new Error("ไม่พบ Backup transaction");
    var snapshot={};BACKUP_COLLECTIONS.forEach(function(name){snapshot[name]=fetchBackupSnapshotCollection_(name,transaction);result.collections[name]=snapshot[name].length;});
    var ids={};snapshot.Product_Images.forEach(function(doc){imageDataFromFields_(doc.fields).ids.forEach(function(id){if(!id)throw new Error("รูปสินค้ามี URL แต่ไม่มี Drive File ID");ids[id]=true;});});
    var suffix=Utilities.formatDate(new Date(),"Asia/Bangkok","yyyy-MM-dd_HH-mm-ss")+"_"+Utilities.getUuid();
    assetFolder=folder.createFolder("syy-shop-assets_"+suffix);assertPrivateBackupFolder_(assetFolder);
    var assets=[];
    Object.keys(ids).forEach(function(id){
      var original=DriveApp.getFileById(id),before=original.getLastUpdated().getTime(),blob=original.getBlob(),digest=backupDigest_(blob.getBytes());
      var copy=assetFolder.createFile(blob).setName(original.getName());assertPrivateBackupItem_(copy);
      if(original.getLastUpdated().getTime()!==before || backupDigest_(copy.getBlob().getBytes())!==digest)throw new Error("รูปสินค้าถูกแก้ไขระหว่าง Backup");
      assets.push({originalId:id,backupId:copy.getId(),digest:digest});
    });
    if(backupJsonDigest_(properties)!==backupJsonDigest_(backupScriptProperties_()))throw new Error("Script Properties เปลี่ยนแปลงระหว่าง Backup กรุณาลองใหม่");
    var bundle={schemaVersion:2,complete:true,backupDate:new Date().toISOString(),projectId:PROJECT_ID,collections:snapshot,scriptProperties:properties,assets:assets,assetFolderId:assetFolder.getId()};
    bundle.digest=backupJsonDigest_({collections:snapshot,scriptProperties:properties,assets:assets,assetFolderId:bundle.assetFolderId});
    validateBackupBundle_(bundle);
    result.fileName="syy-shop-backup_"+suffix+".json";
    var text=JSON.stringify(bundle);manifest=folder.createFile(result.fileName,text,MimeType.PLAIN_TEXT);assertPrivateBackupItem_(manifest);
    result.fileSizeKB=Math.round(text.length/1024);result.fileId=manifest.getId();result.success=true;
    cleanupOldBackups_(folder);
  } catch(e) {
    result.errors.push(e.message);
    if(manifest){try{manifest.setTrashed(true);}catch(ignore){}}
    if(assetFolder){try{assetFolder.setTrashed(true);}catch(ignore){}}
  } finally {
    if(transaction){try{UrlFetchApp.fetch(endpoint+":rollback",{method:"post",headers:getAuthHeader_(),payload:JSON.stringify({transaction:transaction}),muteHttpExceptions:true});}catch(ignore){}}
  }
  return result;
}

function cleanupOldBackups_(folder) {
  try {
    assertPrivateBackupFolder_(folder);
    var files = folder.getFilesByType(MimeType.PLAIN_TEXT);
    var fileList = [];
    while (files.hasNext()) {
      var f = files.next();
      if (f.getName().indexOf("syy-shop-backup_") === 0) {
        fileList.push({ file: f, date: f.getDateCreated() });
      }
    }
    fileList.sort(function(a, b) { return b.date - a.date; });

    for (var i = BACKUP_KEEP_COUNT; i < fileList.length; i++) {
      var old=fileList[i].file,bundle=JSON.parse(old.getBlob().getDataAsString());
      if(bundle.schemaVersion===2 && bundle.assetFolderId){
        var assets=DriveApp.getFolderById(bundle.assetFolderId),parents=assets.getParents(),owned=false;
        while(parents.hasNext())if(parents.next().getId()===folder.getId())owned=true;
        if(!owned || assets.getName()!==old.getName().replace("syy-shop-backup_","syy-shop-assets_").replace(/\.json$/,""))throw new Error("Backup asset folder ไม่ตรง");
        assertPrivateBackupFolder_(assets);assets.setTrashed(true);
      }
      old.setTrashed(true);
    }
  } catch (e) {
    console.error("cleanupOldBackups error:", e);
  }
}

function backupNow_() {
  return backupAllDataToBackup_();
}

function weeklyBackupJob_() {
  var result = backupAllDataToBackup_();
  if (!result.success) {
    console.error("weeklyBackupJob ล้มเหลวบางส่วน:", JSON.stringify(result.errors));
  }
}

function setupWeeklyBackupTrigger_() {
  removeWeeklyBackupTrigger_();
  ScriptApp.newTrigger("weeklyBackupJob_")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(2)
    .create();
  return "ตั้งเวลา backup อัตโนมัติทุกวันอาทิตย์ เวลา 02:00 น. เรียบร้อยแล้ว";
}

function removeWeeklyBackupTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    var handler = t.getHandlerFunction();
    if (handler === "weeklyBackupJob" || handler === "weeklyBackupJob_") ScriptApp.deleteTrigger(t);
  });
}

function listBackupFiles_() {
  var list = [];
  try {
    var folder = getOrCreateBackupFolder_();
    assertPrivateBackupFolder_(folder);
    var files = folder.getFilesByType(MimeType.PLAIN_TEXT);
    while (files.hasNext()) {
      var f = files.next();
      if (f.getName().indexOf("syy-shop-backup_") === 0) {
        list.push({
          id: f.getId(), name: f.getName(),
          date: f.getDateCreated().toISOString(),
          sizeKB: Math.round(f.getSize() / 1024),
          url: f.getUrl()
        });
      }
    }
    list.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
  } catch (e) {
    throw e;
  }
  return list;
}

function restoreFromBackup_(fileId, restoreMode, options) {
  options=options||{};
  var result={success:false,dryRun:options.confirmRestore!==true,restored:{},errors:[]};
  try{
    var file=DriveApp.getFileById(fileId);assertPrivateBackupItem_(file);
    var bundle=JSON.parse(file.getBlob().getDataAsString()),assets=validateBackupBundle_(bundle,options.sourceProjectId);
    var names=restoreMode && restoreMode!=="all" ? [restoreMode] : BACKUP_COLLECTIONS.slice();
    if(names.some(function(n){return BACKUP_COLLECTIONS.indexOf(n)<0;}))throw new Error("ชุดข้อมูลที่จะกู้คืนไม่ถูกต้อง");
    names.forEach(function(n){result.restored[n]={planned:bundle.collections[n].length,restored:0};});
    if(result.dryRun){result.success=true;return result;}
    // Recovery rehearsal writes only to an explicitly selected empty staging database.
    var target=String(options.targetProjectId||"");
    if(!/^[a-z][a-z0-9-]{4,62}$/.test(target)||target===bundle.projectId || target!==PROJECT_ID || options.confirmStagingScript!==true)throw new Error("ต้องระบุโปรเจกต์ Staging ที่ว่างสำหรับกู้คืน; Production ต้องใช้แผนที่อนุมัติแยกต่างหาก");
    var endpoint="https://firestore.googleapis.com/v1/projects/"+target+"/databases/(default)/documents";
    names.forEach(function(n){var res=UrlFetchApp.fetch(endpoint+"/"+n+"?pageSize=1",{method:"get",headers:getAuthHeader_(),muteHttpExceptions:true});
      if(res.getResponseCode()!==200 || (JSON.parse(res.getContentText()).documents||[]).length)throw new Error("Staging ต้องว่างและเข้าถึงได้ก่อนกู้คืน");});
    if(names.indexOf("Master_Users")>=0 && !options.restoreProperties)throw new Error("กู้คืนบัญชีต้องกู้คืน Script Properties ในสคริปต์ Staging ด้วย");
    if(options.restoreProperties && options.confirmStagingScript!==true)throw new Error("ต้องยืนยันว่าเรียกจากสคริปต์ Staging ก่อนกู้คืน Properties");
    var remap={},copies=[];
    if(names.indexOf("Product_Images")>=0){
      var imageFolder=DriveApp.createFolder("SYY Shop - Recovery Images "+Utilities.getUuid());
      assertPrivateBackupFolder_(imageFolder);
      Object.keys(assets).forEach(function(id){var source=DriveApp.getFileById(assets[id].backupId),copy=imageFolder.createFile(source.getBlob()).setName(source.getName());copies.push(copy.getId());
        if(backupDigest_(copy.getBlob().getBytes())!==assets[id].digest)throw new Error("รูปที่กู้คืน checksum ไม่ตรง");
        copy.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);remap[id]=copy.getId();});
    }
    var writes=[];
    names.forEach(function(n){bundle.collections[n].forEach(function(doc){
      var fields=JSON.parse(JSON.stringify(doc.fields));
      if(n==="Product_Images"){
        var data=imageDataFromFields_(fields),ids=data.ids.map(function(id){return remap[id];}),urls=ids.map(function(id){return "https://lh3.googleusercontent.com/d/"+id;});
        fields=mapToFirestoreFields_({Image_Url:urls[data.primaryIndex]||"",Drive_File_Id:ids[data.primaryIndex]||"",Image_Urls:urls,Drive_File_Ids:ids,Primary_Index:data.primaryIndex,Images_JSON:JSON.stringify(urls.map(function(url,i){return {url:url,fileId:ids[i]};}))});
      }
      if(n==="Master_Users")fields.Session_Version={stringValue:Utilities.getUuid()};
      writes.push({update:{name:"projects/"+target+"/databases/(default)/documents/"+n+"/"+doc.id,fields:fields},currentDocument:{exists:false}});
    });});
    for(var i=0;i<writes.length;i+=450){var part=writes.slice(i,i+450),res=UrlFetchApp.fetch(endpoint+":commit",{method:"post",headers:getAuthHeader_(),payload:JSON.stringify({writes:part}),muteHttpExceptions:true});
      if(res.getResponseCode()!==200)throw new Error("กู้คืนไม่ครบ: หยุดก่อนชุดถัดไป กรุณาตรวจ Staging");
      part.forEach(function(w){var n=w.update.name.split('/documents/')[1].split('/')[0];result.restored[n].restored++;});}
    if(options.restoreProperties){
      var props=JSON.parse(JSON.stringify(bundle.scriptProperties));
      props[PRODUCT_IMAGE_FOLDER_PROP_KEY]=imageFolder ? imageFolder.getId() : PropertiesService.getScriptProperties().getProperty(PRODUCT_IMAGE_FOLDER_PROP_KEY)||"";
      PropertiesService.getScriptProperties().setProperties(props,false);
    }
    if(imageFolder)PropertiesService.getScriptProperties().setProperty(PRODUCT_IMAGE_FOLDER_PROP_KEY,imageFolder.getId());
    names.forEach(clearCollectionCache_);result.imageFileMap=remap;result.success=true;
  }catch(e){result.errors.push(e.message);}
  return result;
}

// ==========================================
// 20. ทดสอบการเชื่อมต่อ
// ==========================================
// ==========================================
// 21. Migrate ข้อมูลเก่า Car_ID เดี่ยว → Car_IDs array
// ==========================================
function migrateCarIdToCarIds_() {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Master_Products?pageSize=300";
    var res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: getAuthHeader_(),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      Logger.log("Fetch failed: " + res.getResponseCode());
      return;
    }
    var json = JSON.parse(res.getContentText());
    var count = 0;
    (json.documents || []).forEach(function(doc) {
      var id = doc.name.split('/').pop();
      var f  = doc.fields || {};

      if (f.Car_IDs) return;

      var legacyCarId = parseFirestoreValue_(f.Car_ID);
      if (!legacyCarId) return;

      var patchUrl = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
                    + "/databases/(default)/documents/Master_Products/" + id
                    + "?updateMask.fieldPaths=Car_IDs";
      var payload = {
        fields: {
          Car_IDs: { arrayValue: { values: [{ stringValue: legacyCarId }] } }
        }
      };
      UrlFetchApp.fetch(patchUrl, {
        method: "patch",
        headers: getAuthHeader_(),
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      count++;
    });
    Logger.log("Migrated " + count + " products from Car_ID to Car_IDs");
  } catch (e) {
    console.error("migrateCarIdToCarIds error:", e);
  }
}

// ==========================================
// 22. ★ ระบบสั่งซื้อสินค้า (Purchase Orders)
// ==========================================
function getLowStockProductsForOrder_() {
  return buildLowStockList_(buildVendorMap_());
}

function buildLowStockList_(vendorMap) {
  var result = [];
  try {
    var products = getAllProducts_();
    result = products
      .filter(function(p) { return p.currentStock <= p.minStock; })
      .map(function(p) {
        var v = vendorMap[p.vendorId] || {};
        var suggestedQty = Math.max((p.minStock - p.currentStock), 1);
        return {
          productCode   : p.productCode,
          productName   : p.productName,
          partType      : p.partType,
          brandName     : p.brandName,
          categoryName  : p.categoryName,
          zoneName      : p.zoneName,
          carModel      : p.carModel,
          costPrice     : p.costPrice,
          currentStock  : p.currentStock,
          minStock      : p.minStock,
          suggestedQty  : suggestedQty,
          vendorId      : p.vendorId,
          vendorName    : v.Vendor_name  || p.vendorName || "",
          vendorContact : v.Contact_name || "",
          vendorPhone   : v.Phone        || "",
          vendorEmail   : v.Email        || "",
          vendorAddress : v.Address      || "",
          vendorTaxId   : v.Tax_ID       || "",
          vendorBranch  : v.Branch       || ""
        };
      });
  } catch (e) { console.error("buildLowStockList_ read failed", e); throw e; }
  return result;
}

function savePurchaseOrder_(d) {
  d = d || {};
  if (!validDateOnly_(d.orderDate)) return {success:false, message:"วันที่สั่งซื้อไม่ถูกต้อง"};
  if (["Pending","Ordered"].indexOf(d.status || "Pending") < 0) return {success:false, message:"สถานะใบสั่งซื้อไม่ถูกต้อง"};
  var items = Array.isArray(d.items) ? d.items : [];
  if (!d.vendorId)   return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณาระบุผู้จัดจำหน่าย" };
  if (!items.length) return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณาเลือกสินค้าอย่างน้อย 1 รายการ" };

  if (items.length > 200 || items.some(function(it) {return !it || !validDocumentId_(it.productCode) || !validBusinessNumber_(it.qty,0,true) || !validBusinessNumber_(it.costPrice,0,false);})) return {success:false, message:"จำนวนและต้นทุนสินค้าต้องถูกต้อง"};
  var seenCodes = {};
  try {
    readExistingDocument_("Master_Vendors", d.vendorId);
    items.forEach(function(it) {
      if (seenCodes[it.productCode]) throw new Error("สินค้าซ้ำในใบสั่งซื้อ");
      seenCodes[it.productCode] = true;
      var doc = readExistingDocument_("Master_Products", it.productCode);
      it.productName = parseFirestoreValue_((doc.fields || {}).Product_Name) || it.productCode;
    });
  } catch (e) {return {success:false, message:e.message};}
  var totalQty = 0, totalAmount = 0;
  items = items.map(function(it) {
    var qty  = Number(it.qty);
    var cost = Number(it.costPrice);
    totalQty    += qty;
    totalAmount += qty * cost;
    return {
      productCode : it.productCode,
      productName : it.productName,
      qty         : qty,
      costPrice   : cost,
      receivedQty : 0
    };
  });

  if(!isFinite(totalQty)||!isFinite(totalAmount)||totalQty>Number.MAX_SAFE_INTEGER||totalAmount>Number.MAX_SAFE_INTEGER)return {success:false,message:"จำนวนหรือยอดรวมเกินช่วงที่ระบบรองรับ"};
  var dataObject = {
    Vendor_ID     : String(d.vendorId  || ""),
    Order_Date    : String(d.orderDate || businessDate_()),
    Status        : String(d.status    || "Pending"),
    Items_JSON    : JSON.stringify(items),
    Receipts_JSON : JSON.stringify([]),
    Total_Qty     : totalQty,
    Total_Amount  : totalAmount,
    Note          : String(d.note || "")
  };

  var result=saveMasterData_("Purchase_Orders","PO",null,dataObject,null);
  if(result.success)result.po=purchaseOrderDto_({id:result.id,fields:mapToFirestoreFields_(dataObject)},{});
  return result;
}

function buildVendorMap_() {
  var vendorMap = {};
  getVendorsFull_().forEach(function(v) { vendorMap[v.id] = v; });
  return vendorMap;
}

function getPurchaseOrders_() {
  return buildPurchaseOrderList_(buildVendorMap_());
}

// ★ FIX (โควตา Firestore Reads): เดิมสแกน Purchase_Orders ทั้ง collection ทุกครั้ง (ทั้งหน้า PO เอง
//   และตอน dashboard เรียก getDashboardBootstrap) เปลี่ยนเป็น runQuery + orderBy + limit เหมือนจุดอื่น
function buildPurchaseOrderList_(vendorMap){var out=[],cursor='';do{var page=queryDocumentPage_('Purchase_Orders','Order_Date','all',{pageSize:200,cursor:cursor});out=out.concat(page.docs.map(function(doc){return purchaseOrderDto_({id:doc.name.split('/').pop(),fields:doc.fields},vendorMap);}));cursor=page.pageInfo.nextCursor;}while(cursor);return out;}

function getPurchaseOrderPageData_(options){options=options||{};if(options.poId)return {po:getPurchaseOrderById_(options.poId)};var vendors=buildVendorMap_(),page=queryDocumentPage_('Purchase_Orders','Order_Date','all',options),result={purchaseOrders:page.docs.map(function(doc){return purchaseOrderDto_({id:doc.name.split('/').pop(),fields:doc.fields},vendors);}),pageInfo:page.pageInfo};if(!options.cursor){result.lowStockItems=buildLowStockList_(vendors);result.pendingSummary=getPendingPurchaseOrderSummary_(page.pageInfo.readTime);}return result;}

function updatePurchaseOrderStatus_(docId, newStatus) {
  try {
    if (["Pending","Ordered","Cancelled"].indexOf(newStatus) < 0) return {success:false, message:"สถานะไม่ถูกต้อง"};
    if (newStatus === "Received" || newStatus === "PartiallyReceived") {
      return { success: false, title: "ไม่อนุญาต", message: "กรุณาใช้ปุ่ม '📥 รับสินค้า' เพื่อบันทึกการรับสินค้าแทน" };
    }

    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Purchase_Orders/" + docId;
    var getRes = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader_(), muteHttpExceptions: true });
    if (getRes.getResponseCode() !== 200) {
      return { success: false, title: "ไม่พบข้อมูล", message: "ไม่พบใบสั่งซื้อนี้" };
    }
    var currentDoc = JSON.parse(getRes.getContentText());
    if (!currentDoc.updateTime) throw new Error("ไม่พบเวอร์ชันใบสั่งซื้อ");
    var currentStatus = parseFirestoreValue_((currentDoc.fields || {}).Status) || "Pending";

    if (currentStatus === "Received" || currentStatus === "Cancelled" || currentStatus === "PartiallyReceived") {
      return { success: false, title: "ไม่อนุญาต", message: "ใบสั่งซื้อนี้ได้รับสินค้าครบแล้ว ไม่สามารถเปลี่ยนสถานะได้อีก" };
    }
    if (newStatus === "Cancelled" && currentStatus === "PartiallyReceived") {
      return { success: false, title: "ไม่อนุญาต", message: "ใบสั่งซื้อนี้มีการรับสินค้าบางส่วนแล้ว ไม่สามารถยกเลิกได้" };
    }

    var payload = { fields: { Status: { stringValue: String(newStatus || "Pending") } } };
    var res = UrlFetchApp.fetch(url + "?updateMask.fieldPaths=Status&currentDocument.updateTime=" + encodeURIComponent(currentDoc.updateTime), {
      method             : "patch",
      headers            : getAuthHeader_(),
      payload            : JSON.stringify(payload),
      muteHttpExceptions : true
    });
    return res.getResponseCode() === 200
      ? { success: true,  title: "สำเร็จ",       message: "อัปเดตสถานะเรียบร้อย" }
      : { success: false, title: "ล้มเหลว",       message: "ข้อมูลเปลี่ยนแปลงแล้ว หรือบันทึกไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่" };
  } catch (e) {
    return { success: false, title: "ข้อผิดพลาด", message: e.message };
  }
}

function incrementProductStockBatch_(items) {
  var list = (items || []).filter(function(it) { return it && it.productCode && parseFloat(it.qty || 0) > 0; });
  if (!list.length) return true;

  try {
    var docPrefix = "projects/" + PROJECT_ID + "/databases/(default)/documents/Master_Products/";
    var writes = list.map(function(it) {
      return {
        transform: {
          document: docPrefix + it.productCode,
          fieldTransforms: [{
            fieldPath: "Current_Stock",
            increment: { doubleValue: parseFloat(it.qty || 0) }
          }]
        }
      };
    });

    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents:commit";
    var res = UrlFetchApp.fetch(url, {
      method            : "post",
      headers           : getAuthHeader_(),
      payload           : JSON.stringify({ writes: writes }),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() === 200) { clearCollectionCache_("Master_Products"); return true; }
    console.error("incrementProductStockBatch HTTP " + res.getResponseCode() + ": " + res.getContentText());
    return false;
  } catch (e) {
    console.error("incrementProductStockBatch error:", e);
    return false;
  }
}

function receiveGoods_(d, callerUsername) {
  function fail(msg) { return { success: false, title: "ข้อมูลไม่ครบ", message: msg }; }
  var commitAttempted=false;
  try {
    d = d || {};
    if (!d.poId) return fail("ไม่พบเลขที่ใบสั่งซื้อ");
    if (!String(d.invoiceNo || "").trim()) return fail("กรุณากรอกเลขที่ Invoice");
    if (!validDateOnly_(d.receiptDate)) return fail("กรุณาระบุวันที่รับสินค้า");
    if (!String(d.receiverName || "").trim()) return fail("กรุณากรอกชื่อผู้รับสินค้า");
    var reqItems = Array.isArray(d.items) ? d.items : [];
    if (!reqItems.length || reqItems.length > 200 || reqItems.some(function(it) {return !it || !validDocumentId_(it.productCode) || !validBusinessNumber_(it.qtyReceivedNow,0,true);})) return fail("จำนวนสินค้าที่รับต้องมากกว่า 0 และไม่เกิน 200 รายการ");

    var user = callerUsername || getCurrentUsername_();
    var request = stockRequest_("SR",d,user), replay = replayStockRequest_(request);
    if (replay) return replay;
    var nowIso = new Date().toISOString(), docNo = request.docNo;
    var poUrl = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
              + "/databases/(default)/documents/Purchase_Orders/" + d.poId;
    var MAX_ATTEMPTS = 3;

    for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      var res = UrlFetchApp.fetch(poUrl, { method:"get", headers:getAuthHeader_(), muteHttpExceptions:true });
      if (res.getResponseCode() !== 200) return fail("ไม่พบใบสั่งซื้อนี้");
      var poDoc = JSON.parse(res.getContentText());
      if (!poDoc.updateTime) throw new Error("ไม่พบเวอร์ชันใบสั่งซื้อ");
      var f = poDoc.fields || {};
      var currentStatus = parseFirestoreValue_(f.Status) || "Pending";
      if (currentStatus === "Received") return fail("ใบสั่งซื้อนี้ได้รับสินค้าครบแล้ว ไม่สามารถบันทึกรับซ้ำได้");
      if (currentStatus === "Cancelled") return fail("ใบสั่งซื้อนี้ถูกยกเลิกแล้ว ไม่สามารถรับสินค้าได้");

      var poItems = [];
      poItems = JSON.parse(parseFirestoreValue_(f.Items_JSON) || "[]");
      if (reqItems.some(function(it) {return !poItems.some(function(p) {return p.productCode === it.productCode;});})) return fail("สินค้าไม่ตรงกับใบสั่งซื้อ");
      var poCodes=Object.create(null);
      if(!Array.isArray(poItems)||!poItems.length)throw new Error("รายการใบสั่งซื้อไม่สมบูรณ์");
      poItems.forEach(function(it){if(!it||!it.productCode||poCodes[it.productCode]||!isFinite(Number(it.qty))||Number(it.qty)<=0||!isFinite(Number(it.receivedQty||0))||Number(it.receivedQty||0)<0||Number(it.receivedQty||0)>Number(it.qty))throw new Error("ข้อมูลใบสั่งซื้อไม่ถูกต้อง กรุณาแจ้งผู้ดูแลระบบ");poCodes[it.productCode]=true;});
      var receiveMap = Object.create(null);
      reqItems.forEach(function(it) {
        var code = String(it.productCode || "");
        receiveMap[code] = (receiveMap[code] || 0) + Number(it.qtyReceivedNow);
      });
      var allComplete = true, receiptLineItems = [], stockAdditions = [];
      poItems = poItems.map(function(it) {
        var already = parseFloat(it.receivedQty || 0), ordered = parseFloat(it.qty || 0);
        var remaining = Math.max(ordered - already, 0);
        var receiveNow = Object.prototype.hasOwnProperty.call(receiveMap,it.productCode) ? receiveMap[it.productCode] : 0;
        if (!isFinite(receiveNow) || receiveNow < 0 || receiveNow > remaining) throw new Error("จำนวนรับสินค้าเกินจำนวนคงค้าง: " + it.productCode);
        var newReceived = already + receiveNow;
        if (newReceived < ordered) allComplete = false;
        if (receiveNow > 0) {
          receiptLineItems.push({ productCode:it.productCode, productName:it.productName, qtyReceivedNow:receiveNow });
          stockAdditions.push({ productCode:it.productCode, productName:it.productName, qty:receiveNow, costPrice:it.costPrice == null ? null : Number(it.costPrice) });
        }
        it.receivedQty = newReceived;
        return it;
      });
      if (!receiptLineItems.length) return fail("กรุณาระบุจำนวนที่รับอย่างน้อย 1 รายการ");
      if (!allComplete && !String(d.deliveryNoteNo || "").trim()) {
        return fail("กรุณากรอกเลขที่ใบส่งของชั่วคราว เนื่องจากได้รับสินค้าไม่ครบตามจำนวนที่สั่งซื้อ");
      }

      var stockMap = getProductStockMap_(stockAdditions.map(function(x) { return x.productCode; }));
      for (var si = 0; si < stockAdditions.length; si++) {
        if (!stockMap[stockAdditions[si].productCode] || !stockMap[stockAdditions[si].productCode].updateTime) return fail("ไม่พบสินค้า " + stockAdditions[si].productCode + " ใน Master Product");
      }

      var receipts = [];
      receipts = JSON.parse(parseFirestoreValue_(f.Receipts_JSON) || "[]");
      var effectiveDeliveryNote = String(d.deliveryNoteNo || "").trim();
      var receiptExists = receipts.some(function(r) {
        return String(r.invoiceNo || "").trim() === String(d.invoiceNo || "").trim()
          && String(r.date || "") === String(d.receiptDate || "")
          && String(r.deliveryNoteNo || "").trim() === effectiveDeliveryNote;
      });
      if (receiptExists) return fail("รายการรับสินค้านี้ถูกบันทึกแล้ว กรุณาตรวจสอบประวัติการรับสินค้า");
      receipts.push({
        date:d.receiptDate, invoiceNo:d.invoiceNo, receiverName:d.receiverName,
        deliveryNoteNo:effectiveDeliveryNote,
        requestId:d.requestId, isFinal:allComplete, items:receiptLineItems
      });
      var newStatus = allComplete ? "Received" : "PartiallyReceived";
      var writes = [];
      stockAdditions.forEach(function(l, i) {
        var info = stockMap[l.productCode], qty = parseFloat(l.qty || 0);
        var stockWrite = {
          transform: {
            document: fsDocPath_("Master_Products", l.productCode),
            fieldTransforms: [{ fieldPath:"Current_Stock", increment:{ doubleValue:qty } }]
          }
        };
        if (info.updateTime) stockWrite.currentDocument = { updateTime:info.updateTime };
        writes.push(stockWrite);
        writes.push({ update:{
          name:fsDocPath_(STOCK_MOVEMENT_COLLECTION, docNo + "-" + (i + 1)),
          fields:{
            Doc_No:{stringValue:docNo}, Type:{stringValue:"IN"},
            Product_Code:{stringValue:l.productCode}, Product_Name:{stringValue:String(l.productName || info.name)},
            Qty:{doubleValue:qty}, Stock_Before:{doubleValue:info.stock}, Stock_After:{doubleValue:info.stock + qty},
            Reason:{stringValue:"รับของตาม PO"}, Ref_No:{stringValue:String(d.poId)},
            User:{stringValue:user}, Timestamp:{stringValue:nowIso}
          }
        }});
      });
      var poWrite = {
        update: {
          name: fsDocPath_("Purchase_Orders", d.poId),
          fields: {
            Items_JSON:{stringValue:JSON.stringify(poItems)},
            Receipts_JSON:{stringValue:JSON.stringify(receipts)},
            Status:{stringValue:newStatus}
          }
        },
        updateMask:{ fieldPaths:["Items_JSON", "Receipts_JSON", "Status"] }
      };
      if (poDoc.updateTime) poWrite.currentDocument = { updateTime:poDoc.updateTime };
      writes.push(poWrite);

      writes.forEach(function(w) {
        if (w.update && w.update.fields.Type && w.update.fields.Type.stringValue === "IN") {
          var code = w.update.fields.Product_Code.stringValue;
          var line = stockAdditions.find(function(l) {return l.productCode === code;});
          if (line.costPrice !== null && isFinite(line.costPrice) && line.costPrice >= 0) w.update.fields.Cost_Price = {doubleValue:line.costPrice};
        }
      });
      var result = {success:true,title:"สำเร็จ",message:allComplete ? "บันทึกรับสินค้าครบถ้วน และอัปเดตสต็อกเรียบร้อย" : "บันทึกรับสินค้าบางส่วน และอัปเดตสต็อกเรียบร้อย",
        status:newStatus,po:{poId:d.poId,status:newStatus,items:poItems,receipts:receipts},
        productStocks:stockAdditions.map(function(l) {var info=stockMap[l.productCode];return {productCode:l.productCode,currentStock:info.stock+l.qty,minStock:info.minStock,costPrice:info.costPrice,sellingPrice:info.sellingPrice};})};
      sealStockRequest_(writes,request,result);
      commitAttempted=true;
      var commit = fsCommit_(writes);
      if (commit.ok) {
        clearCollectionCache_("Master_Products");
        return result;
      }
      replay = replayStockRequest_(request);
      if (replay) return replay;
      if (!isPreconditionFailure_(commit.message) || attempt === MAX_ATTEMPTS) {
        return { success:false, title:"ล้มเหลว", message:"บันทึกรับสินค้าไม่สำเร็จ: " + commit.message };
      }
      Utilities.sleep(120 * attempt);
    }
    return { success:false, title:"ล้มเหลว", message:"ข้อมูลมีการเปลี่ยนแปลงพร้อมกัน กรุณาลองใหม่" };
  } catch (e) {
    return {success:false,title:"ข้อผิดพลาด",message:e.message,uncertain:commitAttempted || /ตรวจสอบรายการเดิม|network|timeout/i.test(e.message)};
  }
}

function deletePurchaseOrder_(docId) {
  return deleteFirestoreDocument_("Purchase_Orders", docId);
}
// ══════════════════════════════════════════════════════════════════════════
// 23. ★★★ ระบบยืนยันตัวตน (Authentication & Authorization) ★★★
// ══════════════════════════════════════════════════════════════════════════

var AUTH_USERS_COLLECTION = "Master_Users";
// ★ FIX: CacheService รองรับ TTL สูงสุด 21,600 วิ (6 ชม.) เท่านั้น
//   ค่าเดิม 8 ชม. (28,800 วิ) เกิน limit ถูกแพลตฟอร์มตัดปัดเหลือ 6 ชม.แบบเงียบๆ อยู่แล้ว
//   แก้ให้ตรงกับพฤติกรรมจริง กันความเข้าใจผิด
var AUTH_SESSION_HOURS    = 6;
var AUTH_MAX_ATTEMPTS     = 5;
var AUTH_LOCK_MINUTES     = 15;
var AUTH_RECOVERY_COUNT   = 10;
var PASSWORD_MAX_AGE_DAYS = 90;

function getMasterKey_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty("AUTH_MASTER_KEY");
  if (!key) {
    var bytes = [];
    for (var i = 0; i < 32; i++) bytes.push(Math.floor(Math.random() * 256));
    key = Utilities.base64Encode(bytes);
    props.setProperty("AUTH_MASTER_KEY", key);
  }
  return key;
}

function encryptSecret_(plainText) {
  var key   = getMasterKey_();
  var nonce = Utilities.base64Encode(Utilities.getUuid()).slice(0, 16);
  var data  = Utilities.newBlob(plainText).getBytes();
  var out   = [];

  for (var i = 0; i < data.length; i++) {
    if (i % 32 === 0) {
      var block = Utilities.computeHmacSha256Signature(nonce + ":" + Math.floor(i / 32), key);
      var ks = block;
    }
    out.push((data[i] ^ ks[i % 32]) & 0xFF);
  }

  var cipherB64 = Utilities.base64Encode(out);
  var tag = Utilities.base64Encode(Utilities.computeHmacSha256Signature(nonce + "|" + cipherB64, key));
  return nonce + "." + cipherB64 + "." + tag;
}

function decryptSecret_(packed) {
  try {
    if (!packed) return "";
    var parts = String(packed).split(".");
    if (parts.length !== 3) return "";
    var nonce = parts[0], cipherB64 = parts[1], tag = parts[2];
    var key = getMasterKey_();

    var expect = Utilities.base64Encode(Utilities.computeHmacSha256Signature(nonce + "|" + cipherB64, key));
    if (expect !== tag) {
      console.error("decryptSecret_: ลายเซ็นไม่ตรง ข้อมูลอาจถูกแก้ไข");
      return "";
    }

    var data = Utilities.base64Decode(cipherB64);
    var out = [];
    var ks = null;
    for (var i = 0; i < data.length; i++) {
      if (i % 32 === 0) ks = Utilities.computeHmacSha256Signature(nonce + ":" + Math.floor(i / 32), key);
      out.push((data[i] ^ ks[i % 32]) & 0xFF);
    }
    return Utilities.newBlob(out).getDataAsString();
  } catch (e) {
    console.error("decryptSecret_ error:", e);
    return "";
  }
}

function makeSalt_() {
  return Utilities.getUuid().replace(/-/g, "");
}

function hashPassword_(password, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password) + ":" + String(salt));
  return Utilities.base64Encode(raw);
}

function safeEquals_(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return diff === 0;
}

// ★ NEW: เช็คว่ารหัสผ่านใหม่ซ้ำกับรหัสผ่านปัจจุบันของ user หรือไม่ (กันตั้งรหัสเดิมซ้ำ)
//   ใช้ salt เดิมของ user มา hash รหัสใหม่แล้วเทียบกับ Password_Hash ปัจจุบัน
function isSamePassword_(user, newPassword) {
  if (!user || !user.Password_Hash || !user.Salt) return false;
  return safeEquals_(hashPassword_(newPassword, user.Salt), user.Password_Hash);
}

var BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function generateTotpSecret_() {
  var s = "";
  for (var i = 0; i < 32; i++) s += BASE32_ALPHABET.charAt(Math.floor(Math.random() * 32));
  return s;
}

function base32Decode_(b32) {
  var clean = String(b32).toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  var bits = 0, value = 0, out = [];
  for (var i = 0; i < clean.length; i++) {
    var idx = BASE32_ALPHABET.indexOf(clean.charAt(i));
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xFF);
      bits -= 8;
    }
  }
  return out;
}

function computeTotp_(secretB32, timeStep) {
  var keyBytes = base32Decode_(secretB32);

  var counter = [];
  var tmp = timeStep;
  for (var i = 7; i >= 0; i--) {
    counter[i] = tmp & 0xFF;
    tmp = Math.floor(tmp / 256);
  }

  var hmac = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_1,
    counter,
    keyBytes
  );

  var offset = hmac[hmac.length - 1] & 0x0F;
  var binary = ((hmac[offset] & 0x7F) << 24) |
               ((hmac[offset + 1] & 0xFF) << 16) |
               ((hmac[offset + 2] & 0xFF) << 8) |
               (hmac[offset + 3] & 0xFF);
  var otp = binary % 1000000;
  return ("000000" + otp).slice(-6);
}

function verifyTotp_(secretB32, code) {
  if (!secretB32 || !code) return false;
  var clean = String(code).replace(/\D/g, "");
  if (clean.length !== 6) return false;

  var now = Math.floor(Date.now() / 1000 / 30);
  for (var drift = -1; drift <= 1; drift++) {
    if (safeEquals_(computeTotp_(secretB32, now + drift), clean)) return true;
  }
  return false;
}
// ★ FIX: เดิมผูก session กับ User-Agent เพื่อกันขโมย token — แต่ UA ที่ doGet() เช็คมาจาก query
//   parameter (?ua=...) ที่ฝังไปพร้อม token ในลิงก์เดียวกันตอน redirect หลัง login สำเร็จ
//   (ดู login.html) ถ้า URL ทั้งเส้นหลุดไป ก็หลุดไปพร้อม UA ที่ "ตรง" อยู่แล้ว เช็คนี้จึงไม่ได้กัน
//   อะไรจริง — ตัดออก แล้วใช้ระบบเพิกถอน session ตรงๆ แทน (revokeUserSessions_) ซึ่งใช้งานจริง
//   ตอนแอดมินปิดบัญชี/เปลี่ยนสิทธิ์/รีเซ็ตรหัสผ่านผู้ใช้คนอื่น (ดู toggleUserStatus/updateUserAccount/
//   resetUserPassword) — เดิม session ที่ออกไปแล้วจะยังใช้งานต่อได้จนกว่าจะหมดอายุเองตาม
//   AUTH_SESSION_HOURS แม้จะโดนปิดบัญชีไปแล้วก็ตาม
function createSession_(user, userAgent) {
  var token = Utilities.getUuid() + "-" + Utilities.getUuid();
  var payload = {username:user.Username, fullName:user.Full_Name, role:user.Role, docId:user.docId,
    sessionVersion:String(user.Session_Version || ""), issuedAt:Date.now()};
  CacheService.getScriptCache().put("sess_" + token, JSON.stringify(payload), AUTH_SESSION_HOURS * 3600);
  return {token:token, profile:payload};
}

// ★ เพิกถอน session ที่ออกไปแล้วทั้งหมดของผู้ใช้คนนี้ทันที (เรียกตอนปิดบัญชี/เปลี่ยนสิทธิ์/รีเซ็ตรหัสผ่าน)
//   ไม่ได้ลบ cache key ของ session ตรงๆ เพราะไม่รู้ token ของ session ที่ออกไปแล้ว — เก็บ "เวลาที่เพิกถอน"
//   ไว้แทน แล้วให้ getSession_() เทียบกับ issuedAt ของ session นั้นๆ ทุกครั้งที่ใช้งาน
function revokeUserSessions_(username) {
  var user = findUserByUsername_(username);
  if (!user) throw new Error("ไม่พบบัญชีที่จะเพิกถอนเซสชัน");
  user = readAuthUser_(user.docId);
  if (!updateUserFields_(user.docId, {Session_Version:Utilities.getUuid()}, user.updateTime))
    throw new Error("เพิกถอนเซสชันไม่สำเร็จ กรุณาลองใหม่");
}

function getSession_(token, userAgent) {
  if (!token) return null;
  if (validatedGatewaySession_ && validatedGatewaySession_.token === token) return validatedGatewaySession_.session;
  try {
    var raw = CacheService.getScriptCache().get("sess_" + token);
    if (!raw) return null;
    var session = JSON.parse(raw);
    if (!session.docId) {
      var legacy = findUserByUsername_(session.username);
      if (!legacy) return null;
      session.docId = legacy.docId;
    }
    var revokedAt=CacheService.getScriptCache().get("revoked_"+String(session.username||"").trim().toLowerCase());
    if(revokedAt && Number(revokedAt)>=session.issuedAt)return null;
    var user = readAuthUser_(session.docId);
    if (user.Status !== "Active" || user.Username !== session.username || user.Role !== session.role ||
        String(user.Session_Version || "") !== String(session.sessionVersion || "")) return null;
    session.fullName = user.Full_Name;
    return session;
  } catch (e) { return null; }
}

function destroySession_(token) {
  if (token) CacheService.getScriptCache().remove("sess_" + token);
}

// ★ FIX (โควตา Firestore Reads): เดิมอ่าน Master_Users ทั้ง collection สดทุกครั้งที่ login/เช็คอีเมล
//   (ไม่มี cache เลย ทั้งที่ clearCollectionCache(Master_Users) ถูกเรียกอยู่แล้วทุกจุดที่แก้ไขบัญชี —
//   ดู updateUserFields_/saveMasterData) เปลี่ยนมาใช้ fetchCollectionDocsCached แทน (6 ชม. + invalidate
//   อัตโนมัติเมื่อมีการแก้ไขบัญชีจริง) — ผลพลอยได้อีกอย่าง: ตอนนี้ถ้า Firestore quota เต็มพอดี
//   login ยัง "ใช้ cache เดิมที่ยังไม่หมดอายุ" ต่อได้ ไม่ล่มพร้อมกันไปกับฟีเจอร์อื่นเหมือนเดิม
function findUserByUsername_(username) {return findAuthUser_('Username',username);}

function findUserByEmail_(email) {return findAuthUser_('Email',email);}

function updateUserFields_(docId, fieldsObj, updateTime) {
  try {
    fieldsObj = Object.assign({}, fieldsObj);
    if (Object.prototype.hasOwnProperty.call(fieldsObj, "Password_Hash") && !Object.prototype.hasOwnProperty.call(fieldsObj,"Session_Version")) fieldsObj.Session_Version = Utilities.getUuid();
    var names = Object.keys(fieldsObj);
    if (!names.length) return false;
    var mask = names.map(function (n) { return "updateMask.fieldPaths=" + encodeURIComponent(n); }).join("&");
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + AUTH_USERS_COLLECTION + "/" + encodeURIComponent(docId) + "?" + mask
            + (updateTime ? "&currentDocument.updateTime=" + encodeURIComponent(updateTime) : "&currentDocument.exists=true");
    var res = UrlFetchApp.fetch(url, {
      method             : "patch",
      headers            : getAuthHeader_(),
      payload            : JSON.stringify({ fields: mapToFirestoreFields_(fieldsObj) }),
      muteHttpExceptions : true
    });
    var ok=res.getResponseCode()===200;
    if(ok)clearCollectionCache_(AUTH_USERS_COLLECTION);
    return ok;
  } catch (e) {
    console.error("updateUserFields_ error:", e);
    return false;
  }
}

function generateRecoveryCodes_() {
  var plain = [], hashed = [];
  for (var i = 0; i < AUTH_RECOVERY_COUNT; i++) {
    var code = Utilities.getUuid().replace(/-/g, "").slice(0, 10).toUpperCase();
    plain.push(code);
    hashed.push(hashPassword_(code, "recovery"));
  }
  return { plain: plain, hashedJson: JSON.stringify(hashed) };
}

function consumeRecoveryCode_(user, code) {
  try {
    var fresh = readAuthUser_(user.docId);
    if (!fresh.updateTime || fresh.Status !== "Active" || fresh.Password_Hash !== user.Password_Hash) return false;
    var list = JSON.parse(fresh.Recovery_Codes || "[]");
    var target = hashPassword_(String(code).trim().toUpperCase(), "recovery");
    var idx = list.findIndex(function(hash) { return safeEquals_(hash, target); });
    if (idx < 0) return false;
    list.splice(idx, 1);
    return updateUserFields_(user.docId, {Recovery_Codes:JSON.stringify(list)}, fresh.updateTime);
  } catch (e) { return false; }
}

// ─────────────────────────────────────────────────────────────
// 23.8 Login
// ─────────────────────────────────────────────────────────────
function authLogin(username, password, otpCode, userAgent) {
  try {
    if(!allowAuthRequest_("login",username))return {success:false,message:"ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่"};
    var user = findUserByUsername_(username);

    var genericFail = { success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };

    if (!user) return genericFail;

    if (user.Status !== "Active") return { success: false, message: "บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ" };

    if (user.Locked_Until) {
      var lockedUntil = new Date(user.Locked_Until);
      if (!isNaN(lockedUntil.getTime()) && lockedUntil > new Date()) {
        var mins = Math.ceil((lockedUntil - new Date()) / 60000);
        return { success: false, message: "บัญชีถูกล็อกชั่วคราว กรุณารออีก " + mins + " นาที" };
      }
    }

    if (!safeEquals_(hashPassword_(password, user.Salt), user.Password_Hash)) {
      var failed=recordFailedLogin_(user.docId);
      if(!failed.ok)return {success:false,message:'ตรวจสอบบัญชีไม่สำเร็จ กรุณาลองใหม่'};
      if(failed.locked)return {success:false,message:'บัญชีถูกล็อกชั่วคราว '+AUTH_LOCK_MINUTES+' นาที'};
      return genericFail;
    }

    if (user.Totp_Enabled) {
      if (!otpCode) {
        return { success: false, needOtp: true, message: "กรุณากรอกรหัส 6 หลักจากแอป Authenticator" };
      }
      var secret = decryptSecret_(user.Totp_Secret_Enc);
      var otpOk = verifyTotp_(secret, otpCode);

      if (!otpOk) otpOk = consumeRecoveryCode_(user, otpCode);

      if (!otpOk) {
        if(!recordFailedLogin_(user.docId).ok)return {success:false,message:'ตรวจสอบบัญชีไม่สำเร็จ กรุณาลองใหม่'};
        return { success: false, needOtp: true, message: "รหัส OTP ไม่ถูกต้อง" };
      }
    }

    var verified=readAuthUser_(user.docId);
    if(verified.Status!=='Active' || verified.Password_Hash!==user.Password_Hash || verified.Session_Version!==user.Session_Version ||
      new Date(verified.Locked_Until).getTime()>Date.now())return genericFail;
    if(!updateUserFields_(user.docId,{Failed_Attempts:0,Locked_Until:'',Last_Login:new Date().toISOString()},verified.updateTime))
      return {success:false,message:'บัญชีเปลี่ยนแปลงแล้ว กรุณาลองเข้าสู่ระบบใหม่'};
    user=readAuthUser_(user.docId);
    if(user.Status!=='Active' || user.Password_Hash!==verified.Password_Hash || user.Session_Version!==verified.Session_Version)return genericFail;
    // เช็คว่าต้องบังคับเปลี่ยนรหัสผ่านก่อนหรือไม่
    var mustChange = user.Must_Change_Password === true;
    if (!mustChange && user.Password_Changed_At) {
      var changedAt = new Date(user.Password_Changed_At);
      if (!isNaN(changedAt.getTime())) {
        var ageDays = (Date.now() - changedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays >= PASSWORD_MAX_AGE_DAYS) mustChange = true;
      }
    }

    if (mustChange) {
      var tempToken = Utilities.getUuid() + "-" + Utilities.getUuid();
      CacheService.getScriptCache().put(
        "pwforce_" + tempToken,
        JSON.stringify({username:user.Username,docId:user.docId,sessionVersion:user.Session_Version,passwordHash:user.Password_Hash}),
        600
      );
      return {
        success            : false,
        needPasswordChange : true,
        tempToken          : tempToken,
        message            : "กรุณาตั้งรหัสผ่านใหม่ก่อนเข้าใช้งาน (รหัสผ่านหมดอายุ หรือเป็นการเข้าใช้งานครั้งแรก)"
      };
    }

    var sess = createSession_(user, userAgent);
    return {
      success : true,
      token   : sess.token,
      profile : sess.profile,
      message : "เข้าสู่ระบบสำเร็จ"
    };

  } catch (e) {
    console.error("authLogin error:", e);
    return { success: false, message: "เกิดข้อผิดพลาดในระบบ: " + e.message };
  }
}

function authLogout_(token) {
  destroySession_(token);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────
// 23.9 API Gateway
// ─────────────────────────────────────────────────────────────
var API_REGISTRY = {
  // ── อ่านข้อมูล: viewer ขึ้นไป ──
  getAllProducts           : "viewer",
  getAllMasterDropdowns    : "viewer",
  getBrands                : "viewer",
  getCategories            : "viewer",
  getVendorsFull           : "viewer",
  getCustomersFull         : "viewer",
  getZonesFull             : "viewer",
  getCarsFull              : "viewer",
  getPurchaseOrderPageData : "viewer",
  getTaxInvoicePageData    : "viewer",
  getTaxInvoiceListData    : "viewer",
  getQuotationPageData     : "viewer",
  getQuotationListData     : "viewer",

  // ── เพิ่ม/แก้ไข: staff ขึ้นไป ──
  saveBrand                : "staff",
  saveCategory             : "staff",
  saveVendor               : "staff",
  saveCustomer             : "staff",
  saveZone                 : "staff",
  saveCar                  : "staff",
  saveProduct              : "staff",
  uploadProductImage       : "staff",
  deleteProductImage       : "staff",
  setPrimaryProductImage   : "staff",
  moveProductImage         : "staff",
  commitProductImageDraft  : "staff",
  generateProductBarcode   : "staff",
  // ★ FIX: saveMasterData ไม่เคยอยู่ใน registry นี้เลย — apiGateway ปฏิเสธทุกครั้งที่เรียก
  //   (Master_Brands.html และ Master_Categories.html เรียกฟังก์ชันนี้ตรงๆ ไม่ผ่าน saveBrand/saveCategory)
  //   ทำให้กดบันทึกแบรนด์/หมวดหมู่ไม่ได้เลยถ้าไม่แก้ตรงนี้ — SAVE_MASTER_ALLOWED ด้านล่างเป็นด่านกันอยู่แล้วว่าเขียนได้แค่ 2 collection นี้
  saveMasterData           : "staff",
  savePurchaseOrder        : "staff",
  receiveGoods             : "staff",
  updatePurchaseOrderStatus: "staff",
  issueStock               : "staff",
  getStockMovements        : "viewer",
  getDashboardBootstrap    : "viewer",
  getDashboardDelta        : "viewer",

  // ── ใบกำกับภาษี / ใบเสนอราคา — สร้าง/แก้ไขให้ viewer ทำได้ (ข้อยกเว้นเฉพาะ เซลส์ต้องออกเอกสารได้เอง)
  //   แต่การ "ลบ" เอกสารต้อง admin เหมือน delete ตัวอื่นทุกตัวในระบบ — เดิมให้ viewer ลบได้ด้วย
  //   ซึ่งหลุดมาพร้อมกับข้อยกเว้นเรื่องสร้าง/แก้ไขโดยไม่ได้ตั้งใจ (ข้อมูลบัญชี/ภาษีสำคัญกว่าลบได้ง่ายๆ)
  saveTaxInvoice           : "viewer",
  deleteTaxInvoice         : "admin",
  saveQuotation            : "viewer",
  updateQuotationStatus    : "viewer",
  deleteQuotation          : "admin",
  markQuotationStockIssued : "staff",

  // ── ลบข้อมูล + งานระบบ: admin เท่านั้น ──
  deleteBrand              : "admin",
  deleteCategory           : "admin",
  deleteVendor             : "admin",
  deleteCustomer           : "admin",
  deleteZone               : "admin",
  deleteCar                : "admin",
  deleteProduct            : "admin",
  deletePurchaseOrder      : "admin",
  backupNow                : "admin",
  listBackupFiles          : "admin",
  getActivityLog           : "admin",

  // ── จัดการบัญชีผู้ใช้ (Master_Users) — admin เท่านั้น ──
  getAllUsers              : "admin",
  createUserAccount        : "admin",
  updateUserAccount        : "admin",
  resetUserPassword        : "admin",
  toggleUserStatus         : "admin",

  // ── จัดการบัญชีตัวเอง: viewer ขึ้นไป ──
  authGetMyProfile         : "viewer",
  authChangePassword       : "viewer",
  authLogout               : "viewer",

  // ── เปิด/ปิด TOTP — admin เท่านั้น ──
  authStartTotpSetup       : "admin",
  authConfirmTotpSetup     : "admin",
  authDisableTotp          : "admin"
};

var ROLE_RANK = { viewer: 1, staff: 2, admin: 3 };

// ★ FIX: apiGateway เดิม lookup ฟังก์ชันด้วย this[fnName] แล้ว fallback เป็น eval(fnName) —
//   ตอนนี้ปลอดภัยเพราะกรองด้วย API_REGISTRY ก่อนแล้ว แต่เป็น pattern เสี่ยง ถ้าวันหลังมีคนย้ายลำดับ
//   การเช็คจะกลายเป็นเรียกฟังก์ชันตามชื่อที่ผู้เรียกกำหนดได้ทันที — ใช้ map ตรงๆ แทน ไม่มี eval เลย
//   ต้องมีทุก key ตรงกับ API_REGISTRY เป๊ะ (ตรวจแล้วครบ 56 รายการตอนแก้ไขจุดนี้)
var API_FUNCTIONS = {
  getAllProducts            : getAllProducts_,
  getAllMasterDropdowns     : getAllMasterDropdowns_,
  getBrands                 : getBrands_,
  getCategories             : getCategories_,
  getVendorsFull            : getVendorsFull_,
  getCustomersFull          : getCustomersFull_,
  getZonesFull              : getZonesFull_,
  getCarsFull               : getCarsFull_,
  getPurchaseOrderPageData  : getPurchaseOrderPageData_,
  getTaxInvoicePageData     : getTaxInvoicePageData_,
  getTaxInvoiceListData     : getTaxInvoiceListData_,
  getQuotationPageData      : getQuotationPageData_,
  getQuotationListData      : getQuotationListData_,
  saveBrand                 : saveBrand_,
  saveCategory              : saveCategory_,
  saveVendor                : saveVendor_,
  saveCustomer              : saveCustomer_,
  saveZone                  : saveZone_,
  saveCar                   : saveCar_,
  saveProduct               : saveProduct_,
  uploadProductImage        : uploadProductImage_,
  deleteProductImage        : deleteProductImage_,
  setPrimaryProductImage    : setPrimaryProductImage_,
  moveProductImage          : moveProductImage_,
  commitProductImageDraft   : commitProductImageDraft_,
  generateProductBarcode    : generateProductBarcode_,
  saveMasterData            : saveMasterData_,
  savePurchaseOrder         : savePurchaseOrder_,
  receiveGoods              : receiveGoods_,
  updatePurchaseOrderStatus : updatePurchaseOrderStatus_,
  issueStock                : issueStock_,
  getStockMovements         : getStockMovements_,
  getDashboardBootstrap     : getDashboardBootstrap_,
  getDashboardDelta         : getDashboardDelta_,
  saveTaxInvoice            : saveTaxInvoice_,
  deleteTaxInvoice          : deleteTaxInvoice_,
  saveQuotation             : saveQuotation_,
  updateQuotationStatus     : updateQuotationStatus_,
  deleteQuotation           : deleteQuotation_,
  markQuotationStockIssued  : markQuotationStockIssued_,
  deleteBrand               : deleteBrand_,
  deleteCategory            : deleteCategory_,
  deleteVendor              : deleteVendor_,
  deleteCustomer            : deleteCustomer_,
  deleteZone                : deleteZone_,
  deleteCar                 : deleteCar_,
  deleteProduct             : deleteProduct_,
  deletePurchaseOrder       : deletePurchaseOrder_,
  backupNow                 : backupNow_,
  listBackupFiles           : listBackupFiles_,
  getActivityLog            : getActivityLog_,
  getAllUsers               : getAllUsers_,
  createUserAccount         : createUserAccount_,
  updateUserAccount         : updateUserAccount_,
  resetUserPassword         : resetUserPassword_,
  toggleUserStatus          : toggleUserStatus_,
  authGetMyProfile          : authGetMyProfile_,
  authChangePassword        : authChangePassword_,
  authLogout                : authLogout_,
  authStartTotpSetup        : authStartTotpSetup_,
  authConfirmTotpSetup      : authConfirmTotpSetup_,
  authDisableTotp           : authDisableTotp_
};

var SAVE_MASTER_ALLOWED = ["Master_Brands", "Master_Categories"];

var ACTIVITY_LOG_COLLECTION = "Activity_Log";
var ACTIVITY_LOG_KEEP_MONTHS = 6;

var ACTIVITY_ACTIONS = {
  saveBrand                 : { action: "save",   label: "บันทึกแบรนด์" },
  saveCategory               : { action: "save",   label: "บันทึกหมวดหมู่" },
  saveVendor                 : { action: "save",   label: "บันทึกผู้จัดจำหน่าย" },
  saveCustomer                : { action: "save",   label: "บันทึกลูกค้า" },
  saveZone                    : { action: "save",   label: "บันทึกโซนจัดเก็บ" },
  saveCar                     : { action: "save",   label: "บันทึกข้อมูลรถ" },
  saveProduct                 : { action: "save",   label: "บันทึกสินค้า" },
  uploadProductImage          : { action: "update", label: "อัปโหลดรูปสินค้า" },
  deleteProductImage          : { action: "delete", label: "ลบรูปสินค้า" },
  setPrimaryProductImage      : { action: "update", label: "ตั้งรูปสินค้าหลัก" },
  commitProductImageDraft     : { action: "update", label: "บันทึกรูปสินค้า" },
  generateProductBarcode      : { action: "update", label: "สร้างบาร์โค้ดสินค้า" },
  savePurchaseOrder           : { action: "save",   label: "บันทึกใบสั่งซื้อ" },
  saveTaxInvoice               : { action: "save",   label: "บันทึกใบกำกับภาษี" },
  saveQuotation                : { action: "save",   label: "บันทึกใบเสนอราคา" },
  saveMasterData               : { action: "save",   label: "บันทึกข้อมูล" },
  receiveGoods                 : { action: "update", label: "รับสินค้าเข้าสต็อก" },
  updatePurchaseOrderStatus    : { action: "update", label: "เปลี่ยนสถานะใบสั่งซื้อ" },
  updateQuotationStatus        : { action: "update", label: "เปลี่ยนสถานะใบเสนอราคา" },
  markQuotationStockIssued     : { action: "update", label: "ตัดสต๊อกจากใบเสนอราคา" },
  issueStock                   : { action: "update", label: "ตัดสต๊อกสินค้า" },
  deleteBrand                  : { action: "delete", label: "ลบแบรนด์" },
  deleteCategory                : { action: "delete", label: "ลบหมวดหมู่" },
  deleteVendor                  : { action: "delete", label: "ลบผู้จัดจำหน่าย" },
  deleteCustomer                 : { action: "delete", label: "ลบลูกค้า" },
  deleteZone                     : { action: "delete", label: "ลบโซนจัดเก็บ" },
  deleteCar                      : { action: "delete", label: "ลบข้อมูลรถ" },
  deleteProduct                   : { action: "delete", label: "ลบสินค้า" },
  deletePurchaseOrder              : { action: "delete", label: "ลบใบสั่งซื้อ" },
  deleteTaxInvoice                  : { action: "delete", label: "ลบใบกำกับภาษี" },
  deleteQuotation                    : { action: "delete", label: "ลบใบเสนอราคา" }
};

function guessDocId_(fnName, args, result) {
  try {
    if (result && result.id) return String(result.id);
    if (fnName.indexOf("delete") === 0 && args && args[0]) return String(args[0]);
    if (args && args[0] && typeof args[0] === "object" && args[0].docId) return String(args[0].docId);
  } catch (e) {}
  return "";
}

function logActivity_(username, fnName, args, result) {
  try {
    var meta = ACTIVITY_ACTIONS[fnName];
    if (!meta) return;

    var docId = guessDocId_(fnName, args, result);
    var success = !result || result.success !== false;

    var dataObject = {
      Username  : username,
      Action    : meta.action,
      Function  : fnName,
      Label     : meta.label,
      DocId     : docId,
      Success   : success ? "true" : "false",
      Timestamp : new Date().toISOString()
    };

    var payload = { fields: mapToFirestoreFields_(dataObject) };
    UrlFetchApp.fetch(
      "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/" + ACTIVITY_LOG_COLLECTION,
      { method: "post", headers: getAuthHeader_(), payload: JSON.stringify(payload), muteHttpExceptions: true }
    );
  } catch (e) {
    console.error("logActivity_ error:", e);
  }
}

function apiGateway(token, fnName, args, userAgent) {
  try {
    var session = getSession_(token, userAgent);
    if (!session) {
      return { __authError: true, success: false, message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" };
    }

    if (typeof fnName !== "string" || !Object.prototype.hasOwnProperty.call(API_REGISTRY, fnName) ||
        !Object.prototype.hasOwnProperty.call(API_FUNCTIONS, fnName)) {
      console.error("apiGateway: พยายามเรียกฟังก์ชันที่ไม่อนุญาต:", fnName, "โดย", session.username);
      return { success: false, message: "ไม่อนุญาตให้เรียกใช้งานฟังก์ชันนี้" };
    }

    var required = API_REGISTRY[fnName];
    var userRank = Object.prototype.hasOwnProperty.call(ROLE_RANK, session.role) ? ROLE_RANK[session.role] : 0;
    var needRank = Object.prototype.hasOwnProperty.call(ROLE_RANK, required) ? ROLE_RANK[required] : 99;
    if (userRank < needRank) {
      return { success: false, message: "สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้" };
    }

    if (args != null && !Array.isArray(args)) {
      return { success: false, message: "รูปแบบข้อมูลคำขอไม่ถูกต้อง" };
    }
    var a = args || [];

    if (fnName === "saveMasterData" && SAVE_MASTER_ALLOWED.indexOf(a[0]) === -1) {
      return { success: false, message: "ไม่อนุญาตให้บันทึกข้อมูลลงชุดข้อมูลนี้" };
    }

    var identityPositions = {resetUserPassword:1, toggleUserStatus:2, updateUserAccount:4,
      issueStock:1, receiveGoods:1, saveQuotation:1, markQuotationStockIssued:2};
    a = a.slice();
    if (Object.prototype.hasOwnProperty.call(identityPositions, fnName)) {
      var identityIndex = identityPositions[fnName];
      if (a.length > identityIndex) return {success:false, message:"คำขอมีข้อมูลผู้ทำรายการที่ไม่อนุญาต"};
      a[identityIndex] = session.username;
    }
    if (["authGetMyProfile","authChangePassword","authLogout","authStartTotpSetup","authConfirmTotpSetup","authDisableTotp"].indexOf(fnName) >= 0) a[0] = token;
    validatedGatewaySession_ = {token:token, session:session};

    var fn = API_FUNCTIONS[fnName];
    if (typeof fn !== "function") {
      console.error("apiGateway: ไม่พบฟังก์ชันจริงสำหรับ", fnName, "(อยู่ใน API_REGISTRY แต่ไม่มีใน API_FUNCTIONS — ตรวจ Code.gs)");
      return { success: false, message: "เกิดข้อผิดพลาดภายในระบบ กรุณาแจ้งผู้ดูแลระบบ" };
    }
    var referenceOperations=['saveProduct','saveBrand','saveCategory','saveVendor','saveCustomer','saveZone','saveCar','saveMasterData','savePurchaseOrder','saveQuotation',
      'deleteProduct','deleteBrand','deleteCategory','deleteVendor','deleteCustomer','deleteZone','deleteCar','deletePurchaseOrder'];
    var result = referenceOperations.indexOf(fnName)>=0 ? withReferenceMutationLock_(function(){return fn.apply(null,a);}) : fn.apply(null,a);

    logActivity_(session.username, fnName, a, result);

    return result;

  } catch (e) {
    console.error("apiGateway error [" + fnName + "]:", e);
    return { success: false, message: friendlyErrorMessage_(e) };
  } finally { validatedGatewaySession_ = null; }
}

// ★ แปลง exception ดิบ (มักเป็นภาษาอังกฤษเทคนิค) ให้เป็นข้อความไทยที่พนักงานอ่านแล้วรู้ว่าควรทำอะไรต่อ
//   ใช้เฉพาะตอนเกิด exception จริง (เช่น เน็ตหลุด/โควตาเต็ม) — error ที่ฟังก์ชันตรวจสอบเองแล้วคืน
//   {success:false, message:...} อยู่แล้ว (เช่น ข้อมูลซ้ำ/กรอกไม่ครบ) ไม่ผ่านจุดนี้ ยังคงข้อความเดิม
function friendlyErrorMessage_(e) {
  var raw = String((e && e.message) || e || "");
  if (/timeout|timed out/i.test(raw)) {
    return "การเชื่อมต่อช้าเกินไป กรุณาลองใหม่อีกครั้ง";
  }
  if (/too many times|rate limit|quota|RESOURCE_EXHAUSTED/i.test(raw)) {
    return "ระบบถูกเรียกใช้งานถี่เกินไปในขณะนี้ กรุณารอสักครู่แล้วลองใหม่";
  }
  if (/dns error|address unavailable|network|ENOTFOUND|unreachable/i.test(raw)) {
    return "การเชื่อมต่ออินเทอร์เน็ตขัดข้อง กรุณาตรวจสอบสัญญาณแล้วลองใหม่";
  }
  if (/unexpected token|is not valid json|SyntaxError/i.test(raw)) {
    return "ข้อมูลที่ได้รับจากเซิร์ฟเวอร์ผิดปกติ กรุณาลองใหม่ หากยังไม่หายให้แจ้งผู้ดูแลระบบ";
  }
  return "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง หากยังไม่หายให้แจ้งผู้ดูแลระบบ (" + raw + ")";
}

// ★ FIX (โควตา Firestore Reads): เดิมสแกน Activity_Log ทั้ง collection (โตทุกวันไม่มีสิ้นสุด เพราะ
//   logActivity_ เขียนทุกครั้งที่มีคนทำรายการ) แล้วค่อย sort+slice เอาแค่ล่าสุด N รายการฝั่ง JS —
//   เปลี่ยนเป็น runQuery + orderBy + limit ให้ Firestore เป็นคนกรองให้เลย (pattern เดียวกับ
//   getStockMovements ที่ทำถูกอยู่แล้วในไฟล์นี้) อ่านแค่ N document แทนทั้งประวัติ
function getActivityLog_(limitCount) {
  var list = [];
  try {
    var n = Math.min(parseInt(limitCount, 10) || 200, 1000);
    var query = {
      structuredQuery: {
        from    : [{ collectionId: ACTIVITY_LOG_COLLECTION }],
        orderBy : [{ field: { fieldPath: "Timestamp" }, direction: "DESCENDING" }],
        limit   : n
      }
    };
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents:runQuery";
    var res = UrlFetchApp.fetch(url, {
      method: "post", headers: getAuthHeader_(), payload: JSON.stringify(query), muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) throw new Error("โหลดข้อมูลไม่สำเร็จ (" + res.getResponseCode() + ")");
    if (res.getResponseCode() === 200) {
      (JSON.parse(res.getContentText()) || []).forEach(function (row) {
        if (!row.document) return;
        var f = row.document.fields || {};
        list.push({
          id        : row.document.name.split('/').pop(),
          username  : parseFirestoreValue_(f.Username)  || "",
          action    : parseFirestoreValue_(f.Action)    || "",
          label     : parseFirestoreValue_(f.Label)      || "",
          docId     : parseFirestoreValue_(f.DocId)      || "",
          success   : String(parseFirestoreValue_(f.Success) || "") === "true",
          timestamp : parseFirestoreValue_(f.Timestamp)  || ""
        });
      });
    } else {
      console.error("getActivityLog HTTP " + res.getResponseCode() + ": " + res.getContentText());
    }
  } catch (e) { console.error("getActivityLog_ read failed", e); throw e; }
  return list;
}

function cleanupOldActivityLogs_() {
  var deleted=0,cutoff=new Date();cutoff.setMonth(cutoff.getMonth()-ACTIVITY_LOG_KEEP_MONTHS);
  try {
    var deadline=Date.now()+240000;
    for(var batch=0;batch<20 && Date.now()<deadline;batch++){
      var query={structuredQuery:{from:[{collectionId:ACTIVITY_LOG_COLLECTION}],where:{fieldFilter:{field:{fieldPath:'Timestamp'},op:'LESS_THAN',value:{stringValue:cutoff.toISOString()}}},orderBy:[{field:{fieldPath:'Timestamp'},direction:'ASCENDING'}],limit:450}};
      var res=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:runQuery',{method:'post',headers:getAuthHeader_(),payload:JSON.stringify(query),muteHttpExceptions:true});
      if(res.getResponseCode()!==200)throw new Error('อ่าน Log ที่หมดอายุไม่สำเร็จ');
      var docs=JSON.parse(res.getContentText()).filter(function(row){return row.document;}).map(function(row){return row.document;});
      if(!docs.length)return {success:true,deleted:deleted,hasMore:false};
      var result=fsCommit_(docs.map(function(doc){return {delete:doc.name,currentDocument:{updateTime:doc.updateTime}};}));
      if(!result.ok)throw new Error('ลบ Log ไม่สำเร็จ');deleted+=docs.length;
      if(docs.length<450)return {success:true,deleted:deleted,hasMore:false};
    }
    return {success:true,deleted:deleted,hasMore:true,message:'ยังมี Log เก่า งานรอบถัดไปจะดำเนินต่อ'};
  }catch(e){return {success:false,deleted:deleted,message:e.message};}
}

function setupActivityLogCleanupTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    var handler = t.getHandlerFunction();
    if (handler === "cleanupOldActivityLogs" || handler === "cleanupOldActivityLogs_") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("cleanupOldActivityLogs_").timeBased().everyDays(1).atHour(3).create();
  return "ตั้งเวลาลบ Activity Log เก่ากว่า " + ACTIVITY_LOG_KEEP_MONTHS + " เดือนทุกวันเวลา 03:00 น. เรียบร้อยแล้ว";
}

// ★ FIX: เพิ่ม Password_Changed_At/Must_Change_Password ให้ admin คนแรกด้วย
//   เดิมไม่มี 2 field นี้เลย ทำให้บัญชี admin ตัวแรกไม่เคยถูกบังคับเปลี่ยนรหัสผ่าน
function setupFirstAdmin_() {
  if(!referenceMutationLocked_)return withReferenceMutationLock_(setupFirstAdmin_);
  var ADMIN_EMAIL='shopsyy01@gmail.com';
  try {
    var existingUsers=fetchAllPagesRaw_(AUTH_USERS_COLLECTION);if(!existingUsers.ok)return {success:false,message:'ตรวจสอบบัญชีเดิมไม่สำเร็จ'};
    if(existingUsers.docs.some(function(d){return normalizedDuplicateKey_(parseFirestoreValue_((d.fields||{}).Username))==='admin';}))return {success:false,message:'มีผู้ใช้ admin อยู่แล้ว ใช้ลืมรหัสผ่านเพื่อขอลิงก์ใหม่'};
    var salt=makeSalt_();
    var result=saveMasterData_(AUTH_USERS_COLLECTION,'U',null,{Username:'admin',Full_Name:'ผู้ดูแลระบบ',Email:ADMIN_EMAIL,
      Password_Hash:hashPassword_(generateTempPassword_(),salt),Salt:salt,Role:'admin',Status:'Active',Totp_Enabled:'false',
      Totp_Secret_Enc:'',Recovery_Codes:'[]',Failed_Attempts:0,Locked_Until:'',Last_Login:'',Session_Version:Utilities.getUuid(),
      Password_Changed_At:'',Must_Change_Password:'true'},null);
    if(!result || !result.success)return {success:false,message:'สร้าง admin ไม่สำเร็จ'};
    var user=readAuthUser_(result.id),token=storePasswordResetToken_(user);
    var url=getWebAppUrl_()+'?page=login&mode=reset&rtoken='+encodeURIComponent(token);
    try {MailApp.sendEmail(ADMIN_EMAIL,'ตั้งรหัสผ่านผู้ดูแลระบบ — SYY Shop Control','Username: admin\nตั้งรหัสผ่านด้วยลิงก์นี้ภายใน '+RESET_TOKEN_MINUTES+' นาที\n'+url);}
    catch(mailError){return {success:true,emailSent:false,message:'สร้างบัญชีแล้ว แต่ส่งลิงก์ไม่สำเร็จ กรุณาใช้ลืมรหัสผ่าน'};}
    return {success:true,emailSent:true,message:'สร้าง admin และส่งลิงก์ตั้งรหัสผ่านแล้ว'};
  }catch(e){return {success:false,message:'สร้าง admin ไม่สำเร็จ กรุณาตรวจสอบสถานะก่อนลองใหม่'};}
}

// ★ FIX: เพิ่มเช็คห้ามซ้ำรหัสเดิม + อัปเดต Password_Changed_At/Must_Change_Password
//   เดิมไม่เคยอัปเดต 2 field นี้ ทำให้นาฬิกา 90 วันไม่เคยรีเซ็ตแม้ user เปลี่ยนรหัสเองสม่ำเสมอ
function authChangePassword_(token, oldPassword, newPassword) {
  var session = getSession_(token);
  if (!session) return { success: false, message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" };

  if (!newPassword || String(newPassword).length < 8) {
    return { success: false, message: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร" };
  }

  var user = readAuthUser_(session.docId);
  if (!user) return { success: false, message: "ไม่พบบัญชีผู้ใช้" };

  if (!safeEquals_(hashPassword_(oldPassword, user.Salt), user.Password_Hash)) {
    return { success: false, message: "รหัสผ่านเดิมไม่ถูกต้อง" };
  }

  if (isSamePassword_(user, newPassword)) {
    return { success: false, message: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม กรุณาตั้งรหัสผ่านใหม่ที่แตกต่างออกไป" };
  }

  var newSalt = makeSalt_();
  var ok = updateUserFields_(user.docId, {
    Password_Hash        : hashPassword_(newPassword, newSalt),
    Salt                 : newSalt,
    Password_Changed_At  : new Date().toISOString(),
    Must_Change_Password : "false"
  }, user.updateTime);

  return ok ? { success: true, requiresLogin:true, message: "เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบใหม่" }
            : { success: false, message: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
}

function authStartTotpSetup_(token) {
  var session = getSession_(token);
  if (!session) return { success: false, message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" };

  var secret = generateTotpSecret_();
  CacheService.getScriptCache().put("totpsetup_" + token, secret, 600);

  var label  = encodeURIComponent("SYY Shop:" + session.username);
  var issuer = encodeURIComponent("SYY Shop Control");
  var uri = "otpauth://totp/" + label + "?secret=" + secret + "&issuer=" + issuer + "&algorithm=SHA1&digits=6&period=30";

  return { success: true, secret: secret, otpauthUri: uri };
}

function authConfirmTotpSetup_(token, otpCode) {
  var session = getSession_(token);
  if (!session) return { success: false, message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" };

  var secret = CacheService.getScriptCache().get("totpsetup_" + token);
  if (!secret) return { success: false, message: "หมดเวลาตั้งค่า กรุณาเริ่มใหม่อีกครั้ง" };

  if (!verifyTotp_(secret, otpCode)) {
    return { success: false, message: "รหัส OTP ไม่ถูกต้อง กรุณาตรวจสอบเวลาในเครื่องและลองใหม่" };
  }

  var user = findUserByUsername_(session.username);
  if (!user) return { success: false, message: "ไม่พบบัญชีผู้ใช้" };

  var recovery = generateRecoveryCodes_();
  var ok = updateUserFields_(user.docId, {
    Totp_Enabled    : "true",
    Totp_Secret_Enc : encryptSecret_(secret),
    Recovery_Codes  : recovery.hashedJson
  });

  CacheService.getScriptCache().remove("totpsetup_" + token);

  if (!ok) return { success: false, message: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };

  return {
    success       : true,
    recoveryCodes : recovery.plain,
    message       : "เปิดใช้งานยืนยันตัวตน 2 ชั้นสำเร็จ"
  };
}

function authDisableTotp_(token, password) {
  var session = getSession_(token);
  if (!session) return { success: false, message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" };

  var user = findUserByUsername_(session.username);
  if (!user) return { success: false, message: "ไม่พบบัญชีผู้ใช้" };

  if (!safeEquals_(hashPassword_(password, user.Salt), user.Password_Hash)) {
    return { success: false, message: "รหัสผ่านไม่ถูกต้อง" };
  }

  var ok = updateUserFields_(user.docId, {
    Totp_Enabled    : "false",
    Totp_Secret_Enc : "",
    Recovery_Codes  : "[]"
  });

  return ok ? { success: true, message: "ปิดการยืนยันตัวตน 2 ชั้นแล้ว" }
            : { success: false, message: "บันทึกไม่สำเร็จ" };
}

function authGetMyProfile_(token) {
  var session = getSession_(token);
  if (!session) return { success: false, message: "เซสชันหมดอายุ" };

  var user = findUserByUsername_(session.username);
  if (!user) return { success: false, message: "ไม่พบบัญชีผู้ใช้" };

  var remaining = 0;
  try { remaining = JSON.parse(user.Recovery_Codes || "[]").length; } catch (e) {}

  return {
    success            : true,
    username           : user.Username,
    fullName           : user.Full_Name,
    role               : user.Role,
    totpEnabled        : user.Totp_Enabled,
    recoveryCodesLeft  : remaining
  };
}

var RESET_TOKEN_MINUTES = 30;

function authForgotPassword(email) {
  var genericMsg = "หากอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้แล้ว กรุณาตรวจสอบกล่องจดหมาย";

  try {
    var clean = String(email || "").trim().toLowerCase();
    if (!clean || clean.indexOf("@") === -1) {
      return { success: false, message: "กรุณากรอกอีเมลให้ถูกต้อง" };
    }

    if(!allowAuthRequest_("forgot",clean))return {success:true,message:genericMsg};
    var user = findUserByEmail_(clean);
    if(user)user=readAuthUser_(user.docId);
    if (!user || user.Status !== "Active") {
      return { success: true, message: genericMsg };
    }

    var resetToken = storePasswordResetToken_(user);

    var resetUrl = getWebAppUrl_() + "?page=login&mode=reset&rtoken=" + encodeURIComponent(resetToken);

    var body =
      "สวัสดีคุณ " + user.Full_Name + ",\n\n" +
      "มีการขอตั้งรหัสผ่านใหม่สำหรับบัญชี SYY Shop Control ของคุณ\n" +
      "กรุณากดลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์นี้ใช้ได้ภายใน " + RESET_TOKEN_MINUTES + " นาที และใช้ได้ครั้งเดียว)\n\n" +
      resetUrl + "\n\n" +
      "หากคุณไม่ได้เป็นผู้ขอตั้งรหัสผ่านใหม่ กรุณาเพิกเฉยต่ออีเมลฉบับนี้ รหัสผ่านเดิมของคุณจะยังใช้งานได้ตามปกติ\n\n" +
      "— ระบบ SYY Shop Control";

    MailApp.sendEmail(user.Email, "ตั้งรหัสผ่านใหม่ — SYY Shop Control", body);

    return { success: true, message: genericMsg };

  } catch (e) {
    console.error("authForgotPassword error:", e);
    return { success: true, message: genericMsg };
  }
}

function authVerifyResetToken(resetToken) {
  try {
    if(!allowAuthRequest_('verify',resetToken))return {success:false,message:'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่'};
    var raw=CacheService.getScriptCache().get('pwreset_'+resetToken);
    if(!raw)return {success:false,message:'ลิงก์หมดอายุหรือถูกใช้แล้ว กรุณาขอลิงก์ใหม่'};
    var data=JSON.parse(raw);resetTokenUser_(data);return {success:true,username:data.username};
  }catch(e){return {success:false,message:'ลิงก์หมดอายุหรือบัญชีเปลี่ยนแปลงแล้ว กรุณาขอลิงก์ใหม่'};}
}

// ★ FIX: เพิ่มเช็คห้ามซ้ำรหัสเดิม + อัปเดต Password_Changed_At/Must_Change_Password
//   เดิมไม่เคยเคลียร์ 2 ค่านี้ ทำให้ user ที่ถูก admin reset หรือลืมรหัสผ่าน
//   ต้องเปลี่ยนรหัสผ่านวนซ้ำไม่จบทุกครั้งที่ login แม้ตั้งรหัสใหม่ถูกต้องแล้ว (บั๊กร้ายแรงที่สุดที่พบ)
function authResetPassword(resetToken,newPassword) {
  try {
    if(!allowAuthRequest_('reset',resetToken))return {success:false,message:'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่'};
    if(typeof newPassword!=='string' || newPassword.length<8 || newPassword.length>256)return {success:false,message:'รหัสผ่านต้องมี 8–256 ตัวอักษร'};
    var cache=CacheService.getScriptCache(),key='pwreset_'+resetToken,raw=cache.get(key);
    if(!raw)return {success:false,message:'ลิงก์หมดอายุหรือถูกใช้แล้ว กรุณาขอลิงก์ใหม่'};
    var data=JSON.parse(raw),user=resetTokenUser_(data);
    if(isSamePassword_(user,newPassword))return {success:false,message:'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม'};
    var salt=makeSalt_(),sessionVersion=Utilities.getUuid(),hash=hashPassword_(newPassword,salt);
    var ok=updateUserFields_(user.docId,{Password_Hash:hash,Salt:salt,Session_Version:sessionVersion,
      Password_Changed_At:new Date().toISOString(),Must_Change_Password:'false',Failed_Attempts:0,Locked_Until:''},user.updateTime);
    if(!ok){
      // A lost response may follow a committed PATCH; confirm before inviting a retry.
      try {var fresh=readAuthUser_(user.docId);ok=fresh.Session_Version===sessionVersion && fresh.Password_Hash===hash;}catch(ignore){}
    }
    if(!ok)return {success:false,message:'บันทึกไม่สำเร็จ ลิงก์เดิมยังตรวจสอบได้ กรุณาลองใหม่'};
    cache.remove(key);return {success:true,message:'ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่'};
  }catch(e){return {success:false,message:'ลิงก์หมดอายุ ถูกใช้ หรือบัญชีเปลี่ยนแปลงแล้ว กรุณาขอลิงก์ใหม่'};}
}

// ═════════════════════════════════════════════════════════════
// ★ ระบบจัดการบัญชีผู้ใช้ (User Management) — admin เท่านั้น
// ═════════════════════════════════════════════════════════════

function generateTempPassword_() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 12);
}

function generateUsernameFromEmail_(email) {
  var base = String(email || "").split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!base) base = "user";
  var candidate = base;
  var suffix = 1;
  while (findUserByUsername_(candidate)) {
    suffix++;
    candidate = base + suffix;
  }
  return candidate;
}

function sendAccountEmail_(email, fullName, username, tempPassword, isReset) {
  try {
    var subject = isReset ? "รีเซ็ตรหัสผ่าน — SYY Shop Control" : "สร้างบัญชีผู้ใช้ใหม่ — SYY Shop Control";
    var intro = isReset
      ? "รหัสผ่านของบัญชีคุณถูกรีเซ็ตโดยผู้ดูแลระบบ"
      : "บัญชีผู้ใช้งานระบบ SYY Shop Control ของคุณถูกสร้างเรียบร้อยแล้ว";

    var body =
      "สวัสดีคุณ " + fullName + ",\n\n" +
      intro + "\n\n" +
      "ชื่อผู้ใช้ (Username): " + username + "\n" +
      "รหัสผ่านชั่วคราว: " + tempPassword + "\n\n" +
      "กรุณาเข้าสู่ระบบด้วยข้อมูลข้างต้น ระบบจะบังคับให้ตั้งรหัสผ่านใหม่ทันทีในการเข้าใช้งานครั้งแรก\n\n" +
      "ลิงก์เข้าสู่ระบบ: " + getWebAppUrl_() + "?page=login\n\n" +
      "หากคุณไม่ได้เป็นผู้ร้องขอ กรุณาติดต่อผู้ดูแลระบบทันที\n\n" +
      "— ระบบ SYY Shop Control";

    MailApp.sendEmail(email, subject, body);
    return true;
  } catch (e) {
    console.error("sendAccountEmail_ error:", e);
    return false;
  }
}

function createUserAccount_(email, fullName, role) {
  var cleanEmail = String(email || "").trim().toLowerCase();
  var cleanName  = String(fullName || "").trim();
  var cleanRole  = String(role || "").trim();

  if (!cleanEmail || cleanEmail.indexOf("@") === -1) {
    return { success: false, message: "กรุณากรอกอีเมลให้ถูกต้อง" };
  }
  if (!cleanName) {
    return { success: false, message: "กรุณากรอกชื่อเต็ม" };
  }
  if (["viewer", "staff", "admin"].indexOf(cleanRole) === -1) {
    return { success: false, message: "กรุณาเลือกสิทธิ์ผู้ใช้ให้ถูกต้อง (viewer / staff / admin)" };
  }

  if (findUserByEmail_(cleanEmail)) {
    return { success: false, message: "อีเมลนี้มีบัญชีผู้ใช้อยู่แล้วในระบบ" };
  }

  var username     = generateUsernameFromEmail_(cleanEmail);
  var tempPassword = generateTempPassword_();
  var salt         = makeSalt_();

  var dataObject = {
    Username             : username,
    Full_Name            : cleanName,
    Email                : cleanEmail,
    Password_Hash        : hashPassword_(tempPassword, salt),
    Salt                 : salt,
    Role                 : cleanRole,
    Status               : "Active",
    Totp_Enabled         : "false",
    Totp_Secret_Enc      : "",
    Recovery_Codes       : "[]",
    Failed_Attempts      : 0,
    Locked_Until         : "",
    Last_Login           : "",
    Password_Changed_At  : "",
    Must_Change_Password : "true"
  };

  var res = saveMasterData_(AUTH_USERS_COLLECTION, "U", null, dataObject, null);
  if (!res.success) {
    return { success: false, message: "สร้างบัญชีไม่สำเร็จ: " + res.message };
  }
  var emailSent = sendAccountEmail_(cleanEmail, cleanName, username, tempPassword, false);

  return {
    success  : true,
    message  : emailSent
                 ? "สร้างบัญชีผู้ใช้สำเร็จ และส่งอีเมลแจ้งรหัสผ่านเรียบร้อยแล้ว"
                 : "สร้างบัญชีผู้ใช้สำเร็จ แต่ส่งอีเมลไม่สำเร็จ กรุณาแจ้งรหัสผ่านให้ผู้ใช้ด้วยตนเอง",
    username : username,
    tempPassword : emailSent ? undefined : tempPassword
  };
}

function getAllUsers_() {
  var list = [];
  try {
    var docs = fetchCollectionDocsCached_(AUTH_USERS_COLLECTION);
    docs.forEach(function (doc) {
      var f = doc.fields || {};
      list.push({
        docId               : doc.id,
        username            : parseFirestoreValue_(f.Username)  || "",
        fullName            : parseFirestoreValue_(f.Full_Name) || "",
        email               : parseFirestoreValue_(f.Email)     || "",
        role                : parseFirestoreValue_(f.Role)       || "viewer",
        status              : parseFirestoreValue_(f.Status)     || "Active",
        totpEnabled         : String(parseFirestoreValue_(f.Totp_Enabled) || "") === "true",
        lastLogin           : parseFirestoreValue_(f.Last_Login) || "",
        passwordChangedAt   : parseFirestoreValue_(f.Password_Changed_At) || "",
        mustChangePassword  : String(parseFirestoreValue_(f.Must_Change_Password) || "") === "true"
      });
    });
    list.sort(function (a, b) { return (a.username || "").localeCompare(b.username || ""); });
  } catch (e) { console.error("getAllUsers_ read failed", e); throw e; }
  return list;
}

// ★ Admin: แก้ไขข้อมูลบัญชีผู้ใช้ (ชื่อเต็ม, อีเมล, Role) — ไม่แก้ username/รหัสผ่าน
//   ห้ามใช้แก้ไข role ของตัวเอง เพื่อกันเผลอลดสิทธิ์ตัวเองจนออกจากระบบไม่ได้
function updateUserAccount_(docId, fullName, email, role, callerUsername) {
  if (!docId) return { success: false, message: "ไม่พบรหัสผู้ใช้" };

  var cleanName  = String(fullName || "").trim();
  var cleanEmail = String(email || "").trim().toLowerCase();
  var cleanRole  = String(role || "").trim();

  if (!cleanName) return { success: false, message: "กรุณากรอกชื่อเต็ม" };
  if (!cleanEmail || cleanEmail.indexOf("@") === -1) {
    return { success: false, message: "กรุณากรอกอีเมลให้ถูกต้อง" };
  }
  if (["viewer", "staff", "admin"].indexOf(cleanRole) === -1) {
    return { success: false, message: "กรุณาเลือกสิทธิ์ผู้ใช้ให้ถูกต้อง" };
  }

  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + AUTH_USERS_COLLECTION + "/" + docId;
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader_(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { success: false, message: "ไม่พบบัญชีผู้ใช้นี้" };

    var targetDoc = JSON.parse(res.getContentText());
    var f = targetDoc.fields || {};
    var targetUsername = parseFirestoreValue_(f.Username) || "";
    var currentEmail   = parseFirestoreValue_(f.Email)    || "";
    var currentRole    = parseFirestoreValue_(f.Role)     || "";

    if (callerUsername && targetUsername.toLowerCase() === String(callerUsername).toLowerCase() && cleanRole !== currentRole) {
      return { success: false, message: "ไม่สามารถเปลี่ยนสิทธิ์ (Role) ของบัญชีตัวเองได้" };
    }

    if (cleanEmail !== currentEmail) {
      var existing = findUserByEmail_(cleanEmail);
      if (existing && existing.docId !== docId) {
        return { success: false, message: "อีเมลนี้ถูกใช้งานโดยบัญชีอื่นแล้ว" };
      }
    }

    var changes = {Full_Name:cleanName, Email:cleanEmail, Role:cleanRole};
    if (cleanRole !== currentRole) changes.Session_Version = Utilities.getUuid();
    var ok = updateUserFields_(docId, changes, targetDoc.updateTime);

    if(ok && cleanEmail!==currentEmail)CacheService.getScriptCache().remove("auth_legacy_index_"+PROJECT_ID);
    return ok ? { success: true, message: "บันทึกข้อมูลบัญชีผู้ใช้สำเร็จ" }
              : { success: false, message: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  } catch (e) {
    console.error("updateUserAccount error:", e);
    return { success: false, message: "เกิดข้อผิดพลาด: " + e.message };
  }
}

function resetUserPassword_(docId, callerUsername) {
  if (!docId) return { success: false, message: "ไม่พบรหัสผู้ใช้" };

  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + AUTH_USERS_COLLECTION + "/" + docId;
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader_(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { success: false, message: "ไม่พบบัญชีผู้ใช้นี้" };

    var targetDoc=JSON.parse(res.getContentText());
    var f = targetDoc.fields || {};
    var targetUsername = parseFirestoreValue_(f.Username) || "";
    var targetEmail     = parseFirestoreValue_(f.Email)    || "";
    var targetFullName  = parseFirestoreValue_(f.Full_Name) || targetUsername;
    var targetStatus    = parseFirestoreValue_(f.Status)    || "Active";

    if (callerUsername && targetUsername.toLowerCase() === String(callerUsername).toLowerCase()) {
      return { success: false, message: "ไม่สามารถรีเซ็ตรหัสผ่านของบัญชีตัวเองได้ กรุณาใช้เมนู 'เปลี่ยนรหัสผ่าน' ในหน้าโปรไฟล์แทน" };
    }
    if (!targetEmail) {
      return { success: false, message: "บัญชีนี้ไม่มีอีเมลผูกไว้ ไม่สามารถส่งลิงก์รีเซ็ตรหัสผ่านได้" };
    }
    if (targetStatus !== "Active") {
      return { success: false, message: "บัญชีนี้ถูกปิดใช้งานอยู่ กรุณาเปิดใช้งานก่อนรีเซ็ตรหัสผ่าน" };
    }

    // ★ รีเซ็ตรหัสผ่านแล้วต้องเพิกถอน session เดิมทั้งหมดทันที — เผื่อเหตุผลที่แอดมินรีเซ็ตให้คือ
    //   สงสัยว่าบัญชีนี้ถูกขโมยไปใช้ ถ้าไม่เพิกถอน คนที่ถือ session เดิมอยู่ (ผู้ไม่ประสงค์ดี) ยังใช้งาน
    //   ต่อได้จนกว่าจะหมดอายุเอง แม้เจ้าของบัญชีตัวจริงจะตั้งรหัสผ่านใหม่ไปแล้วก็ตาม
    if(!updateUserFields_(docId,{Session_Version:Utilities.getUuid(),Must_Change_Password:"true"},targetDoc.updateTime)) return {success:false,message:"บัญชีเปลี่ยนแปลงแล้ว กรุณารีเฟรชแล้วลองใหม่"};

    var resetToken=storePasswordResetToken_(readAuthUser_(docId));

    var resetUrl = getWebAppUrl_() + "?page=login&mode=reset&rtoken=" + encodeURIComponent(resetToken);

    var body =
      "สวัสดีคุณ " + targetFullName + ",\n\n" +
      "ผู้ดูแลระบบได้ทำการรีเซ็ตรหัสผ่านสำหรับบัญชี SYY Shop Control ของคุณ\n" +
      "กรุณากดลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์นี้ใช้ได้ภายใน " + RESET_TOKEN_MINUTES + " นาที และใช้ได้ครั้งเดียว)\n\n" +
      resetUrl + "\n\n" +
      "หากคุณไม่ได้เป็นผู้ร้องขอ กรุณาติดต่อผู้ดูแลระบบทันที\n\n" +
      "— ระบบ SYY Shop Control";

    var emailSent = true;
    try {
      MailApp.sendEmail(targetEmail, "รีเซ็ตรหัสผ่านโดยผู้ดูแลระบบ — SYY Shop Control", body);
    } catch (mailErr) {
      console.error("resetUserPassword: ส่งอีเมลไม่สำเร็จ", mailErr);
      emailSent = false;
    }



    return {
      success : true,
      message : emailSent
                  ? "ส่งลิงก์รีเซ็ตรหัสผ่านไปยังอีเมลของผู้ใช้เรียบร้อยแล้ว"
                  : "สร้างลิงก์รีเซ็ตรหัสผ่านสำเร็จ แต่ส่งอีเมลไม่สำเร็จ กรุณาแจ้งผู้ใช้ให้กดลืมรหัสผ่านเองแทน"
    };
  } catch (e) {
    console.error("resetUserPassword error:", e);
    return { success: false, message: "เกิดข้อผิดพลาด: " + e.message };
  }
}

function toggleUserStatus_(docId, newStatus, callerUsername) {
  if (!docId) return { success: false, message: "ไม่พบรหัสผู้ใช้" };
  if (newStatus !== "Active" && newStatus !== "Inactive") {
    return { success: false, message: "สถานะไม่ถูกต้อง" };
  }

  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + AUTH_USERS_COLLECTION + "/" + docId;
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader_(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { success: false, message: "ไม่พบบัญชีผู้ใช้นี้" };

    var targetDoc = JSON.parse(res.getContentText());
    var f = targetDoc.fields || {};
    var targetUsername = parseFirestoreValue_(f.Username) || "";

    if (callerUsername && targetUsername.toLowerCase() === String(callerUsername).toLowerCase()) {
      return { success: false, message: "ไม่สามารถเปลี่ยนสถานะบัญชีตัวเองได้" };
    }

    var changes = {Status:newStatus};
    if (parseFirestoreValue_(f.Status) !== newStatus) changes.Session_Version = Utilities.getUuid();
    var ok = updateUserFields_(docId, changes, targetDoc.updateTime);
    if (!ok) return {success:false, message:"ข้อมูลบัญชีเปลี่ยนแปลงแล้ว กรุณารีเฟรชแล้วลองใหม่"};

    return {
      success: true,
      message: newStatus === "Active" ? "เปิดใช้งานบัญชีเรียบร้อยแล้ว" : "ปิดใช้งานบัญชีเรียบร้อยแล้ว"
    };
  } catch (e) {
    console.error("toggleUserStatus error:", e);
    return { success: false, message: "เกิดข้อผิดพลาด: " + e.message };
  }
}

function authChangePasswordForced(tempToken, newPassword, userAgent) {
  try {
    if(!allowAuthRequest_("force",tempToken))return {success:false,message:"ส่งคำขอบ่อยเกินไป กรุณารอสักครู่"};
    var cacheKey = "pwforce_" + tempToken;
    var raw = CacheService.getScriptCache().get(cacheKey);
    if (!raw) return { success: false, message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง" };

    if (typeof newPassword!=='string' || newPassword.length<8 || newPassword.length>256) {
      return { success: false, message: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร" };
    }

    var data = JSON.parse(raw);
    var user=readAuthUser_(data.docId);
    if(user.Status!=="Active" || user.Username!==data.username || user.Password_Hash!==data.passwordHash || user.Session_Version!==String(data.sessionVersion||"")) return {success:false,message:"บัญชีเปลี่ยนแปลงแล้ว กรุณาเข้าสู่ระบบใหม่"};

    if (isSamePassword_(user, newPassword)) {
      return { success: false, message: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม กรุณาตั้งรหัสผ่านใหม่ที่แตกต่างออกไป" };
    }

    var sessionVersion=Utilities.getUuid();
    var newSalt = makeSalt_(),newHash=hashPassword_(newPassword,newSalt);
    var ok = updateUserFields_(user.docId, {
      Session_Version      : sessionVersion,
      Password_Hash        : newHash,
      Salt                 : newSalt,
      Must_Change_Password : "false",
      Password_Changed_At  : new Date().toISOString(),
      Failed_Attempts      : 0,
      Locked_Until         : ""
    },user.updateTime);

    if(!ok){try{var confirmed=readAuthUser_(user.docId);ok=confirmed.Session_Version===sessionVersion&&confirmed.Password_Hash===newHash;}catch(e){}}
    if (!ok) return { success: false, message: "บันทึกรหัสผ่านใหม่ไม่สำเร็จ กรุณาลองใหม่" };

    CacheService.getScriptCache().remove(cacheKey);
    user = readAuthUser_(user.docId);
    if(user.Session_Version!==sessionVersion || user.Status!=="Active") return {success:false,message:"บัญชีเปลี่ยนแปลงแล้ว กรุณาเข้าสู่ระบบใหม่"};
    var sess = createSession_(user, userAgent);
    return {
      success : true,
      token   : sess.token,
      profile : sess.profile,
      message : "ตั้งรหัสผ่านใหม่สำเร็จ กำลังเข้าสู่ระบบ..."
    };
  } catch (e) {
    console.error("authChangePasswordForced error:", e);
    return { success: false, message: "เกิดข้อผิดพลาดในระบบ: " + e.message };
  }
}

/* ═══════════════════════════════════════════════════════════════════
   ส่วนเสริม "ตัดสต๊อก" (Stock Issue) — จาก UI Audit and Redesign
   ใช้ helper เดิมด้านบน: getAuthHeader, PROJECT_ID, parseFirestoreValue, fetchAllPagesRaw, logActivity_
   ═══════════════════════════════════════════════════════════════════ */

var STOCK_MOVEMENT_COLLECTION = "Stock_Movements";

// เหตุผลที่อนุญาต — ถ้าส่งค่าอื่นมาจะถูกปฏิเสธ (กันข้อมูลเพี้ยนจาก client)
var ISSUE_REASONS = ["ขายหน้าร้าน", "ขาย Online", "เบิกใช้ภายใน", "คืน Supplier", "สินค้าชำรุด", "สูญหาย"];

function fsDocPath_(collection, docId) {
  if(!validDocumentId_(String(docId || ""))) throw new Error("รหัสเอกสารไม่ถูกต้อง");
  return "projects/" + PROJECT_ID + "/databases/(default)/documents/" + collection + "/" + docId;
}

function fsCommit_(writes) {
  writes.forEach(function(w){if(w.update && w.update.name.indexOf("/"+STOCK_MOVEMENT_COLLECTION+"/")>=0){w.updateTransforms=w.updateTransforms||[{fieldPath:"Committed_At",setToServerValue:"REQUEST_TIME"}];w.currentDocument=w.currentDocument||{exists:false};}});
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
          + "/databases/(default)/documents:commit";
  var res = UrlFetchApp.fetch(url, {
    method            : "post",
    headers           : getAuthHeader_(),
    payload           : JSON.stringify({ writes: writes }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 200) return { ok: true };
  console.error("fsCommit_ HTTP " + res.getResponseCode() + ": " + res.getContentText());
  return { ok: false, message: res.getContentText() };
}

// ★ ใช้เช็คว่า fsCommit_ ล้มเหลวเพราะ currentDocument precondition ไม่ตรง (มีคนเขียนเอกสารแทรก
//   ระหว่างที่เราอ่าน-ตรวจ-เขียน) ซึ่งเป็นกรณีเดียวที่ควรวนลองใหม่ — error แบบอื่นไม่ควร retry
function isPreconditionFailure_(commitMessage) {
  return /FAILED_PRECONDITION/i.test(String(commitMessage || ""));
}

/**
 * อ่านสต๊อกปัจจุบันของสินค้าเฉพาะรายการที่ต้องใช้ (batchGet — ไม่ต้องอ่านทั้ง collection)
 * คืน map: productCode -> { name, stock, minStock, costPrice, updateTime }
 * ★ updateTime ใช้เป็น precondition ตอนตัดสต๊อก (issueStock) กันเขียนทับกันเมื่อมีคำขอพร้อมกัน
 */
function getProductStockMap_(codes) {
  var map = {};
  var uniq = [];
  (codes || []).forEach(function (c) { if (c && uniq.indexOf(c) === -1) uniq.push(c); });
  if (!uniq.length) return map;

  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
          + "/databases/(default)/documents:batchGet";
  var res = UrlFetchApp.fetch(url, {
    method            : "post",
    headers           : getAuthHeader_(),
    payload           : JSON.stringify({ documents: uniq.map(function (c) { return fsDocPath_("Master_Products", c); }) }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.error("getProductStockMap_ HTTP " + res.getResponseCode() + ": " + res.getContentText());
    throw new Error("โหลดสต๊อกปัจจุบันไม่สำเร็จ กรุณาลองใหม่");
  }

  (JSON.parse(res.getContentText()) || []).forEach(function (row) {
    if (!row.found) return;
    var f  = row.found.fields || {};
    var id = row.found.name.split("/").pop();
    ["Current_Stock","Min_Stock","Cost_Price","Selling_Price"].forEach(function(k){if(f[k] && !isFinite(Number(parseFirestoreValue_(f[k]))))throw new Error("ข้อมูลสินค้าไม่ถูกต้อง: "+id);});
    map[id] = {
      name         : parseFirestoreValue_(f.Product_Name) || id,
      stock        : parseFloat(parseFirestoreValue_(f.Current_Stock)) || 0,
      minStock     : parseFloat(parseFirestoreValue_(f.Min_Stock))     || 0,
      costPrice    : parseFloat(parseFirestoreValue_(f.Cost_Price))    || 0,
      sellingPrice : parseFloat(parseFirestoreValue_(f.Selling_Price)) || 0,
      updateTime   : row.found.updateTime || ""
    };
  });
  return map;
}

/**
 * ★ ตัดสต๊อก — ใช้จากหน้า StockIssue.html
 * d = { reason, refNo, note, allowNegative, items:[{productCode, productName, qty, unitPrice}] }
 * callerUsername = username จริงจาก session (apiGateway inject ให้อัตโนมัติ)
 *
 * ทำใน commit เดียว: ลดสต๊อก (fieldTransform increment ค่าลบ) + เขียน Stock_Movements ทุกบรรทัด
 * ถ้าคอมมิตไม่ผ่าน จะไม่มีอะไรถูกเขียนเลย (atomic) — สต๊อกกับ log จึงไม่หลุดจากกัน
 */
function issueStock_(d, callerUsername) {
  function fail(msg, extra) {
    var o = { success: false, title: "ไม่สำเร็จ", message: msg };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }

  var commitAttempted=false;
  try {
    d = d || {};
    var items = Array.isArray(d.items) ? d.items : [];
    if (!items.length || items.length > 200 || items.some(function(it) {return !it || !validDocumentId_(it.productCode) || !validBusinessNumber_(it.qty,0,true);})) return fail("จำนวนสินค้าต้องมากกว่า 0 และไม่เกิน 200 รายการ");
    var user = callerUsername || getCurrentUsername_();
    var request = stockRequest_("SI",d,user), replay = replayStockRequest_(request);
    if (replay) return replay;

    var reason = String(d.reason || "").trim();
    if (ISSUE_REASONS.indexOf(reason) === -1) return fail("กรุณาเลือกเหตุผลที่ตัดสต๊อกให้ถูกต้อง");

    // รวมรายการซ้ำรหัสเดียวกันเข้าด้วยกัน กันตัดสองรอบ
    // ★ ไม่รับ unitPrice จาก client เลย — ราคาตัดสต๊อกต้องอ้างอิง Master_Products.Selling_Price เท่านั้น
    //   (ล็อกที่ฝั่ง server ไม่ใช่แค่ซ่อนช่องกรอกที่ UI เพราะ apiGateway ยังเรียกได้ตรงถ้ารู้ token)
    var merged = Object.create(null);
    items.forEach(function (it) {
      var code = String(it.productCode);
      if (!merged[code]) merged[code] = { productCode: code, productName: it.productName || "", qty: 0 };
      merged[code].qty += Number(it.qty);
    });
    var lines0 = Object.keys(merged).map(function (k) { return merged[k]; });

    if(lines0.some(function(l){return !validBusinessNumber_(l.qty,0,true);}))return fail("จำนวนรวมสินค้าต้องถูกต้อง");

    // ★ ถ้าตัดสต๊อกจากใบเสนอราคาที่ "ปิดงาน-ขายสำเร็จ" แล้ว ใช้ราคาที่เสนอไปจริง (ผ่านการอนุมัติแล้ว)
    //   เฉพาะสินค้าที่อยู่ในใบเสนอราคานั้น แทนราคา Master Product — ตรวจสอบจากเอกสารจริงบน server
    //   เองเท่านั้น (ไม่เชื่อราคาที่ client ส่งมาตรงๆ) กันตั้งราคาปลอมโดยอ้างว่ามาจากใบเสนอราคา
    var quotedPriceMap = Object.create(null), quoteDoc = null;
    if (d.quoteId) {
      quoteDoc = readExistingDocument_(QUOTATION_COLLECTION,d.quoteId);
      var qf = quoteDoc.fields || {};
      if (!quoteDoc.updateTime || parseFirestoreValue_(qf.Status) !== "ปิดงาน-ขายสำเร็จ") return fail("ใบเสนอราคาต้องปิดงานขายสำเร็จก่อนตัดสต๊อก");
      JSON.parse(parseFirestoreValue_(qf.Items_JSON) || "[]").forEach(function(it) {quotedPriceMap[it.productCode]=Number(it.unitPrice);});
      if (lines0.some(function(l) {return !Object.prototype.hasOwnProperty.call(quotedPriceMap,l.productCode) || !isFinite(quotedPriceMap[l.productCode]) || quotedPriceMap[l.productCode] < 0;})) return fail("สินค้าหรือราคาไม่ตรงกับใบเสนอราคา");
    }
    var nowIso = new Date().toISOString(), docNo = request.docNo;

    // ★ FIX: เดิมอ่านสต๊อกมาตรวจ "พอไหม" ครั้งเดียวแล้วค่อยเขียน increment แยกจังหวะกัน — ถ้า 2 คำขอ
    //   ตัดสต๊อกสินค้าตัวเดียวกัน (เช่นชิ้นสุดท้าย) มาพร้อมกันพอดี ทั้งคู่จะอ่านเจอว่า "พอ" ก่อนที่อีกฝ่าย
    //   จะเขียนจริง ทำให้สต๊อกติดลบได้ทั้งที่ไม่มีใครสั่ง allowNegative เลย — ผูก updateTime ตอนอ่านเป็น
    //   precondition ตอนเขียน ถ้ามีคนแก้สินค้าตัวเดียวกันแทรกก่อน commit ทั้งชุดจะถูกปฏิเสธ (atomic)
    //   แล้ววนกลับไปอ่าน-ตรวจ-เขียนใหม่ในรอบถัดไปแทน
    var MAX_ATTEMPTS = 3;
    var lines, commit;
    for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      var stockMap = getProductStockMap_(lines0.map(function (l) { return l.productCode; }));

      var notFound     = [];
      var insufficient = [];
      lines = lines0.map(function (l0) {
        return { productCode: l0.productCode, productName: l0.productName, qty: l0.qty };
      });
      lines.forEach(function (l) {
        var info = stockMap[l.productCode];
        if (!info || !info.updateTime) { notFound.push(l.productCode); return; }
        l.before     = info.stock;
        l.after      = info.stock - l.qty;
        l.minStock   = info.minStock;
        l.costPrice  = info.costPrice;
        l.updateTime = info.updateTime;
        l.unitPrice  = Object.prototype.hasOwnProperty.call(quotedPriceMap,l.productCode) ? quotedPriceMap[l.productCode] : info.sellingPrice;
        l.productName = info.name;
        if (l.after < 0) insufficient.push({ productCode: l.productCode, productName: l.productName, stock: info.stock, need: l.qty });
      });

      if (notFound.length)     return fail("ไม่พบสินค้ารหัส: " + notFound.join(", "));
      if (insufficient.length && !d.allowNegative) {
        return fail("จำนวนที่ตัดเกินสต๊อกคงเหลือ: " + insufficient.map(function (x) {
          return x.productName + " (คงเหลือ " + x.stock + " ต้องการ " + x.need + ")";
        }).join(", "), { insufficient: insufficient });
      }

      var writes = [];
      lines.forEach(function (l, i) {
        // 1) ลดสต๊อก — ผูก precondition กับ updateTime ที่อ่านมาข้างบน
        var stockWrite = {
          transform: {
            document: fsDocPath_("Master_Products", l.productCode),
            fieldTransforms: [{ fieldPath: "Current_Stock", increment: { doubleValue: -l.qty } }]
          }
        };
        if (l.updateTime) stockWrite.currentDocument = { updateTime: l.updateTime };
        writes.push(stockWrite);

        // 2) บันทึกประวัติ (1 บรรทัด = 1 เอกสาร ทำให้ดูประวัติรายสินค้าได้)
        writes.push({
          update: {
            name: fsDocPath_(STOCK_MOVEMENT_COLLECTION, docNo + "-" + (i + 1)),
            fields: {
              Doc_No       : { stringValue: docNo },
              Type         : { stringValue: "OUT" },
              Product_Code : { stringValue: l.productCode },
              Product_Name : { stringValue: String(l.productName) },
              Qty          : { doubleValue: l.qty },
              Stock_Before : { doubleValue: l.before },
              Stock_After  : { doubleValue: l.after },
              Unit_Price   : { doubleValue: parseFloat(l.unitPrice || 0) },
              Cost_Price   : { doubleValue: parseFloat(l.costPrice || 0) },
              Reason       : { stringValue: reason },
              Quote_Id     : {stringValue:String(d.quoteId || "")},
              Ref_No       : { stringValue: String(d.refNo || "") },
              Note         : { stringValue: String(d.note  || "") },
              User         : { stringValue: user },
              Timestamp    : { stringValue: nowIso }
            }
          }
        });
      });

      var result = {success:true,title:"สำเร็จ",message:"ตัดสต๊อกเรียบร้อย",docNo:docNo,
        results:lines.map(function(l) {return {productCode:l.productCode,productName:l.productName,qty:l.qty,before:l.before,after:l.after,belowMin:l.after <= l.minStock};})};
      if (quoteDoc) writes.push({update:{name:fsDocPath_(QUOTATION_COLLECTION,d.quoteId),fields:mapToFirestoreFields_({Stock_Issued:"true",Stock_Issue_Doc:docNo,Stock_Issued_By:user,Stock_Issued_At:nowIso})},
        updateMask:{fieldPaths:["Stock_Issued","Stock_Issue_Doc","Stock_Issued_By","Stock_Issued_At"]},currentDocument:{updateTime:quoteDoc.updateTime}});
      sealStockRequest_(writes,request,result);
      commitAttempted=true;
      commit = fsCommit_(writes);
      if (commit.ok) break;
      replay = replayStockRequest_(request);
      if (replay) return replay;
      if (!isPreconditionFailure_(commit.message) || attempt === MAX_ATTEMPTS) {
        return { success: false, title: "ล้มเหลว", message: "บันทึกไม่สำเร็จ: " + commit.message };
      }
      // มีคนแก้สต๊อกสินค้าตัวใดตัวหนึ่งแทรกพอดีระหว่างที่กำลังตัด — วนไปอ่าน-ตรวจ-เขียนใหม่รอบถัดไป
      Utilities.sleep(150 * attempt);
    }

    clearCollectionCache_("Master_Products");
    return result;
  } catch (e) {
    return {success:false,title:"ข้อผิดพลาด",message:e.message,uncertain:commitAttempted || /ตรวจสอบรายการเดิม|network|timeout/i.test(e.message)};
  }
}

/**
 * ★ เพิ่มสต๊อกแบบมีประวัติ — ใช้แทน incrementProductStockBatch() ตอนรับของ
 *   เรียกจาก receiveGoods(d, callerUsername): logStockIn_(stockAdditions, "รับของตาม PO", d.poId, callerUsername)
 */
function logStockIn_(additions, reason, refNo, callerUsername) {
  var list = (additions || []).filter(function (it) { return it && it.productCode && parseFloat(it.qty || 0) > 0; });
  if (!list.length) return true;

  var stockMap = getProductStockMap_(list.map(function (l) { return l.productCode; }));
  var user     = callerUsername || getCurrentUsername_();
  var nowIso   = new Date().toISOString();
  // ★ FIX: เดิม docNo ชนกันได้ถ้ารับของ 2 รอบในวินาทีเดียวกัน (เขียนทับประวัติกันเงียบๆ) — เติมสุ่มท้ายกันชน
  var docNo    = "SR" + Utilities.formatDate(new Date(), "Asia/Bangkok", "yyMMdd-HHmmss")
               + "-" + Utilities.getUuid().replace(/-/g, "").slice(0, 4).toUpperCase();

  var writes = [];
  list.forEach(function (l, i) {
    var info   = stockMap[l.productCode] || { stock: 0, name: l.productCode };
    var qty    = parseFloat(l.qty || 0);
    writes.push({
      transform: {
        document: fsDocPath_("Master_Products", l.productCode),
        fieldTransforms: [{ fieldPath: "Current_Stock", increment: { doubleValue: qty } }]
      }
    });
    writes.push({
      update: {
        name: fsDocPath_(STOCK_MOVEMENT_COLLECTION, docNo + "-" + (i + 1)),
        fields: {
          Doc_No       : { stringValue: docNo },
          Type         : { stringValue: "IN" },
          Product_Code : { stringValue: l.productCode },
          Product_Name : { stringValue: String(l.productName || info.name) },
          Qty          : { doubleValue: qty },
          Stock_Before : { doubleValue: info.stock },
          Stock_After  : { doubleValue: info.stock + qty },
          Reason       : { stringValue: String(reason || "รับสินค้าเข้าคลัง") },
          Ref_No       : { stringValue: String(refNo || "") },
          User         : { stringValue: user },
          Timestamp    : { stringValue: nowIso }
        }
      }
    });
  });

  var committed = fsCommit_(writes).ok;
  if (committed) clearCollectionCache_("Master_Products");
  return committed;
}

/**
 * ★ ดึงประวัติเข้า-ออก (ล่าสุดก่อน) — ใส่ productCode เพื่อดูรายสินค้า
 */
function getStockMovements_(limit, productCode) {
  var out = [];
  try {
    var q = {
      from    : [{ collectionId: STOCK_MOVEMENT_COLLECTION }],
      orderBy : [{ field: { fieldPath: "Timestamp" }, direction: "DESCENDING" }],
      limit   : Math.min(parseInt(limit, 10) || 200, 1000)
    };
    if (productCode) {
      q.where = { fieldFilter: { field: { fieldPath: "Product_Code" }, op: "EQUAL", value: { stringValue: String(productCode) } } };
    }

    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents:runQuery";
    var res = UrlFetchApp.fetch(url, {
      method            : "post",
      headers           : getAuthHeader_(),
      payload           : JSON.stringify({ structuredQuery: q }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) throw new Error("โหลดข้อมูลไม่สำเร็จ (" + res.getResponseCode() + ")");
    if (res.getResponseCode() !== 200) {
      console.error("getStockMovements HTTP " + res.getResponseCode() + ": " + res.getContentText());
      return out;
    }

    (JSON.parse(res.getContentText()) || []).forEach(function (row) {
      if (!row.document) return;
      var f = row.document.fields || {};
      out.push({
        id          : row.document.name.split("/").pop(),
        docNo       : parseFirestoreValue_(f.Doc_No),
        type        : parseFirestoreValue_(f.Type) || "OUT",
        productCode : parseFirestoreValue_(f.Product_Code),
        productName : parseFirestoreValue_(f.Product_Name),
        qty         : parseFloat(parseFirestoreValue_(f.Qty)) || 0,
        stockAfter  : parseFirestoreValue_(f.Stock_After),
        unitPrice   : parseFloat(parseFirestoreValue_(f.Unit_Price)) || 0,
        costPrice   : parseFloat(parseFirestoreValue_(f.Cost_Price)) || 0,
        reason      : parseFirestoreValue_(f.Reason),
        refNo       : parseFirestoreValue_(f.Ref_No),
        note        : parseFirestoreValue_(f.Note),
        user        : parseFirestoreValue_(f.User),
        timestamp   : parseFirestoreValue_(f.Timestamp)
      });
    });
  } catch (e) { console.error("getStockMovements_ read failed", e); throw e; }
  return out;
}

/**
 * ★ ดึงประวัติเข้า-ออกทั้งหมด (ไม่จำกัด limit เหมือน getStockMovements) — ใช้สร้าง Dashboard สต๊อก
 * คืนค่าดิบ ให้ฝั่งหน้าเว็บไปคำนวณ KPI / กราฟ / stock health เองแบบ client-side ทั้งหมด
 * (โหลดครั้งเดียวตอนเปิดหน้า / กดรีเฟรช ไม่ต้องยิง API ซ้ำตอนสลับตัวกรอง)
 */
function fetchAllStockMovements_() {
  var out = [];
  var fetched = fetchAllPagesRaw_(STOCK_MOVEMENT_COLLECTION);
  if (!fetched.ok) return out;

  fetched.docs.forEach(function (doc) {
    var f  = doc.fields || {};
    var ts = parseFirestoreValue_(f.Timestamp);
    if (!ts) return; // เอกสารเพี้ยน/ไม่มีเวลา ข้ามไปกันกราฟพัง

    out.push({
      docNo       : parseFirestoreValue_(f.Doc_No)       || "",
      type        : parseFirestoreValue_(f.Type)         || "OUT",
      productCode : parseFirestoreValue_(f.Product_Code) || "",
      productName : parseFirestoreValue_(f.Product_Name) || "",
      qty         : parseFloat(parseFirestoreValue_(f.Qty))        || 0,
      stockAfter  : parseFloat(parseFirestoreValue_(f.Stock_After))|| 0,
      unitPrice   : parseFloat(parseFirestoreValue_(f.Unit_Price)) || 0,
      costPrice   : parseFloat(parseFirestoreValue_(f.Cost_Price)) || 0,
      reason      : parseFirestoreValue_(f.Reason) || "",
      refNo       : parseFirestoreValue_(f.Ref_No) || "",
      note        : parseFirestoreValue_(f.Note)   || "",
      user        : parseFirestoreValue_(f.User)   || "",
      timestamp   : ts
    });
  });
  return out;
}

var DASHBOARD_YEARS_BACK = 4;

function dashboardRangeStart_(year){year=Number(year)||Number(businessDate_().slice(0,4));return new Date(Date.UTC(year-1,0,1)-7*3600000).toISOString();}

function mapDashboardMovementRow_(row) {
  if (!row || !row.document) return null;
  var f = row.document.fields || {}, ts = parseFirestoreValue_(f.Timestamp);
  if (!ts) return null;
  return {
    id          : row.document.name.split('/').pop(),
    docNo       : parseFirestoreValue_(f.Doc_No) || "",
    type        : parseFirestoreValue_(f.Type) || "OUT",
    productCode : parseFirestoreValue_(f.Product_Code) || "",
    productName : parseFirestoreValue_(f.Product_Name) || "",
    qty         : parseFloat(parseFirestoreValue_(f.Qty)) || 0,
    stockAfter  : parseFloat(parseFirestoreValue_(f.Stock_After)) || 0,
    unitPrice   : parseFloat(parseFirestoreValue_(f.Unit_Price)) || 0,
    costPrice   : f.Cost_Price ? Number(parseFirestoreValue_(f.Cost_Price)) : null,
    committedAt : parseFirestoreValue_(f.Committed_At) || "",
    reason      : parseFirestoreValue_(f.Reason) || "",
    refNo       : parseFirestoreValue_(f.Ref_No) || "",
    note        : parseFirestoreValue_(f.Note) || "",
    user        : parseFirestoreValue_(f.User) || "",
    timestamp   : ts
  };
}

function queryDashboardMovementsRange_(fromIso, toIso, committedCursor) {
  var field = committedCursor ? "Committed_At" : "Timestamp", filters = [], out = [];
  if (fromIso) {
    var start = committedCursor ? new Date(new Date(fromIso).getTime()-60000).toISOString() : fromIso;
    var value = committedCursor ? {timestampValue:start} : {stringValue:start};
    filters.push({fieldFilter:{field:{fieldPath:field},op:"GREATER_THAN_OR_EQUAL",value:value}});
  }
  if (toIso && !committedCursor) filters.push({fieldFilter:{field:{fieldPath:field},op:"LESS_THAN_OR_EQUAL",value:{stringValue:toIso}}});
  var q = {from:[{collectionId:STOCK_MOVEMENT_COLLECTION}],orderBy:[{field:{fieldPath:field},direction:"DESCENDING"}]};
  if (filters.length === 1) q.where=filters[0];
  else if (filters.length) q.where={compositeFilter:{op:"AND",filters:filters}};
  var url="https://firestore.googleapis.com/v1/projects/"+PROJECT_ID+"/databases/(default)/documents:runQuery";
  var res=UrlFetchApp.fetch(url,{method:"post",headers:getAuthHeader_(),payload:JSON.stringify({structuredQuery:q}),muteHttpExceptions:true});
  if(res.getResponseCode()!==200) throw new Error("โหลดการเคลื่อนไหวไม่สำเร็จ กรุณาลองใหม่");
  var readTime="";
  JSON.parse(res.getContentText()).forEach(function(row) {
    if(row.readTime && (!readTime || row.readTime > readTime)) readTime=row.readTime;
    var m=mapDashboardMovementRow_(row); if(m) out.push(m);
  });
  if(!readTime) throw new Error("ไม่พบเวลายืนยันข้อมูลจาก Firestore");
  out.readTime=readTime;
  return out;
}

function buildPoVendorMapForMovements_(movements) {
  var refs = [], seen = {};
  (movements || []).forEach(function(m) {
    if (m.type !== "IN" || !m.refNo || seen[m.refNo]) return;
    seen[m.refNo] = true; refs.push(String(m.refNo));
  });
  if (!refs.length) return {};
  var vendorMap = buildVendorMap_(), out = {};
  var endpoint = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents:batchGet";
  for (var i = 0; i < refs.length; i += 100) {
    var batch = refs.slice(i, i + 100);
    var res = UrlFetchApp.fetch(endpoint, {
      method:"post", headers:getAuthHeader_(), muteHttpExceptions:true,
      payload:JSON.stringify({documents:batch.map(function(id){ return fsDocPath_("Purchase_Orders", id); })})
    });
    if (res.getResponseCode() !== 200) throw new Error("โหลดข้อมูลใบสั่งซื้อไม่สำเร็จ");
    (JSON.parse(res.getContentText()) || []).forEach(function(row) {
      if (!row.found) return;
      var id = row.found.name.split('/').pop(), f = row.found.fields || {};
      var vendorId = parseFirestoreValue_(f.Vendor_ID) || "", v = vendorMap[vendorId] || {};
      out[id] = v.Vendor_name || vendorId;
      var items=JSON.parse(parseFirestoreValue_(f.Items_JSON)||"[]"), costs={};
      items.forEach(function(it) {if(it.costPrice!=null && isFinite(Number(it.costPrice)) && Number(it.costPrice)>=0) costs[it.productCode]=Number(it.costPrice);});
      movements.forEach(function(m) {if(m.type === "IN" && m.refNo === id && m.costPrice === null && Object.prototype.hasOwnProperty.call(costs,m.productCode)) m.costPrice=costs[m.productCode];});
    });
  }
  return out;
}

function getDashboardBootstrap_(options){var now=new Date(),current=Number(businessDate_().slice(0,4)),year=Number(options&&options.year)||current;if(!Number.isInteger(year)||year<current-4||year>current)throw new Error('ปีไม่ถูกต้อง');var start=dashboardRangeStart_(year),end=year===current?now.toISOString():new Date(Date.UTC(year+1,0,1)-7*3600000-1).toISOString();var movements=queryDashboardMovementsRange_(start,end,false),readTime=movements.readTime;
  if(year<current){var recent=queryDashboardMovementsRange_(dashboardRangeStart_(current),now.toISOString(),false),seen={};movements.forEach(function(m){seen[m.id]=true;});recent.forEach(function(m){if(!seen[m.id])movements.push(m);});readTime=recent.readTime;}
  return {products:getAllProducts_(),movements:movements,poVendorMap:buildPoVendorMapForMovements_(movements),bounded:true,year:year,rangeStart:start,healthRangeStart:dashboardRangeStart_(current),serverTime:readTime};}

function getDashboardDelta_(sinceIso) {
  var since = String(sinceIso || "").trim();
  if (!since || isNaN(new Date(since).getTime())) return { success:false, fullRefresh:true, message:"sync watermark ไม่ถูกต้อง" };
  var serverTime = new Date().toISOString();
  var movements = queryDashboardMovementsRange_(since, null, true);
  var codes = [], seen = {};
  movements.forEach(function(m) { if (m.productCode && !seen[m.productCode]) { seen[m.productCode]=true; codes.push(m.productCode); } });
  var stocks = getProductStockMap_(codes), productStocks = [];
  Object.keys(stocks).forEach(function(code) {
    var x = stocks[code];
    productStocks.push({productCode:code,currentStock:x.stock,minStock:x.minStock,costPrice:x.costPrice,sellingPrice:x.sellingPrice});
  });
  return {
    success:true, movements:movements, productStocks:productStocks,
    poVendorMap:buildPoVendorMapForMovements_(movements), serverTime:movements.readTime
  };
}

/**
 * ชื่อผู้ใช้สำรอง — ใช้เฉพาะตอนไม่มี session token ส่งมา (เช่น เรียกจาก Apps Script Editor ตรงๆ)
 * ทางปกติ apiGateway จะ inject username จริงจาก session ให้ issueStock/logStockIn_ อยู่แล้ว (ดูข้อ 23 ด้านบน)
 */
function getCurrentUsername_() {
  try {
    return Session.getActiveUser().getEmail() || "system";
  } catch (e) {
    return "system";
  }
}


// Fresh targeted reads keep authentication independent of evictable collection caches.
function readAuthUser_(docId) {return authUserFromDoc_(Object.assign({id:docId},readExistingDocument_(AUTH_USERS_COLLECTION,docId)));}
var validatedGatewaySession_ = null;


function validDateOnly_(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(new Date(value + "T00:00:00Z").getTime()) && new Date(value + "T00:00:00Z").toISOString().slice(0,10) === value;
}
function appendYearMeta_(id, yearBE) {
  yearBE = Number(yearBE);
  if (!Number.isInteger(yearBE) || yearBE < 2400 || yearBE > 3000) throw new Error("ปีเอกสารไม่ถูกต้อง");
  var url = "https://firestore.googleapis.com/v1/" + fsDocPath_(META_COLLECTION, id);
  var res = UrlFetchApp.fetch(url, {method:"get",headers:getAuthHeader_(),muteHttpExceptions:true});
  if (res.getResponseCode() !== 200 && res.getResponseCode() !== 404) throw new Error("อ่านข้อมูลปีเอกสารไม่สำเร็จ");
  if(res.getResponseCode()===200){var existing=parseFirestoreValue_((JSON.parse(res.getContentText()).fields||{}).Years)||[];if(!Array.isArray(existing))throw new Error("ข้อมูลปีเอกสารไม่ถูกต้อง");if(existing.map(Number).indexOf(yearBE)>=0)return;}
  var result;
  if (res.getResponseCode() === 404) {
    result = fsCommit_([{update:{name:fsDocPath_(META_COLLECTION,id),fields:{Years:{arrayValue:{values:[{integerValue:String(yearBE)}]}}}},currentDocument:{exists:false}}]);
    if (result.ok) return;
    if (!isPreconditionFailure_(result.message) && !/ALREADY_EXISTS/i.test(result.message)) throw new Error(result.message);
  }
  result = fsCommit_([{transform:{document:fsDocPath_(META_COLLECTION,id),fieldTransforms:[{fieldPath:"Years",appendMissingElements:{values:[{integerValue:String(yearBE)}]}}]},currentDocument:{exists:true}}]);
  if (!result.ok) throw new Error("บันทึกปีเอกสารไม่สำเร็จ: " + result.message);
}


function canonicalRequest_(value) {
  if (Array.isArray(value)) return value.map(canonicalRequest_);
  if (value && typeof value === "object") {
    var out = {}; Object.keys(value).sort().forEach(function(k) {if (k !== "requestId") out[k]=canonicalRequest_(value[k]);}); return out;
  }
  return value;
}
function stockRequest_(kind, data, username) {
  var id = String(data.requestId || "");
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) throw new Error("กรุณารีเฟรชหน้าเพื่อส่งรายการพร้อมรหัสคำขอ");
  return {docNo:kind + "-" + id, fingerprint:hashPassword_(JSON.stringify(canonicalRequest_(data)), String(username) + ":" + kind)};
}
function replayStockRequest_(request) {
  var url = "https://firestore.googleapis.com/v1/" + fsDocPath_(STOCK_MOVEMENT_COLLECTION,request.docNo + "-1");
  var res = UrlFetchApp.fetch(url,{method:"get",headers:getAuthHeader_(),muteHttpExceptions:true});
  if (res.getResponseCode() === 404) return null;
  if (res.getResponseCode() !== 200) throw new Error("ตรวจสอบรายการเดิมไม่สำเร็จ กรุณาลองใหม่ด้วยรายการเดิม");
  var f = JSON.parse(res.getContentText()).fields || {};
  if (parseFirestoreValue_(f.Request_Fingerprint) !== request.fingerprint) throw new Error("รหัสคำขอนี้ถูกใช้กับรายการอื่นแล้ว");
  var result = JSON.parse(parseFirestoreValue_(f.Request_Result_JSON));
  result.replayed = true;
  try{
    if(result.poId){var po=readExistingDocument_("Purchase_Orders",result.poId),pf=po.fields||{};
      result.po={poId:result.poId,status:parseFirestoreValue_(pf.Status),items:JSON.parse(parseFirestoreValue_(pf.Items_JSON)||"[]"),receipts:JSON.parse(parseFirestoreValue_(pf.Receipts_JSON)||"[]")};result.status=result.po.status;}
    var codes=(result.results||result.productStocks||[]).map(function(x){return x.productCode;}),stock=getProductStockMap_(codes);
    result.productStocks=Object.keys(stock).map(function(code){var s=stock[code];return {productCode:code,currentStock:s.stock,minStock:s.minStock,costPrice:s.costPrice,sellingPrice:s.sellingPrice};});
  }catch(e){result.productStocks=[];result.refreshWarning="รายการเดิมบันทึกแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณารีเฟรช";}
  return result;
}
function sealStockRequest_(writes, request, result) {
  var first = true;
  writes.forEach(function(w) {
    if (!w.update || w.update.name.indexOf("/" + STOCK_MOVEMENT_COLLECTION + "/") < 0) return;
    w.currentDocument = {exists:false};
    w.updateTransforms = [{fieldPath:"Committed_At",setToServerValue:"REQUEST_TIME"}];
    if (first) {
      w.update.fields.Request_Fingerprint = {stringValue:request.fingerprint};
      var replayResult=Object.assign({},result);
      if(result.po){replayResult.poId=result.po.poId;delete replayResult.po;}
      w.update.fields.Request_Result_JSON = {stringValue:JSON.stringify(replayResult)};
      first = false;
    }
  });
  if (first) throw new Error("ไม่พบประวัติการเคลื่อนไหวสินค้า");
}


function imageDataFromFields_(f) {
  f=f||{};
  var gallery = f.Images_JSON ? JSON.parse(parseFirestoreValue_(f.Images_JSON)||"[]") : null;
  return normalizeProductImageData_(parseFirestoreValue_(f.Image_Url),parseFirestoreValue_(f.Drive_File_Id),
    gallery ? gallery.map(function(x){return x.url;}) : parseFirestoreValue_(f.Image_Urls),
    gallery ? gallery.map(function(x){return x.fileId;}) : parseFirestoreValue_(f.Drive_File_Ids),parseFirestoreValue_(f.Primary_Index));
}
// On an uncertain write outcome, retain files until a fresh metadata read confirms they are unused.
function trashUnreferencedImageFiles_(productCode, ids) {
  try {
    var current=getProductImageDocData_(productCode);
    ids.forEach(function(id){if(id && current.ids.indexOf(id)<0) {try{DriveApp.getFileById(id).setTrashed(true);}catch(e){console.error("Image cleanup deferred",id);}}});
  } catch(e) {console.error("Image cleanup deferred: metadata unavailable");}
}


function backupDigest_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(function(b){return ("0"+(b&255).toString(16)).slice(-2);}).join("");
}
function backupJsonDigest_(value) {return backupDigest_(Utilities.newBlob(JSON.stringify(canonicalBackupValue_(value))).getBytes());}
function assertPrivateBackupItem_(item) {
  var owner=item.getOwner(),email=Session.getEffectiveUser().getEmail();
  if(!email || !owner || owner.getEmail()!==email || item.getSharingAccess()!==DriveApp.Access.PRIVATE ||
     item.getEditors().concat(item.getViewers()).some(function(u){return u.getEmail()!==email;})) throw new Error("Backup ต้องอยู่ใน Drive ส่วนตัวของเจ้าของสคริปต์และไม่แชร์กับผู้อื่น");
}
function assertPrivateBackupFolder_(folder) {
  var queue=[folder],seen={};
  while(queue.length){var f=queue.shift();if(seen[f.getId()])continue;seen[f.getId()]=true;assertPrivateBackupItem_(f);
    var parents=f.getParents();while(parents.hasNext())queue.push(parents.next());}
}
function fetchBackupSnapshotCollection_(collectionName, transaction) {
  var docs=[],pageToken="",seen={};
  do {
    var url="https://firestore.googleapis.com/v1/projects/"+PROJECT_ID+"/databases/(default)/documents/"+collectionName+"?pageSize=300&transaction="+encodeURIComponent(transaction)+(pageToken?"&pageToken="+encodeURIComponent(pageToken):"");
    var res=UrlFetchApp.fetch(url,{method:"get",headers:getAuthHeader_(),muteHttpExceptions:true});
    if(res.getResponseCode()!==200) throw new Error("Backup อ่าน "+collectionName+" ไม่สำเร็จ");
    var body=JSON.parse(res.getContentText());
    (body.documents||[]).forEach(function(doc){docs.push({id:doc.name.split('/').pop(),fields:doc.fields||{},updateTime:doc.updateTime||""});});
    pageToken=body.nextPageToken||"";
    if(pageToken && seen[pageToken]) throw new Error("Backup pagination ไม่สมบูรณ์");
    seen[pageToken]=true;
  }while(pageToken);
  return docs;
}
function validateBackupBundle_(bundle, sourceProjectId) {
  if(!bundle || bundle.schemaVersion!==2 || bundle.complete!==true || bundle.projectId!==(sourceProjectId||PROJECT_ID) || !bundle.collections || !bundle.scriptProperties || !Array.isArray(bundle.assets)) throw new Error("ไฟล์นี้ไม่ใช่ Backup v2 ที่ครบถ้วนของโปรเจกต์นี้");
  if(backupJsonDigest_({collections:bundle.collections,scriptProperties:bundle.scriptProperties,assets:bundle.assets,assetFolderId:bundle.assetFolderId})!==bundle.digest) throw new Error("Backup checksum ไม่ตรง");
  var names=Object.keys(bundle.collections);
  if(names.length!==BACKUP_COLLECTIONS.length || names.some(function(n){return BACKUP_COLLECTIONS.indexOf(n)<0;})) throw new Error("Backup มีชุดข้อมูลไม่ครบหรือมีชุดข้อมูลที่ไม่อนุญาต");
  BACKUP_COLLECTIONS.forEach(function(n){
    var docs=bundle.collections[n],seen={};
    if(!Array.isArray(docs)) throw new Error("Backup collection ไม่ถูกต้อง");
    docs.forEach(function(doc){if(!doc||typeof doc.id!=="string"||!doc.id||doc.id.indexOf('/')>=0||seen[doc.id]||!doc.fields||typeof doc.fields!=="object"||Array.isArray(doc.fields)) throw new Error("Backup document ไม่ถูกต้อง");seen[doc.id]=true;});
  });
  var assets={};bundle.assets.forEach(function(asset){
    if(!asset || typeof asset.originalId!=="string" || typeof asset.backupId!=="string" || !/^[a-f0-9]{64}$/.test(asset.digest)||assets[asset.originalId])throw new Error("Backup asset ไม่ถูกต้อง");
    var file=DriveApp.getFileById(asset.backupId);assertPrivateBackupItem_(file);
    if(backupDigest_(file.getBlob().getBytes())!==asset.digest)throw new Error("รูปใน Backup checksum ไม่ตรง");
    assets[asset.originalId]=asset;
  });
  bundle.collections.Product_Images.forEach(function(doc){imageDataFromFields_(doc.fields).ids.forEach(function(id){if(!id||!assets[id])throw new Error("Backup รูปสินค้าไม่ครบ");});});
  if(bundle.collections.Master_Users.some(function(doc){return String(parseFirestoreValue_(doc.fields.Totp_Enabled))==="true";})&&!bundle.scriptProperties.AUTH_MASTER_KEY)throw new Error("Backup ไม่มีคีย์สำหรับกู้คืน TOTP");
  return assets;
}


function validDocumentId_(id) {return typeof id === "string" && id.length>0 && id.length<=500 && id.indexOf("/")<0 && id!=="." && id!==".." && !/^__.*__$/.test(id);}

function validBusinessNumber_(value, minimum, strictlyPositive) {
  if(typeof value!=="number" && typeof value!=="string")return false;
  if(typeof value==="string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))return false;
  var number=Number(value);return isFinite(number) && number<=Number.MAX_SAFE_INTEGER && (strictlyPositive ? number>minimum : number>=minimum);
}

function canonicalBackupValue_(value) {
  if(Array.isArray(value))return value.map(canonicalBackupValue_);
  if(value && typeof value === "object"){var out=Object.create(null);Object.keys(value).sort().forEach(function(k){out[k]=canonicalBackupValue_(value[k]);});return out;}
  return value;
}


// Fixed-size durable rate buckets: no raw usernames, emails, tokens or client-provided IPs.
var AUTH_RATE_POLICIES = {login:[20,600,300],forgot:[3,900,60],reset:[12,900,180],verify:[30,900,300],force:[12,900,180]};
function allowAuthRequest_(kind, subject) {
  var policy=AUTH_RATE_POLICIES[kind],lock=LockService.getScriptLock();
  if(!policy || !lock.tryLock(1500))return false;
  try {
    var props=PropertiesService.getScriptProperties(),now=Date.now();
    var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(subject||'').trim().toLowerCase());
    var slot=(bytes[0]+256)%128;
    var keys=['auth_rate_'+kind+'_global','auth_rate_'+kind+'_'+slot];
    var limits=[policy[2],policy[0]],values={};
    for(var i=0;i<keys.length;i++){
      var raw=props.getProperty(keys[i]),state=raw?JSON.parse(raw):null;
      if(!state || now-state.start>=policy[1]*1000 || now<state.start)state={start:now,count:0};
      if(state.count>=limits[i])return false;
      state.count++;values[keys[i]]=JSON.stringify(state);
    }
    props.setProperties(values);return true;
  } catch(e) {return false;} finally {lock.releaseLock();}
}
function recordFailedLogin_(docId) {
  for(var attempt=0;attempt<4;attempt++){
    var user=readAuthUser_(docId);
    if(user.Status!=='Active')return {ok:false};
    if(new Date(user.Locked_Until).getTime()>Date.now())return {ok:true,locked:true};
    var count=Number(user.Failed_Attempts)||0,locked=count+1>=AUTH_MAX_ATTEMPTS;
    var fields={Failed_Attempts:locked?0:count+1};
    if(locked)fields.Locked_Until=new Date(Date.now()+AUTH_LOCK_MINUTES*60000).toISOString();
    if(updateUserFields_(docId,fields,user.updateTime))return {ok:true,locked:locked};
  }
  return {ok:false};
}
function storePasswordResetToken_(user) {
  var token=Utilities.getUuid()+'-'+Utilities.getUuid();
  CacheService.getScriptCache().put('pwreset_'+token,JSON.stringify({username:user.Username,docId:user.docId,
    sessionVersion:String(user.Session_Version||''),passwordHash:user.Password_Hash,expiresAt:Date.now()+RESET_TOKEN_MINUTES*60000}),RESET_TOKEN_MINUTES*60);
  return token;
}
function resetTokenUser_(data) {
  if(!data.docId || !data.passwordHash || !data.expiresAt || Date.now()>=data.expiresAt)throw new Error('ลิงก์หมดอายุ กรุณาขอลิงก์ใหม่');
  var user=readAuthUser_(data.docId);
  if(user.Status!=='Active' || user.Username!==data.username || user.Password_Hash!==data.passwordHash ||
    String(user.Session_Version||'')!==String(data.sessionVersion||''))throw new Error('ลิงก์ถูกใช้หรือบัญชีเปลี่ยนแปลงแล้ว กรุณาขอลิงก์ใหม่');
  return user;
}



function collectionGeneration_(name) {return PropertiesService.getScriptProperties().getProperty('cache_gen_'+name)||'0';}
function normalizedDuplicateKey_(value) {return String(value==null?'':value).normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();}
function hasNormalizedDuplicate_(collection,field,value,docId) {
  var key=normalizedDuplicateKey_(value);if(!key)return false;
  // Equality query must succeed even when a cache exists. The legacy scan covers case/space variants.
  if(queryByEqualityField_(collection,field,String(value).trim()).some(function(d){return d.id!==docId;}))return true;
  return fetchCollectionDocsCached_(collection).some(function(d){return d.id!==docId && normalizedDuplicateKey_(parseFirestoreValue_((d.fields||{})[field]))===key;});
}



function businessDate_(instant) {return new Date((instant?new Date(instant):new Date()).getTime()+7*3600000).toISOString().slice(0,10);}
function addCalendarDays_(value,days) {
  if(!validDateOnly_(value) || !Number.isInteger(Number(days)))throw new Error('วันที่หรือจำนวนวันไม่ถูกต้อง');
  var date=new Date(value+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+Number(days));return date.toISOString().slice(0,10);
}
function backupScriptProperties_() {
  var props=PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).forEach(function(key){if(/^(cache_gen_|auth_rate_)/.test(key))delete props[key];});return props;
}
function documentReferenceExists_(collection,field,id) {return queryByEqualityField_(collection,field,id).length>0;}
function assertDeleteAllowed_(collection,id,document) {
  var f=document.fields||{},productFields={Master_Brands:'Brand_ID',Master_Categories:'Category_ID',Master_Vendors:'Default_Vendor_ID',Master_Zones:'Zone_ID'};
  function blocked(){throw new Error('ข้อมูลนี้ถูกอ้างอิงหรือมีประวัติธุรกรรม ไม่สามารถลบได้ กรุณาปิดใช้งานหรือเก็บไว้เป็นประวัติ');}
  if(productFields[collection] && documentReferenceExists_('Master_Products',productFields[collection],id))blocked();
  if(collection==='Master_Vendors' && documentReferenceExists_('Purchase_Orders','Vendor_ID',id))blocked();
  if(collection==='Master_Customers' && documentReferenceExists_(QUOTATION_COLLECTION,'Customer_ID',id))blocked();
  if(collection==='Master_Cars'){
    var products=fetchAllPagesRaw_('Master_Products');if(!products.ok)throw new Error('ตรวจสอบข้อมูลอ้างอิงไม่สำเร็จ');
    if(products.docs.some(function(d){var pf=d.fields||{},ids=parseFirestoreValue_(pf.Car_IDs)||[];return parseFirestoreValue_(pf.Car_ID)===id || Array.isArray(ids)&&ids.indexOf(id)>=0;}))blocked();
  }
  if(collection==='Master_Products'){
    var stock=parseFirestoreValue_(f.Current_Stock);
    if(stock!=='' && (!isFinite(Number(stock)) || Number(stock)!==0))blocked();
    if(documentReferenceExists_('Stock_Movements','Product_Code',id))blocked();
    ['Purchase_Orders',QUOTATION_COLLECTION].forEach(function(name){
      var rows=fetchAllPagesRaw_(name);if(!rows.ok)throw new Error('ตรวจสอบประวัติสินค้าไม่สำเร็จ');
      if(rows.docs.some(function(d){var items=JSON.parse(parseFirestoreValue_((d.fields||{}).Items_JSON)||'[]');if(!Array.isArray(items))throw new Error('ประวัติไม่สมบูรณ์');return items.some(function(it){return it.productCode===id;});}))blocked();
    });
  }
  if(collection==='Purchase_Orders'){
    var items=JSON.parse(parseFirestoreValue_(f.Items_JSON)||'[]'),receipts=JSON.parse(parseFirestoreValue_(f.Receipts_JSON)||'[]');
    if(!Array.isArray(items)||!Array.isArray(receipts))throw new Error('ประวัติใบสั่งซื้อไม่สมบูรณ์');
    if(['PartiallyReceived','Received'].indexOf(parseFirestoreValue_(f.Status))>=0 || receipts.length || items.some(function(it){return Number(it.receivedQty||0)!==0;}))blocked();
    if(documentReferenceExists_('Stock_Movements','Ref_No',id))blocked();
  }
}



var referenceMutationLocked_=false;
function withReferenceMutationLock_(worker) {
  if(referenceMutationLocked_)return worker();
  var lock=LockService.getScriptLock();if(!lock.tryLock(5000))return {success:false,message:'มีรายการอื่นกำลังบันทึก กรุณาลองใหม่'};
  referenceMutationLocked_=true;
  try{return worker();}finally{referenceMutationLocked_=false;lock.releaseLock();}
}



function authUserFromDoc_(doc) {
  var fields=doc.fields||{},user={docId:doc.id||doc.name.split('/').pop(),updateTime:doc.updateTime};
  Object.keys(fields).forEach(function(key){user[key]=parseFirestoreValue_(fields[key]);});
  user.Totp_Enabled=String(user.Totp_Enabled)==='true';user.Must_Change_Password=String(user.Must_Change_Password)==='true';user.Session_Version=String(user.Session_Version||'');return user;
}
function findAuthUser_(field,value) {
  var original=String(value||'').trim(),normalized=original.toLowerCase();if(!normalized || normalized.length>256)return null;
  var cache=CacheService.getScriptCache(),key='auth_lookup_'+PROJECT_ID+'_'+field+'_'+Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,normalized));
  var cached=cache.get(key);
  if(cached){
    try{var user=readAuthUser_(cached);if(String(user[field]||'').trim().toLowerCase()===normalized)return user;}catch(e){if(!/ไม่พบ/.test(e.message))throw e;}
    cache.remove(key);
  }
  var docs=queryByEqualityField_(AUTH_USERS_COLLECTION,field,normalized);
  if(!docs.length && original!==normalized)docs=queryByEqualityField_(AUTH_USERS_COLLECTION,field,original);
  var match=docs.find(function(doc){return String(parseFirestoreValue_((doc.fields||{})[field])||'').trim().toLowerCase()===normalized;});
  if(match){cache.put(key,match.id,21600);return authUserFromDoc_(match);}
  // Only legacy mixed-case identities need a scan. Cache an ID-only index independent of security counters.
  var indexKey='auth_legacy_index_'+PROJECT_ID,raw=cache.get(indexKey),index;
  if(raw)index=JSON.parse(raw);
  else {
    var fetched=fetchAllPagesRaw_(AUTH_USERS_COLLECTION);if(!fetched.ok)throw new Error('ค้นหาบัญชีไม่สำเร็จ');
    index=fetched.docs.map(function(doc){return {id:doc.id,Username:String(parseFirestoreValue_((doc.fields||{}).Username)||'').trim().toLowerCase(),Email:String(parseFirestoreValue_((doc.fields||{}).Email)||'').trim().toLowerCase()};});
    var serialized=JSON.stringify(index);if(Utilities.newBlob(serialized).getBytes().length<80000)cache.put(indexKey,serialized,21600);
  }
  var legacy=index.find(function(item){return item[field]===normalized;});if(!legacy)return null;
  var fresh=readAuthUser_(legacy.id);if(String(fresh[field]||'').trim().toLowerCase()!==normalized)return null;
  cache.put(key,legacy.id,21600);return fresh;
}
function purchaseOrderDto_(document,vendorMap) {
  var f=document.fields||{},vendorId=parseFirestoreValue_(f.Vendor_ID)||'',v=vendorMap&&vendorMap[vendorId]||{};
  return {poId:document.id||document.name.split('/').pop(),vendorId:vendorId,vendorName:v.name||v.Vendor_name||vendorId,
    vendorEmail:v.email||v.Email||'',vendorPhone:v.phone||v.Phone||'',vendorContact:v.contact||v.Contact_name||'',vendorAddress:v.address||v.Address||'',vendorTaxId:v.taxId||v.Tax_ID||'',vendorBranch:v.branch||v.Branch||'',
    orderDate:parseFirestoreValue_(f.Order_Date)||'',status:parseFirestoreValue_(f.Status)||'Pending',note:parseFirestoreValue_(f.Note)||'',
    items:JSON.parse(parseFirestoreValue_(f.Items_JSON)||'[]'),receipts:JSON.parse(parseFirestoreValue_(f.Receipts_JSON)||'[]'),totalQty:Number(parseFirestoreValue_(f.Total_Qty)||0),totalAmount:Number(parseFirestoreValue_(f.Total_Amount)||0)};
}
function getPurchaseOrderById_(id){
 var doc=readExistingDocument_('Purchase_Orders',id),vendorId=parseFirestoreValue_((doc.fields||{}).Vendor_ID),vendors={};
 if(vendorId){var list=readProductReferenceDocs_({Master_Vendors:[vendorId]}).Master_Vendors;if(list.length){var vendor={};Object.keys(list[0].fields||{}).forEach(function(key){vendor[key]=parseFirestoreValue_(list[0].fields[key]);});vendors[vendorId]=vendor;}}
 return purchaseOrderDto_(Object.assign({id:id},doc),vendors);
}



// Bounded pages share one Firestore snapshot; a cursor never means a complete total.
function queryDocumentPage_(collection,dateField,yearFilter,options) {
  options=options||{};var year=yearFilter==='all'?'all':String(parseInt(yearFilter,10)||Number(businessDate_().slice(0,4))+543);
  if(year!=='all' && (!/^\d{4}$/.test(year)||Number(year)<2400||Number(year)>3000))throw new Error('ปีไม่ถูกต้อง');
  var size=Number(options.pageSize||50);if(!Number.isInteger(size)||size<1||size>200)throw new Error('ขนาดหน้าไม่ถูกต้อง');
  var q={from:[{collectionId:collection}],orderBy:[{field:{fieldPath:dateField},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}],limit:size+1},body={structuredQuery:q};
  if(year!=='all'){var y=Number(year)-543;q.where={compositeFilter:{op:'AND',filters:[{fieldFilter:{field:{fieldPath:dateField},op:'GREATER_THAN_OR_EQUAL',value:{stringValue:y+'-01-01'}}},{fieldFilter:{field:{fieldPath:dateField},op:'LESS_THAN_OR_EQUAL',value:{stringValue:y+'-12-31'}}}]}};}
  var prefix='projects/'+PROJECT_ID+'/databases/(default)/documents/'+collection+'/';
  if(options.cursor){try{
    var cursor=JSON.parse(Utilities.newBlob(Utilities.base64Decode(String(options.cursor))).getDataAsString());
    if(cursor.collection!==collection||cursor.year!==year||!/^\d{4}-\d{2}-\d{2}$/.test(cursor.date)||typeof cursor.name!=='string'||cursor.name.indexOf(prefix)!==0||cursor.name.slice(prefix.length).indexOf('/')>=0||!cursor.readTime||isNaN(Date.parse(cursor.readTime))||Date.now()-Date.parse(cursor.readTime)>3300000||Date.parse(cursor.readTime)>Date.now()+60000)throw new Error('invalid');
    body.readTime=cursor.readTime;q.startAt={before:false,values:[{stringValue:cursor.date},{referenceValue:cursor.name}]};
  }catch(e){throw new Error('หน้าข้อมูลหมดอายุหรือไม่ถูกต้อง กรุณารีเฟรชรายการ');}}
  var res=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:runQuery',{method:'post',headers:getAuthHeader_(),payload:JSON.stringify(body),muteHttpExceptions:true});
  if(res.getResponseCode()!==200)throw new Error('โหลดหน้าข้อมูลไม่สำเร็จ กรุณาลองใหม่หรือรีเฟรชรายการ');
  var rows=JSON.parse(res.getContentText()),docs=[],readTime=body.readTime||'';
  rows.forEach(function(row){if(row.document)docs.push(row.document);if(!readTime&&row.readTime)readTime=row.readTime;});
  var more=docs.length>size;docs=docs.slice(0,size);var next='';
  if(more){if(!readTime)throw new Error('ไม่พบเวลายืนยันหน้าข้อมูล');var last=docs[docs.length-1];next=Utilities.base64Encode(JSON.stringify({collection:collection,year:year,date:parseFirestoreValue_(last.fields[dateField]),name:last.name,readTime:readTime}));}
  return {docs:docs,pageInfo:{hasMore:more,nextCursor:next,readTime:readTime,year:year,complete:!more}};
}
function getPendingPurchaseOrderSummary_(readTime){
 var codes={},pendingCount=0,orders={},statuses=['Pending','Ordered','PartiallyReceived'];
 var body={structuredQuery:{from:[{collectionId:'Purchase_Orders'}],where:{fieldFilter:{field:{fieldPath:'Status'},op:'IN',value:{arrayValue:{values:statuses.map(function(s){return {stringValue:s};})}}}},select:{fields:[{fieldPath:'Status'},{fieldPath:'Items_JSON'}]}}};if(readTime)body.readTime=readTime;
 var res=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:runQuery',{method:'post',headers:getAuthHeader_(),payload:JSON.stringify(body),muteHttpExceptions:true});if(res.getResponseCode()!==200)throw new Error('ตรวจใบสั่งซื้อค้างไม่สำเร็จ');
 JSON.parse(res.getContentText()).forEach(function(row){if(!row.document)return;var f=row.document.fields||{},status=parseFirestoreValue_(f.Status),id=row.document.name.split('/').pop();if(status==='Pending')pendingCount++;orders[id]={status:status,codes:[]};var items=JSON.parse(parseFirestoreValue_(f.Items_JSON)||'[]');items.forEach(function(it){if(Number(it.qty)-Number(it.receivedQty||0)>0){codes[it.productCode]=true;orders[id].codes.push(it.productCode);}});});
 return {codes:codes,pendingCount:pendingCount,orders:orders};
}

// One-time legacy counter seeding must include numbers whose document date was edited.
function readDocumentNumberSeeds_(collection,numberField){
 var query={structuredQuery:{from:[{collectionId:collection}],select:{fields:[{fieldPath:numberField}]}}};
 var res=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:runQuery',{method:'post',headers:getAuthHeader_(),payload:JSON.stringify(query),muteHttpExceptions:true});if(res.getResponseCode()!==200)throw new Error('ตรวจเลขเอกสารเดิมไม่สำเร็จ');
 return JSON.parse(res.getContentText()).filter(function(row){return row.document;}).map(function(row){return {id:row.document.name.split('/').pop(),fields:row.document.fields||{}};});
}

function readProductReferenceDocs_(references){
 var result={};Object.keys(references).forEach(function(collection){var ids=references[collection].filter(Boolean),cached=peekCollectionDocsCache_(collection);
   result[collection]=cached!==null?cached.filter(function(doc){return ids.indexOf(doc.id)>=0;}):ids.map(function(id){return Object.assign({id:id},readExistingDocument_(collection,id));});
 });return result;
}
