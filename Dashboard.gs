// Stock dashboard reporting and movement aggregation reads.
var DASHBOARD_YEARS_BACK = 4;

function dashboardRangeStart_(year){year=Number(year)||Number(businessDate_().slice(0,4));return new Date(Date.UTC(year-1,0,1)-7*3600000).toISOString();}

function mapDashboardMovementRow_(row) {
  if (!row || !row.document) return null;
  var f = row.document.fields || {}, ts = parseFirestoreValue_(f.Timestamp);
  if (!ts) return null;
  return {
    id          : row.document.name.split('/').pop(),
    docNo       : parseFirestoreValue_(f.Doc_No) || "",
    billNo      : parseFirestoreValue_(f.Bill_No) || "",
    issueStatus : parseFirestoreValue_(f.Issue_Status) || "active",
    reversal    : parseFirestoreValue_(f.Is_Reversal) === "true",
    billCountDelta: Number(parseFirestoreValue_(f.Bill_Count_Delta)) || 0,
    type        : parseFirestoreValue_(f.Type) || "OUT",
    productCode : parseFirestoreValue_(f.Product_Code) || "",
    productName : parseFirestoreValue_(f.Product_Name) || "",
    qty         : parseFloat(parseFirestoreValue_(f.Qty)) || 0,
    hasQty      : !!f.Qty && parseFirestoreValue_(f.Qty)!=='' && parseFirestoreValue_(f.Qty)!=null && Number.isFinite(Number(parseFirestoreValue_(f.Qty))),
    stockAfter  : parseFloat(parseFirestoreValue_(f.Stock_After)) || 0,
    unitPrice   : parseFloat(parseFirestoreValue_(f.Unit_Price)) || 0,
    costPrice   : f.Cost_Price ? Number(parseFirestoreValue_(f.Cost_Price)) : null,
    hasUnitPrice: !!f.Unit_Price && parseFirestoreValue_(f.Unit_Price)!=='' && parseFirestoreValue_(f.Unit_Price)!=null && Number.isFinite(Number(parseFirestoreValue_(f.Unit_Price))) && Number(parseFirestoreValue_(f.Unit_Price))>=0,
    hasCostPrice: !!f.Cost_Price && parseFirestoreValue_(f.Cost_Price)!=='' && parseFirestoreValue_(f.Cost_Price)!=null && Number.isFinite(Number(parseFirestoreValue_(f.Cost_Price))) && Number(parseFirestoreValue_(f.Cost_Price))>=0,
    committedAt : parseFirestoreValue_(f.Committed_At) || "",
    reason      : parseFirestoreValue_(f.Reason) || "",
    refNo       : parseFirestoreValue_(f.Ref_No) || "",
    note        : parseFirestoreValue_(f.Note) || "",
    user        : parseFirestoreValue_(f.User) || "",
    timestamp   : ts
  };
}

function queryDashboardMovementsRange_(fromIso, toIso, committedCursor, snapshotTime) {
  var field = committedCursor ? "Committed_At" : "Timestamp", filters = [], out = [];
  if (fromIso) {
    var start = committedCursor ? new Date(new Date(fromIso).getTime()-60000).toISOString() : fromIso;
    var value = committedCursor ? {timestampValue:start} : {stringValue:start};
    filters.push({fieldFilter:{field:{fieldPath:field},op:"GREATER_THAN_OR_EQUAL",value:value}});
  }
  if (toIso && !committedCursor) filters.push({fieldFilter:{field:{fieldPath:field},op:"LESS_THAN_OR_EQUAL",value:{stringValue:toIso}}});
  var fields = ['Timestamp','Doc_No','Bill_No','Issue_Status','Is_Reversal','Bill_Count_Delta','Type','Product_Code','Product_Name','Qty','Stock_After','Unit_Price','Cost_Price','Committed_At','Reason','Ref_No','Note','User'];
  var q = {from:[{collectionId:STOCK_MOVEMENT_COLLECTION}],orderBy:[{field:{fieldPath:field},direction:"DESCENDING"}],select:{fields:fields.map(function(name){return {fieldPath:name};})}};
  if (filters.length === 1) q.where=filters[0];
  else if (filters.length) q.where={compositeFilter:{op:"AND",filters:filters}};
  var url="https://firestore.googleapis.com/v1/projects/"+PROJECT_ID+"/databases/(default)/documents:runQuery";
  var body={structuredQuery:q};if(snapshotTime)body.readTime=snapshotTime;
  var res=UrlFetchApp.fetch(url,{method:"post",headers:getAuthHeader_(),payload:JSON.stringify(body),muteHttpExceptions:true});
  if(res.getResponseCode()!==200) throw new Error("โหลดการเคลื่อนไหวไม่สำเร็จ กรุณาลองใหม่");
  var readTime=snapshotTime||"";
  JSON.parse(res.getContentText()).forEach(function(row) {
    if(row.readTime && (!readTime || row.readTime > readTime)) readTime=row.readTime;
    var m=mapDashboardMovementRow_(row); if(m) out.push(m);
  });
  if(!readTime) throw new Error("ไม่พบเวลายืนยันข้อมูลจาก Firestore");
  out.readTime=readTime;
  return out;
}

function buildPoVendorMapForMovements_(movements, includeVendorMap) {
  var refs=[],seen=Object.create(null);(movements||[]).forEach(function(m){if(m.type==='IN'&&m.refNo&&!seen[m.refNo]&&(includeVendorMap!==false||m.costPrice===null)){seen[m.refNo]=true;refs.push(String(m.refNo));}});
  if(!refs.length)return {};
  refs.sort();var records=cachedReadResult_('po-costs:'+JSON.stringify(refs),['Purchase_Orders'],120000,function(){
    var out=Object.create(null);for(var i=0;i<refs.length;i+=100){
      var res=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:batchGet',{method:'post',headers:getAuthHeader_(),muteHttpExceptions:true,payload:JSON.stringify({documents:refs.slice(i,i+100).map(function(id){return fsDocPath_('Purchase_Orders',id);}),mask:{fieldPaths:['Vendor_ID','Items_JSON']}})});
      if(res.getResponseCode()!==200)throw new Error('โหลดข้อมูลใบสั่งซื้อไม่สำเร็จ');
      JSON.parse(res.getContentText()).forEach(function(row){if(!row.found)return;var f=row.found.fields||{},costs=Object.create(null);
        JSON.parse(parseFirestoreValue_(f.Items_JSON)||'[]').forEach(function(it){if(it.costPrice!=null&&isFinite(Number(it.costPrice))&&Number(it.costPrice)>=0)costs[it.productCode]=Number(it.costPrice);});
        out[row.found.name.split('/').pop()]={vendorId:parseFirestoreValue_(f.Vendor_ID)||'',costs:costs};
      });
    }return out;
  });
  movements.forEach(function(m){var record=Object.prototype.hasOwnProperty.call(records,m.refNo)?records[m.refNo]:null;if(m.type==='IN'&&record&&m.costPrice===null&&Object.prototype.hasOwnProperty.call(record.costs,m.productCode))m.costPrice=record.costs[m.productCode];});
  if(includeVendorMap===false)return {};
  var vendors=buildVendorMap_(),out=Object.create(null);Object.keys(records).forEach(function(id){var record=records[id];out[id]=(vendors[record.vendorId]||{}).Vendor_name||record.vendorId;});
  return out;
}

function packDashboardMovements_(movements){
  var fields=['id','docNo','billNo','issueStatus','reversal','billCountDelta','type','productCode','productName','qty','hasQty','stockAfter','unitPrice','costPrice','hasUnitPrice','hasCostPrice','committedAt','reason','refNo','note','user','timestamp'];
  return {movementFormat:1,fields:fields,rows:movements.map(function(m){return fields.map(function(k){return m[k];});})};
}
function dashboardCatalogVersion_(){
  try{if(CacheService.getScriptCache().get(collectionCacheBaseKey_('Master_Products')+'__disabled'))return null;
    return readCacheVersion_(PRODUCT_CATALOG_SCOPES.slice(1))+'|'+(PropertiesService.getScriptProperties().getProperty('cache_structure_products')||'0');
  }catch(ignored){return null;}
}
function dashboardBootstrap_(options){
  options=options||{};var now=new Date(),current=Number(businessDate_().slice(0,4)),year=Number(options.year)||current;
  if(!Number.isInteger(year)||year<current-4||year>current)throw new Error('ปีไม่ถูกต้อง');
  var start=dashboardRangeStart_(year),healthStart=dashboardRangeStart_(current),end=year===current?now.toISOString():new Date(Date.UTC(year+1,0,1)-7*3600000-1).toISOString();
  var snapshot=cachedReadResult_('dashboard-correction-v2:'+current+':'+year,[STOCK_MOVEMENT_COLLECTION],60000,function(){
    var ranges=[{start:start,end:end}];
    if(year<current){if(Date.parse(end)+1>=Date.parse(healthStart))ranges[0].end=now.toISOString();else ranges.push({start:healthStart,end:now.toISOString()});}
    var movements=[],readTime='';ranges.forEach(function(range){var rows=queryDashboardMovementsRange_(range.start,range.end,false,readTime);readTime=readTime||rows.readTime;movements=movements.concat(rows);});
    return {movements:movements,serverTime:readTime,snapshotLoadedAt:Date.parse(readTime)||Date.now()};
  },options.force===true);
  var catalogVersion=dashboardCatalogVersion_(),dataVersion=null;try{dataVersion=readCacheVersion_(PRODUCT_CATALOG_SCOPES);}catch(ignored){}
  var reuse=options.compactCatalog&&clientSectionReusable_(options.catalogSection,dataVersion,PRODUCT_CATALOG_SCOPES,300000);
  var products=reuse?undefined:options.compactCatalog?packProductCatalog_(getProductCatalogRows_()):getAllProducts_();
  if(catalogVersion!==null&&catalogVersion!==dashboardCatalogVersion_())throw new Error('ข้อมูลสินค้าเปลี่ยนระหว่างโหลด กรุณาลองใหม่');
  if(dataVersion!==null&&dataVersion!==readCacheVersion_(PRODUCT_CATALOG_SCOPES))throw new Error('ข้อมูลสินค้าเปลี่ยนระหว่างโหลด กรุณาลองใหม่');
  var catalogExpiry=clientReadExpiry_(PRODUCT_CATALOG_SCOPES,300000),section=reuse?options.catalogSection:dataVersion===null?undefined:{version:dataVersion,loadedAt:Math.min(Date.now(),catalogExpiry-300000)};
  var poVendorMap=buildPoVendorMapForMovements_(snapshot.movements,options.includePoVendorMap);
  return {products:products,catalogSection:section,catalogVersion:catalogVersion,catalogExpiresAt:catalogExpiry,movements:options.compactMovements?packDashboardMovements_(snapshot.movements):snapshot.movements,poVendorMap:poVendorMap,bounded:true,year:year,rangeStart:start,healthRangeStart:healthStart,serverTime:snapshot.serverTime,snapshotLoadedAt:snapshot.snapshotLoadedAt};
}

function dashboardDelta_(sinceIso,options) {
  var since=String(sinceIso||'').trim(),time=Date.parse(since);
  if(!since||since.length>64||isNaN(time)||time>Date.now()+60000||Date.now()-time>900000)return {success:false,fullRefresh:true,message:'กรุณาโหลดข้อมูลล่าสุดเพื่อเริ่มซิงก์ใหม่'};
  options=options||{};
  return cachedReadResult_('dashboard-delta-correction-v2:'+JSON.stringify([since,options.cursor||'',options.catalogVersion,options.catalogExpiresAt,!!options.compactCatalog,options.includePoVendorMap!==false]),PRODUCT_CATALOG_SCOPES.concat([STOCK_MOVEMENT_COLLECTION,'Purchase_Orders']),5000,function(){return getDashboardDeltaUncached_(since,time,options);});
}
function getDashboardDeltaUncached_(since,time,options){
  options=options||{};var page=queryMovementPage_('Committed_At',new Date(time-60000).toISOString(),{pageSize:200,cursor:options.cursor},null);
  var movements=page.docs.map(function(doc){return mapDashboardMovementRow_({document:doc});}).filter(Boolean),codes=[],seen={};
  movements.forEach(function(m){if(m.productCode&&!seen[m.productCode]){seen[m.productCode]=true;codes.push(m.productCode);}});
  if(movements.some(function(m){return m.reversal;}))return {success:true,fullRefresh:true,message:'มีการแก้บิล ต้องตรวจยอดและสถานะทั้งช่วงใหม่'};
  var stocks=getProductStockMap_(codes),productStocks=[];
  Object.keys(stocks).forEach(function(code){var x=stocks[code];productStocks.push({productCode:code,currentStock:x.stock,minStock:x.minStock,costPrice:x.costPrice,sellingPrice:x.sellingPrice});});
  var result={success:true,movements:movements,productStocks:productStocks,poVendorMap:buildPoVendorMapForMovements_(movements,options.includePoVendorMap),serverTime:page.pageInfo.readTime,nextCursor:page.pageInfo.nextCursor,hasMore:page.pageInfo.hasMore};
  var catalogVersion=dashboardCatalogVersion_();
  if(!page.pageInfo.hasMore&&catalogVersion!==null&&Object.prototype.hasOwnProperty.call(options,'catalogVersion')&&(options.catalogVersion!==catalogVersion||Number.isFinite(options.catalogExpiresAt)&&options.catalogExpiresAt<=Date.now())){
    result.products=options.compactCatalog?packProductCatalog_(getProductCatalogRows_()):getAllProducts_();
    if(catalogVersion!==dashboardCatalogVersion_())throw new Error('ข้อมูลสินค้าเปลี่ยนระหว่างซิงก์ กรุณาลองใหม่');result.catalogVersion=catalogVersion;result.catalogExpiresAt=clientReadExpiry_(PRODUCT_CATALOG_SCOPES,300000);
  }
  return result;
}
