// ==========================================
// 0. ฟังก์ชัน URL ของ Web App
// ==========================================
function getWebAppUrl() {
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
    loginTemplate.webAppUrl = getWebAppUrl();
    loginTemplate.resetMode = mode;
    loginTemplate.resetToken = rtoken;
    return loginTemplate
      .evaluate()
      .setTitle('เข้าสู่ระบบ — SYY Shop Control')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var template = HtmlService.createTemplateFromFile(files[page] || 'index');
  template.webAppUrl = getWebAppUrl();
  template.authToken = token;
  template.userRole  = session.role;
  template.userName  = session.fullName || session.username;
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
function getAuthHeader() {
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

function saveProductImageDoc_(productCode, imageUrl, driveFileId) {
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
          + "/databases/(default)/documents/" + PRODUCT_IMAGES_COLLECTION + "/" + encodeURIComponent(productCode);
  UrlFetchApp.fetch(url, {
    method             : "patch",
    headers            : getAuthHeader(),
    payload            : JSON.stringify({ fields: mapToFirestoreFields({ Image_Url: imageUrl, Drive_File_Id: driveFileId }) }),
    muteHttpExceptions : true
  });
  clearCollectionCache(PRODUCT_IMAGES_COLLECTION);
}

function deleteProductImageDoc_(productCode) {
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
          + "/databases/(default)/documents/" + PRODUCT_IMAGES_COLLECTION + "/" + encodeURIComponent(productCode);
  UrlFetchApp.fetch(url, { method: "delete", headers: getAuthHeader(), muteHttpExceptions: true });
  clearCollectionCache(PRODUCT_IMAGES_COLLECTION);
}

// ★ อ่าน URL รูปของสินค้าทั้งหมดครั้งเดียวเป็น map {productCode: url} ให้ getAllProducts() ใช้
//   กันไม่ให้ต้องยิงคำขอแยกทีละสินค้า (จะช้ามากถ้ามีสินค้าหลายร้อยรายการ) — collection นี้เก็บแค่
//   URL สั้นๆ ต่อสินค้า (ไม่ใช่ตัวรูปเอง) จึงเข้าเงื่อนไข cache ปกติได้สบาย ไม่ชนขีดจำกัดขนาด cache
function getProductImageUrlMap_() {
  var map = {};
  try {
    var docs = fetchCollectionDocsCached(PRODUCT_IMAGES_COLLECTION);
    docs.forEach(function (doc) {
      var url = parseFirestoreValue((doc.fields || {}).Image_Url);
      if (url) map[doc.id] = url;
    });
  } catch (e) {
    console.error("getProductImageUrlMap_ error:", e);
  }
  return map;
}

function getProductImageUrlSingle_(productCode) {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + PRODUCT_IMAGES_COLLECTION + "/" + encodeURIComponent(productCode);
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      var doc = JSON.parse(res.getContentText());
      return parseFirestoreValue((doc.fields || {}).Image_Url) || "";
    }
  } catch (e) {
    console.error("getProductImageUrlSingle_ error:", e);
  }
  return "";
}

/**
 * ★ อัปโหลดรูปสินค้า (client ย่อขนาด+แปลงเป็น JPEG เป็น base64 มาให้แล้ว) — เก็บไฟล์จริงใน Google Drive
 */
function uploadProductImage(productCode, base64Data) {
  try {
    productCode = String(productCode || "").trim();
    if (!productCode) return { success: false, message: "ไม่พบรหัสสินค้า — กรุณาบันทึกสินค้าก่อน" };
    if (!base64Data) return { success: false, message: "ไม่พบข้อมูลรูปภาพ" };

    var bytes = Utilities.base64Decode(base64Data);
    if (bytes.length > 5 * 1024 * 1024) {
      return { success: false, message: "ไฟล์รูปใหญ่เกินไป (เกิน 5MB หลังย่อขนาดแล้ว)" };
    }

    var fileName = productCode + ".jpg";
    var folder   = getProductImageFolder_();

    // ลบไฟล์เก่าชื่อเดียวกันทิ้งก่อนเสมอ (ถ้ามี) กันไฟล์ซ้ำค้างอยู่ในโฟลเดอร์ทุกครั้งที่อัปโหลดทับ
    var oldFiles = folder.getFilesByName(fileName);
    while (oldFiles.hasNext()) { oldFiles.next().setTrashed(true); }

    var blob = Utilities.newBlob(bytes, "image/jpeg", fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var imageUrl = "https://lh3.googleusercontent.com/d/" + file.getId();
    saveProductImageDoc_(productCode, imageUrl, file.getId());

    return { success: true, message: "อัปโหลดรูปสำเร็จ", imageUrl: imageUrl };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function deleteProductImage(productCode) {
  try {
    productCode = String(productCode || "").trim();
    if (!productCode) return { success: false, message: "ไม่พบรหัสสินค้า" };

    var folder = getProductImageFolder_();
    var files  = folder.getFilesByName(productCode + ".jpg");
    while (files.hasNext()) { files.next().setTrashed(true); }

    deleteProductImageDoc_(productCode);
    return { success: true, message: "ลบรูปเรียบร้อย" };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ==========================================
// 2b. ★ Cache Layer — ลด Firestore Reads (Firebase Spark Plan / Free Quota)
// ==========================================
var CACHE_TTL_SECONDS     = 21600;
// ★ FIX (โควตา Firestore Reads): เพิ่ม Master_Users เข้า cache — เดิม findUserByUsername_/
//   findUserByEmail_/getAllUsers ดึงทั้ง collection สดทุกครั้ง (ทุก login attempt 1 ครั้ง = 1 อ่าน
//   ทั้งตาราง user) ไม่มี cache เลย ทั้งที่บัญชีผู้ใช้เปลี่ยนไม่บ่อย และ clearCollectionCache(Master_Users)
//   ถูกเรียกอยู่แล้วทุกจุดที่แก้ไขบัญชี (ดู updateUserFields_/saveMasterData) จึง cache ได้อย่างปลอดภัย
var CACHEABLE_COLLECTIONS = ["Master_Brands", "Master_Categories", "Master_Vendors", "Master_Zones", "Master_Cars", "Product_Images", "Master_Users"];

// ★ FIX (โควตา Firestore Reads): ใช้แทนการสแกนทั้ง collection เพื่อหาค่าที่ตรงกัน 1 ฟิลด์ (เช่น
//   เช็คเลข Part_Number/Barcode/Tax_ID ซ้ำก่อนบันทึก) — เทียบค่าตรงตัว (case-sensitive) ไม่ต้องสร้าง
//   Composite Index เพิ่ม (equality filter เดี่ยว ไม่รวม orderBy จึงใช้ single-field index อัตโนมัติได้)
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
      method: "post", headers: getAuthHeader(), payload: JSON.stringify(query), muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      (JSON.parse(res.getContentText()) || []).forEach(function(row) {
        if (row.document) docs.push({ id: row.document.name.split('/').pop(), fields: row.document.fields || {} });
      });
    } else {
      console.error("queryByEqualityField_ " + collectionName + "." + fieldPath + " HTTP " + res.getResponseCode() + ": " + res.getContentText());
    }
  } catch (e) {
    console.error("queryByEqualityField_ error:", e);
  }
  return docs;
}

function fetchAllPagesRaw(collectionName) {
  var docs = [];
  var pageToken = "";
  var guard = 0;
  try {
    do {
      var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
              + "/databases/(default)/documents/" + collectionName + "?pageSize=300"
              + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
      var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) {
        console.error("fetchAllPagesRaw " + collectionName + " HTTP " + res.getResponseCode() + ": " + res.getContentText());
        return { ok: false, docs: [] };
      }
      var json = JSON.parse(res.getContentText());
      (json.documents || []).forEach(function(doc) {
        docs.push({ id: doc.name.split('/').pop(), fields: doc.fields || {} });
      });
      pageToken = json.nextPageToken || "";
      guard++;
    } while (pageToken && guard < 50);
  } catch (e) {
    console.error("fetchAllPagesRaw error:", e);
    return { ok: false, docs: [] };
  }
  return { ok: true, docs: docs };
}

function fetchCollectionsParallel(collectionNames) {
  var result   = {};
  var toFetch  = [];
  var requests = [];

  collectionNames.forEach(function(name) {
    if (CACHEABLE_COLLECTIONS.indexOf(name) > -1) {
      try {
        var cached = CacheService.getScriptCache().get("docs_" + name);
        if (cached) { result[name] = JSON.parse(cached); return; }
      } catch (e) { /* ข้ามได้ ดึงสดแทน */ }
    }
    toFetch.push(name);
    requests.push({
      url                : "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
                           + "/databases/(default)/documents/" + name + "?pageSize=300",
      method             : "get",
      headers            : getAuthHeader(),
      muteHttpExceptions : true
    });
  });

  if (!requests.length) return result;

  try {
    var responses = UrlFetchApp.fetchAll(requests);
    responses.forEach(function(res, i) {
      var name = toFetch[i];
      if (res.getResponseCode() !== 200) {
        console.error("fetchCollectionsParallel " + name + " HTTP " + res.getResponseCode());
        result[name] = [];
        return;
      }
      var json = JSON.parse(res.getContentText());
      var docs = (json.documents || []).map(function(doc) {
        return { id: doc.name.split('/').pop(), fields: doc.fields || {} };
      });

      if (json.nextPageToken) {
        var full = fetchAllPagesRaw(name);
        if (full.ok) docs = full.docs;
      }

      result[name] = docs;
      if (CACHEABLE_COLLECTIONS.indexOf(name) > -1) {
        try {
          CacheService.getScriptCache().put("docs_" + name, JSON.stringify(docs), CACHE_TTL_SECONDS);
        } catch (e) { /* ข้ามได้ */ }
      }
    });
  } catch (e) {
    console.error("fetchCollectionsParallel error:", e);
    toFetch.forEach(function(name) { if (!result[name]) result[name] = []; });
  }
  return result;
}

function fetchCollectionDocsCached(collectionName) {
  var useCache = CACHEABLE_COLLECTIONS.indexOf(collectionName) > -1;
  var cacheKey = "docs_" + collectionName;

  if (useCache) {
    try {
      var cached = CacheService.getScriptCache().get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) {
      console.error("cache read error (ข้ามได้ ดึงสดแทน):", e);
    }
  }

  var fetched = fetchAllPagesRaw(collectionName);
  var docs    = fetched.docs;

  if (useCache && fetched.ok) {
    try {
      CacheService.getScriptCache().put(cacheKey, JSON.stringify(docs), CACHE_TTL_SECONDS);
    } catch (e) {
      console.error("cache write error (ข้ามได้ ไม่กระทบการทำงาน):", e);
    }
  }
  return docs;
}

function clearCollectionCache(collectionName) {
  if (CACHEABLE_COLLECTIONS.indexOf(collectionName) === -1) return;
  try {
    CacheService.getScriptCache().remove("docs_" + collectionName);
  } catch (e) {
    console.error("clearCollectionCache error:", e);
  }
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
    headers           : getAuthHeader(),
    payload           : JSON.stringify({
      fields: {
        Doc_No      : { stringValue: String(docNoValue) },
        Reserved_At : { stringValue: new Date().toISOString() }
      }
    }),
    muteHttpExceptions: true
  });
  return res.getResponseCode() === 200;
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
    var getRes = UrlFetchApp.fetch(getUrl, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });

    if (getRes.getResponseCode() === 200) {
      // ตัวนับของเดือนนี้มีอยู่แล้ว — increment แบบผูก precondition กับ updateTime ที่เพิ่งอ่านมา
      // กันสองคำขอพร้อมกันอ่านค่าเดิมแล้วเขียนทับกัน (ใครมาทีหลัง precondition จะไม่ตรง ต้องวนใหม่)
      var doc     = JSON.parse(getRes.getContentText());
      var current = parseInt(parseFirestoreValue((doc.fields || {}).Value) || 0, 10);
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
        return next; // เขียนไม่สำเร็จด้วยเหตุผลอื่น (ไม่ใช่ชนกัน) — คืนเลขที่คำนวณได้ไปก่อน เดี๋ยว reserveDocNo_ เป็นตัวกันชนสุดท้ายอยู่ดี
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
          method: "post", headers: getAuthHeader(), muteHttpExceptions: true,
          payload: JSON.stringify({ fields: { Value: { integerValue: String(seeded) } } })
        }
      );
      if (createRes.getResponseCode() === 200) return seeded;
      continue; // สร้างไม่สำเร็จ (409 = มีคนสร้างตัวนับของเดือนนี้ไปพร้อมกันพอดี) — วนไปอ่าน/increment ใหม่จากบนสุด
    }

    console.error("nextRunningNumber_ GET HTTP " + getRes.getResponseCode() + ": " + getRes.getContentText());
    return null; // ให้ caller fallback ไปใช้วิธีสแกนแบบเดิม
  }
  return null;
}

function getNextAutoId(collectionName, prefix, forceFresh) {
  try {
    var docs = forceFresh ? fetchAllPagesRaw(collectionName).docs
                          : fetchCollectionDocsCached(collectionName);
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

// ==========================================
// 4. แปลงข้อมูลเป็น Firestore Format
// ==========================================
var FORCE_STRING_FIELDS = ["Part_Number", "Product_Name", "Brand_Name", "Category_Name",
                            "Vendor_name", "Phone", "Area", "Build", "Floor", "Rack_no",
                            "Tax_ID", "Branch", "Invoice_No", "Buyer_Tax_ID", "Buyer_Branch",
                            "Customer_Name", "Address_No", "Address_Moo", "Address_Road",
                            "Subdistrict", "District", "Province", "Postal_Code", "Invoice_Date",
                            "Quote_No", "Customer_Tax_ID", "Customer_Phone", "Customer_Branch",
                            "Customer_PO", "Quote_Date", "Valid_Until", "Barcode"];

function mapToFirestoreFields(dataObject) {
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
function parseFirestoreValue(f) {
  if (!f) return "";
  if (f.stringValue  !== undefined) return f.stringValue;
  if (f.doubleValue  !== undefined) return parseFloat(f.doubleValue);
  if (f.integerValue !== undefined) return parseInt(f.integerValue, 10);
  if (f.booleanValue !== undefined) return f.booleanValue;
  if (f.arrayValue   !== undefined) {
    return (f.arrayValue.values || []).map(parseFirestoreValue);
  }
  return "";
}

// ==========================================
// 6. ดึงรายการ Master (Dropdown + เช็คซ้ำ)
// ==========================================
function getFirestoreRawList(collectionName) {
  var list = [];
  try {
    var docs = fetchCollectionDocsCached(collectionName);
    docs.forEach(function(doc) {
      var f = doc.fields || {};
      var displayName =
          (f.Brand_Name    ? f.Brand_Name.stringValue    : null) ||
          (f.Category_Name ? f.Category_Name.stringValue : null) ||
          (f.Vendor_name   ? f.Vendor_name.stringValue   : null) ||
          (f.Area          ? f.Area.stringValue          : null) ||
          (f.Product_Name  ? f.Product_Name.stringValue  : null) || "";

      list.push({
        id        : doc.id,
        Name      : displayName.trim(),
        name      : displayName.trim().toLowerCase()
      });
    });
  } catch (e) {
    console.error("getFirestoreRawList error:", e);
  }
  return list;
}

// ==========================================
// 7. ลบเอกสาร
// ==========================================
function deleteFirestoreDocument(collectionName, docId) {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + collectionName + "/" + docId;
    var res = UrlFetchApp.fetch(url, {
      method: "delete",
      headers: getAuthHeader(),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      clearCollectionCache(collectionName);
      return { success: true, title: "สำเร็จ", message: "ลบข้อมูลเรียบร้อย" };
    }
    return { success: false, title: "ล้มเหลว", message: res.getContentText() };
  } catch (e) {
    return { success: false, title: "ข้อผิดพลาด", message: e.message };
  }
}

// ==========================================
// 8. บันทึก / อัปเดต ข้อมูล (UPSERT)
// ==========================================
function saveMasterData(collectionName, prefix, docId, dataObject, checkDuplicateName) {
  try {
    if (checkDuplicateName) {
      var list        = getFirestoreRawList(collectionName);
      var compareName = checkDuplicateName.toString().trim().toLowerCase();
      var isDuplicate = list.some(function(item) {
        return item.name === compareName && item.id !== docId;
      });
      if (isDuplicate) {
        return { success: false, title: "ข้อมูลซ้ำ!", message: 'ชื่อ "' + checkDuplicateName + '" มีในระบบแล้ว' };
      }
    }

    var payload = { fields: mapToFirestoreFields(dataObject) };

    if (!docId) {
      var newId  = getNextAutoId(collectionName, prefix, true);
      var lastErr = "";

      for (var attempt = 0; attempt < 10; attempt++) {
        var createUrl = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
                      + "/databases/(default)/documents/" + collectionName
                      + "?documentId=" + encodeURIComponent(newId);
        var createRes = UrlFetchApp.fetch(createUrl, {
          method            : "post",
          headers           : getAuthHeader(),
          payload           : JSON.stringify(payload),
          muteHttpExceptions: true
        });

        var code = createRes.getResponseCode();
        if (code === 200) {
          clearCollectionCache(collectionName);
          return { success: true, title: "สำเร็จ", message: "บันทึกข้อมูลเรียบร้อย", id: newId };
        }
        if (code === 409) {
          newId = bumpAutoId(newId, prefix);
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

    var res = UrlFetchApp.fetch(url, {
      method            : "patch",
      headers           : getAuthHeader(),
      payload           : JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() === 200) {
      clearCollectionCache(collectionName);
      return { success: true, title: "สำเร็จ", message: "บันทึกข้อมูลเรียบร้อย", id: id };
    }
    return { success: false, title: "ล้มเหลว", message: res.getContentText() };
  } catch (e) {
    return { success: false, title: "ข้อผิดพลาด", message: e.message };
  }
}

function bumpAutoId(currentId, prefix) {
  var numStr = String(currentId).indexOf(prefix) === 0 ? String(currentId).substring(prefix.length) : "";
  var num    = /^\d+$/.test(numStr) ? parseInt(numStr, 10) : 0;
  var width  = numStr.length || 4;
  return prefix + (num + 1).toString().padStart(width, '0');
}

function buildMapFromDocs(docs, nameField) {
  var map = {};
  (docs || []).forEach(function(doc) {
    var f = doc.fields || {};
    map[doc.id] = f[nameField] ? parseFirestoreValue(f[nameField]) : doc.id;
  });
  return map;
}

function buildZoneMapFromDocs(docs) {
  var map = {};
  (docs || []).forEach(function(doc) {
    var f     = doc.fields || {};
    var build = parseFirestoreValue(f.Build) || "";
    var floor = parseFirestoreValue(f.Floor) || "";
    var area  = parseFirestoreValue(f.Area)  || "";
    var label = [build, floor, area].filter(Boolean).join(" ");
    map[doc.id] = label || doc.id;
  });
  return map;
}

function buildCarMapFromDocs(docs) {
  var map = {};
  (docs || []).forEach(function(doc) {
    var f     = doc.fields || {};
    var brand = parseFirestoreValue(f.Brand)    || "";
    var model = parseFirestoreValue(f.Model)    || "";
    var year  = parseFirestoreValue(f.Year)     || "";
    var type  = parseFirestoreValue(f.Type_Car) || "";
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
function getAllProducts() {
  var products = [];
  try {
    var masters = fetchCollectionsParallel(
      ["Master_Brands", "Master_Categories", "Master_Vendors", "Master_Zones", "Master_Cars"]
    );
    var brandMap  = buildMapFromDocs(masters["Master_Brands"],     "Brand_Name");
    var catMap    = buildMapFromDocs(masters["Master_Categories"], "Category_Name");
    var vendorMap = buildMapFromDocs(masters["Master_Vendors"],    "Vendor_name");
    var zoneMap   = buildZoneMapFromDocs(masters["Master_Zones"]);
    var carMap    = buildCarMapFromDocs(masters["Master_Cars"]);
    var imageMap  = getProductImageUrlMap_();

    var fetched = fetchAllPagesRaw("Master_Products");
    if (!fetched.ok) {
      console.error("getAllProducts: ดึงข้อมูลสินค้าไม่สำเร็จ");
      return products;
    }

    fetched.docs.forEach(function(doc) {
        var id = doc.id;
        var f  = doc.fields || {};

        var brandId  = parseFirestoreValue(f.Brand_ID)          || "";
        var catId    = parseFirestoreValue(f.Category_ID)        || "";
        var vendorId = parseFirestoreValue(f.Default_Vendor_ID)  || "";
        var zoneId   = parseFirestoreValue(f.Zone_ID)            || "";

        var carIds = parseFirestoreValue(f.Car_IDs);
        if (!carIds || (Array.isArray(carIds) && carIds.length === 0)) {
          var legacyCarId = parseFirestoreValue(f.Car_ID);
          carIds = legacyCarId ? [legacyCarId] : [];
        } else if (!Array.isArray(carIds)) {
          carIds = [carIds];
        }
        var carModelNames = carIds.map(function(cid) { return carMap[cid] || cid; }).filter(Boolean);

        products.push({
          productCode  : id,
          productName  : parseFirestoreValue(f.Product_Name)   || "",
          partType     : parseFirestoreValue(f.Part_Type)      || "",
          partNumber   : String(parseFirestoreValue(f.Part_Number) || ""),
          barcode      : String(parseFirestoreValue(f.Barcode) || ""),
          barcodeGenerated : parseFirestoreValue(f.Barcode_Generated) === "true",
          imageUrl     : imageMap[id] || "",
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
          costPrice    : parseFloat(parseFirestoreValue(f.Cost_Price)    || 0),
          sellingPrice : parseFloat(parseFirestoreValue(f.Selling_Price) || 0),
          currentStock : parseFloat(parseFirestoreValue(f.Current_Stock) || 0),
          minStock     : parseFloat(parseFirestoreValue(f.Min_Stock)     || 0),
          status       : parseFirestoreValue(f.Status) || "Active"
        });
    });
  } catch (e) {
    console.error("getAllProducts error:", e);
  }
  return products;
}

// ==========================================
// 11. ★ getProductById
// ==========================================
function getProductById(productCode) {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Master_Products/" + productCode;
    var res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: getAuthHeader(),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() === 200) {
      var doc = JSON.parse(res.getContentText());
      var f   = doc.fields || {};

      var brandId  = parseFirestoreValue(f.Brand_ID)          || "";
      var catId    = parseFirestoreValue(f.Category_ID)       || "";
      var vendorId = parseFirestoreValue(f.Default_Vendor_ID) || "";
      var zoneId   = parseFirestoreValue(f.Zone_ID)           || "";

      var carIds = parseFirestoreValue(f.Car_IDs);
      if (!carIds || (Array.isArray(carIds) && carIds.length === 0)) {
        var legacyCarId = parseFirestoreValue(f.Car_ID);
        carIds = legacyCarId ? [legacyCarId] : [];
      } else if (!Array.isArray(carIds)) {
        carIds = [carIds];
      }

      var masters   = fetchCollectionsParallel(
        ["Master_Brands", "Master_Categories", "Master_Vendors", "Master_Zones", "Master_Cars"]
      );
      var brandMap  = buildMapFromDocs(masters["Master_Brands"],     "Brand_Name");
      var catMap    = buildMapFromDocs(masters["Master_Categories"], "Category_Name");
      var vendorMap = buildMapFromDocs(masters["Master_Vendors"],    "Vendor_name");
      var zoneMap   = buildZoneMapFromDocs(masters["Master_Zones"]);
      var carMap    = buildCarMapFromDocs(masters["Master_Cars"]);
      var carModelNames = carIds.map(function(cid) { return carMap[cid] || cid; }).filter(Boolean);

      return {
        productCode  : productCode,
        productName  : parseFirestoreValue(f.Product_Name)        || "",
        partType     : parseFirestoreValue(f.Part_Type)           || "",
        partNumber   : String(parseFirestoreValue(f.Part_Number) || ""),
        barcode      : String(parseFirestoreValue(f.Barcode) || ""),
        barcodeGenerated : parseFirestoreValue(f.Barcode_Generated) === "true",
        imageUrl     : getProductImageUrlSingle_(productCode),
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
        costPrice    : parseFloat(parseFirestoreValue(f.Cost_Price)    || 0),
        sellingPrice : parseFloat(parseFirestoreValue(f.Selling_Price) || 0),
        currentStock : parseFloat(parseFirestoreValue(f.Current_Stock) || 0),
        minStock     : parseFloat(parseFirestoreValue(f.Min_Stock)     || 0),
        status       : parseFirestoreValue(f.Status)              || "Active"
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
function getAllMasterDropdowns(preloadedMasters) {

  function buildBrands() {
    return buildSimpleList("Master_Brands", function(f, id) {
      return parseFirestoreValue(f.Brand_Name) || id;
    });
  }

  function buildCategories() {
    return buildSimpleList("Master_Categories", function(f, id) {
      return parseFirestoreValue(f.Category_Name) || id;
    });
  }

  function buildVendors() {
    return buildSimpleList("Master_Vendors", function(f, id) {
      var name  = parseFirestoreValue(f.Vendor_name) || id;
      var phone = parseFirestoreValue(f.Phone) || "";
      return phone ? name + " (" + phone + ")" : name;
    });
  }

  function buildZones() {
    return buildSimpleList("Master_Zones", function(f, id) {
      var area  = parseFirestoreValue(f.Area)  || id;
      var build = parseFirestoreValue(f.Build) || "";
      var floor = parseFirestoreValue(f.Floor) || "";
      var rack  = parseFirestoreValue(f.Rack_no) || "";
      var parts = area;
      if (build || floor) parts += " — " + [build, floor].filter(Boolean).join(" ");
      if (rack) parts += " (Rack " + rack + ")";
      return parts;
    });
  }

  function buildCars() {
    return buildSimpleList("Master_Cars", function(f, id) {
      var brand = parseFirestoreValue(f.Brand)    || "";
      var model = parseFirestoreValue(f.Model)    || "";
      var year  = parseFirestoreValue(f.Year)     || "";
      var type  = parseFirestoreValue(f.Type_Car) || "";
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
                   : fetchCollectionDocsCached(collectionName);
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

  var PRELOADED_MASTER_DOCS = preloadedMasters || fetchCollectionsParallel(
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
function saveProduct(d) {
  var carIds = Array.isArray(d.carIds) ? d.carIds.filter(Boolean) : [];

  var dataObject = {
    Product_Name      : String(d.productName   || ""),
    Part_Type         : String(d.partType      || "").trim() || "PENDING", // ★ ไม่บังคับเลือก — ว่างไว้ได้ (แสดงเป็น "รอดำเนินการ" เหมือน Zone_ID)
    Part_Number       : String(d.partNumber    || "").trim(),
    Barcode           : String(d.barcode       || "").trim(),
    Brand_ID          : String(d.brandId       || ""),
    Category_ID       : String(d.categoryId    || ""),
    Default_Vendor_ID : String(d.vendorId      || ""),
    Zone_ID           : String(d.zoneId        || "").trim() || "PENDING",
    Car_IDs           : carIds,
    Cost_Price        : parseFloat(d.costPrice    || 0),
    Selling_Price     : parseFloat(d.sellingPrice || 0),
    Current_Stock     : parseFloat(d.currentStock || 0),
    Min_Stock         : parseFloat(d.minStock     || 0),
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
  var existingFields = docId ? getProductRawFields_(docId) : null;

  if (dataObject.Part_Number) {
    var dupPn = queryByEqualityField_("Master_Products", "Part_Number", dataObject.Part_Number)
      .some(function(doc) { return doc.id !== docId; });
    if (dupPn) {
      return { success: false, title: "ข้อมูลซ้ำ!", message: 'รหัสจากผู้ผลิต (Part Number) "' + dataObject.Part_Number + '" มีอยู่ในระบบแล้ว' };
    }
  }
  if (dataObject.Barcode) {
    var dupBc = queryByEqualityField_("Master_Products", "Barcode", dataObject.Barcode)
      .some(function(doc) { return doc.id !== docId; });
    if (dupBc) {
      return { success: false, title: "ข้อมูลซ้ำ!", message: 'บาร์โค้ด "' + dataObject.Barcode + '" มีอยู่ในระบบแล้ว' };
    }
  }

  // ★ Barcode_Generated ไม่ได้อยู่ในฟอร์มแก้ไขสินค้า (ตั้งค่าแยกผ่าน generateProductBarcode())
  //   แต่ saveProduct → saveMasterData เป็น PATCH แบบไม่มี updateMask (ทับทั้งเอกสาร) — ถ้าไม่จัดการ
  //   ตรงนี้ การแก้ไขสินค้าเรื่องอื่น (เช่นราคา) จะลบธง "สร้างเอง" ทิ้งเงียบๆ ทุกครั้ง ทำให้เมนูพิมพ์
  //   บาร์โค้ดหายไปทั้งที่บาร์โค้ดยังเป็นอันที่ระบบสร้างอยู่เหมือนเดิม — คงธงไว้ถ้าค่าบาร์โค้ดไม่เปลี่ยน
  //   จากที่ระบบเคยสร้างให้, ถือเป็นบาร์โค้ดจริงถ้าผู้ใช้พิมพ์/แก้ไขค่าใหม่เอง
  dataObject.Barcode_Generated = "false";
  if (existingFields) {
    var existingBarcode   = String(parseFirestoreValue(existingFields.Barcode) || "").trim();
    var existingGenerated = parseFirestoreValue(existingFields.Barcode_Generated) === "true";
    if (existingGenerated && existingBarcode && existingBarcode === dataObject.Barcode) {
      dataObject.Barcode_Generated = "true";
    }
  }

  return saveMasterData("Master_Products", "P", docId, dataObject, d.productName);
}

function getProductRawFields_(docId) {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Master_Products/" + docId;
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
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
function generateProductBarcode(productCode) {
  try {
    productCode = String(productCode || "").trim();
    if (!productCode) return { success: false, message: "ไม่พบรหัสสินค้า" };

    var fields = getProductRawFields_(productCode);
    if (!fields) return { success: false, message: "ไม่พบสินค้านี้ในระบบ — อาจถูกลบไปแล้ว" };

    var existing  = String(parseFirestoreValue(fields.Barcode) || "").trim();
    var generated = parseFirestoreValue(fields.Barcode_Generated) === "true";

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
    var dupBarcode = checkBarcodeDuplicate(barcode, productCode);
    if (dupBarcode) return { success: false, message: "สร้างบาร์โค้ดชนกับสินค้าอื่น กรุณาลองใหม่หรือกรอกเอง" };

    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Master_Products/" + productCode
            + "?updateMask.fieldPaths=Barcode&updateMask.fieldPaths=Barcode_Generated";
    var res = UrlFetchApp.fetch(url, {
      method  : "patch",
      headers : getAuthHeader(),
      payload : JSON.stringify({ fields: mapToFirestoreFields({ Barcode: barcode, Barcode_Generated: "true" }) }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      return { success: false, message: "บันทึกบาร์โค้ดไม่สำเร็จ: " + res.getContentText() };
    }

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

function checkPartNumberDuplicate(partNumber, excludeDocId) {
  var compareVal = String(partNumber || "").trim().toLowerCase();
  if (!compareVal) return null;

  var fetched = fetchAllPagesRaw("Master_Products");
  if (!fetched.ok) {
    console.error("checkPartNumberDuplicate: ดึงข้อมูลสินค้าไม่สำเร็จ ข้ามการตรวจสอบซ้ำ");
    return null;
  }

  var isDuplicate = fetched.docs.some(function(doc) {
    if (doc.id === excludeDocId) return false;
    var existingVal = String(parseFirestoreValue((doc.fields || {}).Part_Number) || "").trim().toLowerCase();
    return existingVal && existingVal === compareVal;
  });

  if (isDuplicate) {
    return { success: false, title: "ข้อมูลซ้ำ!", message: 'รหัสจากผู้ผลิต (Part Number) "' + partNumber + '" มีอยู่ในระบบแล้ว' };
  }
  return null;
}

function checkBarcodeDuplicate(barcode, excludeDocId) {
  var compareVal = String(barcode || "").trim().toLowerCase();
  if (!compareVal) return null;

  var fetched = fetchAllPagesRaw("Master_Products");
  if (!fetched.ok) {
    console.error("checkBarcodeDuplicate: ดึงข้อมูลสินค้าไม่สำเร็จ ข้ามการตรวจสอบซ้ำ");
    return null;
  }

  var isDuplicate = fetched.docs.some(function(doc) {
    if (doc.id === excludeDocId) return false;
    var existingVal = String(parseFirestoreValue((doc.fields || {}).Barcode) || "").trim().toLowerCase();
    return existingVal && existingVal === compareVal;
  });

  if (isDuplicate) {
    return { success: false, title: "ข้อมูลซ้ำ!", message: 'บาร์โค้ด "' + barcode + '" มีอยู่ในระบบแล้ว' };
  }
  return null;
}

function deleteProduct(docId) {
  return deleteFirestoreDocument("Master_Products", docId);
}

// ==========================================
// 14. Master — Brands
// ==========================================
function saveBrand(d) {
  var dataObject = {
    Brand_Name  : String(d.brandName   || ""),
    Description : String(d.description || ""),
    Status      : String(d.status      || "Active")
  };
  return saveMasterData("Master_Brands", "B", d.docId || null, dataObject, d.brandName);
}
function getBrands()        { return getFirestoreRawList("Master_Brands"); }
function deleteBrand(docId) { return deleteFirestoreDocument("Master_Brands", docId); }

// ==========================================
// 15. Master — Categories
// ==========================================
function saveCategory(d) {
  var dataObject = {
    Category_Name: String(d.categoryName || ""),
    Description  : String(d.description  || ""),
    Status       : String(d.status       || "Active")
  };
  return saveMasterData("Master_Categories", "C", d.docId || null, dataObject, d.categoryName);
}
function getCategories()        { return getFirestoreRawList("Master_Categories"); }
// ★ FIX: แก้ typo "eleteCategory" → "deleteCategory" (เดิมขาดตัว d ทำให้ apiGateway/ปุ่มลบเรียกไม่เจอ)
function deleteCategory(docId)  { return deleteFirestoreDocument("Master_Categories", docId); }
// ==========================================
// 16. Master — Vendors
// ==========================================
function buildFullAddress(f) {
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

function saveVendor(d) {
  var taxId = String(d.taxId || "").replace(/\D/g, '');

  if (!taxId) {
    return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณากรอกเลขประจำตัวผู้เสียภาษีอากร (จำเป็นสำหรับออกใบกำกับภาษี)" };
  }
  if (taxId.length !== 13) {
    return { success: false, title: "ข้อมูลไม่ถูกต้อง", message: "เลขประจำตัวผู้เสียภาษีอากรต้องมี 13 หลัก (กรอกมา " + taxId.length + " หลัก)" };
  }

  var dataObject = {
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
  return saveMasterData("Master_Vendors", "V", d.docId || null, dataObject, d.vendorName);
}

function getVendorsFull() {
  var list = [];
  try {
    var docs = fetchCollectionDocsCached("Master_Vendors");
    docs.forEach(function(doc) {
      var f = doc.fields || {};
      list.push({
        id           : doc.id,
        Vendor_name  : parseFirestoreValue(f.Vendor_name)  || "",
        Contact_name : parseFirestoreValue(f.Contact_name) || "",
        Phone        : parseFirestoreValue(f.Phone)        || "",
        Email        : parseFirestoreValue(f.Email)        || "",
        Address_No   : parseFirestoreValue(f.Address_No)   || "",
        Address_Moo   : parseFirestoreValue(f.Address_Moo)  || "",
        Address_Road  : parseFirestoreValue(f.Address_Road) || "",
        Subdistrict   : parseFirestoreValue(f.Subdistrict)  || "",
        District      : parseFirestoreValue(f.District)     || "",
        Province      : parseFirestoreValue(f.Province)      || "",
        Postal_Code   : parseFirestoreValue(f.Postal_Code)    || "",
        Address      : buildFullAddress({
          addressNo: parseFirestoreValue(f.Address_No), addressMoo: parseFirestoreValue(f.Address_Moo),
          addressRoad: parseFirestoreValue(f.Address_Road), subdistrict: parseFirestoreValue(f.Subdistrict),
          district: parseFirestoreValue(f.District), province: parseFirestoreValue(f.Province),
          postalCode: parseFirestoreValue(f.Postal_Code), address: parseFirestoreValue(f.Address)
        }),
        Tax_ID       : String(parseFirestoreValue(f.Tax_ID) || ""),
        Branch       : parseFirestoreValue(f.Branch)        || "",
        Status       : parseFirestoreValue(f.Status)       || ""
      });
    });
  } catch (e) {
    console.error("getVendorsFull error:", e);
  }
  return list;
}

function deleteVendor(docId) { return deleteFirestoreDocument("Master_Vendors", docId); }

// ==========================================
// ★ Master — Customers
// ==========================================
var CUSTOMER_TYPES = ["ลูกค้าทั่วไป", "อู่ซ่อมรถ", "บริษัท/องค์กร", "หน่วยงานราชการ"];

function saveCustomer(d) {
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
    var dupTaxId = queryByEqualityField_("Master_Customers", "Tax_ID", taxId)
      .some(function(doc) { return doc.id !== docId; });
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
    Branch        : String(d.branch  || "").trim() || "สำนักงานใหญ่",
    Phone         : String(d.phone   || ""),
    Status        : String(d.status  || "Active")
  };
  return saveMasterData("Master_Customers", "C", docId, dataObject, d.customerName);
}

function getCustomersFull() {
  var list = [];
  try {
    var docs = fetchCollectionDocsCached("Master_Customers");
    docs.forEach(function(doc) {
      var f = doc.fields || {};
      list.push({
        id            : doc.id,
        Customer_Name : parseFirestoreValue(f.Customer_Name) || "",
        Customer_Type : parseFirestoreValue(f.Customer_Type) || "",
        Address_No    : parseFirestoreValue(f.Address_No)    || "",
        Address_Moo   : parseFirestoreValue(f.Address_Moo)   || "",
        Address_Road  : parseFirestoreValue(f.Address_Road)  || "",
        Subdistrict   : parseFirestoreValue(f.Subdistrict)   || "",
        District      : parseFirestoreValue(f.District)      || "",
        Province      : parseFirestoreValue(f.Province)       || "",
        Postal_Code   : parseFirestoreValue(f.Postal_Code)     || "",
        Address       : buildFullAddress({
          addressNo: parseFirestoreValue(f.Address_No), addressMoo: parseFirestoreValue(f.Address_Moo),
          addressRoad: parseFirestoreValue(f.Address_Road), subdistrict: parseFirestoreValue(f.Subdistrict),
          district: parseFirestoreValue(f.District), province: parseFirestoreValue(f.Province),
          postalCode: parseFirestoreValue(f.Postal_Code), address: parseFirestoreValue(f.Address)
        }),
        Tax_ID        : String(parseFirestoreValue(f.Tax_ID) || ""),
        Branch        : parseFirestoreValue(f.Branch)        || "",
        Phone         : parseFirestoreValue(f.Phone)         || "",
        Status        : parseFirestoreValue(f.Status)        || ""
      });
    });
  } catch (e) {
    console.error("getCustomersFull error:", e);
  }
  return list;
}

function deleteCustomer(docId) { return deleteFirestoreDocument("Master_Customers", docId); }

// ==========================================
// ★ Master — Tax Invoice
// ==========================================
var TAX_INVOICE_SELLER = {
  name    : "บริษัท ส.ยืนยงอะไหล่ยนต์ จำกัด",
  branch  : "สำนักงานใหญ่ 000",
  address : "82-86 หมู่ที่ 3 ตำบลพยุหะ อำเภอพยุหะคีรี จังหวัดนครสวรรค์",
  taxId   : "0605563000707"
};

function calcTaxInvoiceTotals(items) {
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

var TAX_INVOICE_PREFIX = "SYY";

function buildInvoiceNoForMonth(invoiceDateStr, runningNumber) {
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

function getNextInvoiceRunningNumber(invoiceDateStr, excludeDocId) {
  var targetSuffix = buildInvoiceNoForMonth(invoiceDateStr, 1).split('/').slice(1).join('/');
  var fetched = fetchAllPagesRaw("Master_Tax_Invoice");
  var maxNum = 0;
  if (fetched.ok) {
    fetched.docs.forEach(function(doc) {
      if (doc.id === excludeDocId) return;
      var f = doc.fields || {};
      var no = String(parseFirestoreValue(f.Invoice_No) || "");
      var m = no.match(/^SYY\s+(\d{4})\/(\d{2}\/\d{2})$/);
      if (m && m[2] === targetSuffix) {
        var num = parseInt(m[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
  }
  return maxNum + 1;
}

function saveTaxInvoice(d) {
  var items = Array.isArray(d.items) ? d.items : [];
  if (!items.length) {
    return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณาเพิ่มรายการสินค้า/บริการอย่างน้อย 1 รายการ" };
  }
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

  var totals = calcTaxInvoiceTotals(cleanItems);

  var invoiceDate = String(d.invoiceDate || "").trim() || new Date().toISOString().slice(0, 10);

  var invoiceNo = "";
  if (d.docId) {
    var existingUrl = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
                     + "/databases/(default)/documents/Master_Tax_Invoice/" + d.docId;
    try {
      var existingRes = UrlFetchApp.fetch(existingUrl, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
      if (existingRes.getResponseCode() === 200) {
        var existingDoc = JSON.parse(existingRes.getContentText());
        invoiceNo = parseFirestoreValue((existingDoc.fields || {}).Invoice_No) || "";
      }
    } catch (e) {
      console.error("saveTaxInvoice: อ่านเลขที่เดิมไม่สำเร็จ (จะรันเลขใหม่แทน):", e);
    }
  }

  var dataObject = {
    Invoice_Date  : invoiceDate,
    Buyer_Name    : String(d.buyerName    || "").trim(),
    Buyer_Address : String(d.buyerAddress || "").trim(),
    Buyer_Tax_ID  : buyerTaxId,
    Buyer_Branch  : String(d.buyerBranch  || "").trim() || "สำนักงานใหญ่",
    Items_JSON    : JSON.stringify(cleanItems),
    Subtotal      : totals.subtotal,
    Vat_Amount    : totals.vat,
    Grand_Total   : totals.total,
    Note          : String(d.note || "")
  };

  var invoiceYearBE = new Date(invoiceDate + "T00:00:00").getFullYear() + 543;

  if (d.docId && invoiceNo) {
    dataObject.Invoice_No = invoiceNo;
    var editRes = saveMasterData("Master_Tax_Invoice", "TX", d.docId, dataObject, null);
    if (editRes.success) updateTaxInvoiceYearsMeta_(invoiceYearBE);
    return editRes;
  }

  var periodKey = docPeriodKey_(invoiceDate);
  var lastErr = "";
  for (var attempt = 0; attempt < 10; attempt++) {
    // ★ FIX (โควตา Firestore Reads): ใช้ตัวนับแทนการสแกน Master_Tax_Invoice ทั้ง collection ทุกครั้ง
    //   (ดูคำอธิบายเต็มที่ nextRunningNumber_) — seedFn (getNextInvoiceRunningNumber เดิม) จะถูกเรียก
    //   แค่ครั้งเดียวตอนตัวนับของเดือนนี้ยังไม่เคยถูกสร้างเท่านั้น
    var runningNum = nextRunningNumber_("TaxInvoice", periodKey, function() {
      return getNextInvoiceRunningNumber(invoiceDate, d.docId || null);
    });
    if (runningNum === null) {
      // ตัวนับขัดข้อง (error ชั่วคราว) — fallback กลับไปสแกนแบบเดิมเฉพาะรอบนี้ ไม่ปล่อยให้บันทึกไม่ได้เลย
      runningNum = getNextInvoiceRunningNumber(invoiceDate, d.docId || null) + attempt;
    }
    var candidateNo = buildInvoiceNoForMonth(invoiceDate, runningNum);

    // ★ จองเลขที่แบบ atomic ก่อนบันทึกจริง — กันเลขซ้ำเมื่อมีคนออกใบกำกับภาษีพร้อมกัน (ดู reserveDocNo_)
    if (!reserveDocNo_("TaxInvoice", candidateNo)) continue;

    dataObject.Invoice_No = candidateNo;
    var res = saveMasterData("Master_Tax_Invoice", "TX", d.docId || null, dataObject, null);
    if (res.success) {
      updateTaxInvoiceYearsMeta_(invoiceYearBE);
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

function updateTaxInvoiceYearsMeta_(yearBE) {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + META_COLLECTION + "/" + TAX_INVOICE_YEARS_ID;
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });

    var years = [];
    if (res.getResponseCode() === 200) {
      var doc = JSON.parse(res.getContentText());
      years = parseFirestoreValue((doc.fields || {}).Years) || [];
      years = years.map(function(y) { return parseInt(y, 10); });
    }
    if (years.indexOf(yearBE) > -1) return;

    years.push(yearBE);
    years.sort(function(a, b) { return b - a; });

    var payload = {
      fields: {
        Years: { arrayValue: { values: years.map(function(y) { return { integerValue: y }; }) } }
      }
    };
    UrlFetchApp.fetch(url + "?updateMask.fieldPaths=Years", {
      method: "patch", headers: getAuthHeader(), payload: JSON.stringify(payload), muteHttpExceptions: true
    });
  } catch (e) {
    console.error("updateTaxInvoiceYearsMeta_ error:", e);
  }
}

function getTaxInvoiceAvailableYears() {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + META_COLLECTION + "/" + TAX_INVOICE_YEARS_ID;
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      var doc = JSON.parse(res.getContentText());
      var years = parseFirestoreValue((doc.fields || {}).Years) || [];
      years = years.map(function(y) { return parseInt(y, 10); }).sort(function(a, b) { return b - a; });
      if (years.length) return years;
    }
  } catch (e) {
    console.error("getTaxInvoiceAvailableYears error:", e);
  }
  return [new Date().getFullYear() + 543];
}

function mapTaxInvoiceQueryDoc_(doc) {
  var f = doc.fields || {};
  var items = [];
  try { items = JSON.parse(parseFirestoreValue(f.Items_JSON) || "[]"); } catch (e) { items = []; }
  return {
    id           : doc.name.split('/').pop(),
    invoiceNo    : parseFirestoreValue(f.Invoice_No)    || "",
    invoiceDate  : parseFirestoreValue(f.Invoice_Date)  || "",
    buyerName    : parseFirestoreValue(f.Buyer_Name)    || "",
    buyerAddress : parseFirestoreValue(f.Buyer_Address) || "",
    buyerTaxId   : String(parseFirestoreValue(f.Buyer_Tax_ID) || ""),
    buyerBranch  : parseFirestoreValue(f.Buyer_Branch)  || "",
    items        : items,
    subtotal     : parseFloat(parseFirestoreValue(f.Subtotal)    || 0),
    vatAmount    : parseFloat(parseFirestoreValue(f.Vat_Amount)  || 0),
    grandTotal   : parseFloat(parseFirestoreValue(f.Grand_Total) || 0),
    note         : parseFirestoreValue(f.Note) || ""
  };
}

function getTaxInvoiceListByYear(yearBE) {
  var list = [];
  try {
    var yearAD = yearBE - 543;
    var fromDate = yearAD + "-01-01";
    var toDate   = yearAD + "-12-31";

    var query = {
      structuredQuery: {
        from: [{ collectionId: "Master_Tax_Invoice" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              { fieldFilter: { field: { fieldPath: "Invoice_Date" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: fromDate } } },
              { fieldFilter: { field: { fieldPath: "Invoice_Date" }, op: "LESS_THAN_OR_EQUAL",    value: { stringValue: toDate   } } }
            ]
          }
        },
        limit: 1000
      }
    };

    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents:runQuery";
    var res = UrlFetchApp.fetch(url, {
      method: "post", headers: getAuthHeader(), payload: JSON.stringify(query), muteHttpExceptions: true
    });

    if (res.getResponseCode() === 200) {
      var rows = JSON.parse(res.getContentText());
      rows.forEach(function(row) {
        if (row.document) list.push(mapTaxInvoiceQueryDoc_(row.document));
      });
    } else {
      console.error("getTaxInvoiceListByYear HTTP " + res.getResponseCode() + ": " + res.getContentText());
    }
  } catch (e) {
    console.error("getTaxInvoiceListByYear error:", e);
  }
  list.sort(function(a, b) { return b.invoiceNo.localeCompare(a.invoiceNo); });
  return list;
}

// ★ FIX (โควตา Firestore Reads): ใช้ตอนเลือกมุมมอง "ทั้งหมด" (ทุกปีรวมกัน) — เดิมสแกนทั้ง
//   Master_Tax_Invoice โดยไม่จำกัด (โตไม่มีที่สิ้นสุดตามอายุร้าน) เปลี่ยนเป็น runQuery + orderBy +
//   limit (เอาล่าสุดก่อน) เหมือน getActivityLog/getStockMovements — ครอบคลุมการใช้งานจริงเกือบทั้งหมด
//   เพราะร้านที่ออกใบกำกับภาษีเกิน 1,500 ใบสะสม ปกติจะกรองดูทีละปีอยู่แล้วไม่ได้ใช้มุมมอง "ทั้งหมด" นี้
function getTaxInvoiceList() {
  var list = [];
  try {
    var query = {
      structuredQuery: {
        from    : [{ collectionId: "Master_Tax_Invoice" }],
        orderBy : [{ field: { fieldPath: "Invoice_Date" }, direction: "DESCENDING" }],
        limit   : 1500
      }
    };
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents:runQuery";
    var res = UrlFetchApp.fetch(url, {
      method: "post", headers: getAuthHeader(), payload: JSON.stringify(query), muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      (JSON.parse(res.getContentText()) || []).forEach(function(row) {
        if (row.document) list.push(mapTaxInvoiceQueryDoc_(row.document));
      });
    } else {
      console.error("getTaxInvoiceList HTTP " + res.getResponseCode() + ": " + res.getContentText());
    }
  } catch (e) {
    console.error("getTaxInvoiceList error:", e);
  }
  list.sort(function(a, b) { return b.invoiceNo.localeCompare(a.invoiceNo); });
  return list;
}

function getTaxInvoicePageData(yearFilter) {
  var invoices;
  if (yearFilter === "all") {
    invoices = getTaxInvoiceList();
  } else {
    var yearBE = parseInt(yearFilter, 10) || (new Date().getFullYear() + 543);
    invoices = getTaxInvoiceListByYear(yearBE);
  }
  return {
    invoices       : invoices,
    seller         : TAX_INVOICE_SELLER,
    customers      : getCustomersFull(),
    products       : getAllProducts(),
    availableYears : getTaxInvoiceAvailableYears()
  };
}

function deleteTaxInvoice(docId) { return deleteFirestoreDocument("Master_Tax_Invoice", docId); }

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

function calcQuoteTotals(items, discPctRaw) {
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

function buildQuoteNoForMonth(quoteDateStr, runningNumber) {
  var d = quoteDateStr ? new Date(quoteDateStr + "T00:00:00") : new Date();
  if (isNaN(d.getTime())) d = new Date();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var yyBuddhist = String(d.getFullYear() + 543).slice(-2);
  return QUOTATION_PREFIX + " " + String(runningNumber).padStart(4, '0') + "/" + mm + "/" + yyBuddhist;
}

function getNextQuoteRunningNumber(quoteDateStr, excludeDocId) {
  var targetSuffix = buildQuoteNoForMonth(quoteDateStr, 1).split('/').slice(1).join('/');
  var fetched = fetchAllPagesRaw(QUOTATION_COLLECTION);
  var maxNum = 0;
  if (fetched.ok) {
    fetched.docs.forEach(function(doc) {
      if (doc.id === excludeDocId) return;
      var f = doc.fields || {};
      var no = String(parseFirestoreValue(f.Quote_No) || "");
      var m = no.match(/^QT\s+(\d{4})\/(\d{2}\/\d{2})$/);
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
function saveQuotation(d, callerUsername) {
  d = d || {};
  var items = Array.isArray(d.items) ? d.items : [];
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

  var cust = getCustomersFull().filter(function(c) { return c.id === d.customerId; })[0];
  if (!cust) return { success: false, title: "ไม่พบข้อมูล", message: "ไม่พบลูกค้ารายนี้ในระบบ — อาจถูกลบไปแล้ว" };

  var quoteDate  = String(d.quoteDate || "").trim() || new Date().toISOString().slice(0, 10);
  var validDays  = parseInt(d.validDays, 10) || 15;
  var validUntil = new Date(quoteDate + "T00:00:00");
  if (isNaN(validUntil.getTime())) validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + validDays);

  var totals = calcQuoteTotals(cleanItems, d.discPct);
  var user   = callerUsername || getCurrentUsername_();
  var nowIso = new Date().toISOString();

  var quoteNo = "", status = "ร่าง", createdUser = user, createdAt = nowIso;
  if (d.docId) {
    var existingUrl = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
                     + "/databases/(default)/documents/" + QUOTATION_COLLECTION + "/" + d.docId;
    try {
      var existingRes = UrlFetchApp.fetch(existingUrl, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
      if (existingRes.getResponseCode() === 200) {
        var ef = JSON.parse(existingRes.getContentText()).fields || {};
        quoteNo     = parseFirestoreValue(ef.Quote_No)  || "";
        status      = parseFirestoreValue(ef.Status)    || "ร่าง";
        createdUser = parseFirestoreValue(ef.User)      || user;
        createdAt   = parseFirestoreValue(ef.Timestamp) || nowIso;
      }
    } catch (e) {
      console.error("saveQuotation: อ่านข้อมูลเดิมไม่สำเร็จ (จะออกเลขที่ใหม่แทน):", e);
    }
  }

  var dataObject = {
    Quote_Date       : quoteDate,
    Valid_Days       : validDays,
    Valid_Until      : validUntil.toISOString().slice(0, 10),
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
    var editRes = saveMasterData(QUOTATION_COLLECTION, QUOTATION_PREFIX, d.docId, dataObject, null);
    if (editRes.success) updateQuotationYearsMeta_(quoteYearBE);
    return editRes;
  }

  var periodKey = docPeriodKey_(quoteDate);
  var lastErr = "";
  for (var attempt = 0; attempt < 10; attempt++) {
    // ★ FIX (โควตา Firestore Reads): ใช้ตัวนับแทนการสแกน Quotation ทั้ง collection ทุกครั้ง
    //   (ดูคำอธิบายเต็มที่ nextRunningNumber_) — seedFn (getNextQuoteRunningNumber เดิม) จะถูกเรียก
    //   แค่ครั้งเดียวตอนตัวนับของเดือนนี้ยังไม่เคยถูกสร้างเท่านั้น
    var runningNum = nextRunningNumber_("Quotation", periodKey, function() {
      return getNextQuoteRunningNumber(quoteDate, d.docId || null);
    });
    if (runningNum === null) {
      // ตัวนับขัดข้อง (error ชั่วคราว) — fallback กลับไปสแกนแบบเดิมเฉพาะรอบนี้ ไม่ปล่อยให้บันทึกไม่ได้เลย
      runningNum = getNextQuoteRunningNumber(quoteDate, d.docId || null) + attempt;
    }
    var candidateNo = buildQuoteNoForMonth(quoteDate, runningNum);

    // ★ จองเลขที่แบบ atomic ก่อนบันทึกจริง — กันเลขซ้ำเมื่อมีคนออกใบเสนอราคาพร้อมกัน (ดู reserveDocNo_)
    if (!reserveDocNo_("Quotation", candidateNo)) continue;

    dataObject.Quote_No = candidateNo;
    var res = saveMasterData(QUOTATION_COLLECTION, QUOTATION_PREFIX, d.docId || null, dataObject, null);
    if (res.success) {
      updateQuotationYearsMeta_(quoteYearBE);
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
  try { items = JSON.parse(parseFirestoreValue(f.Items_JSON) || "[]"); } catch (e) {}
  return {
    id              : doc.id,
    quoteNo         : parseFirestoreValue(f.Quote_No)          || doc.id,
    quoteDate       : parseFirestoreValue(f.Quote_Date)        || "",
    validUntil      : parseFirestoreValue(f.Valid_Until)       || "",
    validDays       : parseFloat(parseFirestoreValue(f.Valid_Days)) || 0,
    customerId      : parseFirestoreValue(f.Customer_ID)       || "",
    customerName    : parseFirestoreValue(f.Customer_Name)     || "",
    customerType    : parseFirestoreValue(f.Customer_Type)     || "",
    customerAddress : parseFirestoreValue(f.Customer_Address)  || "",
    customerTaxId   : parseFirestoreValue(f.Customer_Tax_ID)   || "",
    customerBranch  : parseFirestoreValue(f.Customer_Branch)   || "",
    customerPhone   : parseFirestoreValue(f.Customer_Phone)    || "",
    vehicleNote     : parseFirestoreValue(f.Vehicle_Note)      || "",
    customerPo      : parseFirestoreValue(f.Customer_PO)       || "",
    items           : items,
    discPct         : parseFloat(parseFirestoreValue(f.Disc_Pct))     || 0,
    subtotal        : parseFloat(parseFirestoreValue(f.Subtotal))     || 0,
    discAmount      : parseFloat(parseFirestoreValue(f.Disc_Amount))  || 0,
    vat             : parseFloat(parseFirestoreValue(f.Vat_Amount))   || 0,
    grandTotal      : parseFloat(parseFirestoreValue(f.Grand_Total))  || 0,
    costTotal       : parseFloat(parseFirestoreValue(f.Cost_Total))   || 0,
    profit          : parseFloat(parseFirestoreValue(f.Profit_Total)) || 0,
    marginPct       : parseFloat(parseFirestoreValue(f.Margin_Pct))   || 0,
    status          : parseFirestoreValue(f.Status)    || "ร่าง",
    note            : parseFirestoreValue(f.Note)      || "",
    user            : parseFirestoreValue(f.User)      || "",
    timestamp       : parseFirestoreValue(f.Timestamp) || "",
    updatedAt       : parseFirestoreValue(f.Updated_At)|| "",
    stockIssued     : parseFirestoreValue(f.Stock_Issued) === "true",
    stockIssueDoc   : parseFirestoreValue(f.Stock_Issue_Doc) || "",
    stockIssuedBy   : parseFirestoreValue(f.Stock_Issued_By) || "",
    stockIssuedAt   : parseFirestoreValue(f.Stock_Issued_At) || ""
  };
}

// ★ FIX (โควตา Firestore Reads): ใช้ตอนเลือกมุมมอง "ทั้งหมด" (ทุกปีรวมกัน) — เดิมสแกนทั้ง
//   collection โดยไม่จำกัด (โตไม่มีที่สิ้นสุดตามอายุร้าน) เปลี่ยนเป็น runQuery + orderBy + limit
//   (เอาล่าสุดก่อน) เหมือน getTaxInvoiceList — ใช้งานปกติควรกรองดูทีละปีผ่าน getQuotationListByYear แทน
function getQuotationList() {
  var list = [];
  try {
    var query = {
      structuredQuery: {
        from    : [{ collectionId: QUOTATION_COLLECTION }],
        orderBy : [{ field: { fieldPath: "Quote_Date" }, direction: "DESCENDING" }],
        limit   : 1500
      }
    };
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents:runQuery";
    var res = UrlFetchApp.fetch(url, {
      method: "post", headers: getAuthHeader(), payload: JSON.stringify(query), muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      (JSON.parse(res.getContentText()) || []).forEach(function(row) {
        if (row.document) list.push(mapQuotationDoc_({ id: row.document.name.split('/').pop(), fields: row.document.fields || {} }));
      });
    } else {
      console.error("getQuotationList HTTP " + res.getResponseCode() + ": " + res.getContentText());
    }
  } catch (e) {
    console.error("getQuotationList error:", e);
  }
  list.sort(function(a, b) { return String(b.quoteNo).localeCompare(String(a.quoteNo)); });
  return list;
}

// ★ FIX (โควตา Firestore Reads): กรองเฉพาะใบเสนอราคาของปีที่เลือกด้วย range query บน Quote_Date
//   ฝั่ง server เลย (pattern เดียวกับ getTaxInvoiceListByYear) แทนการอ่านทั้งหมดมากรองฝั่ง client
function getQuotationListByYear(yearBE) {
  var list = [];
  try {
    var yearAD = yearBE - 543;
    var fromDate = yearAD + "-01-01";
    var toDate   = yearAD + "-12-31";

    var query = {
      structuredQuery: {
        from: [{ collectionId: QUOTATION_COLLECTION }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              { fieldFilter: { field: { fieldPath: "Quote_Date" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: fromDate } } },
              { fieldFilter: { field: { fieldPath: "Quote_Date" }, op: "LESS_THAN_OR_EQUAL",    value: { stringValue: toDate   } } }
            ]
          }
        },
        limit: 1000
      }
    };

    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents:runQuery";
    var res = UrlFetchApp.fetch(url, {
      method: "post", headers: getAuthHeader(), payload: JSON.stringify(query), muteHttpExceptions: true
    });

    if (res.getResponseCode() === 200) {
      var rows = JSON.parse(res.getContentText());
      rows.forEach(function(row) {
        if (row.document) list.push(mapQuotationDoc_({ id: row.document.name.split('/').pop(), fields: row.document.fields || {} }));
      });
    } else {
      console.error("getQuotationListByYear HTTP " + res.getResponseCode() + ": " + res.getContentText());
    }
  } catch (e) {
    console.error("getQuotationListByYear error:", e);
  }
  list.sort(function(a, b) { return String(b.quoteNo).localeCompare(String(a.quoteNo)); });
  return list;
}

var QUOTATION_YEARS_ID = "quotation_years";

// ★ เก็บรายชื่อปี (พ.ศ.) ที่มีใบเสนอราคาอยู่จริง ไว้ใช้สร้างตัวเลือกปีในหน้าเว็บ (pattern เดียวกับ
//   updateTaxInvoiceYearsMeta_ ของใบกำกับภาษี) — เรียกครั้งเดียวตอนบันทึกสำเร็จ ไม่ใช่ทุกครั้งที่โหลดหน้า
function updateQuotationYearsMeta_(yearBE) {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + META_COLLECTION + "/" + QUOTATION_YEARS_ID;
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });

    var years = [];
    if (res.getResponseCode() === 200) {
      var doc = JSON.parse(res.getContentText());
      years = parseFirestoreValue((doc.fields || {}).Years) || [];
      years = years.map(function(y) { return parseInt(y, 10); });
    }
    if (years.indexOf(yearBE) > -1) return;

    years.push(yearBE);
    years.sort(function(a, b) { return b - a; });

    var payload = {
      fields: {
        Years: { arrayValue: { values: years.map(function(y) { return { integerValue: y }; }) } }
      }
    };
    UrlFetchApp.fetch(url + "?updateMask.fieldPaths=Years", {
      method: "patch", headers: getAuthHeader(), payload: JSON.stringify(payload), muteHttpExceptions: true
    });
  } catch (e) {
    console.error("updateQuotationYearsMeta_ error:", e);
  }
}

function getQuotationAvailableYears() {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + META_COLLECTION + "/" + QUOTATION_YEARS_ID;
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      var doc = JSON.parse(res.getContentText());
      var years = parseFirestoreValue((doc.fields || {}).Years) || [];
      years = years.map(function(y) { return parseInt(y, 10); }).sort(function(a, b) { return b - a; });
      if (years.length) return years;
    } else if (res.getResponseCode() === 404) {
      // ★ meta ปียังไม่เคยถูกสร้าง (ใบเสนอราคาเก่าก่อนหน้านี้ไม่เคยบันทึก meta ปีไว้ ต่างจากใบกำกับ
      //   ภาษีที่มี meta นี้มาตั้งแต่แรก) — สแกนหาปีทั้งหมดที่มีข้อมูลอยู่จริงครั้งเดียวเพื่อตั้งต้น
      //   หลังจากนี้ทุกครั้งจะอ่านแค่ meta doc เอกสารเดียว ไม่สแกนซ้ำอีกเลย
      return seedQuotationYearsMeta_();
    }
  } catch (e) {
    console.error("getQuotationAvailableYears error:", e);
  }
  return [new Date().getFullYear() + 543];
}

function seedQuotationYearsMeta_() {
  var years = [];
  try {
    var fetched = fetchAllPagesRaw(QUOTATION_COLLECTION);
    if (fetched.ok) {
      var seen = {};
      fetched.docs.forEach(function(doc) {
        var dateStr = parseFirestoreValue((doc.fields || {}).Quote_Date);
        if (!dateStr) return;
        var y = new Date(dateStr + "T00:00:00").getFullYear() + 543;
        if (!isNaN(y) && !seen[y]) { seen[y] = true; years.push(y); }
      });
    }
  } catch (e) {
    console.error("seedQuotationYearsMeta_ scan error:", e);
  }
  if (!years.length) years.push(new Date().getFullYear() + 543);
  years.sort(function(a, b) { return b - a; });

  try {
    var createUrl = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
                  + "/databases/(default)/documents/" + META_COLLECTION
                  + "?documentId=" + encodeURIComponent(QUOTATION_YEARS_ID);
    UrlFetchApp.fetch(createUrl, {
      method: "post", headers: getAuthHeader(), muteHttpExceptions: true,
      payload: JSON.stringify({ fields: { Years: { arrayValue: { values: years.map(function(y) { return { integerValue: y }; }) } } } })
    });
  } catch (e) {
    console.error("seedQuotationYearsMeta_ write error:", e);
  }
  return years;
}

// ★ FIX (โควตา Firestore Reads): รับ yearFilter เพิ่ม — ค่าเริ่มต้น (ไม่ส่ง/undefined) ใช้ปีปัจจุบัน
//   แทนการดึงใบเสนอราคาทั้งหมดทุกปีเหมือนเดิม (getQuotationList เต็มยังเรียกได้ถ้าส่ง "all" มาชัดเจน)
function getQuotationPageData(yearFilter) {
  var quotationsList;
  if (yearFilter === "all") {
    quotationsList = getQuotationList();
  } else {
    var yearBE = parseInt(yearFilter, 10) || (new Date().getFullYear() + 543);
    quotationsList = getQuotationListByYear(yearBE);
  }
  return {
    quotations     : quotationsList,
    availableYears : getQuotationAvailableYears(),
    customers      : getCustomersFull(),
    products       : getAllProducts(),
    seller         : TAX_INVOICE_SELLER,
    marginMin      : QUOTATION_MARGIN_MIN,
    statuses       : QUOTATION_STATUSES
  };
}

function updateQuotationStatus(docId, status) {
  if (QUOTATION_STATUSES.indexOf(status) === -1) {
    return { success: false, title: "ไม่ถูกต้อง", message: "สถานะไม่ถูกต้อง" };
  }
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + QUOTATION_COLLECTION + "/" + docId
            + "?updateMask.fieldPaths=Status&updateMask.fieldPaths=Updated_At";
    var res = UrlFetchApp.fetch(url, {
      method  : "patch",
      headers : getAuthHeader(),
      payload : JSON.stringify({ fields: mapToFirestoreFields({ Status: status, Updated_At: new Date().toISOString() }) }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      clearCollectionCache(QUOTATION_COLLECTION);
      return { success: true, title: "สำเร็จ", message: "เปลี่ยนสถานะเรียบร้อย" };
    }
    return { success: false, title: "ล้มเหลว", message: res.getContentText() };
  } catch (e) {
    return { success: false, title: "ข้อผิดพลาด", message: e.message };
  }
}

function deleteQuotation(docId) { return deleteFirestoreDocument(QUOTATION_COLLECTION, docId); }

/**
 * ★ ทำเครื่องหมายว่าใบเสนอราคานี้ถูกตัดสต๊อกไปแล้ว (เรียกจากหน้าตัดสต๊อกหลังยืนยันตัดสต๊อกสำเร็จ
 *   ที่มาจากปุ่ม "ตัดสต๊อกจากใบนี้" ในหน้าใบเสนอราคา) — ใช้ updateMask ให้กระทบแค่ 4 ฟิลด์นี้
 *   ไม่ทับข้อมูลอื่นของใบเสนอราคา (ต่างจาก saveMasterData ที่ PATCH แบบไม่มี updateMask)
 */
function markQuotationStockIssued(docId, docNo, callerUsername) {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + QUOTATION_COLLECTION + "/" + docId
            + "?updateMask.fieldPaths=Stock_Issued&updateMask.fieldPaths=Stock_Issue_Doc"
            + "&updateMask.fieldPaths=Stock_Issued_By&updateMask.fieldPaths=Stock_Issued_At";
    var res = UrlFetchApp.fetch(url, {
      method  : "patch",
      headers : getAuthHeader(),
      payload : JSON.stringify({ fields: mapToFirestoreFields({
        Stock_Issued    : "true",
        Stock_Issue_Doc : String(docNo || ""),
        Stock_Issued_By : callerUsername || getCurrentUsername_(),
        Stock_Issued_At : new Date().toISOString()
      }) }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      clearCollectionCache(QUOTATION_COLLECTION);
      return { success: true };
    }
    return { success: false, message: res.getContentText() };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ==========================================
// 17. Master — Zones
// ==========================================
function saveZone(d) {
  var dataObject = {
    Area    : String(d.area    || ""),
    Build   : String(d.build   || ""),
    Floor   : String(d.floor   || ""),
    Rack_no : String(d.rackNo  || ""),
    Note    : String(d.note    || ""),
    Car_ID  : String(d.carId   || ""),
    Status  : String(d.status  || "Active")
  };
  return saveMasterData("Master_Zones", "Z", d.docId || null, dataObject, d.area);
}

function getZoneById(docId) {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Master_Zones/" + docId;
    var res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: getAuthHeader(),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      var doc = JSON.parse(res.getContentText());
      var f   = doc.fields || {};
      return {
        id      : docId,
        Area    : parseFirestoreValue(f.Area)    || "",
        Build   : parseFirestoreValue(f.Build)   || "",
        Floor   : parseFirestoreValue(f.Floor)   || "",
        Rack_no : parseFirestoreValue(f.Rack_no) || "",
        Note    : parseFirestoreValue(f.Note)    || "",
        Car_ID  : parseFirestoreValue(f.Car_ID)  || "",
        Status  : parseFirestoreValue(f.Status)  || ""
      };
    }
  } catch (e) {
    console.error("getZoneById error:", e);
  }
  return null;
}

function getZonesFull() {
  var list = [];
  try {
    var docs = fetchCollectionDocsCached("Master_Zones");
    docs.forEach(function(doc) {
      var f = doc.fields || {};
      list.push({
        id      : doc.id,
        Area    : parseFirestoreValue(f.Area)    || "",
        Build   : parseFirestoreValue(f.Build)   || "",
        Floor   : parseFirestoreValue(f.Floor)   || "",
        Rack_no : parseFirestoreValue(f.Rack_no) || "",
        Note    : parseFirestoreValue(f.Note)    || "",
        Car_ID  : parseFirestoreValue(f.Car_ID)  || "",
        Status  : parseFirestoreValue(f.Status)  || ""
      });
    });
  } catch (e) {
    console.error("getZonesFull error:", e);
  }
  return list;
}

function deleteZone(docId) { return deleteFirestoreDocument("Master_Zones", docId); }

// ==========================================
// 18. Master — Cars
// ==========================================
function saveCar(d) {
  var dataObject = {
    Brand    : String(d.brand   || ""),
    Type_Car : String(d.typeCar || ""),
    Model    : String(d.model   || ""),
    Year     : String(d.year    || "")
  };
  return saveMasterData("Master_Cars", "CAR", d.docId || null, dataObject, d.brand);
}

function getCarsFull() {
  var list = [];
  try {
    var docs = fetchCollectionDocsCached("Master_Cars");
    docs.forEach(function(doc) {
      var f = doc.fields || {};
      list.push({
        id       : doc.id,
        Brand    : parseFirestoreValue(f.Brand)    || "",
        Type_Car : parseFirestoreValue(f.Type_Car) || "",
        Model    : parseFirestoreValue(f.Model)    || "",
        Year     : parseFirestoreValue(f.Year)     || ""
      });
    });
  } catch (e) {
    console.error("getCarsFull error:", e);
  }
  return list;
}

function deleteCar(docId) { return deleteFirestoreDocument("Master_Cars", docId); }

// ==========================================
// 19. Include HTML
// ==========================================
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ==========================================
// 19b. ★ ระบบสำรองข้อมูล (Backup / Restore)
// ==========================================
var BACKUP_FOLDER_NAME  = "SYY Shop - Backups";
var BACKUP_KEEP_COUNT   = 8;
var BACKUP_COLLECTIONS  = [
  "Master_Brands", "Master_Categories", "Master_Vendors", "Master_Customers",
  "Master_Zones", "Master_Cars", "Master_Products", "Master_Tax_Invoice", "Purchase_Orders"
];

function getOrCreateBackupFolder() {
  var folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

function backupAllDataToBackup() {
  var result = { success: true, collections: {}, errors: [] };
  var snapshot = {};

  BACKUP_COLLECTIONS.forEach(function(collectionName) {
    try {
      var fetched = fetchAllPagesRaw(collectionName);
      if (fetched.ok) {
        snapshot[collectionName] = fetched.docs;
        result.collections[collectionName] = fetched.docs.length;
      } else {
        result.errors.push(collectionName + ": ดึงข้อมูลไม่สำเร็จ");
        snapshot[collectionName] = [];
      }
    } catch (e) {
      result.errors.push(collectionName + ": " + e.message);
      snapshot[collectionName] = [];
      console.error("backupAllDataToBackup " + collectionName + " error:", e);
    }
  });

  var backupPayload = {
    backupDate    : new Date().toISOString(),
    projectId     : PROJECT_ID,
    collections   : snapshot
  };

  try {
    var folder   = getOrCreateBackupFolder();
    var fileName = "syy-shop-backup_" + Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd_HH-mm") + ".json";
    var jsonStr  = JSON.stringify(backupPayload);
    folder.createFile(fileName, jsonStr, MimeType.PLAIN_TEXT);

    result.fileName = fileName;
    result.fileSizeKB = Math.round(jsonStr.length / 1024);

    cleanupOldBackups(folder);

  } catch (e) {
    result.success = false;
    result.errors.push("บันทึกไฟล์ลง Drive ไม่สำเร็จ: " + e.message);
    console.error("backupAllDataToBackup save error:", e);
  }

  if (result.errors.length > 0 && result.success) {
    result.success = false;
  }

  return result;
}

function cleanupOldBackups(folder) {
  try {
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
      fileList[i].file.setTrashed(true);
    }
  } catch (e) {
    console.error("cleanupOldBackups error:", e);
  }
}

function backupNow() {
  return backupAllDataToBackup();
}

function weeklyBackupJob() {
  var result = backupAllDataToBackup();
  if (!result.success) {
    console.error("weeklyBackupJob ล้มเหลวบางส่วน:", JSON.stringify(result.errors));
  }
}

function setupWeeklyBackupTrigger() {
  removeWeeklyBackupTrigger();
  ScriptApp.newTrigger("weeklyBackupJob")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(2)
    .create();
  return "ตั้งเวลา backup อัตโนมัติทุกวันอาทิตย์ เวลา 02:00 น. เรียบร้อยแล้ว";
}

function removeWeeklyBackupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === "weeklyBackupJob") ScriptApp.deleteTrigger(t);
  });
}

function listBackupFiles() {
  var list = [];
  try {
    var folder = getOrCreateBackupFolder();
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
    console.error("listBackupFiles error:", e);
  }
  return list;
}

function restoreFromBackup(fileId, restoreMode) {
  var result = { success: true, restored: {}, errors: [] };
  try {
    var file = DriveApp.getFileById(fileId);
    var backupData = JSON.parse(file.getBlob().getDataAsString());
    var collectionsToRestore = (restoreMode && restoreMode !== "all")
      ? [restoreMode]
      : Object.keys(backupData.collections || {});

    collectionsToRestore.forEach(function(collectionName) {
      var docs = (backupData.collections || {})[collectionName] || [];
      var restoredCount = 0, failedCount = 0;

      docs.forEach(function(doc) {
        try {
          var fieldNames = Object.keys(doc.fields || {});
          var maskParams = fieldNames.map(function(fn) {
            return "updateMask.fieldPaths=" + encodeURIComponent(fn);
          }).join("&");
          var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
                  + "/databases/(default)/documents/" + collectionName + "/" + doc.id
                  + (maskParams ? "?" + maskParams : "");
          var res = UrlFetchApp.fetch(url, {
            method             : "patch",
            headers            : getAuthHeader(),
            payload            : JSON.stringify({ fields: doc.fields }),
            muteHttpExceptions : true
          });
          if (res.getResponseCode() === 200) restoredCount++;
          else failedCount++;
        } catch (e) {
          failedCount++;
        }
      });

      result.restored[collectionName] = { restored: restoredCount, failed: failedCount };
      if (failedCount > 0) result.errors.push(collectionName + ": กู้คืนไม่สำเร็จ " + failedCount + " รายการ");

      clearCollectionCache(collectionName);
    });

    if (result.errors.length > 0) result.success = false;

  } catch (e) {
    result.success = false;
    result.errors.push("อ่านไฟล์ backup ไม่สำเร็จ: " + e.message);
    console.error("restoreFromBackup error:", e);
  }
  return result;
}

// ==========================================
// 20. ทดสอบการเชื่อมต่อ
// ==========================================
// ==========================================
// 21. Migrate ข้อมูลเก่า Car_ID เดี่ยว → Car_IDs array
// ==========================================
function migrateCarIdToCarIds() {
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Master_Products?pageSize=300";
    var res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: getAuthHeader(),
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

      var legacyCarId = parseFirestoreValue(f.Car_ID);
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
        headers: getAuthHeader(),
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
function getLowStockProductsForOrder() {
  return buildLowStockList(buildVendorMap());
}

function buildLowStockList(vendorMap) {
  var result = [];
  try {
    var products = getAllProducts();
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
  } catch (e) {
    console.error("buildLowStockList error:", e);
  }
  return result;
}

function savePurchaseOrder(d) {
  var items = Array.isArray(d.items) ? d.items : [];
  if (!d.vendorId)   return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณาระบุผู้จัดจำหน่าย" };
  if (!items.length) return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณาเลือกสินค้าอย่างน้อย 1 รายการ" };

  var totalQty = 0, totalAmount = 0;
  items = items.map(function(it) {
    var qty  = parseFloat(it.qty       || 0);
    var cost = parseFloat(it.costPrice || 0);
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

  var dataObject = {
    Vendor_ID     : String(d.vendorId  || ""),
    Order_Date    : String(d.orderDate || new Date().toISOString().slice(0, 10)),
    Status        : String(d.status    || "Pending"),
    Items_JSON    : JSON.stringify(items),
    Receipts_JSON : JSON.stringify([]),
    Total_Qty     : totalQty,
    Total_Amount  : totalAmount,
    Note          : String(d.note || "")
  };

  return saveMasterData("Purchase_Orders", "PO", null, dataObject, null);
}

function buildVendorMap() {
  var vendorMap = {};
  getVendorsFull().forEach(function(v) { vendorMap[v.id] = v; });
  return vendorMap;
}

function getPurchaseOrders() {
  return buildPurchaseOrderList(buildVendorMap());
}

// ★ FIX (โควตา Firestore Reads): เดิมสแกน Purchase_Orders ทั้ง collection ทุกครั้ง (ทั้งหน้า PO เอง
//   และตอน dashboard เรียก getDashboardBootstrap) เปลี่ยนเป็น runQuery + orderBy + limit เหมือนจุดอื่น
function buildPurchaseOrderList(vendorMap) {
  var list = [];
  try {
    var query = {
      structuredQuery: {
        from    : [{ collectionId: "Purchase_Orders" }],
        orderBy : [{ field: { fieldPath: "Order_Date" }, direction: "DESCENDING" }],
        limit   : 1000
      }
    };
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents:runQuery";
    var res = UrlFetchApp.fetch(url, {
      method: "post", headers: getAuthHeader(), payload: JSON.stringify(query), muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      (JSON.parse(res.getContentText()) || []).forEach(function(row) {
        if (!row.document) return;
        var id = row.document.name.split('/').pop();
        var f  = row.document.fields || {};
        var vendorId = parseFirestoreValue(f.Vendor_ID) || "";
        var v        = vendorMap[vendorId] || {};

        var items = [];
        try { items = JSON.parse(parseFirestoreValue(f.Items_JSON) || "[]"); } catch (e) { items = []; }

        var receipts = [];
        try { receipts = JSON.parse(parseFirestoreValue(f.Receipts_JSON) || "[]"); } catch (e) { receipts = []; }

        list.push({
          poId          : id,
          vendorId      : vendorId,
          vendorName    : v.Vendor_name  || vendorId,
          vendorContact : v.Contact_name || "",
          vendorPhone   : v.Phone        || "",
          vendorEmail   : v.Email        || "",
          vendorAddress : v.Address      || "",
          vendorTaxId   : v.Tax_ID       || "",
          vendorBranch  : v.Branch       || "",
          orderDate     : parseFirestoreValue(f.Order_Date) || "",
          status        : parseFirestoreValue(f.Status)     || "Pending",
          items         : items,
          receipts      : receipts,
          totalQty      : parseFloat(parseFirestoreValue(f.Total_Qty)    || 0),
          totalAmount   : parseFloat(parseFirestoreValue(f.Total_Amount) || 0),
          note          : parseFirestoreValue(f.Note) || ""
        });
      });
    } else {
      console.error("buildPurchaseOrderList HTTP " + res.getResponseCode() + ": " + res.getContentText());
    }
  } catch (e) {
    console.error("buildPurchaseOrderList error:", e);
  }

  list.sort(function(a, b) { return b.poId.localeCompare(a.poId); });
  return list;
}

function getPurchaseOrderPageData() {
  var vendorMap = buildVendorMap();
  return {
    lowStockItems  : buildLowStockList(vendorMap),
    purchaseOrders : buildPurchaseOrderList(vendorMap)
  };
}

function updatePurchaseOrderStatus(docId, newStatus) {
  try {
    if (newStatus === "Received" || newStatus === "PartiallyReceived") {
      return { success: false, title: "ไม่อนุญาต", message: "กรุณาใช้ปุ่ม '📥 รับสินค้า' เพื่อบันทึกการรับสินค้าแทน" };
    }

    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Purchase_Orders/" + docId;
    var getRes = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
    if (getRes.getResponseCode() !== 200) {
      return { success: false, title: "ไม่พบข้อมูล", message: "ไม่พบใบสั่งซื้อนี้" };
    }
    var currentStatus = parseFirestoreValue((JSON.parse(getRes.getContentText()).fields || {}).Status) || "Pending";

    if (currentStatus === "Received") {
      return { success: false, title: "ไม่อนุญาต", message: "ใบสั่งซื้อนี้ได้รับสินค้าครบแล้ว ไม่สามารถเปลี่ยนสถานะได้อีก" };
    }
    if (newStatus === "Cancelled" && currentStatus === "PartiallyReceived") {
      return { success: false, title: "ไม่อนุญาต", message: "ใบสั่งซื้อนี้มีการรับสินค้าบางส่วนแล้ว ไม่สามารถยกเลิกได้" };
    }

    var payload = { fields: { Status: { stringValue: String(newStatus || "Pending") } } };
    var res = UrlFetchApp.fetch(url + "?updateMask.fieldPaths=Status", {
      method             : "patch",
      headers            : getAuthHeader(),
      payload            : JSON.stringify(payload),
      muteHttpExceptions : true
    });
    return res.getResponseCode() === 200
      ? { success: true,  title: "สำเร็จ",       message: "อัปเดตสถานะเรียบร้อย" }
      : { success: false, title: "ล้มเหลว",       message: res.getContentText() };
  } catch (e) {
    return { success: false, title: "ข้อผิดพลาด", message: e.message };
  }
}

function incrementProductStockBatch(items) {
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
      headers           : getAuthHeader(),
      payload           : JSON.stringify({ writes: writes }),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() === 200) return true;
    console.error("incrementProductStockBatch HTTP " + res.getResponseCode() + ": " + res.getContentText());
    return false;
  } catch (e) {
    console.error("incrementProductStockBatch error:", e);
    return false;
  }
}

function receiveGoods(d, callerUsername) {
  function fail(msg) { return { success: false, title: "ข้อมูลไม่ครบ", message: msg }; }

  try {
    if (!d.poId)                                return fail("ไม่พบเลขที่ใบสั่งซื้อ");
    if (!String(d.invoiceNo    || "").trim())   return fail("กรุณากรอกเลขที่ Invoice");
    if (!String(d.receiptDate  || "").trim())   return fail("กรุณาระบุวันที่รับสินค้า");
    if (!String(d.receiverName || "").trim())   return fail("กรุณากรอกชื่อผู้รับสินค้า");

    var reqItems = Array.isArray(d.items) ? d.items : [];
    if (!reqItems.length) return fail("ไม่มีรายการสินค้าที่จะรับ");

    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Purchase_Orders/" + d.poId;
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return fail("ไม่พบใบสั่งซื้อนี้");

    var f = JSON.parse(res.getContentText()).fields || {};
    var currentStatus = parseFirestoreValue(f.Status) || "Pending";
    if (currentStatus === "Received")  return fail("ใบสั่งซื้อนี้ได้รับสินค้าครบแล้ว ไม่สามารถบันทึกรับซ้ำได้");
    if (currentStatus === "Cancelled") return fail("ใบสั่งซื้อนี้ถูกยกเลิกแล้ว ไม่สามารถรับสินค้าได้");

    var poItems = [];
    try { poItems = JSON.parse(parseFirestoreValue(f.Items_JSON) || "[]"); } catch (e) { poItems = []; }

    var receiveMap = {};
    reqItems.forEach(function(it) { receiveMap[it.productCode] = parseFloat(it.qtyReceivedNow || 0); });

    var allComplete = true;
    var receiptLineItems = [];
    var stockAdditions   = [];

    poItems = poItems.map(function(it) {
      var alreadyReceived = parseFloat(it.receivedQty || 0);
      var ordered          = parseFloat(it.qty || 0);
      var remaining         = Math.max(ordered - alreadyReceived, 0);
      var receiveNow         = receiveMap.hasOwnProperty(it.productCode) ? receiveMap[it.productCode] : 0;

      if (receiveNow < 0) receiveNow = 0;
      if (receiveNow > remaining) receiveNow = remaining;

      var newReceived = alreadyReceived + receiveNow;
      if (newReceived < ordered) allComplete = false;

      if (receiveNow > 0) {
        receiptLineItems.push({ productCode: it.productCode, productName: it.productName, qtyReceivedNow: receiveNow });
        stockAdditions.push({ productCode: it.productCode, productName: it.productName, qty: receiveNow });
      }

      it.receivedQty = newReceived;
      return it;
    });

    if (!receiptLineItems.length) return fail("กรุณาระบุจำนวนที่รับอย่างน้อย 1 รายการ");

    if (!allComplete && !String(d.deliveryNoteNo || "").trim()) {
      return fail("กรุณากรอกเลขที่ใบส่งของชั่วคราว เนื่องจากได้รับสินค้าไม่ครบตามจำนวนที่สั่งซื้อ");
    }

    // ★ ใช้ logStockIn_ (เขียน Stock_Movements ด้วย) แทน incrementProductStockBatch เดิม
    //   เพื่อให้ฝั่งรับของมีประวัติเข้า-ออกเหมือนฝั่งตัดสต๊อก
    if (!logStockIn_(stockAdditions, "รับของตาม PO", d.poId, callerUsername)) {
      return { success: false, title: "ล้มเหลว", message: "อัปเดตสต็อกสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง (ยังไม่มีการบันทึกการรับสินค้า)" };
    }

    var receipts = [];
    try { receipts = JSON.parse(parseFirestoreValue(f.Receipts_JSON) || "[]"); } catch (e) { receipts = []; }
    receipts.push({
      date           : d.receiptDate,
      invoiceNo      : d.invoiceNo,
      receiverName   : d.receiverName,
      deliveryNoteNo : allComplete ? "" : String(d.deliveryNoteNo || ""),
      isFinal        : allComplete,
      items          : receiptLineItems
    });

    var newStatus = allComplete ? "Received" : "PartiallyReceived";
    var payload = {
      fields: {
        Items_JSON    : { stringValue: JSON.stringify(poItems) },
        Receipts_JSON : { stringValue: JSON.stringify(receipts) },
        Status        : { stringValue: newStatus }
      }
    };
    var patchUrl = url
      + "?updateMask.fieldPaths=Items_JSON"
      + "&updateMask.fieldPaths=Receipts_JSON"
      + "&updateMask.fieldPaths=Status";
    var patchRes = UrlFetchApp.fetch(patchUrl, {
      method             : "patch",
      headers            : getAuthHeader(),
      payload            : JSON.stringify(payload),
      muteHttpExceptions : true
    });

    if (patchRes.getResponseCode() !== 200) {
      return { success: false, title: "ล้มเหลว", message: patchRes.getContentText() };
    }

    return {
      success : true,
      title   : "สำเร็จ",
      message : allComplete
                  ? "บันทึกรับสินค้าครบถ้วน และอัปเดตสต็อกเรียบร้อย"
                  : "บันทึกรับสินค้าบางส่วน และอัปเดตสต็อกเรียบร้อย",
      status  : newStatus
    };
  } catch (e) {
    return { success: false, title: "ข้อผิดพลาด", message: e.message };
  }
}

function deletePurchaseOrder(docId) {
  return deleteFirestoreDocument("Purchase_Orders", docId);
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
  var payload = {
    username  : user.Username,
    fullName  : user.Full_Name,
    role      : user.Role,
    issuedAt  : Date.now()
  };
  CacheService.getScriptCache().put("sess_" + token, JSON.stringify(payload), AUTH_SESSION_HOURS * 3600);
  return { token: token, profile: payload };
}

// ★ เพิกถอน session ที่ออกไปแล้วทั้งหมดของผู้ใช้คนนี้ทันที (เรียกตอนปิดบัญชี/เปลี่ยนสิทธิ์/รีเซ็ตรหัสผ่าน)
//   ไม่ได้ลบ cache key ของ session ตรงๆ เพราะไม่รู้ token ของ session ที่ออกไปแล้ว — เก็บ "เวลาที่เพิกถอน"
//   ไว้แทน แล้วให้ getSession_() เทียบกับ issuedAt ของ session นั้นๆ ทุกครั้งที่ใช้งาน
function revokeUserSessions_(username) {
  var uname = String(username || "").trim().toLowerCase();
  if (!uname) return;
  CacheService.getScriptCache().put("revoked_" + uname, String(Date.now()), AUTH_SESSION_HOURS * 3600);
}

function getSession_(token, userAgent) {
  if (!token) return null;
  try {
    var raw = CacheService.getScriptCache().get("sess_" + token);
    if (!raw) return null;
    var session = JSON.parse(raw);

    var revokedAt = CacheService.getScriptCache().get("revoked_" + String(session.username || "").trim().toLowerCase());
    if (revokedAt && parseInt(revokedAt, 10) >= session.issuedAt) {
      return null;
    }

    return session;
  } catch (e) {
    return null;
  }
}

function destroySession_(token) {
  if (token) CacheService.getScriptCache().remove("sess_" + token);
}

// ★ FIX (โควตา Firestore Reads): เดิมอ่าน Master_Users ทั้ง collection สดทุกครั้งที่ login/เช็คอีเมล
//   (ไม่มี cache เลย ทั้งที่ clearCollectionCache(Master_Users) ถูกเรียกอยู่แล้วทุกจุดที่แก้ไขบัญชี —
//   ดู updateUserFields_/saveMasterData) เปลี่ยนมาใช้ fetchCollectionDocsCached แทน (6 ชม. + invalidate
//   อัตโนมัติเมื่อมีการแก้ไขบัญชีจริง) — ผลพลอยได้อีกอย่าง: ตอนนี้ถ้า Firestore quota เต็มพอดี
//   login ยัง "ใช้ cache เดิมที่ยังไม่หมดอายุ" ต่อได้ ไม่ล่มพร้อมกันไปกับฟีเจอร์อื่นเหมือนเดิม
function findUserByUsername_(username) {
  var uname = String(username || "").trim().toLowerCase();
  if (!uname) return null;
  try {
    var docs = fetchCollectionDocsCached(AUTH_USERS_COLLECTION);
    for (var i = 0; i < docs.length; i++) {
      var f = docs[i].fields || {};
      if (String(parseFirestoreValue(f.Username) || "").toLowerCase() === uname) {
        return {
          docId           : docs[i].id,
          Username        : parseFirestoreValue(f.Username) || "",
          Full_Name       : parseFirestoreValue(f.Full_Name) || "",
          Email           : parseFirestoreValue(f.Email) || "",
          Password_Hash   : parseFirestoreValue(f.Password_Hash) || "",
          Salt            : parseFirestoreValue(f.Salt) || "",
          Role            : parseFirestoreValue(f.Role) || "viewer",
          Status          : parseFirestoreValue(f.Status) || "Active",
          Totp_Enabled    : String(parseFirestoreValue(f.Totp_Enabled) || "") === "true",
          Totp_Secret_Enc : parseFirestoreValue(f.Totp_Secret_Enc) || "",
          Recovery_Codes  : parseFirestoreValue(f.Recovery_Codes) || "",
          Failed_Attempts : parseInt(parseFirestoreValue(f.Failed_Attempts) || 0, 10),
          Locked_Until    : parseFirestoreValue(f.Locked_Until) || "",
          Password_Changed_At  : parseFirestoreValue(f.Password_Changed_At) || "",
          Must_Change_Password : String(parseFirestoreValue(f.Must_Change_Password) || "") === "true"
        };
      }
    }
  } catch (e) {
    console.error("findUserByUsername_ error:", e);
  }
  return null;
}

function findUserByEmail_(email) {
  var target = String(email || "").trim().toLowerCase();
  if (!target) return null;
  try {
    var docs = fetchCollectionDocsCached(AUTH_USERS_COLLECTION);
    for (var i = 0; i < docs.length; i++) {
      var f = docs[i].fields || {};
      if (String(parseFirestoreValue(f.Email) || "").toLowerCase() === target) {
        return findUserByUsername_(parseFirestoreValue(f.Username) || "");
      }
    }
  } catch (e) {
    console.error("findUserByEmail_ error:", e);
  }
  return null;
}

function updateUserFields_(docId, fieldsObj) {
  try {
    var names = Object.keys(fieldsObj);
    if (!names.length) return false;
    var mask = names.map(function (n) { return "updateMask.fieldPaths=" + encodeURIComponent(n); }).join("&");
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + AUTH_USERS_COLLECTION + "/" + docId + "?" + mask;
    var res = UrlFetchApp.fetch(url, {
      method             : "patch",
      headers            : getAuthHeader(),
      payload            : JSON.stringify({ fields: mapToFirestoreFields(fieldsObj) }),
      muteHttpExceptions : true
    });
    clearCollectionCache(AUTH_USERS_COLLECTION);
    return res.getResponseCode() === 200;
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
    var list = JSON.parse(user.Recovery_Codes || "[]");
    var target = hashPassword_(String(code).trim().toUpperCase(), "recovery");
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (safeEquals_(list[i], target)) { idx = i; break; }
    }
    if (idx === -1) return false;
    list.splice(idx, 1);
    updateUserFields_(user.docId, { Recovery_Codes: JSON.stringify(list) });
    return true;
  } catch (e) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// 23.8 Login
// ─────────────────────────────────────────────────────────────
function authLogin(username, password, otpCode, userAgent) {
  try {
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
      var attempts = (user.Failed_Attempts || 0) + 1;
      var upd = { Failed_Attempts: attempts };
      if (attempts >= AUTH_MAX_ATTEMPTS) {
        upd.Locked_Until = new Date(Date.now() + AUTH_LOCK_MINUTES * 60000).toISOString();
        upd.Failed_Attempts = 0;
        updateUserFields_(user.docId, upd);
        return { success: false, message: "กรอกรหัสผิดเกิน " + AUTH_MAX_ATTEMPTS + " ครั้ง บัญชีถูกล็อก " + AUTH_LOCK_MINUTES + " นาที" };
      }
      updateUserFields_(user.docId, upd);
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
        var a2 = (user.Failed_Attempts || 0) + 1;
        var u2 = { Failed_Attempts: a2 };
        if (a2 >= AUTH_MAX_ATTEMPTS) {
          u2.Locked_Until = new Date(Date.now() + AUTH_LOCK_MINUTES * 60000).toISOString();
          u2.Failed_Attempts = 0;
        }
        updateUserFields_(user.docId, u2);
        return { success: false, needOtp: true, message: "รหัส OTP ไม่ถูกต้อง" };
      }
    }

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
        JSON.stringify({ username: user.Username, docId: user.docId }),
        600
      );
      return {
        success            : false,
        needPasswordChange : true,
        tempToken          : tempToken,
        message            : "กรุณาตั้งรหัสผ่านใหม่ก่อนเข้าใช้งาน (รหัสผ่านหมดอายุ หรือเป็นการเข้าใช้งานครั้งแรก)"
      };
    }

    updateUserFields_(user.docId, {
      Failed_Attempts : 0,
      Locked_Until    : "",
      Last_Login      : new Date().toISOString()
    });

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

function authLogout(token) {
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
  getQuotationPageData     : "viewer",

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
  getAllProducts            : getAllProducts,
  getAllMasterDropdowns     : getAllMasterDropdowns,
  getBrands                 : getBrands,
  getCategories             : getCategories,
  getVendorsFull            : getVendorsFull,
  getCustomersFull          : getCustomersFull,
  getZonesFull              : getZonesFull,
  getCarsFull               : getCarsFull,
  getPurchaseOrderPageData  : getPurchaseOrderPageData,
  getTaxInvoicePageData     : getTaxInvoicePageData,
  getQuotationPageData      : getQuotationPageData,
  saveBrand                 : saveBrand,
  saveCategory              : saveCategory,
  saveVendor                : saveVendor,
  saveCustomer              : saveCustomer,
  saveZone                  : saveZone,
  saveCar                   : saveCar,
  saveProduct               : saveProduct,
  uploadProductImage        : uploadProductImage,
  deleteProductImage        : deleteProductImage,
  generateProductBarcode    : generateProductBarcode,
  saveMasterData            : saveMasterData,
  savePurchaseOrder         : savePurchaseOrder,
  receiveGoods              : receiveGoods,
  updatePurchaseOrderStatus : updatePurchaseOrderStatus,
  issueStock                : issueStock,
  getStockMovements         : getStockMovements,
  getDashboardBootstrap     : getDashboardBootstrap,
  saveTaxInvoice            : saveTaxInvoice,
  deleteTaxInvoice          : deleteTaxInvoice,
  saveQuotation             : saveQuotation,
  updateQuotationStatus     : updateQuotationStatus,
  deleteQuotation           : deleteQuotation,
  markQuotationStockIssued  : markQuotationStockIssued,
  deleteBrand               : deleteBrand,
  deleteCategory            : deleteCategory,
  deleteVendor              : deleteVendor,
  deleteCustomer            : deleteCustomer,
  deleteZone                : deleteZone,
  deleteCar                 : deleteCar,
  deleteProduct             : deleteProduct,
  deletePurchaseOrder       : deletePurchaseOrder,
  backupNow                 : backupNow,
  listBackupFiles           : listBackupFiles,
  getActivityLog            : getActivityLog,
  getAllUsers               : getAllUsers,
  createUserAccount         : createUserAccount,
  updateUserAccount         : updateUserAccount,
  resetUserPassword         : resetUserPassword,
  toggleUserStatus          : toggleUserStatus,
  authGetMyProfile          : authGetMyProfile,
  authChangePassword        : authChangePassword,
  authLogout                : authLogout,
  authStartTotpSetup        : authStartTotpSetup,
  authConfirmTotpSetup      : authConfirmTotpSetup,
  authDisableTotp           : authDisableTotp
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

    var payload = { fields: mapToFirestoreFields(dataObject) };
    UrlFetchApp.fetch(
      "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/" + ACTIVITY_LOG_COLLECTION,
      { method: "post", headers: getAuthHeader(), payload: JSON.stringify(payload), muteHttpExceptions: true }
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

    var required = API_REGISTRY[fnName];
    if (!required) {
      console.error("apiGateway: พยายามเรียกฟังก์ชันที่ไม่อนุญาต:", fnName, "โดย", session.username);
      return { success: false, message: "ไม่อนุญาตให้เรียกใช้งานฟังก์ชันนี้" };
    }

    var userRank = ROLE_RANK[session.role] || 0;
    var needRank = ROLE_RANK[required] || 99;
    if (userRank < needRank) {
      return { success: false, message: "สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้" };
    }

    var a = args || [];

    if (fnName === "saveMasterData" && SAVE_MASTER_ALLOWED.indexOf(a[0]) === -1) {
      return { success: false, message: "ไม่อนุญาตให้บันทึกข้อมูลลงชุดข้อมูลนี้" };
    }

    // inject username ของผู้เรียกจาก session สำหรับฟังก์ชันที่ต้องกันแก้ไขบัญชีตัวเอง
    // (issueStock/receiveGoods/saveQuotation ก็ใช้ช่องทางเดียวกันนี้ เพื่อบันทึก User จริงลง Stock_Movements/Quotations)
    if (fnName === "resetUserPassword" || fnName === "toggleUserStatus" || fnName === "updateUserAccount" ||
        fnName === "issueStock" || fnName === "receiveGoods" || fnName === "saveQuotation" ||
        fnName === "markQuotationStockIssued") {
      a = a.slice();
      a.push(session.username);
    }

    var fn = API_FUNCTIONS[fnName];
    if (typeof fn !== "function") {
      console.error("apiGateway: ไม่พบฟังก์ชันจริงสำหรับ", fnName, "(อยู่ใน API_REGISTRY แต่ไม่มีใน API_FUNCTIONS — ตรวจ Code.gs)");
      return { success: false, message: "เกิดข้อผิดพลาดภายในระบบ กรุณาแจ้งผู้ดูแลระบบ" };
    }
    var result = fn.apply(null, a);

    logActivity_(session.username, fnName, a, result);

    return result;

  } catch (e) {
    console.error("apiGateway error [" + fnName + "]:", e);
    return { success: false, message: friendlyErrorMessage_(e) };
  }
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
function getActivityLog(limitCount) {
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
      method: "post", headers: getAuthHeader(), payload: JSON.stringify(query), muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      (JSON.parse(res.getContentText()) || []).forEach(function (row) {
        if (!row.document) return;
        var f = row.document.fields || {};
        list.push({
          id        : row.document.name.split('/').pop(),
          username  : parseFirestoreValue(f.Username)  || "",
          action    : parseFirestoreValue(f.Action)    || "",
          label     : parseFirestoreValue(f.Label)      || "",
          docId     : parseFirestoreValue(f.DocId)      || "",
          success   : String(parseFirestoreValue(f.Success) || "") === "true",
          timestamp : parseFirestoreValue(f.Timestamp)  || ""
        });
      });
    } else {
      console.error("getActivityLog HTTP " + res.getResponseCode() + ": " + res.getContentText());
    }
  } catch (e) {
    console.error("getActivityLog error:", e);
  }
  return list;
}

function cleanupOldActivityLogs() {
  var deleted = 0;
  try {
    var cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - ACTIVITY_LOG_KEEP_MONTHS);

    var fetched = fetchAllPagesRaw(ACTIVITY_LOG_COLLECTION);
    if (!fetched.ok) return { success: false, deleted: 0 };

    fetched.docs.forEach(function (doc) {
      var f = doc.fields || {};
      var ts = new Date(parseFirestoreValue(f.Timestamp) || "");
      if (!isNaN(ts.getTime()) && ts < cutoff) {
        deleteFirestoreDocument(ACTIVITY_LOG_COLLECTION, doc.id);
        deleted++;
      }
    });
  } catch (e) {
    console.error("cleanupOldActivityLogs error:", e);
  }
  return { success: true, deleted: deleted };
}

function setupActivityLogCleanupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === "cleanupOldActivityLogs") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("cleanupOldActivityLogs").timeBased().everyDays(1).atHour(3).create();
  return "ตั้งเวลาลบ Activity Log เก่ากว่า " + ACTIVITY_LOG_KEEP_MONTHS + " เดือนทุกวันเวลา 03:00 น. เรียบร้อยแล้ว";
}

// ★ FIX: เพิ่ม Password_Changed_At/Must_Change_Password ให้ admin คนแรกด้วย
//   เดิมไม่มี 2 field นี้เลย ทำให้บัญชี admin ตัวแรกไม่เคยถูกบังคับเปลี่ยนรหัสผ่าน
function setupFirstAdmin() {
  var ADMIN_EMAIL = "shopsyy01@gmail.com";

  if (ADMIN_EMAIL.indexOf("@example.com") > -1) {
    Logger.log("❌ กรุณาแก้ ADMIN_EMAIL ในโค้ดเป็นอีเมลจริงก่อนรันฟังก์ชันนี้");
    return "กรุณาแก้ ADMIN_EMAIL เป็นอีเมลจริงก่อนรัน";
  }

  var existing = findUserByUsername_("admin");
  if (existing) {
    Logger.log("มีผู้ใช้ admin อยู่แล้ว ไม่สร้างซ้ำ");
    return "มีผู้ใช้ admin อยู่แล้ว";
  }

  var tempPassword = Utilities.getUuid().slice(0, 12);
  var salt = makeSalt_();

  var dataObject = {
    Username        : "admin",
    Full_Name       : "ผู้ดูแลระบบ",
    Email           : ADMIN_EMAIL,
    Password_Hash   : hashPassword_(tempPassword, salt),
    Salt            : salt,
    Role            : "admin",
    Status          : "Active",
    Totp_Enabled    : "false",
    Totp_Secret_Enc : "",
    Recovery_Codes  : "[]",
    Failed_Attempts : 0,
    Locked_Until    : "",
    Last_Login      : "",
    Password_Changed_At  : "",
    Must_Change_Password : "true"
  };

  var res = saveMasterData(AUTH_USERS_COLLECTION, "U", null, dataObject, null);

  Logger.log("═══════════════════════════════════════");
  Logger.log("สร้างผู้ใช้ admin สำเร็จ");
  Logger.log("Username: admin");
  Logger.log("Email: " + ADMIN_EMAIL);
  Logger.log("Password: " + tempPassword);
  Logger.log("★ กรุณาเข้าระบบแล้วเปลี่ยนรหัสผ่านทันที");
  Logger.log("═══════════════════════════════════════");

  return "สร้าง admin สำเร็จ — ดูรหัสผ่านใน Log (Execution log)";
}

// ★ FIX: เพิ่มเช็คห้ามซ้ำรหัสเดิม + อัปเดต Password_Changed_At/Must_Change_Password
//   เดิมไม่เคยอัปเดต 2 field นี้ ทำให้นาฬิกา 90 วันไม่เคยรีเซ็ตแม้ user เปลี่ยนรหัสเองสม่ำเสมอ
function authChangePassword(token, oldPassword, newPassword) {
  var session = getSession_(token);
  if (!session) return { success: false, message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" };

  if (!newPassword || String(newPassword).length < 8) {
    return { success: false, message: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร" };
  }

  var user = findUserByUsername_(session.username);
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
  });

  return ok ? { success: true, message: "เปลี่ยนรหัสผ่านสำเร็จ" }
            : { success: false, message: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
}

function authStartTotpSetup(token) {
  var session = getSession_(token);
  if (!session) return { success: false, message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" };

  var secret = generateTotpSecret_();
  CacheService.getScriptCache().put("totpsetup_" + token, secret, 600);

  var label  = encodeURIComponent("SYY Shop:" + session.username);
  var issuer = encodeURIComponent("SYY Shop Control");
  var uri = "otpauth://totp/" + label + "?secret=" + secret + "&issuer=" + issuer + "&algorithm=SHA1&digits=6&period=30";

  return { success: true, secret: secret, otpauthUri: uri };
}

function authConfirmTotpSetup(token, otpCode) {
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

function authDisableTotp(token, password) {
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

function authGetMyProfile(token) {
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

    var user = findUserByEmail_(clean);
    if (!user || user.Status !== "Active") {
      return { success: true, message: genericMsg };
    }

    var resetToken = Utilities.getUuid() + "-" + Utilities.getUuid();
    CacheService.getScriptCache().put(
      "pwreset_" + resetToken,
      JSON.stringify({ username: user.Username, docId: user.docId }),
      RESET_TOKEN_MINUTES * 60
    );

    var resetUrl = getWebAppUrl() + "?page=login&mode=reset&rtoken=" + encodeURIComponent(resetToken);

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
    var raw = CacheService.getScriptCache().get("pwreset_" + resetToken);
    if (!raw) return { success: false, message: "ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่" };
    var data = JSON.parse(raw);
    return { success: true, username: data.username };
  } catch (e) {
    return { success: false, message: "ลิงก์ไม่ถูกต้อง" };
  }
}

// ★ FIX: เพิ่มเช็คห้ามซ้ำรหัสเดิม + อัปเดต Password_Changed_At/Must_Change_Password
//   เดิมไม่เคยเคลียร์ 2 ค่านี้ ทำให้ user ที่ถูก admin reset หรือลืมรหัสผ่าน
//   ต้องเปลี่ยนรหัสผ่านวนซ้ำไม่จบทุกครั้งที่ login แม้ตั้งรหัสใหม่ถูกต้องแล้ว (บั๊กร้ายแรงที่สุดที่พบ)
function authResetPassword(resetToken, newPassword) {
  try {
    var cacheKey = "pwreset_" + resetToken;
    var raw = CacheService.getScriptCache().get(cacheKey);
    if (!raw) return { success: false, message: "ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่" };

    CacheService.getScriptCache().remove(cacheKey);

    if (!newPassword || String(newPassword).length < 8) {
      return { success: false, message: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร" };
    }

    var data = JSON.parse(raw);
    var user = findUserByUsername_(data.username);
    if (!user) return { success: false, message: "ไม่พบบัญชีผู้ใช้" };

    if (isSamePassword_(user, newPassword)) {
      return { success: false, message: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม กรุณาตั้งรหัสผ่านใหม่ที่แตกต่างออกไป" };
    }

    var newSalt = makeSalt_();
    var ok = updateUserFields_(user.docId, {
      Password_Hash         : hashPassword_(newPassword, newSalt),
      Salt                  : newSalt,
      Password_Changed_At   : new Date().toISOString(),
      Must_Change_Password  : "false",
      Failed_Attempts : 0,
      Locked_Until    : ""
    });

    return ok ? { success: true, message: "ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่" }
              : { success: false, message: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  } catch (e) {
    console.error("authResetPassword error:", e);
    return { success: false, message: "เกิดข้อผิดพลาดในระบบ" };
  }
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
      "ลิงก์เข้าสู่ระบบ: " + getWebAppUrl() + "?page=login\n\n" +
      "หากคุณไม่ได้เป็นผู้ร้องขอ กรุณาติดต่อผู้ดูแลระบบทันที\n\n" +
      "— ระบบ SYY Shop Control";

    MailApp.sendEmail(email, subject, body);
    return true;
  } catch (e) {
    console.error("sendAccountEmail_ error:", e);
    return false;
  }
}

function createUserAccount(email, fullName, role) {
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

  var res = saveMasterData(AUTH_USERS_COLLECTION, "U", null, dataObject, null);
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

function getAllUsers() {
  var list = [];
  try {
    var docs = fetchCollectionDocsCached(AUTH_USERS_COLLECTION);
    docs.forEach(function (doc) {
      var f = doc.fields || {};
      list.push({
        docId               : doc.id,
        username            : parseFirestoreValue(f.Username)  || "",
        fullName            : parseFirestoreValue(f.Full_Name) || "",
        email               : parseFirestoreValue(f.Email)     || "",
        role                : parseFirestoreValue(f.Role)       || "viewer",
        status              : parseFirestoreValue(f.Status)     || "Active",
        totpEnabled         : String(parseFirestoreValue(f.Totp_Enabled) || "") === "true",
        lastLogin           : parseFirestoreValue(f.Last_Login) || "",
        passwordChangedAt   : parseFirestoreValue(f.Password_Changed_At) || "",
        mustChangePassword  : String(parseFirestoreValue(f.Must_Change_Password) || "") === "true"
      });
    });
    list.sort(function (a, b) { return (a.username || "").localeCompare(b.username || ""); });
  } catch (e) {
    console.error("getAllUsers error:", e);
  }
  return list;
}

// ★ Admin: แก้ไขข้อมูลบัญชีผู้ใช้ (ชื่อเต็ม, อีเมล, Role) — ไม่แก้ username/รหัสผ่าน
//   ห้ามใช้แก้ไข role ของตัวเอง เพื่อกันเผลอลดสิทธิ์ตัวเองจนออกจากระบบไม่ได้
function updateUserAccount(docId, fullName, email, role, callerUsername) {
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
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { success: false, message: "ไม่พบบัญชีผู้ใช้นี้" };

    var f = JSON.parse(res.getContentText()).fields || {};
    var targetUsername = parseFirestoreValue(f.Username) || "";
    var currentEmail   = parseFirestoreValue(f.Email)    || "";
    var currentRole    = parseFirestoreValue(f.Role)     || "";

    if (callerUsername && targetUsername.toLowerCase() === String(callerUsername).toLowerCase() && cleanRole !== currentRole) {
      return { success: false, message: "ไม่สามารถเปลี่ยนสิทธิ์ (Role) ของบัญชีตัวเองได้" };
    }

    if (cleanEmail !== currentEmail) {
      var existing = findUserByEmail_(cleanEmail);
      if (existing && existing.docId !== docId) {
        return { success: false, message: "อีเมลนี้ถูกใช้งานโดยบัญชีอื่นแล้ว" };
      }
    }

    var ok = updateUserFields_(docId, {
      Full_Name : cleanName,
      Email     : cleanEmail,
      Role      : cleanRole
    });

    // ★ เปลี่ยนสิทธิ์แล้วต้องบังคับ session เดิมของบัญชีนี้ให้หมดอายุทันที ไม่งั้นสิทธิ์เก่ายังใช้ได้ต่อ
    //   จนกว่า session จะหมดอายุเอง (สูงสุด AUTH_SESSION_HOURS ชั่วโมง) — ไม่ต้องทำถ้าแก้แค่ชื่อ/อีเมล
    if (ok && cleanRole !== currentRole) {
      revokeUserSessions_(targetUsername);
    }

    return ok ? { success: true, message: "บันทึกข้อมูลบัญชีผู้ใช้สำเร็จ" }
              : { success: false, message: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  } catch (e) {
    console.error("updateUserAccount error:", e);
    return { success: false, message: "เกิดข้อผิดพลาด: " + e.message };
  }
}

function resetUserPassword(docId, callerUsername) {
  if (!docId) return { success: false, message: "ไม่พบรหัสผู้ใช้" };

  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + AUTH_USERS_COLLECTION + "/" + docId;
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { success: false, message: "ไม่พบบัญชีผู้ใช้นี้" };

    var f = JSON.parse(res.getContentText()).fields || {};
    var targetUsername = parseFirestoreValue(f.Username) || "";
    var targetEmail     = parseFirestoreValue(f.Email)    || "";
    var targetFullName  = parseFirestoreValue(f.Full_Name) || targetUsername;
    var targetStatus    = parseFirestoreValue(f.Status)    || "Active";

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
    revokeUserSessions_(targetUsername);

    var resetToken = Utilities.getUuid() + "-" + Utilities.getUuid();
    CacheService.getScriptCache().put(
      "pwreset_" + resetToken,
      JSON.stringify({ username: targetUsername, docId: docId }),
      RESET_TOKEN_MINUTES * 60
    );

    var resetUrl = getWebAppUrl() + "?page=login&mode=reset&rtoken=" + encodeURIComponent(resetToken);

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

    updateUserFields_(docId, { Must_Change_Password: "true" });

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

function toggleUserStatus(docId, newStatus, callerUsername) {
  if (!docId) return { success: false, message: "ไม่พบรหัสผู้ใช้" };
  if (newStatus !== "Active" && newStatus !== "Inactive") {
    return { success: false, message: "สถานะไม่ถูกต้อง" };
  }

  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + AUTH_USERS_COLLECTION + "/" + docId;
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { success: false, message: "ไม่พบบัญชีผู้ใช้นี้" };

    var f = JSON.parse(res.getContentText()).fields || {};
    var targetUsername = parseFirestoreValue(f.Username) || "";

    if (callerUsername && targetUsername.toLowerCase() === String(callerUsername).toLowerCase()) {
      return { success: false, message: "ไม่สามารถเปลี่ยนสถานะบัญชีตัวเองได้" };
    }

    var ok = updateUserFields_(docId, { Status: newStatus });
    if (!ok) return { success: false, message: "เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่" };

    // ★ ปิดใช้งานบัญชีแล้วต้องตัด session เดิมทันที ไม่งั้นยังใช้งานได้ต่อจนกว่า session จะหมดอายุเอง
    if (newStatus === "Inactive") {
      revokeUserSessions_(targetUsername);
    }

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
    var cacheKey = "pwforce_" + tempToken;
    var raw = CacheService.getScriptCache().get(cacheKey);
    if (!raw) return { success: false, message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง" };

    if (!newPassword || String(newPassword).length < 8) {
      return { success: false, message: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร" };
    }

    var data = JSON.parse(raw);
    var user = findUserByUsername_(data.username);
    if (!user) return { success: false, message: "ไม่พบบัญชีผู้ใช้" };

    if (isSamePassword_(user, newPassword)) {
      return { success: false, message: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม กรุณาตั้งรหัสผ่านใหม่ที่แตกต่างออกไป" };
    }

    CacheService.getScriptCache().remove(cacheKey);

    var newSalt = makeSalt_();
    var ok = updateUserFields_(user.docId, {
      Password_Hash        : hashPassword_(newPassword, newSalt),
      Salt                 : newSalt,
      Must_Change_Password : "false",
      Password_Changed_At  : new Date().toISOString(),
      Failed_Attempts      : 0,
      Locked_Until         : ""
    });

    if (!ok) return { success: false, message: "บันทึกรหัสผ่านใหม่ไม่สำเร็จ กรุณาลองใหม่" };

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
  return "projects/" + PROJECT_ID + "/databases/(default)/documents/" + collection + "/" + docId;
}

function fsCommit_(writes) {
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
          + "/databases/(default)/documents:commit";
  var res = UrlFetchApp.fetch(url, {
    method            : "post",
    headers           : getAuthHeader(),
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
    headers           : getAuthHeader(),
    payload           : JSON.stringify({ documents: uniq.map(function (c) { return fsDocPath_("Master_Products", c); }) }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.error("getProductStockMap_ HTTP " + res.getResponseCode() + ": " + res.getContentText());
    return map;
  }

  (JSON.parse(res.getContentText()) || []).forEach(function (row) {
    if (!row.found) return;
    var f  = row.found.fields || {};
    var id = row.found.name.split("/").pop();
    map[id] = {
      name         : parseFirestoreValue(f.Product_Name) || id,
      stock        : parseFloat(parseFirestoreValue(f.Current_Stock)) || 0,
      minStock     : parseFloat(parseFirestoreValue(f.Min_Stock))     || 0,
      costPrice    : parseFloat(parseFirestoreValue(f.Cost_Price))    || 0,
      sellingPrice : parseFloat(parseFirestoreValue(f.Selling_Price)) || 0,
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
function issueStock(d, callerUsername) {
  function fail(msg, extra) {
    var o = { success: false, title: "ไม่สำเร็จ", message: msg };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }

  try {
    d = d || {};
    var items = (Array.isArray(d.items) ? d.items : []).filter(function (it) {
      return it && it.productCode && parseFloat(it.qty || 0) > 0;
    });
    if (!items.length) return fail("ไม่มีรายการที่จะตัดสต๊อก");

    var reason = String(d.reason || "").trim();
    if (ISSUE_REASONS.indexOf(reason) === -1) return fail("กรุณาเลือกเหตุผลที่ตัดสต๊อกให้ถูกต้อง");

    // รวมรายการซ้ำรหัสเดียวกันเข้าด้วยกัน กันตัดสองรอบ
    // ★ ไม่รับ unitPrice จาก client เลย — ราคาตัดสต๊อกต้องอ้างอิง Master_Products.Selling_Price เท่านั้น
    //   (ล็อกที่ฝั่ง server ไม่ใช่แค่ซ่อนช่องกรอกที่ UI เพราะ apiGateway ยังเรียกได้ตรงถ้ารู้ token)
    var merged = {};
    items.forEach(function (it) {
      var code = String(it.productCode);
      if (!merged[code]) merged[code] = { productCode: code, productName: it.productName || "", qty: 0 };
      merged[code].qty += parseFloat(it.qty || 0);
    });
    var lines0 = Object.keys(merged).map(function (k) { return merged[k]; });

    // ★ ถ้าตัดสต๊อกจากใบเสนอราคาที่ "ปิดงาน-ขายสำเร็จ" แล้ว ใช้ราคาที่เสนอไปจริง (ผ่านการอนุมัติแล้ว)
    //   เฉพาะสินค้าที่อยู่ในใบเสนอราคานั้น แทนราคา Master Product — ตรวจสอบจากเอกสารจริงบน server
    //   เองเท่านั้น (ไม่เชื่อราคาที่ client ส่งมาตรงๆ) กันตั้งราคาปลอมโดยอ้างว่ามาจากใบเสนอราคา
    var quotedPriceMap = {};
    if (d.quoteId) {
      try {
        var qUrl = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
                 + "/databases/(default)/documents/" + QUOTATION_COLLECTION + "/" + d.quoteId;
        var qRes = UrlFetchApp.fetch(qUrl, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
        if (qRes.getResponseCode() === 200) {
          var qf = JSON.parse(qRes.getContentText()).fields || {};
          if (parseFirestoreValue(qf.Status) === "ปิดงาน-ขายสำเร็จ") {
            var qItems = JSON.parse(parseFirestoreValue(qf.Items_JSON) || "[]");
            qItems.forEach(function (it) {
              if (it && it.productCode) quotedPriceMap[it.productCode] = parseFloat(it.unitPrice) || 0;
            });
          }
        }
      } catch (e) {
        console.error("issueStock: ตรวจสอบใบเสนอราคาไม่สำเร็จ (จะใช้ราคา Master Product แทน):", e);
      }
    }

    var user   = callerUsername || getCurrentUsername_();
    var nowIso = new Date().toISOString();
    // ★ FIX: เดิม docNo = "SI"+yyMMdd-HHmmss เท่านั้น — 2 บิลในวินาทีเดียวกันได้ docNo ซ้ำ แล้ว
    //   document id ของ Stock_Movements (docNo+"-"+ลำดับ) ชนกัน เขียนทับประวัติบิลแรกเงียบๆ
    //   (ยอดสต๊อกยังถูกเพราะ increment เป็น atomic แต่หลักฐานการตัดหาย) — เติมสุ่มท้ายกันชนแทน
    var docNo = "SI" + Utilities.formatDate(new Date(), "Asia/Bangkok", "yyMMdd-HHmmss")
              + "-" + Utilities.getUuid().replace(/-/g, "").slice(0, 4).toUpperCase();

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
        if (!info) { notFound.push(l.productCode); return; }
        l.before     = info.stock;
        l.after      = info.stock - l.qty;
        l.minStock   = info.minStock;
        l.costPrice  = info.costPrice;
        l.updateTime = info.updateTime;
        l.unitPrice  = quotedPriceMap.hasOwnProperty(l.productCode) ? quotedPriceMap[l.productCode] : info.sellingPrice;
        if (!l.productName) l.productName = info.name;
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
              Ref_No       : { stringValue: String(d.refNo || "") },
              Note         : { stringValue: String(d.note  || "") },
              User         : { stringValue: user },
              Timestamp    : { stringValue: nowIso }
            }
          }
        });
      });

      commit = fsCommit_(writes);
      if (commit.ok) break;
      if (!isPreconditionFailure_(commit.message) || attempt === MAX_ATTEMPTS) {
        return { success: false, title: "ล้มเหลว", message: "บันทึกไม่สำเร็จ: " + commit.message };
      }
      // มีคนแก้สต๊อกสินค้าตัวใดตัวหนึ่งแทรกพอดีระหว่างที่กำลังตัด — วนไปอ่าน-ตรวจ-เขียนใหม่รอบถัดไป
      Utilities.sleep(150 * attempt);
    }

    return {
      success : true,
      title   : "สำเร็จ",
      message : "ตัดสต๊อกเรียบร้อย",
      docNo   : docNo,
      results : lines.map(function (l) {
        return { productCode: l.productCode, productName: l.productName, qty: l.qty, before: l.before, after: l.after, belowMin: l.after <= l.minStock };
      })
    };
  } catch (e) {
    return { success: false, title: "ข้อผิดพลาด", message: e.message };
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

  return fsCommit_(writes).ok;
}

/**
 * ★ ดึงประวัติเข้า-ออก (ล่าสุดก่อน) — ใส่ productCode เพื่อดูรายสินค้า
 */
function getStockMovements(limit, productCode) {
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
      headers           : getAuthHeader(),
      payload           : JSON.stringify({ structuredQuery: q }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      console.error("getStockMovements HTTP " + res.getResponseCode() + ": " + res.getContentText());
      return out;
    }

    (JSON.parse(res.getContentText()) || []).forEach(function (row) {
      if (!row.document) return;
      var f = row.document.fields || {};
      out.push({
        id          : row.document.name.split("/").pop(),
        docNo       : parseFirestoreValue(f.Doc_No),
        type        : parseFirestoreValue(f.Type) || "OUT",
        productCode : parseFirestoreValue(f.Product_Code),
        productName : parseFirestoreValue(f.Product_Name),
        qty         : parseFloat(parseFirestoreValue(f.Qty)) || 0,
        stockAfter  : parseFirestoreValue(f.Stock_After),
        unitPrice   : parseFloat(parseFirestoreValue(f.Unit_Price)) || 0,
        costPrice   : parseFloat(parseFirestoreValue(f.Cost_Price)) || 0,
        reason      : parseFirestoreValue(f.Reason),
        refNo       : parseFirestoreValue(f.Ref_No),
        note        : parseFirestoreValue(f.Note),
        user        : parseFirestoreValue(f.User),
        timestamp   : parseFirestoreValue(f.Timestamp)
      });
    });
  } catch (e) {
    console.error("getStockMovements error:", e);
  }
  return out;
}

/**
 * ★ ดึงประวัติเข้า-ออกทั้งหมด (ไม่จำกัด limit เหมือน getStockMovements) — ใช้สร้าง Dashboard สต๊อก
 * คืนค่าดิบ ให้ฝั่งหน้าเว็บไปคำนวณ KPI / กราฟ / stock health เองแบบ client-side ทั้งหมด
 * (โหลดครั้งเดียวตอนเปิดหน้า / กดรีเฟรช ไม่ต้องยิง API ซ้ำตอนสลับตัวกรอง)
 */
function fetchAllStockMovements_() {
  var out = [];
  var fetched = fetchAllPagesRaw(STOCK_MOVEMENT_COLLECTION);
  if (!fetched.ok) return out;

  fetched.docs.forEach(function (doc) {
    var f  = doc.fields || {};
    var ts = parseFirestoreValue(f.Timestamp);
    if (!ts) return; // เอกสารเพี้ยน/ไม่มีเวลา ข้ามไปกันกราฟพัง

    out.push({
      docNo       : parseFirestoreValue(f.Doc_No)       || "",
      type        : parseFirestoreValue(f.Type)         || "OUT",
      productCode : parseFirestoreValue(f.Product_Code) || "",
      productName : parseFirestoreValue(f.Product_Name) || "",
      qty         : parseFloat(parseFirestoreValue(f.Qty))        || 0,
      stockAfter  : parseFloat(parseFirestoreValue(f.Stock_After))|| 0,
      unitPrice   : parseFloat(parseFirestoreValue(f.Unit_Price)) || 0,
      costPrice   : parseFloat(parseFirestoreValue(f.Cost_Price)) || 0,
      reason      : parseFirestoreValue(f.Reason) || "",
      refNo       : parseFirestoreValue(f.Ref_No) || "",
      note        : parseFirestoreValue(f.Note)   || "",
      user        : parseFirestoreValue(f.User)   || "",
      timestamp   : ts
    });
  });
  return out;
}

/**
 * ★ ข้อมูลตั้งต้นของ Dashboard สต๊อก (หน้า index) — เรียกครั้งเดียวตอนโหลดหน้า/กดรีเฟรช
 * รวม: สินค้าทั้งหมด + ประวัติเข้า-ออกทั้งหมด + แผนที่ "เลขที่ PO -> ชื่อผู้จัดจำหน่าย"
 * (ไว้โยงใบรับเข้าสต๊อก ซึ่ง Ref_No ของ Stock_Movements ประเภท IN คือเลขที่ PO)
 */
function getDashboardBootstrap() {
  var poVendorMap = {};
  try {
    getPurchaseOrders().forEach(function (po) { poVendorMap[po.poId] = po.vendorName; });
  } catch (e) {
    console.error("getDashboardBootstrap: โหลดผู้จัดจำหน่ายของ PO ไม่สำเร็จ:", e);
  }
  return {
    products     : getAllProducts(),
    movements    : fetchAllStockMovements_(),
    poVendorMap  : poVendorMap
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
