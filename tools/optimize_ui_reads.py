from pathlib import Path
import re


def fail(msg):
    raise SystemExit(msg)


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        fail(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)


def replace_between(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    if start < 0:
        fail(f'{label}: start marker not found')
    end = text.find(end_marker, start)
    if end < 0:
        fail(f'{label}: end marker not found')
    return text[:start] + replacement + text[end:]


# ---------------------------------------------------------------------------
# Code.gs — cache/read efficiency, product image contract, dashboard delta,
#           atomic PO receiving and cache invalidation.
# ---------------------------------------------------------------------------
p = Path('Code.gs')
s = p.read_text(encoding='utf-8')

cache_start = 'var CACHE_TTL_SECONDS     = 21600;'
cache_end = '// ==========================================\n// 3. ระบบรันเลข ID อัตโนมัติ'
cache_block = r'''var CACHE_TTL_SECONDS = 21600;
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

function collectionCacheBaseKey_(collectionName) {
  return "docs_" + collectionName;
}

function splitCollectionCacheChunks_(docs) {
  var chunks = [], current = [];
  (docs || []).forEach(function(doc) {
    var candidate = current.concat([doc]);
    var json = JSON.stringify(candidate);
    var bytes = Utilities.newBlob(json).getBytes().length;
    if (current.length && bytes > CACHE_CHUNK_MAX_BYTES) {
      chunks.push(JSON.stringify(current));
      current = [doc];
    } else {
      current = candidate;
    }
  });
  if (current.length || !(docs || []).length) chunks.push(JSON.stringify(current));
  for (var i = 0; i < chunks.length; i++) {
    if (Utilities.newBlob(chunks[i]).getBytes().length > 95000) return null;
  }
  return chunks;
}

function readCollectionCache_(collectionName) {
  if (CACHEABLE_COLLECTIONS.indexOf(collectionName) === -1) return null;
  try {
    var cache = CacheService.getScriptCache();
    var base = collectionCacheBaseKey_(collectionName);
    var manifest = cache.get(base + "__manifest");
    if (manifest) {
      var count = parseInt(manifest, 10);
      if (count > 0 && count < 500) {
        var keys = [];
        for (var i = 0; i < count; i++) keys.push(base + "__" + i);
        var found = cache.getAll(keys), docs = [];
        for (var j = 0; j < keys.length; j++) {
          if (!found[keys[j]]) return null;
          docs = docs.concat(JSON.parse(found[keys[j]]));
        }
        return docs;
      }
    }
    // backward compatibility กับ cache key แบบเดิม
    var legacy = cache.get(base);
    return legacy ? JSON.parse(legacy) : null;
  } catch (e) {
    console.error("readCollectionCache_ error (ข้ามได้):", e);
    return null;
  }
}

function writeCollectionCache_(collectionName, docs) {
  if (CACHEABLE_COLLECTIONS.indexOf(collectionName) === -1) return;
  try {
    var chunks = splitCollectionCacheChunks_(docs || []);
    if (!chunks) return;
    clearCollectionCache(collectionName);
    var cache = CacheService.getScriptCache();
    var base = collectionCacheBaseKey_(collectionName);
    var ttl = cacheTtlForCollection_(collectionName);
    var values = {};
    chunks.forEach(function(chunk, i) { values[base + "__" + i] = chunk; });
    cache.putAll(values, ttl);
    cache.put(base + "__manifest", String(chunks.length), ttl);
  } catch (e) {
    console.error("writeCollectionCache_ error (ข้ามได้):", e);
  }
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
      method: "post", headers: getAuthHeader(), payload: JSON.stringify(query), muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      (JSON.parse(res.getContentText()) || []).forEach(function(row) {
        if (row.document) docs.push({ id: row.document.name.split('/').pop(), fields: row.document.fields || {} });
      });
    } else {
      console.error("queryByEqualityField_ " + collectionName + "." + fieldPath + " HTTP " + res.getResponseCode());
    }
  } catch (e) {
    console.error("queryByEqualityField_ error:", e);
  }
  return docs;
}

function fetchAllPagesRaw(collectionName, firstPageJson) {
  var docs = [], pageToken = "", guard = 0, json = firstPageJson || null;
  try {
    do {
      if (!json) {
        var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
                + "/databases/(default)/documents/" + collectionName + "?pageSize=300"
                + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
        var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
        if (res.getResponseCode() !== 200) {
          console.error("fetchAllPagesRaw " + collectionName + " HTTP " + res.getResponseCode());
          return { ok: false, docs: [] };
        }
        json = JSON.parse(res.getContentText());
      }
      (json.documents || []).forEach(function(doc) {
        docs.push({ id: doc.name.split('/').pop(), fields: doc.fields || {} });
      });
      pageToken = json.nextPageToken || "";
      json = null;
      guard++;
    } while (pageToken && guard < 50);
  } catch (e) {
    console.error("fetchAllPagesRaw error:", e);
    return { ok: false, docs: [] };
  }
  return { ok: true, docs: docs };
}

function fetchCollectionsParallel(collectionNames) {
  var result = {}, toFetch = [], requests = [];
  collectionNames.forEach(function(name) {
    var cached = readCollectionCache_(name);
    if (cached !== null) { result[name] = cached; return; }
    toFetch.push(name);
    requests.push({
      url: "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
         + "/databases/(default)/documents/" + name + "?pageSize=300",
      method: "get", headers: getAuthHeader(), muteHttpExceptions: true
    });
  });
  if (!requests.length) return result;
  try {
    var responses = UrlFetchApp.fetchAll(requests);
    responses.forEach(function(res, i) {
      var name = toFetch[i];
      if (res.getResponseCode() !== 200) { result[name] = []; return; }
      var first = JSON.parse(res.getContentText());
      // ใช้ first page เดิมต่อทันที ไม่อ่าน 300 docs หน้าแรกซ้ำเมื่อมี pagination
      var fetched = fetchAllPagesRaw(name, first);
      var docs = fetched.ok ? fetched.docs : [];
      result[name] = docs;
      if (fetched.ok) writeCollectionCache_(name, docs);
    });
  } catch (e) {
    console.error("fetchCollectionsParallel error:", e);
    toFetch.forEach(function(name) { if (!result[name]) result[name] = []; });
  }
  return result;
}

function fetchCollectionDocsCached(collectionName) {
  var cached = readCollectionCache_(collectionName);
  if (cached !== null) return cached;
  var fetched = fetchAllPagesRaw(collectionName);
  if (fetched.ok) writeCollectionCache_(collectionName, fetched.docs);
  return fetched.docs;
}

function clearCollectionCache(collectionName) {
  if (CACHEABLE_COLLECTIONS.indexOf(collectionName) === -1) return;
  try {
    var cache = CacheService.getScriptCache();
    var base = collectionCacheBaseKey_(collectionName);
    var manifest = cache.get(base + "__manifest");
    var keys = [base, base + "__manifest"];
    var count = parseInt(manifest, 10) || 0;
    for (var i = 0; i < count && i < 500; i++) keys.push(base + "__" + i);
    cache.removeAll(keys);
  } catch (e) {
    console.error("clearCollectionCache error:", e);
  }
}

'''
s = replace_between(s, cache_start, cache_end, cache_block, 'cache block')

# Auto ID: keep the existing max-scan helper as a seed, then allocate from Script Properties.
auto_marker = '// ==========================================\n// 4. แปลงข้อมูล Firestore → JS'
auto_insert = r'''
function autoIdSequenceKey_(collectionName, prefix) {
  return "AUTO_ID_SEQ__" + String(collectionName).replace(/[^A-Za-z0-9_]/g, "_")
       + "__" + String(prefix).replace(/[^A-Za-z0-9_]/g, "_");
}

function allocateNextAutoId_(collectionName, prefix, forceReseed) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var key = autoIdSequenceKey_(collectionName, prefix);
    var current = forceReseed ? NaN : parseInt(props.getProperty(key), 10);
    if (isNaN(current)) {
      var seededNext = getNextAutoId(collectionName, prefix, true);
      var seededDigits = String(seededNext).substring(String(prefix).length);
      current = /^\d+$/.test(seededDigits) ? Math.max(0, parseInt(seededDigits, 10) - 1) : 0;
    }
    current++;
    props.setProperty(key, String(current));
    return prefix + String(current).padStart(4, '0');
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

'''
idx = s.find(auto_marker)
if idx < 0: fail('auto id marker missing')
if 'function allocateNextAutoId_' not in s:
    s = s[:idx] + auto_insert + s[idx:]

s = replace_once(s,
    'var newId  = getNextAutoId(collectionName, prefix, true);',
    'var newId  = allocateNextAutoId_(collectionName, prefix, false);',
    'saveMasterData auto id')
s = replace_once(s,
    'newId = bumpAutoId(newId, prefix);\n          continue;',
    'newId = allocateNextAutoId_(collectionName, prefix, attempt === 0);\n          continue;',
    'saveMasterData 409 reseed')

# Replace getAllProducts so products and image gallery are cached and correctly shaped.
products_start = 'function getAllProducts() {'
products_end = '// ==========================================\n// 11. ★ getProductById'
products_fn = r'''function getAllProducts() {
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
    var productDocs = fetchCollectionDocsCached("Master_Products");

    productDocs.forEach(function(doc) {
      var id = doc.id, f = doc.fields || {};
      var brandId  = parseFirestoreValue(f.Brand_ID)         || "";
      var catId    = parseFirestoreValue(f.Category_ID)      || "";
      var vendorId = parseFirestoreValue(f.Default_Vendor_ID)|| "";
      var zoneId   = parseFirestoreValue(f.Zone_ID)          || "";
      var carIds = parseFirestoreValue(f.Car_IDs);
      if (!carIds || (Array.isArray(carIds) && carIds.length === 0)) {
        var legacyCarId = parseFirestoreValue(f.Car_ID);
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
        productName  : parseFirestoreValue(f.Product_Name) || "",
        partType     : parseFirestoreValue(f.Part_Type)    || "",
        partNumber   : String(parseFirestoreValue(f.Part_Number) || ""),
        barcode      : String(parseFirestoreValue(f.Barcode) || ""),
        barcodeGenerated : parseFirestoreValue(f.Barcode_Generated) === "true",
        imageUrl     : imageState.primary || imageUrls[primaryIndex] || imageUrls[0] || "",
        imageUrls    : imageUrls,
        primaryImageIndex: primaryIndex,
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
        costPrice    : parseFloat(parseFirestoreValue(f.Cost_Price) || 0),
        sellingPrice : parseFloat(parseFirestoreValue(f.Selling_Price) || 0),
        currentStock : parseFloat(parseFirestoreValue(f.Current_Stock) || 0),
        minStock     : parseFloat(parseFirestoreValue(f.Min_Stock) || 0),
        status       : parseFirestoreValue(f.Status) || "Active"
      });
    });
  } catch (e) {
    console.error("getAllProducts error:", e);
  }
  return products;
}

'''
s = replace_between(s, products_start, products_end, products_fn, 'getAllProducts')

# getProductById returns full gallery too.
s = replace_once(s,
    "var carModelNames = carIds.map(function(cid) { return carMap[cid] || cid; }).filter(Boolean);\n\n      return {",
    "var carModelNames = carIds.map(function(cid) { return carMap[cid] || cid; }).filter(Boolean);\n      var imgState = getProductImageDocData_(productCode);\n\n      return {",
    'getProductById image state')
s = replace_once(s,
    'imageUrl     : getProductImageUrlSingle_(productCode),',
    'imageUrl     : imgState.urls[imgState.primaryIndex] || imgState.urls[0] || "",\n        imageUrls    : imgState.urls.slice(0, 3),\n        primaryImageIndex: imgState.primaryIndex,',
    'getProductById image fields')

# Product name duplicate uses targeted query + cache-only case-insensitive fallback.
existing_line = '  var existingFields = docId ? getProductRawFields_(docId) : null;\n'
name_guard = r'''  var existingFields = docId ? getProductRawFields_(docId) : null;

  var cleanProductName = String(dataObject.Product_Name || "").trim();
  if (cleanProductName) {
    var dupName = queryByEqualityField_("Master_Products", "Product_Name", cleanProductName)
      .some(function(doc) { return doc.id !== docId; });
    if (!dupName) {
      var cachedProductDocs = peekCollectionDocsCache_("Master_Products");
      if (cachedProductDocs) {
        var lowerName = cleanProductName.toLowerCase();
        dupName = cachedProductDocs.some(function(doc) {
          if (doc.id === docId) return false;
          return String(parseFirestoreValue((doc.fields || {}).Product_Name) || "").trim().toLowerCase() === lowerName;
        });
      }
    }
    if (dupName) return { success:false, title:"ข้อมูลซ้ำ!", message:'ชื่อสินค้า "' + cleanProductName + '" มีอยู่ในระบบแล้ว' };
  }
'''
s = replace_once(s, existing_line, name_guard, 'saveProduct name duplicate')
s = replace_once(s,
    'return saveMasterData("Master_Products", "P", docId, dataObject, d.productName);',
    'return saveMasterData("Master_Products", "P", docId, dataObject, null);',
    'saveProduct bypass generic name scan')

# Duplicate helpers no longer scan all Master_Products.
dup_start = 'function checkPartNumberDuplicate(partNumber, excludeDocId) {'
dup_end = 'function deleteProduct(docId) {'
dup_block = r'''function checkPartNumberDuplicate(partNumber, excludeDocId) {
  var value = String(partNumber || "").trim();
  if (!value) return null;
  var duplicate = queryByEqualityField_("Master_Products", "Part_Number", value)
    .some(function(doc) { return doc.id !== excludeDocId; });
  if (!duplicate) {
    var cached = peekCollectionDocsCache_("Master_Products");
    if (cached) {
      var lower = value.toLowerCase();
      duplicate = cached.some(function(doc) {
        return doc.id !== excludeDocId && String(parseFirestoreValue((doc.fields || {}).Part_Number) || "").trim().toLowerCase() === lower;
      });
    }
  }
  return duplicate ? { success:false, title:"ข้อมูลซ้ำ!", message:'รหัสจากผู้ผลิต (Part Number) "' + value + '" มีอยู่ในระบบแล้ว' } : null;
}

function checkBarcodeDuplicate(barcode, excludeDocId) {
  var value = String(barcode || "").trim();
  if (!value) return null;
  var duplicate = queryByEqualityField_("Master_Products", "Barcode", value)
    .some(function(doc) { return doc.id !== excludeDocId; });
  return duplicate ? { success:false, title:"ข้อมูลซ้ำ!", message:'บาร์โค้ด "' + value + '" มีอยู่ในระบบแล้ว' } : null;
}

'''
s = replace_between(s, dup_start, dup_end, dup_block, 'product duplicate helpers')

# Barcode mutation must invalidate product cache.
barcode_old = '    if (res.getResponseCode() !== 200) {\n      return { success: false, message: "บันทึกบาร์โค้ดไม่สำเร็จ: " + res.getContentText() };\n    }\n\n    return { success: true, message: "สร้างบาร์โค้ดสำเร็จ", barcode: barcode, generated: true };'
barcode_new = '    if (res.getResponseCode() !== 200) {\n      return { success: false, message: "บันทึกบาร์โค้ดไม่สำเร็จ: " + res.getContentText() };\n    }\n    clearCollectionCache("Master_Products");\n\n    return { success: true, message: "สร้างบาร์โค้ดสำเร็จ", barcode: barcode, generated: true };'
s = replace_once(s, barcode_old, barcode_new, 'barcode cache invalidation')

# Increment helper cache invalidation.
inc_start = s.find('function incrementProductStockBatch(')
inc_end = s.find('function receiveGoods(', inc_start)
if inc_start < 0 or inc_end < 0: fail('incrementProductStockBatch markers')
inc = s[inc_start:inc_end]
inc = replace_once(inc, 'if (res.getResponseCode() === 200) return true;', 'if (res.getResponseCode() === 200) { clearCollectionCache("Master_Products"); return true; }', 'increment cache')
s = s[:inc_start] + inc + s[inc_end:]

# Atomic receiveGoods: inventory increments + movements + PO receipt/status in one commit.
recv_start = 'function receiveGoods(d, callerUsername) {'
recv_end = 'function deletePurchaseOrder(docId) {'
recv_fn = r'''function receiveGoods(d, callerUsername) {
  function fail(msg) { return { success: false, title: "ข้อมูลไม่ครบ", message: msg }; }
  try {
    d = d || {};
    if (!d.poId) return fail("ไม่พบเลขที่ใบสั่งซื้อ");
    if (!String(d.invoiceNo || "").trim()) return fail("กรุณากรอกเลขที่ Invoice");
    if (!String(d.receiptDate || "").trim()) return fail("กรุณาระบุวันที่รับสินค้า");
    if (!String(d.receiverName || "").trim()) return fail("กรุณากรอกชื่อผู้รับสินค้า");
    var reqItems = Array.isArray(d.items) ? d.items : [];
    if (!reqItems.length) return fail("ไม่มีรายการสินค้าที่จะรับ");

    var user = callerUsername || getCurrentUsername_();
    var nowIso = new Date().toISOString();
    var docNo = "SR" + Utilities.formatDate(new Date(), "Asia/Bangkok", "yyMMdd-HHmmss")
              + "-" + Utilities.getUuid().replace(/-/g, "").slice(0, 4).toUpperCase();
    var poUrl = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
              + "/databases/(default)/documents/Purchase_Orders/" + d.poId;
    var MAX_ATTEMPTS = 3;

    for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      var res = UrlFetchApp.fetch(poUrl, { method:"get", headers:getAuthHeader(), muteHttpExceptions:true });
      if (res.getResponseCode() !== 200) return fail("ไม่พบใบสั่งซื้อนี้");
      var poDoc = JSON.parse(res.getContentText());
      var f = poDoc.fields || {};
      var currentStatus = parseFirestoreValue(f.Status) || "Pending";
      if (currentStatus === "Received") return fail("ใบสั่งซื้อนี้ได้รับสินค้าครบแล้ว ไม่สามารถบันทึกรับซ้ำได้");
      if (currentStatus === "Cancelled") return fail("ใบสั่งซื้อนี้ถูกยกเลิกแล้ว ไม่สามารถรับสินค้าได้");

      var poItems = [];
      try { poItems = JSON.parse(parseFirestoreValue(f.Items_JSON) || "[]"); } catch (e) { poItems = []; }
      var receiveMap = {};
      reqItems.forEach(function(it) { receiveMap[it.productCode] = parseFloat(it.qtyReceivedNow || 0); });
      var allComplete = true, receiptLineItems = [], stockAdditions = [];
      poItems = poItems.map(function(it) {
        var already = parseFloat(it.receivedQty || 0), ordered = parseFloat(it.qty || 0);
        var remaining = Math.max(ordered - already, 0);
        var receiveNow = receiveMap.hasOwnProperty(it.productCode) ? receiveMap[it.productCode] : 0;
        if (receiveNow < 0) receiveNow = 0;
        if (receiveNow > remaining) receiveNow = remaining;
        var newReceived = already + receiveNow;
        if (newReceived < ordered) allComplete = false;
        if (receiveNow > 0) {
          receiptLineItems.push({ productCode:it.productCode, productName:it.productName, qtyReceivedNow:receiveNow });
          stockAdditions.push({ productCode:it.productCode, productName:it.productName, qty:receiveNow });
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
        if (!stockMap[stockAdditions[si].productCode]) return fail("ไม่พบสินค้า " + stockAdditions[si].productCode + " ใน Master Product");
      }

      var receipts = [];
      try { receipts = JSON.parse(parseFirestoreValue(f.Receipts_JSON) || "[]"); } catch (e2) { receipts = []; }
      receipts.push({
        date:d.receiptDate, invoiceNo:d.invoiceNo, receiverName:d.receiverName,
        deliveryNoteNo:allComplete ? "" : String(d.deliveryNoteNo || ""),
        isFinal:allComplete, items:receiptLineItems
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

      var commit = fsCommit_(writes);
      if (commit.ok) {
        clearCollectionCache("Master_Products");
        return {
          success:true, title:"สำเร็จ",
          message:allComplete ? "บันทึกรับสินค้าครบถ้วน และอัปเดตสต็อกเรียบร้อย" : "บันทึกรับสินค้าบางส่วน และอัปเดตสต็อกเรียบร้อย",
          status:newStatus
        };
      }
      if (!isPreconditionFailure_(commit.message) || attempt === MAX_ATTEMPTS) {
        return { success:false, title:"ล้มเหลว", message:"บันทึกรับสินค้าไม่สำเร็จ: " + commit.message };
      }
      Utilities.sleep(120 * attempt);
    }
    return { success:false, title:"ล้มเหลว", message:"ข้อมูลมีการเปลี่ยนแปลงพร้อมกัน กรุณาลองใหม่" };
  } catch (e) {
    return { success:false, title:"ข้อผิดพลาด", message:e.message };
  }
}

'''
s = replace_between(s, recv_start, recv_end, recv_fn, 'receiveGoods atomic')

# issueStock/logStockIn invalidate cached products after successful stock writes.
issue_start = s.find('function issueStock(')
issue_end = s.find('/**\n * ★ เพิ่มสต๊อกแบบมีประวัติ', issue_start)
if issue_start < 0 or issue_end < 0: fail('issueStock markers')
issue = s[issue_start:issue_end]
issue = replace_once(issue, '    return {\n      success : true,', '    clearCollectionCache("Master_Products");\n    return {\n      success : true,', 'issueStock cache')
s = s[:issue_start] + issue + s[issue_end:]

log_start = s.find('function logStockIn_(')
log_end = s.find('/**\n * ★ ดึงประวัติเข้า-ออก', log_start)
if log_start < 0 or log_end < 0: fail('logStockIn markers')
log = s[log_start:log_end]
log = replace_once(log, '  return fsCommit_(writes).ok;', '  var committed = fsCommit_(writes).ok;\n  if (committed) clearCollectionCache("Master_Products");\n  return committed;', 'logStockIn cache')
s = s[:log_start] + log + s[log_end:]

# Direct bounded dashboard + delta refresh. This replaces the old lifetime bootstrap path.
dash_start = '/**\n * ★ ข้อมูลตั้งต้นของ Dashboard สต๊อก'
dash_end = '/**\n * ชื่อผู้ใช้สำรอง'
dash_block = r'''var DASHBOARD_YEARS_BACK = 4;

function dashboardRangeStart_() {
  var now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - DASHBOARD_YEARS_BACK, 0, 1, 0, 0, 0)).toISOString();
}

function mapDashboardMovementRow_(row) {
  if (!row || !row.document) return null;
  var f = row.document.fields || {}, ts = parseFirestoreValue(f.Timestamp);
  if (!ts) return null;
  return {
    id          : row.document.name.split('/').pop(),
    docNo       : parseFirestoreValue(f.Doc_No) || "",
    type        : parseFirestoreValue(f.Type) || "OUT",
    productCode : parseFirestoreValue(f.Product_Code) || "",
    productName : parseFirestoreValue(f.Product_Name) || "",
    qty         : parseFloat(parseFirestoreValue(f.Qty)) || 0,
    stockAfter  : parseFloat(parseFirestoreValue(f.Stock_After)) || 0,
    unitPrice   : parseFloat(parseFirestoreValue(f.Unit_Price)) || 0,
    costPrice   : parseFloat(parseFirestoreValue(f.Cost_Price)) || 0,
    reason      : parseFirestoreValue(f.Reason) || "",
    refNo       : parseFirestoreValue(f.Ref_No) || "",
    note        : parseFirestoreValue(f.Note) || "",
    user        : parseFirestoreValue(f.User) || "",
    timestamp   : ts
  };
}

function queryDashboardMovementsRange_(fromIso, toIso, exclusiveStart) {
  var out = [];
  try {
    var filters = [];
    if (fromIso) filters.push({ fieldFilter:{ field:{fieldPath:"Timestamp"}, op:exclusiveStart ? "GREATER_THAN" : "GREATER_THAN_OR_EQUAL", value:{stringValue:fromIso} } });
    if (toIso) filters.push({ fieldFilter:{ field:{fieldPath:"Timestamp"}, op:"LESS_THAN_OR_EQUAL", value:{stringValue:toIso} } });
    var q = {
      from:[{collectionId:STOCK_MOVEMENT_COLLECTION}],
      orderBy:[{field:{fieldPath:"Timestamp"}, direction:"DESCENDING"}]
    };
    if (filters.length === 1) q.where = filters[0];
    else if (filters.length > 1) q.where = { compositeFilter:{op:"AND", filters:filters} };
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents:runQuery";
    var res = UrlFetchApp.fetch(url, {method:"post", headers:getAuthHeader(), payload:JSON.stringify({structuredQuery:q}), muteHttpExceptions:true});
    if (res.getResponseCode() !== 200) {
      console.error("queryDashboardMovementsRange_ HTTP " + res.getResponseCode() + ": " + res.getContentText());
      return out;
    }
    (JSON.parse(res.getContentText()) || []).forEach(function(row) {
      var m = mapDashboardMovementRow_(row); if (m) out.push(m);
    });
  } catch (e) { console.error("queryDashboardMovementsRange_ error:", e); }
  return out;
}

function buildPoVendorMapForMovements_(movements) {
  var refs = [], seen = {};
  (movements || []).forEach(function(m) {
    if (m.type !== "IN" || !m.refNo || seen[m.refNo]) return;
    seen[m.refNo] = true; refs.push(String(m.refNo));
  });
  if (!refs.length) return {};
  var vendorMap = buildVendorMap(), out = {};
  var endpoint = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents:batchGet";
  for (var i = 0; i < refs.length; i += 100) {
    var batch = refs.slice(i, i + 100);
    var res = UrlFetchApp.fetch(endpoint, {
      method:"post", headers:getAuthHeader(), muteHttpExceptions:true,
      payload:JSON.stringify({documents:batch.map(function(id){ return fsDocPath_("Purchase_Orders", id); })})
    });
    if (res.getResponseCode() !== 200) continue;
    (JSON.parse(res.getContentText()) || []).forEach(function(row) {
      if (!row.found) return;
      var id = row.found.name.split('/').pop(), f = row.found.fields || {};
      var vendorId = parseFirestoreValue(f.Vendor_ID) || "", v = vendorMap[vendorId] || {};
      out[id] = v.Vendor_name || vendorId;
    });
  }
  return out;
}

function getDashboardBootstrap() {
  var serverTime = new Date().toISOString();
  var rangeStart = dashboardRangeStart_();
  var movements = queryDashboardMovementsRange_(rangeStart, serverTime, false);
  return {
    products:getAllProducts(), movements:movements,
    poVendorMap:buildPoVendorMapForMovements_(movements),
    bounded:true, rangeStart:rangeStart, serverTime:serverTime
  };
}

function getDashboardDelta(sinceIso) {
  var since = String(sinceIso || "").trim();
  if (!since || isNaN(new Date(since).getTime())) return { success:false, fullRefresh:true, message:"sync watermark ไม่ถูกต้อง" };
  var serverTime = new Date().toISOString();
  var movements = queryDashboardMovementsRange_(since, serverTime, true);
  var codes = [], seen = {};
  movements.forEach(function(m) { if (m.productCode && !seen[m.productCode]) { seen[m.productCode]=true; codes.push(m.productCode); } });
  var stocks = getProductStockMap_(codes), productStocks = [];
  Object.keys(stocks).forEach(function(code) {
    var x = stocks[code];
    productStocks.push({productCode:code,currentStock:x.stock,minStock:x.minStock,costPrice:x.costPrice,sellingPrice:x.sellingPrice});
  });
  return {
    success:true, movements:movements, productStocks:productStocks,
    poVendorMap:buildPoVendorMapForMovements_(movements), serverTime:serverTime
  };
}

'''
s = replace_between(s, dash_start, dash_end, dash_block, 'dashboard bounded/delta')

s = replace_once(s, '  getDashboardBootstrap    : "viewer",', '  getDashboardBootstrap    : "viewer",\n  getDashboardDelta        : "viewer",', 'dashboard delta registry')
s = replace_once(s, '  getDashboardBootstrap     : getDashboardBootstrap,', '  getDashboardBootstrap     : getDashboardBootstrap,\n  getDashboardDelta         : getDashboardDelta,', 'dashboard delta runner')

p.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------------------
# Master_Products.html — gallery regressions.
# ---------------------------------------------------------------------------
p = Path('Master_Products.html')
s = p.read_text(encoding='utf-8')
s = replace_once(s,
    'updateImageSectionForEdit(editingDocId, item.imageUrl);',
    'updateImageSectionForEdit(editingDocId, item.imageUrl, item.imageUrls, item.primaryImageIndex);',
    'edit modal gallery')
s = replace_once(s,
    "var c=productsCache.find(function(p){return p.id===editingDocId;});",
    "var c=productsCache.find(function(p){return (p.id||p.productCode)===editingDocId;});",
    'product image cache key')
p.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------------------
# Shared.html — searchable select: one global listener, incremental observer,
# fixed-position popup, render cap, programmatic-value sync, modal refresh.
# ---------------------------------------------------------------------------
p = Path('Shared.html')
s = p.read_text(encoding='utf-8')
old_open = '''function openModal(id){\n  var el=document.getElementById(id);\n  if(!el) return;\n  el.classList.add('active');\n  var first=el.querySelector('.form-control:not([disabled]),.input:not([disabled])');\n  if(first) setTimeout(function(){first.focus();},60);\n}'''
new_open = '''function openModal(id){\n  var el=document.getElementById(id);\n  if(!el) return;\n  el.classList.add('active');\n  if(window.SYYSelect) SYYSelect.refresh(el);\n  var first=el.querySelector('input:not([type="hidden"]):not([disabled]),textarea:not([disabled]),.syy-select-control:not([disabled])');\n  if(first) setTimeout(function(){first.focus();},60);\n}'''
s = replace_once(s, old_open, new_open, 'openModal searchable select refresh')
sel_start = '/* ── SYY Searchable Select'
sel_end = '/* ── Skeleton / Empty state ── */'
sel_block = r'''/* ── SYY Searchable Select ────────────────────────────────────────────────
   Progressive enhancement for native <select>. Search is 100% client-side. */
var SYYSelect=(function(){
  var registry=new WeakMap(),active=null,RENDER_LIMIT=200;
  function norm(v){return String(v==null?'':v).toLocaleLowerCase('th-TH').normalize('NFKC').trim();}
  function position(inst){
    if(!inst||!inst.wrap.classList.contains('open'))return;
    var r=inst.control.getBoundingClientRect(),p=inst.panel,margin=8;
    var width=Math.max(r.width,220),maxWidth=window.innerWidth-margin*2;
    width=Math.min(width,maxWidth);
    var left=Math.min(Math.max(margin,r.left),window.innerWidth-width-margin);
    var below=window.innerHeight-r.bottom-margin,above=r.top-margin;
    p.style.left=Math.round(left)+'px';p.style.width=Math.round(width)+'px';p.style.right='auto';
    if(below>=180||below>=above){p.style.top=Math.round(r.bottom+4)+'px';p.style.bottom='auto';p.style.maxHeight=Math.max(150,Math.min(360,below))+'px';}
    else{p.style.top='auto';p.style.bottom=Math.round(window.innerHeight-r.top+4)+'px';p.style.maxHeight=Math.max(150,Math.min(360,above))+'px';}
  }
  function close(inst){inst=inst||active;if(!inst)return;inst.wrap.classList.remove('open');inst.control.setAttribute('aria-expanded','false');if(active===inst)active=null;}
  function enhance(sel){
    if(!sel||registry.has(sel)||sel.multiple||sel.dataset.syyNoSearch==='true')return;
    var wrap=document.createElement('div');wrap.className='syy-select';
    if(sel.closest('.form-group,.form-grid'))wrap.classList.add('syy-select-block');
    if(sel.closest('.toolbar,.pagination-bar,.pill-row,.page-head')||sel.classList.contains('page-size-select')||sel.classList.contains('dash-picksel'))wrap.classList.add('syy-select-compact');
    var control=document.createElement('button');control.type='button';control.className='syy-select-control';control.setAttribute('aria-haspopup','listbox');control.setAttribute('aria-expanded','false');
    var label=document.createElement('span');label.className='syy-select-label';var caret=document.createElement('span');caret.className='syy-select-caret';caret.textContent='⌄';control.appendChild(label);control.appendChild(caret);
    var panel=document.createElement('div');panel.className='syy-select-panel';
    var search=document.createElement('input');search.type='search';search.className='syy-select-search';search.placeholder='ค้นหา...';search.autocomplete='off';
    var list=document.createElement('div');list.className='syy-select-list';list.setAttribute('role','listbox');
    var meta=document.createElement('div');meta.className='syy-select-meta';panel.appendChild(search);panel.appendChild(list);panel.appendChild(meta);
    sel.parentNode.insertBefore(wrap,sel);wrap.appendChild(sel);wrap.appendChild(control);wrap.appendChild(panel);sel.classList.add('syy-select-native');
    var inst={sel:sel,wrap:wrap,control:control,label:label,panel:panel,search:search,list:list,meta:meta};
    function sync(){var o=sel.options[sel.selectedIndex];label.textContent=o?o.text:'เลือก...';control.disabled=sel.disabled;}
    function render(q){
      var nq=norm(q),matches=[];Array.from(sel.options).forEach(function(o,i){if(o.disabled&&!o.value)return;if(nq&&norm(o.text).indexOf(nq)<0&&norm(o.value).indexOf(nq)<0)return;matches.push({o:o,i:i});});
      var frag=document.createDocumentFragment();matches.slice(0,RENDER_LIMIT).forEach(function(x){var b=document.createElement('button');b.type='button';b.className='syy-select-option'+(x.o.selected?' selected':'');b.textContent=x.o.text;b.setAttribute('role','option');b.setAttribute('aria-selected',x.o.selected?'true':'false');b.onclick=function(){sel.selectedIndex=x.i;sel.dispatchEvent(new Event('change',{bubbles:true}));sync();close(inst);};frag.appendChild(b);});
      list.innerHTML='';if(!matches.length){var e=document.createElement('div');e.className='syy-select-empty';e.textContent='ไม่พบข้อมูล';list.appendChild(e);}else list.appendChild(frag);
      meta.textContent=matches.length>RENDER_LIMIT?'แสดง '+RENDER_LIMIT+' จาก '+matches.length+' รายการ · พิมพ์เพิ่มเพื่อกรอง':'ทั้งหมด '+matches.length+' รายการ';
    }
    function open(){if(control.disabled)return;if(active&&active!==inst)close(active);active=inst;sync();wrap.classList.add('open');control.setAttribute('aria-expanded','true');search.value='';render('');position(inst);setTimeout(function(){search.focus();},0);}
    control.onclick=function(){wrap.classList.contains('open')?close(inst):open();};
    control.onkeydown=function(e){if(e.key==='Enter'||e.key===' '||e.key==='ArrowDown'){e.preventDefault();open();}};
    search.oninput=function(){render(search.value);position(inst);};
    function keynav(e){var opts=Array.from(list.querySelectorAll('.syy-select-option')),idx=opts.indexOf(document.activeElement);if(e.key==='ArrowDown'){e.preventDefault();(opts[Math.min(idx+1,opts.length-1)]||opts[0])?.focus();}else if(e.key==='ArrowUp'){e.preventDefault();(opts[Math.max(idx-1,0)]||opts[opts.length-1])?.focus();}else if(e.key==='Escape'){e.preventDefault();close(inst);control.focus();}}
    search.onkeydown=keynav;list.onkeydown=keynav;
    new MutationObserver(function(){sync();if(wrap.classList.contains('open'))render(search.value);}).observe(sel,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
    sel.addEventListener('change',sync);registry.set(sel,inst);sync();
  }
  function init(root){root=root||document;if(root.matches&&root.matches('select'))enhance(root);if(root.querySelectorAll)root.querySelectorAll('select').forEach(enhance);}
  function refresh(root){init(root);if(root&&root.matches&&root.matches('select')){var one=registry.get(root);if(one){var o=root.options[root.selectedIndex];one.label.textContent=o?o.text:'เลือก...';}}if((root||document).querySelectorAll)(root||document).querySelectorAll('select').forEach(function(sel){var x=registry.get(sel);if(x){var o=sel.options[sel.selectedIndex];x.label.textContent=o?o.text:'เลือก...';x.control.disabled=sel.disabled;}});}
  function documentClick(e){if(active&&!active.wrap.contains(e.target))close(active);}
  function reposition(){if(active)position(active);}
  return {init:init,refresh:refresh,enhance:enhance,documentClick:documentClick,reposition:reposition};
})();
window.SYYSelect=SYYSelect;
document.addEventListener('click',SYYSelect.documentClick);
window.addEventListener('resize',SYYSelect.reposition,{passive:true});window.addEventListener('scroll',SYYSelect.reposition,true);
document.addEventListener('DOMContentLoaded',function(){
  SYYSelect.init(document);
  new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(n.nodeType===1)SYYSelect.init(n);});});}).observe(document.documentElement,{childList:true,subtree:true});
});

'''
s = replace_between(s, sel_start, sel_end, sel_block, 'SYYSelect block')
p.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------------------
# Styles.html — searchable select no longer breaks compact toolbars; fixed popup
# escapes scrollable modal bodies.
# ---------------------------------------------------------------------------
p = Path('Styles.html')
s = p.read_text(encoding='utf-8')
css_start = '/* ── Searchable select: dependency-free progressive enhancement ── */'
css_end = '.count{font-size:12.5px;color:var(--muted);font-weight:600;white-space:nowrap}'
css = r'''/* ── Searchable select: dependency-free progressive enhancement ── */
.syy-select{position:relative;display:inline-block;width:auto;min-width:160px;max-width:100%}
.syy-select.syy-select-block{display:block;width:100%;min-width:0}
.syy-select.syy-select-compact{width:auto;min-width:120px;flex:0 1 auto}
.syy-select-native{position:absolute!important;opacity:0!important;pointer-events:none!important;width:1px!important;height:1px!important;margin:0!important;padding:0!important}
.syy-select-control{width:100%;min-height:var(--hit);border:1px solid #cbd5e1;border-radius:var(--r-sm);background:#fff;color:var(--ink);padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;cursor:pointer;font:inherit}
.syy-select-control:focus,.syy-select.open .syy-select-control{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px rgba(0,80,136,.12)}
.syy-select-control:disabled{background:var(--line-soft);color:var(--muted);cursor:not-allowed}
.syy-select-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.syy-select-caret{color:var(--faint);flex:none}
.syy-select-panel{display:none;position:fixed;z-index:5000;background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:var(--shadow-lg);overflow:hidden;min-width:220px;max-width:calc(100vw - 16px)}
.syy-select.open .syy-select-panel{display:flex;flex-direction:column}
.syy-select-search{width:calc(100% - 16px);margin:8px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px;outline:none;font:inherit;flex:none}.syy-select-search:focus{border-color:var(--primary);box-shadow:0 0 0 2px rgba(0,80,136,.10)}
.syy-select-list{min-height:0;max-height:260px;overflow:auto;overscroll-behavior:contain;border-top:1px solid var(--line-soft);flex:1 1 auto}
.syy-select-option{display:block;width:100%;border:0;background:#fff;text-align:left;padding:8px 11px;color:var(--text);cursor:pointer;font:inherit}.syy-select-option:hover,.syy-select-option:focus{outline:none;background:var(--primary-soft);color:var(--primary)}.syy-select-option.selected{font-weight:600;background:#f8fbfe}.syy-select-empty{padding:13px;text-align:center;color:var(--faint);font-size:12px}
.syy-select-meta{padding:5px 9px;border-top:1px solid var(--line-soft);font-size:10.5px;color:var(--faint);background:var(--bg);flex:none}
@media(max-width:767px){.syy-select:not(.syy-select-block){min-width:110px}.syy-select-panel{min-width:min(280px,calc(100vw - 16px))}}
.product-image-frame{background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center}.product-image-frame img,.product-image-contain{width:100%;height:100%;object-fit:contain!important;object-position:center;background:#fff}.product-image-clickable{cursor:zoom-in}
'''
s = replace_between(s, css_start, css_end, css + css_end, 'searchable select css')
p.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------------------
# index.html — delta refresh after stock changes instead of full 5-year reload.
# ---------------------------------------------------------------------------
p = Path('index.html')
s = p.read_text(encoding='utf-8')
s = replace_once(s,
    'loaded:false, loading:false, lastLoad:0, products:[], movements:[], poVendorMap:{},',
    "loaded:false, loading:false, lastLoad:0, lastSync:'', products:[], movements:[], poVendorMap:{},",
    'dashboard sync state')
s = replace_once(s,
    'DASH.poVendorMap = data.poVendorMap||{};\n      allProducts = DASH.products;',
    "DASH.poVendorMap = data.poVendorMap||{};\n      DASH.lastSync = data.serverTime || (DASH.movements.length ? DASH.movements[0].timestamp : new Date().toISOString());\n      allProducts = DASH.products;",
    'dashboard watermark')
insert_after = '''  function refreshDashboardProductsOnly(){\n    callApi('getAllProducts', [], function(products){\n      DASH.products = products||[];\n      allProducts = DASH.products;\n      if(DASH.loaded){ dashBuildAggregates(); dashRenderAll(); }\n      dashUpdateSidebarBadges();\n    }, function(err){ console.error('refreshDashboardProductsOnly error:', JSON.stringify(err)); });\n  }\n'''
delta_fn = insert_after + r'''

  function dashRefreshDelta(){
    if(DASH.loading) return;
    if(!DASH.loaded || !DASH.lastSync){ dashLoad(); return; }
    DASH.loading=true;
    callApi('getDashboardDelta',[DASH.lastSync],function(data){
      DASH.loading=false;data=data||{};
      if(data.fullRefresh||data.success===false){dashLoad();return;}
      var seen={};
      DASH.movements.forEach(function(m){seen[m.id||[m.docNo,m.productCode,m.type,m.timestamp].join('|')]=true;});
      (data.movements||[]).forEach(function(m){
        var key=m.id||[m.docNo,m.productCode,m.type,m.timestamp].join('|');if(seen[key])return;seen[key]=true;m.ts=new Date(m.timestamp);DASH.movements.push(m);
      });
      var byCode={};DASH.products.forEach(function(p){byCode[p.productCode]=p;});
      (data.productStocks||[]).forEach(function(x){var p=byCode[x.productCode];if(!p)return;p.currentStock=num(x.currentStock);p.minStock=num(x.minStock);p.costPrice=num(x.costPrice);p.sellingPrice=num(x.sellingPrice);});
      Object.keys(data.poVendorMap||{}).forEach(function(k){DASH.poVendorMap[k]=data.poVendorMap[k];});
      DASH.lastSync=data.serverTime||DASH.lastSync;DASH.lastLoad=Date.now();allProducts=DASH.products;
      document.getElementById('lastUpdated').innerText='อัปเดต '+new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
      dashBuildAggregates();dashUpdateSidebarBadges();dashRenderAll();
    },function(err){DASH.loading=false;console.error('dashRefreshDelta error:',JSON.stringify(err));dashLoad();});
  }
'''
s = replace_once(s, insert_after, delta_fn, 'dashboard delta client')
s = replace_once(s,
    "else if(d.action==='REFRESH_STOCK_FULL'){ dashLoad(); }",
    "else if(d.action==='REFRESH_STOCK_FULL'){ dashRefreshDelta(); }",
    'stock refresh delta')
p.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------------------
# UiSystem: use normal apiGateway path. Remove special dashboard bypass.
# ---------------------------------------------------------------------------
p = Path('UiSystem.html')
s = p.read_text(encoding='utf-8')
s = s.replace("\n<?!= include('DashboardEnhancement'); ?>", '')
p.write_text(s, encoding='utf-8')

# Obsolete dashboard shim files are removed; functionality now lives in Code.gs.
for name in ['DashboardEnhancement.html','DashboardV2.gs']:
    q=Path(name)
    if q.exists(): q.unlink()

# ---------------------------------------------------------------------------
# Audit documentation.
# ---------------------------------------------------------------------------
p = Path('docs/CODE_AUDIT_TH.md')
s = p.read_text(encoding='utf-8')
append = r'''

## Phase 4 — UI Bug Fix + Read/Write Optimization

- แก้ Product Gallery contract: `getAllProducts()` ส่ง `imageUrl` เป็น string จริง พร้อม `imageUrls` และ `primaryImageIndex`; หน้า Edit โหลดรูป 1–3 ครบและ cache ฝั่ง client รองรับทั้ง `id`/`productCode`.
- `Master_Products` และ `Master_Customers` เข้าสู่ cache layer แบบ chunked; collection ใหญ่ไม่ผูกกับ CacheService key เดียว และทุก write สำคัญมี explicit invalidation.
- `fetchCollectionsParallel()` ใช้ first page ที่อ่านมาแล้วต่อ pagination จึงไม่อ่าน 300 records หน้าแรกซ้ำอีกครั้ง.
- การตรวจ Product Name / Part Number / Barcode ใช้ targeted equality query; การสร้าง Barcode ไม่ scan Master Products ทั้ง collection.
- Auto ID ใช้ Script Properties + Script Lock หลัง seed ครั้งแรก; ไม่ scan collection เพื่อหาเลขสูงสุดทุกครั้งที่สร้าง record ใหม่. Firestore create ยังเป็นด่าน uniqueness และจะ reseed เมื่อเกิด collision.
- Dashboard bootstrap อ่าน Stock Movements เฉพาะช่วงปีปัจจุบันย้อนหลัง 4 ปีตาม UI; PO vendor map batchGet เฉพาะ PO ที่อ้างจาก movements แทนการอ่านรายการ PO สูงสุด 1,000 เอกสารทุกครั้ง.
- หลังตัด/รับสต๊อก Parent shell ใช้ `getDashboardDelta()` เพื่ออ่านเฉพาะ movement ใหม่และสินค้าที่ได้รับผลกระทบ แทน bootstrap 5 ปีเต็มซ้ำ.
- `receiveGoods()` รวม stock increment + Stock Movement + PO receipt/status ใน Firestore commit เดียวพร้อม update-time precondition ป้องกันกรณี stock ถูกเพิ่มแล้วแต่ PO update ล้มเหลว.
- Searchable Select ใช้ global click listener เพียงชุดเดียว, observer เฉพาะ node ที่เพิ่ม, render สูงสุด 200 options ต่อรอบ, popup fixed ไม่ถูก modal scroll ตัด และ sync label เมื่อ code กำหนด `.value` โดยตรง.

### Remaining scale ceiling

Dashboard ยังต้องอ่าน raw movements ใน reporting horizon ตอน initial bootstrap. หากปริมาณจริงขึ้นถึงหลายแสน/ล้าน movements ภายใน 5 ปี ขั้นถัดไปควรใช้ daily/monthly aggregate documents และ backfill ที่ควบคุมได้; Phase นี้ยังไม่เปลี่ยน schema หรือ migrate ข้อมูลย้อนหลัง.
'''
if '## Phase 4 — UI Bug Fix + Read/Write Optimization' not in s:
    s += append
p.write_text(s, encoding='utf-8')

print('Optimization patches applied')
