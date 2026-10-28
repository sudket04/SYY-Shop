// Firestore/Apps Script fixtures. No credentials or live database access.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {setup,plain,reply}=require('./support/services.cjs');
function fixture(n=10000){
 const s=setup();s.c.readTime=new Date().toISOString();let returned=0;const fetch=s.c.UrlFetchApp.fetch;
 for(let i=0;i<n;i++)s.put('Master_Products/P'+String(i).padStart(5,'0'),{Product_Name:'Part '+i,Brand_ID:'B1',Current_Stock:i,Part_Type:i%2?'แท้':'เทียบ',Selling_Price:i,Car_ID:'CAR1',Extra_Secret:'never transmit'});
 s.put('Master_Brands/B1',{Brand_Name:'Brand'});s.put('Master_Cars/CAR1',{Brand:'Car',Model:'Model'});
 s.c.UrlFetchApp.fetch=(url,o={})=>{const r=fetch(url,o);if(r.getResponseCode()===200){const body=JSON.parse(r.getContentText());if(url.endsWith(':runQuery'))returned+=body.filter(x=>x.document?.name.includes('/Master_Products/')).length;if(o.method==='get'&&url.includes('/Master_Products?'))returned+=(body.documents||[]).length;}return r;};
 s.count=()=>returned;return s;
}
function page(s,options={}){return s.c.getProductCatalogPage_({cursorMode:true,pageSize:50,...options});}
test('image-free browse, full-catalog filters and legacy image-enabled responses use separate contexts',()=>{
 const s=fixture(121);for(let i=0;i<121;i++)s.put('Product_Images/P'+String(i).padStart(5,'0'),{Image_Url:'https://example.invalid/test.jpg'});
 let r=page(s,{includeImages:false,pageSize:25});assert.equal(r.products.length,25);assert(r.products.every(p=>p.imageDataLoaded===false));assert(!s.calls.some(c=>(c.options.payload||'').includes('/Product_Images/')||c.url.includes('/Product_Images?')));
 assert.throws(()=>page(s,{includeImages:true,pageSize:25,cursor:r.nextCursor||r.pageInfo?.nextCursor}));
 const search=s.c.getProductCatalogPage_({search:'Part 120',pageSize:50,includeImages:false});assert.equal(search.products.length,1);assert.equal(search.products[0].productCode,'P00120');assert(!s.calls.some(c=>(c.options.payload||'').includes('/Product_Images/')||c.url.includes('/Product_Images?')));
 const legacy=page(s,{includeImages:true});assert.equal(legacy.products[0].imageDataLoaded,true);assert.match(legacy.products[0].imageUrl,/test.jpg/);assert.throws(()=>page(s,{includeImages:'false'}));
});
test('oversized server results compress, preserve source age and recover from corrupt/missing chunks',()=>{
 const s=setup(),scopes=['Stock_Movements'],key='dashboard-large-fixture',version=s.c.readCacheVersion_(scopes),created=Date.now(),value={rows:Array.from({length:10000},(_,i)=>({id:'M'+i,note:'รายงาน '.repeat(25)}))};
 assert(JSON.stringify(value).length>960000);s.c.writeResultCache_(key,scopes,value,60000,version,created);const base=s.c.readCacheKey_(key),m=JSON.parse(s.cache.get(base));assert.equal(m.encoding,'gzip');assert.equal(m.createdAt,created);assert.deepEqual(plain(s.c.readResultCache_(key,scopes,60000)),value);s.cache.delete(base+'_'+m.id+'_0');assert.equal(s.c.readResultCache_(key,scopes,60000),null);s.cache.set(base+'_'+m.id+'_0','corrupt');assert.equal(s.c.readResultCache_(key,scopes,60000),null);assert.equal(s.commits.length,0);
});
test('image-only mutation does not invalidate image-free browse cache, rebase its anchor or break filtered continuation',()=>{
 const s=fixture(121),first=page(s,{includeImages:false,pageSize:25}),reads=s.count(),filtered=s.c.getProductCatalogPage_({includeImages:false,search:'Part',pageSize:25});
 s.c.clearCollectionCache_('Product_Images');const before=s.count(),warm=page(s,{includeImages:false,pageSize:25});assert.equal(s.count(),before);assert.deepEqual(plain(warm.products),plain(first.products));const next=page(s,{includeImages:false,pageSize:25,page:2,cursor:first.nextCursor});assert.equal(next.snapshotRebased,false);assert.equal(next.products[0].productCode,'P00025');
 assert.equal(s.c.getProductCatalogPage_({includeImages:false,search:'Part',pageSize:25,cursor:filtered.nextCursor}).products[0].productCode,'P00025');assert(reads<=26);assert.equal(s.commits.length,0);
 const legacy=s.c.getAllProducts_({includeImages:false});assert(legacy.every(p=>p.imageDataLoaded===false));assert.throws(()=>s.c.getAllProducts_({includeImages:'false'}));
});
test('10,000-record cold browse reads 51 product docs instead of 10,000; repeated page is zero additional product reads',()=>{
 const old=fixture(),s=fixture();old.c.getProductCatalogPage_({pageSize:50});const before=old.count(),r=page(s);
 assert.equal(r.products.length,50);assert.equal(r.total,null);assert.equal(r.cursorMode,true);assert.equal(r.products[0].brandName,'Brand');assert.equal(r.products[0].carModel,'Car Model');assert.equal(s.count(),51);page(s);assert.equal(s.count(),51);
 const queries=s.calls.filter(x=>x.url.endsWith(':runQuery')).map(x=>JSON.parse(x.options.payload));assert.equal(queries.length,1);assert.equal(queries[0].structuredQuery.limit,51);assert.equal(queries[0].structuredQuery.offset,undefined);assert(queries[0].structuredQuery.select);assert(!s.calls.some(x=>/\/Master_Products\?/.test(x.url)));
 const reduction=100*(1-s.count()/before);assert.equal(reduction,99.49);fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/hybrid-cache-model.json',JSON.stringify({fixtureOnly:true,records:10000,legacyProductDocuments:before,browseProductDocuments:s.count(),productReadReductionPercent:reduction,writes:s.commits.length,productionMeasurements:false},null,2));
});
test('cursor pagination pins one snapshot, has unique order, respects descending order and never skips an externally inserted/deleted row mid-snapshot',()=>{
 const s=fixture(121);let r=page(s),rows=[...r.products];const time=r.readTime;
 s.put('Master_Products/P00000A',{Product_Name:'Inserted'});s.docs.delete('Master_Products/P00070');
 while(r.hasMore){r=page(s,{page:r.page+1,cursor:r.nextCursor});rows.push(...r.products);assert.equal(r.readTime,time);}
 assert.equal(rows.length,121);assert.equal(new Set(rows.map(x=>x.id)).size,121);assert(rows.some(x=>x.id==='P00070'));assert(!rows.some(x=>x.id==='P00000A'));assert.equal(rows.at(-1).id,'P00120');
 const t=fixture(121);r=page(t,{sortCol:'productCode',sortAsc:false});rows=[...r.products];while(r.hasMore){r=page(t,{sortCol:'productCode',sortAsc:false,page:r.page+1,cursor:r.nextCursor});rows.push(...r.products);}assert.equal(rows[0].id,'P00120');assert.equal(rows.at(-1).id,'P00000');assert.equal(t.commits.length,0);
});
test('five authorized users share one cold query while continuation is bound to account, role, query, size and maximum anchor age',()=>{
 const s=fixture(100);s.c.getSession_=token=>({username:token,role:'viewer'});const responses=[];
 for(let i=0;i<5;i++){const r=s.c.apiGateway('user'+i,'getProductCatalogPage',[{cursorMode:true,pageSize:50}],'fixture');assert.equal(r.products.length,50);responses.push(r);}
 assert.equal(s.count(),51);assert.equal(new Set(responses.map(r=>r.nextCursor)).size,5);
 const cursor=responses[0].nextCursor,opts={cursorMode:true,pageSize:50,page:2,cursor};
 assert.equal(s.c.apiGateway('user1','getProductCatalogPage',[opts],'fixture').success,false);
 s.c.getSession_=()=>({username:'user0',role:'staff'});assert.equal(s.c.apiGateway('user0','getProductCatalogPage',[opts],'fixture').success,false);
 s.c.getSession_=()=>({username:'user0',role:'viewer'});for(const bad of [{...opts,pageSize:25},{...opts,page:3},{...opts,cursor:cursor+'x'}])assert.equal(s.c.apiGateway('user0','getProductCatalogPage',[bad],'fixture').success,false);
 assert.equal(s.c.apiGateway('user0','getProductCatalogPage',[opts],'fixture').products.length,50);
 s.c.clearCollectionCache_('Master_Products');const rebased=s.c.apiGateway('user0','getProductCatalogPage',[opts],'fixture');assert.equal(rebased.page,2);assert.equal(rebased.snapshotRebased,true);
 const expired=JSON.parse(Buffer.from(cursor.split('.')[0],'base64').toString());expired.at=Date.now()-86400001;assert.throws(()=>page(s,{...opts,cursor:s.c.productCatalogCursor_(expired)}));
 assert.equal(s.commits.length,0);
});
test('complete search and facets retain global results beyond visited pages; old clients retain total-count API',()=>{
 const s=fixture(1000);page(s);const r=page(s,{search:'Part 999'});assert.equal(r.products[0].id,'P00999');assert.equal(r.cursorMode,undefined);assert.equal(r.total,1);
 assert.equal(s.c.getProductCatalogFacets_({},'productName').values.length,1000);assert.equal(s.c.getProductCatalogPage_({page:20,pageSize:50}).total,1000);
});
test('references deduplicate IDs, batch fetch with projection for browse only, retain full contact fields for PO and tolerate deleted references',()=>{
 const s=fixture(101);s.put('Master_Vendors/V1',{Vendor_name:'Vendor',Phone:'123',Tax_ID:'456'});
 s.c.readProductReferenceDocs_({Master_Vendors:['V1','V1'],Master_Brands:['B1','B1','MISSING']},true);
 const batches=s.calls.filter(x=>x.url.endsWith(':batchGet')).map(x=>JSON.parse(x.options.payload));assert.equal(batches[0].documents.length,1);assert.deepEqual(batches[0].mask.fieldPaths,['Vendor_name']);
 const full=s.c.readProductReferenceDocs_({Master_Vendors:['V1']});assert.equal(s.c.parseFirestoreValue_(full.Master_Vendors[0].fields.Phone),'123');assert.equal(s.c.parseFirestoreValue_(full.Master_Vendors[0].fields.Tax_ID),'456');
 assert.throws(()=>s.c.readProductReferenceDocs_({Master_Users:['U1']}));assert.throws(()=>s.c.readProductReferenceDocs_({Master_Brands:['../U1']}));
 const fetch=s.c.UrlFetchApp.fetch;s.c.UrlFetchApp.fetch=(url,o)=>url.endsWith(':batchGet')?reply(200,[]):fetch(url,o);assert.throws(()=>s.c.readProductReferenceDocs_({Master_Brands:['B1','B2']},true),/ไม่ครบ/);
});
test('cache outages fall back to bounded REST reads; partial query/image failures never publish a successful empty page',()=>{
 const s=fixture(100);s.c.CacheService.getScriptCache=()=>{throw Error('offline');};assert.equal(page(s).products.length,50);assert.equal(s.count(),51);
 const t=fixture(100);t.c.failRequest=url=>url.endsWith(':runQuery')?503:0;assert.throws(()=>page(t));t.c.failRequest=url=>url.endsWith(':batchGet')?503:0;assert.throws(()=>page(t));assert.equal(t.commits.length,0);
});

test('browse empty state, add/edit/delete invalidation and query failure recovery never resurrect a deleted record',()=>{
 const s=fixture(0);assert.equal(page(s).products.length,0);assert.equal(page(s).hasMore,false);
 s.put('Master_Products/P00001',{Product_Name:'Created'});s.c.clearCollectionCache_('Master_Products');assert.equal(page(s).products[0].productName,'Created');
 s.put('Master_Products/P00001',{Product_Name:'Edited'});s.c.clearCollectionCache_('Master_Products');assert.equal(page(s).products[0].productName,'Edited');
 s.docs.delete('Master_Products/P00001');s.c.clearCollectionCache_('Master_Products');assert.equal(page(s).products.length,0);
 const t=fixture(100),first=page(t);t.c.failRequest=url=>url.endsWith(':runQuery')?503:0;assert.throws(()=>page(t,{page:2,cursor:first.nextCursor}));t.c.failRequest=null;const second=page(t,{page:2,cursor:first.nextCursor});assert.equal(second.products[0].id,'P00050');assert.equal(second.hasMore,false);assert.equal(t.commits.length,0);
});

test('browse result reuse cannot extend its original 30-second expiry in the browser transport envelope',()=>{
 const s=fixture(100);let now=Date.now();s.c.Date=class extends Date{constructor(...args){super(args.length?args[0]:now);}static now(){return now;}};s.c.getSession_=()=>({username:'staff',role:'staff'});
 const first=s.c.apiGateway('token','getProductCatalogPage',[{cursorMode:true}],'fixture',{protocol:1});assert.equal(first.expiresAt,now+30000);const reads=s.count();now+=29000;
 const repeat=s.c.apiGateway('token','getProductCatalogPage',[{cursorMode:true}],'fixture',{protocol:1});assert.equal(repeat.expiresAt,first.expiresAt);assert.equal(s.count(),reads);
});

test('expired/changed browse snapshots resume at the signed anchor with bounded current reads, including deleted anchors and descending order',()=>{
 for(const descending of [false,true]){
  const s=fixture(10000);let now=Date.now();s.c.Date=class extends Date{static now(){return now;}};
  const sort=descending?{sortCol:'productCode',sortAsc:false}:{},first=page(s,sort),anchor=first.products.at(-1).id;
  now+=120001;s.c.readTime=new Date(now).toISOString();
  s.docs.delete('Master_Products/'+anchor);
  const expected=descending?'P09949':'P00050';s.put('Master_Products/'+expected,{Product_Name:'Updated',Current_Stock:999});s.c.clearCollectionCache_('Master_Products');
  const before=s.count(),next=page(s,{...sort,page:2,cursor:first.nextCursor});
  assert.equal(next.page,2);assert.equal(next.snapshotRebased,true);assert.equal(next.products[0].id,expected);assert.equal(next.products[0].currentStock,999);assert.equal(s.count()-before,51);
  const body=JSON.parse(s.calls.filter(x=>x.url.endsWith(':runQuery')).at(-1).options.payload);
  assert.equal(body.readTime,undefined);assert.equal(body.structuredQuery.offset,undefined);assert.equal(body.structuredQuery.limit,51);
  assert.equal(body.structuredQuery.startAt.values[0].referenceValue.split('/').at(-1),anchor);
  const third=page(s,{...sort,page:3,cursor:next.nextCursor});assert.equal(third.snapshotRebased,false);assert.equal(third.readTime,next.readTime);assert.equal(s.commits.length,0);
 }
});

test('background/manual browse refresh retains page and anchor while explicitly renewing a still-valid snapshot',()=>{
 const s=fixture(200),first=page(s);let second=page(s,{page:2,cursor:first.nextCursor});
 s.put('Master_Products/P00050',{Product_Name:'External update',Current_Stock:123});s.c.readTime=new Date(Date.now()+1000).toISOString();
 second=page(s,{page:2,cursor:first.nextCursor,refreshSnapshot:true});
 assert.equal(second.page,2);assert.equal(second.snapshotRebased,true);assert.equal(second.products[0].id,'P00050');assert.equal(second.products[0].currentStock,123);assert.equal(s.commits.length,0);
});

test('manual version validation of a cached later product page verifies signed cursor ownership without any query',()=>{
 const s=fixture(200);s.c.getSession_=token=>({username:token,role:'viewer'});s.c.allowReadRequest_=()=>true;
 const first=s.c.apiGateway('alice','getProductCatalogPage',[{cursorMode:true,pageSize:50}],'fixture',{protocol:1});
 const args=[{cursorMode:true,page:2,pageSize:50,cursor:first.data.nextCursor}],second=s.c.apiGateway('alice','getProductCatalogPage',args,'fixture',{protocol:1});
 const metadata={protocol:1,manual:true,version:second.version,loadedAt:Date.now(),expiresAt:second.expiresAt},count=s.calls.length;
 assert.equal(s.c.apiGateway('alice','getProductCatalogPage',args,'fixture',metadata).notModified,true);assert.equal(s.calls.length,count);
 for(const token of ['bob','alice']){const bad=[{...args[0],...(token==='alice'?{cursor:args[0].cursor+'x'}:{})}];assert.equal(s.c.apiGateway(token,'getProductCatalogPage',bad,'fixture',metadata).success,false);}
 s.c.getSession_=()=>({username:'alice',role:'staff'});assert.equal(s.c.apiGateway('alice','getProductCatalogPage',args,'fixture',metadata).success,false);
 assert.equal(s.calls.length,count);assert.equal(s.commits.length,0);
});
