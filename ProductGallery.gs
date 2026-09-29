// ==========================================
// SYY Shop Product Gallery v2
// Multiple product images, backward-compatible with Product_Images.
// ==========================================
var PRODUCT_GALLERY_COLLECTION = 'Product_Galleries';
var PRODUCT_GALLERY_MAX_IMAGES = 6;

function productGalleryAuth_(token, userAgent, writeRequired) {
  var session = getSession_(String(token || ''), String(userAgent || ''));
  if (!session) return { ok:false, message:'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };
  if (writeRequired && ['admin','staff'].indexOf(String(session.role || '').toLowerCase()) < 0) {
    return { ok:false, message:'ไม่มีสิทธิ์แก้ไขรูปสินค้า' };
  }
  return { ok:true, session:session };
}

function productGalleryWriteLock_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('มีผู้ใช้อื่นกำลังแก้ไขรูปสินค้า กรุณาลองใหม่อีกครั้ง');
  return lock;
}

function productGalleryDocUrl_(productCode) {
  return 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
    '/databases/(default)/documents/' + PRODUCT_GALLERY_COLLECTION + '/' + encodeURIComponent(productCode);
}

function productGalleryReadLegacy_(productCode) {
  try {
    var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
      '/databases/(default)/documents/' + PRODUCT_IMAGES_COLLECTION + '/' + encodeURIComponent(productCode);
    var res = UrlFetchApp.fetch(url, { method:'get', headers:getAuthHeader(), muteHttpExceptions:true });
    if (res.getResponseCode() !== 200) return null;
    var doc = JSON.parse(res.getContentText());
    var f = doc.fields || {};
    var imageUrl = parseFirestoreValue(f.Image_Url) || '';
    var fileId = parseFirestoreValue(f.Drive_File_Id) || '';
    if (!imageUrl) return null;
    return { id:'legacy', url:imageUrl, fileId:fileId, createdAt:'', legacy:true };
  } catch (e) {
    console.error('productGalleryReadLegacy_:', e);
    return null;
  }
}

function productGalleryRead_(productCode) {
  try {
    var res = UrlFetchApp.fetch(productGalleryDocUrl_(productCode), {
      method:'get', headers:getAuthHeader(), muteHttpExceptions:true
    });
    if (res.getResponseCode() === 200) {
      var doc = JSON.parse(res.getContentText());
      var raw = parseFirestoreValue((doc.fields || {}).Images_JSON) || '[]';
      try {
        var list = JSON.parse(raw);
        if (Array.isArray(list)) return list;
      } catch (ignore) {}
      return [];
    }
    if (res.getResponseCode() === 404) {
      var legacy = productGalleryReadLegacy_(productCode);
      return legacy ? [legacy] : [];
    }
  } catch (e) {
    console.error('productGalleryRead_:', e);
  }
  return [];
}

function productGallerySave_(productCode, images) {
  images = Array.isArray(images) ? images : [];
  var primary = images.length ? images[0] : null;
  var data = {
    Images_JSON       : JSON.stringify(images),
    Primary_Image_Url : primary ? primary.url : '',
    Image_Count       : images.length,
    UpdatedAt         : new Date().toISOString()
  };
  var res = UrlFetchApp.fetch(productGalleryDocUrl_(productCode), {
    method:'patch', headers:getAuthHeader(),
    payload:JSON.stringify({ fields:mapToFirestoreFields(data) }),
    muteHttpExceptions:true
  });
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('Firestore gallery HTTP ' + res.getResponseCode() + ': ' + res.getContentText());
  }
  if (primary) saveProductImageDoc_(productCode, primary.url, primary.fileId || '');
  else deleteProductImageDoc_(productCode);

  try {
    if (typeof p0InvalidateGalleryData_ === 'function') p0InvalidateGalleryData_();
    else {
      clearCollectionCache(PRODUCT_IMAGES_COLLECTION);
      if (typeof p0CacheRemove_ === 'function' && typeof P0_PRODUCT_CACHE_KEY !== 'undefined') p0CacheRemove_(P0_PRODUCT_CACHE_KEY);
    }
  } catch (e) {
    console.error('productGallerySave_ cache invalidation:', e);
  }
}

function productGalleryResult_(productCode, images, message) {
  var out = {
    success:true,
    message:message || 'สำเร็จ',
    images:images || [],
    imageUrl:(images && images.length) ? images[0].url : '',
    maxImages:PRODUCT_GALLERY_MAX_IMAGES
  };
  // Point-read only this product; do not scan Product_Images after one image change.
  try { out.product = getProductById(productCode); } catch (ignore) {}
  return out;
}

function getProductGallery(token, userAgent, productCode) {
  var auth = productGalleryAuth_(token, userAgent, false);
  if (!auth.ok) return { success:false, message:auth.message, images:[] };
  productCode = String(productCode || '').trim();
  if (!productCode) return { success:false, message:'ไม่พบรหัสสินค้า', images:[] };
  var images = productGalleryRead_(productCode);
  return { success:true, images:images, maxImages:PRODUCT_GALLERY_MAX_IMAGES };
}

function uploadProductGalleryImage(token, userAgent, productCode, base64Data) {
  var lock = null, createdFile = null;
  try {
    var auth = productGalleryAuth_(token, userAgent, true);
    if (!auth.ok) return { success:false, message:auth.message };
    productCode = String(productCode || '').trim();
    if (!productCode) return { success:false, message:'กรุณาบันทึกสินค้าก่อนอัปโหลดรูป' };
    if (!base64Data) return { success:false, message:'ไม่พบข้อมูลรูปภาพ' };
    var bytes = Utilities.base64Decode(base64Data);
    if (bytes.length > 5 * 1024 * 1024) return { success:false, message:'ไฟล์รูปใหญ่เกิน 5MB' };

    lock = productGalleryWriteLock_();
    // Re-read only after acquiring the lock so concurrent writers cannot lose updates.
    var images = productGalleryRead_(productCode);
    if (images.length >= PRODUCT_GALLERY_MAX_IMAGES) {
      return { success:false, message:'สินค้า 1 รายการอัปโหลดได้สูงสุด ' + PRODUCT_GALLERY_MAX_IMAGES + ' รูป' };
    }

    var now = new Date();
    var imageId = Utilities.getUuid();
    var fileName = productCode + '_' + now.getTime() + '_' + imageId.substring(0,8) + '.jpg';
    var folder = getProductImageFolder_();
    createdFile = folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', fileName));
    createdFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var imageUrl = 'https://lh3.googleusercontent.com/d/' + createdFile.getId();

    images.push({ id:imageId, url:imageUrl, fileId:createdFile.getId(), createdAt:now.toISOString(), legacy:false });
    productGallerySave_(productCode, images);
    return productGalleryResult_(productCode, images, 'เพิ่มรูปสินค้าแล้ว');
  } catch (e) {
    // If Drive creation succeeded but metadata did not, remove the orphan file.
    if (createdFile) { try { createdFile.setTrashed(true); } catch (ignore) {} }
    return { success:false, message:e.message };
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (ignore2) {} }
  }
}

function deleteProductGalleryImage(token, userAgent, productCode, imageId) {
  var lock = null;
  try {
    var auth = productGalleryAuth_(token, userAgent, true);
    if (!auth.ok) return { success:false, message:auth.message };
    productCode = String(productCode || '').trim();
    imageId = String(imageId || '').trim();
    lock = productGalleryWriteLock_();
    var images = productGalleryRead_(productCode);
    var target = null;
    images = images.filter(function(img){
      if (String(img.id) === imageId) { target = img; return false; }
      return true;
    });
    if (!target) return { success:false, message:'ไม่พบรูปที่ต้องการลบ' };

    // Commit gallery metadata/primary compatibility first. If it fails, the old image stays usable.
    productGallerySave_(productCode, images);
    if (target.fileId) {
      try { DriveApp.getFileById(target.fileId).setTrashed(true); }
      catch (fileErr) { console.error('deleteProductGalleryImage orphan cleanup:', fileErr); }
    }
    return productGalleryResult_(productCode, images, 'ลบรูปแล้ว');
  } catch (e) {
    return { success:false, message:e.message };
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (ignore) {} }
  }
}

function setProductGalleryPrimary(token, userAgent, productCode, imageId) {
  var lock = null;
  try {
    var auth = productGalleryAuth_(token, userAgent, true);
    if (!auth.ok) return { success:false, message:auth.message };
    productCode = String(productCode || '').trim();
    imageId = String(imageId || '').trim();
    lock = productGalleryWriteLock_();
    var images = productGalleryRead_(productCode), foundIndex = -1;
    images.some(function(img, i){ if (String(img.id) === imageId) { foundIndex = i; return true; } return false; });
    if (foundIndex < 0) return { success:false, message:'ไม่พบรูปที่เลือก' };
    if (foundIndex > 0) images.unshift(images.splice(foundIndex,1)[0]);
    productGallerySave_(productCode, images);
    return productGalleryResult_(productCode, images, 'ตั้งเป็นรูปหลักแล้ว');
  } catch (e) {
    return { success:false, message:e.message };
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (ignore) {} }
  }
}
