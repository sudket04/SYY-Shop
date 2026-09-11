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

  var files = {
    'login'      : 'Login',
    'home'       : 'index',
    'brands'     : 'Master_Brands',
    'categories' : 'Master_Categories',
    'vendors'    : 'Master_Vendors',
    'zones'      : 'Master_Zones',
    'products'   : 'Master_Products',
    'cars'       : 'Master_Cars',
    'orders'     : 'Purchase_Orders',
    'taxinvoice' : 'Master_Tax_Invoice',
    'customers'  : 'Master_Customers',
    'profile'    : 'Profile'
  };

  // ★★★ สถานะปัจจุบัน: ระบบ login ยังไม่ได้ผูกบังคับกับหน้าไหนเลย (ตามคำสั่ง)
  //   ทุกหน้ายังเข้าได้ตรงๆ เหมือนก่อนมีระบบ login ทั้งหมด — รวมถึง 'home' (index.txt)
  //   หน้า 'login' แค่ "เข้าถึงได้" เฉยๆ (เผื่อทดสอบ) แต่ไม่มีการบังคับเช็ค session ที่นี่
  //   เมื่อพร้อมผูกจริงในอนาคต ค่อยเพิ่ม guard กลับมาตรงนี้ทีเดียว (อย่าลืม!)
  var session = getSession_(token);   // อาจเป็น null ก็ได้ ไม่ block การเข้าถึง

  var template = HtmlService.createTemplateFromFile(files[page] || 'index');
  template.webAppUrl = getWebAppUrl();
  template.authToken = token;
  template.userRole  = session ? session.role : '';
  template.userName  = session ? (session.fullName || session.username) : '';

  return template
    .evaluate()
    .setTitle(page === 'login' ? 'เข้าสู่ระบบ — SYY Shop Control' : 'SYY Shop Control')
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
// 2b. ★ Cache Layer — ลด Firestore Reads (Firebase Spark Plan / Free Quota)
//     Cache เอกสารดิบของ Master collections ที่เปลี่ยนไม่บ่อย
//     (แบรนด์/หมวดหมู่/ผู้จัดจำหน่าย/โซน/รถ) ไว้ใน CacheService ของ Apps Script
//     — CacheService ไม่กิน Firestore quota เลย (คนละระบบ) และแชร์ร่วมกันทุก user/ทุกการเรียก
//     ★ ไม่แคช Master_Products และ Purchase_Orders เพราะสต็อก/สถานะต้องเห็นข้อมูลล่าสุดเสมอ
//     ★ มีการล้าง cache อัตโนมัติทันทีหลัง save/delete สำเร็จ (ดู saveMasterData / deleteFirestoreDocument)
//       เพื่อไม่ให้เห็นข้อมูลเก่าค้างแม้แต่ตอนที่ยังไม่ครบเวลา TTL
// ==========================================
// ★ แคช 6 ชั่วโมง (21600 วิ = ค่าสูงสุดที่ CacheService รองรับ) — เดิม 5 นาที
//   ปลอดภัยเพราะ clearCollectionCache() ล้าง cache ทันทีทุกครั้งที่สร้าง/แก้ไข/ลบข้อมูล (3 จุดใน saveMasterData/deleteFirestoreDocument)
//   ข้อมูลจึงไม่มีทางค้างเก่า ส่วน master data (แบรนด์/หมวดหมู่/ผู้จำหน่าย/โซน/รถ) ก็เปลี่ยนไม่บ่อยอยู่แล้ว
//   ผลคือลดการอ่าน Firestore ลงมาก โดยเฉพาะกรณีเปิด-ปิดหน้าเว็บบ่อยๆ ระหว่างวัน
var CACHE_TTL_SECONDS     = 21600;
var CACHEABLE_COLLECTIONS = ["Master_Brands", "Master_Categories", "Master_Vendors", "Master_Zones", "Master_Cars"];

// ★ helper: ดึงเอกสารทั้ง collection จาก Firestore แบบวนทุกหน้า (รองรับข้อมูลเกิน 300 รายการ)
//   คืน { ok: true/false, docs: [...] } — ok=false เมื่อ fetch ล้มเหลว (ใช้ตัดสินใจว่าจะแคชไหม)
function fetchAllPagesRaw(collectionName) {
  var docs = [];
  var pageToken = "";
  var guard = 0;   // กันวนไม่รู้จบถ้า API คืน token ผิดปกติ
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

// ★ ข้อ 7: ดึงหลาย collection พร้อมกันแบบขนาน (UrlFetchApp.fetchAll) แทนการรอทีละอัน
//   ใช้เฉพาะหน้าแรกของแต่ละ collection (300 รายการ) — ถ้าอันไหนมีหน้าถัดไปจะไปวนต่อแบบปกติให้ครบ
//   collection ที่มีใน cache อยู่แล้วจะไม่ถูกยิงซ้ำ
//   คืน object { collectionName: [docs...] }
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

      // ★ ถ้ายังมีหน้าถัดไป ให้ดึงต่อให้ครบ (กันข้อมูลขาดเหมือนเดิม)
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

// ดึงเอกสารดิบทั้ง collection (ใช้ cache ถ้ามีและ collection นี้อยู่ในลิสต์ที่แคชได้)
// คืน array ของ { id, fields } เหมือนโครงสร้างที่ดึงจาก Firestore ตรงๆ
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

  // ★ ข้อ 8: ดึงครบทุกหน้า ไม่ตัดที่ 300 รายการอีกต่อไป
  var fetched = fetchAllPagesRaw(collectionName);
  var docs    = fetched.docs;

  // ★ แคชเฉพาะตอนดึงสำเร็จจริงเท่านั้น (กันแคชค่าว่างตอน fetch พลาด)
  if (useCache && fetched.ok) {
    try {
      CacheService.getScriptCache().put(cacheKey, JSON.stringify(docs), CACHE_TTL_SECONDS);
    } catch (e) {
      console.error("cache write error (ข้ามได้ ไม่กระทบการทำงาน):", e);
    }
  }
  return docs;
}

// ล้าง cache ของ collection หนึ่งๆ — เรียกทันทีหลัง save/delete สำเร็จ กันข้อมูลค้าง
function clearCollectionCache(collectionName) {
  if (CACHEABLE_COLLECTIONS.indexOf(collectionName) === -1) return;
  try {
    CacheService.getScriptCache().remove("docs_" + collectionName);
  } catch (e) {
    console.error("clearCollectionCache error:", e);
  }
}

// ★ VERSION MARKER — เปลี่ยนค่านี้ทุกครั้งที่แก้โค้ด ใช้พิสูจน์ว่า deploy เวอร์ชันล่าสุดจริงหรือยัง
var CODE_VERSION = "2026-08-25-perf-optimizations";
function getCodeVersion() { return CODE_VERSION; }

// ★ DEBUG: เรียกฟังก์ชันนี้ตรงๆ จาก Apps Script Editor แล้วดู Execution log
function debugCheckBrandsCache() {
  console.log("=== CODE_VERSION: " + CODE_VERSION + " ===");
  var cacheKey = "docs_Master_Brands";
  var cached = null;
  try { cached = CacheService.getScriptCache().get(cacheKey); } catch (e) { console.error("อ่าน cache พลาด:", e); }
  console.log("1) Cache ปัจจุบัน (" + cacheKey + "): " + (cached ? JSON.parse(cached).length + " รายการ" : "ไม่มี/ว่าง"));
  try { CacheService.getScriptCache().remove(cacheKey); } catch (e) {}
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
          + "/databases/(default)/documents/Master_Brands?pageSize=300";
  var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
  console.log("2) HTTP Status: " + res.getResponseCode());
  if (res.getResponseCode() !== 200) {
    console.log("3) Response Body (error): " + res.getContentText());
  } else {
    var docs = (JSON.parse(res.getContentText()).documents || []);
    console.log("3) Fetch ตรงจาก Firestore สำเร็จ: " + docs.length + " เอกสาร");
  }
  console.log("4) getAllMasterDropdowns().brands: " + JSON.stringify(getAllMasterDropdowns().brands));
}

// ★ DEBUG: ตรวจสอบว่ามีผู้จำหน่ายรายไหนยังไม่มีเลขผู้เสียภาษี/สาขา (ข้อมูลเก่าก่อนอัปเดตฟีเจอร์นี้)
//   เรียกจาก Apps Script Editor แล้วดู log — รายชื่อที่ขึ้นมาต้องเข้าไปกรอกเพิ่มก่อนจะออกใบกำกับภาษีจากผู้จำหน่ายนั้นได้
function debugCheckVendorsMissingTaxInfo() {
  var vendors = getVendorsFull();
  var missing = vendors.filter(function(v) { return !v.Tax_ID || v.Tax_ID.length !== 13; });
  console.log("ผู้จำหน่ายทั้งหมด: " + vendors.length + " ราย");
  if (missing.length === 0) {
    console.log("✅ ทุกรายมีเลขผู้เสียภาษี 13 หลักครบแล้ว");
  } else {
    console.log("⚠️ พบ " + missing.length + " รายที่ยังไม่มี/ไม่ครบเลขผู้เสียภาษี:");
    missing.forEach(function(v) {
      console.log("  - " + v.id + " (" + v.Vendor_name + ") Tax_ID='" + v.Tax_ID + "'");
    });
  }
}

// ==========================================
// 3. ระบบรันเลข ID อัตโนมัติ
// ==========================================
function getNextAutoId(collectionName, prefix, forceFresh) {
  try {
    // ★ ข้อ 2: ตอนสร้าง ID ใหม่ให้ดึงสดเสมอ (forceFresh) เพราะ cache อาจเก่าถึง 5 นาที
    //   ทำให้คำนวณเลขถัดไปผิดแล้วไปชนกับเอกสารที่มีอยู่จริง
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
//    ★ รองรับ Array (เช่น Car_IDs) ด้วย arrayValue
// ==========================================
// ★ Field ที่ต้องบันทึกเป็น stringValue เสมอ แม้ค่าจะเป็นตัวเลขล้วน (เช่น "90915" หรือเลขผู้เสียภาษี 13 หลัก)
//   ป้องกันปัญหา field รหัส/ข้อความถูกเดาผิดเป็นตัวเลข (doubleValue) แล้วพังตอนเรียก .toLowerCase()/.trim() ภายหลัง
var FORCE_STRING_FIELDS = ["Part_Number", "Product_Name", "Brand_Name", "Category_Name",
                            "Vendor_name", "Phone", "Area", "Build", "Floor", "Rack_no",
                            "Tax_ID", "Branch", "Invoice_No", "Buyer_Tax_ID", "Buyer_Branch",
                            "Customer_Name", "Address_No", "Address_Moo", "Address_Road",
                            "Subdistrict", "District", "Province", "Postal_Code", "Invoice_Date"];

function mapToFirestoreFields(dataObject) {
  var fields = {};
  for (var key in dataObject) {
    if (!dataObject.hasOwnProperty(key)) continue;
    var val = dataObject[key];

    // ★ รองรับ Array (เช่น Car_IDs: ["CAR0001","CAR0005"])
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

    // ★ FIX: field ในลิสต์ FORCE_STRING_FIELDS ต้องเป็น stringValue เสมอ ไม่ให้เดาชนิดอัตโนมัติ
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
//    ★ รองรับ arrayValue → คืนเป็น JS array
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
      clearCollectionCache(collectionName);   // ★ ล้าง cache ทันที กันข้อมูลที่ลบไปแล้วค้างอยู่
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

    // ★ ข้อ 2: แยกเส้นทาง "เพิ่มใหม่" กับ "แก้ไข" ออกจากกัน
    //   เดิมใช้ PATCH ทั้งคู่ ซึ่งถ้าเลขรัน ID ชนกัน (2 คนบันทึกพร้อมกัน / cache ยังไม่ล้าง)
    //   PATCH จะ "เขียนทับ" เอกสารเดิมเงียบๆ ทำให้ข้อมูลรายการนั้นหายไปเลย
    //   ตอนนี้ตอนเพิ่มใหม่ใช้ POST createDocument ซึ่งจะคืน 409 ALREADY_EXISTS ถ้า ID ถูกใช้ไปแล้ว
    //   แล้ววนขยับไปเลขถัดไปให้อัตโนมัติ — ไม่มีทางเขียนทับของเดิมได้
    if (!docId) {
      var newId  = getNextAutoId(collectionName, prefix, true);   // true = ดึงสดไม่ใช้ cache
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
          // ID นี้ถูกใช้ไปแล้ว — ขยับไปเลขถัดไปแล้วลองใหม่
          newId = bumpAutoId(newId, prefix);
          continue;
        }
        lastErr = createRes.getContentText();
        break;
      }
      return { success: false, title: "ล้มเหลว", message: lastErr || "ไม่สามารถสร้างรหัสใหม่ได้ กรุณาลองอีกครั้ง" };
    }

    // แก้ไขเอกสารเดิม — ใช้ PATCH ตามเดิม
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
      clearCollectionCache(collectionName);   // ★ ล้าง cache ทันที กันข้อมูลใหม่/ที่แก้ไขค้างไม่อัปเดต
      return { success: true, title: "สำเร็จ", message: "บันทึกข้อมูลเรียบร้อย", id: id };
    }
    return { success: false, title: "ล้มเหลว", message: res.getContentText() };
  } catch (e) {
    return { success: false, title: "ข้อผิดพลาด", message: e.message };
  }
}

// ★ helper: ขยับเลขรัน ID ไปอีก 1 (เช่น B0044 → B0045) ใช้ตอนเจอ ID ซ้ำ
function bumpAutoId(currentId, prefix) {
  var numStr = String(currentId).indexOf(prefix) === 0 ? String(currentId).substring(prefix.length) : "";
  var num    = /^\d+$/.test(numStr) ? parseInt(numStr, 10) : 0;
  var width  = numStr.length || 4;
  return prefix + (num + 1).toString().padStart(width, '0');
}

// ★ helper: สร้าง lookup map จาก docs ที่ดึงมาแล้ว (ไม่ยิง request ใหม่)
//   ใช้คู่กับ fetchCollectionsParallel เพื่อไม่ให้ดึงข้อมูลซ้ำ
//   ★ หมายเหตุ: เดิมมี buildLookupMap / buildCarLookupMap / buildZoneLookupMap ที่ดึงข้อมูลเองทีละ collection
//     ถูกลบออกแล้วเพราะไม่มีที่ไหนเรียกใช้ (ทุกจุดเปลี่ยนมาใช้ 3 ฟังก์ชันด้านล่างนี้ที่รับ docs มาแล้ว)
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
// 10. ★ getAllProducts — ใช้โดย Master_Products.html
//     คืน array ที่มีชื่อ Brand / Category / Zone / Car(Model) แทน ID
//     ★ Car_IDs รองรับหลายรุ่น (array) + backward-compat กับ Car_ID เดี่ยวของเดิม
// ==========================================
function getAllProducts() {
  var products = [];
  try {
    // ★ ข้อ 7: ดึง master ทั้ง 5 ชุดขนานกันครั้งเดียว แทนการเรียกทีละอันรอทีละ request
    var masters = fetchCollectionsParallel(
      ["Master_Brands", "Master_Categories", "Master_Vendors", "Master_Zones", "Master_Cars"]
    );
    var brandMap  = buildMapFromDocs(masters["Master_Brands"],     "Brand_Name");
    var catMap    = buildMapFromDocs(masters["Master_Categories"], "Category_Name");
    var vendorMap = buildMapFromDocs(masters["Master_Vendors"],    "Vendor_name");
    var zoneMap   = buildZoneMapFromDocs(masters["Master_Zones"]);
    var carMap    = buildCarMapFromDocs(masters["Master_Cars"]);

    // ★ ข้อ 8: ดึงสินค้าครบทุกหน้า ไม่ตัดที่ 300 รายการ
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

        // ★ Car_IDs (array) — รองรับข้อมูลเก่าที่ยังเป็น Car_ID เดี่ยว
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
          partType     : parseFirestoreValue(f.Part_Type)      || "",   // ★ เพิ่ม
          partNumber   : String(parseFirestoreValue(f.Part_Number) || ""),   // ★ รหัสจากผู้ผลิต (Part Number) — บังคับ String() กันข้อมูลเก่าที่เผลอบันทึกเป็นตัวเลข
          brandId      : brandId,
          brandName    : brandMap[brandId]   || brandId,
          categoryId   : catId,
          categoryName : catMap[catId]       || catId,
          vendorId     : vendorId,
          vendorName   : vendorMap[vendorId] || vendorId,
          zoneId       : zoneId,
          zoneName     : zoneId === "PENDING" ? "รอดำเนินการ" : (zoneMap[zoneId] || zoneId),
          carIds       : carIds,                              // ★ array ของ Car_ID
          carModel     : carModelNames.join(', '),             // ★ join แสดงหลายรุ่น
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
// 11. ★ getProductById — ใช้โดย Master_Products.html (Edit Modal / View Modal)
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

      // ★ Car_IDs (array) — รองรับข้อมูลเก่าที่ยังเป็น Car_ID เดี่ยว
      var carIds = parseFirestoreValue(f.Car_IDs);
      if (!carIds || (Array.isArray(carIds) && carIds.length === 0)) {
        var legacyCarId = parseFirestoreValue(f.Car_ID);
        carIds = legacyCarId ? [legacyCarId] : [];
      } else if (!Array.isArray(carIds)) {
        carIds = [carIds];
      }

      // ★ ข้อ 7: ดึง master ทั้ง 5 ชุดขนานกัน แทนการเรียกทีละอันรอทีละ request
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
        partType     : parseFirestoreValue(f.Part_Type)           || "",   // ★ เพิ่ม
        partNumber   : String(parseFirestoreValue(f.Part_Number) || ""),         // ★ รหัสจากผู้ผลิต (Part Number) — บังคับ String() กันข้อมูลเก่าที่เผลอบันทึกเป็นตัวเลข
        brandId      : brandId,
        brandName    : brandMap[brandId]   || brandId,
        categoryId   : catId,
        categoryName : catMap[catId]       || catId,
        vendorId     : vendorId,
        vendorName   : vendorMap[vendorId] || vendorId,
        zoneId       : zoneId,
        zoneName     : zoneId === "PENDING" ? "รอดำเนินการ" : (zoneMap[zoneId] || zoneId),
        carIds       : carIds,                                    // ★ array
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
// 12. ★ getAllMasterDropdowns — ใช้โดย index.html และ Master_Products.html
//     คืน field ครบทุกรูปแบบ ป้องกัน undefined ไม่ว่า HTML จะเรียกชื่อไหน
//     ★ preloadedMasters: optional — ถ้ามีให้ (จาก getProductPageData) จะไม่ดึง master ซ้ำ
//       index.html เรียกแบบเดิมไม่ส่ง parameter จึงยังดึงเองตามปกติ ไม่กระทบ
// ==========================================
function getAllMasterDropdowns(preloadedMasters) {

  // --- Brands: แสดง "Brand_Name"
  function buildBrands() {
    return buildSimpleList("Master_Brands", function(f, id) {
      return parseFirestoreValue(f.Brand_Name) || id;
    });
  }

  // --- Categories: แสดง "Category_Name"
  function buildCategories() {
    return buildSimpleList("Master_Categories", function(f, id) {
      return parseFirestoreValue(f.Category_Name) || id;
    });
  }

  // --- Vendors: แสดง "Vendor_name (Phone)" ถ้ามีเบอร์
  function buildVendors() {
    return buildSimpleList("Master_Vendors", function(f, id) {
      var name  = parseFirestoreValue(f.Vendor_name) || id;
      var phone = parseFirestoreValue(f.Phone) || "";
      return phone ? name + " (" + phone + ")" : name;
    });
  }

  // --- Zones: แสดง "Area — Building ชั้น Floor"
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

  // --- Cars: แสดง "Brand Model (Year) — Type"
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

  // --- helper ดึง collection แล้วสร้าง label จาก callback (ใช้ cache ร่วมกับฟังก์ชันอื่นๆ)
  function buildSimpleList(collectionName, labelFn) {
    var list = [];
    try {
      // ★ ข้อ 7: ใช้ docs ที่ดึงขนานกันมาแล้ว (ถ้ามี) ไม่ต้องยิง request ซ้ำทีละ collection
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

  // ★ preloadedMasters: parameter สำรองไว้เผื่ออนาคต (ปัจจุบันไม่มีจุดไหนส่งค่ามา
  //   จึงทำงานเหมือนเดิมทุกประการ คือดึง master สดทุกครั้งที่เรียกฟังก์ชันนี้)
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
// 13. saveProduct — รองรับทั้ง Add และ Update
//     Master_Products.html ส่ง productCode มาเมื่อ Edit
//     ★ รับ d.partType (บังคับเลือก), d.carIds (array รุ่นรถ)
//     ★ รับ d.partNumber (รหัสจากผู้ผลิต / Part Number) — ไม่บังคับกรอก แต่ถ้ากรอกต้องไม่ซ้ำกับสินค้าอื่น
// ==========================================
function saveProduct(d) {
  var carIds = Array.isArray(d.carIds) ? d.carIds.filter(Boolean) : [];

  var dataObject = {
    Product_Name      : String(d.productName   || ""),
    Part_Type         : String(d.partType      || ""),   // ★ เพิ่ม: แท้ / เทียบ
    Part_Number       : String(d.partNumber    || "").trim(),   // ★ รหัสจากผู้ผลิต (Part Number)
    Brand_ID          : String(d.brandId       || ""),
    Category_ID       : String(d.categoryId    || ""),
    Default_Vendor_ID : String(d.vendorId      || ""),
    Zone_ID           : String(d.zoneId        || "").trim() || "PENDING",  // ★ ไม่กรอกโซน → รอดำเนินการ
    Car_IDs           : carIds,                          // ★ array แทน Car_ID เดี่ยว
    Cost_Price        : parseFloat(d.costPrice    || 0),
    Selling_Price     : parseFloat(d.sellingPrice || 0),
    Current_Stock     : parseFloat(d.currentStock || 0),
    Min_Stock         : parseFloat(d.minStock     || 0),
    Status            : String(d.status        || "Active")
  };

  // ★ บังคับเลือกประเภทสินค้า — เช็คฝั่ง server กันกรณี bypass required ฝั่ง client
  if (dataObject.Part_Type !== "แท้" && dataObject.Part_Type !== "เทียบ") {
    return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณาเลือกประเภทสินค้า (แท้ / เทียบ)" };
  }

  var docId = d.productCode || d.docId || null;

  // ★ Part Number เป็น optional แต่ถ้ากรอกมาต้องไม่ซ้ำกับสินค้าอื่น (ไม่รวมตัวเองตอนแก้ไข)
  if (dataObject.Part_Number) {
    var dupCheck = checkPartNumberDuplicate(dataObject.Part_Number, docId);
    if (dupCheck) return dupCheck;
  }

  return saveMasterData("Master_Products", "P", docId, dataObject, d.productName);
}

// 13b. ★ เช็ครหัสจากผู้ผลิต (Part Number) ซ้ำกับสินค้าอื่นในระบบไหม (ไม่รวมตัวเองตอนแก้ไข)
//      ใช้ getAllProducts() ซึ่งดึงข้อมูลสดเสมอ (Master_Products ไม่ผ่าน cache อยู่แล้ว)
function checkPartNumberDuplicate(partNumber, excludeDocId) {
  var compareVal = String(partNumber || "").trim().toLowerCase();
  if (!compareVal) return null;

  // ★ ข้อ 5: ดึงเฉพาะ Master_Products อย่างเดียว ไม่ต้องสร้าง lookup map ของแบรนด์/หมวดหมู่/
  //   ผู้จำหน่าย/โซน/รถ (ซึ่ง getAllProducts ทำทุกครั้ง) เพราะการเทียบรหัสไม่ได้ใช้ข้อมูลพวกนั้นเลย
  var fetched = fetchAllPagesRaw("Master_Products");
  if (!fetched.ok) {
    // ดึงข้อมูลไม่สำเร็จ — ไม่ฟันธงว่าซ้ำ ปล่อยให้บันทึกต่อได้ (เหมือนพฤติกรรมเดิม)
    console.error("checkPartNumberDuplicate: ดึงข้อมูลสินค้าไม่สำเร็จ ข้ามการตรวจสอบซ้ำ");
    return null;
  }

  var isDuplicate = fetched.docs.some(function(doc) {
    if (doc.id === excludeDocId) return false;
    // ★ String() กัน TypeError กรณีข้อมูลเก่าเก็บ Part_Number เป็นตัวเลข
    var existingVal = String(parseFirestoreValue((doc.fields || {}).Part_Number) || "").trim().toLowerCase();
    return existingVal && existingVal === compareVal;
  });

  if (isDuplicate) {
    return { success: false, title: "ข้อมูลซ้ำ!", message: 'รหัสจากผู้ผลิต (Part Number) "' + partNumber + '" มีอยู่ในระบบแล้ว' };
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
function deleteCategory(docId)  { return deleteFirestoreDocument("Master_Categories", docId); }

// ==========================================
// 16. Master — Vendors
// ==========================================
// ★ รวมที่อยู่แบบมาตรฐาน (เลขที่/หมู่/ถนน/ตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์) เป็นข้อความเดียว
//   ใช้ร่วมกันทั้ง Vendor/Customer/Tax Invoice — ถ้าไม่มีข้อมูลแยกฟิลด์เลย (ข้อมูลเก่า) ใช้ Address เดิม fallback
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
  var taxId = String(d.taxId || "").replace(/\D/g, '');   // ★ เก็บเฉพาะตัวเลข

  // ★ เลขประจำตัวผู้เสียภาษีอากร บังคับกรอกและต้องเป็นตัวเลข 13 หลัก (จำเป็นสำหรับออกใบกำกับภาษี)
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
    Address      : String(d.address     || ""),   // ★ เก็บไว้ fallback ข้อมูลเก่า (free text) ที่มีอยู่แล้วในระบบ
    Tax_ID       : taxId,
    Branch       : String(d.branch || "").trim() || "สำนักงานใหญ่",
    Status       : String(d.status      || "Active")
  };
  return saveMasterData("Master_Vendors", "V", d.docId || null, dataObject, d.vendorName);
}

// getVendors — คืนรายการสำหรับ Dropdown (id + Name)
function getVendors() { return getFirestoreRawList("Master_Vendors"); }

// getVendorsFull — คืนข้อมูลครบทุก Field สำหรับแสดงตารางใน Master_Vendors.html
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
// ★ Master — Customers (ผู้ซื้อ/ลูกค้า)
//   Fields: Customer_Name, Address, Tax_ID, Branch, Phone, Status
//
//   ต่างจาก Master_Vendors ตรงที่ Tax_ID "ไม่บังคับ" — ลูกค้าเงินสดทั่วไป/ขาจร
//   จำนวนมากไม่มีเลขผู้เสียภาษี (ไม่ต้องออกใบกำกับภาษีเต็มรูปแบบ) แต่ถ้ากรอกมาต้องครบ 13 หลัก
// ==========================================
function saveCustomer(d) {
  var taxId = String(d.taxId || "").replace(/\D/g, '');

  // ★ ต่างจาก Vendor: ไม่บังคับกรอก แต่ถ้ากรอกมาต้องถูกต้อง 13 หลัก
  if (taxId && taxId.length !== 13) {
    return { success: false, title: "ข้อมูลไม่ถูกต้อง", message: "เลขประจำตัวผู้เสียภาษีอากรต้องมี 13 หลัก (กรอกมา " + taxId.length + " หลัก) หรือเว้นว่างไว้ถ้าไม่มี" };
  }

  var customerName = String(d.customerName || "").trim();
  if (!customerName) {
    return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณากรอกชื่อลูกค้า" };
  }

  var dataObject = {
    Customer_Name : customerName,
    Address_No    : String(d.addressNo   || ""),
    Address_Moo   : String(d.addressMoo  || ""),
    Address_Road  : String(d.addressRoad || ""),
    Subdistrict   : String(d.subdistrict || ""),
    District      : String(d.district    || ""),
    Province      : String(d.province    || ""),
    Postal_Code   : String(d.postalCode  || ""),
    Address       : String(d.address || ""),   // ★ เก็บไว้ fallback ข้อมูลเก่า (free text)
    Tax_ID        : taxId,
    Branch        : String(d.branch  || "").trim() || "สำนักงานใหญ่",
    Phone         : String(d.phone   || ""),
    Status        : String(d.status  || "Active")
  };
  return saveMasterData("Master_Customers", "C", d.docId || null, dataObject, d.customerName);
}

// getCustomers — คืนรายการสำหรับ Dropdown (id + Name)
function getCustomers() { return getFirestoreRawList("Master_Customers"); }

// getCustomersFull — คืนข้อมูลครบทุก Field สำหรับแสดงตารางใน Master_Customers.html
function getCustomersFull() {
  var list = [];
  try {
    var docs = fetchCollectionDocsCached("Master_Customers");
    docs.forEach(function(doc) {
      var f = doc.fields || {};
      list.push({
        id            : doc.id,
        Customer_Name : parseFirestoreValue(f.Customer_Name) || "",
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
// ★ Master — Tax Invoice (ใบกำกับภาษี/ใบเสร็จรับเงิน)
//   Fields: Invoice_No, Invoice_Date, Buyer_Name, Buyer_Address, Buyer_Tax_ID, Buyer_Branch,
//           Items_JSON, Subtotal, Vat_Amount, Grand_Total, Note
//
//   หมายเหตุสำคัญ: ใบนี้คือใบที่ร้าน (ผู้ขาย) ออกให้ลูกค้า (ผู้ซื้อ) โดยตรง
//   - ผู้ขาย = ข้อมูลร้านคงที่ทุกใบ (TAX_INVOICE_SELLER ด้านล่าง) ไม่ผูกกับ Master_Vendors เลย
//   - ผู้ซื้อ = ลูกค้าที่กรอกอิสระในฟอร์มทุกครั้ง ไม่มี master data อ้างอิง
// ==========================================

// ★ ข้อมูลผู้ขาย (ร้านของเราเอง) — คงที่ทุกใบ แก้ไขที่นี่จุดเดียวถ้าข้อมูลร้านเปลี่ยน
var TAX_INVOICE_SELLER = {
  name    : "บริษัท ส.ยืนยงอะไหล่ยนต์ จำกัด",
  branch  : "สำนักงานใหญ่ 000",
  address : "82-86 หมู่ที่ 3 ตำบลพยุหะ อำเภอพยุหะคีรี จังหวัดนครสวรรค์",
  taxId   : "0605563000707"
};

// คำนวณ VAT 7% จากรายการสินค้า — ใช้ทั้งตอนบันทึกฝั่ง server (กันความคลาดเคลื่อนจาก client)
// และฝั่ง client (แสดงผลสดตอนกรอกฟอร์ม)
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

// ★ คำนวณเลขที่ใบกำกับภาษีรูปแบบ "SYY 0007/08/67"
//   SYY   = รหัสบริษัทคงที่
//   0007  = running number 4 หลัก รีเซ็ตเป็น 0001 ทุกต้นเดือน
//   08/67 = เดือน/ปี พ.ศ. 2 หลัก — อิงจาก "วันที่ออกใบกำกับภาษี" ที่ผู้ใช้เลือก ไม่ใช่วันที่ปัจจุบัน
//           (รองรับออกใบย้อนหลัง เช่น เลือกวันที่เดือนก่อน ก็ต้องรันเลขของเดือนนั้น)
var TAX_INVOICE_PREFIX = "SYY";

function buildInvoiceNoForMonth(invoiceDateStr, runningNumber) {
  var d = invoiceDateStr ? new Date(invoiceDateStr + "T00:00:00") : new Date();
  if (isNaN(d.getTime())) d = new Date();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var yyBuddhist = String(d.getFullYear() + 543).slice(-2);
  return TAX_INVOICE_PREFIX + " " + String(runningNumber).padStart(4, '0') + "/" + mm + "/" + yyBuddhist;
}

// หา running number ถัดไปของ "เดือน/ปีเดียวกับ invoiceDateStr" โดยดูจาก Invoice_No ที่มีอยู่จริงในเดือนนั้น
// (ไม่ใช่ทั้ง collection) — ต้องดึงสดเสมอเพื่อกันชนกันเวลาบันทึกพร้อมกันหลายคน
function getNextInvoiceRunningNumber(invoiceDateStr, excludeDocId) {
  var targetSuffix = buildInvoiceNoForMonth(invoiceDateStr, 1).split('/').slice(1).join('/'); // "08/67"
  var fetched = fetchAllPagesRaw("Master_Tax_Invoice");
  var maxNum = 0;
  if (fetched.ok) {
    fetched.docs.forEach(function(doc) {
      if (doc.id === excludeDocId) return;   // ตอนแก้ไขไม่นับตัวเอง
      var f = doc.fields || {};
      var no = String(parseFirestoreValue(f.Invoice_No) || "");
      // รูปแบบ "SYY 0007/08/67" — ตัด prefix ออก แล้วเช็คว่าเดือน/ปีตรงกัน
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
  // ★ กรองรายการที่กรอกไม่ครบ (ไม่มีชื่อ หรือจำนวน/ราคาเป็น 0) ทิ้งก่อนบันทึก กันขยะปนในเอกสาร
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

  // ★ คำนวณ VAT ฝั่ง server เสมอ ไม่เชื่อตัวเลขที่ client ส่งมาตรงๆ กันการแก้ไข payload โดยตรง
  var totals = calcTaxInvoiceTotals(cleanItems);

  var invoiceDate = String(d.invoiceDate || "").trim() || new Date().toISOString().slice(0, 10);

  // ★ เลขที่ใบกำกับภาษี: ถ้าแก้ไขเอกสารเดิมและมีเลขที่อยู่แล้ว ให้คงเดิมไว้เสมอ
  //   (ไม่รันเลขใหม่ตอนแก้ไขแค่ยอดเงิน/รายการสินค้า — เลขที่ใบกำกับภาษีที่ออกไปแล้วห้ามเปลี่ยน)
  //   ถ้าสร้างใหม่ ให้รันเลขของเดือน/ปีตาม invoiceDate พร้อมกันชนกันแบบเดียวกับ saveMasterData (retry เมื่อชน)
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

  // ★ ปี พ.ศ. ของใบนี้ — ใช้อัปเดต metadata "ปีไหนมีข้อมูลบ้าง" หลังบันทึกสำเร็จ
  var invoiceYearBE = new Date(invoiceDate + "T00:00:00").getFullYear() + 543;

  // ★ กรณีแก้ไขและมีเลขที่เดิมอยู่แล้ว: ใส่ Invoice_No คงเดิมแล้วบันทึกผ่าน saveMasterData ปกติ (ใช้ PATCH)
  if (d.docId && invoiceNo) {
    dataObject.Invoice_No = invoiceNo;
    var editRes = saveMasterData("Master_Tax_Invoice", "TX", d.docId, dataObject, null);
    if (editRes.success) updateTaxInvoiceYearsMeta_(invoiceYearBE);
    return editRes;
  }

  // ★ กรณีสร้างใหม่ (หรือแก้ไขแต่หาเลขที่เดิมไม่เจอ): รันเลขที่ใหม่ พร้อม retry กันชนกัน
  //   ต้องรัน retry เอง (ไม่ผ่าน saveMasterData ตรงๆ) เพราะ Invoice_No ไม่ใช่ Firestore document ID
  //   (มี "/" ซึ่ง Firestore ห้ามใช้เป็น doc ID) จึงต้องเช็คชนกันแยกจากกลไกเดิม
  var lastErr = "";
  for (var attempt = 0; attempt < 10; attempt++) {
    var runningNum = getNextInvoiceRunningNumber(invoiceDate, d.docId || null) + attempt;
    dataObject.Invoice_No = buildInvoiceNoForMonth(invoiceDate, runningNum);

    var res = saveMasterData("Master_Tax_Invoice", "TX", d.docId || null, dataObject, null);
    if (res.success) {
      updateTaxInvoiceYearsMeta_(invoiceYearBE);
      return res;
    }
    // ถ้าล้มเหลวเพราะเหตุอื่นที่ไม่เกี่ยวกับเลขที่ซ้ำ ให้หยุดเลย ไม่ต้อง retry ไปเรื่อยๆ
    lastErr = res.message;
    if (String(res.message || "").indexOf("ALREADY_EXISTS") === -1 &&
        String(res.message || "").indexOf("409") === -1) {
      break;
    }
  }
  return { success: false, title: "ล้มเหลว", message: lastErr || "ไม่สามารถออกเลขที่ใบกำกับภาษีได้ กรุณาลองอีกครั้ง" };
}

// ══════════════════════════════════════════════════════════════════════════
// ★ ระบบลด quota การอ่านใบกำกับภาษี — โหลดเฉพาะปีที่เลือกแทนการดึงทุกปีทุกครั้ง
//
//   ปัญหาเดิม: getTaxInvoiceList() เดิมดึงทุก document ทุกปีทุกครั้งที่เปิดหน้า
//   ยิ่งสะสมหลายปียิ่งอ่านเยอะขึ้นเรื่อยๆ ไม่มีวันลดลง
//
//   วิธีแก้: ใช้ Firestore structured query (runQuery) กรองช่วงวันที่ที่ตัว
//   database เลย อ่านเฉพาะเอกสารที่ตรงปีนั้นจริงๆ ไม่ต้องดึงมาทั้งหมดแล้วกรองทีหลัง
//
//   ปัญหาต่อมา: ถ้าไม่โหลดทุกปี จะไม่รู้ว่า "มีข้อมูลปีไหนบ้าง" สำหรับสร้าง dropdown
//   วิธีแก้: เก็บ metadata แยกต่างหาก (Meta_Counters/tax_invoice_years) อัปเดต
//   ทุกครั้งที่บันทึกใบใหม่ (เขียนเพิ่มแค่ตอน save เท่านั้น ไม่กระทบตอนเปิดหน้าดู)
//   → อ่าน metadata นี้แค่ 1 document เพื่อรู้รายการปีทั้งหมด แทนที่จะอ่านทุกใบ
// ══════════════════════════════════════════════════════════════════════════

var META_COLLECTION      = "Meta_Counters";
var TAX_INVOICE_YEARS_ID = "tax_invoice_years";

// อัปเดต metadata ปีที่มีใบกำกับภาษี — เรียกหลังบันทึกใบสำเร็จเท่านั้น (ไม่กระทบตอนอ่าน)
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
    // ★ ถ้าปีนี้มีอยู่แล้วในรายการ ไม่ต้องเขียนซ้ำ (ประหยัด write เพิ่ม)
    if (years.indexOf(yearBE) > -1) return;

    years.push(yearBE);
    years.sort(function(a, b) { return b - a; });

    var payload = {
      fields: {
        Years: { arrayValue: { values: years.map(function(y) { return { integerValue: y }; }) } }
      }
    };
    // ★ PATCH สร้างเอกสารใหม่ให้อัตโนมัติถ้ายังไม่มี (upsert) — ไม่ต้องเช็คแยกว่ามีอยู่ก่อนไหม
    UrlFetchApp.fetch(url + "?updateMask.fieldPaths=Years", {
      method: "patch", headers: getAuthHeader(), payload: JSON.stringify(payload), muteHttpExceptions: true
    });
  } catch (e) {
    // ★ metadata พังไม่ควรทำให้การบันทึกใบจริงล้มเหลว — log ไว้เฉยๆ พอ
    console.error("updateTaxInvoiceYearsMeta_ error:", e);
  }
}

// ดึงรายการปีที่มีข้อมูลใบกำกับภาษี — อ่านแค่ 1 document เท่านั้น (ไม่แตะ collection ใบกำกับภาษีเลย)
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
  // ★ ยังไม่มี metadata เลย (ระบบใหม่ยังไม่เคยออกใบ) — คืนปีปัจจุบันเป็นค่าเริ่มต้นที่สมเหตุสมผล
  return [new Date().getFullYear() + 543];
}

// แปลง documents ที่ได้จาก runQuery ให้เป็นรูปแบบเดียวกับ getTaxInvoiceList()
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

// ★ ดึงใบกำกับภาษีเฉพาะปีที่ระบุ — ใช้ structured query กรองที่ database โดยตรง
//   ลด read quota จริง (อ่านเฉพาะเอกสารที่ตรงเงื่อนไข ไม่ใช่ทุกเอกสารแล้วมากรองทีหลัง)
function getTaxInvoiceListByYear(yearBE) {
  var list = [];
  try {
    var yearAD = yearBE - 543;   // Invoice_Date เก็บเป็นปี ค.ศ. (จาก input type=date)
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

function getTaxInvoiceList() {
  var list = [];
  try {
    var fetched = fetchAllPagesRaw("Master_Tax_Invoice");
    if (fetched.ok) {
      fetched.docs.forEach(function(doc) {
        var f = doc.fields || {};
        var items = [];
        try { items = JSON.parse(parseFirestoreValue(f.Items_JSON) || "[]"); } catch (e) { items = []; }

        list.push({
          id           : doc.id,
          invoiceNo    : parseFirestoreValue(f.Invoice_No)    || doc.id,
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
        });
      });
    } else {
      console.error("getTaxInvoiceList: ดึงข้อมูลใบกำกับภาษีไม่สำเร็จ");
    }
  } catch (e) {
    console.error("getTaxInvoiceList error:", e);
  }
  list.sort(function(a, b) { return b.invoiceNo.localeCompare(a.invoiceNo); });
  return list;
}

// ★ หน้า Tax Invoice ต้องใช้รายการใบกำกับภาษี + ข้อมูลผู้ขาย (ร้านเราเอง) + รายชื่อลูกค้า
//   ดึงพร้อมกันครั้งเดียว ไม่ต้อง hardcode seller ซ้ำที่ frontend และไม่ต้องเรียก getCustomersFull แยกรอบ
// ★ yearFilter: ตัวเลขปี พ.ศ. (โหลดเฉพาะปีนั้น ลด quota) หรือ "all" (โหลดทุกปีเหมือนเดิม)
//   ไม่ระบุ = ค่าเริ่มต้นเป็นปีปัจจุบัน (ปีล่าสุด) ตามที่ตกลงไว้
function getTaxInvoicePageData(yearFilter) {
  var invoices;
  if (yearFilter === "all") {
    invoices = getTaxInvoiceList();          // ทุกปี — ผู้ใช้เลือกเองเท่านั้น ไม่ใช่ค่าเริ่มต้น
  } else {
    var yearBE = parseInt(yearFilter, 10) || (new Date().getFullYear() + 543);
    invoices = getTaxInvoiceListByYear(yearBE);   // ปีเดียว — ค่าเริ่มต้น ลด quota
  }
  return {
    invoices       : invoices,
    seller         : TAX_INVOICE_SELLER,
    customers      : getCustomersFull(),
    availableYears : getTaxInvoiceAvailableYears()   // อ่านแค่ 1 document metadata ไม่แตะใบกำกับภาษีเลย
  };
}

function deleteTaxInvoice(docId) { return deleteFirestoreDocument("Master_Tax_Invoice", docId); }

// ==========================================
// 17. Master — Zones
//     Fields: Area, Build, Floor, Rack_no, Note, Car_ID, Status
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

// getZones — คืนรายการสำหรับ Dropdown (id + Name)
function getZones() { return getFirestoreRawList("Master_Zones"); }

// getZoneById — ใช้โดย Master_Zones.html (Edit)
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

// getZonesFull — คืนข้อมูลครบทุก Field สำหรับแสดงตารางใน Master_Zones.html
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
//     Fields: Brand, Type_Car, Model, Year
//     Prefix: CAR → CAR0001, CAR0002, ...
// ==========================================
function saveCar(d) {
  var dataObject = {
    Brand    : String(d.brand   || ""),
    Type_Car : String(d.typeCar || ""),
    Model    : String(d.model   || ""),
    Year     : String(d.year    || "")
  };
  // เช็คซ้ำจาก Brand (field แรกที่ระบุ)
  return saveMasterData("Master_Cars", "CAR", d.docId || null, dataObject, d.brand);
}

// getCarsFull — คืนข้อมูลครบทุก Field สำหรับตารางใน Master_Cars.html
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
// 19b. ★ ระบบสำรองข้อมูล (Backup / Restore) — Google Drive
//
//   หลักการ: ดึงข้อมูลดิบ (raw Firestore fields) ทุก collection ผ่าน fetchAllPagesRaw()
//   ที่มีอยู่แล้ว แล้วเก็บเป็นไฟล์ JSON เดียวใน Google Drive
//   ★ สำคัญ: เก็บ "fields" แบบดิบจาก Firestore ตรงๆ (ไม่ parse) เพื่อให้ restore กลับ
//     ได้ตรงเป๊ะทุกชนิดข้อมูล (stringValue/doubleValue/...) โดยไม่ต้องเดาชนิดใหม่
//   ตั้งเวลาอัตโนมัติทุกสัปดาห์ผ่าน Time-driven trigger (ดู setupWeeklyBackupTrigger ด้านล่าง)
// ==========================================

var BACKUP_FOLDER_NAME  = "SYY Shop - Backups";     // ชื่อโฟลเดอร์ Google Drive ที่เก็บไฟล์ backup ทั้งหมด
var BACKUP_KEEP_COUNT   = 8;                         // เก็บไฟล์ backup ล่าสุดไว้กี่ไฟล์ (8 สัปดาห์ ~ 2 เดือน) เก่ากว่านั้นลบทิ้งอัตโนมัติ
var BACKUP_COLLECTIONS  = [
  "Master_Brands", "Master_Categories", "Master_Vendors", "Master_Customers",
  "Master_Zones", "Master_Cars", "Master_Products", "Master_Tax_Invoice", "Purchase_Orders"
];

// หาโฟลเดอร์ backup ใน Drive ถ้ายังไม่มีให้สร้างใหม่ — เรียกซ้ำได้ปลอดภัย ไม่สร้างซ้ำ
function getOrCreateBackupFolder() {
  var folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

// ★ ฟังก์ชันหลัก: สำรองข้อมูลทุก collection เป็นไฟล์ JSON เดียว บันทึกลง Google Drive
//   เรียกเองได้จากปุ่มในหน้าเว็บ (backupNow) หรือให้ trigger เรียกอัตโนมัติทุกสัปดาห์ (weeklyBackupJob)
function backupAllDataToBackup() {
  var result = { success: true, collections: {}, errors: [] };
  var snapshot = {};

  BACKUP_COLLECTIONS.forEach(function(collectionName) {
    try {
      var fetched = fetchAllPagesRaw(collectionName);
      if (fetched.ok) {
        snapshot[collectionName] = fetched.docs;   // [{ id, fields }, ...] แบบดิบ
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

    // ★ ลบไฟล์ backup เก่าที่เกินจำนวนที่กำหนด (BACKUP_KEEP_COUNT) กันโฟลเดอร์บวมไม่มีที่สิ้นสุด
    cleanupOldBackups(folder);

  } catch (e) {
    result.success = false;
    result.errors.push("บันทึกไฟล์ลง Drive ไม่สำเร็จ: " + e.message);
    console.error("backupAllDataToBackup save error:", e);
  }

  if (result.errors.length > 0 && result.success) {
    result.success = false;   // มี error บาง collection ถือว่า backup ไม่สมบูรณ์ ต้องแจ้งเตือน
  }

  return result;
}

// ลบไฟล์ backup เก่าเกินจำนวนที่กำหนด — เก็บเฉพาะไฟล์ล่าสุด BACKUP_KEEP_COUNT ไฟล์
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
    fileList.sort(function(a, b) { return b.date - a.date; });   // ใหม่สุดก่อน

    for (var i = BACKUP_KEEP_COUNT; i < fileList.length; i++) {
      fileList[i].file.setTrashed(true);
    }
  } catch (e) {
    console.error("cleanupOldBackups error:", e);
  }
}

// ★ เรียกจากปุ่ม "สำรองข้อมูลตอนนี้" ในหน้าเว็บ — ทำ backup ทันทีแบบ manual
function backupNow() {
  return backupAllDataToBackup();
}

// ★ ฟังก์ชันที่ trigger รายสัปดาห์เรียก — ไม่ต้องคืนค่าอะไร (ไม่มีหน้าเว็บรอผลลัพธ์)
function weeklyBackupJob() {
  var result = backupAllDataToBackup();
  if (!result.success) {
    console.error("weeklyBackupJob ล้มเหลวบางส่วน:", JSON.stringify(result.errors));
  }
}

// ★ ตั้งเวลาให้ backup อัตโนมัติทุกสัปดาห์ — รันฟังก์ชันนี้ "1 ครั้ง" ผ่าน Apps Script Editor
//   (เมนู Run > setupWeeklyBackupTrigger) ไม่ต้องรันซ้ำอีกหลังจากนั้น ระบบจะรันเองทุกสัปดาห์ตลอดไป
//   ถ้าต้องการเปลี่ยนวัน/เวลา ให้รัน removeWeeklyBackupTrigger() ก่อน แล้วแก้โค้ดด้านล่างแล้วรันใหม่
function setupWeeklyBackupTrigger() {
  removeWeeklyBackupTrigger();   // กันสร้างซ้ำถ้าเคยตั้งไว้แล้ว
  ScriptApp.newTrigger("weeklyBackupJob")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)   // ทุกวันอาทิตย์ (เลือกวันที่ระบบใช้งานน้อยที่สุด)
    .atHour(2)                              // ตี 2 (เวลาของบัญชี Google ที่ deploy สคริปต์นี้)
    .create();
  return "ตั้งเวลา backup อัตโนมัติทุกวันอาทิตย์ เวลา 02:00 น. เรียบร้อยแล้ว";
}

function removeWeeklyBackupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === "weeklyBackupJob") ScriptApp.deleteTrigger(t);
  });
}

// ★ ดูรายการไฟล์ backup ที่มีอยู่ทั้งหมด (ใช้แสดงในหน้าเว็บ ถ้าต้องการ)
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

// ★ กู้คืนข้อมูลจากไฟล์ backup — เขียน raw fields กลับ Firestore ตรงๆ ด้วย ID เดิม
//   ★ คำเตือนสำคัญ: ฟังก์ชันนี้จะ "เขียนทับ" เอกสารที่มี ID เดียวกันในปัจจุบันทันที (PATCH)
//     ควรใช้เฉพาะกรณีข้อมูลเสียหายจริงๆ เท่านั้น ไม่ใช่ใช้งานประจำ
//   restoreMode: "all" = กู้ทุก collection, หรือระบุชื่อ collection เดียวก็ได้ (เช่น "Master_Products")
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
          // ★ ต้องระบุ updateMask.fieldPaths ทุก field ไม่งั้น Firestore PATCH จะไม่อัปเดตอะไรเลย
          //   (ยืนยัน pattern นี้จากจุดอื่นในระบบที่ใช้ PATCH ทั้งหมด — updateMask จำเป็นเสมอ)
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

      clearCollectionCache(collectionName);   // ล้าง cache ทันทีหลัง restore กันข้อมูลเก่าค้าง
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
// 20. ทดสอบการเชื่อมต่อ — รันใน Editor แล้วดู Log
// ==========================================
function testConnection() {
  var token = ScriptApp.getOAuthToken();
  var url   = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/Master_Zones?pageSize=3";
  var res = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { "Authorization": "Bearer " + token },
    muteHttpExceptions: true
  });
  Logger.log("Status : " + res.getResponseCode());
  Logger.log("Response: " + res.getContentText());
}

// ==========================================
// 21. ★ (ทางเลือก) Migrate ข้อมูลเก่า Car_ID เดี่ยว → Car_IDs array
//     รันครั้งเดียวใน Editor เพื่อแปลงข้อมูลเก่าให้เป็นรูปแบบใหม่
//     หมายเหตุ: ไม่จำเป็นต้องรัน เพราะ getAllProducts/getProductById
//     รองรับ fallback อ่าน Car_ID เดี่ยวอยู่แล้ว แต่แนะนำให้รันเพื่อความสะอาดของข้อมูล
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

      // ข้ามถ้ามี Car_IDs อยู่แล้ว
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
//     ใช้โดย Purchase_Orders.html
//     Collection ใหม่: Purchase_Orders
//     Fields: Vendor_ID, Order_Date, Status, Items_JSON, Total_Qty, Total_Amount, Note
//     (ไม่กระทบ Collection เดิมใดๆ — เป็นข้อมูลใหม่ทั้งหมด)
// ==========================================

// 22.1 ดึงสินค้าที่สต็อกต่ำกว่าขั้นต่ำ พร้อมข้อมูลผู้จัดจำหน่าย สำหรับหน้าสั่งซื้อ
//      (ยังเรียกใช้แยกเดี่ยวได้ตามเดิม — ข้างในดึง vendorMap เองถ้าไม่ได้ส่งมา)
function getLowStockProductsForOrder() {
  return buildLowStockList(buildVendorMap());
}

function buildLowStockList(vendorMap) {
  var result = [];
  try {
    var products = getAllProducts();      // ใช้ฟังก์ชันเดิม ไม่ซ้ำ logic การดึงข้อมูล
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
          vendorTaxId   : v.Tax_ID       || "",   // ★ เพิ่ม: สำหรับออกใบกำกับภาษี
          vendorBranch  : v.Branch       || ""    // ★ เพิ่ม: สำหรับออกใบกำกับภาษี
        };
      });
  } catch (e) {
    console.error("buildLowStockList error:", e);
  }
  return result;
}

// 22.2 บันทึกใบสั่งซื้อใหม่ (ประวัติเป็น Add-only — ไม่แก้ไขรายการย้อนหลัง แก้ได้แค่สถานะ)
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
      receivedQty : 0   // ★ ยังไม่ได้รับสินค้า ณ ตอนสร้างใบสั่งซื้อ — ใช้ track การรับของบางส่วน
    };
  });

  var dataObject = {
    Vendor_ID     : String(d.vendorId  || ""),
    Order_Date    : String(d.orderDate || new Date().toISOString().slice(0, 10)),
    Status        : String(d.status    || "Pending"),
    Items_JSON    : JSON.stringify(items),      // ★ เก็บรายการสินค้าเป็น JSON string (mapToFirestoreFields รองรับอยู่แล้ว)
    Receipts_JSON : JSON.stringify([]),         // ★ ประวัติการรับสินค้า (Invoice/วันที่/ผู้รับ/ใบส่งของ) เริ่มต้นว่าง
    Total_Qty     : totalQty,
    Total_Amount  : totalAmount,
    Note          : String(d.note || "")
  };

  return saveMasterData("Purchase_Orders", "PO", null, dataObject, null);
}

// helper: สร้าง vendorMap { vendorId: {Vendor_name, Contact_name, Phone, Email, Address} }
// ดึงครั้งเดียว ใช้ร่วมกันได้ทั้ง getLowStockProductsForOrder และ getPurchaseOrders
// (getVendorsFull ผ่าน cache อยู่แล้ว แต่ทำ vendorMap ให้ใช้ซ้ำในหน่วยความจำระหว่าง request เดียวกันไปเลย กันสร้างซ้ำ)
function buildVendorMap() {
  var vendorMap = {};
  getVendorsFull().forEach(function(v) { vendorMap[v.id] = v; });
  return vendorMap;
}

// 22.3 ดึงประวัติใบสั่งซื้อทั้งหมด (เรียงล่าสุดก่อน)
//      (ยังเรียกใช้แยกเดี่ยวได้ตามเดิม — ข้างในดึง vendorMap เองถ้าไม่ได้ส่งมา)
function getPurchaseOrders() {
  return buildPurchaseOrderList(buildVendorMap());
}

function buildPurchaseOrderList(vendorMap) {
  var list = [];
  try {
    // ★ ข้อ 8: ดึงครบทุกหน้า ไม่ตัดที่ 300 ใบ
    var fetched = fetchAllPagesRaw("Purchase_Orders");
    if (fetched.ok) {
      fetched.docs.forEach(function(doc) {
        var id = doc.id;
        var f  = doc.fields || {};
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
          vendorAddress : v.Address      || "",   // ★ เพิ่ม: สำหรับออกใบกำกับภาษี
          vendorTaxId   : v.Tax_ID       || "",   // ★ เพิ่ม: สำหรับออกใบกำกับภาษี
          vendorBranch  : v.Branch       || "",   // ★ เพิ่ม: สำหรับออกใบกำกับภาษี
          orderDate     : parseFirestoreValue(f.Order_Date) || "",
          status        : parseFirestoreValue(f.Status)     || "Pending",
          items         : items,
          receipts      : receipts,   // ★ ประวัติการรับสินค้าแต่ละครั้ง
          totalQty      : parseFloat(parseFirestoreValue(f.Total_Qty)    || 0),
          totalAmount   : parseFloat(parseFirestoreValue(f.Total_Amount) || 0),
          note          : parseFirestoreValue(f.Note) || ""
        });
      });
    } else {
      console.error("buildPurchaseOrderList: ดึงข้อมูลใบสั่งซื้อไม่สำเร็จ");
    }
  } catch (e) {
    console.error("buildPurchaseOrderList error:", e);
  }

  list.sort(function(a, b) { return b.poId.localeCompare(a.poId); });
  return list;
}

// 22.3b ★ ดึงข้อมูลทั้งหมดที่หน้า Purchase_Orders.html ต้องใช้ในครั้งเดียว
//       (สินค้าสต็อกต่ำ + ประวัติใบสั่งซื้อ) — ดึง Vendor แค่ครั้งเดียว ใช้ร่วมกันทั้ง 2 ส่วน
//       แทนที่จะให้ฝั่งหน้าเว็บเรียก getLowStockProductsForOrder() + getPurchaseOrders() แยกกัน 2 รอบ
//       (ซึ่งแต่ละรอบดึงข้อมูลผู้จัดจำหน่ายซ้ำกันเอง) ลดทั้งจำนวน request และการดึงข้อมูลซ้ำซ้อน
function getPurchaseOrderPageData() {
  var vendorMap = buildVendorMap();
  return {
    lowStockItems  : buildLowStockList(vendorMap),
    purchaseOrders : buildPurchaseOrderList(vendorMap)
  };
}

// 22.4 อัปเดตสถานะใบสั่งซื้อ — ใช้ได้เฉพาะ Pending / Ordered / Cancelled เท่านั้น
//      ★ ห้ามเปลี่ยนเป็น Received / PartiallyReceived ทางนี้ ต้องผ่าน receiveGoods() เท่านั้น
//        เพราะต้องกรอกข้อมูลบังคับ (Invoice/วันที่/ผู้รับ) และมีผลบวกสต็อกสินค้าจริง
//      ★ ใบที่ Status = Received แล้วถือเป็นจุดสิ้นสุด แก้ไขสถานะต่อไม่ได้ (กันบวกสต็อกซ้ำ/สถานะขัดแย้งกับสต็อก)
//      ★ ใบที่ได้รับสินค้าบางส่วนแล้ว (PartiallyReceived) จะยกเลิกไม่ได้ เพราะสต็อกถูกบวกไปแล้วบางส่วน
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

// 22.4b ★ บวกจำนวนสต็อกของสินค้า (อ่านค่าปัจจุบันแล้วบวกกลับ — ใช้เมื่อรับสินค้าเข้าคลังจริง)
// 22.4b-2 ★ ข้อ 6: บวกสต็อกหลายรายการพร้อมกันใน request เดียว (Firestore commit API)
//   ใช้ fieldTransform "increment" ซึ่งเป็น atomic ฝั่ง Firestore เอง:
//   - ไม่ต้อง GET ค่าเดิมมาบวกแล้ว PATCH กลับ (เดิมใช้ 2 requests ต่อสินค้า 1 ตัว)
//   - ไม่มีปัญหาสต็อกเพี้ยนถ้ามีคนรับของ/ตัดสต็อกพร้อมกัน (เดิมค่าที่อ่านมาอาจเก่าไปแล้ว)
//   items = [{ productCode, qty }]
//   คืน true เมื่อสำเร็จทั้งชุด
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

// ★ หมายเหตุ: เดิมมี incrementProductStock(productCode, addQty) ที่ทำ GET แล้ว PATCH ทีละรายการ
//   ถูกลบออกแล้วเพราะไม่มีที่ไหนเรียกใช้ — ทุกจุดเปลี่ยนมาใช้ incrementProductStockBatch() ด้านบน
//   ซึ่งใช้ commit API + fieldTransform increment เป็น atomic ในคำขอเดียว เร็วกว่าและไม่มีปัญหาสต็อกเพี้ยน

// 22.4c ★ บันทึกการรับสินค้า (รองรับรับครบ / รับบางส่วน) — บวกสต็อกจริง + บังคับกรอกข้อมูลที่จำเป็น
//       d = { poId, invoiceNo, receiptDate, receiverName, deliveryNoteNo, items:[{productCode, qtyReceivedNow}] }
function receiveGoods(d) {
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
    var stockAdditions   = [];   // ★ เก็บไว้บวกทีเดียวหลังตรวจสอบครบ (ไม่บวกทันทีใน loop)

    poItems = poItems.map(function(it) {
      var alreadyReceived = parseFloat(it.receivedQty || 0);
      var ordered          = parseFloat(it.qty || 0);
      var remaining         = Math.max(ordered - alreadyReceived, 0);
      var receiveNow         = receiveMap.hasOwnProperty(it.productCode) ? receiveMap[it.productCode] : 0;

      if (receiveNow < 0) receiveNow = 0;
      if (receiveNow > remaining) receiveNow = remaining;   // ★ กันรับเกินจำนวนที่สั่ง

      var newReceived = alreadyReceived + receiveNow;
      if (newReceived < ordered) allComplete = false;

      if (receiveNow > 0) {
        receiptLineItems.push({ productCode: it.productCode, productName: it.productName, qtyReceivedNow: receiveNow });
        stockAdditions.push({ productCode: it.productCode, qty: receiveNow });
      }

      it.receivedQty = newReceived;
      return it;
    });

    if (!receiptLineItems.length) return fail("กรุณาระบุจำนวนที่รับอย่างน้อย 1 รายการ");

    if (!allComplete && !String(d.deliveryNoteNo || "").trim()) {
      return fail("กรุณากรอกเลขที่ใบส่งของชั่วคราว เนื่องจากได้รับสินค้าไม่ครบตามจำนวนที่สั่งซื้อ");
    }

    // ★ ข้อ 6: บวกสต็อกทุกรายการพร้อมกันใน request เดียว (atomic increment)
    //   ★ ทำหลังผ่านการตรวจสอบครบแล้วเท่านั้น — เดิมบวกทันทีใน loop ด้านบน
    //     ทำให้ถ้า validation ด้านล่างไม่ผ่าน สต็อกถูกบวกไปแล้วทั้งที่ใบสั่งซื้อไม่ได้อัปเดต (ข้อมูลเพี้ยน)
    if (!incrementProductStockBatch(stockAdditions)) {
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

// 22.5 ลบใบสั่งซื้อออกจากประวัติ
function deletePurchaseOrder(docId) {
  return deleteFirestoreDocument("Purchase_Orders", docId);
}

// ══════════════════════════════════════════════════════════════════════════
// 23. ★★★ ระบบยืนยันตัวตน (Authentication & Authorization) ★★★
//
//   สถาปัตยกรรม:
//   - เก็บผู้ใช้ใน Firestore collection "Master_Users"
//   - รหัสผ่าน: SHA-256 + salt รายคน (ทางเดียว ถอดกลับไม่ได้)
//   - TOTP secret: เข้ารหัสสองทางก่อนเก็บ (ต้องถอดมาคำนวณ OTP ทุกครั้ง)
//   - Session: token สุ่มเก็บใน CacheService อายุ 8 ชม. (= 1 กะทำงาน)
//   - ทุกคำขอจาก frontend ผ่าน apiGateway() จุดเดียว = จุดตรวจสิทธิ์จุดเดียว
//     (ปลอดภัยกว่ากระจาย guard ไป 31 ฟังก์ชัน เพราะพลาดจุดเดียวคือรูรั่ว)
// ══════════════════════════════════════════════════════════════════════════

var AUTH_USERS_COLLECTION = "Master_Users";
var AUTH_SESSION_HOURS    = 8;
var AUTH_MAX_ATTEMPTS     = 5;
var AUTH_LOCK_MINUTES     = 15;
var AUTH_RECOVERY_COUNT   = 10;

// ─────────────────────────────────────────────────────────────
// 23.1 Master Key — ใช้เข้ารหัส TOTP secret
//   เก็บใน Script Properties (คนละที่กับ Firestore)
//   ถ้า Firestore รั่ว/ไฟล์ backup หลุด ก็ถอด TOTP secret ไม่ได้เพราะ key ไม่ได้อยู่ในนั้น
// ─────────────────────────────────────────────────────────────
function getMasterKey_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty("AUTH_MASTER_KEY");
  if (!key) {
    // สร้างครั้งแรกอัตโนมัติ (สุ่ม 32 ไบต์) แล้วเก็บถาวร
    var bytes = [];
    for (var i = 0; i < 32; i++) bytes.push(Math.floor(Math.random() * 256));
    key = Utilities.base64Encode(bytes);
    props.setProperty("AUTH_MASTER_KEY", key);
  }
  return key;
}

// ─────────────────────────────────────────────────────────────
// 23.2 การเข้ารหัสสองทาง (สำหรับ TOTP secret)
//
//   ★ ข้อจำกัดที่ต้องรู้: Apps Script ไม่มี AES ในตัว (มีแค่ hash/HMAC ซึ่งเป็นทางเดียว)
//     จึงสร้าง stream cipher จาก HMAC-SHA256 แบบ counter mode:
//       keystream = HMAC(masterKey, nonce + counter) ต่อกันไปเรื่อยๆ แล้ว XOR กับข้อความ
//     พร้อม encrypt-then-MAC กันข้อมูลถูกแก้ระหว่างทาง
//   ★ ระดับความปลอดภัย: เพียงพอสำหรับปกป้องข้อมูลที่เก็บไว้ (at rest) ในระบบภายในร้าน
//     ไม่เทียบเท่า AES-GCM มาตรฐานสากล — ยอมรับข้อจำกัดนี้เพราะแพลตฟอร์มไม่รองรับ
// ─────────────────────────────────────────────────────────────
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
  // encrypt-then-MAC: ผูก nonce+ciphertext ด้วยลายเซ็น กันคนแก้ข้อมูลใน Firestore โดยตรง
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

    // ตรวจลายเซ็นก่อนถอด — ถ้าไม่ตรงแปลว่าข้อมูลถูกแก้ ให้ถือว่าใช้ไม่ได้
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

// ─────────────────────────────────────────────────────────────
// 23.3 รหัสผ่าน — hash ทางเดียว + salt รายคน
// ─────────────────────────────────────────────────────────────
function makeSalt_() {
  return Utilities.getUuid().replace(/-/g, "");
}

function hashPassword_(password, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password) + ":" + String(salt));
  return Utilities.base64Encode(raw);
}

// เทียบรหัสแบบใช้เวลาคงที่ กัน timing attack (เดารหัสจากเวลาตอบสนอง)
function safeEquals_(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return diff === 0;
}

// ─────────────────────────────────────────────────────────────
// 23.4 TOTP (RFC 6238) — รหัส 6 หลักเปลี่ยนทุก 30 วินาที
//   ใช้กับแอป Google Authenticator / Microsoft Authenticator ได้ตามมาตรฐาน
// ─────────────────────────────────────────────────────────────
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

  // แปลง counter เป็น 8 ไบต์ big-endian ตามสเปค
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

  // dynamic truncation ตาม RFC 4226
  var offset = hmac[hmac.length - 1] & 0x0F;
  var binary = ((hmac[offset] & 0x7F) << 24) |
               ((hmac[offset + 1] & 0xFF) << 16) |
               ((hmac[offset + 2] & 0xFF) << 8) |
               (hmac[offset + 3] & 0xFF);
  var otp = binary % 1000000;
  return ("000000" + otp).slice(-6);
}

// ตรวจ OTP — ยอมรับช่วงก่อน/หลัง 1 ช่วง (±30 วิ) กันนาฬิกาเครื่องผู้ใช้คลาดเล็กน้อย
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

// ─────────────────────────────────────────────────────────────
// 23.5 Session — token เก็บใน CacheService
// ─────────────────────────────────────────────────────────────
function createSession_(user) {
  var token = Utilities.getUuid() + "-" + Utilities.getUuid();
  var payload = {
    username : user.Username,
    fullName : user.Full_Name,
    role     : user.Role,
    issuedAt : Date.now()
  };
  CacheService.getScriptCache().put("sess_" + token, JSON.stringify(payload), AUTH_SESSION_HOURS * 3600);
  return { token: token, profile: payload };
}

function getSession_(token) {
  if (!token) return null;
  try {
    var raw = CacheService.getScriptCache().get("sess_" + token);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function destroySession_(token) {
  if (token) CacheService.getScriptCache().remove("sess_" + token);
}

// ─────────────────────────────────────────────────────────────
// 23.6 อ่าน/เขียนผู้ใช้ใน Firestore
// ─────────────────────────────────────────────────────────────
function findUserByUsername_(username) {
  var uname = String(username || "").trim().toLowerCase();
  if (!uname) return null;
  try {
    var fetched = fetchAllPagesRaw(AUTH_USERS_COLLECTION);
    if (!fetched.ok) return null;
    for (var i = 0; i < fetched.docs.length; i++) {
      var f = fetched.docs[i].fields || {};
      if (String(parseFirestoreValue(f.Username) || "").toLowerCase() === uname) {
        return {
          docId           : fetched.docs[i].id,
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
          Locked_Until    : parseFirestoreValue(f.Locked_Until) || ""
        };
      }
    }
  } catch (e) {
    console.error("findUserByUsername_ error:", e);
  }
  return null;
}

// หา user จาก email — ใช้ตอนขอ reset password (แยกจาก findUserByUsername_ เพราะ login ใช้ username)
function findUserByEmail_(email) {
  var target = String(email || "").trim().toLowerCase();
  if (!target) return null;
  try {
    var fetched = fetchAllPagesRaw(AUTH_USERS_COLLECTION);
    if (!fetched.ok) return null;
    for (var i = 0; i < fetched.docs.length; i++) {
      var f = fetched.docs[i].fields || {};
      if (String(parseFirestoreValue(f.Email) || "").toLowerCase() === target) {
        return findUserByUsername_(parseFirestoreValue(f.Username) || "");
      }
    }
  } catch (e) {
    console.error("findUserByEmail_ error:", e);
  }
  return null;
}

// อัปเดตเฉพาะบาง field ของผู้ใช้ (ต้องระบุ updateMask ทุก field ไม่งั้น Firestore ไม่อัปเดตให้)
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

// ─────────────────────────────────────────────────────────────
// 23.7 Recovery codes — ใช้ตอนมือถือหาย เข้า TOTP ไม่ได้
//   เก็บเป็น hash (ใช้แล้วทิ้ง) ไม่เก็บโค้ดดิบ
// ─────────────────────────────────────────────────────────────
function generateRecoveryCodes_() {
  var plain = [], hashed = [];
  for (var i = 0; i < AUTH_RECOVERY_COUNT; i++) {
    var code = Utilities.getUuid().replace(/-/g, "").slice(0, 10).toUpperCase();
    plain.push(code);
    hashed.push(hashPassword_(code, "recovery"));
  }
  return { plain: plain, hashedJson: JSON.stringify(hashed) };
}

// ตรวจ recovery code — ถ้าตรงให้ลบออกจากรายการทันที (ใช้ได้ครั้งเดียว)
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
// 23.8 Login — เรียกจากหน้า login โดยตรง (ฟังก์ชันนี้ไม่ต้องมี token)
// ─────────────────────────────────────────────────────────────
function authLogin(username, password, otpCode) {
  try {
    var user = findUserByUsername_(username);

    // ★ ตอบข้อความเดียวกันทั้งกรณีไม่มี user และรหัสผิด
    //   กันคนเดาว่า username ไหนมีอยู่จริงในระบบ (user enumeration)
    var genericFail = { success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };

    if (!user) return genericFail;
    if (user.Status !== "Active") return { success: false, message: "บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ" };

    // เช็กว่าถูกล็อกอยู่หรือไม่
    if (user.Locked_Until) {
      var lockedUntil = new Date(user.Locked_Until);
      if (!isNaN(lockedUntil.getTime()) && lockedUntil > new Date()) {
        var mins = Math.ceil((lockedUntil - new Date()) / 60000);
        return { success: false, message: "บัญชีถูกล็อกชั่วคราว กรุณารออีก " + mins + " นาที" };
      }
    }

    // ตรวจรหัสผ่าน
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

    // ★ ผ่านรหัสผ่านแล้ว — ถ้าเปิด TOTP ไว้ ต้องตรวจ OTP ต่อ
    if (user.Totp_Enabled) {
      if (!otpCode) {
        // บอก frontend ว่าต้องขอ OTP ต่อ (ยังไม่ให้ token)
        return { success: false, needOtp: true, message: "กรุณากรอกรหัส 6 หลักจากแอป Authenticator" };
      }
      var secret = decryptSecret_(user.Totp_Secret_Enc);
      var otpOk = verifyTotp_(secret, otpCode);

      // ถ้า OTP ไม่ผ่าน ลองเช็กว่าเป็น recovery code หรือไม่
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

    // สำเร็จ — ล้างตัวนับ แล้วสร้าง session
    updateUserFields_(user.docId, {
      Failed_Attempts : 0,
      Locked_Until    : "",
      Last_Login      : new Date().toISOString()
    });

    var sess = createSession_(user);
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

// ให้ frontend เช็กว่า session ยังใช้ได้อยู่ไหม (ใช้ตอนโหลดหน้า)
function authCheckSession(token) {
  var s = getSession_(token);
  return s ? { success: true, profile: s } : { success: false };
}

// ─────────────────────────────────────────────────────────────
// 23.9 ★★ API Gateway — ประตูเดียวที่ frontend เรียก backend ได้ ★★
//
//   ทำไมต้องรวมเป็นจุดเดียว:
//   - ถ้ากระจาย guard ไป 31 ฟังก์ชัน พลาดจุดเดียว = รูรั่วทั้งระบบ
//   - รวมจุดเดียว = ตรวจง่าย แก้ง่าย และรับประกันว่าไม่มีทางลืม
//
//   ★ สำคัญ: ความปลอดภัยอยู่ที่นี่เท่านั้น การซ่อนปุ่มใน UI เป็นแค่ความสะดวก
//     เพราะผู้ใช้เรียก google.script.run จาก console ได้โดยตรง
// ─────────────────────────────────────────────────────────────

// สิทธิ์ขั้นต่ำที่ต้องมีของแต่ละฟังก์ชัน
//   viewer < staff < admin  (สิทธิ์สูงกว่าทำของต่ำกว่าได้หมด)
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

  // ── เพิ่ม/แก้ไข: staff ขึ้นไป ──
  saveBrand                : "staff",
  saveCategory             : "staff",
  saveVendor               : "staff",
  saveCustomer             : "staff",
  saveZone                 : "staff",
  saveCar                  : "staff",
  saveProduct              : "staff",
  savePurchaseOrder        : "staff",
  saveTaxInvoice           : "staff",
  receiveGoods             : "staff",
  updatePurchaseOrderStatus: "staff",

  // ── ลบข้อมูล + งานระบบ: admin เท่านั้น ──
  deleteBrand              : "admin",
  deleteCategory           : "admin",
  deleteVendor             : "admin",
  deleteCustomer           : "admin",
  deleteZone               : "admin",
  deleteCar                : "admin",
  deleteProduct            : "admin",
  deletePurchaseOrder      : "admin",
  deleteTaxInvoice         : "admin",
  backupNow                : "admin",
  listBackupFiles          : "admin",
  getActivityLog           : "admin",

  // ── จัดการบัญชีตัวเอง: viewer ขึ้นไป (ทุกคนจัดการบัญชีตัวเองได้)
  //   ปลอดภัยเพราะฟังก์ชันเหล่านี้ดึง session.username จาก token เอง ไม่รับ username จาก args
  //   ผู้ใช้จึงทำได้แค่กับบัญชีตัวเองเท่านั้น ต่อให้ปลอมแปลง args ก็แก้บัญชีคนอื่นไม่ได้
  authGetMyProfile         : "viewer",
  authChangePassword       : "viewer",
  authLogout               : "viewer",
  authStartTotpSetup       : "viewer",
  authConfirmTotpSetup     : "viewer",
  authDisableTotp          : "viewer"
};

var ROLE_RANK = { viewer: 1, staff: 2, admin: 3 };

// ★ saveMasterData เดิมถูกเรียกตรงจาก frontend (Brands/Categories) ซึ่งอันตราย
//   เพราะเขียนลง collection ไหนก็ได้ — จำกัดเฉพาะ collection ที่อนุญาตเท่านั้น
var SAVE_MASTER_ALLOWED = ["Master_Brands", "Master_Categories"];

// ─────────────────────────────────────────────────────────────
// 23.9b ★ Activity Log — บันทึกเฉพาะรายการที่ "เปลี่ยนข้อมูล" (แบบเบา)
//   ไม่บันทึกฟังก์ชันอ่านอย่างเดียว (get*) เพราะรกและกิน quota เปล่าๆ
//   เก็บแค่ ใคร-ทำอะไร-เมื่อไหร่-กับ record ไหน ไม่เก็บค่าเก่า/ใหม่เต็ม (ประหยัด write+storage)
// ─────────────────────────────────────────────────────────────
var ACTIVITY_LOG_COLLECTION = "Activity_Log";
var ACTIVITY_LOG_KEEP_MONTHS = 6;   // ลบอัตโนมัติหลัง 6 เดือน (ตั้งได้ผ่าน cleanupOldActivityLogs)

// ระบุ action + ป้ายชื่อไทยของแต่ละฟังก์ชันที่เปลี่ยนข้อมูล (ใช้ตอนแสดงผลในหน้า log)
var ACTIVITY_ACTIONS = {
  saveBrand                 : { action: "save",   label: "บันทึกแบรนด์" },
  saveCategory               : { action: "save",   label: "บันทึกหมวดหมู่" },
  saveVendor                 : { action: "save",   label: "บันทึกผู้จัดจำหน่าย" },
  saveCustomer                : { action: "save",   label: "บันทึกลูกค้า" },
  saveZone                    : { action: "save",   label: "บันทึกโซนจัดเก็บ" },
  saveCar                     : { action: "save",   label: "บันทึกข้อมูลรถ" },
  saveProduct                 : { action: "save",   label: "บันทึกสินค้า" },
  savePurchaseOrder           : { action: "save",   label: "บันทึกใบสั่งซื้อ" },
  saveTaxInvoice               : { action: "save",   label: "บันทึกใบกำกับภาษี" },
  saveMasterData               : { action: "save",   label: "บันทึกข้อมูล" },
  receiveGoods                 : { action: "update", label: "รับสินค้าเข้าสต็อก" },
  updatePurchaseOrderStatus    : { action: "update", label: "เปลี่ยนสถานะใบสั่งซื้อ" },
  deleteBrand                  : { action: "delete", label: "ลบแบรนด์" },
  deleteCategory                : { action: "delete", label: "ลบหมวดหมู่" },
  deleteVendor                  : { action: "delete", label: "ลบผู้จัดจำหน่าย" },
  deleteCustomer                 : { action: "delete", label: "ลบลูกค้า" },
  deleteZone                     : { action: "delete", label: "ลบโซนจัดเก็บ" },
  deleteCar                      : { action: "delete", label: "ลบข้อมูลรถ" },
  deleteProduct                   : { action: "delete", label: "ลบสินค้า" },
  deletePurchaseOrder              : { action: "delete", label: "ลบใบสั่งซื้อ" },
  deleteTaxInvoice                  : { action: "delete", label: "ลบใบกำกับภาษี" }
};

// เดา docId จาก args/ผลลัพธ์ เพื่อบันทึกไว้ในล็อก (เท่าที่พอทำได้แบบเบาๆ ไม่ต้องแก้ฟังก์ชันเดิม)
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
    if (!meta) return;   // ไม่ใช่ action ที่ต้องบันทึก (เช่นฟังก์ชันอ่าน) → ข้าม

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
    // ★ การบันทึก log ต้องไม่ทำให้ธุรกรรมจริงล้มเหลว — พลาดแค่ log เงียบๆ พอ
    console.error("logActivity_ error:", e);
  }
}

function apiGateway(token, fnName, args) {
  try {
    var session = getSession_(token);
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

    // จำกัด saveMasterData ให้เขียนได้เฉพาะ collection ที่กำหนด
    if (fnName === "saveMasterData" && SAVE_MASTER_ALLOWED.indexOf(a[0]) === -1) {
      return { success: false, message: "ไม่อนุญาตให้บันทึกข้อมูลลงชุดข้อมูลนี้" };
    }

    var fn = this[fnName];
    if (typeof fn !== "function") {
      // fallback สำหรับสภาพแวดล้อมที่ this ไม่ผูกกับ global scope
      fn = eval(fnName);
    }
    var result = fn.apply(null, a);

    // ★ บันทึก log หลังทำรายการเสร็จ (ทั้งสำเร็จและล้มเหลว) — ทำหลังสุดกันกระทบ transaction จริง
    logActivity_(session.username, fnName, a, result);

    return result;

  } catch (e) {
    console.error("apiGateway error [" + fnName + "]:", e);
    return { success: false, message: "เกิดข้อผิดพลาด: " + e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// 23.9c ★ ดู/ล้าง Activity Log — เฉพาะ admin
// ─────────────────────────────────────────────────────────────

// ดึง log ล่าสุด (จำกัดจำนวนกันดึงมากเกินไปทีเดียว) — เรียกผ่าน apiGateway เท่านั้น (ดูรายชื่อ API_REGISTRY ด้านล่าง)
function getActivityLog(limitCount) {
  var list = [];
  try {
    var fetched = fetchAllPagesRaw(ACTIVITY_LOG_COLLECTION);
    if (!fetched.ok) return list;
    fetched.docs.forEach(function (doc) {
      var f = doc.fields || {};
      list.push({
        id        : doc.id,
        username  : parseFirestoreValue(f.Username)  || "",
        action    : parseFirestoreValue(f.Action)    || "",
        label     : parseFirestoreValue(f.Label)      || "",
        docId     : parseFirestoreValue(f.DocId)      || "",
        success   : String(parseFirestoreValue(f.Success) || "") === "true",
        timestamp : parseFirestoreValue(f.Timestamp)  || ""
      });
    });
    list.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    var n = limitCount || 200;
    if (list.length > n) list = list.slice(0, n);
  } catch (e) {
    console.error("getActivityLog error:", e);
  }
  return list;
}

// ★ ลบ log ที่เก่ากว่า ACTIVITY_LOG_KEEP_MONTHS เดือน — เรียกจาก trigger รายวัน/รายสัปดาห์
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

// ★ ตั้งเวลาลบ log เก่าอัตโนมัติทุกวัน — รันฟังก์ชันนี้ "ครั้งเดียว" ผ่าน Apps Script Editor
function setupActivityLogCleanupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === "cleanupOldActivityLogs") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("cleanupOldActivityLogs").timeBased().everyDays(1).atHour(3).create();
  return "ตั้งเวลาลบ Activity Log เก่ากว่า " + ACTIVITY_LOG_KEEP_MONTHS + " เดือนทุกวันเวลา 03:00 น. เรียบร้อยแล้ว";
}

// ─────────────────────────────────────────────────────────────
// 23.10 สร้างผู้ใช้ admin คนแรก
//   ★ รันฟังก์ชันนี้ "ครั้งเดียว" ผ่าน Apps Script Editor (เมนู Run)
//     แล้วดู Log เพื่อเอารหัสผ่านชั่วคราวไปเข้าระบบ จากนั้นเปลี่ยนรหัสทันที
// ─────────────────────────────────────────────────────────────
// ★ รันฟังก์ชันนี้ "ครั้งเดียว" ผ่าน Apps Script Editor — ต้องแก้ค่า ADMIN_EMAIL ด้านล่างเป็นอีเมลจริงก่อนรัน
//   (ทุก user รวม admin ต้องผูกอีเมลจริงไว้ใช้ตอนลืมรหัสผ่าน — ไม่มีอีเมล = reset password ไม่ได้)
function setupFirstAdmin() {
  var ADMIN_EMAIL = "เปลี่ยนเป็นอีเมลจริงตรงนี้@example.com";   // ★ แก้บรรทัดนี้ก่อนรัน

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
    Last_Login      : ""
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

// ─────────────────────────────────────────────────────────────
// 23.11 จัดการบัญชีตัวเอง — เปลี่ยนรหัสผ่าน / เปิด-ปิด TOTP
//   ★ ฟังก์ชันกลุ่มนี้รับ token โดยตรง (ไม่ผ่าน apiGateway) เพราะทำงานกับ
//     "บัญชีของผู้เรียกเอง" เท่านั้น ไม่ต้องเช็ค role — แต่ต้องเช็ค session ทุกตัว
// ─────────────────────────────────────────────────────────────

// เปลี่ยนรหัสผ่านของตัวเอง (ต้องยืนยันรหัสเดิมก่อน)
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

  var newSalt = makeSalt_();
  var ok = updateUserFields_(user.docId, {
    Password_Hash : hashPassword_(newPassword, newSalt),
    Salt          : newSalt
  });

  return ok ? { success: true, message: "เปลี่ยนรหัสผ่านสำเร็จ" }
            : { success: false, message: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
}

// ขั้นที่ 1 ของการเปิด TOTP: สร้าง secret ใหม่ (ยังไม่เปิดใช้จนกว่าจะยืนยันด้วย OTP)
//   คืน secret แบบข้อความ + URI สำหรับสร้าง QR ให้สแกน
function authStartTotpSetup(token) {
  var session = getSession_(token);
  if (!session) return { success: false, message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" };

  var secret = generateTotpSecret_();
  // เก็บ secret ที่ "ยังไม่ยืนยัน" ไว้ใน cache ชั่วคราว 10 นาที
  // ★ ยังไม่เขียนลง Firestore จนกว่าผู้ใช้จะพิสูจน์ว่าสแกนสำเร็จจริง
  //   กันกรณีตั้งค่าค้างครึ่งทางแล้วล็อกตัวเองออกจากระบบ
  CacheService.getScriptCache().put("totpsetup_" + token, secret, 600);

  var label  = encodeURIComponent("SYY Shop:" + session.username);
  var issuer = encodeURIComponent("SYY Shop Control");
  var uri = "otpauth://totp/" + label + "?secret=" + secret + "&issuer=" + issuer + "&algorithm=SHA1&digits=6&period=30";

  return { success: true, secret: secret, otpauthUri: uri };
}

// ขั้นที่ 2: ยืนยันด้วย OTP จากแอป → เปิดใช้งานจริง + คืน recovery codes
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

  // ★ คืน recovery codes แบบข้อความ "ครั้งเดียวเท่านั้น" — ในระบบเก็บแค่ hash
  //   ถ้าผู้ใช้ไม่จดไว้ตอนนี้ จะไม่มีทางดูย้อนหลังได้อีก
  return {
    success       : true,
    recoveryCodes : recovery.plain,
    message       : "เปิดใช้งานยืนยันตัวตน 2 ชั้นสำเร็จ"
  };
}

// ปิด TOTP (ต้องยืนยันรหัสผ่านก่อน กันคนอื่นมาปิดตอนลุกจากเครื่อง)
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

// ดูสถานะบัญชีตัวเอง (ใช้แสดงในหน้าโปรไฟล์)
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

// ─────────────────────────────────────────────────────────────
// 23.12 ★ ลืมรหัสผ่าน — ส่งลิงก์ reset ทางอีเมล (ใช้กับทุก user รวม admin)
//
//   Flow: กรอกอีเมล → สร้าง token สุ่มเก็บใน CacheService (30 นาที) → ส่งลิงก์ผ่าน MailApp
//         → ผู้ใช้กดลิงก์ → ตั้งรหัสใหม่ → token ถูกลบทันที (ใช้ได้ครั้งเดียว)
//
//   ★ ไม่บอกผลต่างกันระหว่าง "อีเมลนี้ไม่มีในระบบ" กับ "ส่งสำเร็จ" — กัน user enumeration
//     (คนร้ายเดาไม่ได้ว่าอีเมลไหนมีบัญชีอยู่จริงในระบบ)
//   ★ MailApp มีโควตาส่งเมลรายวันของ Gmail ฟรี (~100 ฉบับ/วัน) — เพียงพอสำหรับร้านขนาดนี้
//     เพราะ reset password ไม่ใช่การกระทำที่เกิดบ่อย
// ─────────────────────────────────────────────────────────────
var RESET_TOKEN_MINUTES = 30;

function authForgotPassword(email) {
  // ★ ข้อความตอบเดียวกันทุกกรณี (ไม่ว่าจะเจอ email จริงหรือไม่) กัน enumeration
  var genericMsg = "หากอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้แล้ว กรุณาตรวจสอบกล่องจดหมาย";

  try {
    var clean = String(email || "").trim().toLowerCase();
    if (!clean || clean.indexOf("@") === -1) {
      return { success: false, message: "กรุณากรอกอีเมลให้ถูกต้อง" };
    }

    var user = findUserByEmail_(clean);
    if (!user || user.Status !== "Active") {
      // ★ ไม่มี user จริง หรือบัญชีถูกปิด — ยังคงตอบข้อความเดียวกัน ไม่ส่งอะไรจริง
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
    // ★ แม้ MailApp ล้มเหลว (เช่นโควตาหมด) ก็ยังตอบข้อความเดียวกัน ไม่เผยสาเหตุจริงออกไป
    return { success: true, message: genericMsg };
  }
}

// ตรวจว่า reset token ยังใช้ได้อยู่ไหม (เรียกตอนหน้าเว็บโหลดฟอร์มตั้งรหัสใหม่)
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

// ตั้งรหัสผ่านใหม่ด้วย reset token — ใช้ได้ครั้งเดียว ลบ token ทันทีไม่ว่าผลจะเป็นอย่างไร
function authResetPassword(resetToken, newPassword) {
  try {
    var cacheKey = "pwreset_" + resetToken;
    var raw = CacheService.getScriptCache().get(cacheKey);
    if (!raw) return { success: false, message: "ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่" };

    // ★ ลบ token ทันทีก่อนดำเนินการต่อ กันคนกดลิงก์ซ้ำสองครั้งพร้อมกัน (race condition)
    CacheService.getScriptCache().remove(cacheKey);

    if (!newPassword || String(newPassword).length < 8) {
      return { success: false, message: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร" };
    }

    var data = JSON.parse(raw);
    var user = findUserByUsername_(data.username);
    if (!user) return { success: false, message: "ไม่พบบัญชีผู้ใช้" };

    var newSalt = makeSalt_();
    var ok = updateUserFields_(user.docId, {
      Password_Hash   : hashPassword_(newPassword, newSalt),
      Salt            : newSalt,
      Failed_Attempts : 0,
      Locked_Until    : ""   // ★ ตั้งรหัสใหม่สำเร็จ = ปลดล็อกบัญชีไปด้วยเลย เผื่อเคยถูกล็อกจากรหัสเดิม
    });

    return ok ? { success: true, message: "ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่" }
              : { success: false, message: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  } catch (e) {
    console.error("authResetPassword error:", e);
    return { success: false, message: "เกิดข้อผิดพลาดในระบบ" };
  }
}