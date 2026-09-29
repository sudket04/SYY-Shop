from pathlib import Path

p = Path('Code.gs')
s = p.read_text(encoding='utf-8')
start = s.find('function saveProductImageDoc_(')
end = s.find('// ==========================================\n// 2b. ★ Cache Layer', start)
if start < 0 or end < 0:
    raise SystemExit('Product image backend section not found')

new = r'''function normalizeProductImageData_(imageUrl, driveFileId, imageUrls, driveFileIds, primaryIndex) {
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

function saveProductImageDoc_(productCode, imageUrl, driveFileId, imageUrls, driveFileIds, primaryIndex) {
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
  var res = UrlFetchApp.fetch(url, {
    method: "patch",
    headers: getAuthHeader(),
    payload: JSON.stringify({ fields: mapToFirestoreFields(payload) }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('บันทึกข้อมูลรูปสินค้าไม่สำเร็จ (' + res.getResponseCode() + ')');
  }
  clearCollectionCache(PRODUCT_IMAGES_COLLECTION);
  return data;
}

function deleteProductImageDoc_(productCode) {
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
          + "/databases/(default)/documents/" + PRODUCT_IMAGES_COLLECTION + "/" + encodeURIComponent(productCode);
  UrlFetchApp.fetch(url, { method: "delete", headers: getAuthHeader(), muteHttpExceptions: true });
  clearCollectionCache(PRODUCT_IMAGES_COLLECTION);
}

// ★ อ่าน URL รูปของสินค้าทั้งหมดครั้งเดียวเป็น map ให้ getAllProducts() ใช้
// รองรับทั้ง schema เดิม (Image_Url) และ V2 gallery โดยไม่เพิ่ม N+1 reads
function getProductImageUrlMap_() {
  var map = {};
  try {
    var docs = fetchCollectionDocsCached(PRODUCT_IMAGES_COLLECTION);
    docs.forEach(function(doc) {
      var f = doc.fields || {};
      var data = normalizeProductImageData_(
        parseFirestoreValue(f.Image_Url),
        parseFirestoreValue(f.Drive_File_Id),
        parseFirestoreValue(f.Image_Urls),
        parseFirestoreValue(f.Drive_File_Ids),
        parseFirestoreValue(f.Primary_Index)
      );
      if (data.urls.length) {
        map[doc.id] = { primary: data.primaryUrl, urls: data.urls, primaryIndex: data.primaryIndex };
      }
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
      var f = (JSON.parse(res.getContentText()).fields || {});
      var data = normalizeProductImageData_(
        parseFirestoreValue(f.Image_Url),
        parseFirestoreValue(f.Drive_File_Id),
        parseFirestoreValue(f.Image_Urls),
        parseFirestoreValue(f.Drive_File_Ids),
        parseFirestoreValue(f.Primary_Index)
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
  try {
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
            + "/databases/(default)/documents/" + PRODUCT_IMAGES_COLLECTION + "/" + encodeURIComponent(productCode);
    var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { urls: [], ids: [], primaryIndex: 0 };
    var f = (JSON.parse(res.getContentText()).fields || {});
    var data = normalizeProductImageData_(
      parseFirestoreValue(f.Image_Url),
      parseFirestoreValue(f.Drive_File_Id),
      parseFirestoreValue(f.Image_Urls),
      parseFirestoreValue(f.Drive_File_Ids),
      parseFirestoreValue(f.Primary_Index)
    );
    return { urls: data.urls, ids: data.ids, primaryIndex: data.primaryIndex };
  } catch (e) {
    console.error("getProductImageDocData_ error:", e);
    return { urls: [], ids: [], primaryIndex: 0 };
  }
}

function uploadProductImage(productCode, base64Data, slot) {
  try {
    productCode = String(productCode || "").trim();
    if (!productCode) return { success: false, message: "ไม่พบรหัสสินค้า" };
    if (!base64Data) return { success: false, message: "ไม่พบข้อมูลรูปภาพ" };

    var bytes = Utilities.base64Decode(base64Data);
    if (bytes.length > 5 * 1024 * 1024) return { success: false, message: "ไฟล์รูปใหญ่เกินไป" };
    if (!(bytes.length > 3 && (bytes[0] & 255) === 255 && (bytes[1] & 255) === 216 && (bytes[2] & 255) === 255)) {
      return { success: false, message: "รูปหลังประมวลผลไม่ใช่ JPEG ที่ถูกต้อง" };
    }

    var cur = getProductImageDocData_(productCode);
    slot = Math.max(0, Math.min(parseInt(slot, 10) || 0, 2));
    // ห้ามสร้างช่องว่าง: ถ้ากดรูป 3 ทั้งที่มีแค่รูป 1 ให้เติมเป็นรูป 2 โดยอัตโนมัติ
    if (slot > cur.urls.length) slot = cur.urls.length;
    if (slot >= 3 && cur.urls.length >= 3) return { success: false, message: "เพิ่มรูปได้สูงสุด 3 รูป" };

    var folder = getProductImageFolder_();
    var oldFileId = cur.ids[slot] || '';
    var file = folder.createFile(Utilities.newBlob(bytes, "image/jpeg", productCode + "_" + (slot + 1) + ".jpg"));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var imageUrl = "https://lh3.googleusercontent.com/d/" + file.getId();

    // เขียน metadata ใหม่ให้สำเร็จก่อน แล้วค่อย trash ไฟล์เก่า ลดความเสี่ยงรูปหายหาก Firestore เขียนไม่สำเร็จ
    cur.urls[slot] = imageUrl;
    cur.ids[slot] = file.getId();
    if (cur.primaryIndex >= cur.urls.length) cur.primaryIndex = 0;
    var saved = saveProductImageDoc_(productCode, "", "", cur.urls, cur.ids, cur.primaryIndex);
    if (oldFileId && oldFileId !== file.getId()) {
      try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (e) { console.warn('trash old product image failed:', e); }
    }

    return {
      success: true,
      imageUrl: saved.primaryUrl,
      imageUrls: saved.urls,
      primaryIndex: saved.primaryIndex,
      slot: slot
    };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function deleteProductImage(productCode, slot) {
  try {
    productCode = String(productCode || "").trim();
    if (!productCode) return { success: false, message: "ไม่พบรหัสสินค้า" };
    var cur = getProductImageDocData_(productCode);

    if (slot === undefined || slot === null || slot === '') {
      cur.ids.forEach(function(id) { if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} } });
      deleteProductImageDoc_(productCode);
      return { success: true, imageUrl: '', imageUrls: [], primaryIndex: 0 };
    }

    slot = Math.max(0, Math.min(parseInt(slot, 10) || 0, 2));
    if (!cur.urls[slot]) return { success: false, message: "ไม่พบรูปที่ต้องการลบ" };
    var removeFileId = cur.ids[slot] || '';
    cur.urls.splice(slot, 1);
    cur.ids.splice(slot, 1);

    if (!cur.urls.length) {
      deleteProductImageDoc_(productCode);
      if (removeFileId) { try { DriveApp.getFileById(removeFileId).setTrashed(true); } catch (e) {} }
      return { success: true, imageUrl: '', imageUrls: [], primaryIndex: 0 };
    }

    if (cur.primaryIndex === slot) cur.primaryIndex = 0;
    else if (cur.primaryIndex > slot) cur.primaryIndex--;
    var saved = saveProductImageDoc_(productCode, "", "", cur.urls, cur.ids, cur.primaryIndex);
    if (removeFileId) { try { DriveApp.getFileById(removeFileId).setTrashed(true); } catch (e) {} }
    return { success: true, imageUrl: saved.primaryUrl, imageUrls: saved.urls, primaryIndex: saved.primaryIndex };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function setPrimaryProductImage(productCode, slot) {
  try {
    productCode = String(productCode || "").trim();
    if (!productCode) return { success: false, message: "ไม่พบรหัสสินค้า" };
    var cur = getProductImageDocData_(productCode);
    slot = Math.max(0, Math.min(parseInt(slot, 10) || 0, 2));
    if (!cur.urls[slot]) return { success: false, message: "ไม่พบรูป" };
    var saved = saveProductImageDoc_(productCode, "", "", cur.urls, cur.ids, slot);
    return { success: true, imageUrl: saved.primaryUrl, imageUrls: saved.urls, primaryIndex: saved.primaryIndex };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

'''

s = s[:start] + new + s[end:]
p.write_text(s, encoding='utf-8')
print('Hardened legacy/V2 product image compatibility')
