/*
 * SYY Shop Control — Product Images V2
 * - Up to 3 product images
 * - Keeps legacy Image_Url / Drive_File_Id as the primary image for backward compatibility
 * - Stores gallery metadata in Images_JSON inside Product_Images/{productCode}
 * - Mutations are private workers; browser access goes through apiGatewayV2
 */
var PRODUCT_IMAGE_V2_MAX = 3;
var PRODUCT_IMAGE_V2_CACHE_SECONDS = 300;

function productImageV2CacheKey_(productCode) {
  return "pimgv2_" + String(productCode || "").trim();
}

function normalizeProductImagesV2_(productCode, fields) {
  fields = fields || {};
  var images = [];
  var rawJson = parseFirestoreValue(fields.Images_JSON) || "";
  if (rawJson) {
    try {
      var parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) {
        parsed.forEach(function (it) {
          if (!it || !it.url) return;
          images.push({ url: String(it.url), fileId: String(it.fileId || "") });
        });
      }
    } catch (e) {
      console.error("normalizeProductImagesV2_ JSON error:", e);
    }
  }

  if (!images.length) {
    var legacyUrl = String(parseFirestoreValue(fields.Image_Url) || "");
    var legacyId  = String(parseFirestoreValue(fields.Drive_File_Id) || "");
    if (legacyUrl) images.push({ url: legacyUrl, fileId: legacyId });
  }

  images = images.slice(0, PRODUCT_IMAGE_V2_MAX);
  var primaryIndex = parseInt(parseFirestoreValue(fields.Primary_Index), 10);
  if (isNaN(primaryIndex) || primaryIndex < 0 || primaryIndex >= images.length) primaryIndex = images.length ? 0 : -1;

  return {
    productCode: String(productCode || ""),
    images: images,
    imageUrls: images.map(function (x) { return x.url; }),
    primaryIndex: primaryIndex,
    imageUrl: primaryIndex >= 0 && images[primaryIndex] ? images[primaryIndex].url : ""
  };
}

function readProductImagesV2_(productCode, bypassCache) {
  productCode = String(productCode || "").trim();
  if (!productCode) return { productCode: "", images: [], imageUrls: [], primaryIndex: -1, imageUrl: "" };

  var cache = CacheService.getScriptCache();
  var key = productImageV2CacheKey_(productCode);
  if (!bypassCache) {
    try {
      var cached = cache.get(key);
      if (cached) return JSON.parse(cached);
    } catch (e) {}
  }

  var state = { productCode: productCode, images: [], imageUrls: [], primaryIndex: -1, imageUrl: "" };
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + PRODUCT_IMAGES_COLLECTION + "/" + encodeURIComponent(productCode);
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      var doc = JSON.parse(res.getContentText());
      state = normalizeProductImagesV2_(productCode, doc.fields || {});
    } else if (res.getResponseCode() !== 404) {
      console.error("readProductImagesV2_ HTTP " + res.getResponseCode() + ": " + res.getContentText());
    }
  } catch (e) {
    console.error("readProductImagesV2_ error:", e);
  }

  try { cache.put(key, JSON.stringify(state), PRODUCT_IMAGE_V2_CACHE_SECONDS); } catch (e2) {}
  return state;
}

function saveProductImagesV2_(productCode, images, primaryIndex) {
  productCode = String(productCode || "").trim();
  images = (images || []).filter(function (it) { return it && it.url; }).slice(0, PRODUCT_IMAGE_V2_MAX);
  primaryIndex = parseInt(primaryIndex, 10);
  if (!images.length) primaryIndex = -1;
  else if (isNaN(primaryIndex) || primaryIndex < 0 || primaryIndex >= images.length) primaryIndex = 0;

  var primary = primaryIndex >= 0 ? images[primaryIndex] : null;
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
          + "/databases/(default)/documents/" + PRODUCT_IMAGES_COLLECTION + "/" + encodeURIComponent(productCode);

  if (!images.length) {
    var del = UrlFetchApp.fetch(url, { method: "delete", headers: getAuthHeader(), muteHttpExceptions: true });
    if (del.getResponseCode() !== 200 && del.getResponseCode() !== 204 && del.getResponseCode() !== 404) {
      throw new Error("ลบข้อมูลรูปจาก Firestore ไม่สำเร็จ: " + del.getContentText());
    }
  } else {
    var payload = {
      fields: mapToFirestoreFields({
        Images_JSON   : JSON.stringify(images),
        Primary_Index : primaryIndex,
        Image_Url     : primary ? primary.url : "",
        Drive_File_Id : primary ? primary.fileId : "",
        Updated_At    : new Date().toISOString()
      })
    };
    var res = UrlFetchApp.fetch(url, {
      method: "patch",
      headers: getAuthHeader(),
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) throw new Error("บันทึกข้อมูลรูปไม่สำเร็จ: " + res.getContentText());
  }

  try { CacheService.getScriptCache().remove(productImageV2CacheKey_(productCode)); } catch (e) {}
  clearCollectionCache(PRODUCT_IMAGES_COLLECTION);
  return normalizeProductImagesV2_(productCode, images.length ? mapToFirestoreFields({
    Images_JSON: JSON.stringify(images), Primary_Index: primaryIndex,
    Image_Url: primary ? primary.url : "", Drive_File_Id: primary ? primary.fileId : ""
  }) : {});
}

function getProductImagesV2_(productCode) {
  var state = readProductImagesV2_(productCode, false);
  return {
    success: true,
    productCode: state.productCode,
    imageUrls: state.imageUrls,
    primaryIndex: state.primaryIndex,
    imageUrl: state.imageUrl
  };
}

function trashDriveImageV2_(productCode, image, slotIndex) {
  if (image && image.fileId) {
    try { DriveApp.getFileById(image.fileId).setTrashed(true); return; } catch (e) {}
  }
  if (slotIndex === 0) {
    try {
      var folder = getProductImageFolder_();
      var legacy = folder.getFilesByName(String(productCode) + ".jpg");
      while (legacy.hasNext()) legacy.next().setTrashed(true);
    } catch (e2) {}
  }
}

function uploadProductImageV2_(productCode, base64Data, slotIndex) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, message: "ระบบกำลังบันทึกรูปสินค้าอื่นอยู่ กรุณาลองใหม่" };
  try {
    productCode = String(productCode || "").trim();
    if (!productCode) return { success: false, message: "ไม่พบรหัสสินค้า — กรุณาบันทึกสินค้าก่อน" };
    if (!base64Data) return { success: false, message: "ไม่พบข้อมูลรูปภาพ" };

    var bytes = Utilities.base64Decode(base64Data);
    if (!bytes || !bytes.length) return { success: false, message: "ไฟล์รูปภาพว่างหรือเสียหาย" };
    if (bytes.length > 5 * 1024 * 1024) return { success: false, message: "ไฟล์รูปใหญ่เกิน 5MB หลังย่อขนาด" };
    var b0 = bytes[0] & 255, b1 = bytes[1] & 255, b2 = bytes[2] & 255;
    if (!(b0 === 0xFF && b1 === 0xD8 && b2 === 0xFF)) {
      return { success: false, message: "รูปที่ส่งขึ้นระบบไม่ใช่ไฟล์ JPEG ที่ถูกต้อง" };
    }

    var state = readProductImagesV2_(productCode, true);
    var images = state.images.slice();
    var idx = parseInt(slotIndex, 10);
    if (isNaN(idx) || idx < 0) idx = images.length;
    if (idx > images.length) idx = images.length;
    if (idx >= PRODUCT_IMAGE_V2_MAX) return { success: false, message: "เพิ่มรูปได้สูงสุด " + PRODUCT_IMAGE_V2_MAX + " รูปต่อสินค้า" };

    var replacing = idx < images.length;
    if (!replacing && images.length >= PRODUCT_IMAGE_V2_MAX) {
      return { success: false, message: "เพิ่มรูปได้สูงสุด " + PRODUCT_IMAGE_V2_MAX + " รูปต่อสินค้า" };
    }

    if (replacing) trashDriveImageV2_(productCode, images[idx], idx);

    var fileName = productCode + "_" + (idx + 1) + "_" + Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyyMMddHHmmss") + ".jpg";
    var file = getProductImageFolder_().createFile(Utilities.newBlob(bytes, "image/jpeg", fileName));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var entry = { url: "https://lh3.googleusercontent.com/d/" + file.getId(), fileId: file.getId() };

    if (replacing) images[idx] = entry;
    else images.push(entry);

    var primaryIndex = state.primaryIndex;
    if (primaryIndex < 0) primaryIndex = 0;
    var saved = saveProductImagesV2_(productCode, images, primaryIndex);
    return {
      success: true,
      message: replacing ? "เปลี่ยนรูปสำเร็จ" : "อัปโหลดรูปสำเร็จ",
      imageUrls: saved.imageUrls,
      primaryIndex: saved.primaryIndex,
      imageUrl: saved.imageUrl
    };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function deleteProductImageV2_(productCode, slotIndex) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, message: "ระบบกำลังบันทึกรูปสินค้าอื่นอยู่ กรุณาลองใหม่" };
  try {
    productCode = String(productCode || "").trim();
    var state = readProductImagesV2_(productCode, true);
    var images = state.images.slice();
    var idx = parseInt(slotIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= images.length) return { success: false, message: "ไม่พบรูปที่ต้องการลบ" };

    trashDriveImageV2_(productCode, images[idx], idx);
    images.splice(idx, 1);

    var primaryIndex = state.primaryIndex;
    if (!images.length) primaryIndex = -1;
    else if (idx === primaryIndex) primaryIndex = 0;
    else if (idx < primaryIndex) primaryIndex--;

    var saved = saveProductImagesV2_(productCode, images, primaryIndex);
    return { success: true, message: "ลบรูปเรียบร้อย", imageUrls: saved.imageUrls, primaryIndex: saved.primaryIndex, imageUrl: saved.imageUrl };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function setPrimaryProductImageV2_(productCode, slotIndex) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, message: "ระบบกำลังบันทึกรูปสินค้าอื่นอยู่ กรุณาลองใหม่" };
  try {
    productCode = String(productCode || "").trim();
    var state = readProductImagesV2_(productCode, true);
    var idx = parseInt(slotIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= state.images.length) return { success: false, message: "ไม่พบรูปที่ต้องการตั้งเป็นรูปหลัก" };
    var saved = saveProductImagesV2_(productCode, state.images, idx);
    return { success: true, message: "ตั้งรูปหลักเรียบร้อย", imageUrls: saved.imageUrls, primaryIndex: saved.primaryIndex, imageUrl: saved.imageUrl };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function deleteAllProductImagesV2_(productCode) {
  var state = readProductImagesV2_(productCode, true);
  state.images.forEach(function (img, i) { trashDriveImageV2_(productCode, img, i); });
  return saveProductImagesV2_(productCode, [], -1);
}

function deleteProductWithImagesV2_(productCode) {
  productCode = String(productCode || "").trim();
  if (!productCode) return { success: false, message: "ไม่พบรหัสสินค้า" };
  var result = deleteProduct(productCode);
  if (!result || result.success === false) return result;
  try { deleteAllProductImagesV2_(productCode); } catch (e) { console.error("cleanup product images after delete:", e); }
  return result;
}

function logActivityV2_(username, fnName, args, result) {
  try {
    var meta = {
      uploadProductImageV2: { action: "update", label: "อัปโหลด/เปลี่ยนรูปสินค้า" },
      deleteProductImageV2: { action: "delete", label: "ลบรูปสินค้า" },
      setPrimaryProductImageV2: { action: "update", label: "ตั้งรูปสินค้าหลัก" },
      deleteProductWithImagesV2: { action: "delete", label: "ลบสินค้าและรูปสินค้า" }
    }[fnName];
    if (!meta) return;
    var docId = args && args.length ? String(args[0] || "") : "";
    var payload = { fields: mapToFirestoreFields({
      Username: username,
      Action: meta.action,
      Function: fnName,
      Label: meta.label,
      DocId: docId,
      Success: (!result || result.success !== false) ? "true" : "false",
      Timestamp: new Date().toISOString()
    }) };
    UrlFetchApp.fetch(
      "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/Activity_Log",
      { method: "post", headers: getAuthHeader(), payload: JSON.stringify(payload), muteHttpExceptions: true }
    );
  } catch (e) { console.error("logActivityV2_ error:", e); }
}

function apiGatewayV2(token, fnName, args, userAgent) {
  try {
    var session = getSession_(token, userAgent);
    if (!session) return { __authError: true, success: false, message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" };

    var registry = {
      getProductImagesV2: "viewer",
      uploadProductImageV2: "staff",
      deleteProductImageV2: "staff",
      setPrimaryProductImageV2: "staff",
      deleteProductWithImagesV2: "admin"
    };
    var functions = {
      getProductImagesV2: getProductImagesV2_,
      uploadProductImageV2: uploadProductImageV2_,
      deleteProductImageV2: deleteProductImageV2_,
      setPrimaryProductImageV2: setPrimaryProductImageV2_,
      deleteProductWithImagesV2: deleteProductWithImagesV2_
    };

    var required = registry[fnName];
    if (!required) return { success: false, message: "ไม่อนุญาตให้เรียกใช้งานฟังก์ชันนี้" };
    var rank = { viewer: 1, staff: 2, admin: 3 };
    if ((rank[session.role] || 0) < (rank[required] || 99)) return { success: false, message: "สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้" };

    var fn = functions[fnName];
    var result = fn.apply(null, args || []);
    logActivityV2_(session.username, fnName, args || [], result);
    return result;
  } catch (e) {
    console.error("apiGatewayV2 error [" + fnName + "]:", e);
    return { success: false, message: (typeof friendlyErrorMessage_ === "function" ? friendlyErrorMessage_(e) : e.message) };
  }
}
