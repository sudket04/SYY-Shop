// Product browsing, search, facets and read-only product details.
function catalogGetAllProducts_(options) {
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
function packProductCatalog_(rows,includeImageStatus){
  var fields=includeImageStatus?PRODUCT_CATALOG_FIELDS.concat('hasImage'):PRODUCT_CATALOG_FIELDS;
  return {catalogFormat:1,fields:fields,rows:rows.map(function(row){return fields.map(function(key){return row[key];});})};
}
function unpackProductCatalog_(data){
  return data.rows.map(function(values){var row={imageUrl:'',imageUrls:[],primaryImageIndex:0,imageUpdateTime:''};data.fields.forEach(function(key,i){row[key]=values[i];});row.id=row.productCode;return row;});
}
function getProductCatalogRows_(){
  var version=null,memo=executionReadContext_&&executionReadContext_.catalog;try{version=readCacheVersion_(PRODUCT_CATALOG_SCOPES);}catch(ignored){}
  if(version!==null&&memo&&memo.version===version)return memo.rows;
  var data=cachedReadResult_('product-catalog-v2',PRODUCT_CATALOG_SCOPES,120000,function(){var packed=packProductCatalog_(getAllProducts_({omitImages:true}),true);packed.snapshot=readCacheKey_(JSON.stringify(packed.rows));return packed;});
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
  var searchMode=options.searchMode==null?'':options.searchMode;
  if(!['','sku','barcode'].includes(searchMode))throw new Error('โหมดค้นหาสินค้าไม่ถูกต้อง');
  search=search.trim();
  if(searchMode==='sku'&&search&&!validDocumentId_(search))throw new Error('รหัสสินค้าไม่ถูกต้อง');
  var spec={search:searchMode?search:search.toLowerCase(),filters:normalized,sortCol:sort,sortAsc:options.sortAsc!==false,includeImages:options.includeImages!==false};
  if(searchMode&&search)spec.searchMode=searchMode;
  return spec;
}
function filterProductCatalog_(rows,spec,except){
  var sets=Object.create(null);Object.keys(spec.filters).forEach(function(k){if(k!==except)sets[k]=new Set(spec.filters[k]);});
  var searchable=['productName','productCode','partNumber','barcode','brandName','categoryName','carModel'];
  var result=rows.filter(function(row){
    if(spec.search){
      var match=spec.searchMode ? row[spec.searchMode==='sku'?'productCode':'barcode']===spec.search :
        searchable.some(function(key){return String(row[key]||'').toLowerCase().indexOf(spec.search)>=0;});
      if(!match)return false;
    }
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
function catalogGetProductCatalogPage_(options){
  options=options||{};var spec=productCatalogSpec_(options),size=options.pageSize==null?50:Number(options.pageSize),page=options.page==null?1:Number(options.page);
  if(!Number.isInteger(size)||size<1||size>200||!Number.isInteger(page)||page<1||page>100000)throw new Error('ขนาดหน้าสินค้าไม่ถูกต้อง');
  // Opt-in wire format for new clients. Complex substring/XLFilter queries keep
  // their complete-dataset semantics; ordinary browsing never scans the catalog.
  if(options.cursorMode===true&&(!spec.search||spec.searchMode)&&!Object.keys(spec.filters).length&&(!spec.sortCol||spec.sortCol==='productCode'))return getProductBrowsePage_(options,spec,size,page);
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
  var key='product-browse-v2:'+readCacheKey_(JSON.stringify([spec,size,cursor&&cursor.last,snapshotTime]));
  var response=cachedReadResult_(key,productListScopes_(spec),30000,function(){
    var fields=['Product_Name','Part_Type','Part_Number','Barcode','Barcode_Generated','Brand_ID','Category_ID','Default_Vendor_ID','Zone_ID','Car_IDs','Car_ID','Cost_Price','Selling_Price','Current_Stock','Min_Stock','Status','Has_Image'];
    var q={from:[{collectionId:'Master_Products'}],select:{fields:fields.map(function(f){return {fieldPath:f};})},orderBy:[{field:{fieldPath:'__name__'},direction:spec.sortAsc?'ASCENDING':'DESCENDING'}],limit:size+1};
    if(spec.searchMode==='sku'){
      q.where={fieldFilter:{field:{fieldPath:'__name__'},op:'EQUAL',value:{referenceValue:fsDocPath_('Master_Products',spec.search)}}};
    }else if(spec.searchMode==='barcode'){
      var barcode=spec.search, value={stringValue:barcode}, op='EQUAL';
      // Historical numeric barcodes match the same literal digits. A leading
      // zero is part of the code, so only the string can match in that case.
      if(/^(0|[1-9]\d*)$/.test(barcode)&&Number.isSafeInteger(Number(barcode))){
        op='IN';value={arrayValue:{values:[value,{integerValue:barcode}]}};
      }
      q.where={fieldFilter:{field:{fieldPath:'Barcode'},op:op,value:value}};
    }
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
    return Object.assign(row,{hasImage:productImageStatus_(f),imageUrl:image.primary||urls[primary]||urls[0]||'',imageUrls:urls,primaryImageIndex:primary,imageUpdateTime:image.updateTime||''});
  });
}
function catalogGetProductCatalogFacets_(options,column){
  if(PRODUCT_FILTER_FIELDS.indexOf(column)<0)throw new Error('คอลัมน์สินค้าไม่ถูกต้อง');
  // Match the existing Excel popover: other column filters apply; free text does not.
  var spec=productCatalogSpec_(options);spec.search='';spec.sortCol='';
  delete spec.filters[column];
  return cachedReadResult_('product-facets:'+column+':'+JSON.stringify(spec.filters),PRODUCT_CATALOG_SCOPES,120000,function(){
    var values=new Set();filterProductCatalog_(getProductCatalogRows_(),spec,column).forEach(function(row){var v=row[column];values.add(v==null||v===''?'(ว่าง)':String(v));});
    return {values:Array.from(values),numeric:['costPrice','sellingPrice','currentStock'].indexOf(column)>=0};
  });
}
function catalogGetProductImageBatch_(codes){
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

function catalogGetProductById_(productCode) {
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
        hasImage     : imgState.urls.length > 0,
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
