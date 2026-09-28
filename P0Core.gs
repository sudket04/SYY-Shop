// ============================================================
// SYY Shop P0 Core
// Production hardening: efficient reads, atomic inventory flows,
// safe sequential IDs, bounded dashboard reads, and P0 gateway.
// ============================================================

var P0_COUNTER_COLLECTION = 'System_Counters';
var P0_PRODUCT_CACHE_KEY = 'p0_products_v2';
var P0_CUSTOMER_CACHE_KEY = 'p0_customers_v1';
var P0_DASH_MOVEMENT_CACHE_KEY = 'p0_dash_movements_730_v1';
var P0_CACHE_CHUNK_CHARS = 45000;
var P0_PRODUCT_CACHE_TTL = 600;
var P0_CUSTOMER_CACHE_TTL = 900;
var P0_DASH_CACHE_TTL = 300;
var P0_DASH_WINDOW_DAYS = 730;
var P0_DASH_MOVEMENT_LIMIT = 5000;

function p0Fail_(message, title) {
  return { success:false, title:title || 'ไม่สำเร็จ', message:String(message || 'เกิดข้อผิดพลาด') };
}

function p0RoleAllowed_(actual, required) {
  var ranks = { viewer:1, staff:2, admin:3 };
  return (ranks[String(actual || '').toLowerCase()] || 0) >= (ranks[required] || 99);
}

function p0Gateway(token, fnName, args, userAgent) {
  try {
    var session = getSession_(token, userAgent);
    if (!session) return { __authError:true, success:false, message:'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };
    var a = Array.isArray(args) ? args : [];
    var handlers = {
      getAllProducts             : { role:'viewer', fn:p0GetAllProducts_ },
      getCustomersFull           : { role:'viewer', fn:p0GetCustomersFull_ },
      getDashboardBootstrap      : { role:'viewer', fn:p0GetDashboardBootstrap_ },
      saveProduct                : { role:'staff',  fn:p0SaveProduct_ },
      saveBrand                  : { role:'staff',  fn:p0SaveBrand_ },
      saveCategory               : { role:'staff',  fn:p0SaveCategory_ },
      saveVendor                 : { role:'staff',  fn:p0SaveVendor_ },
      saveCustomer               : { role:'staff',  fn:p0SaveCustomer_ },
      saveZone                   : { role:'staff',  fn:p0SaveZone_ },
      saveCar                    : { role:'staff',  fn:p0SaveCar_ },
      savePurchaseOrder          : { role:'staff',  fn:p0SavePurchaseOrder_ },
      receiveGoods               : { role:'staff',  fn:p0ReceiveGoods_ },
      issueStock                 : { role:'staff',  fn:p0IssueStock_ },
      markQuotationStockIssued   : { role:'staff',  fn:p0MarkQuotationStockIssued_ },
      saveTaxInvoice             : { role:'viewer', fn:p0SaveTaxInvoice_ },
      saveQuotation              : { role:'viewer', fn:p0SaveQuotation_ },
      deleteProduct              : { role:'admin',  fn:p0DeleteProduct_ },
      uploadProductImage         : { role:'staff',  fn:p0UploadProductImage_ },
      deleteProductImage         : { role:'staff',  fn:p0DeleteProductImage_ },
      getProductGallery          : { role:'viewer', fn:p0GetProductGallery_ },
      uploadProductGalleryImage  : { role:'staff',  fn:p0UploadProductImage_ },
      deleteProductGalleryImage  : { role:'staff',  fn:p0DeleteGalleryImage_ },
      setProductGalleryPrimary   : { role:'staff',  fn:p0SetGalleryPrimary_ }
    };
    var h = handlers[fnName];
    if (!h) return apiGateway(token, fnName, a, userAgent);
    if (!p0RoleAllowed_(session.role, h.role)) return p0Fail_('สิทธิ์ของคุณไม่เพียงพอสำหรับการทำรายการนี้');
    var callArgs = a.slice();
    if (fnName === 'receiveGoods' || fnName === 'issueStock' || fnName === 'saveQuotation' || fnName === 'markQuotationStockIssued') {
      callArgs.push(session.username);
    }
    var result = h.fn.apply(null, callArgs);
    if (ACTIVITY_ACTIONS && ACTIVITY_ACTIONS[fnName]) logActivity_(session.username, fnName, callArgs, result);
    return result;
  } catch (e) {
    console.error('p0Gateway error [' + fnName + ']:', e);
    return p0Fail_(friendlyErrorMessage_(e), 'ข้อผิดพลาด');
  }
}

function p0FetchAllPages_(collectionName, maxPages) {
  var docs = [], pageToken = '', pages = 0, cap = Math.max(1, parseInt(maxPages, 10) || 200);
  try {
    do {
      var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
        '/databases/(default)/documents/' + collectionName + '?pageSize=300' +
        (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
      var res = UrlFetchApp.fetch(url, { method:'get', headers:getAuthHeader(), muteHttpExceptions:true });
      if (res.getResponseCode() !== 200) {
        return { ok:false, truncated:false, docs:[], message:'HTTP ' + res.getResponseCode() + ': ' + res.getContentText() };
      }
      var json = JSON.parse(res.getContentText());
      (json.documents || []).forEach(function(doc) {
        docs.push({ id:doc.name.split('/').pop(), fields:doc.fields || {}, updateTime:doc.updateTime || '' });
      });
      pageToken = json.nextPageToken || '';
      pages++;
      if (pageToken && pages >= cap) {
        console.error('p0FetchAllPages_: truncated ' + collectionName + ' after ' + pages + ' pages');
        return { ok:false, truncated:true, docs:docs, nextPageToken:pageToken, message:'ข้อมูลมากเกินขอบเขตที่อนุญาต กรุณาใช้ query/pagination แทน full scan' };
      }
    } while (pageToken);
    return { ok:true, truncated:false, docs:docs, pages:pages };
  } catch (e) {
    return { ok:false, truncated:false, docs:[], message:e.message };
  }
}

function p0CacheMetaKey_(base) { return base + ':meta'; }
function p0CacheChunkKey_(base, i) { return base + ':c:' + i; }

function p0CacheGetJson_(base) {
  try {
    var cache = CacheService.getScriptCache();
    var metaRaw = cache.get(p0CacheMetaKey_(base));
    if (!metaRaw) return null;
    var meta = JSON.parse(metaRaw), parts = [];
    if (!meta || !meta.n || meta.n < 1) return null;
    for (var i = 0; i < meta.n; i++) {
      var part = cache.get(p0CacheChunkKey_(base, i));
      if (part === null) return null;
      parts.push(part);
    }
    return JSON.parse(parts.join(''));
  } catch (e) {
    console.error('p0CacheGetJson_:', e);
    return null;
  }
}

function p0CachePutJson_(base, value, ttl) {
  try {
    var cache = CacheService.getScriptCache();
    var text = JSON.stringify(value), chunks = [];
    for (var i = 0; i < text.length; i += P0_CACHE_CHUNK_CHARS) chunks.push(text.substring(i, i + P0_CACHE_CHUNK_CHARS));
    if (!chunks.length) chunks = ['null'];
    for (var j = 0; j < chunks.length; j++) cache.put(p0CacheChunkKey_(base, j), chunks[j], ttl);
    cache.put(p0CacheMetaKey_(base), JSON.stringify({ n:chunks.length, at:Date.now() }), ttl);
    return true;
  } catch (e) {
    console.error('p0CachePutJson_:', e);
    return false;
  }
}

function p0CacheRemove_(base) {
  try {
    var cache = CacheService.getScriptCache(), metaRaw = cache.get(p0CacheMetaKey_(base)), keys = [p0CacheMetaKey_(base)];
    if (metaRaw) {
      var meta = JSON.parse(metaRaw);
      for (var i = 0; i < (meta.n || 0); i++) keys.push(p0CacheChunkKey_(base, i));
    }
    cache.removeAll(keys);
  } catch (e) {
    console.error('p0CacheRemove_:', e);
  }
}

function p0InvalidateProducts_() {
  p0CacheRemove_(P0_PRODUCT_CACHE_KEY);
  p0CacheRemove_(P0_DASH_MOVEMENT_CACHE_KEY);
  clearCollectionCache('Product_Images');
}
function p0InvalidateCustomers_() { p0CacheRemove_(P0_CUSTOMER_CACHE_KEY); }
function p0InvalidateDashboard_() { p0CacheRemove_(P0_DASH_MOVEMENT_CACHE_KEY); }

function p0WithColdCacheLock_(base, ttl, loader) {
  var cached = p0CacheGetJson_(base);
  if (cached !== null) return cached;
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(5000);
    if (locked) {
      cached = p0CacheGetJson_(base);
      if (cached !== null) return cached;
      var loaded = loader();
      p0CachePutJson_(base, loaded, ttl);
      return loaded;
    }
    return loader();
  } finally {
    if (locked) lock.releaseLock();
  }
}

function p0GetDoc_(collectionName, docId) {
  try {
    var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
      '/databases/(default)/documents/' + collectionName + '/' + encodeURIComponent(docId);
    var res = UrlFetchApp.fetch(url, { method:'get', headers:getAuthHeader(), muteHttpExceptions:true });
    if (res.getResponseCode() !== 200) return null;
    var doc = JSON.parse(res.getContentText());
    return { id:doc.name.split('/').pop(), fields:doc.fields || {}, updateTime:doc.updateTime || '', name:doc.name };
  } catch (e) { return null; }
}

function p0BatchGet_(collectionName, ids) {
  var out = {}, uniq = [];
  (ids || []).forEach(function(id) { if (id && uniq.indexOf(id) < 0) uniq.push(id); });
  for (var offset = 0; offset < uniq.length; offset += 100) {
    var batch = uniq.slice(offset, offset + 100);
    var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents:batchGet';
    var res = UrlFetchApp.fetch(url, {
      method:'post', headers:getAuthHeader(), muteHttpExceptions:true,
      payload:JSON.stringify({ documents:batch.map(function(id){ return fsDocPath_(collectionName, id); }) })
    });
    if (res.getResponseCode() !== 200) continue;
    (JSON.parse(res.getContentText()) || []).forEach(function(row) {
      if (!row.found) return;
      var id = row.found.name.split('/').pop();
      out[id] = { id:id, fields:row.found.fields || {}, updateTime:row.found.updateTime || '', name:row.found.name };
    });
  }
  return out;
}

function p0QueryEqual_(collectionName, fieldPath, value, limit) {
  var docs = [];
  try {
    var q = { structuredQuery:{
      from:[{collectionId:collectionName}],
      where:{fieldFilter:{field:{fieldPath:fieldPath}, op:'EQUAL', value:{stringValue:String(value)}}},
      limit:Math.min(parseInt(limit,10) || 10, 50)
    }};
    var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents:runQuery';
    var res = UrlFetchApp.fetch(url, { method:'post', headers:getAuthHeader(), payload:JSON.stringify(q), muteHttpExceptions:true });
    if (res.getResponseCode() === 200) {
      (JSON.parse(res.getContentText()) || []).forEach(function(row) {
        if (row.document) docs.push({ id:row.document.name.split('/').pop(), fields:row.document.fields || {}, updateTime:row.document.updateTime || '' });
      });
    }
  } catch (e) { console.error('p0QueryEqual_:', e); }
  return docs;
}

function p0SeedCounterMax_(collectionName, prefix) {
  var fetched = p0FetchAllPages_(collectionName, 200);
  if (!fetched.ok) throw new Error('ไม่สามารถตั้งต้น Counter ของ ' + collectionName + ': ' + (fetched.message || 'อ่านข้อมูลไม่ครบ'));
  var max = 0;
  fetched.docs.forEach(function(doc) {
    var s = doc.id.indexOf(prefix) === 0 ? doc.id.substring(prefix.length) : '';
    if (/^\d+$/.test(s)) max = Math.max(max, parseInt(s, 10));
  });
  return max;
}

function p0NextAutoId_(collectionName, prefix) {
  var counterId = 'AutoId__' + collectionName + '__' + prefix;
  var counterPath = fsDocPath_(P0_COUNTER_COLLECTION, counterId);
  for (var attempt = 0; attempt < 6; attempt++) {
    var doc = p0GetDoc_(P0_COUNTER_COLLECTION, counterId);
    if (!doc) {
      var seed = p0SeedCounterMax_(collectionName, prefix);
      var createUrl = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
        '/databases/(default)/documents/' + P0_COUNTER_COLLECTION + '?documentId=' + encodeURIComponent(counterId);
      var createRes = UrlFetchApp.fetch(createUrl, {
        method:'post', headers:getAuthHeader(), muteHttpExceptions:true,
        payload:JSON.stringify({ fields:mapToFirestoreFields({ Value:seed, UpdatedAt:new Date().toISOString() }) })
      });
      if (createRes.getResponseCode() !== 200 && createRes.getResponseCode() !== 409) {
        throw new Error('สร้าง Counter ไม่สำเร็จ: ' + createRes.getContentText());
      }
      continue;
    }
    var current = parseInt(parseFirestoreValue(doc.fields.Value) || 0, 10), next = current + 1;
    var commit = fsCommit_([{
      update:{ name:counterPath, fields:mapToFirestoreFields({ Value:next, UpdatedAt:new Date().toISOString() }) },
      updateMask:{ fieldPaths:['Value','UpdatedAt'] },
      currentDocument:{ updateTime:doc.updateTime }
    }]);
    if (commit.ok) return prefix + String(next).padStart(4, '0');
    if (!isPreconditionFailure_(commit.message)) throw new Error('อัปเดต Counter ไม่สำเร็จ: ' + commit.message);
    Utilities.sleep(80 * (attempt + 1));
  }
  throw new Error('ไม่สามารถจองรหัสใหม่ได้เนื่องจากมีการใช้งานพร้อมกัน กรุณาลองอีกครั้ง');
}

var P0_NAME_FIELD = {
  Master_Brands:'Brand_Name',
  Master_Categories:'Category_Name',
  Master_Vendors:'Vendor_name',
  Master_Customers:'Customer_Name',
  Master_Zones:'Area'
};

function p0SaveMasterData_(collectionName, prefix, docId, dataObject, duplicateName) {
  try {
    var nameField = P0_NAME_FIELD[collectionName];
    if (duplicateName && nameField) {
      var dup = p0QueryEqual_(collectionName, nameField, String(duplicateName).trim(), 10)
        .some(function(d){ return d.id !== docId; });
      if (dup) return p0Fail_('ชื่อ "' + duplicateName + '" มีในระบบแล้ว', 'ข้อมูลซ้ำ!');
    }
    var fields = mapToFirestoreFields(dataObject || {});
    if (!docId) {
      for (var attempt = 0; attempt < 5; attempt++) {
        var newId = p0NextAutoId_(collectionName, prefix);
        var createUrl = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
          '/databases/(default)/documents/' + collectionName + '?documentId=' + encodeURIComponent(newId);
        var cr = UrlFetchApp.fetch(createUrl, {
          method:'post', headers:getAuthHeader(), payload:JSON.stringify({fields:fields}), muteHttpExceptions:true
        });
        if (cr.getResponseCode() === 200) {
          clearCollectionCache(collectionName);
          return { success:true, title:'สำเร็จ', message:'บันทึกข้อมูลเรียบร้อย', id:newId };
        }
        if (cr.getResponseCode() !== 409) return p0Fail_(cr.getContentText(), 'ล้มเหลว');
      }
      return p0Fail_('ไม่สามารถสร้างรหัสใหม่ได้ กรุณาลองอีกครั้ง', 'ล้มเหลว');
    }
    var names = Object.keys(fields);
    var qs = names.map(function(n){ return 'updateMask.fieldPaths=' + encodeURIComponent(n); }).join('&');
    var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
      '/databases/(default)/documents/' + collectionName + '/' + encodeURIComponent(docId) + (qs ? '?' + qs : '');
    var res = UrlFetchApp.fetch(url, {
      method:'patch', headers:getAuthHeader(), payload:JSON.stringify({fields:fields}), muteHttpExceptions:true
    });
    if (res.getResponseCode() === 200) {
      clearCollectionCache(collectionName);
      return { success:true, title:'สำเร็จ', message:'บันทึกข้อมูลเรียบร้อย', id:docId };
    }
    return p0Fail_(res.getContentText(), 'ล้มเหลว');
  } catch (e) { return p0Fail_(e.message, 'ข้อผิดพลาด'); }
}

function p0MapProductDocs_(docs) {
  var masters = fetchCollectionsParallel(['Master_Brands','Master_Categories','Master_Vendors','Master_Zones','Master_Cars']);
  var brandMap = buildMapFromDocs(masters.Master_Brands,'Brand_Name');
  var catMap = buildMapFromDocs(masters.Master_Categories,'Category_Name');
  var vendorMap = buildMapFromDocs(masters.Master_Vendors,'Vendor_name');
  var zoneMap = buildZoneMapFromDocs(masters.Master_Zones);
  var carMap = buildCarMapFromDocs(masters.Master_Cars);
  var imageMap = {};
  var imgFetched = p0FetchAllPages_('Product_Images', 200);
  if (imgFetched.ok) imgFetched.docs.forEach(function(d) {
    var u = parseFirestoreValue((d.fields || {}).Image_Url); if (u) imageMap[d.id] = u;
  });
  return (docs || []).map(function(doc) {
    var f=doc.fields||{}, id=doc.id;
    var brandId=parseFirestoreValue(f.Brand_ID)||'', catId=parseFirestoreValue(f.Category_ID)||'';
    var vendorId=parseFirestoreValue(f.Default_Vendor_ID)||'', zoneId=parseFirestoreValue(f.Zone_ID)||'';
    var carIds=parseFirestoreValue(f.Car_IDs);
    if (!carIds || (Array.isArray(carIds)&&!carIds.length)) { var legacy=parseFirestoreValue(f.Car_ID); carIds=legacy?[legacy]:[]; }
    else if (!Array.isArray(carIds)) carIds=[carIds];
    return {
      id:id, productCode:id, productName:parseFirestoreValue(f.Product_Name)||'',
      partType:parseFirestoreValue(f.Part_Type)||'', partNumber:String(parseFirestoreValue(f.Part_Number)||''),
      barcode:String(parseFirestoreValue(f.Barcode)||''), barcodeGenerated:parseFirestoreValue(f.Barcode_Generated)==='true',
      imageUrl:imageMap[id]||'', brandId:brandId, brandName:brandMap[brandId]||brandId,
      categoryId:catId, categoryName:catMap[catId]||catId, vendorId:vendorId, vendorName:vendorMap[vendorId]||vendorId,
      zoneId:zoneId, zoneName:zoneId==='PENDING'?'รอดำเนินการ':(zoneMap[zoneId]||zoneId),
      carIds:carIds, carModel:carIds.map(function(c){return carMap[c]||c;}).filter(Boolean).join(', '),
      costPrice:parseFloat(parseFirestoreValue(f.Cost_Price)||0), sellingPrice:parseFloat(parseFirestoreValue(f.Selling_Price)||0),
      currentStock:parseFloat(parseFirestoreValue(f.Current_Stock)||0), minStock:parseFloat(parseFirestoreValue(f.Min_Stock)||0),
      status:parseFirestoreValue(f.Status)||'Active'
    };
  });
}

function p0GetAllProducts_() {
  return p0WithColdCacheLock_(P0_PRODUCT_CACHE_KEY, P0_PRODUCT_CACHE_TTL, function() {
    var fetched=p0FetchAllPages_('Master_Products',200);
    if(!fetched.ok) throw new Error(fetched.message||'โหลดข้อมูลสินค้าไม่ครบ');
    return p0MapProductDocs_(fetched.docs);
  });
}

function p0GetProductMapped_(productCode) {
  var doc=p0GetDoc_('Master_Products',productCode);
  if(!doc) return null;
  return p0MapProductDocs_([doc])[0]||null;
}

function p0MapCustomerDoc_(doc) {
  if(!doc) return null; var f=doc.fields||{};
  return {
    id:doc.id, Customer_Name:parseFirestoreValue(f.Customer_Name)||'', Customer_Type:parseFirestoreValue(f.Customer_Type)||'',
    Address_No:parseFirestoreValue(f.Address_No)||'', Address_Moo:parseFirestoreValue(f.Address_Moo)||'',
    Address_Road:parseFirestoreValue(f.Address_Road)||'', Subdistrict:parseFirestoreValue(f.Subdistrict)||'',
    District:parseFirestoreValue(f.District)||'', Province:parseFirestoreValue(f.Province)||'',
    Postal_Code:parseFirestoreValue(f.Postal_Code)||'', Tax_ID:String(parseFirestoreValue(f.Tax_ID)||''),
    Branch:parseFirestoreValue(f.Branch)||'', Phone:parseFirestoreValue(f.Phone)||'', Status:parseFirestoreValue(f.Status)||'',
    Address:buildFullAddress({
      addressNo:parseFirestoreValue(f.Address_No),addressMoo:parseFirestoreValue(f.Address_Moo),
      addressRoad:parseFirestoreValue(f.Address_Road),subdistrict:parseFirestoreValue(f.Subdistrict),
      district:parseFirestoreValue(f.District),province:parseFirestoreValue(f.Province),
      postalCode:parseFirestoreValue(f.Postal_Code),address:parseFirestoreValue(f.Address)
    })
  };
}

function p0GetCustomersFull_() {
  return p0WithColdCacheLock_(P0_CUSTOMER_CACHE_KEY,P0_CUSTOMER_CACHE_TTL,function(){
    var fetched=p0FetchAllPages_('Master_Customers',200);
    if(!fetched.ok) throw new Error(fetched.message||'โหลดลูกค้าไม่ครบ');
    return fetched.docs.map(p0MapCustomerDoc_);
  });
}

function p0SaveBrand_(d){ d=d||{}; var r=p0SaveMasterData_('Master_Brands','B',d.docId||null,{Brand_Name:String(d.brandName||''),Description:String(d.description||''),Status:String(d.status||'Active')},d.brandName); p0InvalidateProducts_(); return r; }
function p0SaveCategory_(d){ d=d||{}; var r=p0SaveMasterData_('Master_Categories','C',d.docId||null,{Category_Name:String(d.categoryName||''),Description:String(d.description||''),Status:String(d.status||'Active')},d.categoryName); p0InvalidateProducts_(); return r; }
function p0SaveVendor_(d){
  d=d||{}; var taxId=String(d.taxId||'').replace(/\D/g,''); if(!taxId||taxId.length!==13)return p0Fail_('เลขประจำตัวผู้เสียภาษีอากรต้องมี 13 หลัก','ข้อมูลไม่ถูกต้อง');
  var obj={Vendor_name:String(d.vendorName||''),Contact_name:String(d.contact||''),Phone:String(d.phone||''),Email:String(d.email||''),
    Address_No:String(d.addressNo||''),Address_Moo:String(d.addressMoo||''),Address_Road:String(d.addressRoad||''),Subdistrict:String(d.subdistrict||''),
    District:String(d.district||''),Province:String(d.province||''),Postal_Code:String(d.postalCode||''),Address:String(d.address||''),Tax_ID:taxId,
    Branch:String(d.branch||'').trim()||'สำนักงานใหญ่',Status:String(d.status||'Active')};
  var r=p0SaveMasterData_('Master_Vendors','V',d.docId||null,obj,d.vendorName); p0InvalidateProducts_(); return r;
}
function p0SaveCustomer_(d){
  d=d||{}; var name=String(d.customerName||'').trim(); if(!name)return p0Fail_('กรุณากรอกชื่อลูกค้า','ข้อมูลไม่ครบ');
  var taxId=String(d.taxId||'').replace(/\D/g,''); if(taxId&&taxId.length!==13)return p0Fail_('เลขผู้เสียภาษีต้องมี 13 หลัก หรือเว้นว่าง','ข้อมูลไม่ถูกต้อง');
  if(taxId&&p0QueryEqual_('Master_Customers','Tax_ID',taxId,10).some(function(x){return x.id!==(d.docId||null);})){return p0Fail_('เลขประจำตัวผู้เสียภาษี "'+taxId+'" มีอยู่ในระบบแล้ว','ข้อมูลซ้ำ!');}
  var type=String(d.customerType||'').trim()||CUSTOMER_TYPES[0]; if(CUSTOMER_TYPES.indexOf(type)<0)return p0Fail_('ประเภทลูกค้าไม่ถูกต้อง');
  var obj={Customer_Name:name,Customer_Type:type,Address_No:String(d.addressNo||''),Address_Moo:String(d.addressMoo||''),Address_Road:String(d.addressRoad||''),
    Subdistrict:String(d.subdistrict||''),District:String(d.district||''),Province:String(d.province||''),Postal_Code:String(d.postalCode||''),
    Address:String(d.address||''),Tax_ID:taxId,Branch:String(d.branch||'').trim()||'สำนักงานใหญ่',Phone:String(d.phone||''),Status:String(d.status||'Active')};
  var r=p0SaveMasterData_('Master_Customers','C',d.docId||null,obj,name); p0InvalidateCustomers_(); if(r.success)r.customer=p0MapCustomerDoc_(p0GetDoc_('Master_Customers',r.id)); return r;
}
function p0SaveZone_(d){d=d||{};var r=p0SaveMasterData_('Master_Zones','Z',d.docId||null,{Area:String(d.area||''),Build:String(d.build||''),Floor:String(d.floor||''),Rack_no:String(d.rackNo||''),Note:String(d.note||''),Car_ID:String(d.carId||''),Status:String(d.status||'Active')},d.area);p0InvalidateProducts_();return r;}
function p0SaveCar_(d){d=d||{};var r=p0SaveMasterData_('Master_Cars','CAR',d.docId||null,{Brand:String(d.brand||''),Type_Car:String(d.typeCar||''),Model:String(d.model||''),Year:String(d.year||'')},null);p0InvalidateProducts_();return r;}

function p0SaveProduct_(d) {
  d=d||{}; var docId=d.productCode||d.docId||null, existing=docId?p0GetDoc_('Master_Products',docId):null;
  var pn=String(d.partNumber||'').trim(), bc=String(d.barcode||'').trim();
  if(pn&&p0QueryEqual_('Master_Products','Part_Number',pn,10).some(function(x){return x.id!==docId;}))return p0Fail_('รหัสจากผู้ผลิต (Part Number) "'+pn+'" มีอยู่ในระบบแล้ว','ข้อมูลซ้ำ!');
  if(bc&&p0QueryEqual_('Master_Products','Barcode',bc,10).some(function(x){return x.id!==docId;}))return p0Fail_('บาร์โค้ด "'+bc+'" มีอยู่ในระบบแล้ว','ข้อมูลซ้ำ!');
  var carIds=Array.isArray(d.carIds)?d.carIds.filter(Boolean):[];
  var oldFields=existing?existing.fields:{}, oldBarcode=String(parseFirestoreValue(oldFields.Barcode)||'').trim();
  var oldGenerated=parseFirestoreValue(oldFields.Barcode_Generated)==='true';
  var currentStock=existing?parseFloat(parseFirestoreValue(oldFields.Current_Stock)||0):parseFloat(d.currentStock||0);
  var obj={
    Product_Name:String(d.productName||''),Part_Type:String(d.partType||'').trim()||'PENDING',Part_Number:pn,Barcode:bc,
    Brand_ID:String(d.brandId||''),Category_ID:String(d.categoryId||''),Default_Vendor_ID:String(d.vendorId||''),Zone_ID:String(d.zoneId||'').trim()||'PENDING',
    Car_IDs:carIds,Cost_Price:parseFloat(d.costPrice||0),Selling_Price:parseFloat(d.sellingPrice||0),Current_Stock:currentStock,
    Min_Stock:parseFloat(d.minStock||0),Status:String(d.status||'Active'),Barcode_Generated:(oldGenerated&&oldBarcode&&oldBarcode===bc)?'true':'false'
  };
  var r=p0SaveMasterData_('Master_Products','P',docId,obj,null);
  if(r.success){p0InvalidateProducts_();r.product=p0GetProductMapped_(r.id);r.stockProtected=!!existing;}
  return r;
}
function p0DeleteProduct_(docId){var r=deleteFirestoreDocument('Master_Products',docId);if(r.success){p0InvalidateProducts_();r.deletedId=docId;}return r;}

function p0GalleryResult_(productCode, images, message) {
  p0InvalidateProducts_();
  return {success:true,message:message||'สำเร็จ',images:images||[],imageUrl:(images&&images.length)?images[0].url:'',product:p0GetProductMapped_(productCode),maxImages:PRODUCT_GALLERY_MAX_IMAGES};
}
function p0GetProductGallery_(productCode){productCode=String(productCode||'').trim();if(!productCode)return p0Fail_('ไม่พบรหัสสินค้า');var images=productGalleryRead_(productCode);return {success:true,images:images,maxImages:PRODUCT_GALLERY_MAX_IMAGES};}
function p0UploadProductImage_(productCode,base64Data){
  try{
    productCode=String(productCode||'').trim();if(!productCode||!base64Data)return p0Fail_('ข้อมูลรูปภาพไม่ครบ');
    var images=productGalleryRead_(productCode);if(images.length>=PRODUCT_GALLERY_MAX_IMAGES)return p0Fail_('สินค้า 1 รายการอัปโหลดได้สูงสุด '+PRODUCT_GALLERY_MAX_IMAGES+' รูป');
    var bytes=Utilities.base64Decode(base64Data);if(bytes.length>5*1024*1024)return p0Fail_('ไฟล์รูปใหญ่เกิน 5MB');
    var now=new Date(),id=Utilities.getUuid(),fileName=productCode+'_'+now.getTime()+'_'+id.substring(0,8)+'.jpg';
    var file=getProductImageFolder_().createFile(Utilities.newBlob(bytes,'image/jpeg',fileName));file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
    images.push({id:id,url:'https://lh3.googleusercontent.com/d/'+file.getId(),fileId:file.getId(),createdAt:now.toISOString(),legacy:false});
    productGallerySave_(productCode,images);return p0GalleryResult_(productCode,images,'เพิ่มรูปสินค้าแล้ว');
  }catch(e){return p0Fail_(e.message);}
}
function p0DeleteGalleryImage_(productCode,imageId){
  try{
    var images=productGalleryRead_(productCode),target=null;
    images=images.filter(function(img){if(String(img.id)===String(imageId)){target=img;return false;}return true;});
    if(!target)return p0Fail_('ไม่พบรูปที่ต้องการลบ');
    if(target.fileId){try{DriveApp.getFileById(target.fileId).setTrashed(true);}catch(ignore){}}
    productGallerySave_(productCode,images);return p0GalleryResult_(productCode,images,'ลบรูปแล้ว');
  }catch(e){return p0Fail_(e.message);}
}
function p0DeleteProductImage_(productCode){
  var images=productGalleryRead_(productCode);if(!images.length)return p0GalleryResult_(productCode,[],'ไม่มีรูปสินค้า');
  return p0DeleteGalleryImage_(productCode,images[0].id);
}
function p0SetGalleryPrimary_(productCode,imageId){
  try{
    var images=productGalleryRead_(productCode),idx=-1;images.some(function(img,i){if(String(img.id)===String(imageId)){idx=i;return true;}return false;});
    if(idx<0)return p0Fail_('ไม่พบรูปที่เลือก');if(idx>0)images.unshift(images.splice(idx,1)[0]);
    productGallerySave_(productCode,images);return p0GalleryResult_(productCode,images,'ตั้งเป็นรูปหลักแล้ว');
  }catch(e){return p0Fail_(e.message);}
}

function p0SavePurchaseOrder_(d){
  d=d||{};var items=Array.isArray(d.items)?d.items:[];if(!d.vendorId)return p0Fail_('กรุณาระบุผู้จัดจำหน่าย','ข้อมูลไม่ครบ');if(!items.length)return p0Fail_('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ','ข้อมูลไม่ครบ');
  var tq=0,ta=0;items=items.map(function(it){var q=parseFloat(it.qty||0),c=parseFloat(it.costPrice||0);tq+=q;ta+=q*c;return {productCode:it.productCode,productName:it.productName,qty:q,costPrice:c,receivedQty:0};});
  var obj={Vendor_ID:String(d.vendorId||''),Order_Date:String(d.orderDate||new Date().toISOString().slice(0,10)),Status:String(d.status||'Pending'),Items_JSON:JSON.stringify(items),Receipts_JSON:'[]',Total_Qty:tq,Total_Amount:ta,Note:String(d.note||'')};
  var r=p0SaveMasterData_('Purchase_Orders','PO',null,obj,null);if(r.success)r.purchaseOrder={poId:r.id,vendorId:d.vendorId,orderDate:obj.Order_Date,status:obj.Status,items:items,receipts:[],totalQty:tq,totalAmount:ta,note:obj.Note};return r;
}

function p0VendorSnapshot_(vendorId){
  var d=vendorId?p0GetDoc_('Master_Vendors',vendorId):null,f=d?d.fields:{};
  return {id:vendorId||'',name:parseFirestoreValue(f.Vendor_name)||vendorId||''};
}
function p0ReceiveGoods_(d,callerUsername){
  d=d||{};if(!d.poId)return p0Fail_('ไม่พบเลขที่ใบสั่งซื้อ','ข้อมูลไม่ครบ');
  if(!String(d.invoiceNo||'').trim())return p0Fail_('กรุณากรอกเลขที่ Invoice','ข้อมูลไม่ครบ');
  if(!String(d.receiptDate||'').trim())return p0Fail_('กรุณาระบุวันที่รับสินค้า','ข้อมูลไม่ครบ');
  if(!String(d.receiverName||'').trim())return p0Fail_('กรุณากรอกชื่อผู้รับสินค้า','ข้อมูลไม่ครบ');
  var req=Array.isArray(d.items)?d.items:[];if(!req.length)return p0Fail_('ไม่มีรายการสินค้าที่จะรับ','ข้อมูลไม่ครบ');
  for(var attempt=1;attempt<=3;attempt++){
    var po=p0GetDoc_('Purchase_Orders',d.poId);if(!po)return p0Fail_('ไม่พบใบสั่งซื้อนี้');
    var f=po.fields||{},status=parseFirestoreValue(f.Status)||'Pending';if(status==='Received')return p0Fail_('ใบสั่งซื้อนี้ได้รับสินค้าครบแล้ว');if(status==='Cancelled')return p0Fail_('ใบสั่งซื้อนี้ถูกยกเลิกแล้ว');
    var poItems=[],receipts=[];try{poItems=JSON.parse(parseFirestoreValue(f.Items_JSON)||'[]');}catch(e){}try{receipts=JSON.parse(parseFirestoreValue(f.Receipts_JSON)||'[]');}catch(e2){}
    var receiveMap={};req.forEach(function(it){var code=String(it.productCode||'');receiveMap[code]=(receiveMap[code]||0)+Math.max(0,parseFloat(it.qtyReceivedNow||0));});
    var allComplete=true,lines=[];poItems=poItems.map(function(it){
      var ordered=parseFloat(it.qty||0),old=parseFloat(it.receivedQty||0),remaining=Math.max(ordered-old,0),now=Math.min(remaining,receiveMap[it.productCode]||0),next=old+now;
      if(next<ordered)allComplete=false;if(now>0)lines.push({productCode:it.productCode,productName:it.productName,qty:now,costPrice:parseFloat(it.costPrice||0)});
      it.receivedQty=next;return it;
    });
    if(!lines.length)return p0Fail_('กรุณาระบุจำนวนที่รับอย่างน้อย 1 รายการ','ข้อมูลไม่ครบ');
    if(!allComplete&&!String(d.deliveryNoteNo||'').trim())return p0Fail_('กรุณากรอกเลขที่ใบส่งของชั่วคราว เนื่องจากได้รับสินค้าไม่ครบ','ข้อมูลไม่ครบ');
    var stockMap=getProductStockMap_(lines.map(function(x){return x.productCode;})),missing=[];
    lines.forEach(function(x){if(!stockMap[x.productCode])missing.push(x.productCode);});if(missing.length)return p0Fail_('ไม่พบสินค้ารหัส: '+missing.join(', '));
    var vendorId=parseFirestoreValue(f.Vendor_ID)||'',vendor=p0VendorSnapshot_(vendorId),nowIso=new Date().toISOString();
    var receiptItems=lines.map(function(x){return {productCode:x.productCode,productName:x.productName,qtyReceivedNow:x.qty};});
    receipts.push({date:d.receiptDate,invoiceNo:String(d.invoiceNo||''),receiverName:String(d.receiverName||''),deliveryNoteNo:allComplete?'':String(d.deliveryNoteNo||''),isFinal:allComplete,items:receiptItems});
    var newStatus=allComplete?'Received':'PartiallyReceived',docNo='SR'+Utilities.formatDate(new Date(),'Asia/Bangkok','yyMMdd-HHmmss')+'-'+Utilities.getUuid().replace(/-/g,'').slice(0,4).toUpperCase();
    var writes=[];
    lines.forEach(function(x,i){var info=stockMap[x.productCode],after=info.stock+x.qty;
      var sw={transform:{document:fsDocPath_('Master_Products',x.productCode),fieldTransforms:[{fieldPath:'Current_Stock',increment:{doubleValue:x.qty}}]},currentDocument:{updateTime:info.updateTime}};writes.push(sw);
      writes.push({update:{name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,docNo+'-'+(i+1)),fields:{
        Doc_No:{stringValue:docNo},Type:{stringValue:'IN'},Product_Code:{stringValue:x.productCode},Product_Name:{stringValue:String(x.productName||info.name)},
        Qty:{doubleValue:x.qty},Stock_Before:{doubleValue:info.stock},Stock_After:{doubleValue:after},Cost_Price:{doubleValue:parseFloat(x.costPrice||info.costPrice||0)},
        Reason:{stringValue:'รับของตาม PO'},Ref_No:{stringValue:String(d.poId)},Vendor_ID:{stringValue:vendor.id},Vendor_Name:{stringValue:vendor.name},
        Invoice_No:{stringValue:String(d.invoiceNo||'')},Receipt_Date:{stringValue:String(d.receiptDate||'')},User:{stringValue:callerUsername||getCurrentUsername_()},Timestamp:{stringValue:nowIso}
      }}});
    });
    writes.push({update:{name:po.name,fields:{Items_JSON:{stringValue:JSON.stringify(poItems)},Receipts_JSON:{stringValue:JSON.stringify(receipts)},Status:{stringValue:newStatus}}},
      updateMask:{fieldPaths:['Items_JSON','Receipts_JSON','Status']},currentDocument:{updateTime:po.updateTime}});
    var commit=fsCommit_(writes);if(commit.ok){p0InvalidateProducts_();p0InvalidateDashboard_();return {success:true,title:'สำเร็จ',message:allComplete?'บันทึกรับสินค้าครบถ้วน และอัปเดตสต็อกเรียบร้อย':'บันทึกรับสินค้าบางส่วน และอัปเดตสต็อกเรียบร้อย',status:newStatus,poId:d.poId,
      stockChanges:lines.map(function(x){var info=stockMap[x.productCode];return {productCode:x.productCode,before:info.stock,after:info.stock+x.qty,qty:x.qty};}),purchaseOrder:{poId:d.poId,status:newStatus,items:poItems,receipts:receipts}};}
    if(!isPreconditionFailure_(commit.message)||attempt===3)return p0Fail_('บันทึกรับสินค้าไม่สำเร็จ: '+commit.message,'ล้มเหลว');
    Utilities.sleep(120*attempt);
  }
  return p0Fail_('บันทึกรับสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง');
}

function p0LoadQuoteForIssue_(quoteId){
  if(!quoteId)return null;var q=p0GetDoc_(QUOTATION_COLLECTION,quoteId);if(!q)return {error:'ไม่พบใบเสนอราคา'};
  var f=q.fields||{},status=parseFirestoreValue(f.Status)||'',issued=parseFirestoreValue(f.Stock_Issued)==='true';
  if(status!=='ปิดงาน-ขายสำเร็จ')return {error:'ใบเสนอราคายังไม่ได้ปิดงาน-ขายสำเร็จ'};
  if(issued)return {already:true,docNo:parseFirestoreValue(f.Stock_Issue_Doc)||''};
  var items=[];try{items=JSON.parse(parseFirestoreValue(f.Items_JSON)||'[]');}catch(e){}
  var priceMap={};items.forEach(function(it){if(it&&it.productCode)priceMap[it.productCode]=parseFloat(it.unitPrice)||0;});
  return {doc:q,priceMap:priceMap};
}
function p0IssueStock_(d,callerUsername){
  d=d||{};var raw=(Array.isArray(d.items)?d.items:[]).filter(function(it){return it&&it.productCode&&parseFloat(it.qty||0)>0;});if(!raw.length)return p0Fail_('ไม่มีรายการที่จะตัดสต๊อก');
  var reason=String(d.reason||'').trim();if(ISSUE_REASONS.indexOf(reason)<0)return p0Fail_('กรุณาเลือกเหตุผลที่ตัดสต๊อกให้ถูกต้อง');
  var merged={};raw.forEach(function(it){var c=String(it.productCode);if(!merged[c])merged[c]={productCode:c,productName:it.productName||'',qty:0};merged[c].qty+=parseFloat(it.qty||0);});
  var baseLines=Object.keys(merged).map(function(k){return merged[k];}),user=callerUsername||getCurrentUsername_();
  for(var attempt=1;attempt<=3;attempt++){
    var quoteInfo=p0LoadQuoteForIssue_(d.quoteId);if(quoteInfo&&quoteInfo.error)return p0Fail_(quoteInfo.error);if(quoteInfo&&quoteInfo.already)return p0Fail_('ใบเสนอราคานี้ถูกตัดสต๊อกแล้ว (เลขที่ '+quoteInfo.docNo+')');
    var stockMap=getProductStockMap_(baseLines.map(function(x){return x.productCode;})),lines=[],ins=[],missing=[];
    baseLines.forEach(function(x){var info=stockMap[x.productCode];if(!info){missing.push(x.productCode);return;}var after=info.stock-x.qty;if(after<0)ins.push({productCode:x.productCode,productName:x.productName||info.name,stock:info.stock,need:x.qty});
      lines.push({productCode:x.productCode,productName:x.productName||info.name,qty:x.qty,before:info.stock,after:after,minStock:info.minStock,costPrice:info.costPrice,unitPrice:quoteInfo&&quoteInfo.priceMap.hasOwnProperty(x.productCode)?quoteInfo.priceMap[x.productCode]:info.sellingPrice,updateTime:info.updateTime});});
    if(missing.length)return p0Fail_('ไม่พบสินค้ารหัส: '+missing.join(', '));if(ins.length&&!d.allowNegative)return p0Fail_('จำนวนที่ตัดเกินสต๊อกคงเหลือ: '+ins.map(function(x){return x.productName+' (คงเหลือ '+x.stock+' ต้องการ '+x.need+')';}).join(', '));
    var nowIso=new Date().toISOString(),docNo='SI'+Utilities.formatDate(new Date(),'Asia/Bangkok','yyMMdd-HHmmss')+'-'+Utilities.getUuid().replace(/-/g,'').slice(0,4).toUpperCase(),writes=[];
    lines.forEach(function(l,i){writes.push({transform:{document:fsDocPath_('Master_Products',l.productCode),fieldTransforms:[{fieldPath:'Current_Stock',increment:{doubleValue:-l.qty}}]},currentDocument:{updateTime:l.updateTime}});
      writes.push({update:{name:fsDocPath_(STOCK_MOVEMENT_COLLECTION,docNo+'-'+(i+1)),fields:{Doc_No:{stringValue:docNo},Type:{stringValue:'OUT'},Product_Code:{stringValue:l.productCode},Product_Name:{stringValue:String(l.productName)},
        Qty:{doubleValue:l.qty},Stock_Before:{doubleValue:l.before},Stock_After:{doubleValue:l.after},Unit_Price:{doubleValue:parseFloat(l.unitPrice||0)},Cost_Price:{doubleValue:parseFloat(l.costPrice||0)},Reason:{stringValue:reason},
        Ref_No:{stringValue:String(d.refNo||'')},Note:{stringValue:String(d.note||'')},User:{stringValue:user},Timestamp:{stringValue:nowIso}}}});});
    if(quoteInfo&&quoteInfo.doc){writes.push({update:{name:quoteInfo.doc.name,fields:{Stock_Issued:{stringValue:'true'},Stock_Issue_Doc:{stringValue:docNo},Stock_Issued_By:{stringValue:user},Stock_Issued_At:{stringValue:nowIso}}},
      updateMask:{fieldPaths:['Stock_Issued','Stock_Issue_Doc','Stock_Issued_By','Stock_Issued_At']},currentDocument:{updateTime:quoteInfo.doc.updateTime}});}
    var commit=fsCommit_(writes);if(commit.ok){p0InvalidateProducts_();p0InvalidateDashboard_();return {success:true,title:'สำเร็จ',message:'ตัดสต๊อกเรียบร้อย',docNo:docNo,quotationMarked:!!quoteInfo,
      results:lines.map(function(l){return {productCode:l.productCode,productName:l.productName,qty:l.qty,before:l.before,after:l.after,belowMin:l.after<=l.minStock};})};}
    if(!isPreconditionFailure_(commit.message)||attempt===3)return p0Fail_('บันทึกไม่สำเร็จ: '+commit.message,'ล้มเหลว');Utilities.sleep(120*attempt);
  }
  return p0Fail_('บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง');
}
function p0MarkQuotationStockIssued_(docId,docNo,callerUsername){
  var q=p0GetDoc_(QUOTATION_COLLECTION,docId);if(!q)return p0Fail_('ไม่พบใบเสนอราคา');var f=q.fields||{};
  if(parseFirestoreValue(f.Stock_Issued)==='true')return {success:true,alreadyMarked:true,message:'ใบเสนอราคาถูกบันทึกการตัดสต๊อกแล้ว'};
  return markQuotationStockIssued(docId,docNo,callerUsername);
}

function p0ParseMovementDoc_(doc){
  var f=doc.fields||{};return {id:doc.id,docNo:parseFirestoreValue(f.Doc_No)||'',type:parseFirestoreValue(f.Type)||'OUT',productCode:parseFirestoreValue(f.Product_Code)||'',productName:parseFirestoreValue(f.Product_Name)||'',
    qty:parseFloat(parseFirestoreValue(f.Qty)||0),stockAfter:parseFloat(parseFirestoreValue(f.Stock_After)||0),unitPrice:parseFloat(parseFirestoreValue(f.Unit_Price)||0),costPrice:parseFloat(parseFirestoreValue(f.Cost_Price)||0),
    reason:parseFirestoreValue(f.Reason)||'',refNo:parseFirestoreValue(f.Ref_No)||'',note:parseFirestoreValue(f.Note)||'',user:parseFirestoreValue(f.User)||'',timestamp:parseFirestoreValue(f.Timestamp)||'',
    vendorId:parseFirestoreValue(f.Vendor_ID)||'',vendorName:parseFirestoreValue(f.Vendor_Name)||''};
}
function p0LoadRecentMovements_(){
  return p0WithColdCacheLock_(P0_DASH_MOVEMENT_CACHE_KEY,P0_DASH_CACHE_TTL,function(){
    var from=new Date(Date.now()-P0_DASH_WINDOW_DAYS*86400000).toISOString(),q={structuredQuery:{from:[{collectionId:STOCK_MOVEMENT_COLLECTION}],
      where:{fieldFilter:{field:{fieldPath:'Timestamp'},op:'GREATER_THAN_OR_EQUAL',value:{stringValue:from}}},
      orderBy:[{field:{fieldPath:'Timestamp'},direction:'DESCENDING'}],limit:P0_DASH_MOVEMENT_LIMIT}};
    var url='https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:runQuery';
    var res=UrlFetchApp.fetch(url,{method:'post',headers:getAuthHeader(),payload:JSON.stringify(q),muteHttpExceptions:true});
    if(res.getResponseCode()!==200)throw new Error('Dashboard movements HTTP '+res.getResponseCode()+': '+res.getContentText());
    var out=[];(JSON.parse(res.getContentText())||[]).forEach(function(row){if(row.document)out.push(p0ParseMovementDoc_({id:row.document.name.split('/').pop(),fields:row.document.fields||{}}));});
    return {rows:out,truncated:out.length>=P0_DASH_MOVEMENT_LIMIT,from:from};
  });
}
function p0BuildPoVendorMap_(movements){
  var map={},refs=[];(movements||[]).forEach(function(m){if(m.vendorName&&m.refNo)map[m.refNo]=m.vendorName;else if(m.type==='IN'&&m.refNo&&refs.indexOf(m.refNo)<0)refs.push(m.refNo);});
  var pos=p0BatchGet_('Purchase_Orders',refs),vendorIds=[];Object.keys(pos).forEach(function(id){var vid=parseFirestoreValue((pos[id].fields||{}).Vendor_ID)||'';if(vid&&vendorIds.indexOf(vid)<0)vendorIds.push(vid);});
  var vendors=p0BatchGet_('Master_Vendors',vendorIds);Object.keys(pos).forEach(function(id){var vid=parseFirestoreValue((pos[id].fields||{}).Vendor_ID)||'';var vd=vendors[vid];map[id]=vd?(parseFirestoreValue((vd.fields||{}).Vendor_name)||vid):vid;});return map;
}
function p0CountOpenPO_(){
  try{
    var q={structuredQuery:{from:[{collectionId:'Purchase_Orders'}],where:{fieldFilter:{field:{fieldPath:'Status'},op:'IN',value:{arrayValue:{values:[{stringValue:'Pending'},{stringValue:'Ordered'},{stringValue:'PartiallyReceived'}]}}}}}};
    var payload={structuredAggregationQuery:{structuredQuery:q.structuredQuery,aggregations:[{alias:'total',count:{}}]}};
    var url='https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:runAggregationQuery';
    var res=UrlFetchApp.fetch(url,{method:'post',headers:getAuthHeader(),payload:JSON.stringify(payload),muteHttpExceptions:true});
    if(res.getResponseCode()!==200)return 0;var rows=JSON.parse(res.getContentText())||[];if(!rows.length)return 0;
    return parseInt((((rows[0].result||{}).aggregateFields||{}).total||{}).integerValue||0,10)||0;
  }catch(e){return 0;}
}
function p0GetDashboardBootstrap_(){
  var mv=p0LoadRecentMovements_(),products=p0GetAllProducts_();
  return {products:products,movements:mv.rows,poVendorMap:p0BuildPoVendorMap_(mv.rows),poWaitingCount:p0CountOpenPO_(),dataWindowDays:P0_DASH_WINDOW_DAYS,truncated:mv.truncated};
}

function p0MapTaxInvoiceDoc_(doc){if(!doc)return null;var d={name:doc.name||fsDocPath_('Master_Tax_Invoice',doc.id),fields:doc.fields||{}};return mapTaxInvoiceQueryDoc_(d);}
function p0SaveTaxInvoice_(d){
  d=d||{};var items=Array.isArray(d.items)?d.items:[],clean=items.filter(function(it){return String(it.name||'').trim()&&parseFloat(it.qty)>0&&parseFloat(it.unitPrice)>=0;}).map(function(it){return {name:String(it.name).trim(),qty:parseFloat(it.qty)||0,unit:String(it.unit||'').trim(),unitPrice:parseFloat(it.unitPrice)||0};});
  if(!clean.length)return p0Fail_('กรุณาเพิ่มรายการสินค้า/บริการอย่างน้อย 1 รายการ','ข้อมูลไม่ครบ');if(!String(d.buyerName||'').trim())return p0Fail_('กรุณากรอกชื่อผู้ซื้อ','ข้อมูลไม่ครบ');
  var tax=String(d.buyerTaxId||'').replace(/\D/g,'');if(tax&&tax.length!==13)return p0Fail_('เลขผู้เสียภาษีของผู้ซื้อต้องมี 13 หลัก','ข้อมูลไม่ถูกต้อง');
  var totals=calcTaxInvoiceTotals(clean),date=String(d.invoiceDate||'').trim()||new Date().toISOString().slice(0,10),invoiceNo='';
  if(d.docId){var ex=p0GetDoc_('Master_Tax_Invoice',d.docId);if(ex)invoiceNo=parseFirestoreValue(ex.fields.Invoice_No)||'';}
  var obj={Invoice_Date:date,Buyer_Name:String(d.buyerName||'').trim(),Buyer_Address:String(d.buyerAddress||'').trim(),Buyer_Tax_ID:tax,Buyer_Branch:String(d.buyerBranch||'').trim()||'สำนักงานใหญ่',
    Items_JSON:JSON.stringify(clean),Subtotal:totals.subtotal,Vat_Amount:totals.vat,Grand_Total:totals.total,Note:String(d.note||'')};
  var yearBE=new Date(date+'T00:00:00').getFullYear()+543,r;
  if(d.docId&&invoiceNo){obj.Invoice_No=invoiceNo;r=p0SaveMasterData_('Master_Tax_Invoice','TX',d.docId,obj,null);}
  else{
    var period=docPeriodKey_(date),last='';for(var a=0;a<10;a++){var n=nextRunningNumber_('TaxInvoice',period,function(){return getNextInvoiceRunningNumber(date,null);});if(n===null)n=getNextInvoiceRunningNumber(date,null)+a;var candidate=buildInvoiceNoForMonth(date,n);if(!reserveDocNo_('TaxInvoice',candidate))continue;obj.Invoice_No=candidate;r=p0SaveMasterData_('Master_Tax_Invoice','TX',null,obj,null);if(r.success)break;last=r.message;}if(!r||!r.success)return p0Fail_(last||'ไม่สามารถออกเลขที่ใบกำกับภาษีได้');
  }
  if(r.success){updateTaxInvoiceYearsMeta_(yearBE);r.invoice=p0MapTaxInvoiceDoc_(p0GetDoc_('Master_Tax_Invoice',r.id));}return r;
}

function p0SaveQuotation_(d,callerUsername){
  d=d||{};var clean=(Array.isArray(d.items)?d.items:[]).filter(function(it){return it&&String(it.productCode||'').trim()&&parseFloat(it.qty)>0&&parseFloat(it.unitPrice)>=0;}).map(function(it){return {productCode:String(it.productCode).trim(),productName:String(it.productName||'').trim(),partNumber:String(it.partNumber||'').trim(),qty:parseFloat(it.qty)||0,unitPrice:parseFloat(it.unitPrice)||0,costPrice:parseFloat(it.costPrice)||0};});
  if(!clean.length)return p0Fail_('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ','ข้อมูลไม่ครบ');if(!String(d.customerId||'').trim())return p0Fail_('กรุณาเลือกลูกค้า','ข้อมูลไม่ครบ');
  var cust=p0MapCustomerDoc_(p0GetDoc_('Master_Customers',d.customerId));if(!cust)return p0Fail_('ไม่พบลูกค้ารายนี้ในระบบ','ไม่พบข้อมูล');
  var date=String(d.quoteDate||'').trim()||new Date().toISOString().slice(0,10),days=parseInt(d.validDays,10)||15,until=new Date(date+'T00:00:00');if(isNaN(until.getTime()))until=new Date();until.setDate(until.getDate()+days);
  var totals=calcQuoteTotals(clean,d.discPct),user=callerUsername||getCurrentUsername_(),now=new Date().toISOString(),quoteNo='',status='ร่าง',createdUser=user,createdAt=now,stockMeta={};
  if(d.docId){var ex=p0GetDoc_(QUOTATION_COLLECTION,d.docId);if(ex){var ef=ex.fields||{};quoteNo=parseFirestoreValue(ef.Quote_No)||'';status=parseFirestoreValue(ef.Status)||'ร่าง';createdUser=parseFirestoreValue(ef.User)||user;createdAt=parseFirestoreValue(ef.Timestamp)||now;
    ['Stock_Issued','Stock_Issue_Doc','Stock_Issued_By','Stock_Issued_At'].forEach(function(k){var v=parseFirestoreValue(ef[k]);if(v!==''&&v!==undefined)stockMeta[k]=v;});}}
  var obj={Quote_Date:date,Valid_Days:days,Valid_Until:until.toISOString().slice(0,10),Customer_ID:d.customerId,Customer_Name:cust.Customer_Name,Customer_Type:cust.Customer_Type,Customer_Address:cust.Address,Customer_Tax_ID:cust.Tax_ID,Customer_Branch:cust.Branch,Customer_Phone:cust.Phone,
    Vehicle_Note:String(d.vehicleNote||'').trim(),Customer_PO:String(d.customerPo||'').trim(),Items_JSON:JSON.stringify(clean),Disc_Pct:totals.discPct,Subtotal:totals.subtotal,Disc_Amount:totals.discAmount,Vat_Amount:totals.vat,Grand_Total:totals.grandTotal,Cost_Total:totals.costTotal,Profit_Total:totals.profit,Margin_Pct:totals.marginPct,Status:status,Note:String(d.note||'').trim(),User:createdUser,Timestamp:createdAt,Updated_At:now};
  Object.keys(stockMeta).forEach(function(k){obj[k]=stockMeta[k];});
  var yearBE=new Date(date+'T00:00:00').getFullYear()+543,r;
  if(d.docId&&quoteNo){obj.Quote_No=quoteNo;r=p0SaveMasterData_(QUOTATION_COLLECTION,QUOTATION_PREFIX,d.docId,obj,null);}
  else{var period=docPeriodKey_(date),last='';for(var a=0;a<10;a++){var n=nextRunningNumber_('Quotation',period,function(){return getNextQuoteRunningNumber(date,null);});if(n===null)n=getNextQuoteRunningNumber(date,null)+a;var candidate=buildQuoteNoForMonth(date,n);if(!reserveDocNo_('Quotation',candidate))continue;obj.Quote_No=candidate;r=p0SaveMasterData_(QUOTATION_COLLECTION,QUOTATION_PREFIX,null,obj,null);if(r.success)break;last=r.message;}if(!r||!r.success)return p0Fail_(last||'ไม่สามารถออกเลขที่ใบเสนอราคาได้');}
  if(r.success){updateQuotationYearsMeta_(yearBE);var q=p0GetDoc_(QUOTATION_COLLECTION,r.id);r.quotation=q?mapQuotationDoc_({id:q.id,fields:q.fields}):null;}return r;
}
