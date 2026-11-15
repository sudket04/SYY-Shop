// Shared Firestore snapshots, read leases and cache invalidation.
var CACHE_TTL_SECONDS = 21600;
var CACHEABLE_COLLECTIONS = [
  "Master_Brands", "Master_Categories", "Master_Vendors", "Master_Zones", "Master_Cars",
  "Master_Customers", "Master_Products", "Product_Images", "Master_Users"
];
var CACHE_CHUNK_MAX_BYTES = 80000;

function cacheTtlForCollection_(collectionName) {
  if (collectionName === "Master_Products") return 300;
  if (collectionName === "Product_Images" || collectionName === "Master_Customers") return 600;
  if (collectionName !== "Master_Users") return Math.min(CACHE_TTL_SECONDS,900);
  return CACHE_TTL_SECONDS;
}
// Execution-local reuse never survives a request or bypasses a generation change.
var executionReadContext_ = null;

function collectionCacheBaseKey_(collectionName) {return 'docs_v4_'+collectionName;}

function splitCollectionCacheChunks_(docs) {
  docs = docs || [];
  if (!docs.length) return ["[]"];
  var chunks = [], parts = [], bytes = 2; // [ ]
  for (var i = 0; i < docs.length; i++) {
    var piece = JSON.stringify(docs[i]);
    var pieceBytes = Utilities.newBlob(piece).getBytes().length;
    if (pieceBytes + 2 > 95000) return null; // single document too large for CacheService
    var separatorBytes = parts.length ? 1 : 0;
    if (parts.length && bytes + separatorBytes + pieceBytes > CACHE_CHUNK_MAX_BYTES) {
      chunks.push("[" + parts.join(",") + "]");
      parts = []; bytes = 2; separatorBytes = 0;
    }
    parts.push(piece);
    bytes += separatorBytes + pieceBytes;
  }
  if (parts.length) chunks.push("[" + parts.join(",") + "]");
  return chunks;
}

function readCollectionCache_(collectionName) {
  if(CACHEABLE_COLLECTIONS.indexOf(collectionName)<0)return null;
  try {
    var generation=collectionGeneration_(collectionName),cache=CacheService.getScriptCache(),base=collectionCacheBaseKey_(collectionName);
    if(executionReadContext_&&executionReadContext_.refreshScopes.indexOf(collectionName)>=0&&!executionReadContext_.collections[collectionName])return null;
    if(cache.get(base+'__disabled'))return null;
    var memo=executionReadContext_&&executionReadContext_.collections[collectionName];
    if(memo&&memo.generation===generation&&memo.expiresAt>Date.now())return memo.docs;
    var raw=cache.get(base+'__manifest');if(!raw)return null;
    var manifest=JSON.parse(raw);if(manifest.generation!==generation || !manifest.id || manifest.count<1 || manifest.count>=500 || manifest.expiresAt&&manifest.expiresAt<=Date.now())return null;
    var keys=[];for(var i=0;i<manifest.count;i++)keys.push(base+'__'+manifest.id+'__'+i);
    var chunks=cache.getAll(keys),docs=[];
    for(var j=0;j<keys.length;j++){if(!chunks[keys[j]])return null;docs=docs.concat(JSON.parse(chunks[keys[j]]));}
    if(collectionGeneration_(collectionName)!==generation)return null;
    if(executionReadContext_)executionReadContext_.collections[collectionName]={generation:generation,expiresAt:manifest.expiresAt||Date.now()+1000,docs:docs};
    return docs;
  }catch(e){return null;}
}

function writeCollectionCache_(collectionName,docs,expectedGeneration,expiresAt) {
  if(CACHEABLE_COLLECTIONS.indexOf(collectionName)<0)return false;
  try {
    var generation=expectedGeneration===undefined?collectionGeneration_(collectionName):expectedGeneration;
    var chunks=splitCollectionCacheChunks_(docs||[]);if(!chunks || chunks.length>=500 || collectionGeneration_(collectionName)!==generation)return false;
    var cache=CacheService.getScriptCache(),base=collectionCacheBaseKey_(collectionName),id=Utilities.getUuid(),values={},ttl=cacheTtlForCollection_(collectionName);
    expiresAt=expiresAt||Date.now()+ttl*1000;ttl=Math.min(ttl,Math.floor((expiresAt-Date.now())/1000));if(ttl<1)return false;
    if(cache.get(base+'__disabled'))return false;chunks.forEach(function(chunk,i){values[base+'__'+id+'__'+i]=chunk;});
    cache.putAll(values,ttl);
    if(cache.get(base+'__disabled')||collectionGeneration_(collectionName)!==generation)return false;
    cache.put(base+'__manifest',JSON.stringify({generation:generation,id:id,count:chunks.length,expiresAt:expiresAt}),ttl);
    if(executionReadContext_&&collectionGeneration_(collectionName)===generation)executionReadContext_.collections[collectionName]={generation:generation,expiresAt:expiresAt,docs:docs};
    return !cache.get(base+'__disabled')&&collectionGeneration_(collectionName)===generation;
  }catch(e){return false;}
}

function peekCollectionDocsCache_(collectionName) {
  return readCollectionCache_(collectionName);
}

function queryByEqualityField_(collectionName, fieldPath, value, limit, operator) {
  var docs = [];
  try {
    var query = {
      structuredQuery: {
        from  : [{ collectionId: collectionName }],
        where : { fieldFilter: { field: { fieldPath: fieldPath }, op: operator||"EQUAL", value: { stringValue: String(value) } } },
        limit : limit||10
      }
    };
    var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents:runQuery";
    var res = UrlFetchApp.fetch(url, {
      method: "post", headers: getAuthHeader_(), payload: JSON.stringify(query), muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) throw new Error("โหลดข้อมูลไม่สำเร็จ (" + res.getResponseCode() + ")");
    if (res.getResponseCode() === 200) {
      (JSON.parse(res.getContentText()) || []).forEach(function(row) {
        if (row.document) docs.push({ id: row.document.name.split('/').pop(), fields: row.document.fields || {},updateTime:row.document.updateTime||"" });
      });
    } else {
      console.error("queryByEqualityField_ " + collectionName + "." + fieldPath + " HTTP " + res.getResponseCode());
    }
  } catch (e) { console.error("queryByEqualityField_ read failed", e); throw e; }
  return docs;
}

function fetchAllPagesRaw_(collectionName, firstPageJson) {
  var docs = [], pageToken = "", guard = 0, json = firstPageJson || null;
  try {
    do {
      if (!json) {
        var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
                + "/databases/(default)/documents/" + collectionName + "?pageSize=1000"
                + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
        var res = UrlFetchApp.fetch(url, { method: "get", headers: getAuthHeader_(), muteHttpExceptions: true });
        if (res.getResponseCode() !== 200) {
          console.error("fetchAllPagesRaw " + collectionName + " HTTP " + res.getResponseCode());
          return { ok: false, docs: [] };
        }
        json = JSON.parse(res.getContentText());
      }
      (json.documents || []).forEach(function(doc) {
        docs.push({ id: doc.name.split('/').pop(), fields: doc.fields || {}, updateTime:doc.updateTime || "" });
      });
      pageToken = json.nextPageToken || "";
      json = null;
      guard++;
    } while (pageToken && guard < 50);
  } catch (e) {
    console.error("fetchAllPagesRaw error:", e);
    return { ok: false, docs: [] };
  }
  return { ok: !pageToken, docs: pageToken ? [] : docs };
}

function fetchCollectionsParallel_(collectionNames) {
  return withReadLease_('collections:'+collectionNames.slice().sort().join(','),function(){
    var result={};for(var i=0;i<collectionNames.length;i++){var value=readCollectionCache_(collectionNames[i]);if(value===null)return null;result[collectionNames[i]]=value;}return result;
  },function(){return fetchCollectionsParallelUncached_(collectionNames);});
}

function fetchCollectionsParallelUncached_(collectionNames) {
  var result = {}, toFetch = [], requests = [], generations = {};
  collectionNames.forEach(function(name) {
    var cached = readCollectionCache_(name);
    if (cached !== null) { result[name] = cached; return; }
    generations[name]=collectionGeneration_(name);
    toFetch.push(name);
    requests.push({
      url: "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID
         + "/databases/(default)/documents/" + name + "?pageSize=1000",
      method: "get", headers: getAuthHeader_(), muteHttpExceptions: true
    });
  });
  if (!requests.length) return result;
  try {
    var responses = UrlFetchApp.fetchAll(requests);
    responses.forEach(function(res, i) {
      var name = toFetch[i];
      if (res.getResponseCode() !== 200) throw new Error("โหลด " + name + " ไม่สำเร็จ");
      var first = JSON.parse(res.getContentText());
      // ใช้ first page เดิมต่อทันที ไม่อ่าน 300 docs หน้าแรกซ้ำเมื่อมี pagination
      var fetched = fetchAllPagesRaw_(name, first);
      if (!fetched.ok) throw new Error("โหลด " + name + " ไม่ครบ");
      if(collectionGeneration_(name)!==generations[name]){result[name]=fetchCollectionDocsCached_(name);return;}
      var docs = fetched.docs;
      result[name] = docs;
      if (fetched.ok) writeCollectionCache_(name, docs, generations[name]);
      if(collectionGeneration_(name)!==generations[name])result[name]=fetchCollectionDocsCached_(name);
    });
  } catch (e) {
    console.error("fetchCollectionsParallel error:", e);
    throw e;
  }
  return result;
}

function fetchCollectionDocsCached_(collectionName) {
  return withReadLease_('collection:'+collectionName,function(){return readCollectionCache_(collectionName);},function(){return fetchCollectionDocsUncached_(collectionName);});
}

function fetchCollectionDocsUncached_(collectionName) {
  for(var attempt=0;attempt<2;attempt++){
    var generation=collectionGeneration_(collectionName),fetched=fetchAllPagesRaw_(collectionName);
    if(!fetched.ok)throw new Error('โหลด '+collectionName+' ไม่สำเร็จ กรุณาลองใหม่');
    if(collectionGeneration_(collectionName)!==generation)continue;
    writeCollectionCache_(collectionName,fetched.docs,generation);
    if(collectionGeneration_(collectionName)===generation)return fetched.docs;
  }
  throw new Error('ข้อมูลกำลังเปลี่ยนแปลง กรุณารีเฟรชอีกครั้ง');
}

function clearCollectionCache_(collectionName, lockHeld){
 try{
  if(collectionName==='Master_Products')PropertiesService.getScriptProperties().setProperty('cache_structure_products',Utilities.getUuid());
  if(lockHeld===true)return invalidateCollectionCache_(collectionName,true);
  return withCacheGuard_(function(){return invalidateCollectionCache_(collectionName,true);},function(){return invalidateCollectionCache_(collectionName,false);});
 }
 catch(e){try{PropertiesService.getScriptProperties().setProperty('cache_gen_'+collectionName,Utilities.getUuid());}catch(ignored){}return false;}
}
function invalidateCollectionCache_(collectionName,canEnable){
 if(CACHEABLE_COLLECTIONS.indexOf(collectionName)<0 && ['Purchase_Orders','Stock_Movements','Quotations','Master_Tax_Invoice'].indexOf(collectionName)<0)return true;
 var cache=CacheService.getScriptCache(),base=collectionCacheBaseKey_(collectionName),disabled=base+'__disabled';
 try{cache.put(disabled,'1',21600);}catch(e){}
 var changed=false;try{PropertiesService.getScriptProperties().setProperty('cache_gen_'+collectionName,Utilities.getUuid());changed=true;}catch(e){console.error('Cache generation unavailable; bypass collection cache',collectionName);}
 try{var raw=cache.get(base+'__manifest'),keys=[base,base+'__manifest'];if(raw){var m=JSON.parse(raw);for(var i=0;i<m.count&&i<500;i++)keys.push(base+'__'+m.id+'__'+i);}cache.removeAll(keys);if(changed&&canEnable)cache.remove(disabled);}catch(e){}
 // Business write already succeeded; never tell the caller to repeat it after a cache failure.
 return changed;
}

// Locks cover cache metadata only. Firestore reads never hold this cache lock.
function withCacheGuard_(worker,fallback){
 if(referenceMutationLocked_)return worker();
 var lock=LockService.getScriptLock();if(!lock.tryLock(250))return fallback();
 try{return worker();}finally{lock.releaseLock();}
}
function readCacheKey_(key){return 'read_v2_'+Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,PROJECT_ID+':'+String(key)));}
function readCacheVersion_(scopes){
 var cache=CacheService.getScriptCache();return scopes.map(function(name){if(cache.get(collectionCacheBaseKey_(name)+'__disabled'))throw new Error('Cache bypass');return collectionGeneration_(name);}).join('|');
}
function readResultCache_(key,scopes,maxAge){
 try{
  var version=readCacheVersion_(scopes),cache=CacheService.getScriptCache(),base=readCacheKey_(key),raw=cache.get(base);
  if(!raw)return null;var m=JSON.parse(raw);if(m.version!==version||m.expiresAt<=Date.now()||Date.now()-m.createdAt>=maxAge||m.count<1||m.count>(key==='product-catalog-v2'?200:60))return null;
  var keys=[];for(var i=0;i<m.count;i++)keys.push(base+'_'+m.id+'_'+i);var parts=cache.getAll(keys),text='';
  for(var j=0;j<keys.length;j++){if(typeof parts[keys[j]]!=='string')return null;text+=parts[keys[j]];}
  if(m.encoding==='gzip')text=Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(text))).getDataAsString();
  else if(m.encoding) return null;
  return readCacheVersion_(scopes)===version?JSON.parse(text):null;
 }catch(e){return null;}
}
function writeResultCache_(key,scopes,value,maxAge,version,createdAt){
 try{
  if(readCacheVersion_(scopes)!==version)return;
  var text=JSON.stringify(value),encoding='',limit=key==='product-catalog-v2'?200:60;
  if(text.length>16000*limit){text=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(text)).getBytes());encoding='gzip';}
  var count=Math.ceil(text.length/16000);if(count>limit)return;
  var cache=CacheService.getScriptCache(),base=readCacheKey_(key),id=Utilities.getUuid(),parts={},expiresAt=createdAt+maxAge;
  var sourceKeys=scopes.filter(function(s){return CACHEABLE_COLLECTIONS.indexOf(s)>=0;}).map(function(s){return collectionCacheBaseKey_(s)+'__manifest';}),sources=cache.getAll(sourceKeys);
  sourceKeys.forEach(function(k){if(sources[k]){var source=JSON.parse(sources[k]);if(Number.isFinite(source.expiresAt))expiresAt=Math.min(expiresAt,source.expiresAt);}});
  var ttl=Math.floor((expiresAt-Date.now())/1000);if(ttl<1)return;
  for(var i=0;i<count;i++)parts[base+'_'+id+'_'+i]=text.slice(i*16000,(i+1)*16000);
  cache.putAll(parts,ttl);if(readCacheVersion_(scopes)!==version)return;
  cache.put(base,JSON.stringify({version:version,id:id,count:count,encoding:encoding,createdAt:createdAt,expiresAt:expiresAt}),ttl);
 }catch(e){} // An unavailable/evicted cache must not fail a successful read.
}
function withReadLease_(key,read,worker){
 var cached=read();if(cached!==null)return cached;
 var leaseKey=readCacheKey_('lease:'+key),owner=Utilities.getUuid(),claimed=false;
 function claim(){return withCacheGuard_(function(){var cache=CacheService.getScriptCache(),raw=cache.get(leaseKey),lease=raw?JSON.parse(raw):null;if(lease&&lease.until>Date.now())return false;cache.put(leaseKey,JSON.stringify({owner:owner,until:Date.now()+30000}),30);return true;},function(){return false;});}
 try{
  // Wait for a live producer instead of starting another full scan after 900 ms.
  // Bounded waiting releases the execution with a retryable error, never partial data.
  for(var attempt=0;attempt<8;attempt++){
   try{claimed=claim();}catch(e){return worker();} // Cache outage: preserve availability.
   cached=read();if(cached!==null)return cached;
   if(claimed)return worker();
   Utilities.sleep(250);
  }
  var busy=new Error('กำลังเตรียมข้อมูล กรุณารอสักครู่');busy.code='CACHE_BUILDING';throw busy;
 }finally{
  if(claimed)try{withCacheGuard_(function(){var cache=CacheService.getScriptCache(),raw=cache.get(leaseKey);if(raw&&JSON.parse(raw).owner===owner)cache.remove(leaseKey);},function(){});}catch(e){}
 }
}
function cachedReadResult_(key,scopes,maxAge,worker,force){
 function fresh(){var version=null,started=Date.now();try{version=readCacheVersion_(scopes);}catch(e){}var value=worker();if(version!==null)writeResultCache_(key,scopes,value,maxAge,version,started);return value;}
 if(force||executionReadContext_&&scopes.some(function(s){return executionReadContext_.refreshScopes.indexOf(s)>=0;}))return fresh();
 return withReadLease_('result:'+key,function(){return readResultCache_(key,scopes,maxAge);},fresh);
}

// Patch only after a confirmed commit. Read authoritative raw documents; preserve
// unknown fields and the original cache expiry. Concurrent invalidation wins.
function refreshChangedProductsCache_(codes){
 var captured=null,collection='Master_Products';
 try{
  withCacheGuard_(function(){
   var docs=readCollectionCache_(collection),raw=CacheService.getScriptCache().get(collectionCacheBaseKey_(collection)+'__manifest'),manifest=raw?JSON.parse(raw):null;
   if(invalidateCollectionCache_(collection,true)&&docs!==null&&manifest&&manifest.expiresAt>Date.now())captured={docs:docs,expiresAt:manifest.expiresAt,generation:collectionGeneration_(collection)};
  },function(){invalidateCollectionCache_(collection,false);});
  if(!captured)return;
  var unique=Object.keys((codes||[]).reduce(function(out,code){if(validDocumentId_(String(code)))out[code]=true;return out;},Object.create(null))),fresh=Object.create(null);
  if(!unique.length)return;
  for(var i=0;i<unique.length;i+=100){
   var res=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+'/databases/(default)/documents:batchGet',{method:'post',headers:getAuthHeader_(),muteHttpExceptions:true,payload:JSON.stringify({documents:unique.slice(i,i+100).map(function(id){return fsDocPath_(collection,id);})})});
   if(res.getResponseCode()!==200)return;
   JSON.parse(res.getContentText()).forEach(function(row){if(row.found){var d=row.found;fresh[d.name.split('/').pop()]={id:d.name.split('/').pop(),fields:d.fields||{},updateTime:d.updateTime||''};}else if(row.missing)fresh[row.missing.split('/').pop()]=null;});
  }
  if(unique.some(function(id){return !Object.prototype.hasOwnProperty.call(fresh,id);}))return;
  var existing=Object.create(null);var docs=captured.docs.map(function(d){existing[d.id]=true;return Object.prototype.hasOwnProperty.call(fresh,d.id)?fresh[d.id]:d;}).filter(Boolean);unique.forEach(function(id){if(!existing[id]&&fresh[id])docs.push(fresh[id]);});
  writeCollectionCache_(collection,docs,captured.generation,captured.expiresAt);
 }catch(e){clearCollectionCache_(collection);}
}
