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
    'profile'    : 'Profile',
    'manageusers': 'Manage_Users',
    'stockissue' : 'StockIssue'
  };

  var session = getSession_(token, userAgent);

  if (page === 'home' && !session) {
    var loginTemplate = HtmlService.createTemplateFromFile('Login');
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
  template.userRole  = session ? session.role : '';
  template.userName  = session ? (session.fullName || session.username) : '';
  template.resetMode  = mode;
  template.resetToken = rtoken;

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
// ==========================================
var CACHE_TTL_SECONDS     = 21600;
var CACHEABLE_COLLECTIONS = ["Master_Brands", "Master_Categories", "Master_Vendors", "Master_Zones", "Master_Cars"];

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

var CODE_VERSION = "2026-09-05-security-audit-fixes";
function getCodeVersion() { return CODE_VERSION; }

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
                            "Subdistrict", "District", "Province", "Postal_Code", "Invoice_Date"];

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
    Part_Type         : String(d.partType      || ""),
    Part_Number       : String(d.partNumber    || "").trim(),
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

  if (dataObject.Part_Type !== "แท้" && dataObject.Part_Type !== "เทียบ") {
    return { success: false, title: "ข้อมูลไม่ครบ", message: "กรุณาเลือกประเภทสินค้า (แท้ / เทียบ)" };
  }

  var docId = d.productCode || d.docId || null;

  if (dataObject.Part_Number) {
    var dupCheck = checkPartNumberDuplicate(dataObject.Part_Number, docId);
    if (dupCheck) return dupCheck;
  }

  return saveMasterData("Master_Products", "P", docId, dataObject, d.productName);
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

function getVendors() { return getFirestoreRawList("Master_Vendors"); }

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
function saveCustomer(d) {
  var taxId = String(d.taxId || "").replace(/\D/g, '');

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
    Address       : String(d.address || ""),
    Tax_ID        : taxId,
    Branch        : String(d.branch  || "").trim() || "สำนักงานใหญ่",
    Phone         : String(d.phone   || ""),
    Status        : String(d.status  || "Active")
  };
  return saveMasterData("Master_Customers", "C", d.docId || null, dataObject, d.customerName);
}

function getCustomers() { return getFirestoreRawList("Master_Customers"); }

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

  var lastErr = "";
  for (var attempt = 0; attempt < 10; attempt++) {
    var runningNum = getNextInvoiceRunningNumber(invoiceDate, d.docId || null) + attempt;
    dataObject.Invoice_No = buildInvoiceNoForMonth(invoiceDate, runningNum);

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
    availableYears : getTaxInvoiceAvailableYears()
  };
}

function deleteTaxInvoice(docId) { return deleteFirestoreDocument("Master_Tax_Invoice", docId); }

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

function getZones() { return getFirestoreRawList("Master_Zones"); }

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

function buildPurchaseOrderList(vendorMap) {
  var list = [];
  try {
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
      console.error("buildPurchaseOrderList: ดึงข้อมูลใบสั่งซื้อไม่สำเร็จ");
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
// ★ NEW: เพิ่ม userAgent parameter — ใช้ผูก session กับเบราว์เซอร์ที่ login ไว้
//   ลดความเสี่ยงจากการ copy token/URL ไปใช้บนเครื่องอื่น (ไม่ใช่การป้องกันที่สมบูรณ์ 100%
//   เพราะ User-Agent ปลอมแปลงได้ แต่เพิ่มด่านกั้นให้การขโมย session ทำได้ยากขึ้น)
function createSession_(user, userAgent) {
  var token = Utilities.getUuid() + "-" + Utilities.getUuid();
  var payload = {
    username  : user.Username,
    fullName  : user.Full_Name,
    role      : user.Role,
    issuedAt  : Date.now(),
    userAgent : String(userAgent || "")
  };
  CacheService.getScriptCache().put("sess_" + token, JSON.stringify(payload), AUTH_SESSION_HOURS * 3600);
  return { token: token, profile: payload };
}
// ★ NEW: เพิ่ม userAgent parameter (optional) — ถ้าส่งมาจะเช็คว่าตรงกับตอนสร้าง session หรือไม่
//   ถ้าไม่ตรง = ปฏิเสธทันที (คืน null เหมือนไม่มี session) กัน token ที่หลุดไปถูกใช้จากเบราว์เซอร์อื่น
function getSession_(token, userAgent) {
  if (!token) return null;
  try {
    var raw = CacheService.getScriptCache().get("sess_" + token);
    if (!raw) return null;
    var session = JSON.parse(raw);

    // ★ เช็ค User-Agent เฉพาะตอนที่ session มีการบันทึกไว้ (เผื่อ session เก่าก่อน deploy โค้ดนี้)
    //   และเฉพาะตอนที่ผู้เรียกส่ง userAgent มาเช็คด้วย (บาง caller ภายในระบบไม่มี userAgent ให้เช็ค)
    if (session.userAgent && userAgent !== undefined) {
      if (session.userAgent !== String(userAgent || "")) {
        console.error("getSession_: User-Agent ไม่ตรงกับตอน login — ปฏิเสธ session (token อาจถูกขโมยหรือนำไปใช้เครื่องอื่น)");
        return null;
      }
    }

    return session;
  } catch (e) {
    return null;
  }
}

function destroySession_(token) {
  if (token) CacheService.getScriptCache().remove("sess_" + token);
}

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

function authCheckSession(token) {
  var s = getSession_(token);
  return s ? { success: true, profile: s } : { success: false };
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

  // ── เพิ่ม/แก้ไข: staff ขึ้นไป ──
  saveBrand                : "staff",
  saveCategory             : "staff",
  saveVendor               : "staff",
  saveCustomer             : "staff",
  saveZone                 : "staff",
  saveCar                  : "staff",
  saveProduct              : "staff",
  // ★ FIX: saveMasterData ไม่เคยอยู่ใน registry นี้เลย — apiGateway ปฏิเสธทุกครั้งที่เรียก
  //   (Master_Brands.html และ Master_Categories.html เรียกฟังก์ชันนี้ตรงๆ ไม่ผ่าน saveBrand/saveCategory)
  //   ทำให้กดบันทึกแบรนด์/หมวดหมู่ไม่ได้เลยถ้าไม่แก้ตรงนี้ — SAVE_MASTER_ALLOWED ด้านล่างเป็นด่านกันอยู่แล้วว่าเขียนได้แค่ 2 collection นี้
  saveMasterData           : "staff",
  savePurchaseOrder        : "staff",
  receiveGoods             : "staff",
  updatePurchaseOrderStatus: "staff",
  issueStock               : "staff",
  getStockMovements        : "viewer",

  // ── ใบกำกับภาษี — viewer ทำได้ (ข้อยกเว้นเฉพาะ) ──
  saveTaxInvoice           : "viewer",
  deleteTaxInvoice         : "viewer",

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
  savePurchaseOrder           : { action: "save",   label: "บันทึกใบสั่งซื้อ" },
  saveTaxInvoice               : { action: "save",   label: "บันทึกใบกำกับภาษี" },
  saveMasterData               : { action: "save",   label: "บันทึกข้อมูล" },
  receiveGoods                 : { action: "update", label: "รับสินค้าเข้าสต็อก" },
  updatePurchaseOrderStatus    : { action: "update", label: "เปลี่ยนสถานะใบสั่งซื้อ" },
  issueStock                   : { action: "update", label: "ตัดสต๊อกสินค้า" },
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
    // (issueStock/receiveGoods ก็ใช้ช่องทางเดียวกันนี้ เพื่อบันทึก User จริงลง Stock_Movements)
    if (fnName === "resetUserPassword" || fnName === "toggleUserStatus" || fnName === "updateUserAccount" ||
        fnName === "issueStock" || fnName === "receiveGoods") {
      a = a.slice();
      a.push(session.username);
    }

    var fn = this[fnName];
    if (typeof fn !== "function") {
      fn = eval(fnName);
    }
    var result = fn.apply(null, a);

    logActivity_(session.username, fnName, a, result);

    return result;

  } catch (e) {
    console.error("apiGateway error [" + fnName + "]:", e);
    return { success: false, message: "เกิดข้อผิดพลาด: " + e.message };
  }
}

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
    var fetched = fetchAllPagesRaw(AUTH_USERS_COLLECTION);
    if (!fetched.ok) return list;
    fetched.docs.forEach(function (doc) {
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
function testActivityLog() {
  var res = UrlFetchApp.fetch(
    "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/Activity_Log",
    {
      method: "post",
      headers: getAuthHeader(),
      payload: JSON.stringify({
        fields: mapToFirestoreFields({
          Username: "test",
          Action: "save",
          Function: "test",
          Label: "ทดสอบ",
          DocId: "",
          Success: "true",
          Timestamp: new Date().toISOString()
        })
      }),
      muteHttpExceptions: true
    }
  );
  Logger.log("Status: " + res.getResponseCode());
  Logger.log("Body: " + res.getContentText());
}



/* ═══════════════════════════════════════════════════════════════════
   ส่วนเสริม "ตัดสต๊อก" (Stock Issue) — จาก UI Audit and Redesign
   ใช้ helper เดิมด้านบน: getAuthHeader, PROJECT_ID, parseFirestoreValue, fetchAllPagesRaw, logActivity_
   ═══════════════════════════════════════════════════════════════════ */

var STOCK_MOVEMENT_COLLECTION = "Stock_Movements";

// เหตุผลที่อนุญาต — ถ้าส่งค่าอื่นมาจะถูกปฏิเสธ (กันข้อมูลเพี้ยนจาก client)
var ISSUE_REASONS = ["ขายหน้าร้าน", "เบิกใช้ในร้าน", "ตัวอย่าง/เคลม", "ชำรุด-เสียหาย", "ปรับยอดตรวจนับ"];

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

/**
 * อ่านสต๊อกปัจจุบันของสินค้าเฉพาะรายการที่ต้องใช้ (batchGet — ไม่ต้องอ่านทั้ง collection)
 * คืน map: productCode -> { name, stock, minStock, costPrice }
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
      name      : parseFirestoreValue(f.Product_Name) || id,
      stock     : parseFloat(parseFirestoreValue(f.Current_Stock)) || 0,
      minStock  : parseFloat(parseFirestoreValue(f.Min_Stock))     || 0,
      costPrice : parseFloat(parseFirestoreValue(f.Cost_Price))    || 0
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
    var merged = {};
    items.forEach(function (it) {
      var code = String(it.productCode);
      if (!merged[code]) merged[code] = { productCode: code, productName: it.productName || "", qty: 0, unitPrice: parseFloat(it.unitPrice || 0) };
      merged[code].qty += parseFloat(it.qty || 0);
    });
    var lines = Object.keys(merged).map(function (k) { return merged[k]; });

    var stockMap = getProductStockMap_(lines.map(function (l) { return l.productCode; }));

    var notFound     = [];
    var insufficient = [];
    lines.forEach(function (l) {
      var info = stockMap[l.productCode];
      if (!info) { notFound.push(l.productCode); return; }
      l.before    = info.stock;
      l.after     = info.stock - l.qty;
      l.minStock  = info.minStock;
      l.costPrice = info.costPrice;
      if (!l.productName) l.productName = info.name;
      if (l.after < 0) insufficient.push({ productCode: l.productCode, productName: l.productName, stock: info.stock, need: l.qty });
    });

    if (notFound.length)     return fail("ไม่พบสินค้ารหัส: " + notFound.join(", "));
    if (insufficient.length && !d.allowNegative) {
      return fail("จำนวนที่ตัดเกินสต๊อกคงเหลือ: " + insufficient.map(function (x) {
        return x.productName + " (คงเหลือ " + x.stock + " ต้องการ " + x.need + ")";
      }).join(", "), { insufficient: insufficient });
    }

    var user   = callerUsername || getCurrentUsername_();
    var nowIso = new Date().toISOString();
    var docNo  = "SI" + Utilities.formatDate(new Date(), "Asia/Bangkok", "yyMMdd-HHmmss");

    var writes = [];
    lines.forEach(function (l, i) {
      // 1) ลดสต๊อก
      writes.push({
        transform: {
          document: fsDocPath_("Master_Products", l.productCode),
          fieldTransforms: [{ fieldPath: "Current_Stock", increment: { doubleValue: -l.qty } }]
        }
      });
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

    var commit = fsCommit_(writes);
    if (!commit.ok) return { success: false, title: "ล้มเหลว", message: "บันทึกไม่สำเร็จ: " + commit.message };

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
  var docNo    = "SR" + Utilities.formatDate(new Date(), "Asia/Bangkok", "yyMMdd-HHmmss");

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
