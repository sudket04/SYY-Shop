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
    loginTemplate.frameChannel = "";
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
  var frameChannel = (e && e.parameter && e.parameter.channel) || "";
  template.frameChannel = /^[A-Za-z0-9-]{16,80}$/.test(String(frameChannel)) ? String(frameChannel) : "";
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
  if (collectionName === "Master_Products") return 300;
  if (collectionName === "Product_Images" || collectionName === "Master_Customers") return 600;
  if (collectionName !== "Master_Users") return Math.min(CACHE_TTL_SECONDS,900);
  return CACHE_TTL_SECONDS;
}
// Execution-local reuse never survives a request or bypasses a generation change.
var executionReadContext_ = null;

function collectionCacheBaseKey_(collectionName) {return 'docs_v4_'+collectionName;}

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
    if(executionReadContext_&&executionReadContext_.refreshScopes.indexOf(collectionName)>=0&&!executionReadContext_.collections[collectionName])return null;
    if(cache.get(base+'__disabled'))return null;
    var memo=executionReadContext_&&executionReadContext_.collections[collectionName];
    if(memo&&memo.generation===generation&&memo.expiresAt>Date.now())return memo.docs;
    var raw=cache.get(base+'__manifest');if(!raw)return null;
    var manifest=JSON.parse(raw);if(manifest.generation!==generation || !manifest.id || manifest.count<1 || manifest.count>=500 || manifest.expiresAt&&manifest.expiresAt<=Date.now())return null;
    var keys=[];for(var i=0;i<manifest.count;i++)keys.push(base+'__'+manifest.id+'__'+i);
    var chunks=cache.getAll(keys),docs=[];
    for(var j=0;j<keys.length;j++){if(!chunks[keys[j]])return null;docs=docs.concat(JSON.parse(chunks[keys[j]]));}
    if(collectionGeneration_(collectionName)!==generation)return null;
    if(executionReadContext_)executionReadContext_.collections[collectionName]={generation:generation,expiresAt:manifest.expiresAt||Date.now()+1000,docs:docs};
    return docs;
  }catch(e){return null;}
}

function writeCollectionCache_(collectionName,docs,expectedGeneration,expiresAt) {
  if(CACHEABLE_COLLECTIONS.indexOf(collectionName)<0)return false;
  try {
    var generation=expectedGeneration===undefined?collectionGeneration_(collectionName):expectedGeneration;
    var chunks=splitCollectionCacheChunks_(docs||[]);if(!chunks || chunks.length>=500 || collectionGeneration_(collectionName)!==generation)return false;
    var cache=CacheService.getScriptCache(),base=collectionCacheBaseKey_(collectionName),id=Utilities.getUuid(),values={},ttl=cacheTtlForCollection_(collectionName);
    expiresAt=expiresAt||Date.now()+ttl*1000;ttl=Math.min(ttl,Math.floor((expiresAt-Date.now())/1000));if(ttl<1)return false;
    if(cache.get(base+'__disabled'))return false;chunks.forEach(function(chunk,i){values[base+'__'+id+'__'+i]=chunk;});
    cache.putAll(values,ttl);
    if(cache.get(base+'__disabled')||collectionGeneration_(collectionName)!==generation)return false;
    cache.put(base+'__manifest',JSON.stringify({generation:generation,id:id,count:chunks.length,expiresAt:expiresAt}),ttl);
    if(executionReadContext_&&collectionGeneration_(collectionName)===generation)executionReadContext_.collections[collectionName]={generation:generation,expiresAt:expiresAt,docs:docs};
    return !cache.get(base+'__disabled')&&collectionGeneration_(collectionName)===generation;
  }catch(e){return false;}
}

function peekCollectionDocsCache_(collectionName) {
  return readCollectionCache_(collectionName);
}

function queryByEqualityField_(collectionName, fieldPath, value, limit, operator) {
  var docs = [];
  try {
    var query = {
      structuredQuery: {
        from  : [{ collectionId: collectionName }],
        where : { fieldFilter: { field: { fieldPath: fieldPath }, op: operator||"EQUAL", value: { stringValue: String(value) } } },
        limit : limit||10
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
                + "/databases/(default)/documents/" + collectionName + "?pageSize=1000"
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
  return withReadLease_('collections:'+collectionNames.slice().sort().join(','),function(){
    var result={};for(var i=0;i<collectionNames.length;i++){var value=readCollectionCache_(collectionNames[i]);if(value===null)return null;result[collectionNames[i]]=value;}return result;
  },function(){return fetchCollectionsParallelUncached_(collectionNames);});
}

function fetchCollectionsParallelUncached_(collectionNames) {
  var result = {}, toFetch = [], requests = [], generations = {};
  collectionNames.forEach(function(name) {
    var cached = readCollectionCache_(name);
    if (cached !== null) { result[name] = cached; return; }
    generations[name]=collectionGeneration_(name);
    toFetch.push(name);
    requests.push({
      url: "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
         + "/databases/(default)/documents/" + name + "?pageSize=1000",
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
  return withReadLease_('collection:'+collectionName,function(){return readCollectionCache_(collectionName);},function(){return fetchCollectionDocsUncached_(collectionName);});
}

function fetchCollectionDocsUncached_(collectionName) {
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
 try{if(collectionName==='Master_Products')PropertiesService.getScriptProperties().setProperty('cache_structure_products',Utilities.getUuid());return withCacheGuard_(function(){return invalidateCollectionCache_(collectionName,true);},function(){return invalidateCollectionCache_(collectionName,false);});}
 catch(e){try{PropertiesService.getScriptProperties().setProperty('cache_gen_'+collectionName,Utilities.getUuid());}catch(ignored){}return false;}
}
function invalidateCollectionCache_(collectionName,canEnable){
 if(CACHEABLE_COLLECTIONS.indexOf(collectionName)<0 && ['Purchase_Orders','Stock_Movements','Quotations','Master_Tax_Invoice'].indexOf(collectionName)<0)return true;
 var cache=CacheService.getScriptCache(),base=collectionCacheBaseKey_(collectionName),disabled=base+'__disabled';
 try{cache.put(disabled,'1',21600);}catch(e){}
 var changed=false;try{PropertiesService.getScriptProperties().setProperty('cache_gen_'+collectionName,Utilities.getUuid());changed=true;}catch(e){console.error('Cache generation unavailable; bypass collection cache',collectionName);}
 try{var raw=cache.get(base+'__manifest'),keys=[base,base+'__manifest'];if(raw){var m=JSON.parse(raw);for(var i=0;i<m.count&&i<500;i++)keys.push(base+'__'+m.id+'__'+i);}cache.removeAll(keys);if(changed&&canEnable)cache.remove(disabled);}catch(e){}
 // Business write already succeeded; never tell the caller to repeat it after a cache failure.
 return changed;
}

// Locks cover cache metadata only. Firestore reads never hold this cache lock.
function withCacheGuard_(worker,fallback){
 if(referenceMutationLocked_)return worker();
 var lock=LockService.getScriptLock();if(!lock.tryLock(250))return fallback();
 try{return worker();}finally{lock.releaseLock();}
}
function readCacheKey_(key){return 'read_v2_'+Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,PROJECT_ID+':'+String(key)));}
function readCacheVersion_(scopes){
 var cache=CacheService.getScriptCache();return scopes.map(function(name){if(cache.get(collectionCacheBaseKey_(name)+'__disabled'))throw new Error('Cache bypass');return collectionGeneration_(name);}).join('|');
}
function readResultCache_(key,scopes,maxAge){
 try{
  var version=readCacheVersion_(scopes),cache=CacheService.getScriptCache(),base=readCacheKey_(key),raw=cache.get(base);
  if(!raw)return null;var m=JSON.parse(raw);if(m.version!==version||m.expiresAt<=Date.now()||Date.now()-m.createdAt>=maxAge||m.count<1||m.count>(key==='product-catalog-v1'?200:60))return null;
  var keys=[];for(var i=0;i<m.count;i++)keys.push(base+'_'+m.id+'_'+i);var parts=cache.getAll(keys),text='';
  for(var j=0;j<keys.length;j++){if(typeof parts[keys[j]]!=='string')return null;text+=parts[keys[j]];}
  if(m.encoding==='gzip')text=Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(text))).getDataAsString();
  else if(m.encoding) return null;
  return readCacheVersion_(scopes)===version?JSON.parse(text):null;
 }catch(e){return null;}
}
function writeResultCache_(key,scopes,value,maxAge,version,createdAt){
 try{
  if(readCacheVersion_(scopes)!==version)return;
  var text=JSON.stringify(value),encoding='',limit=key==='product-catalog-v1'?200:60;
  if(text.length>16000*limit){text=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(text)).getBytes());encoding='gzip';}
  var count=Math.ceil(text.length/16000);if(count>limit)return;
  var cache=CacheService.getScriptCache(),base=readCacheKey_(key),id=Utilities.getUuid(),parts={},expiresAt=createdAt+maxAge;
  var sourceKeys=scopes.filter(function(s){return CACHEABLE_COLLECTIONS.indexOf(s)>=0;}).map(function(s){return collectionCacheBaseKey_(s)+'__manifest';}),sources=cache.getAll(sourceKeys);
  sourceKeys.forEach(function(k){if(sources[k]){var source=JSON.parse(sources[k]);if(Number.isFinite(source.expiresAt))expiresAt=Math.min(expiresAt,source.expiresAt);}});
  var ttl=Math.floor((expiresAt-Date.now())/1000);if(ttl<1)return;
  for(var i=0;i<count;i++)parts[base+'_'+id+'_'+i]=text.slice(i*16000,(i+1)*16000);
  cache.putAll(parts,ttl);if(readCacheVersion_(scopes)!==version)return;
  cache.put(base,JSON.stringify({version:version,id:id,count:count,encoding:encoding,createdAt:createdAt,expiresAt:expiresAt}),ttl);
 }catch(e){} // An unavailable/evicted cache must not fail a successful read.
}
function withReadLease_(key,read,worker){
 var cached=read();if(cached!==null)return cached;
 var leaseKey=readCacheKey_('lease:'+key),owner=Utilities.getUuid(),claimed=false;
 function claim(){return withCacheGuard_(function(){var cache=CacheService.getScriptCache(),raw=cache.get(leaseKey),lease=raw?JSON.parse(raw):null;if(lease&&lease.until>Date.now())return false;cache.put(leaseKey,JSON.stringify({owner:owner,until:Date.now()+30000}),30);return true;},function(){return false;});}
 try{
  // Wait for a live producer instead of starting another full scan after 900 ms.
  // Bounded waiting releases the execution with a retryable error, never partial data.
  for(var attempt=0;attempt<8;attempt++){
   try{claimed=claim();}catch(e){return worker();} // Cache outage: preserve availability.
   cached=read();if(cached!==null)return cached;
   if(claimed)return worker();
   Utilities.sleep(250);
  }
  throw new Error('กำลังเตรียมข้อมูลสินค้า กรุณารอสักครู่แล้วลองใหม่');
 }finally{
  if(claimed)try{withCacheGuard_(function(){var cache=CacheService.getScriptCache(),raw=cache.get(leaseKey);if(raw&&JSON.parse(raw).owner===owner)cache.remove(leaseKey);},function(){});}catch(e){}
 }
}
function cachedReadResult_(key,scopes,maxAge,worker,force){
 function fresh(){var version=null,started=Date.now();try{version=readCacheVersion_(scopes);}catch(e){}var value=worker();if(version!==null)writeResultCache_(key,scopes,value,maxAge,version,started);return value;}
 if(force||executionReadContext_&&scopes.some(function(s){return executionReadContext_.refreshScopes.indexOf(s)>=0;}))return fresh();
 return withReadLease_('result:'+key,function(){return readResultCache_(key,scopes,maxAge);},fresh);
}

// Patch only after a confirmed commit. Read authoritative raw documents; preserve
// unknown fields and the original cache expiry. Concurrent invalidation wins.
function refreshChangedProductsCache_(codes){
 var captured=null,collection='Master_Products';
 try{
  withCacheGuard_(function(){
   var docs=readCollectionCache_(collection),raw=CacheService.getScriptCache().get(collectionCacheBaseKey_(collection)+'__manifest'),manifest=raw?JSON.parse(raw):null;
   if(invalidateCollectionCache_(collection,true)&&docs!==null&&manifest&&manifest.expiresAt>Date.now())captured={docs:docs,expiresAt:manifest.expiresAt,generation:collectionGeneration_(collection)};
  },function(){invalidateCollectionCache_(collection,false);});
  if(!captured)return;
  var unique=Object.keys((codes||[]).reduce(function(out,code){if(validDocumentId_(String(code)))out[code]=true;return out;},Object.create(null))),fresh=Object.create(null);
  if(!unique.length)return;
  for(var i=0;i<unique.length;i+=100){
   var res=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:batchGet',{method:'post',headers:getAuthHeader_(),muteHttpExceptions:true,payload:JSON.stringify({documents:unique.slice(i,i+100).map(function(id){return fsDocPath_(collection,id);})})});
   if(res.getResponseCode()!==200)return;
   JSON.parse(res.getContentText()).forEach(function(row){if(row.found){var d=row.found;fresh[d.name.split('/').pop()]={id:d.name.split('/').pop(),fields:d.fields||{},updateTime:d.updateTime||''};}else if(row.missing)fresh[row.missing.split('/').pop()]=null;});
  }
  if(unique.some(function(id){return !Object.prototype.hasOwnProperty.call(fresh,id);}))return;
  var existing=Object.create(null);var docs=captured.docs.map(function(d){existing[d.id]=true;return Object.prototype.hasOwnProperty.call(fresh,d.id)?fresh[d.id]:d;}).filter(Boolean);unique.forEach(function(id){if(!existing[id]&&fresh[id])docs.push(fresh[id]);});
  writeCollectionCache_(collection,docs,captured.generation,captured.expiresAt);
 }catch(e){clearCollectionCache_(collection);}
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
  if (f.timestampValue !== undefined) return f.timestampValue;
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
  var attempted=false;
  try {
    var document=readExistingDocument_(collectionName,docId);assertDeleteAllowed_(collectionName,docId,document);
    var url='https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents/'+collectionName+'/'+encodeURIComponent(docId)+'?currentDocument.updateTime='+encodeURIComponent(document.updateTime);
    attempted=true;
    var res=UrlFetchApp.fetch(url,{method:'delete',headers:getAuthHeader_(),muteHttpExceptions:true});
    if(res.getResponseCode()>=500)clearCollectionCache_(collectionName);
    if(res.getResponseCode()!==200)return {success:false,message:'ลบไม่สำเร็จหรือข้อมูลเปลี่ยนแปลงแล้ว กรุณารีเฟรชก่อนลองใหม่'};
    clearCollectionCache_(collectionName);return {success:true,title:'สำเร็จ',message:'ลบข้อมูลเรียบร้อย'};
  }catch(e){if(attempted)clearCollectionCache_(collectionName);return {success:false,title:'ลบไม่ได้',message:e.message};}
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
        if (code >= 500) clearCollectionCache_(collectionName);
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
    if (res.getResponseCode() >= 500) clearCollectionCache_(collectionName);
    if (editOptions && /FAILED_PRECONDITION|NOT_FOUND/.test(res.getContentText())) {
      return { success: false, title: "ข้อมูลเปลี่ยนแปลง", message: "ข้อมูลถูกแก้ไขหรือลบโดยผู้ใช้อื่น กรุณารีเฟรชและตรวจสอบก่อนบันทึกอีกครั้ง" };
    }
    return { success: false, title: "ล้มเหลว", message: res.getContentText() };
  } catch (e) {
    clearCollectionCache_(collectionName);
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
  if(options&&options.includeImages!=null&&typeof options.includeImages!=='boolean')throw Error('ตัวเลือกรูปสินค้าไม่ถูกต้อง');
  if(options && options.paged) {
    var page=getProductCatalogPage_(options);
    if(options.includeMasters)page.masters=getAllMasterDropdowns_();
    return page;
  }
  if(options && options.compact)return packProductCatalog_(getProductCatalogRows_());
  var products = [];
  try {
    var masters = fetchCollectionsParallel_(
      ["Master_Brands", "Master_Categories", "Master_Vendors", "Master_Zones", "Master_Cars"]
    );
    var imageMap = options && (options.omitImages||options.includeImages===false) ? {} : getProductImageUrlMap_();
    var productDocs = fetchCollectionDocsCached_("Master_Products");
    products=mapProductPageDocs_(productDocs,masters,imageMap);
    if(options&&options.includeImages===false)products.forEach(function(row){row.imageDataLoaded=false;});
  } catch (e) { console.error("getAllProducts_ read failed", e); throw e; }
  return options && options.includeMasters ? {products:products,masters:getAllMasterDropdowns_(masters)} : products;
}

// ==========================================
// 11. ★ getProductById
// ==========================================
// The searchable catalog intentionally retains all rows: Thai substring search,
// cross-column filters and stock/minimum comparisons cannot be replaced by a
// first-page Firestore query without changing existing results. Images are lazy.
var PRODUCT_CATALOG_SCOPES = ['Master_Products','Master_Brands','Master_Categories','Master_Vendors','Master_Zones','Master_Cars'];
var PRODUCT_CATALOG_FIELDS = ['productCode','productName','partType','partNumber','barcode','barcodeGenerated','brandId','brandName','categoryId','categoryName','vendorId','vendorName','zoneId','zoneName','carIds','carModel','costPrice','sellingPrice','currentStock','minStock','status'];
var PRODUCT_FILTER_FIELDS = ['productCode','productName','partType','partNumber','brandName','categoryName','vendorName','zoneName','costPrice','sellingPrice','currentStock','status'];
function packProductCatalog_(rows){
  return {catalogFormat:1,fields:PRODUCT_CATALOG_FIELDS,rows:rows.map(function(row){return PRODUCT_CATALOG_FIELDS.map(function(key){return row[key];});})};
}
function unpackProductCatalog_(data){
  return data.rows.map(function(values){var row={imageUrl:'',imageUrls:[],primaryImageIndex:0,imageUpdateTime:''};data.fields.forEach(function(key,i){row[key]=values[i];});row.id=row.productCode;return row;});
}
function getProductCatalogRows_(){
  var version=null,memo=executionReadContext_&&executionReadContext_.catalog;try{version=readCacheVersion_(PRODUCT_CATALOG_SCOPES);}catch(ignored){}
  if(version!==null&&memo&&memo.version===version)return memo.rows;
  var data=cachedReadResult_('product-catalog-v1',PRODUCT_CATALOG_SCOPES,120000,function(){var packed=packProductCatalog_(getAllProducts_({omitImages:true}));packed.snapshot=readCacheKey_(JSON.stringify(packed.rows));return packed;});
  var rows=unpackProductCatalog_(data);rows.catalogSnapshot=data.snapshot;if(executionReadContext_&&version!==null)executionReadContext_.catalog={version:version,rows:rows};return rows;
}
function productCatalogSpec_(options){
  options=options||{};
  var search=options.search==null?'':options.search,filters=options.filters||{},sort=options.sortCol||'';
  if(typeof search!=='string'||search.length>200||!filters||typeof filters!=='object'||Array.isArray(filters)||sort&&PRODUCT_FILTER_FIELDS.indexOf(sort)<0)throw new Error('ตัวกรองสินค้าไม่ถูกต้อง');
  var normalized=Object.create(null);
  Object.keys(filters).sort().forEach(function(key){
    var values=filters[key];
    if(PRODUCT_FILTER_FIELDS.indexOf(key)<0||!Array.isArray(values)||values.length>20000||values.some(function(v){return typeof v!=='string'||v.length>2000;}))throw new Error('ตัวกรองสินค้าไม่ถูกต้อง');
    if(values.length)normalized[key]=Array.from(new Set(values)).sort();
  });
  if(options.includeImages!=null&&typeof options.includeImages!=='boolean')throw new Error('ตัวเลือกรูปสินค้าไม่ถูกต้อง');
  return {search:search.trim().toLowerCase(),filters:normalized,sortCol:sort,sortAsc:options.sortAsc!==false,includeImages:options.includeImages!==false};
}
function filterProductCatalog_(rows,spec,except){
  var sets=Object.create(null);Object.keys(spec.filters).forEach(function(k){if(k!==except)sets[k]=new Set(spec.filters[k]);});
  var searchable=['productName','productCode','partNumber','barcode','brandName','categoryName','carModel'];
  var result=rows.filter(function(row){
    if(spec.search&&!searchable.some(function(key){return String(row[key]||'').toLowerCase().indexOf(spec.search)>=0;}))return false;
    return Object.keys(sets).every(function(key){var v=row[key];return sets[key].has(v==null||v===''?'(ว่าง)':String(v));});
  });
  if(spec.sortCol){
    var numeric=['costPrice','sellingPrice','currentStock'].indexOf(spec.sortCol)>=0;
    result.sort(function(a,b){var av=a[spec.sortCol],bv=b[spec.sortCol];av=numeric?Number(av)||0:String(av==null?'':av).toLowerCase();bv=numeric?Number(bv)||0:String(bv==null?'':bv).toLowerCase();return (av<bv?-1:av>bv?1:0)*(spec.sortAsc?1:-1);});
  }
  return result;
}
function productCatalogCursor_(value){var encoded=Utilities.base64Encode(JSON.stringify(value));return encoded+'.'+movementCursorSignature_('catalog-v1:'+encoded);}
function productListScopes_(spec){return PRODUCT_CATALOG_SCOPES.concat(spec.includeImages?[PRODUCT_IMAGES_COLLECTION]:[]);}
function getProductCatalogPage_(options){
  options=options||{};var spec=productCatalogSpec_(options),size=options.pageSize==null?50:Number(options.pageSize),page=options.page==null?1:Number(options.page);
  if(!Number.isInteger(size)||size<1||size>200||!Number.isInteger(page)||page<1||page>100000)throw new Error('ขนาดหน้าสินค้าไม่ถูกต้อง');
  // Opt-in wire format for new clients. Complex substring/XLFilter queries keep
  // their complete-dataset semantics; ordinary browsing never scans the catalog.
  if(options.cursorMode===true&&!spec.search&&!Object.keys(spec.filters).length&&(!spec.sortCol||spec.sortCol==='productCode'))return getProductBrowsePage_(options,spec,size,page);
  var version=productListScopes_(spec).map(collectionGeneration_).join('|'),offset=(page-1)*size,query=readCacheKey_(JSON.stringify(spec)),issuedAt=Date.now();
  if(options.cursor){try{
    if(typeof options.cursor!=='string'||options.cursor.length>4096)throw Error('invalid');
    var parts=options.cursor.split('.');if(parts.length!==2||movementCursorSignature_('catalog-v1:'+parts[0])!==parts[1])throw Error('invalid');
    var cursor=JSON.parse(Utilities.newBlob(Utilities.base64Decode(parts[0])).getDataAsString());
    if(cursor.query!==query||cursor.version!==version||!Number.isInteger(cursor.offset)||cursor.offset<1||!Number.isFinite(cursor.at)||Date.now()-cursor.at>300000||cursor.at>Date.now()+60000)throw Error('invalid');
    offset=cursor.offset;issuedAt=cursor.at;
  }catch(e){throw new Error('รายการสินค้าเปลี่ยนแปลงหรือหมดอายุ กรุณาโหลดใหม่ก่อน Export');}}
  var all=getProductCatalogRows_();
  var codes=cachedReadResult_('product-order:'+query+':'+all.catalogSnapshot,PRODUCT_CATALOG_SCOPES,60000,function(){return filterProductCatalog_(all,spec).map(function(row){return row.productCode;});});
  var total=codes.length,byCode=Object.create(null);all.forEach(function(row){byCode[row.productCode]=row;});
  if(options.cursor&&cursor.snapshot!==all.catalogSnapshot)throw new Error('รายการสินค้าเปลี่ยนแปลง กรุณาเริ่ม Export ใหม่');
  if(options.cursor&&offset>=total)throw new Error('รายการสินค้าเปลี่ยนแปลง กรุณาโหลดใหม่');
  if(!options.cursor)offset=Math.min(offset,Math.max(0,(Math.ceil(total/size)-1)*size));
  var selected=codes.slice(offset,offset+size).map(function(code){return Object.assign({},byCode[code]);}),images=spec.includeImages?getProductImageBatch_(codes.slice(offset,offset+size)):{};
  selected.forEach(function(row){Object.assign(row,images[row.productCode]);row.imageDataLoaded=spec.includeImages;});
  if(productListScopes_(spec).map(collectionGeneration_).join('|')!==version)throw new Error('รายการสินค้าเปลี่ยนแปลง กรุณาโหลดใหม่');
  var more=offset+selected.length<total;
  var response={products:selected,catalogPage:true,total:total,unfilteredTotal:all.length,page:Math.floor(offset/size)+1,pageSize:size,nextCursor:more?productCatalogCursor_({query:query,version:version,snapshot:all.catalogSnapshot,offset:offset+selected.length,at:issuedAt}):'',hasMore:more};
  // Seed only small, unfiltered facets from the catalog already in memory.
  // No extra RPC/Firestore reads and no eager 10,000-name/code payload.
  if(options.includeMasters&&!Object.keys(spec.filters).length)try{
    var columns=['partType','brandName','categoryName','zoneName','status'],sets={};columns.forEach(function(c){sets[c]=new Set();});
    all.forEach(function(row){columns.forEach(function(c){if(sets[c].size<=300){var v=row[c];sets[c].add(v==null||v===''?'(ว่าง)':String(v));}});});
    response.facets={};columns.forEach(function(c){if(sets[c].size<=300)response.facets[c]={values:Array.from(sets[c]),numeric:false};});response.facetVersion=readCacheVersion_(PRODUCT_CATALOG_SCOPES);
  }catch(ignored){delete response.facets;}
  return response;
}
// Validate signed continuation independently of running a query. Conditional
// manual reads must apply the same owner/spec/age checks as ordinary browsing.
function productBrowseContext_(options,spec,size,page){
  if(!Number.isInteger(size)||size<1||size>200||!Number.isInteger(page)||page<1||page>100000)throw new Error('ขนาดหน้าสินค้าไม่ถูกต้อง');
  var version=productListScopes_(spec).map(collectionGeneration_).join('|'),scope=validatedGatewaySession_&&validatedGatewaySession_.session;
  var owner=scope?scope.username+':'+scope.role:'internal',query=readCacheKey_(JSON.stringify([spec,size,owner])),cursor=null;
  if(options.cursor){try{
    if(typeof options.cursor!=='string'||options.cursor.length>4096)throw Error('cursor');
    var parts=options.cursor.split('.');if(parts.length!==2||movementCursorSignature_('catalog-v1:'+parts[0])!==parts[1])throw Error('signature');
    cursor=JSON.parse(Utilities.newBlob(Utilities.base64Decode(parts[0])).getDataAsString());
    if(cursor.mode!=='browse-v1'||cursor.query!==query||cursor.page!==page||!validDocumentId_(cursor.last)||!Number.isFinite(cursor.at)||Date.now()-cursor.at>=86400000||cursor.at>Date.now()+60000||!validIsoTimestamp_(cursor.readTime))throw Error('stale');
  }catch(e){productBrowseRestart_();}}
  else if(page!==1)throw new Error('กรุณาเปิดหน้าก่อนหน้าก่อนเปลี่ยนหน้า');
  return {version:version,query:query,cursor:cursor};
}
function getProductBrowsePage_(options,spec,size,page){
  var context=productBrowseContext_(options,spec,size,page),version=context.version,query=context.query,cursor=context.cursor;
  // Keep the signed document anchor when stock changes or the short snapshot
  // expires. Resume with a new bounded snapshot instead of forcing page one.
  var rebased=!!(cursor&&(options.refreshSnapshot===true||cursor.version!==version||Date.now()-cursor.at>=120000));
  var snapshotTime=cursor&&!rebased?cursor.readTime:'';
  // Shared rows contain no caller-specific data. Sign continuation per caller
  // after cache reuse, so five authorized users share the same initial query.
  var key='product-browse-v1:'+readCacheKey_(JSON.stringify([spec,size,cursor&&cursor.last,snapshotTime]));
  var response=cachedReadResult_(key,productListScopes_(spec),30000,function(){
    var fields=['Product_Name','Part_Type','Part_Number','Barcode','Barcode_Generated','Brand_ID','Category_ID','Default_Vendor_ID','Zone_ID','Car_IDs','Car_ID','Cost_Price','Selling_Price','Current_Stock','Min_Stock','Status'];
    var q={from:[{collectionId:'Master_Products'}],select:{fields:fields.map(function(f){return {fieldPath:f};})},orderBy:[{field:{fieldPath:'__name__'},direction:spec.sortAsc?'ASCENDING':'DESCENDING'}],limit:size+1};
    if(cursor)q.startAt={values:[{referenceValue:fsDocPath_('Master_Products',cursor.last)}],before:false};
    var body={structuredQuery:q};if(snapshotTime)body.readTime=snapshotTime;
    var res=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:runQuery',{method:'post',headers:getAuthHeader_(),payload:JSON.stringify(body),muteHttpExceptions:true});
    if(res.getResponseCode()!==200)throw new Error('โหลดหน้าสินค้าไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่');
    var entries=JSON.parse(res.getContentText()),readTime=snapshotTime,docs=[];
    entries.forEach(function(entry){if(!readTime&&entry.readTime)readTime=entry.readTime;if(entry.document){var d=entry.document;docs.push({id:d.name.split('/').pop(),fields:d.fields||{},updateTime:d.updateTime||''});}});
    if(!validIsoTimestamp_(readTime))throw new Error('ไม่พบ snapshot ของหน้าสินค้า กรุณาลองใหม่');
    var more=docs.length>size;docs=docs.slice(0,size);
    var refs={Master_Brands:[],Master_Categories:[],Master_Vendors:[],Master_Zones:[],Master_Cars:[]};
    docs.forEach(function(d){var f=d.fields;[['Master_Brands','Brand_ID'],['Master_Categories','Category_ID'],['Master_Vendors','Default_Vendor_ID'],['Master_Zones','Zone_ID']].forEach(function(pair){var id=parseFirestoreValue_(f[pair[1]]);if(id&&id!=='PENDING')refs[pair[0]].push(id);});var cars=parseFirestoreValue_(f.Car_IDs);if(!cars||!cars.length)cars=[parseFirestoreValue_(f.Car_ID)];if(!Array.isArray(cars))cars=[cars];refs.Master_Cars=refs.Master_Cars.concat(cars.filter(Boolean));});
    var masters=readProductReferenceDocs_(refs,true),rows=mapProductPageDocs_(docs,masters),images=spec.includeImages?getProductImageBatch_(docs.map(function(d){return d.id;})):{};
    rows.forEach(function(row){Object.assign(row,images[row.id]);row.imageDataLoaded=spec.includeImages;});
    if(productListScopes_(spec).map(collectionGeneration_).join('|')!==version)productBrowseRestart_();
    return {catalogPage:true,cursorMode:true,products:rows,page:page,pageSize:size,total:null,unfilteredTotal:null,readTime:readTime,hasMore:more,createdAt:Date.now(),last:docs.length?docs[docs.length-1].id:''};
  });
  response=Object.assign({},response);response.page=page;
  response.snapshotRebased=rebased;
  var snapshotAt=cursor&&!rebased?cursor.at:response.createdAt;
  response.cacheExpiresAt=Math.min(response.createdAt+30000,snapshotAt+120000);
  response.nextCursor=response.hasMore?productCatalogCursor_({mode:'browse-v1',query:query,version:version,page:page+1,last:response.last,readTime:response.readTime,at:snapshotAt}):'';
  delete response.createdAt;delete response.last;return response;
}
function productBrowseRestart_(){var error=new Error('ข้อมูลเปลี่ยนแปลงระหว่างโหลดหรือตัวแบ่งหน้าไม่ถูกต้อง กรุณาลองอีกครั้ง');error.restartPage=true;throw error;}
function validIsoTimestamp_(value){return typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)&&Number.isFinite(Date.parse(value));}
function mapProductPageDocs_(docs,masters,imageMap){
  var brands=buildMapFromDocs_(masters.Master_Brands,'Brand_Name'),categories=buildMapFromDocs_(masters.Master_Categories,'Category_Name'),vendors=buildMapFromDocs_(masters.Master_Vendors,'Vendor_name'),zones=buildZoneMapFromDocs_(masters.Master_Zones),cars=buildCarMapFromDocs_(masters.Master_Cars);
  return docs.map(function(doc){var f=doc.fields,brand=parseFirestoreValue_(f.Brand_ID)||'',category=parseFirestoreValue_(f.Category_ID)||'',vendor=parseFirestoreValue_(f.Default_Vendor_ID)||'',zone=parseFirestoreValue_(f.Zone_ID)||'',carIds=parseFirestoreValue_(f.Car_IDs);if(!carIds||!carIds.length)carIds=[parseFirestoreValue_(f.Car_ID)].filter(Boolean);if(!Array.isArray(carIds))carIds=[carIds];
    var row={id:doc.id,productCode:doc.id,productName:parseFirestoreValue_(f.Product_Name)||'',partType:parseFirestoreValue_(f.Part_Type)||'',partNumber:String(parseFirestoreValue_(f.Part_Number)||''),barcode:String(parseFirestoreValue_(f.Barcode)||''),barcodeGenerated:parseFirestoreValue_(f.Barcode_Generated)==='true',brandId:brand,brandName:brands[brand]||brand,categoryId:category,categoryName:categories[category]||category,vendorId:vendor,vendorName:vendors[vendor]||vendor,zoneId:zone,zoneName:zone==='PENDING'?'รอดำเนินการ':zones[zone]||zone,carIds:carIds,carModel:carIds.map(function(id){return cars[id]||id;}).filter(Boolean).join(', '),costPrice:parseFloat(parseFirestoreValue_(f.Cost_Price))||0,sellingPrice:parseFloat(parseFirestoreValue_(f.Selling_Price))||0,currentStock:parseFloat(parseFirestoreValue_(f.Current_Stock))||0,minStock:parseFloat(parseFirestoreValue_(f.Min_Stock))||0,status:parseFirestoreValue_(f.Status)||'Active'};
    var image=imageMap&&imageMap[doc.id]||{};if(typeof image==='string')image={primary:image,urls:image?[image]:[],primaryIndex:0};
    var urls=Array.isArray(image.urls)?image.urls.slice(0,3):[],primary=parseInt(image.primaryIndex,10)||0;
    return Object.assign(row,{imageUrl:image.primary||urls[primary]||urls[0]||'',imageUrls:urls,primaryImageIndex:primary,imageUpdateTime:image.updateTime||''});
  });
}
function getProductCatalogFacets_(options,column){
  if(PRODUCT_FILTER_FIELDS.indexOf(column)<0)throw new Error('คอลัมน์สินค้าไม่ถูกต้อง');
  // Match the existing Excel popover: other column filters apply; free text does not.
  var spec=productCatalogSpec_(options);spec.search='';spec.sortCol='';
  delete spec.filters[column];
  return cachedReadResult_('product-facets:'+column+':'+JSON.stringify(spec.filters),PRODUCT_CATALOG_SCOPES,120000,function(){
    var values=new Set();filterProductCatalog_(getProductCatalogRows_(),spec,column).forEach(function(row){var v=row[column];values.add(v==null||v===''?'(ว่าง)':String(v));});
    return {values:Array.from(values),numeric:['costPrice','sellingPrice','currentStock'].indexOf(column)>=0};
  });
}
function getProductImageBatch_(codes){
  if(!Array.isArray(codes)||codes.length>200||codes.some(function(id){return typeof id!=='string'||!validDocumentId_(id);}))throw new Error('รหัสสินค้าไม่ถูกต้อง');
  codes=Array.from(new Set(codes)).sort();if(!codes.length)return {};
  return cachedReadResult_('product-images:'+JSON.stringify(codes),[PRODUCT_IMAGES_COLLECTION],120000,function(){
    var response=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:batchGet',{method:'post',headers:getAuthHeader_(),muteHttpExceptions:true,payload:JSON.stringify({documents:codes.map(function(id){return fsDocPath_(PRODUCT_IMAGES_COLLECTION,id);})})});
    if(response.getResponseCode()!==200)throw new Error('โหลดข้อมูลรูปสินค้าไม่สำเร็จ กรุณาลองใหม่');
    var map=Object.create(null);
    JSON.parse(response.getContentText()).forEach(function(entry){
      var doc=entry.found,id=String(doc?doc.name:entry.missing||'').split('/').pop();if(codes.indexOf(id)<0)return;
      var image=imageDataFromFields_(doc?doc.fields:{});
      map[id]={imageUrl:image.primaryUrl,imageUrls:image.urls,primaryImageIndex:image.primaryIndex,imageUpdateTime:doc&&doc.updateTime||''};
    });
    if(codes.some(function(id){return !Object.prototype.hasOwnProperty.call(map,id);}))throw new Error('โหลดข้อมูลรูปสินค้าไม่ครบ กรุณาลองใหม่');
    return map;
  });
}

function getProductById_(productCode) {
  if(typeof productCode!=='string'||!validDocumentId_(productCode))throw new Error('รหัสสินค้าไม่ถูกต้อง');
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Master_Products/" + encodeURIComponent(productCode);
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
    var duplicateFields=[['Product_Name','ชื่อสินค้า'],['Part_Number','Part Number'],['Barcode','บาร์โค้ด']],duplicateReadMemo={};
    for(var i=0;i<duplicateFields.length;i++){
      var key=duplicateFields[i][0];
      if(dataObject[key] && hasNormalizedDuplicate_('Master_Products',key,dataObject[key],docId,duplicateReadMemo))
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

function updateTaxInvoiceYearsMeta_(yearBE) { appendYearMeta_(TAX_INVOICE_YEARS_ID,yearBE);clearCollectionCache_('Master_Tax_Invoice'); }

function getTaxInvoiceAvailableYears_() {return cachedReadResult_('document-years:invoice',['Master_Tax_Invoice'],120000,getTaxInvoiceAvailableYearsUncached_);}
function getTaxInvoiceAvailableYearsUncached_() {
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

function getTaxInvoiceListData_(yearFilter,options){var page=queryDocumentPage_('Master_Tax_Invoice','Invoice_Date',yearFilter,options);return {invoices:page.docs.map(function(doc){return mapTaxInvoiceQueryDoc_(doc);}),pageInfo:page.pageInfo,availableYears:options&&(options.cursor||(options.search&&(options.search.number||options.search.from||options.search.to)))?undefined:getTaxInvoiceAvailableYears_()};}

function getTaxInvoicePageData_(yearFilter,options){options=options||{};validateDocumentSections_(options);var result=options.editorOnly?{}:getTaxInvoiceListData_(yearFilter,options);if(!options.deferSections)documentPageSections_(result,options);result.seller=TAX_INVOICE_SELLER;return result;}
function validateDocumentSections_(options){['editorOnly','deferSections'].forEach(function(k){if(options[k]!=null&&typeof options[k]!=='boolean')throw Error('ตัวเลือกโหลดเอกสารไม่ถูกต้อง');});if(options.editorOnly&&options.deferSections)throw Error('ตัวเลือกโหลดเอกสารขัดแย้งกัน');}

// Reuse only sections actually held by this caller, with a hard age that validation cannot extend.
function clientSectionReusable_(prior,version,scopes,age){
  return version!==null&&prior&&prior.version===version&&Number.isFinite(prior.loadedAt)&&prior.loadedAt<=Date.now()&&Date.now()-prior.loadedAt<age&&clientReadExpiry_(scopes,age)>Date.now()&&!(executionReadContext_&&executionReadContext_.refreshScopes.some(function(s){return scopes.indexOf(s)>=0;}));
}
function documentPageSections_(result,options){
  options=options||{};var known=options.sectionVersions||{},versions={};
  if(typeof known!=='object'||Array.isArray(known))throw new Error('เวอร์ชันข้อมูลหน้าเอกสารไม่ถูกต้อง');
  [{key:'products',source:'Master_Products',scopes:PRODUCT_CATALOG_SCOPES,age:300000,load:function(){return options.compactCatalog?packProductCatalog_(getProductCatalogRows_()):getAllProducts_();}},
   {key:'customers',source:'Master_Customers',scopes:['Master_Customers'],age:600000,load:getCustomersFull_}].forEach(function(section){
    var version=null;try{version=readCacheVersion_(section.scopes);}catch(ignored){}
    var prior=known[section.key],canReuse=options.compactCatalog&&clientSectionReusable_(prior,version,section.scopes,section.age);
    if(canReuse){versions[section.key]=prior;return;}
    result[section.key]=section.load();
    if(version!==null){if(readCacheVersion_(section.scopes)!==version)throw new Error('ข้อมูลเปลี่ยนระหว่างโหลด กรุณาลองใหม่');
      try{var source=JSON.parse(CacheService.getScriptCache().get(collectionCacheBaseKey_(section.source)+'__manifest')||'null');if(source&&Number.isFinite(source.expiresAt))versions[section.key]={version:version,loadedAt:Math.min(Date.now(),source.expiresAt-cacheTtlForCollection_(section.source)*1000)};}catch(ignored){}
    }
  });
  result.sectionVersions=versions;
}

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
    stockIssueBillNo: parseFirestoreValue_(f.Stock_Issue_Bill_No) || "",
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
function updateQuotationYearsMeta_(yearBE) { appendYearMeta_(QUOTATION_YEARS_ID,yearBE,discoverQuotationYears_);clearCollectionCache_('Quotations'); }

function getQuotationAvailableYears_() {return cachedReadResult_('document-years:quotation',['Quotations'],120000,getQuotationAvailableYearsUncached_);}
function getQuotationAvailableYearsUncached_() {
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
      return discoverQuotationYears_();
    } else if (res.getResponseCode() === 404) {
      // Browsing is read-only, including a legacy database without year metadata.
      // The explicit save path seeds metadata; ordinary reads reuse this cached discovery.
      return discoverQuotationYears_();
    }
  } catch (e) {
    throw e;
  }
  return [new Date().getFullYear() + 543];
}

function discoverQuotationYears_() {
  var seen=Object.create(null),before='',readTime='';
  function query(all){
    var q={from:[{collectionId:QUOTATION_COLLECTION}],select:{fields:[{fieldPath:'Quote_Date'}]}},body={structuredQuery:q};
    if(!all){q.orderBy=[{field:{fieldPath:'Quote_Date'},direction:'DESCENDING'}];q.limit=1;if(before)q.where={fieldFilter:{field:{fieldPath:'Quote_Date'},op:'LESS_THAN',value:{stringValue:before}}};}
    if(readTime)body.readTime=readTime;
    var response=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:runQuery',{method:'post',headers:getAuthHeader_(),payload:JSON.stringify(body),muteHttpExceptions:true});
    if(response.getResponseCode()!==200)throw new Error('อ่านปีใบเสนอราคาไม่ครบ กรุณาลองใหม่');
    var rows=JSON.parse(response.getContentText());if(!Array.isArray(rows))throw new Error('ข้อมูลปีใบเสนอราคาไม่ถูกต้อง');
    rows.forEach(function(row){if(!readTime&&row.readTime)readTime=row.readTime;});var docs=rows.filter(function(row){return row.document;}).map(function(row){return row.document;});
    if(docs.length&&!isFinite(Date.parse(readTime)))throw new Error('ไม่พบเวลายืนยันปีใบเสนอราคา');return docs;
  }
  function add(date){if(!validDateOnly_(date))return;var year=Number(date.slice(0,4))+543;if(year<2400||year>3000)throw new Error('ปีใบเสนอราคาไม่ถูกต้อง');seen[year]=true;}
  // Skip directly to the preceding year: one returned document per distinct year.
  // Malformed legacy dates retain the old skip behavior via a date-only projection.
  for(var i=0;i<602;i++){
    var docs=query(false);if(!docs.length)break;var date=parseFirestoreValue_((docs[0].fields||{}).Quote_Date);
    if(!validDateOnly_(date)){query(true).forEach(function(doc){add(parseFirestoreValue_((doc.fields||{}).Quote_Date));});break;}
    add(date);var next=date.slice(0,4)+'-01-01';if(before&&next>=before)throw new Error('ปีใบเสนอราคาวนซ้ำ');before=next;
  }
  var years=Object.keys(seen).map(Number).sort(function(a,b){return b-a;});return years.length?years:[Number(businessDate_().slice(0,4))+543];
}

// ★ FIX (โควตา Firestore Reads): รับ yearFilter เพิ่ม — ค่าเริ่มต้น (ไม่ส่ง/undefined) ใช้ปีปัจจุบัน
//   แทนการดึงใบเสนอราคาทั้งหมดทุกปีเหมือนเดิม (getQuotationList เต็มยังเรียกได้ถ้าส่ง "all" มาชัดเจน)
function getQuotationListData_(yearFilter,options){var page=queryDocumentPage_('Quotations','Quote_Date',yearFilter,options);return {quotations:page.docs.map(function(doc){return mapQuotationDoc_({id:doc.name.split('/').pop(),fields:doc.fields||{}});}),pageInfo:page.pageInfo,availableYears:options&&(options.cursor||(options.search&&(options.search.number||options.search.from||options.search.to)))?undefined:getQuotationAvailableYears_()};}

function getQuotationPageData_(yearFilter,options){options=options||{};validateDocumentSections_(options);var result=options.editorOnly?{}:getQuotationListData_(yearFilter,options);if(!options.deferSections)documentPageSections_(result,options);result.seller=TAX_INVOICE_SELLER;result.marginMin=QUOTATION_MARGIN_MIN;result.statuses=QUOTATION_STATUSES;return result;}

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
var BACKUP_FOLDER_ID    = "1QqJRj1vet9nkcAn8-bfKDStnhXKGQqWk";
var BACKUP_KEEP_COUNT   = 4;
var BACKUP_COLLECTIONS  = [
  "Master_Brands", "Master_Categories", "Master_Vendors", "Master_Customers",
  "Master_Zones", "Master_Cars", "Master_Products", "Master_Tax_Invoice", "Purchase_Orders",
  "Quotations", "Stock_Movements", "Product_Images", "Master_Users",
  "Doc_Running_Numbers", "Doc_No_Reservations", "Meta_Counters", "Activity_Log"
];

function getOrCreateBackupFolder_() {
  if(BACKUP_FOLDER_ID)return DriveApp.getFolderById(BACKUP_FOLDER_ID);
  var folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

// Version 3: data-only Full generations and daily deltas. Existing v2 restores remain supported.
var BACKUP_STATE_KEY = 'SYY_BACKUP_STATE_V3';
var BACKUP_TIMEZONE = 'Asia/Bangkok';
var BACKUP_MAX_RUNTIME_MS = 270000;
var BACKUP_SLICE_MS = 180000;
var BACKUP_JOB_KEY = 'SYY_BACKUP_PENDING_V3';
var BACKUP_SNAPSHOT_MAX_AGE_MS = 3000000;

function backupEndpoint_() {return 'https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents';}
function backupReadTime_() {
  var response=UrlFetchApp.fetch(backupEndpoint_()+':runQuery',{method:'post',headers:getAuthHeader_(),contentType:'application/json',payload:JSON.stringify({structuredQuery:{from:[{collectionId:'Master_Products'}],limit:1}}),muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error('เริ่มเวลา snapshot ของ Backup ไม่สำเร็จ');
  var rows=JSON.parse(response.getContentText()),time=Array.isArray(rows)&&rows.length?rows[rows.length-1].readTime:'';
  if(!time||!isFinite(Date.parse(time)))throw new Error('Backup ไม่มีเวลา snapshot จาก Firestore');return time;
}
function backupChildFolder_(parent,name) {
  assertPrivateBackupFolder_(parent);
  var found=parent.getFoldersByName(name),folder=found.hasNext()?found.next():parent.createFolder(name);
  if(found.hasNext())throw new Error('พบโฟลเดอร์ Backup ชื่อซ้ำ กรุณาตรวจ Drive');
  assertPrivateBackupFolder_(folder);return folder;
}
function backupProjectFolder_() {return backupChildFolder_(getOrCreateBackupFolder_(),PROJECT_ID);}
function backupSingleFile_(folder,name) {
  var files=folder.getFilesByName(name),file=files.hasNext()?files.next():null;
  if(!file||files.hasNext())throw new Error('Backup ไม่มีไฟล์ '+name+' ที่ครบถ้วน');
  assertPrivateBackupItem_(file);return file;
}
function backupFileInFolder_(file,folder) {
  var parents=file.getParents(),found=false;
  while(parents.hasNext())if(parents.next().getId()===folder.getId())found=true;
  if(!found)throw new Error('ไฟล์ Backup อยู่ผิดโฟลเดอร์');
}
function backupParentFolder_(folder) {
  var parents=folder.getParents();if(!parents.hasNext())throw new Error('Backup ไม่มีโฟลเดอร์ต้นทาง');var parent=parents.next();
  if(parents.hasNext())throw new Error('Backup มีโฟลเดอร์ต้นทางซ้ำ');assertPrivateBackupFolder_(parent);return parent;
}
function backupWriteJson_(folder,name,value) {
  var file=folder.createFile(name,JSON.stringify(value),MimeType.PLAIN_TEXT);assertPrivateBackupItem_(file);
  return {id:file.getId(),name:name,bytes:file.getSize(),digest:backupDigest_(file.getBlob().getBytes())};
}
function backupReadJson_(descriptor,folder) {
  if(!descriptor||typeof descriptor.id!=='string'||!/^[a-f0-9]{64}$/.test(descriptor.digest))throw new Error('Backup file descriptor ไม่ถูกต้อง');
  var file=DriveApp.getFileById(descriptor.id);assertPrivateBackupItem_(file);backupFileInFolder_(file,folder);
  var blob=file.getBlob();if(backupDigest_(blob.getBytes())!==descriptor.digest)throw new Error('Backup checksum ไม่ตรง');
  return JSON.parse(blob.getDataAsString());
}
function backupPathValid_(path,document) {
  if(typeof path!=='string'||!path||path.length>6144)return false;
  var segments=path.split('/');return segments.length%2===(document?0:1)&&segments.every(function(x){return x&&x!=='.'&&x!=='..'&&!/^__.*__$/.test(x);});
}
function backupManifest_(folder,sourceProjectId) {
  assertPrivateBackupFolder_(folder);
  var file=backupSingleFile_(folder,'manifest.json'),m=JSON.parse(file.getBlob().getDataAsString());
  var copy=JSON.parse(JSON.stringify(m));delete copy.digest;
  if(m.schemaVersion!==3||m.complete!==true||m.projectId!==(sourceProjectId||PROJECT_ID)||m.databaseId!=='(default)'||
     ['full','incremental'].indexOf(m.kind)<0||m.folderId!==folder.getId()||!Array.isArray(m.parts)||!Array.isArray(m.collections)||
     !m.readTime||!isFinite(Date.parse(m.readTime))||m.imagesIncluded!==false||backupJsonDigest_(copy)!==m.digest)throw new Error('Backup v3 ไม่ครบถ้วนหรือผิดโปรเจกต์');
  if(m.collections.some(function(c){return !backupPathValid_(c.path,false)||!Number.isInteger(c.count)||c.count<0;}))throw new Error('Backup collection ไม่ถูกต้อง');
  var dateFolder=backupParentFolder_(folder),parent=backupParentFolder_(dateFolder),project=null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(m.backupDay)||dateFolder.getName()!==m.backupDay)throw new Error('Backup อยู่ผิดวันที่');
  if(m.kind==='full'){
    if(m.baseFullId!==folder.getId()||m.previousId||parent.getName()!=='Full')throw new Error('Full Backup อ้างอิงไม่ถูกต้อง');project=backupParentFolder_(parent);
  }else{
    if(typeof m.baseFullId!=='string'||typeof m.previousId!=='string'||!m.previousId||m.previousId===folder.getId())throw new Error('Incremental Backup อ้างอิงไม่ถูกต้อง');
    if(parent.getId()!==m.incrementalGroupId||parent.getName()!==m.baseFullId)throw new Error('Incremental Backup อยู่ผิดรุ่น Full');
    var increments=backupParentFolder_(parent);if(increments.getName()!=='Incremental')throw new Error('Incremental Backup อยู่ผิดโฟลเดอร์');project=backupParentFolder_(increments);
  }
  if(project.getName()!==m.projectId||project.getId()!==m.projectFolderId)throw new Error('Backup folder ผิดโปรเจกต์');
  return m;
}
function backupIndex_(folder,m) {
  var value=backupReadJson_(m.index,folder);
  if(!value||!value.documents||typeof value.documents!=='object'||Array.isArray(value.documents))throw new Error('Backup index ไม่ถูกต้อง');
  Object.keys(value.documents).forEach(function(path){if(!backupPathValid_(path,true)||!/^[a-f0-9]{64}$/.test(value.documents[path]))throw new Error('Backup index path ไม่ถูกต้อง');});
  return value;
}
function backupState_() {
  var raw=PropertiesService.getScriptProperties().getProperty(BACKUP_STATE_KEY);if(!raw)return null;
  var state=JSON.parse(raw);if(state.projectId!==PROJECT_ID||typeof state.lastFolderId!=='string'||typeof state.projectFolderId!=='string')throw new Error('Backup state ไม่ถูกต้อง');return state;
}
function backupCheckDeadline_(start) {if(Date.now()-start>BACKUP_MAX_RUNTIME_MS)throw new Error('Backup เกินเวลาที่ปลอดภัย ไม่เผยแพร่ชุดข้อมูลที่อ่านไม่ครบ');}
function backupDiscoveryBatch_(pending,readTime,start){
  backupCheckDeadline_(start);var part=pending.slice(0,20),result=[],remaining=pending.slice(part.length);
  if(!part.length)return {paths:result,pending:remaining};
  var responses=UrlFetchApp.fetchAll(part.map(function(item){return {url:backupEndpoint_()+(item.path?'/'+item.path.split('/').map(encodeURIComponent).join('/'):'')+':listCollectionIds',method:'post',headers:getAuthHeader_(),contentType:'application/json',payload:JSON.stringify({pageSize:100,readTime:readTime,pageToken:item.token}),muteHttpExceptions:true};}));
  responses.forEach(function(response,i){
    if(response.getResponseCode()!==200)throw new Error('ค้นหา Collection สำหรับ Backup ไม่สำเร็จ');
    var body=JSON.parse(response.getContentText()),item=part[i],seen=Object.assign(Object.create(null),item.seen);
    (body.collectionIds||[]).forEach(function(id){var path=(item.path?item.path+'/':'')+id;if(!backupPathValid_(path,false))throw new Error('Collection path ไม่ถูกต้อง');result.push(path);});
    if(body.nextPageToken){if(seen[body.nextPageToken])throw new Error('Collection pagination วนซ้ำ');seen[body.nextPageToken]=true;remaining.push({path:item.path,token:body.nextPageToken,seen:seen});}
  });
  return {paths:result,pending:remaining};
}
function backupCollectionIds_(parents,readTime,start) {
  var result=[],pending=parents.map(function(path){return {path:path,token:'',seen:Object.create(null)};});
  while(pending.length){
    var batch=backupDiscoveryBatch_(pending,readTime,start);result=result.concat(batch.paths);pending=batch.pending;
  }
  return result;
}
function backupCapture_(run,priorIndex,readTime,start,checkpoint) {
  var state=checkpoint&&checkpoint.phase?checkpoint:{phase:'capture',known:Object.create(null),queue:[],discovery:[{path:'',token:'',seen:Object.create(null)}],index:{documents:Object.create(null)},collections:[],parts:[],collectionFolders:Object.create(null),written:0,deleted:0,read:0,requiresAuthKey:false,current:null};
  state.discovery=state.discovery||[]; // Older v1 checkpoints already completed their pending discovery.
  function pause(){backupCheckDeadline_(start);return checkpoint&&Date.now()-start>=BACKUP_SLICE_MS;}
  function writePart(path,upserts,removals){
    if(!upserts.length&&!removals.length)return;
    var folder=Object.prototype.hasOwnProperty.call(state.collectionFolders,path)?DriveApp.getFolderById(state.collectionFolders[path]):null;if(!folder){folder=run.createFolder(path.indexOf('/')<0?path:path.split('/').pop()+'__'+backupJsonDigest_(path).slice(0,12));assertPrivateBackupFolder_(folder);state.collectionFolders[path]=folder.getId();}
    var descriptor=backupWriteJson_(folder,'part-'+String(state.parts.length+1)+'.json',{collection:path,upserts:upserts,deleted:removals});descriptor.folderId=folder.getId();descriptor.collection=path;state.parts.push(descriptor);state.written+=upserts.length;state.deleted+=removals.length;
  }
  while(state.phase==='capture'&&(state.queue.length||state.current||state.discovery.length)){
      if(pause())return {pending:true,state:state};
      if(state.discovery.length){var discovered=backupDiscoveryBatch_(state.discovery,readTime,start);state.queue=state.queue.concat(discovered.paths);state.discovery=discovered.pending;continue;}
      if(!state.current){var next=state.queue.shift();if(Object.prototype.hasOwnProperty.call(state.known,next))continue;state.known[next]=true;state.current={path:next,token:'',seen:Object.create(null),count:0};}
      var current=state.current,path=current.path;
      var url=backupEndpoint_()+'/'+path.split('/').map(encodeURIComponent).join('/')+'?pageSize=100&showMissing=true&readTime='+encodeURIComponent(readTime)+(current.token?'&pageToken='+encodeURIComponent(current.token):'');
      var response=UrlFetchApp.fetch(url,{method:'get',headers:getAuthHeader_(),muteHttpExceptions:true});
      if(response.getResponseCode()!==200)throw new Error('อ่าน Backup Collection '+path+' ไม่สำเร็จ');
      var body=JSON.parse(response.getContentText()),parents=[],upserts=[];
      (body.documents||[]).forEach(function(doc){
        var prefix='projects/'+PROJECT_ID+'/databases/(default)/documents/',docPath=String(doc.name||'').slice(prefix.length);
        if(String(doc.name||'').indexOf(prefix)!==0||!backupPathValid_(docPath,true)||docPath.slice(0,docPath.lastIndexOf('/'))!==path)throw new Error('Backup document path ไม่ตรง');
        parents.push(docPath);
        // Missing parents have subcollections, but are not themselves stored documents.
        if(!doc.updateTime&&!doc.createTime)return;
        var item={path:docPath,fields:doc.fields||{},updateTime:doc.updateTime||'',createTime:doc.createTime||''},hash=backupJsonDigest_(item);
        if(docPath.split('/')[0]==='Master_Users'&&String(parseFirestoreValue_(item.fields.Totp_Enabled))==='true')state.requiresAuthKey=true;
        if(Object.prototype.hasOwnProperty.call(state.index.documents,docPath))throw new Error('Backup document ซ้ำ');
        state.index.documents[docPath]=hash;current.count++;state.read++;
        if(!priorIndex||priorIndex.documents[docPath]!==hash)upserts.push(item);
      });
      writePart(path,upserts,[]);
      state.discovery=parents.map(function(parent){return {path:parent,token:'',seen:Object.create(null)};});
      current.token=body.nextPageToken||'';if(current.token&&Object.prototype.hasOwnProperty.call(current.seen,current.token))throw new Error('Backup pagination วนซ้ำ');if(current.token)current.seen[current.token]=true;
      if(!current.token){state.collections.push({path:path,count:current.count});state.current=null;}
  }
  if(state.phase==='capture'){state.phase='deletions';state.removals=Object.create(null);if(priorIndex)Object.keys(priorIndex.documents).forEach(function(docPath){if(!Object.prototype.hasOwnProperty.call(state.index.documents,docPath)){var path=docPath.slice(0,docPath.lastIndexOf('/'));(state.removals[path]||(state.removals[path]=[])).push(docPath);}});state.removalPaths=Object.keys(state.removals);}
  while(state.removalPaths.length){if(pause())return {pending:true,state:state};var removedPath=state.removalPaths.shift();writePart(removedPath,[],state.removals[removedPath]);}
  state.collections.sort(function(a,b){return a.path.localeCompare(b.path);});return state;
}
// Verify every source part before starting a new DB snapshot. Keep digests,
// not a second in-memory copy of every business row, in the private checkpoint.
function backupVerifyBase_(folderId,sourceProjectId,start,checkpoint){
  var state=checkpoint||{phase:'chain',next:folderId,seen:Object.create(null),base:'',projectFolderId:'',chain:[],version:0,part:0,lastTime:0,documents:Object.create(null),authUsers:Object.create(null),changes:Object.create(null)};
  function pause(){backupCheckDeadline_(start);return Date.now()-start>=BACKUP_SLICE_MS;}
  while(state.phase==='chain'&&state.next){
    if(pause())return {pending:true,state:state};
    var id=state.next;if(Object.prototype.hasOwnProperty.call(state.seen,id))throw new Error('Incremental chain วนซ้ำ');
    var folder=DriveApp.getFolderById(id),m=backupManifest_(folder,sourceProjectId),date=backupParentFolder_(folder),project=m.kind==='full'?backupParentFolder_(backupParentFolder_(date)):backupParentFolder_(backupParentFolder_(backupParentFolder_(date)));
    state.base=state.base||m.baseFullId;state.projectFolderId=state.projectFolderId||project.getId();
    if(m.baseFullId!==state.base||project.getId()!==state.projectFolderId)throw new Error('Incremental chain ข้ามรุ่น Full หรือโฟลเดอร์');
    state.seen[id]=true;state.chain.push(m);state.next=m.previousId;
  }
  if(state.phase==='chain'){
    state.chain.reverse();if(!state.chain.length||state.chain[0].kind!=='full'||state.chain[0].folderId!==state.base)throw new Error('Incremental ไม่มี Full ต้นทาง');state.phase='parts';
  }
  while(state.version<state.chain.length){
    if(pause())return {pending:true,state:state};
    var manifest=state.chain[state.version],run=DriveApp.getFolderById(manifest.folderId),time=Date.parse(manifest.readTime);
    // A manifest must still be the same version when a paused validator resumes.
    if(backupManifest_(run,sourceProjectId).digest!==manifest.digest)throw new Error('Backup manifest checksum เปลี่ยนระหว่างตรวจ');
    if(time<state.lastTime)throw new Error('Incremental chain มีเวลาย้อนกลับ');
    while(state.part<manifest.parts.length){
      if(pause())return {pending:true,state:state};
      var part=manifest.parts[state.part],partFolder=DriveApp.getFolderById(part.folderId);assertPrivateBackupFolder_(partFolder);backupFileInFolder_(partFolder,run);
      var payload=backupReadJson_(part,partFolder);
      if(!backupPathValid_(payload.collection,false)||payload.collection!==part.collection||!Array.isArray(payload.upserts)||!Array.isArray(payload.deleted))throw new Error('Backup part ไม่ถูกต้อง');
      payload.upserts.forEach(function(doc){
        if(!doc||!backupPathValid_(doc.path,true)||doc.path.slice(0,doc.path.lastIndexOf('/'))!==payload.collection||!doc.fields||typeof doc.fields!=='object'||Array.isArray(doc.fields)||typeof doc.updateTime!=='string'||typeof doc.createTime!=='string'||Object.prototype.hasOwnProperty.call(state.changes,doc.path))throw new Error('Backup document ไม่ถูกต้องหรือซ้ำ');
        state.changes[doc.path]=true;state.documents[doc.path]=backupJsonDigest_(doc);
        if(doc.path.split('/')[0]==='Master_Users')state.authUsers[doc.path]=String(parseFirestoreValue_(doc.fields.Totp_Enabled))==='true';
      });
      payload.deleted.forEach(function(path){
        if(manifest.kind==='full'||!backupPathValid_(path,true)||path.slice(0,path.lastIndexOf('/'))!==payload.collection||Object.prototype.hasOwnProperty.call(state.changes,path)||!Object.prototype.hasOwnProperty.call(state.documents,path))throw new Error('Backup deletion ไม่ถูกต้อง');
        state.changes[path]=true;delete state.documents[path];delete state.authUsers[path];
      });
      state.part++;
    }
    if(pause())return {pending:true,state:state};
    var index=backupIndex_(run,manifest),paths=Object.keys(state.documents);
    if(paths.length!==Object.keys(index.documents).length||paths.some(function(path){return state.documents[path]!==index.documents[path];}))throw new Error('Backup chain มีข้อมูลไม่ครบหรือ checksum ไม่ตรง');
    var counts=Object.create(null);paths.forEach(function(path){var collection=path.slice(0,path.lastIndexOf('/'));counts[collection]=(counts[collection]||0)+1;});
    manifest.collections.forEach(function(collection){if((counts[collection.path]||0)!==collection.count)throw new Error('Backup document count ไม่ตรง');delete counts[collection.path];});if(Object.keys(counts).length)throw new Error('Backup ไม่ได้ระบุ Collection ครบ');
    var properties=backupReadJson_(manifest.scriptProperties,run);if(!properties||typeof properties!=='object'||Array.isArray(properties))throw new Error('Backup Properties ไม่ถูกต้อง');
    state.properties=properties;state.lastTime=time;state.version++;state.part=0;state.changes=Object.create(null);
  }
  if(Object.keys(state.authUsers).some(function(path){return state.authUsers[path];})&&!state.properties.AUTH_MASTER_KEY)throw new Error('Backup ไม่มีคีย์สำหรับกู้คืน TOTP');
  return {manifest:state.chain[state.chain.length-1],index:{documents:state.documents},properties:state.properties};
}
function backupPendingJob_(){
  var raw=PropertiesService.getScriptProperties().getProperty(BACKUP_JOB_KEY);if(!raw)return null;
  var job=JSON.parse(raw);if(job.projectId!==PROJECT_ID||typeof job.folderId!=='string'||!job.checkpoint||!Number.isFinite(job.startedAt))throw new Error('Checkpoint ของ Backup ไม่ถูกต้อง กรุณาตรวจสอบก่อนเริ่มใหม่');return job;
}
function backupPendingResult_(job){return {success:true,pending:true,kind:job.kind,phase:job.phase||'capture',folderId:job.folderId,readDocuments:job.readDocuments||0,startedAt:job.startedAt,message:job.phase==='verify'?'กำลังตรวจ checksum ของ Backup ต้นทาง ระบบจะทำต่ออัตโนมัติ':'กำลังสำรองข้อมูลเป็นช่วง ระบบจะทำต่ออัตโนมัติ'};}
function backupMarkScheduled_(result,marker){if(result.pending){var job=backupPendingJob_();if(!job)throw new Error('ไม่มี Checkpoint ของ Backup ตามตาราง');job.scheduledMarker=marker;PropertiesService.getScriptProperties().setProperty(BACKUP_JOB_KEY,JSON.stringify(job));}return result;}
function backupContinuationTriggers_(keep){
  if(!ScriptApp.getProjectTriggers)return;ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='continueBackupJob_'&&t.getUniqueId()!==keep)try{ScriptApp.deleteTrigger(t);}catch(e){console.error('Backup continuation cleanup',e.message);}});
}
function backupSaveJob_(run,context,capture,priorIndex,oldJob){
  var descriptor=backupWriteJson_(run,'checkpoint-'+Utilities.getUuid()+'.json',{schemaVersion:1,context:context,capture:capture,priorIndex:priorIndex});
  var trigger=ScriptApp.newTrigger('continueBackupJob_').timeBased().after(60000).create();
  var job={projectId:PROJECT_ID,folderId:run.getId(),checkpoint:descriptor,kind:context.kind,phase:capture.phase==='verify-base'?'verify':'capture',startedAt:context.startedAt,readDocuments:capture.read,scheduledMarker:oldJob&&oldJob.scheduledMarker||'',triggerId:trigger.getUniqueId()};
  try{PropertiesService.getScriptProperties().setProperty(BACKUP_JOB_KEY,JSON.stringify(job));}catch(e){try{ScriptApp.deleteTrigger(trigger);}catch(ignored){}throw e;}
  backupContinuationTriggers_(job.triggerId);return backupPendingResult_(job);
}
function backupResume_(job){
  var start=Date.now(),result=backupAllDataToBackup_(job?job.kind:'full',false,start,true,{deferRetention:!!(job&&job.scheduledMarker)});
  if(result.success&&!result.pending&&job&&job.scheduledMarker){
    if(result.kind==='full'){var delta=backupAllDataToBackup_('incremental',true,start,false,{cleanupAfter:true});if(!delta.success)return {success:false,errors:['Full สำเร็จ แต่ Daily Incremental ไม่สำเร็จ: '+delta.errors.join('; ')],full:result};if(delta.pending)return backupMarkScheduled_(delta,job.scheduledMarker);if(delta.warnings&&delta.warnings.length)result.warnings=(result.warnings||[]).concat(delta.warnings);}
    PropertiesService.getScriptProperties().setProperty('SYY_BACKUP_LAST_DAY',job.scheduledMarker);
  }
  return result;
}
function continueBackupJob_(){
  var job=backupPendingJob_();if(!job){backupContinuationTriggers_('');return {success:true,skipped:true};}
  var result=backupResume_(job);if(!result.success)throw new Error('Backup ต่อไม่สำเร็จ: '+result.errors.join('; '));return result;
}
function backupAllDataToBackup_(kind,reuseSnapshot,jobStart,resume,workflow) {
  kind=kind||'full';var result={success:false,collections:{},errors:[]},run=null,published=false,lock=LockService.getUserLock(),start=jobStart===undefined?Date.now():jobStart;
  if(!lock.tryLock(100)){result.errors.push('มี Backup อีกงานกำลังทำงานอยู่');return result;}
  try{
    var pending=backupPendingJob_(),context=null,captureState={},priorIndex=null,properties,readTime,project,previous=null,previousFolder=null,baseFullId='',group=null,day,probeReads=0;workflow=workflow||{};
    if(pending&&!resume)return backupPendingResult_(pending);
    if(pending){
      run=DriveApp.getFolderById(pending.folderId);assertPrivateBackupFolder_(run);
      var saved=backupReadJson_(pending.checkpoint,run);context=saved.context;
      var verifying=saved.capture&&saved.capture.phase==='verify-base';
      if(saved.schemaVersion!==1||!context||context.projectId!==PROJECT_ID||context.folderId!==run.getId()||context.startedAt!==pending.startedAt||['full','incremental'].indexOf(context.kind)<0||!verifying&&!isFinite(Date.parse(context.readTime))||!saved.capture||!Array.isArray(saved.capture.queue))throw new Error('Checkpoint ของ Backup ไม่ครบถ้วน');
      if(!verifying&&Date.now()-Date.parse(context.readTime)>BACKUP_SNAPSHOT_MAX_AGE_MS)throw new Error('Snapshot ของ Backup หมดเวลา กรุณาเริ่ม Backup ใหม่');
      project=backupProjectFolder_();if(project.getId()!==context.projectFolderId)throw new Error('โฟลเดอร์ปลายทางเปลี่ยนระหว่าง Backup');
      var dateParent=backupParentFolder_(run),typeParent=backupParentFolder_(dateParent),runProject;
      if(dateParent.getName()!==context.day)throw new Error('Checkpoint ของ Backup อยู่ผิดวันที่');
      if(context.kind==='full'){if(typeParent.getName()!=='Full'||context.baseFullId!==run.getId())throw new Error('Checkpoint ของ Full Backup อยู่ผิดโฟลเดอร์');runProject=backupParentFolder_(typeParent);}
      else{if(typeParent.getId()!==context.groupId||typeParent.getName()!==context.baseFullId)throw new Error('Checkpoint ของ Incremental Backup อยู่ผิดรุ่น');var incrementalParent=backupParentFolder_(typeParent);if(incrementalParent.getName()!=='Incremental')throw new Error('Checkpoint ของ Backup อยู่ผิดโฟลเดอร์');runProject=backupParentFolder_(incrementalParent);}
      if(runProject.getId()!==project.getId())throw new Error('Checkpoint ของ Backup อยู่ผิดโปรเจกต์');
      kind=context.kind;properties=context.properties;readTime=context.readTime;priorIndex=saved.priorIndex;captureState=saved.capture;previous=context.previous;baseFullId=context.baseFullId;group=context.groupId?DriveApp.getFolderById(context.groupId):null;day=context.day;
      reuseSnapshot=!!context.reuseSnapshot;
    }else{
    if(['full','incremental'].indexOf(kind)<0)throw new Error('ชนิด Backup ไม่ถูกต้อง');
    project=backupProjectFolder_();var state=kind==='incremental'?backupState_():null;
    if(state&&state.projectFolderId!==project.getId())state=null;
    if(state){previousFolder=DriveApp.getFolderById(state.lastFolderId);previous=backupManifest_(previousFolder);if(previous.projectFolderId!==project.getId())throw new Error('Backup ต้นทางอยู่ผิดปลายทาง');captureState={phase:'verify-base',queue:[],verification:null,read:0};}
    else if(kind==='incremental'){kind='full';result.bootstrap=true;}
    properties=previous?null:backupScriptProperties_();readTime=previous?'':backupReadTime_();if(!previous)probeReads++;
    day=Utilities.formatDate(new Date(),BACKUP_TIMEZONE,'yyyy-MM-dd');var suffix=Utilities.formatDate(new Date(),BACKUP_TIMEZONE,'HH-mm-ss')+'_'+Utilities.getUuid();
    if(kind==='full'){run=backupChildFolder_(backupChildFolder_(project,'Full'),day).createFolder('full_'+suffix);baseFullId=run.getId();}
    else{baseFullId=previous.baseFullId;group=backupChildFolder_(backupChildFolder_(project,'Incremental'),baseFullId);run=backupChildFolder_(group,day).createFolder('incremental_'+suffix);}
    assertPrivateBackupFolder_(run);
    context={projectId:PROJECT_ID,projectFolderId:project.getId(),folderId:run.getId(),kind:kind,readTime:readTime,startedAt:Date.now(),properties:properties,previous:previous,baseFullId:baseFullId,groupId:group?group.getId():'',day:day,reuseSnapshot:!!reuseSnapshot,deferRetention:!!workflow.deferRetention,cleanupAfter:!!workflow.cleanupAfter};
    }
    if(captureState.phase==='verify-base'){
      if(!previous)throw new Error('Checkpoint ไม่มี Backup ต้นทาง');
      var checked=backupVerifyBase_(previous.folderId,PROJECT_ID,start,captureState.verification);
      if(checked.pending){captureState.verification=checked.state;return backupSaveJob_(run,context,captureState,null,pending);}
      if(checked.manifest.digest!==previous.digest)throw new Error('Backup ต้นทาง checksum เปลี่ยน');
      priorIndex=checked.index;properties=reuseSnapshot?checked.properties:backupScriptProperties_();readTime=reuseSnapshot?previous.readTime:backupReadTime_();if(!reuseSnapshot)probeReads++;
      if(Date.parse(readTime)<Date.parse(previous.readTime))throw new Error('เวลา Backup ย้อนกลับจากรุ่นก่อนหน้า');
      context.properties=properties;context.readTime=readTime;captureState={};
    }
    var capture=reuseSnapshot&&previous?{index:priorIndex,collections:previous.collections,parts:[],written:0,deleted:0,read:0}:backupCapture_(run,priorIndex,readTime,start,captureState);
    if(capture.pending)return backupSaveJob_(run,context,capture.state,priorIndex,pending);
    if(capture.requiresAuthKey&&!properties.AUTH_MASTER_KEY)throw new Error('Backup ไม่มีคีย์สำหรับกู้คืน TOTP');
    if(backupJsonDigest_(properties)!==backupJsonDigest_(backupScriptProperties_()))throw new Error('Script Properties เปลี่ยนระหว่าง Backup กรุณาลองใหม่');
    var m={schemaVersion:3,complete:true,projectId:PROJECT_ID,projectFolderId:project.getId(),databaseId:'(default)',kind:kind,folderId:run.getId(),baseFullId:baseFullId,previousId:previous?previous.folderId:'',incrementalGroupId:group?group.getId():'',backupDay:day,backupDate:new Date().toISOString(),readTime:readTime,imagesIncluded:false,collections:capture.collections,parts:capture.parts,written:capture.written,deleted:capture.deleted,readDocuments:capture.read,
      index:backupWriteJson_(run,'index.json',capture.index),scriptProperties:backupWriteJson_(run,'script-properties.json',properties)};
    backupCheckDeadline_(start);
    m.digest=backupJsonDigest_(m);var descriptor=backupWriteJson_(run,'manifest.json',m);published=true;
    PropertiesService.getScriptProperties().setProperty(BACKUP_STATE_KEY,JSON.stringify({projectId:PROJECT_ID,projectFolderId:project.getId(),lastFolderId:run.getId(),baseFullId:baseFullId}));
    if(pending){PropertiesService.getScriptProperties().deleteProperty(BACKUP_JOB_KEY);backupContinuationTriggers_('');}
    result.success=true;result.kind=kind;result.folderId=run.getId();result.fileId=descriptor.id;result.fileName=run.getName();result.url=run.getUrl();result.written=m.written;result.deleted=m.deleted;result.readDocuments=m.readDocuments;result.snapshotProbeReads=probeReads;result.fileSizeKB=Math.round((m.parts.reduce(function(n,p){return n+p.bytes;},0)+m.index.bytes+m.scriptProperties.bytes+descriptor.bytes)/1024);
    m.collections.forEach(function(c){result.collections[c.path]=c.count;});
    if((kind==='full'&&!context.deferRetention)||(kind!=='full'&&context.cleanupAfter))result.warnings=cleanupOldBackups_(project,start);
  }catch(e){result.errors.push(e.message);
    var resumable=pending&&run&&!published&&!/Checkpoint|Snapshot.*หมดเวลา|โฟลเดอร์ปลายทางเปลี่ยน|checksum|Script Properties เปลี่ยน|ส่วนตัว|ผิดโปรเจกต์/.test(e.message);
    if(resumable){result.pending=true;result.needsResume=true;result.folderId=run.getId();pending.lastError=String(e.message).slice(0,250);try{PropertiesService.getScriptProperties().setProperty(BACKUP_JOB_KEY,JSON.stringify(pending));}catch(ignored){}}
    else{if(pending&&run)try{PropertiesService.getScriptProperties().deleteProperty(BACKUP_JOB_KEY);backupContinuationTriggers_('');}catch(ignored){}if(run&&!published){try{run.setTrashed(true);}catch(ignore){}}}
  }
  finally{lock.releaseLock();}return result;
}
function backupAssertTreePrivate_(folder,start) {
  start=start===undefined?Date.now():start;backupCheckDeadline_(start);assertPrivateBackupFolder_(folder);var files=folder.getFiles();while(files.hasNext()){backupCheckDeadline_(start);assertPrivateBackupItem_(files.next());}var children=folder.getFolders();while(children.hasNext())backupAssertTreePrivate_(children.next(),start);
}
function backupDateRunFolders_(typeFolder) {
  var result=[],dates=typeFolder.getFolders();while(dates.hasNext()){var date=dates.next();if(!/^\d{4}-\d{2}-\d{2}$/.test(date.getName()))continue;assertPrivateBackupFolder_(date);var runs=date.getFolders();while(runs.hasNext())result.push(runs.next());}return result;
}
function cleanupOldBackups_(project,start) {
  start=start===undefined?Date.now():start;
  try{
    var full=backupChildFolder_(project,'Full'),list=[];
    backupDateRunFolders_(full).forEach(function(folder){backupCheckDeadline_(start);if(folder.getName().indexOf('full_')!==0)return;try{var m=readFolderBackup_(folder.getId(),PROJECT_ID,start).manifest;if(m.kind==='full')list.push({folder:folder,m:m});}catch(ignore){}});
    backupCheckDeadline_(start);list.sort(function(a,b){return Date.parse(b.m.backupDate)-Date.parse(a.m.backupDate);});
    var increments=backupChildFolder_(project,'Incremental');
    list.slice(BACKUP_KEEP_COUNT).forEach(function(item){
      backupCheckDeadline_(start);
      backupAssertTreePrivate_(item.folder,start);var groups=increments.getFoldersByName(item.folder.getId()),owned=[];while(groups.hasNext()){var group=groups.next();backupAssertTreePrivate_(group,start);owned.push(group);}
      owned.forEach(function(group){group.setTrashed(true);});var date=backupParentFolder_(item.folder);item.folder.setTrashed(true);if(!date.getFolders().hasNext()&&!date.getFiles().hasNext())date.setTrashed(true);
    });
    return [];
  }catch(e){var warning='Backup สำเร็จ แต่จำกัดจำนวนรุ่นไม่สำเร็จ: '+e.message;console.error(warning);return [warning];}
}
function backupNow_() {return backupResume_(backupPendingJob_());}
function weeklyBackupJob_() {var result=backupAllDataToBackup_('full');if(!result.success)throw new Error('Full Backup ไม่สำเร็จ: '+result.errors.join('; '));return result;}
function dailyBackupJob_() {
  var start=Date.now(),day=Utilities.formatDate(new Date(),BACKUP_TIMEZONE,'yyyy-MM-dd'),properties=PropertiesService.getScriptProperties(),project=backupProjectFolder_();
  var marker=JSON.stringify({day:day,projectFolderId:project.getId()});
  if(properties.getProperty('SYY_BACKUP_LAST_DAY')===marker)return {success:true,skipped:true,reason:'สำรองตามตารางวันนี้สำเร็จแล้ว'};
  var pending=backupPendingJob_();
  if(pending){
    var resumed=backupResume_(pending);
    // A missed continuation is retried by the daily schedule. An expired snapshot is discarded before starting a fresh one.
    if(!resumed.success&&!(resumed.errors.some(function(e){return /Snapshot.*หมดเวลา/.test(e);})&&!backupPendingJob_()))throw new Error('Backup ต่อไม่สำเร็จ: '+resumed.errors.join('; '));
    if(resumed.pending||resumed.success&&pending.scheduledMarker===marker)return resumed;
  }
  var sunday=Utilities.formatDate(new Date(),BACKUP_TIMEZONE,'u')==='7';
  var result=backupAllDataToBackup_(sunday?'full':'incremental',false,start,false,{deferRetention:true});if(!result.success)throw new Error('Backup ไม่สำเร็จ: '+result.errors.join('; '));
  if(result.pending)return backupMarkScheduled_(result,marker);
  // Sunday and first-run bootstrap share the Full snapshot: daily delta is a valid empty delta, with no second scan.
  if(result.kind==='full'){var delta=backupAllDataToBackup_('incremental',true,start,false,{cleanupAfter:true});if(!delta.success)throw new Error('Daily Incremental ไม่สำเร็จ: '+delta.errors.join('; '));if(delta.pending)return backupMarkScheduled_(delta,marker);properties.setProperty('SYY_BACKUP_LAST_DAY',marker);return {full:result,incremental:delta};}properties.setProperty('SYY_BACKUP_LAST_DAY',marker);return result;
}
function setupBackupSchedule_() {
  var lock=LockService.getUserLock();if(!lock.tryLock(100))throw new Error('กำลังสำรองข้อมูล กรุณาลองใหม่');
  try{
    assertPrivateBackupFolder_(getOrCreateBackupFolder_());
    // Create the replacement first; an authorization/quota failure must retain the previous schedule.
    var old=ScriptApp.getProjectTriggers().slice(),created=ScriptApp.newTrigger('dailyBackupJob_').timeBased().everyDays(1).atHour(22).nearMinute(0).inTimezone(BACKUP_TIMEZONE).create();
    old.forEach(function(t){if(['weeklyBackupJob','weeklyBackupJob_','dailyBackupJob','dailyBackupJob_'].indexOf(t.getHandlerFunction())>=0)ScriptApp.deleteTrigger(t);});
    return {success:true,timezone:BACKUP_TIMEZONE,hour:22,fullKeep:BACKUP_KEEP_COUNT,triggerId:created.getUniqueId()};
  }finally{lock.releaseLock();}
}
function setupWeeklyBackupTrigger_() {return setupBackupSchedule_();}
function removeWeeklyBackupTrigger_() {ScriptApp.getProjectTriggers().forEach(function(t){if(['weeklyBackupJob','weeklyBackupJob_','dailyBackupJob','dailyBackupJob_'].indexOf(t.getHandlerFunction())>=0)ScriptApp.deleteTrigger(t);});}
function getBackupOverview_() {
  var triggers=ScriptApp.getProjectTriggers().filter(function(t){return ['weeklyBackupJob','weeklyBackupJob_','dailyBackupJob','dailyBackupJob_'].indexOf(t.getHandlerFunction())>=0;});
  var job=backupPendingJob_();return {files:listBackupFiles_(),activeJob:job?{kind:job.kind,phase:job.phase||'capture',readDocuments:job.readDocuments,startedAt:job.startedAt,lastError:job.lastError||''}:null,schedule:{enabled:triggers.length===1&&triggers[0].getHandlerFunction()==='dailyBackupJob_',duplicate:triggers.length>1,timezone:BACKUP_TIMEZONE,hour:22,fullKeep:BACKUP_KEEP_COUNT}};
}
function listBackupFiles_() {
  var list=[],project=backupProjectFolder_(),full=backupChildFolder_(project,'Full'),bases=[];
  function add(folder){try{var m=backupManifest_(folder);list.push({id:backupSingleFile_(folder,'manifest.json').getId(),folderId:folder.getId(),name:folder.getName(),date:m.backupDate,kind:m.kind,written:m.written,deleted:m.deleted,sizeKB:Math.round((m.parts.reduce(function(n,p){return n+p.bytes;},0)+m.index.bytes+m.scriptProperties.bytes)/1024),url:folder.getUrl()});return m;}catch(ignore){return null;}}
  backupDateRunFolders_(full).forEach(function(folder){if(folder.getName().indexOf('full_')===0){var m=add(folder);if(m)bases.push(m.baseFullId);}});
  var increments=backupChildFolder_(project,'Incremental');bases.forEach(function(id){var groups=increments.getFoldersByName(id);while(groups.hasNext())backupDateRunFolders_(groups.next()).forEach(add);});
  // Historical v2 files are listed and remain readable; their image folders are not modified.
  var files=getOrCreateBackupFolder_().getFilesByType(MimeType.PLAIN_TEXT);while(files.hasNext()){var f=files.next();if(f.getName().indexOf('syy-shop-backup_')===0){assertPrivateBackupItem_(f);list.push({id:f.getId(),name:f.getName(),date:f.getDateCreated().toISOString(),kind:'legacy',sizeKB:Math.round(f.getSize()/1024),url:f.getUrl()});}}
  list.sort(function(a,b){return Date.parse(b.date)-Date.parse(a.date);});return list;
}


function readFolderBackup_(folderId,sourceProjectId,start) {
  var chain=[],seen=Object.create(null),id=folderId,base='',projectFolderId='';start=start===undefined?Date.now():start;
  while(id){
    backupCheckDeadline_(start);if(seen[id])throw new Error('Incremental chain วนซ้ำ');seen[id]=true;
    var folder=DriveApp.getFolderById(id),m=backupManifest_(folder,sourceProjectId);base=base||m.baseFullId;
    var dateParent=backupParentFolder_(folder),projectFolder=m.kind==='full'?backupParentFolder_(backupParentFolder_(dateParent)):backupParentFolder_(backupParentFolder_(backupParentFolder_(dateParent)));
    projectFolderId=projectFolderId||projectFolder.getId();
    if(m.baseFullId!==base||projectFolder.getId()!==projectFolderId)throw new Error('Incremental chain ข้ามรุ่น Full หรือโฟลเดอร์');
    chain.push({folder:folder,m:m});id=m.previousId;
  }
  chain.reverse();if(!chain.length||chain[0].m.kind!=='full'||chain[0].m.folderId!==base)throw new Error('Incremental ไม่มี Full ต้นทาง');
  var documents=Object.create(null),properties=null,lastTime=0,lastIndex=null;
  chain.forEach(function(version){
    backupCheckDeadline_(start);var m=version.m,folder=version.folder,time=Date.parse(m.readTime),changes=Object.create(null);
    if(time<lastTime)throw new Error('Incremental chain มีเวลาย้อนกลับ');lastTime=time;
    m.parts.forEach(function(part){
      backupCheckDeadline_(start);
      var partFolder=DriveApp.getFolderById(part.folderId);assertPrivateBackupFolder_(partFolder);backupFileInFolder_(partFolder,folder);
      var payload=backupReadJson_(part,partFolder);
      if(!backupPathValid_(payload.collection,false)||payload.collection!==part.collection||!Array.isArray(payload.upserts)||!Array.isArray(payload.deleted))throw new Error('Backup part ไม่ถูกต้อง');
      payload.upserts.forEach(function(doc){
        if(!doc||!backupPathValid_(doc.path,true)||doc.path.slice(0,doc.path.lastIndexOf('/'))!==payload.collection||!doc.fields||typeof doc.fields!=='object'||Array.isArray(doc.fields)||typeof doc.updateTime!=='string'||typeof doc.createTime!=='string'||changes[doc.path])throw new Error('Backup document ไม่ถูกต้องหรือซ้ำ');
        changes[doc.path]=true;documents[doc.path]=doc;
      });
      payload.deleted.forEach(function(path){if(m.kind==='full'||!backupPathValid_(path,true)||path.slice(0,path.lastIndexOf('/'))!==payload.collection||changes[path]||!documents[path])throw new Error('Backup deletion ไม่ถูกต้อง');changes[path]=true;delete documents[path];});
    });
    backupCheckDeadline_(start);var index=backupIndex_(folder,m),paths=Object.keys(documents);
    lastIndex=index;
    if(paths.length!==Object.keys(index.documents).length||paths.some(function(path){return backupJsonDigest_(documents[path])!==index.documents[path];}))throw new Error('Backup chain มีข้อมูลไม่ครบหรือ checksum ไม่ตรง');
    var counts=Object.create(null);paths.forEach(function(path){var col=path.slice(0,path.lastIndexOf('/'));counts[col]=(counts[col]||0)+1;});
    m.collections.forEach(function(col){if((counts[col.path]||0)!==col.count)throw new Error('Backup document count ไม่ตรง');delete counts[col.path];});if(Object.keys(counts).length)throw new Error('Backup ไม่ได้ระบุ Collection ครบ');
    backupCheckDeadline_(start);properties=backupReadJson_(m.scriptProperties,folder);if(!properties||typeof properties!=='object'||Array.isArray(properties))throw new Error('Backup Properties ไม่ถูกต้อง');
  });
  if(Object.keys(documents).some(function(path){return path.split('/')[0]==='Master_Users'&&String(parseFirestoreValue_(documents[path].fields.Totp_Enabled))==='true';})&&!properties.AUTH_MASTER_KEY)throw new Error('Backup ไม่มีคีย์สำหรับกู้คืน TOTP');
  return {manifest:chain[chain.length-1].m,documents:documents,index:lastIndex,scriptProperties:properties};
}
function restoreFolderBackup_(folderId,restoreMode,options) {
  var result={success:false,dryRun:options.confirmRestore!==true,restored:{},errors:[],imagesIncluded:false};
  try{
    var backup=readFolderBackup_(folderId,options.sourceProjectId),all=Object.keys(backup.documents),paths=all;
    if(restoreMode&&restoreMode!=='all'){
      if(!backupPathValid_(restoreMode,false)||!backup.manifest.collections.some(function(c){return c.path===restoreMode;}))throw new Error('ชุดข้อมูลที่จะกู้คืนไม่ถูกต้อง');
      paths=all.filter(function(path){return path.indexOf(restoreMode+'/')===0;});
    }
    paths.forEach(function(path){var col=path.slice(0,path.lastIndexOf('/'));if(!result.restored[col])result.restored[col]={planned:0,restored:0};result.restored[col].planned++;});
    if(result.dryRun){result.success=true;return result;}
    var target=String(options.targetProjectId||'');
    if(!/^[a-z][a-z0-9-]{4,62}$/.test(target)||target===backup.manifest.projectId||target!==PROJECT_ID||options.confirmStagingScript!==true)throw new Error('ต้องกู้คืนจากสคริปต์ Staging ไปยัง DB ว่างเท่านั้น');
    if(backupCollectionIds_([''],backupReadTime_(),Date.now()).length)throw new Error('Staging ต้องว่างก่อนกู้คืน');
    if(paths.some(function(path){return path.split('/')[0]==='Master_Users';})&&!options.restoreProperties)throw new Error('กู้คืนบัญชีต้องกู้คืน Script Properties ใน Staging ด้วย');
    var writes=paths.map(function(path){var fields=JSON.parse(JSON.stringify(backup.documents[path].fields));if(path.split('/')[0]==='Master_Users')fields.Session_Version={stringValue:Utilities.getUuid()};return {update:{name:'projects/'+target+'/databases/(default)/documents/'+path,fields:fields},currentDocument:{exists:false}};});
    for(var i=0;i<writes.length;){
      var part=[],bytes=13;
      while(i<writes.length&&part.length<450){var size=Utilities.newBlob(JSON.stringify(writes[i])).getBytes().length;if(size+13>8*1024*1024)throw new Error('Backup document ใหญ่เกินขนาดกู้คืน');if(part.length&&bytes+size+1>8*1024*1024)break;bytes+=size+1;part.push(writes[i++]);}
      var response=UrlFetchApp.fetch(backupEndpoint_()+':commit',{method:'post',headers:getAuthHeader_(),contentType:'application/json',payload:JSON.stringify({writes:part}),muteHttpExceptions:true});
      if(response.getResponseCode()!==200)throw new Error('กู้คืนไม่ครบ หยุดก่อนชุดถัดไป กรุณาตรวจ Staging');
      part.forEach(function(w){var path=w.update.name.split('/documents/')[1],col=path.slice(0,path.lastIndexOf('/'));result.restored[col].restored++;});
    }
    if(options.restoreProperties){var props=JSON.parse(JSON.stringify(backup.scriptProperties));Object.keys(props).forEach(function(key){if(/^SYY_BACKUP_/.test(key))delete props[key];});PropertiesService.getScriptProperties().setProperties(props,false);}
    Object.keys(result.restored).forEach(function(col){clearCollectionCache_(col.split('/')[0]);});result.success=true;
  }catch(e){result.errors.push(e.message);}return result;
}
function restoreFromBackup_(fileId, restoreMode, options) {
  options=options||{};
  var result={success:false,dryRun:options.confirmRestore!==true,restored:{},errors:[]};
  try{
    var file=DriveApp.getFileById(fileId);assertPrivateBackupItem_(file);
    var bundle=JSON.parse(file.getBlob().getDataAsString());
    if(bundle.schemaVersion===3){var parents=file.getParents();if(!parents.hasNext())throw new Error('Backup manifest ไม่มีโฟลเดอร์');var run=parents.next();if(parents.hasNext()||file.getName()!=='manifest.json'||bundle.folderId!==run.getId())throw new Error('Backup manifest อยู่ผิดโฟลเดอร์');return restoreFolderBackup_(run.getId(),restoreMode,options);}
    var assets=validateBackupBundle_(bundle,options.sourceProjectId);
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
        var imageFields=mapToFirestoreFields_({Image_Url:urls[data.primaryIndex]||"",Drive_File_Id:ids[data.primaryIndex]||"",Image_Urls:urls,Drive_File_Ids:ids,Primary_Index:data.primaryIndex,Images_JSON:JSON.stringify(urls.map(function(url,i){return {url:url,fileId:ids[i]};}))});
        Object.keys(imageFields).forEach(function(key){fields[key]=imageFields[key];});
      }
      if(n==="Master_Users")fields.Session_Version={stringValue:Utilities.getUuid()};
      writes.push({update:{name:"projects/"+target+"/databases/(default)/documents/"+n+"/"+doc.id,fields:fields},currentDocument:{exists:false}});
    });});
    // Keep below Firestore's request limit even when documents contain large UTF-8 fields.
    for(var i=0;i<writes.length;){
      var part=[],bytes=13,maxBytes=8*1024*1024;
      while(i<writes.length && part.length<450){
        var writeBytes=Utilities.newBlob(JSON.stringify(writes[i])).getBytes().length;
        if(writeBytes+13>maxBytes)throw new Error("เอกสารใน Backup ใหญ่เกินขนาดคำขอกู้คืน");
        if(part.length && bytes+1+writeBytes>maxBytes)break;
        bytes+=writeBytes+(part.length?1:0);part.push(writes[i++]);
      }
      var res=UrlFetchApp.fetch(endpoint+":commit",{method:"post",headers:getAuthHeader_(),payload:JSON.stringify({writes:part}),muteHttpExceptions:true});
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
    var products = getProductCatalogRows_();
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

function getPurchaseOrderPageData_(options){
  options=options||{};if(options.poId)return {po:getPurchaseOrderById_(options.poId)};
  if(options.section!=null&&['create','history'].indexOf(options.section)<0)throw Error('ส่วนข้อมูลใบสั่งซื้อไม่ถูกต้อง');
  if(options.section==='create')return cachedReadResult_('po-create-v1',PRODUCT_CATALOG_SCOPES.concat(['Purchase_Orders']),60000,function(){return {lowStockItems:buildLowStockList_(buildVendorMap_()),pendingSummary:getPendingPurchaseOrderSummary_(),snapshotLoadedAt:Date.now()};},options.force===true);
  if(options.section==='history'&&!options.cursor&&!options.search)return cachedReadResult_('po-history-v1:'+Number(options.pageSize||50),['Purchase_Orders','Master_Vendors'],60000,function(){return getPurchaseOrderPageUncached_(options);},options.force===true);
  if(!options.cursor&&!options.search)return cachedReadResult_('po-bootstrap:'+Number(options.pageSize||50),['Purchase_Orders','Master_Products','Product_Images','Master_Vendors','Master_Brands','Master_Categories','Master_Zones','Master_Cars'],60000,function(){return getPurchaseOrderPageUncached_(options);},options.force===true);
  return getPurchaseOrderPageUncached_(options);
}
function getPurchaseOrderPageUncached_(options){
  var page=queryDocumentPage_('Purchase_Orders','Order_Date','all',options),vendors={};
  if(options.section==='history'||options.cursor||options.search){var ids=[];page.docs.forEach(function(doc){var id=parseFirestoreValue_((doc.fields||{}).Vendor_ID);if(id&&ids.indexOf(id)<0)ids.push(id);});
    readProductReferenceDocs_({Master_Vendors:ids}).Master_Vendors.forEach(function(doc){var vendor={};Object.keys(doc.fields||{}).forEach(function(key){vendor[key]=parseFirestoreValue_(doc.fields[key]);});vendors[doc.id]=vendor;});
  }else vendors=buildVendorMap_();
  var result={purchaseOrders:page.docs.map(function(doc){return purchaseOrderDto_({id:doc.name.split('/').pop(),fields:doc.fields},vendors);}),pageInfo:page.pageInfo};
  if(!options.cursor&&!options.search){if(options.section!=='history')result.lowStockItems=buildLowStockList_(vendors);result.pendingSummary=getPendingPurchaseOrderSummary_(page.pageInfo.readTime);result.snapshotLoadedAt=Date.parse(page.pageInfo.readTime)||Date.now();}return result;
}

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
    clearCollectionCache_("Purchase_Orders");
    return res.getResponseCode() === 200
      ? { success: true,  title: "สำเร็จ",       message: "อัปเดตสถานะเรียบร้อย" }
      : { success: false, title: "ล้มเหลว",       message: "ข้อมูลเปลี่ยนแปลงแล้ว หรือบันทึกไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่" };
  } catch (e) {
    clearCollectionCache_("Purchase_Orders");
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

    if (res.getResponseCode() === 200) { refreshChangedProductsCache_(list.map(function(it){return it.productCode;})); return true; }
    if (res.getResponseCode() >= 500) clearCollectionCache_('Master_Products');
    console.error("incrementProductStockBatch HTTP " + res.getResponseCode() + ": " + res.getContentText());
    return false;
  } catch (e) {
    console.error("incrementProductStockBatch error:", e);
    clearCollectionCache_('Master_Products');
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
        refreshChangedProductsCache_(stockAdditions.map(function(it){return it.productCode;}));
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
  getProductById           : "viewer",
  getProductCatalogPage    : "viewer",
  getProductCatalogFacets  : "viewer",
  getProductImageBatch     : "viewer",
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
  getStockMovementPage        : "viewer",
  getStockMovementDetail   : "staff",
  getStockIssueCorrectionHistory: "staff",
  getStockIssueCorrectionPreview: "admin",
  correctStockIssue: "admin",
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
  getBackupOverview        : "admin",
  setupBackupSchedule      : "admin",
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
  getProductById            : getProductById_,
  getProductCatalogPage     : getProductCatalogPage_,
  getProductCatalogFacets   : getProductCatalogFacets_,
  getProductImageBatch      : getProductImageBatch_,
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
  getStockMovementPage      : getStockMovementPage_,
  getStockMovementDetail    : getStockMovementDetail_,
  getStockIssueCorrectionHistory: getStockIssueCorrectionHistory_,
  getStockIssueCorrectionPreview: getStockIssueCorrectionPreview_,
  correctStockIssue: correctStockIssue_,
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
  getBackupOverview         : getBackupOverview_,
  setupBackupSchedule       : setupBackupSchedule_,
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

// Optional transport metadata preserves the legacy API result shape. Versions
// use existing Script Properties only; no Firestore revision documents/writes.
function clientReadScopes_(name,args){
  var masters=['Master_Brands','Master_Categories','Master_Vendors','Master_Zones','Master_Cars'];
  var catalog=['Master_Products'].concat(masters),images=catalog.concat(['Product_Images']);
  var scopes={getBrands:['Master_Brands'],getCategories:['Master_Categories'],getVendorsFull:['Master_Vendors'],getZonesFull:['Master_Zones'],getCarsFull:['Master_Cars'],getCustomersFull:['Master_Customers'],
    getAllMasterDropdowns:masters,getAllProducts:images,getProductCatalogPage:images,getProductCatalogFacets:catalog,getProductImageBatch:['Product_Images'],
    getDashboardBootstrap:catalog.concat(['Stock_Movements','Purchase_Orders']),
    getStockMovementPage:catalog.concat(['Stock_Movements','Purchase_Orders']),getStockMovements:catalog.concat(['Stock_Movements','Purchase_Orders']),getStockMovementDetail:catalog.concat(['Stock_Movements','Purchase_Orders']),
    getPurchaseOrderPageData:images.concat(['Purchase_Orders']),getQuotationPageData:images.concat(['Master_Customers','Quotations']),getQuotationListData:['Quotations'],
    getTaxInvoicePageData:images.concat(['Master_Customers','Master_Tax_Invoice']),getTaxInvoiceListData:['Master_Tax_Invoice']};
  var result=scopes[name]||null,o=args&&args[0];if(result&&['getAllProducts','getProductCatalogPage'].indexOf(name)>=0&&o&&(o.compact||o.includeImages===false))result=result.filter(function(x){return x!=='Product_Images';});
  if(['getQuotationPageData','getTaxInvoicePageData'].indexOf(name)>=0){o=args&&args[1]||{};validateDocumentSections_(o);if(o.deferSections)result=[name==='getQuotationPageData'?'Quotations':'Master_Tax_Invoice'];else if(o.editorOnly)result=(o.compactCatalog?catalog:images).concat(['Master_Customers']);else if(o.compactCatalog)result=result.filter(function(x){return x!=='Product_Images';});}
  if(name==='getPurchaseOrderPageData'&&o&&o.section)result=o.section==='history'?['Purchase_Orders','Master_Vendors']:catalog.concat(['Purchase_Orders']);return result;
}
function clientReadVersion_(scopes){
  var keys=scopes.map(function(name){return collectionCacheBaseKey_(name)+'__disabled';}),disabled=CacheService.getScriptCache().getAll(keys);
  if(keys.some(function(key){return disabled[key];}))throw new Error('Cache bypass');
  var props=PropertiesService.getScriptProperties().getProperties();
  return (scopes.indexOf('Stock_Movements')>=0||scopes.indexOf('Quotations')>=0?'stock-correction-v1|':'')+scopes.map(function(name){return props['cache_gen_'+name]||'0';}).join('|');
}
function clientReadExpiry_(scopes,maxAge){
  var expiry=Date.now()+maxAge;
  try{var keys=scopes.filter(function(s){return CACHEABLE_COLLECTIONS.indexOf(s)>=0;}).map(function(s){return collectionCacheBaseKey_(s)+'__manifest';}),values=CacheService.getScriptCache().getAll(keys);
    keys.forEach(function(k){if(values[k]){var m=JSON.parse(values[k]);if(Number.isFinite(m.expiresAt))expiry=Math.min(expiry,m.expiresAt);}});return expiry;
  }catch(ignored){return Date.now();}
}
function clientConditionalCursorAllowed_(name,args){
  var o=args[0];if(!o||!o.cursor)return !args.some(function(x){return x&&typeof x==='object'&&x.cursor;});
  if(args.length!==1||['getAllProducts','getProductCatalogPage'].indexOf(name)<0||name==='getAllProducts'&&!o.paged||o.cursorMode!==true)return false;
  var spec=productCatalogSpec_(o);if(spec.search||Object.keys(spec.filters).length||spec.sortCol&&spec.sortCol!=='productCode')return false;
  productBrowseContext_(o,spec,o.pageSize==null?50:Number(o.pageSize),o.page==null?1:Number(o.page));return true;
}
function apiGateway(token, fnName, args, userAgent, clientCache) {
  try {
    var timingStarted=Date.now(),session = getSession_(token, userAgent),authMs=Date.now()-timingStarted;
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

    if (!allowReadRequest_(fnName,session.username)) return {success:false,readLimited:true,retryAfterMs:10000,message:'เรียกข้อมูลถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'};

    if (args != null && !Array.isArray(args)) {
      return { success: false, message: "รูปแบบข้อมูลคำขอไม่ถูกต้อง" };
    }
    var a = args || [];

    if (fnName === "saveMasterData" && SAVE_MASTER_ALLOWED.indexOf(a[0]) === -1) {
      return { success: false, message: "ไม่อนุญาตให้บันทึกข้อมูลลงชุดข้อมูลนี้" };
    }

    var identityPositions = {resetUserPassword:1, toggleUserStatus:2, updateUserAccount:4,
      issueStock:1, receiveGoods:1, saveQuotation:1, markQuotationStockIssued:2,
      getStockIssueCorrectionPreview:1,correctStockIssue:1};
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
    var cacheScopes=clientCache&&clientCache.protocol===1?clientReadScopes_(fnName,a):null,cacheVersion=null;
    var authoritative=!!(cacheScopes&&clientCache.refresh===true),manual=!!(cacheScopes&&clientCache.manual===true&&!authoritative);
    if(authoritative){
      if(a.some(function(x){return x&&typeof x==='object'&&x.cursor;}))return {success:false,message:'กรุณาเริ่มรีเฟรชจากหน้าแรก เพื่อไม่เปลี่ยน snapshot ระหว่างแบ่งหน้า'};
      if(!allowReadRequest_('authoritativeRefresh',session.username))return {success:false,readLimited:true,retryAfterMs:60000,message:'รีเฟรชจากฐานข้อมูลได้ไม่เกิน 3 ครั้งต่อนาที กรุณารอแล้วลองใหม่ ข้อมูลเดิมยังอยู่'};
      if(cacheScopes.map(function(scope){return clearCollectionCache_(scope);}).some(function(ok){return !ok;}))return {success:false,message:'ยังรีเฟรช Cache จากฐานข้อมูลไม่ได้ กรุณาลองใหม่ ข้อมูลเดิมยังอยู่'};
    }
    executionReadContext_={collections:Object.create(null),catalog:null,refreshScopes:authoritative?cacheScopes:[]};
    if(cacheScopes)try{cacheVersion=clientReadVersion_(cacheScopes);}catch(ignored){}
    // Authorization and signed browse-cursor validation precede conditional
    // reuse. Export/document cursors and forced reads keep their ordinary path.
    var force=authoritative||a.some(function(x){return x&&typeof x==='object'&&x.force;})||a.some(function(x){return x&&typeof x==='object'&&x.cursor;})&&!clientConditionalCursorAllowed_(fnName,a);
    var maxClientAge=cacheScopes&&cacheScopes.every(function(x){return ['Master_Brands','Master_Categories','Master_Vendors','Master_Zones','Master_Cars','Master_Customers'].indexOf(x)>=0;})?300000:120000;
    var dataExpiry=cacheScopes?clientReadExpiry_(cacheScopes,maxClientAge):0;
    if(cacheVersion!==null&&!force&&dataExpiry>Date.now()&&(!manual||Number.isFinite(clientCache.expiresAt)&&clientCache.expiresAt>Date.now())&&clientCache.version===cacheVersion&&Number.isFinite(clientCache.loadedAt)&&clientCache.loadedAt<=Date.now()&&Date.now()-clientCache.loadedAt<maxClientAge){
      return {__syyCache:1,notModified:true,version:cacheVersion,scopes:cacheScopes,expiresAt:dataExpiry,timings:{authMs:authMs,operationMs:0,serverMs:Date.now()-timingStarted}};
    }
    var referenceOperations=['saveProduct','saveBrand','saveCategory','saveVendor','saveCustomer','saveZone','saveCar','saveMasterData','savePurchaseOrder','saveQuotation',
      'deleteProduct','deleteBrand','deleteCategory','deleteVendor','deleteCustomer','deleteZone','deleteCar','deletePurchaseOrder'];
    var operationStarted=Date.now(),result = referenceOperations.indexOf(fnName)>=0 ? withReferenceMutationLock_(function(){return fn.apply(null,a);}) : fn.apply(null,a),operationMs=Date.now()-operationStarted;

    logActivity_(session.username, fnName, a, result);

    if(cacheVersion!==null&&!(result&&result.success===false))try{
      if(clientReadVersion_(cacheScopes)===cacheVersion){var responseExpiry=clientReadExpiry_(cacheScopes,maxClientAge);if(result&&result.cursorMode===true&&Number.isFinite(result.cacheExpiresAt))responseExpiry=Math.min(responseExpiry,result.cacheExpiresAt);return {__syyCache:1,data:result,version:cacheVersion,scopes:cacheScopes,expiresAt:responseExpiry,timings:{authMs:authMs,operationMs:operationMs,serverMs:Date.now()-timingStarted}};}
    }catch(ignored){}
    return result;

  } catch (e) {
    console.error("apiGateway error [" + fnName + "]:", e);
    return { success: false, message: friendlyErrorMessage_(e), restartPage:e.restartPage===true };
  } finally { validatedGatewaySession_ = null; executionReadContext_ = null; }
}

// Server-side cost protection for authenticated read routes. It adds no DB writes
// and never rate-limits stock commits, permissions checks, or document saves.
function allowReadRequest_(name,username){
 var limits={authoritativeRefresh:3,getProductById:120,getProductCatalogPage:120,getProductCatalogFacets:120,getProductImageBatch:120,getDashboardBootstrap:30,getDashboardDelta:120,getStockMovementPage:120,getStockMovements:60,getStockMovementDetail:120,getStockIssueCorrectionHistory:60,getStockIssueCorrectionPreview:30,getPurchaseOrderPageData:120,getAllProducts:60};
 if(!limits[name])return true;
 var key='read_rate_'+readCacheKey_(name+':'+username),lock=LockService.getScriptLock();if(!lock.tryLock(250))return false;
 try{var props=PropertiesService.getScriptProperties(),raw=props.getProperty(key),state=raw?JSON.parse(raw):null,now=Date.now();
  if(!state||now-state.start>=60000||now<state.start)state={start:now,count:0};
  if(state.count>=limits[name])return false;state.count++;props.setProperty(key,JSON.stringify(state));return true;
 }catch(e){return false;}finally{lock.releaseLock();}
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
  var res;try{res = UrlFetchApp.fetch(url, {
    method            : "post",
    headers           : getAuthHeader_(),
    payload           : JSON.stringify({ writes: writes }),
    muteHttpExceptions: true
  });
  }catch(e){invalidateCommittedReadScopes_(writes,true);throw e;}
  if (res.getResponseCode() === 200) {invalidateCommittedReadScopes_(writes,false);return { ok: true };}
  if (res.getResponseCode() >= 500) invalidateCommittedReadScopes_(writes,true);
  console.error("fsCommit_ HTTP " + res.getResponseCode() + ": " + res.getContentText());
  return { ok: false, status:res.getResponseCode(), message: res.getContentText() };
}

function invalidateCommittedReadScopes_(writes,uncertain){
 var names={};writes.forEach(function(w){var path=w.update&&w.update.name||w.transform&&w.transform.document||w.delete||'',parts=path.split('/documents/');if(parts.length>1)names[parts[1].split('/')[0]]=true;});
 Object.keys(names).forEach(function(name){if(['Purchase_Orders','Quotations','Master_Tax_Invoice'].indexOf(name)>=0||name===STOCK_MOVEMENT_COLLECTION||uncertain&&name==='Master_Products')clearCollectionCache_(name);});
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

      var bill = prepareSalesBillNumber_(nowIso,docNo);
      var writes = bill.writes.slice();
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
              Bill_No      : { stringValue: bill.billNo },
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

      var result = {success:true,title:"สำเร็จ",message:"ตัดสต๊อกเรียบร้อย",docNo:docNo,billNo:bill.billNo,
        results:lines.map(function(l) {return {productCode:l.productCode,productName:l.productName,qty:l.qty,before:l.before,after:l.after,belowMin:l.after <= l.minStock};})};
      if (quoteDoc) writes.push({update:{name:fsDocPath_(QUOTATION_COLLECTION,d.quoteId),fields:mapToFirestoreFields_({Stock_Issued:"true",Stock_Issue_Doc:docNo,Stock_Issue_Bill_No:bill.billNo,Stock_Issued_By:user,Stock_Issued_At:nowIso})},
        updateMask:{fieldPaths:["Stock_Issued","Stock_Issue_Doc","Stock_Issue_Bill_No","Stock_Issued_By","Stock_Issued_At"]},currentDocument:{updateTime:quoteDoc.updateTime}});
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

    refreshChangedProductsCache_(lines.map(function(it){return it.productCode;}));
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
  if (committed) refreshChangedProductsCache_(list.map(function(it){return it.productCode;}));
  return committed;
}

/** Shared DTO for recent history and an individual transaction; no additional reads. */
function stockMovementDto_(document) {
  var f = document.fields || {};
  var recordedPrice = parseFirestoreValue_(f.Unit_Price);
  return {
    id          : document.name.split("/").pop(),
    docNo       : parseFirestoreValue_(f.Doc_No),
    billNo      : parseFirestoreValue_(f.Bill_No) || "",
    issueStatus : parseFirestoreValue_(f.Issue_Status) || "active",
    issueRevision: Number(parseFirestoreValue_(f.Issue_Revision)) || 0,
    reversal    : parseFirestoreValue_(f.Is_Reversal) === "true",
    replacedBy  : parseFirestoreValue_(f.Replaced_By) || "",
    correctionId: parseFirestoreValue_(f.Correction_Id) || "",
    reversesDoc : parseFirestoreValue_(f.Reverses_Doc) || "",
    replacesDoc : parseFirestoreValue_(f.Replaces_Doc) || "",
    billCountDelta: Number(parseFirestoreValue_(f.Bill_Count_Delta)) || 0,
    type        : parseFirestoreValue_(f.Type) || "OUT",
    productCode : parseFirestoreValue_(f.Product_Code),
    productName : parseFirestoreValue_(f.Product_Name),
    qty         : parseFloat(parseFirestoreValue_(f.Qty)) || 0,
    stockBefore : parseFirestoreValue_(f.Stock_Before),
    stockAfter  : parseFirestoreValue_(f.Stock_After),
    unitPrice   : parseFloat(parseFirestoreValue_(f.Unit_Price)) || 0,
    costPrice   : parseFloat(parseFirestoreValue_(f.Cost_Price)) || 0,
    hasUnitPrice: !!f.Unit_Price && recordedPrice !== "" && recordedPrice != null && isFinite(Number(recordedPrice)) && Number(recordedPrice) >= 0,
    reason      : parseFirestoreValue_(f.Reason),
    refNo       : parseFirestoreValue_(f.Ref_No),
    quoteId     : parseFirestoreValue_(f.Quote_Id),
    note        : parseFirestoreValue_(f.Note),
    user        : parseFirestoreValue_(f.User),
    timestamp   : parseFirestoreValue_(f.Timestamp)
  };
}

/** Read one transaction on demand; never group an incomplete recent-history page. */
function getStockMovementDetail_(docNo) {
  if (typeof docNo !== "string" || !docNo.trim() || docNo.length > 160 || /[\x00-\x1f\x7f]/.test(docNo)) {
    throw new Error("เลขรายการไม่ถูกต้อง");
  }
  var q = {
    from: [{ collectionId: STOCK_MOVEMENT_COLLECTION }],
    where: { fieldFilter: { field: { fieldPath: "Doc_No" }, op: "EQUAL", value: { stringValue: docNo } } },
    limit: 1001
  };
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents:runQuery";
  var res = UrlFetchApp.fetch(url, {
    method: "post", headers: getAuthHeader_(), payload: JSON.stringify({ structuredQuery: q }), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error("โหลดรายละเอียดไม่สำเร็จ (" + res.getResponseCode() + ")");
  var rows = (JSON.parse(res.getContentText()) || []).filter(function(row) { return !!row.document; });
  if (!rows.length) throw new Error("ไม่พบเลขรายการนี้ กรุณารีเฟรชประวัติแล้วลองอีกครั้ง");
  var detail={
    docNo: docNo, billNo:parseFirestoreValue_((rows[0].document.fields||{}).Bill_No)||"", complete: rows.length <= 1000,
    movements: rows.slice(0, 1000).map(function(row) { return stockMovementDto_(row.document); }).sort(function(a,b) {
      return a.id.localeCompare(b.id, "en", { numeric: true });
    })
  };
  var correctionId=detail.movements[0].correctionId;
  if(correctionId)try{var audit=readExistingDocument_(DOC_NO_RESERVATION_COLLECTION,correctionId).fields||{},before=JSON.parse(parseFirestoreValue_(audit.Before_JSON)||'[]');detail.correction={action:parseFirestoreValue_(audit.Correction_Action),reason:parseFirestoreValue_(audit.Correction_Reason),user:parseFirestoreValue_(audit.User),timestamp:parseFirestoreValue_(audit.Timestamp),previousNote:before[0]&&before[0].note||'',previousRefNo:before[0]&&before[0].refNo||''};}catch(e){detail.auditWarning='ไม่สามารถโหลดประวัติแก้ไข กรุณาลองใหม่';}
  return detail;
}

/** Recent history, newest first; productCode optionally narrows the query. */
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
    (JSON.parse(res.getContentText()) || []).forEach(function (row) {
      if (!row.document) return;
      out.push(stockMovementDto_(row.document));
    });
  } catch (e) { console.error("getStockMovements_ read failed", e); throw e; }
  return out;
}

/**
 * ★ ดึงประวัติเข้า-ออกทั้งหมด (ไม่จำกัด limit เหมือน getStockMovements) — ใช้สร้าง Dashboard สต๊อก
 * คืนค่าดิบ ให้ฝั่งหน้าเว็บไปคำนวณ KPI / กราฟ / stock health เองแบบ client-side ทั้งหมด
 * (โหลดครั้งเดียวตอนเปิดหน้า / กดรีเฟรช ไม่ต้องยิง API ซ้ำตอนสลับตัวกรอง)
 */
// Stable pages use the original readTime, including rows sharing a timestamp.
// History keeps the existing 1,000-row search scope; delta has no silent row cap.
function movementCursorSignature_(payload){
 return Utilities.base64Encode(Utilities.computeHmacSha256Signature('movement-page-v1:'+PROJECT_ID+':'+payload,getMasterKey_()));
}
function queryMovementPage_(field,from,options,cap){
 options=options||{};var size=options.pageSize==null?50:Number(options.pageSize);
 if(!Number.isInteger(size)||size<1||size>200)throw new Error('ขนาดหน้าไม่ถูกต้อง');
 var prefix=fsDocPath_(STOCK_MOVEMENT_COLLECTION,'cursor').replace(/cursor$/,''),cursor=null,offset=0;
 if(options.cursor){try{
  if(typeof options.cursor!=='string'||options.cursor.length>4096)throw new Error('invalid');
  var packed=options.cursor.split('.');if(packed.length!==2)throw new Error('invalid');
  var expected=movementCursorSignature_(packed[0]),difference=expected.length^packed[1].length;
  for(var i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^(packed[1].charCodeAt(i)||0);
  if(difference)throw new Error('invalid');
  cursor=JSON.parse(Utilities.newBlob(Utilities.base64Decode(packed[0])).getDataAsString());
  if(cursor.field!==field||cursor.from!==from||!Number.isInteger(cursor.offset)||cursor.offset<1||cap&&cursor.offset>=cap||typeof cursor.name!=='string'||!cursor.name.startsWith(prefix)||!validDocumentId_(cursor.name.slice(prefix.length))||!cursor.value||isNaN(Date.parse(cursor.value))||!cursor.readTime||isNaN(Date.parse(cursor.readTime))||Date.now()-Date.parse(cursor.readTime)>3300000||Date.parse(cursor.readTime)>Date.now()+60000)throw new Error('invalid');
  offset=cursor.offset;
 }catch(e){throw new Error('หน้าประวัติหมดอายุหรือไม่ถูกต้อง กรุณารีเฟรช');}}
 if(cap)size=Math.min(size,cap-offset);
 var q={from:[{collectionId:STOCK_MOVEMENT_COLLECTION}],orderBy:[{field:{fieldPath:field},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}],limit:size+1},body={structuredQuery:q};
 if(from)q.where={fieldFilter:{field:{fieldPath:field},op:'GREATER_THAN_OR_EQUAL',value:{timestampValue:from}}};
 if(cursor){body.readTime=cursor.readTime;var value=field==='Committed_At'?{timestampValue:cursor.value}:{stringValue:cursor.value};q.startAt={before:false,values:[value,{referenceValue:cursor.name}]};}
 var res=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:runQuery',{method:'post',headers:getAuthHeader_(),muteHttpExceptions:true,payload:JSON.stringify(body)});
 if(res.getResponseCode()!==200)throw new Error('โหลดประวัติไม่สำเร็จ กรุณาลองใหม่');
 var docs=[],readTime=cursor?cursor.readTime:'';JSON.parse(res.getContentText()).forEach(function(row){if(row.document)docs.push(row.document);if(!cursor&&row.readTime&&(!readTime||row.readTime>readTime))readTime=row.readTime;});
 if(!readTime)throw new Error('ไม่พบเวลายืนยันข้อมูลจาก Firestore');
 var more=docs.length>size;docs=docs.slice(0,size);var count=offset+docs.length,next='';
 if(more&&(!cap||count<cap)){var last=docs[docs.length-1],encoded=Utilities.base64Encode(JSON.stringify({field:field,from:from,offset:count,name:last.name,value:parseFirestoreValue_(last.fields[field]),readTime:readTime}));next=encoded+'.'+movementCursorSignature_(encoded);}
 return {docs:docs,pageInfo:{nextCursor:next,hasMore:!!next,readTime:readTime,loaded:count,scopeLimit:cap||null,scopeComplete:!next,olderAvailable:more&&!!cap&&count>=cap}};
}
function getStockMovementPage_(options){
 var page=queryMovementPage_('Timestamp','',options,1000);
 return {movements:page.docs.map(stockMovementDto_),pageInfo:page.pageInfo};
}

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
      billNo      : parseFirestoreValue_(f.Bill_No) || "",
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
    billNo      : parseFirestoreValue_(f.Bill_No) || "",
    issueStatus : parseFirestoreValue_(f.Issue_Status) || "active",
    reversal    : parseFirestoreValue_(f.Is_Reversal) === "true",
    billCountDelta: Number(parseFirestoreValue_(f.Bill_Count_Delta)) || 0,
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

function queryDashboardMovementsRange_(fromIso, toIso, committedCursor, snapshotTime) {
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
  var body={structuredQuery:q};if(snapshotTime)body.readTime=snapshotTime;
  var res=UrlFetchApp.fetch(url,{method:"post",headers:getAuthHeader_(),payload:JSON.stringify(body),muteHttpExceptions:true});
  if(res.getResponseCode()!==200) throw new Error("โหลดการเคลื่อนไหวไม่สำเร็จ กรุณาลองใหม่");
  var readTime=snapshotTime||"";
  JSON.parse(res.getContentText()).forEach(function(row) {
    if(row.readTime && (!readTime || row.readTime > readTime)) readTime=row.readTime;
    var m=mapDashboardMovementRow_(row); if(m) out.push(m);
  });
  if(!readTime) throw new Error("ไม่พบเวลายืนยันข้อมูลจาก Firestore");
  out.readTime=readTime;
  return out;
}

function buildPoVendorMapForMovements_(movements) {
  var refs=[],seen=Object.create(null);(movements||[]).forEach(function(m){if(m.type==='IN'&&m.refNo&&!seen[m.refNo]){seen[m.refNo]=true;refs.push(String(m.refNo));}});
  if(!refs.length)return {};
  refs.sort();var records=cachedReadResult_('po-costs:'+JSON.stringify(refs),['Purchase_Orders'],120000,function(){
    var out=Object.create(null);for(var i=0;i<refs.length;i+=100){
      var res=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:batchGet',{method:'post',headers:getAuthHeader_(),muteHttpExceptions:true,payload:JSON.stringify({documents:refs.slice(i,i+100).map(function(id){return fsDocPath_('Purchase_Orders',id);})})});
      if(res.getResponseCode()!==200)throw new Error('โหลดข้อมูลใบสั่งซื้อไม่สำเร็จ');
      JSON.parse(res.getContentText()).forEach(function(row){if(!row.found)return;var f=row.found.fields||{},costs=Object.create(null);
        JSON.parse(parseFirestoreValue_(f.Items_JSON)||'[]').forEach(function(it){if(it.costPrice!=null&&isFinite(Number(it.costPrice))&&Number(it.costPrice)>=0)costs[it.productCode]=Number(it.costPrice);});
        out[row.found.name.split('/').pop()]={vendorId:parseFirestoreValue_(f.Vendor_ID)||'',costs:costs};
      });
    }return out;
  });
  var vendors=buildVendorMap_(),out=Object.create(null);Object.keys(records).forEach(function(id){var record=records[id];out[id]=(vendors[record.vendorId]||{}).Vendor_name||record.vendorId;});
  movements.forEach(function(m){var record=Object.prototype.hasOwnProperty.call(records,m.refNo)?records[m.refNo]:null;if(m.type==='IN'&&record&&m.costPrice===null&&Object.prototype.hasOwnProperty.call(record.costs,m.productCode))m.costPrice=record.costs[m.productCode];});
  return out;
}

function packDashboardMovements_(movements){
  var fields=['id','docNo','billNo','issueStatus','reversal','billCountDelta','type','productCode','productName','qty','stockAfter','unitPrice','costPrice','committedAt','reason','refNo','note','user','timestamp'];
  return {movementFormat:1,fields:fields,rows:movements.map(function(m){return fields.map(function(k){return m[k];});})};
}
function dashboardCatalogVersion_(){
  try{if(CacheService.getScriptCache().get(collectionCacheBaseKey_('Master_Products')+'__disabled'))return null;
    return readCacheVersion_(PRODUCT_CATALOG_SCOPES.slice(1))+'|'+(PropertiesService.getScriptProperties().getProperty('cache_structure_products')||'0');
  }catch(ignored){return null;}
}
function getDashboardBootstrap_(options){
  options=options||{};var now=new Date(),current=Number(businessDate_().slice(0,4)),year=Number(options.year)||current;
  if(!Number.isInteger(year)||year<current-4||year>current)throw new Error('ปีไม่ถูกต้อง');
  var start=dashboardRangeStart_(year),healthStart=dashboardRangeStart_(current),end=year===current?now.toISOString():new Date(Date.UTC(year+1,0,1)-7*3600000-1).toISOString();
  var snapshot=cachedReadResult_('dashboard-correction-v1:'+current+':'+year,[STOCK_MOVEMENT_COLLECTION],60000,function(){
    var ranges=[{start:start,end:end}];
    if(year<current){if(Date.parse(end)+1>=Date.parse(healthStart))ranges[0].end=now.toISOString();else ranges.push({start:healthStart,end:now.toISOString()});}
    var movements=[],readTime='';ranges.forEach(function(range){var rows=queryDashboardMovementsRange_(range.start,range.end,false,readTime);readTime=readTime||rows.readTime;movements=movements.concat(rows);});
    return {movements:movements,serverTime:readTime,snapshotLoadedAt:Date.parse(readTime)||Date.now()};
  },options.force===true);
  var catalogVersion=dashboardCatalogVersion_(),dataVersion=null;try{dataVersion=readCacheVersion_(PRODUCT_CATALOG_SCOPES);}catch(ignored){}
  var reuse=options.compactCatalog&&clientSectionReusable_(options.catalogSection,dataVersion,PRODUCT_CATALOG_SCOPES,300000);
  var products=reuse?undefined:options.compactCatalog?packProductCatalog_(getProductCatalogRows_()):getAllProducts_();
  if(catalogVersion!==null&&catalogVersion!==dashboardCatalogVersion_())throw new Error('ข้อมูลสินค้าเปลี่ยนระหว่างโหลด กรุณาลองใหม่');
  if(dataVersion!==null&&dataVersion!==readCacheVersion_(PRODUCT_CATALOG_SCOPES))throw new Error('ข้อมูลสินค้าเปลี่ยนระหว่างโหลด กรุณาลองใหม่');
  var catalogExpiry=clientReadExpiry_(PRODUCT_CATALOG_SCOPES,300000),section=reuse?options.catalogSection:dataVersion===null?undefined:{version:dataVersion,loadedAt:Math.min(Date.now(),catalogExpiry-300000)};
  return {products:products,catalogSection:section,catalogVersion:catalogVersion,catalogExpiresAt:catalogExpiry,movements:options.compactMovements?packDashboardMovements_(snapshot.movements):snapshot.movements,poVendorMap:buildPoVendorMapForMovements_(snapshot.movements),bounded:true,year:year,rangeStart:start,healthRangeStart:healthStart,serverTime:snapshot.serverTime,snapshotLoadedAt:snapshot.snapshotLoadedAt};
}

function getDashboardDelta_(sinceIso,options) {
  var since=String(sinceIso||'').trim(),time=Date.parse(since);
  if(!since||since.length>64||isNaN(time)||time>Date.now()+60000||Date.now()-time>900000)return {success:false,fullRefresh:true,message:'กรุณาโหลดข้อมูลล่าสุดเพื่อเริ่มซิงก์ใหม่'};
  options=options||{};
  return cachedReadResult_('dashboard-delta-correction-v1:'+JSON.stringify([since,options.cursor||'',options.catalogVersion,options.catalogExpiresAt,!!options.compactCatalog]),PRODUCT_CATALOG_SCOPES.concat([STOCK_MOVEMENT_COLLECTION,'Purchase_Orders']),5000,function(){return getDashboardDeltaUncached_(since,time,options);});
}
function getDashboardDeltaUncached_(since,time,options){
  options=options||{};var page=queryMovementPage_('Committed_At',new Date(time-60000).toISOString(),{pageSize:200,cursor:options.cursor},null);
  var movements=page.docs.map(function(doc){return mapDashboardMovementRow_({document:doc});}).filter(Boolean),codes=[],seen={};
  movements.forEach(function(m){if(m.productCode&&!seen[m.productCode]){seen[m.productCode]=true;codes.push(m.productCode);}});
  if(movements.some(function(m){return m.reversal;}))return {success:true,fullRefresh:true,message:'มีการแก้บิล ต้องตรวจยอดและสถานะทั้งช่วงใหม่'};
  var stocks=getProductStockMap_(codes),productStocks=[];
  Object.keys(stocks).forEach(function(code){var x=stocks[code];productStocks.push({productCode:code,currentStock:x.stock,minStock:x.minStock,costPrice:x.costPrice,sellingPrice:x.sellingPrice});});
  var result={success:true,movements:movements,productStocks:productStocks,poVendorMap:buildPoVendorMapForMovements_(movements),serverTime:page.pageInfo.readTime,nextCursor:page.pageInfo.nextCursor,hasMore:page.pageInfo.hasMore};
  var catalogVersion=dashboardCatalogVersion_();
  if(!page.pageInfo.hasMore&&catalogVersion!==null&&Object.prototype.hasOwnProperty.call(options,'catalogVersion')&&(options.catalogVersion!==catalogVersion||Number.isFinite(options.catalogExpiresAt)&&options.catalogExpiresAt<=Date.now())){
    result.products=options.compactCatalog?packProductCatalog_(getProductCatalogRows_()):getAllProducts_();
    if(catalogVersion!==dashboardCatalogVersion_())throw new Error('ข้อมูลสินค้าเปลี่ยนระหว่างซิงก์ กรุณาลองใหม่');result.catalogVersion=catalogVersion;result.catalogExpiresAt=clientReadExpiry_(PRODUCT_CATALOG_SCOPES,300000);
  }
  return result;
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
function appendYearMeta_(id, yearBE, initialYears) {
  yearBE = Number(yearBE);
  if (!Number.isInteger(yearBE) || yearBE < 2400 || yearBE > 3000) throw new Error("ปีเอกสารไม่ถูกต้อง");
  var url = "https://firestore.googleapis.com/v1/" + fsDocPath_(META_COLLECTION, id);
  var res = UrlFetchApp.fetch(url, {method:"get",headers:getAuthHeader_(),muteHttpExceptions:true});
  if (res.getResponseCode() !== 200 && res.getResponseCode() !== 404) throw new Error("อ่านข้อมูลปีเอกสารไม่สำเร็จ");
  var emptyMetadata=res.getResponseCode()===404;
  if(res.getResponseCode()===200){var existing=parseFirestoreValue_((JSON.parse(res.getContentText()).fields||{}).Years)||[];if(!Array.isArray(existing))throw new Error("ข้อมูลปีเอกสารไม่ถูกต้อง");if(existing.map(Number).indexOf(yearBE)>=0)return;emptyMetadata=existing.length===0;}
  var result,values=[yearBE];
  if(initialYears&&emptyMetadata){var initial=initialYears();if(!Array.isArray(initial))throw new Error('ข้อมูลปีเอกสารไม่ถูกต้อง');values=Array.from(new Set(initial.concat([yearBE]).map(Number)));if(values.some(function(year){return !Number.isInteger(year)||year<2400||year>3000;}))throw new Error('ปีเอกสารไม่ถูกต้อง');}
  if (res.getResponseCode() === 404) {
    result = fsCommit_([{update:{name:fsDocPath_(META_COLLECTION,id),fields:{Years:{arrayValue:{values:values.map(function(year){return {integerValue:String(year)};})}}}},currentDocument:{exists:false}}]);
    if (result.ok) return;
    if (!isPreconditionFailure_(result.message) && !/ALREADY_EXISTS/i.test(result.message)) throw new Error(result.message);
  }
  result = fsCommit_([{transform:{document:fsDocPath_(META_COLLECTION,id),fieldTransforms:[{fieldPath:"Years",appendMissingElements:{values:values.map(function(year){return {integerValue:String(year)};})}}]},currentDocument:{exists:true}}]);
  if (!result.ok) throw new Error("บันทึกปีเอกสารไม่สำเร็จ: " + result.message);
}


function canonicalRequest_(value) {
  if (Array.isArray(value)) return value.map(canonicalRequest_);
  if (value && typeof value === "object") {
    var out = {}; Object.keys(value).sort().forEach(function(k) {if (k !== "requestId") out[k]=canonicalRequest_(value[k]);}); return out;
  }
  return value;
}
// Human-facing SI numbers never replace Doc_No, movement IDs or retry keys.
function salesBillDay_(instant) {
  if(typeof instant!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(instant)||!validDateOnly_(instant.slice(0,10)))throw new Error('วันที่ทำรายการเดิมไม่ครบ ต้องตรวจข้อมูลก่อน');
  var time=Date.parse(instant);
  if(!Number.isFinite(time))throw new Error('ไม่พบวันที่ทำรายการที่ถูกต้อง');
  return new Date(time+7*3600000).toISOString().slice(0,10).replace(/-/g,'');
}
function salesBillNumber_(day,number) {
  if(!/^\d{8}$/.test(day)||!Number.isSafeInteger(number)||number<1)throw new Error('เลขบิลไม่ถูกต้อง');
  return 'SI-'+day+'-'+String(number).padStart(4,'0');
}
function readSalesBillCounter_(day) {
  var id='SI_'+day,url='https://firestore.googleapis.com/v1/'+fsDocPath_(RUNNING_NUMBER_COLLECTION,id);
  var res=UrlFetchApp.fetch(url,{method:'get',headers:getAuthHeader_(),muteHttpExceptions:true});
  if(res.getResponseCode()===404)return {id:id,value:0,precondition:{exists:false}};
  if(res.getResponseCode()!==200)throw new Error('อ่านตัวนับเลขบิลไม่สำเร็จ');
  var doc=JSON.parse(res.getContentText()),value=parseFirestoreValue_((doc.fields||{}).Value);
  if(!doc.updateTime||typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('ตัวนับเลขบิลไม่ถูกต้อง');
  return {id:id,value:Number(value),precondition:{updateTime:doc.updateTime}};
}
function salesBillWrites_(counter,billNo,docNo) {
  var number=Number(billNo.split('-')[2]);
  return [
    {update:{name:fsDocPath_(RUNNING_NUMBER_COLLECTION,counter.id),fields:{Value:{integerValue:String(number)}}},updateMask:{fieldPaths:['Value']},currentDocument:counter.precondition},
    {update:{name:fsDocPath_(DOC_NO_RESERVATION_COLLECTION,'SI_BILL__'+billNo.replace(/-/g,'_')),fields:mapToFirestoreFields_({Doc_No:docNo,Bill_No:billNo})},currentDocument:{exists:false}}
  ];
}
function prepareSalesBillNumber_(instant,docNo) {
  var day=salesBillDay_(instant),counter=readSalesBillCounter_(day),billNo=salesBillNumber_(day,counter.value+1);
  return {billNo:billNo,writes:salesBillWrites_(counter,billNo,docNo)};
}

// Operator-only maintenance: private handlers, never registered in apiGateway,
// never run by a list read, trigger, deployment or application startup.
function inspectSalesBillBackfill_() {
  var fetched=fetchAllPagesRaw_(STOCK_MOVEMENT_COLLECTION);
  if(!fetched.ok)throw new Error('อ่านประวัติไม่ครบ ห้ามกำหนดเลขย้อนหลัง');
  var days={},invalid=[];
  fetched.docs.forEach(function(doc){var f=doc.fields||{},type=parseFirestoreValue_(f.Type);if(type!=='OUT'){if(type!=='IN')invalid.push(doc.id);return;}
    try{var no=parseFirestoreValue_(f.Doc_No);if(typeof no!=='string'||!no.trim())throw Error('missing Doc_No');var day=salesBillDay_(parseFirestoreValue_(f.Timestamp));days[day]=(days[day]||0)+1;}catch(e){invalid.push(doc.id);}
  });return {project:PROJECT_ID,days:Object.keys(days).sort().map(function(day){return {day:day,rows:days[day]};}),invalidMovementIds:invalid,readDocuments:fetched.docs.length,writes:0};
}
function planSalesBillBackfill_(day) {
  if(!/^\d{8}$/.test(String(day)))throw new Error('ระบุวันที่ YYYYMMDD');
  var date=day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8);
  if(!validDateOnly_(date))throw new Error('วันที่ไม่ถูกต้อง');
  var start=new Date(date+'T00:00:00+07:00'),end=new Date(start.getTime()+86400000),q={from:[{collectionId:STOCK_MOVEMENT_COLLECTION}],where:{compositeFilter:{op:'AND',filters:[
    {fieldFilter:{field:{fieldPath:'Timestamp'},op:'GREATER_THAN_OR_EQUAL',value:{stringValue:start.toISOString()}}},
    {fieldFilter:{field:{fieldPath:'Timestamp'},op:'LESS_THAN',value:{stringValue:end.toISOString()}}}
  ]}},orderBy:[{field:{fieldPath:'Timestamp'},direction:'ASCENDING'}],limit:10001};
  var res=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:runQuery',{method:'post',headers:getAuthHeader_(),payload:JSON.stringify({structuredQuery:q}),muteHttpExceptions:true});
  if(res.getResponseCode()!==200)throw new Error('อ่านประวัติสำหรับแผนย้อนหลังไม่สำเร็จ');
  var documents=JSON.parse(res.getContentText()).filter(function(r){return !!r.document;}).map(function(r){return r.document;});
  if(documents.length>10000)throw new Error('เกิน 10,000 บรรทัดต่อวัน ต้องจัดแผนเป็นช่วงย่อยก่อน');
  var groups=Object.create(null),used=Object.create(null),max=0;
  documents.forEach(function(doc){var f=doc.fields||{},type=parseFirestoreValue_(f.Type);if(type==='IN')return;if(type!=='OUT')throw Error('ประเภทประวัติไม่ถูกต้อง ต้องตรวจข้อมูลก่อน');var no=parseFirestoreValue_(f.Doc_No);
    if(typeof no!=='string'||!no||!doc.updateTime)throw Error('ข้อมูลเดิมไม่ครบ ห้ามกำหนดเลขอัตโนมัติ');
    var group=groups[no]||(groups[no]={docNo:no,timestamp:parseFirestoreValue_(f.Timestamp),rows:[],numbers:[]});
    group.rows.push({id:doc.name.split('/').pop(),updateTime:doc.updateTime});group.numbers.push(parseFirestoreValue_(f.Bill_No)||'');
  });
  var pending=[],assigned=0;
  Object.keys(groups).forEach(function(no){var g=groups[no],numbers=g.numbers.filter(Boolean);
    if(numbers.length){var bill=numbers[0],match=/^SI-(\d{8})-(\d{4,})$/.exec(bill);
      if(numbers.length!==g.rows.length||numbers.some(function(n){return n!==bill;})||!match||match[1]!==day||salesBillNumber_(day,Number(match[2]))!==bill||used[bill])throw Error('เลขบิลเดิมซ้ำหรือไม่ครบ ต้องตรวจด้วยมือ');
      used[bill]=no;max=Math.max(max,Number(match[2]));assigned++;return;
    }pending.push(g);
  });
  var counter=readSalesBillCounter_(day);
  if(counter.value<max)throw Error('ตัวนับต่ำกว่าเลขที่ใช้แล้ว ต้องตรวจตัวนับก่อน');
  pending.sort(function(a,b){return a.timestamp.localeCompare(b.timestamp)||a.docNo.localeCompare(b.docNo);});
  // At most 20 complete bills per approved batch; re-plan remaining bills.
  var entries=pending.slice(0,20).map(function(g,i){
    var all=queryByEqualityField_(STOCK_MOVEMENT_COLLECTION,'Doc_No',g.docNo,1001);
    if(all.length!==g.rows.length||all.some(function(row){return parseFirestoreValue_(row.fields.Type)!=='OUT'||salesBillDay_(parseFirestoreValue_(row.fields.Timestamp))!==day||parseFirestoreValue_(row.fields.Bill_No);}))throw Error('บิลมีข้อมูลข้ามวันหรือเปลี่ยนระหว่างวางแผน');
    var quotes=queryByEqualityField_(QUOTATION_COLLECTION,'Stock_Issue_Doc',g.docNo,451);
    if(g.rows.length+quotes.length+2>450||quotes.some(function(row){return !row.updateTime||!!parseFirestoreValue_(row.fields.Stock_Issue_Bill_No);}))throw Error('บิลใหญ่เกินขอบเขตหรือเลขอ้างอิงไม่ตรง ต้องตรวจด้วยมือ');
    return {docNo:g.docNo,billNo:salesBillNumber_(day,counter.value+i+1),rows:g.rows,quotes:quotes.map(function(row){return {id:row.id,updateTime:row.updateTime};})};
  });
  var plan={project:PROJECT_ID,day:day,counter:counter,entries:entries,remaining:Math.max(0,pending.length-entries.length),alreadyAssigned:assigned};
  plan.planHash=hashPassword_(JSON.stringify(plan),PROJECT_ID+':sales-bill-backfill-v1');return plan;
}
function applySalesBillBackfill_(day,approvedPlanHash) {
  var plan=planSalesBillBackfill_(day);
  if(!approvedPlanHash||plan.planHash!==approvedPlanHash)throw Error('แผนไม่ตรงกับที่อนุมัติ ต้องตรวจแผนใหม่ก่อน');
  var completed=[],started=Date.now(),problem='',attempted=false;
  for(var i=0;i<plan.entries.length;i++){
    var entry=plan.entries[i];
    try{
      if(Date.now()-started>180000)throw Error('พักงานก่อนหมดเวลา ต้องวางแผนส่วนที่เหลือใหม่');
      var prepared=prepareSalesBillNumber_(day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8)+'T12:00:00+07:00',entry.docNo);
      if(prepared.billNo!==entry.billNo)throw Error('ตัวนับเปลี่ยน ต้องวางแผนใหม่');
      var writes=prepared.writes.slice();
      // Empty transforms preserve the original Committed_At, including legacy absence.
      entry.rows.forEach(function(row){writes.push({update:{name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,row.id),fields:{Bill_No:{stringValue:entry.billNo}}},updateMask:{fieldPaths:['Bill_No']},updateTransforms:[],currentDocument:{updateTime:row.updateTime}});});
      entry.quotes.forEach(function(row){writes.push({update:{name:fsDocPath_(QUOTATION_COLLECTION,row.id),fields:{Stock_Issue_Bill_No:{stringValue:entry.billNo}}},updateMask:{fieldPaths:['Stock_Issue_Bill_No']},currentDocument:{updateTime:row.updateTime}});});
      attempted=true;var commit=fsCommit_(writes);if(!commit.ok)throw Error('ข้อมูลเปลี่ยนหรือบันทึกไม่สำเร็จ ต้องตรวจแผนใหม่');
      completed.push({docNo:entry.docNo,billNo:entry.billNo});
    }catch(e){problem=e.message;break;}
  }
  if(attempted){clearCollectionCache_(STOCK_MOVEMENT_COLLECTION);clearCollectionCache_(QUOTATION_COLLECTION);}
  return {complete:!problem&&plan.remaining===0,completed:completed,remaining:plan.remaining+plan.entries.length-completed.length,message:problem||'',requiresNewPlan:!!problem||plan.remaining>0};
}
// Correction audit/receipts reuse the existing reservation collection. No read
// path or deployment runs this worker. Original quantities, prices and IDs stay.
function stockCorrectionDraft_(input,user) {
  var session=validatedGatewaySession_&&validatedGatewaySession_.session;
  if(!session||session.role!=='admin'||session.username!==user)throw Error('อนุญาตเฉพาะ Admin');
  input=input||{};
  if(typeof input.docNo!=='string'||!input.docNo||input.docNo.length>160||/[\x00-\x1f\x7f]/.test(input.docNo))throw Error('เลขรายการไม่ถูกต้อง');
  if(!/^[A-Za-z0-9-]{8,80}$/.test(String(input.requestId||'')))throw Error('รหัสคำขอไม่ถูกต้อง');
  if(['amend','replace','cancel'].indexOf(input.action)<0)throw Error('เลือกการแก้ไขที่ถูกต้อง');
  if(!Number.isInteger(input.revision)||input.revision<0)throw Error('รุ่นรายการไม่ถูกต้อง');
  var reason=String(input.correctionReason||'').trim();
  if(reason.length<5||reason.length>1000)throw Error('ระบุเหตุผลการแก้ไขอย่างน้อย 5 ตัวอักษร');
  var draft={docNo:input.docNo,requestId:String(input.requestId),revision:input.revision,action:input.action,correctionReason:reason,
    refNo:String(input.refNo||''),note:String(input.note||''),reason:String(input.reason||''),items:[]};
  if(draft.refNo.length>500||draft.note.length>4000)throw Error('ข้อความยาวเกินขอบเขต');
  if(draft.action==='replace'){
    if(ISSUE_REASONS.indexOf(draft.reason)<0||!Array.isArray(input.items)||!input.items.length||input.items.length>200)throw Error('ตรวจเหตุผลและรายการสินค้าทดแทน');
    var seen=Object.create(null);
    draft.items=input.items.map(function(item){
      if(!item||!validDocumentId_(item.productCode)||seen[item.productCode]||!validBusinessNumber_(item.qty,0,true)||!validBusinessNumber_(item.unitPrice,0,false))throw Error('รหัสสินค้าซ้ำ จำนวนหรือราคาไม่ถูกต้อง');
      seen[item.productCode]=true;return {productCode:item.productCode,qty:Number(item.qty),unitPrice:Number(item.unitPrice)};
    }).sort(function(a,b){return a.productCode.localeCompare(b.productCode);});
  }
  return draft;
}
function stockCorrectionReceipt_(draft,user) {
  var id='SC_'+draft.requestId,fingerprint=movementCursorSignature_('stock-correction:'+user+':'+JSON.stringify(draft));
  var url='https://firestore.googleapis.com/v1/'+fsDocPath_(DOC_NO_RESERVATION_COLLECTION,id);
  var res=UrlFetchApp.fetch(url,{method:'get',headers:getAuthHeader_(),muteHttpExceptions:true});
  if(res.getResponseCode()===404)return {id:id,fingerprint:fingerprint};
  if(res.getResponseCode()!==200)throw Error('ตรวจผลคำขอแก้ไขเดิมไม่สำเร็จ');
  var f=JSON.parse(res.getContentText()).fields||{};
  if(parseFirestoreValue_(f.Request_Fingerprint)!==fingerprint)throw Error('รหัสคำขอนี้ใช้กับการแก้ไขอื่นแล้ว');
  var result=JSON.parse(parseFirestoreValue_(f.Request_Result_JSON));result.replayed=true;
  try{var stocks=getProductStockMap_((result.productStocks||[]).map(function(p){return p.productCode;}));result.productStocks=Object.keys(stocks).map(function(code){return {productCode:code,currentStock:stocks[code].stock};});}catch(e){result.refreshWarning='บันทึกแล้ว แต่ตรวจยอดล่าสุดไม่สำเร็จ';result.productStocks=[];}
  return {id:id,fingerprint:fingerprint,result:result};
}
function buildStockCorrection_(draft,user) {
  var docs=queryByEqualityField_(STOCK_MOVEMENT_COLLECTION,'Doc_No',draft.docNo,201);
  if(!docs.length||docs.length>200)throw Error('ไม่พบบิลหรือเกิน 200 บรรทัด กรุณาตรวจข้อมูลกับผู้ดูแล');
  docs.sort(function(a,b){return a.id.localeCompare(b.id,'en',{numeric:true});});
  var original=docs.map(function(doc){return stockMovementDto_({name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,doc.id),fields:doc.fields});});
  var revision=original[0].issueRevision;
  if(revision!==draft.revision)throw Error('บิลเปลี่ยนแปลงแล้ว กรุณาเปิดรายละเอียดใหม่');
  if(original.some(function(m){return m.type!=='OUT'||m.reversal||m.issueStatus!=='active'||m.issueRevision!==revision||!validBusinessNumber_(m.qty,0,true)||!validDocumentId_(m.productCode)||m.reason!==original[0].reason||ISSUE_REASONS.indexOf(m.reason)<0;})||docs.some(function(d){return !d.updateTime;}))throw Error('รายการนี้ถูกยกเลิก/แทนที่ หรือข้อมูลเดิมไม่ครบ');
  if(original.some(function(m,i){var raw=parseFirestoreValue_(docs[i].fields.Qty);return !validBusinessNumber_(raw,0,true)||Number(raw)!==m.qty;}))throw Error('จำนวนสินค้าเดิมไม่ถูกต้อง ต้องตรวจข้อมูลก่อนแก้ไข');
  if(draft.action!=='amend'&&original.some(function(m,i){var f=docs[i].fields,price=parseFirestoreValue_(f.Unit_Price),cost=parseFirestoreValue_(f.Cost_Price);return !m.hasUnitPrice||!validBusinessNumber_(price,0,false)||Number(price)!==m.unitPrice||!validBusinessNumber_(cost,0,false)||Number(cost)!==m.costPrice;}))throw Error('ข้อมูลราคาหรือทุนเดิมไม่ครบ ต้องตรวจข้อมูลก่อนย้อนรายการ');
  var codes=original.map(function(m){return m.productCode;}).concat(draft.items.map(function(m){return m.productCode;}));
  codes=Array.from(new Set(codes));var stocks=draft.action==='amend'?{}:getProductStockMap_(codes),changes=[];
  if(draft.action!=='amend')codes.forEach(function(code){
    var p=stocks[code];if(!p||!p.updateTime)throw Error('ไม่พบสินค้า '+code);
    var returned=original.filter(function(m){return m.productCode===code;}).reduce(function(n,m){return n+m.qty;},0),next=draft.items.find(function(m){return m.productCode===code;}),delta=returned-(next?next.qty:0),after=p.stock+delta;
    if(!validBusinessNumber_(p.stock,-Number.MAX_SAFE_INTEGER,false)||!Number.isFinite(delta)||Math.abs(after)>Number.MAX_SAFE_INTEGER)throw Error('ยอดสต๊อกไม่ถูกต้องสำหรับสินค้า '+code);
    if(delta<0&&after<0)throw Error('สต๊อกไม่พอสำหรับสินค้า '+code);
    changes.push({productCode:code,productName:p.name,before:p.stock,delta:delta,after:after,updateTime:p.updateTime});
  });
  if(draft.action!=='amend'){
    [original,draft.items].forEach(function(items){var total=0;items.forEach(function(m){total+=m.qty*m.unitPrice;if(!Number.isFinite(total)||total>Number.MAX_SAFE_INTEGER)throw Error('มูลค่าบิลเกินขอบเขตที่รองรับ');});});
    codes.forEach(function(code){var costs=original.filter(function(m){return m.productCode===code;}).map(function(m){return m.costPrice;});if(costs.some(function(cost){return cost!==costs[0];}))throw Error('สินค้าเดียวกันมีทุนเดิมหลายราคา ต้องตรวจข้อมูลก่อนแก้ไข');});
  }
  // Full reversal/replacement is intentionally bounded to one atomic commit.
  var writeCount=docs.length+1+(draft.action==='amend'?0:original.length+changes.filter(function(x){return x.delta!==0;}).length+draft.items.length+(draft.action==='replace'?2:0));
  if(writeCount+1>450)throw Error('บิลนี้ใหญ่เกินขอบเขตแก้ไขแบบ atomic กรุณาติดต่อผู้ดูแล');
  var quoteIds=Array.from(new Set(original.map(function(m){return m.quoteId;}).filter(Boolean)));
  if(quoteIds.length>1)throw Error('บิลเชื่อมหลายใบเสนอราคา ต้องตรวจด้วยมือ');
  var quote=null;
  if(quoteIds.length){var id=quoteIds[0],raw=readExistingDocument_(QUOTATION_COLLECTION,id);if(!raw.updateTime)throw Error('ไม่พบใบเสนอราคาอ้างอิง');quote={id:id,doc:raw};}
  var token=movementCursorSignature_('correction-preview:'+user+':'+JSON.stringify([draft,docs.map(function(d){return [d.id,d.updateTime];}),changes,quote&&quote.doc.updateTime]));
  return {docs:docs,original:original,revision:revision,stocks:stocks,changes:changes,quote:quote,previewToken:token};
}
function getStockIssueCorrectionPreview_(input,user) {
  var draft=stockCorrectionDraft_(input,user),plan=buildStockCorrection_(draft,user);
  return {success:true,previewToken:plan.previewToken,billNo:plan.original[0].billNo||draft.docNo,revision:plan.revision,changes:plan.changes,
    oldAmount:plan.original.reduce(function(n,m){return n+m.qty*m.unitPrice;},0),newAmount:draft.items.reduce(function(n,m){return n+m.qty*m.unitPrice;},0),
    warning:'ใบกำกับภาษีเป็นเอกสารอิสระ ต้องตรวจเอกสารที่เกี่ยวข้องแยกต่างหาก; ยอดปรับปรุงบันทึกในวันที่แก้จริง'};
}
// Explicit audit drilldown: at most five linked receipt reads per page. The
// cursor is bound to the current bill revision; no history/collection scan.
function getStockIssueCorrectionHistory_(docNo,options){
  if(typeof docNo!=='string'||!docNo||docNo.length>160)throw Error('เลขรายการไม่ถูกต้อง');options=options||{};
  var docs=queryByEqualityField_(STOCK_MOVEMENT_COLLECTION,'Doc_No',docNo,1),head=docs.length&&parseFirestoreValue_(docs[0].fields.Correction_Id)||'',next=head,seen=[],rows=[],expires=Date.now()+180000;
  if(options.cursor)try{if(typeof options.cursor!=='string'||options.cursor.length>16384)throw Error('invalid');var packed=options.cursor.split('.');if(packed.length!==2||movementCursorSignature_('audit:'+packed[0])!==packed[1])throw Error('invalid');var c=JSON.parse(Utilities.newBlob(Utilities.base64Decode(packed[0])).getDataAsString());if(c.docNo!==docNo||c.head!==head||c.expires<=Date.now()||!Array.isArray(c.seen)||c.seen.length>100)throw Error('invalid');next=c.next;seen=c.seen;expires=c.expires;}catch(e){throw Error('ประวัติเปลี่ยนหรือหน้าหมดอายุ กรุณาเปิดรายละเอียดใหม่');}
  for(var i=0;next&&i<5;i++){
    if(!/^SC_[A-Za-z0-9-]{8,80}$/.test(next)||seen.indexOf(next)>=0||seen.length>=100)throw Error('สายประวัติไม่สมบูรณ์ กรุณาติดต่อผู้ดูแล');seen.push(next);
    var f=readExistingDocument_(DOC_NO_RESERVATION_COLLECTION,next).fields||{},before=JSON.parse(parseFirestoreValue_(f.Before_JSON)||'[]'),after=JSON.parse(parseFirestoreValue_(f.After_JSON)||'{}'),result=JSON.parse(parseFirestoreValue_(f.Request_Result_JSON)||'{}');
    rows.push({action:parseFirestoreValue_(f.Correction_Action),reason:parseFirestoreValue_(f.Correction_Reason),user:parseFirestoreValue_(f.User),timestamp:parseFirestoreValue_(f.Timestamp),sourceDocNo:parseFirestoreValue_(f.Doc_No),replacementDocNo:result.replacementDocNo||'',replacementBillNo:result.replacementBillNo||'',previousNote:before[0]&&before[0].note||'',previousRefNo:before[0]&&before[0].refNo||'',note:after.note||'',refNo:after.refNo||''});
    next=before[0]&&before[0].docNo===docNo&&before[0].correctionId||'';
  }
  var cursor='';if(next){var payload=Utilities.base64Encode(Utilities.newBlob(JSON.stringify({docNo:docNo,head:head,next:next,seen:seen,expires:expires})).getBytes());cursor=payload+'.'+movementCursorSignature_('audit:'+payload);}
  return {entries:rows,nextCursor:cursor};
}
function correctStockIssue_(input,user) {
  var attempted=false;
  try{
    var draft=stockCorrectionDraft_(input,user),receipt=stockCorrectionReceipt_(draft,user);
    if(receipt.result)return receipt.result;
    var plan=buildStockCorrection_(draft,user);
    if(!input.previewToken||input.previewToken!==plan.previewToken)throw Error('ข้อมูลหรือสต๊อกเปลี่ยน กรุณาตรวจตัวอย่างใหม่ก่อนยืนยัน');
    var now=new Date().toISOString(),newNo=draft.action==='replace'?'SI-C'+draft.requestId:'',bill=draft.action==='replace'?prepareSalesBillNumber_(now,newNo):null;
    var writes=bill?bill.writes.slice():[],status=draft.action==='amend'?'active':draft.action==='cancel'?'cancelled':'replaced',revision=plan.revision+1;
    plan.docs.forEach(function(doc){
      var fields={Issue_Revision:revision,Issue_Status:status,Correction_Id:receipt.id};
      if(newNo)fields.Replaced_By=newNo;
      if(draft.action==='amend'){fields.Ref_No=draft.refNo;fields.Note=draft.note;}
      writes.push({update:{name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,doc.id),fields:mapToFirestoreFields_(fields)},updateMask:{fieldPaths:Object.keys(fields)},updateTransforms:[],currentDocument:{updateTime:doc.updateTime}});
    });
    if(draft.action!=='amend'){
      plan.changes.filter(function(x){return x.delta!==0;}).forEach(function(x){writes.push({transform:{document:fsDocPath_('Master_Products',x.productCode),fieldTransforms:[{fieldPath:'Current_Stock',increment:{doubleValue:x.delta}}]},currentDocument:{updateTime:x.updateTime}});});
      // Negative OUT is an accounting reversal, never a PO receipt. A distinct
      // Doc_No preserves drilldown identity; Bill_Count_Delta nets the count.
      plan.original.forEach(function(m,i){var x=plan.changes.find(function(c){return c.productCode===m.productCode;});
        writes.push({update:{name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,receipt.id+'-'+(i+1)),fields:mapToFirestoreFields_({Doc_No:'SC-'+draft.requestId,Bill_No:m.billNo,Type:'OUT',Is_Reversal:'true',Reverses_Doc:draft.docNo,
          Product_Code:m.productCode,Product_Name:m.productName,Qty:-m.qty,Unit_Price:m.unitPrice,Cost_Price:m.costPrice,Stock_Before:x.before,Stock_After:x.after,
          Reason:m.reason,Ref_No:m.refNo,Note:draft.correctionReason,User:user,Timestamp:now,Correction_Id:receipt.id,Bill_Count_Delta:i===0?-1:0})},currentDocument:{exists:false}});
      });
      draft.items.forEach(function(item,i){var p=plan.stocks[item.productCode],old=plan.original.find(function(m){return m.productCode===item.productCode;}),x=plan.changes.find(function(c){return c.productCode===item.productCode;});
        writes.push({update:{name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,newNo+'-'+(i+1)),fields:mapToFirestoreFields_({Doc_No:newNo,Bill_No:bill.billNo,Type:'OUT',Product_Code:item.productCode,Product_Name:p.name,Qty:item.qty,
          Unit_Price:item.unitPrice,Cost_Price:old?old.costPrice:p.costPrice,Stock_Before:x.before,Stock_After:x.after,Reason:draft.reason,Ref_No:draft.refNo,Note:draft.note,Quote_Id:plan.quote?plan.quote.id:'',User:user,Timestamp:now,Replaces_Doc:draft.docNo,Correction_Id:receipt.id})},currentDocument:{exists:false}});
      });
    }
    if(plan.quote&&draft.action!=='amend'){
      var other=queryByEqualityField_(STOCK_MOVEMENT_COLLECTION,'Quote_Id',plan.quote.id,1001);
      if(other.length>1000)throw Error('ประวัติใบเสนอราคายาวเกินขอบเขต กรุณาตรวจด้วยมือ');
      var active=other.filter(function(d){var m=stockMovementDto_({name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,d.id),fields:d.fields});return m.docNo!==draft.docNo&&m.type==='OUT'&&!m.reversal&&m.issueStatus==='active';});
      active.sort(function(a,b){return String(parseFirestoreValue_(a.fields.Timestamp)||'').localeCompare(String(parseFirestoreValue_(b.fields.Timestamp)||''))||a.id.localeCompare(b.id);});
      var marker=parseFirestoreValue_(plan.quote.doc.fields.Stock_Issue_Doc),chosen=active.find(function(d){return parseFirestoreValue_(d.fields.Doc_No)===marker;})||active[active.length-1];
      var target=newNo||chosen&&parseFirestoreValue_(chosen.fields.Doc_No)||'',label=bill?bill.billNo:chosen&&parseFirestoreValue_(chosen.fields.Bill_No)||'';
      writes.push({update:{name:fsDocPath_(QUOTATION_COLLECTION,plan.quote.id),fields:mapToFirestoreFields_({Stock_Issued:target?'true':'false',Stock_Issue_Doc:target,Stock_Issue_Bill_No:label,Stock_Issued_By:user,Stock_Issued_At:now})},updateMask:{fieldPaths:['Stock_Issued','Stock_Issue_Doc','Stock_Issue_Bill_No','Stock_Issued_By','Stock_Issued_At']},currentDocument:{updateTime:plan.quote.doc.updateTime}});
    }
    var result={success:true,docNo:draft.docNo,action:draft.action,revision:revision,replacementDocNo:newNo,replacementBillNo:bill?bill.billNo:'',productStocks:plan.changes.map(function(x){return {productCode:x.productCode,currentStock:x.after};})};
    writes.push({update:{name:fsDocPath_(DOC_NO_RESERVATION_COLLECTION,receipt.id),fields:mapToFirestoreFields_({Doc_No:draft.docNo,Correction_Action:draft.action,Correction_Reason:draft.correctionReason,User:user,Timestamp:now,
      Before_JSON:JSON.stringify(plan.original),After_JSON:JSON.stringify(draft),Request_Fingerprint:receipt.fingerprint,Request_Result_JSON:JSON.stringify(result)})},currentDocument:{exists:false}});
    if(writes.length>450||Utilities.newBlob(JSON.stringify(writes)).getBytes().length>8*1024*1024||writes.some(function(w){return w.update&&Utilities.newBlob(JSON.stringify(w.update)).getBytes().length>900000;}))throw Error('รายการใหญ่เกินขอบเขต atomic');
    attempted=true;var commit=fsCommit_(writes);
    if(!commit.ok){if(commit.status>=400&&commit.status<500)attempted=false;var replay=stockCorrectionReceipt_(draft,user);if(replay.result)return replay.result;throw Error('ข้อมูลเปลี่ยนระหว่างบันทึก กรุณาตรวจผลและตัวอย่างใหม่');}
    if(plan.changes.length)refreshChangedProductsCache_(plan.changes.map(function(x){return x.productCode;}));
    return result;
  }catch(e){return {success:false,uncertain:attempted,message:e.message};}
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
  result.billNo = result.billNo || parseFirestoreValue_(f.Bill_No) || "";
  result.issueStatus=parseFirestoreValue_(f.Issue_Status)||'active';if(result.issueStatus!=='active')result.refreshWarning='รายการเดิมถูกยกเลิกหรือแทนที่แล้ว ไม่มีการตัดสต๊อกซ้ำ';
  result.replayed = true;
  clearCollectionCache_("Master_Products");clearCollectionCache_("Purchase_Orders");clearCollectionCache_(STOCK_MOVEMENT_COLLECTION);
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
    var docs=bundle.collections[n],seen=Object.create(null);
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
function hasNormalizedDuplicate_(collection,field,value,docId,memo) {
  var key=normalizedDuplicateKey_(value);if(!key)return false;
  // Equality query must succeed even when a cache exists. The legacy scan covers case/space variants.
  if(queryByEqualityField_(collection,field,String(value).trim()).some(function(d){return d.id!==docId;}))return true;
  var generation=collectionGeneration_(collection),docs=memo&&memo.generation===generation?memo.docs:null;
  if(!docs){docs=fetchCollectionDocsCached_(collection);if(memo){memo.generation=generation;memo.docs=docs;}}
  return docs.some(function(d){return d.id!==docId && normalizedDuplicateKey_(parseFirestoreValue_((d.fields||{})[field]))===key;});
}



function businessDate_(instant) {return new Date((instant?new Date(instant):new Date()).getTime()+7*3600000).toISOString().slice(0,10);}
function addCalendarDays_(value,days) {
  if(!validDateOnly_(value) || !Number.isInteger(Number(days)))throw new Error('วันที่หรือจำนวนวันไม่ถูกต้อง');
  var date=new Date(value+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+Number(days));return date.toISOString().slice(0,10);
}
function backupScriptProperties_() {
  var props=PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).forEach(function(key){if(/^(cache_gen_|cache_structure_|auth_rate_|read_rate_|SYY_BACKUP_)/.test(key))delete props[key];});return props;
}
function documentReferenceExists_(collection,field,id,operator) {return queryByEqualityField_(collection,field,id,1,operator).length>0;}
function assertDeleteAllowed_(collection,id,document) {
  var f=document.fields||{},productFields={Master_Brands:'Brand_ID',Master_Categories:'Category_ID',Master_Vendors:'Default_Vendor_ID',Master_Zones:'Zone_ID'};
  function blocked(){throw new Error('ข้อมูลนี้ถูกอ้างอิงหรือมีประวัติธุรกรรม ไม่สามารถลบได้ กรุณาปิดใช้งานหรือเก็บไว้เป็นประวัติ');}
  if(productFields[collection] && documentReferenceExists_('Master_Products',productFields[collection],id))blocked();
  if(collection==='Master_Vendors' && documentReferenceExists_('Purchase_Orders','Vendor_ID',id))blocked();
  if(collection==='Master_Customers' && documentReferenceExists_(QUOTATION_COLLECTION,'Customer_ID',id))blocked();
  if(collection==='Master_Cars'){
    if(documentReferenceExists_('Master_Products','Car_ID',id)||documentReferenceExists_('Master_Products','Car_IDs',id,'ARRAY_CONTAINS'))blocked();
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
  options=options||{};
  var year=yearFilter==='all'?'all':String(parseInt(yearFilter,10)||Number(businessDate_().slice(0,4))+543);
  if(year!=='all'&&(!/^\d{4}$/.test(year)||Number(year)<2400||Number(year)>3000))throw new Error('ปีไม่ถูกต้อง');
  var size=Number(options.pageSize||50);if(!Number.isInteger(size)||size<1||size>200)throw new Error('ขนาดหน้าไม่ถูกต้อง');
  var search=options.search||{},number=String(search.number||'').trim(),from=String(search.from||''),to=String(search.to||'');
  if(number.length>120||/[\x00-\x1f]/.test(number))throw new Error('เลขเอกสารไม่ถูกต้อง');
  [from,to].forEach(function(value){if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||isNaN(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value))throw new Error('วันที่ไม่ถูกต้อง');});
  if(from&&to&&from>to)throw new Error('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
  var low=from,high=to;
  if(year!=='all'){var y=Number(year)-543;low=low&&low>y+'-01-01'?low:y+'-01-01';high=high&&high<y+'-12-31'?high:y+'-12-31';}
  var criteria=JSON.stringify({number:number,from:from,to:to}),prefix='projects/'+PROJECT_ID+'/databases/(default)/documents/'+collection+'/';
  // Exact numbers use their existing single-field index; date-only searches use the existing date index.
  // Applying dates to bounded exact-number pages avoids requiring a new composite index or backfill.
  var numberField={Master_Tax_Invoice:'Invoice_No',Quotations:'Quote_No',Purchase_Orders:'__name__'}[collection];
  var q={from:[{collectionId:collection}],orderBy:number?[{field:{fieldPath:'__name__'},direction:'ASCENDING'}]:[{field:{fieldPath:dateField},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}],limit:size+1},body={structuredQuery:q};
  if(number){if(!numberField)throw new Error('ไม่รองรับการค้นหาเลขเอกสาร');if(numberField==='__name__'&&number.indexOf('/')>=0)throw new Error('เลขใบสั่งซื้อไม่ถูกต้อง');q.where={fieldFilter:{field:{fieldPath:numberField},op:'EQUAL',value:numberField==='__name__'?{referenceValue:prefix+number}:{stringValue:number}}};}
  else {var filters=[];if(low)filters.push({fieldFilter:{field:{fieldPath:dateField},op:'GREATER_THAN_OR_EQUAL',value:{stringValue:low}}});if(high)filters.push({fieldFilter:{field:{fieldPath:dateField},op:'LESS_THAN_OR_EQUAL',value:{stringValue:high}}});if(filters.length)q.where=filters.length===1?filters[0]:{compositeFilter:{op:'AND',filters:filters}};}
  if(options.cursor){try{
    var cursor=JSON.parse(Utilities.newBlob(Utilities.base64Decode(String(options.cursor))).getDataAsString());
    if(cursor.collection!==collection||cursor.year!==year||(cursor.criteria||JSON.stringify({number:'',from:'',to:''}))!==criteria||!/^\d{4}-\d{2}-\d{2}$/.test(cursor.date)||typeof cursor.name!=='string'||cursor.name.indexOf(prefix)!==0||cursor.name.slice(prefix.length).indexOf('/')>=0||!cursor.readTime||isNaN(Date.parse(cursor.readTime))||Date.now()-Date.parse(cursor.readTime)>3300000||Date.parse(cursor.readTime)>Date.now()+60000)throw new Error('invalid');
    body.readTime=cursor.readTime;q.startAt={before:false,values:number?[{referenceValue:cursor.name}]:[{stringValue:cursor.date},{referenceValue:cursor.name}]};
  }catch(e){throw new Error('หน้าข้อมูลหมดอายุหรือไม่ถูกต้อง กรุณาค้นหาใหม่หรือรีเฟรชรายการ');}}
  var res=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:runQuery',{method:'post',headers:getAuthHeader_(),payload:JSON.stringify(body),muteHttpExceptions:true});
  if(res.getResponseCode()!==200)throw new Error('โหลดหน้าข้อมูลไม่สำเร็จ กรุณาลองใหม่หรือรีเฟรชรายการ');
  var rows=JSON.parse(res.getContentText()),docs=[],readTime=body.readTime||'';
  rows.forEach(function(row){if(row.document)docs.push(row.document);if(!readTime&&row.readTime)readTime=row.readTime;});
  var more=docs.length>size;docs=docs.slice(0,size);var next='';
  if(more){if(!readTime)throw new Error('ไม่พบเวลายืนยันหน้าข้อมูล');var last=docs[docs.length-1];next=Utilities.base64Encode(JSON.stringify({collection:collection,year:year,criteria:criteria,date:parseFirestoreValue_(last.fields[dateField]),name:last.name,readTime:readTime}));}
  if(number)docs=docs.filter(function(doc){var date=parseFirestoreValue_(doc.fields[dateField]);return (!low||date>=low)&&(!high||date<=high);});
  return {docs:docs,pageInfo:{hasMore:more,nextCursor:next,readTime:readTime,year:year,search:{number:number,from:from,to:to},complete:!more}};
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

function readProductReferenceDocs_(references,projected){
 var result={},requests=[],groups=[],fields={Master_Brands:['Brand_Name'],Master_Categories:['Category_Name'],Master_Vendors:['Vendor_name'],Master_Zones:['Area','Build','Floor','Rack_no','Rack_Level'],Master_Cars:['Brand','Model','Year','Type_Car']};
 Object.keys(references).forEach(function(collection){
   if(!Object.prototype.hasOwnProperty.call(fields,collection))throw new Error('ชุดข้อมูลอ้างอิงไม่ถูกต้อง');
   var ids=Array.from(new Set(references[collection].filter(Boolean)));if(ids.length>2000||ids.some(function(id){return typeof id!=='string'||!validDocumentId_(id);}))throw new Error('ข้อมูลอ้างอิงสินค้าไม่ถูกต้อง');
   var cached=ids.length?peekCollectionDocsCache_(collection):[];result[collection]=[];
   if(cached!==null){result[collection]=cached.filter(function(doc){return ids.indexOf(doc.id)>=0;});return;}
   if(ids.length===1&&!projected){groups.push({collection:collection,ids:ids,single:true});requests.push({url:'https://firestore.googleapis.com/v1/'+fsDocPath_(collection,ids[0]),method:'get',headers:getAuthHeader_(),muteHttpExceptions:true});return;}
   for(var i=0;i<ids.length;i+=100){var batch=ids.slice(i,i+100),body={documents:batch.map(function(id){return fsDocPath_(collection,id);})};if(projected)body.mask={fieldPaths:fields[collection]};groups.push({collection:collection,ids:batch});requests.push({url:'https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:batchGet',method:'post',headers:getAuthHeader_(),muteHttpExceptions:true,payload:JSON.stringify(body)});}
 });
 if(requests.length)UrlFetchApp.fetchAll(requests).forEach(function(res,i){
   var group=groups[i],seen=Object.create(null);if(group.single&&res.getResponseCode()===404)return;
   if(res.getResponseCode()!==200)throw new Error('โหลดข้อมูลอ้างอิงสินค้าไม่สำเร็จ');
   var rows=JSON.parse(res.getContentText());if(group.single)rows=[{found:rows}];rows.forEach(function(row){var name=row.found&&row.found.name||row.missing||'',id=name.split('/').pop();if(group.ids.indexOf(id)<0||name!==fsDocPath_(group.collection,id)||seen[id])throw new Error('ข้อมูลอ้างอิงสินค้าไม่ครบ');seen[id]=true;if(row.found)result[group.collection].push({id:id,fields:row.found.fields||{},updateTime:row.found.updateTime||''});});
   if(group.ids.some(function(id){return !seen[id];}))throw new Error('ข้อมูลอ้างอิงสินค้าไม่ครบ');
 });
 return result;
}
