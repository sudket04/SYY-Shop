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
    clearCollectionCache(PRODUCT_IMAGES_COLLECTION);
    if (typeof p0InvalidateProducts_ === 'function') p0InvalidateProducts_();
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
  // P0 efficiency: map only this product. getProductById() point-reads Product + primary
  // image and uses cached masters, instead of scanning Product_Images for every gallery change.
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
  try {
    var auth = productGalleryAuth_(token, userAgent, true);
    if (!auth.ok) return { success:false, message:auth.message };
    productCode = String(productCode || '').trim();
    if (!productCode) return { success:false, message:'กรุณาบันทึกสินค้าก่อนอัปโหลดรูป' };
    if (!base64Data) return { success:false, message:'ไม่พบข้อมูลรูปภาพ' };

    var images = productGalleryRead_(productCode);
    if (images.length >= PRODUCT_GALLERY_MAX_IMAGES) {
      return { success:false, message:'สินค้า 1 รายการอัปโหลดได้สูงสุด ' + PRODUCT_GALLERY_MAX_IMAGES + ' รูป' };
    }

    var bytes = Utilities.base64Decode(base64Data);
    if (bytes.length > 5 * 1024 * 1024) return { success:false, message:'ไฟล์รูปใหญ่เกิน 5MB' };

    var now = new Date();
    var imageId = Utilities.getUuid();
    var fileName = productCode + '_' + now.getTime() + '_' + imageId.substring(0,8) + '.jpg';
    var folder = getProductImageFolder_();
    var file = folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', fileName));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var imageUrl = 'https://lh3.googleusercontent.com/d/' + file.getId();

    images.push({ id:imageId, url:imageUrl, fileId:file.getId(), createdAt:now.toISOString(), legacy:false });
    productGallerySave_(productCode, images);
    return productGalleryResult_(productCode, images, 'เพิ่มรูปสินค้าแล้ว');
  } catch (e) {
    return { success:false, message:e.message };
  }
}

function deleteProductGalleryImage(token, userAgent, productCode, imageId) {
  try {
    var auth = productGalleryAuth_(token, userAgent, true);
    if (!auth.ok) return { success:false, message:auth.message };
    productCode = String(productCode || '').trim();
    imageId = String(imageId || '').trim();
    var images = productGalleryRead_(productCode);
    var target = null;
    images = images.filter(function(img){
      if (String(img.id) === imageId) { target = img; return false; }
      return true;
    });
    if (!target) return { success:false, message:'ไม่พบรูปที่ต้องการลบ' };
    if (target.fileId) {
      try { DriveApp.getFileById(target.fileId).setTrashed(true); } catch (ignore) {}
    }
    productGallerySave_(productCode, images);
    return productGalleryResult_(productCode, images, 'ลบรูปแล้ว');
  } catch (e) {
    return { success:false, message:e.message };
  }
}

function setProductGalleryPrimary(token, userAgent, productCode, imageId) {
  try {
    var auth = productGalleryAuth_(token, userAgent, true);
    if (!auth.ok) return { success:false, message:auth.message };
    productCode = String(productCode || '').trim();
    imageId = String(imageId || '').trim();
    var images = productGalleryRead_(productCode), foundIndex = -1;
    images.some(function(img, i){ if (String(img.id) === imageId) { foundIndex = i; return true; } return false; });
    if (foundIndex < 0) return { success:false, message:'ไม่พบรูปที่เลือก' };
    if (foundIndex > 0) images.unshift(images.splice(foundIndex,1)[0]);
    productGallerySave_(productCode, images);
    return productGalleryResult_(productCode, images, 'ตั้งเป็นรูปหลักแล้ว');
  } catch (e) {
    return { success:false, message:e.message };
  }
}
