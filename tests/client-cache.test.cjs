// Business caches against fake browser/Apps Script services; no production access.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup,plain}=require('./support/services.cjs');
const source=fs.readFileSync('Shared.html','utf8');
function freshness(){
 let now=1000000,reloads=0;const events={};
 const c={Date:{now:()=>now},Number,Math,syyLastReadAt:0,syyReadRevalidate:false,syyViewStart:()=>{},syyDraftStart:()=>{},setTimeout:()=>{},setInterval:()=>{},syyPostParent:()=>{},syyTrustedParentMessage:()=>true,
 document:{hidden:false,addEventListener:()=>{}},window:{addEventListener:(k,f)=>{events[k]=f;}}};c.window.parent=c.window;
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('var syyFreshState=null;'),source.indexOf('function syyApplyProductRows')),c);
 c.syyRegisterFreshness({reload(){reloads++;c.syyDataStarted();}});
 return {c,events,tick(ms){now+=ms;},get reloads(){return reloads;}};
}

test('ordinary page reads block overlapping freshness refreshes and acknowledge the revision actually loaded',()=>{
 const b=freshness(),s=b.c.syyFreshState;s.revision=3;s.dirty=true;b.c.syyDataStarted();b.tick(20000);s.refresh();assert.equal(b.reloads,0);
 b.c.syyDataLoaded();assert.equal(s.busy,false);assert.equal(s.dirty,false);
 b.c.syyDataStarted();s.revision++;b.c.syyDataLoaded();assert.equal(s.dirty,true);
 b.tick(10001);s.refresh();assert.equal(b.reloads,1);assert.equal(s.busy,true);
});

test('elapsed time and clean page activation never reload data; known changes still reconcile without extending source age',()=>{
 const b=freshness(),s=b.c.syyFreshState;b.c.syyDataStarted();b.c.syyDataLoaded(1);assert.equal(s.lastLoaded,1);
 b.tick(3600000);s.refresh();b.events.message({data:{action:'PAGE_ACTIVATED'}});assert.equal(b.reloads,0);
 assert.equal(b.events.focus,undefined);assert.equal(s.lastLoaded,1);
 s.dirty=true;b.events.message({data:{action:'PAGE_ACTIVATED'}});assert.equal(b.reloads,1);
 b.c.syyDataLoaded(1);b.tick(3600000);s.refresh();assert.equal(b.reloads,1);assert.equal(s.lastLoaded,1);
});
function browser(){
 let now=Date.now(),id={owner:'alice',role:'staff'};const calls=[],timers=[],events={},storage={};
 const sessionStorage=new Proxy({getItem:k=>storage[k]||null,setItem:(k,v)=>{storage[k]=v;},removeItem:k=>{delete storage[k];}},{ownKeys:()=>Object.keys(storage),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});
 class Clock extends Date{static now(){return now;}}
 const c={Date:Clock,console,Map,Set,JSON,Math,Number,AUTH_TOKEN:'test-session',WEB_APP_URL:'https://script.invalid/release',location:{origin:'https://frame.invalid',pathname:'/app'},sessionStorage,
  syyIdentity:()=>id,syyFreshState:null,syyTrustedParentMessage:e=>e.trusted===true,syyPostParent:()=>{},syyPostFrame:()=>{},syyUxStatus:()=>{},syyUxLoaded:0,
  swyError:()=>{},esc:x=>x,syyErrorMessage:e=>e.message,setTimeout:fn=>timers.push(fn),document:{addEventListener:()=>{},querySelectorAll:()=>[]},window:{addEventListener:(name,fn)=>{events[name]=fn;}},
  syyCallApiRaw:(fn,args,ok,fail,transport)=>calls.push({fn,args,ok,fail,transport})};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('// Bounded business-data cache.'),source.indexOf('/* UI state is local')),c);
 return {c,calls,storage,events,tick(ms){now+=ms;},flush(){while(timers.length)timers.shift()();},identity(value){id=value;},read(fn,args=[],opts){let value,error;c.callApi(fn,args,x=>value=x,e=>error=e,opts);return {get value(){return value;},get error(){return error;}};},complete(data,version='v1'){const last=calls.at(-1);last.ok({__syyCache:1,data,version});}};
}
test('ten identical reads make one RPC; callbacks receive isolated snapshots',()=>{
 const b=browser(),first=b.read('getBrands');b.complete([{id:'B1',Name:'Honda'}]);first.value[0].Name='unsaved';
 for(let i=0;i<9;i++){const r=b.read('getBrands');b.flush();assert.equal(r.value[0].Name,'Honda');}
 assert.equal(b.calls.length,1);assert.equal(b.c.syyCacheStats.hits,9);
});
test('facets reuse pages/search/sort/self filter but keep other cascading contexts separate',()=>{
 const b=browser();b.read('getProductCatalogFacets',[{page:1,filters:{brandName:['Honda'],partType:['แท้','เทียบ']}},'brandName']);b.complete({values:['Honda','Ford'],numeric:false});
 const r=b.read('getProductCatalogFacets',[{page:9,search:'anything',sortCol:'productName',filters:{partType:['เทียบ','แท้'],brandName:['Ford']}},'brandName']);b.flush();assert.equal(r.value.values.length,2);assert.equal(b.calls.length,1);
 b.read('getProductCatalogFacets',[{filters:{partType:['แท้']}},'brandName']);assert.equal(b.calls.length,2);
});
test('duplicate requests coalesce and version validation never extends the hard data age',()=>{
 const b=browser(),one=b.read('getProductCatalogPage',[{page:1}]),two=b.read('getProductCatalogPage',[{page:1}]);assert.equal(b.calls.length,1);b.complete({products:[{id:'P1'}]});assert.deepEqual(one.value,two.value);
 b.tick(31000);const validated=b.read('getProductCatalogPage',[{page:1}]);assert.equal(b.calls.at(-1).transport.version,'v1');b.calls.at(-1).ok({__syyCache:1,notModified:true,version:'v1'});assert.equal(validated.value.products.length,1);assert.equal(b.c.syyCacheStats.notModified,1);
 b.tick(90000);b.read('getProductCatalogPage',[{page:1}]);assert.equal(b.calls.at(-1).transport.version,null);
});
test('confirmed and uncertain writes invalidate dependent pages, preserving unrelated caches',()=>{
 const b=browser();b.read('getBrands');b.complete([{id:'B1'}]);b.read('getCustomersFull');b.complete([{id:'C1'}]);
 b.c.callApi('saveBrand',[],()=>{});b.calls.at(-1).ok({success:false});b.read('getBrands');b.flush();assert.equal(b.calls.length,3);
 b.c.callApi('saveBrand',[],()=>{});b.calls.at(-1).ok({success:true});b.read('getCustomersFull');b.flush();assert.equal(b.calls.length,4);b.read('getBrands');assert.equal(b.calls.length,5);
 b.complete([{id:'B2'}]);b.c.callApi('saveBrand',[],()=>{},()=>{});b.calls.at(-1).fail({message:'timeout'});b.read('getBrands');assert.equal(b.calls.length,7);
});
test('invalidation while a read is pending rejects the old response instead of republishing it',()=>{
 const b=browser(),r=b.read('getAllProducts');b.c.syyInvalidateReadScopes(['Master_Products'],false);b.complete([{id:'OLD'}]);assert.match(r.error.message,/เปลี่ยนแปลง/);assert.equal(b.c.syyReadCache.size,0);assert.equal(b.c.syyPendingReads.size,0);
});
test('force/explicit refresh and security APIs bypass browser cache; legacy results remain compatible',()=>{
 const b=browser();b.read('getBrands');b.complete([]);b.read('getBrands',[],{fresh:true});assert.equal(b.calls.at(-1).transport.version,null);b.complete([]);
 b.read('getBrands',[],{validate:true});assert.equal(b.calls.at(-1).transport.version,'v1');
 b.read('getAllUsers');assert.equal(b.calls.at(-1).transport,undefined);b.calls.at(-1).ok([{username:'user'}]);b.read('getAllUsers');assert.equal(b.calls.length,5);
 const old=b.read('getZonesFull');b.calls.at(-1).ok([{id:'Z1'}]);assert.equal(old.value[0].id,'Z1');b.read('getZonesFull');assert.equal(b.calls.length,7);
});
test('session persistence is bounded and survives reload, isolates accounts/roles and clears on logout',()=>{
 const b=browser();b.read('getBrands');b.complete([{id:'B1'}]);assert.equal(Object.keys(b.storage).length,1);b.c.syyReadCache.clear();const restored=b.read('getBrands');assert.equal(restored.value,undefined);assert.equal(b.calls.length,2);b.calls.at(-1).ok({__syyCache:1,version:'v1',notModified:true});assert.equal(restored.value[0].id,'B1');
 b.identity({owner:'alice',role:'viewer'});b.read('getBrands');assert.equal(b.calls.length,3);b.complete([{id:'VIEWER'}]);b.c.syyClearReadCache();assert(!Object.keys(b.storage).some(k=>k.includes(':viewer:')));
 b.identity({owner:'bob',role:'staff'});b.read('getBrands');assert.equal(b.calls.length,4);
});
test('quota failure preserves memory cache and cached table bootstrap seeds only supplied complete facets',()=>{
 const b=browser();b.c.sessionStorage.setItem=()=>{throw Error('quota');};b.read('getAllProducts',[{paged:true,includeMasters:true}]);b.complete({products:[],facets:{partType:{values:['แท้','เทียบ'],numeric:false}},facetVersion:'catalog-v1'});
 const f=b.read('getProductCatalogFacets',[{page:2},'partType']);b.flush();assert.equal(f.value.values.length,2);assert.equal(b.calls.length,1);
 b.read('getBrands');b.complete([{id:'B1'}]);b.read('getBrands');b.flush();assert.equal(b.calls.length,2);
});
test('untrusted invalidations are ignored; trusted deltas clear related persisted and memory data',()=>{
 const b=browser();b.read('getBrands');b.complete([]);b.events.message({data:{action:'CACHE_INVALIDATED',scopes:['Master_Brands']}});assert.equal(b.c.syyReadCache.size,1);
 b.events.message({trusted:true,data:{action:'MASTER_DELTA',kind:'brands'}});assert.equal(b.c.syyReadCache.size,0);assert.equal(Object.keys(b.storage).length,0);
});
test('server scopes match client policy; conditional reads run session/role checks and no data reads',()=>{
 const s=setup(),b=browser();for(const name of Object.keys(s.c.API_REGISTRY)){const policy=b.c.syyReadPolicy(name);assert.deepEqual(plain(s.c.clientReadScopes_(name)),policy?plain(policy.scopes):null,name);}
 s.c.getSession_=()=>({username:'viewer',role:'viewer'});let executions=0;s.c.API_FUNCTIONS.getBrands=()=>{executions++;return [{id:'B1'}];};
 const first=s.c.apiGateway('token','getBrands',[],'test',{protocol:1});assert.equal(first.__syyCache,1);assert.equal(executions,1);
 const r=s.c.apiGateway('token','getBrands',[],'test',{protocol:1,version:first.version,loadedAt:Date.now()});assert.equal(r.notModified,true);assert.equal(executions,1);assert.equal(s.calls.length,0);assert.equal(s.commits.length,0);
 s.c.getSession_=()=>null;assert.equal(s.c.apiGateway('token','getBrands',[],'test',{protocol:1,version:first.version,loadedAt:Date.now()}).__authError,true);
 s.c.getSession_=()=>({username:'viewer',role:'viewer'});assert.equal(s.c.apiGateway('token','getStockMovementDetail',[],'test',{protocol:1,version:'0|0|0|0|0|0|0|0',loadedAt:Date.now()}).success,false);
});
test('server force/expired versions execute data worker and document writes change generation',()=>{
 const s=setup();s.c.getSession_=()=>({username:'staff',role:'staff'});let n=0;s.c.API_FUNCTIONS.getBrands=()=>{n++;return [];};const first=s.c.apiGateway('token','getBrands',[],'test',{protocol:1});
 s.c.apiGateway('token','getBrands',[{force:true}],'test',{protocol:1,version:first.version,loadedAt:Date.now()});s.c.apiGateway('token','getBrands',[],'test',{protocol:1,version:first.version,loadedAt:Date.now()-300001});assert.equal(n,3);
 for(const collection of ['Quotations','Master_Tax_Invoice']){const version=s.c.collectionGeneration_(collection);s.c.clearCollectionCache_(collection);assert.notEqual(s.c.collectionGeneration_(collection),version);}
});
test('server facet cache avoids full catalog processing on repeat and invalidates on generation changes',()=>{
 const s=setup();let scans=0;s.c.getProductCatalogRows_=()=>{scans++;return [{brandName:'Honda',partType:'แท้'},{brandName:'Ford',partType:'เทียบ'}];};
 const first=s.c.getProductCatalogFacets_({filters:{partType:['แท้'],brandName:['ignored']}},'brandName');assert.deepEqual(plain(first.values),['Honda']);
 s.c.getProductCatalogFacets_({page:9,search:'unused',filters:{partType:['แท้']}},'brandName');assert.equal(scans,1);s.c.clearCollectionCache_('Master_Products');s.c.getProductCatalogFacets_({filters:{partType:['แท้']}},'brandName');assert.equal(scans,2);
});
test('10,000 compact product rows remain compact in cache and expand into independent complete browser results',()=>{
 const b=browser(),packed={catalogFormat:1,fields:['productCode','productName','sellingPrice','currentStock'],rows:Array.from({length:10000},(_,i)=>['P'+i,'สินค้า '+i,0,i])};
 const first=b.read('getAllProducts',[{compact:true}]);b.complete(packed);assert.equal(first.value.length,10000);assert.equal(first.value[9999].id,'P9999');first.value[0].currentStock=-1;
 const key=b.c.syyReadCache.keys().next().value;assert.equal(JSON.parse(b.c.syyReadCache.get(key).raw).catalogFormat,1);
 const second=b.read('getAllProducts',[{compact:true}]);b.flush();assert.equal(second.value[0].currentStock,0);assert.equal(second.value[9999].currentStock,9999);assert.equal(b.calls.length,1);
});
test('memory entry count and serialized payload remain bounded; malformed stored snapshots fall back to a read',()=>{
 const b=browser();for(let i=0;i<45;i++){b.read('getProductCatalogPage',[{page:i+1}]);b.complete({products:[{id:'P'+i}]});}assert.equal(b.c.syyReadCache.size,40);
 const p=b.c.syyReadPolicy('getProductCatalogPage'),large={text:'x'.repeat(2100000)};for(let i=0;i<4;i++)b.c.syyStoreRead('large'+i,p,large,'v1');let size=0;b.c.syyReadCache.forEach(x=>size+=x.raw.length);assert(size<=6000000);
 b.read('getBrands');b.complete([]);const key=Object.keys(b.storage)[0],bad=JSON.parse(b.storage[key]);bad.raw='malformed';b.storage[key]=JSON.stringify(bad);b.c.syyReadCache.clear();const before=b.calls.length;b.read('getBrands');assert.equal(b.calls.length,before+1);
});

test('authoritative browser refresh evicts related snapshots once, coalesces refreshes and rejects older responses',()=>{
 const b=browser();b.read('getBrands');b.complete([{id:'OLD'}]);b.read('getCustomersFull');b.complete([{id:'C1'}]);
 b.c.syyFreshState={revision:3,dirty:false};const one=b.read('getBrands',[],{authoritative:true}),two=b.read('getBrands',[],{authoritative:true});assert.equal(b.calls.length,3);assert.equal(b.calls.at(-1).transport.refresh,true);assert.equal(b.c.syyFreshState.revision,3);b.complete([{id:'NEW'}],'v2');assert.deepEqual(plain(one.value),[{id:'NEW'}]);assert.deepEqual(one.value,two.value);
 b.read('getCustomersFull');b.flush();assert.equal(b.calls.length,3);assert.equal(b.c.syyCacheStats.authoritative,1);
 const pending=b.read('getBrands',[],{fresh:true});b.read('getBrands',[],{authoritative:true});b.calls.at(-2).ok({__syyCache:1,version:'old',data:[]});assert.match(pending.error.message,/เปลี่ยนแปลง/);
 // Export's fresh flag bypasses browser reuse without invalidating its server snapshot.
 b.read('getProductCatalogPage',[{cursor:'same-snapshot'}],{fresh:true});assert.equal(b.calls.at(-1).transport.refresh,false);
});

test('authoritative refresh reads past warm raw/result caches, is throttled, and cannot bypass role/session/cursor checks',()=>{
 const s=setup();s.seed();s.put('Master_Brands/B1',{Brand_Name:'Original'});s.c.getSession_=()=>({username:'viewer',role:'viewer'});
 const read=(name,args=[],meta={protocol:1})=>s.c.apiGateway('token',name,args,'fixture',meta);
 assert.equal(read('getBrands').data[0].Name,'Original');s.put('Master_Brands/B1',{Brand_Name:'External'});assert.equal(read('getBrands').data[0].Name,'Original');
 const refresh={protocol:1,refresh:true};assert.equal(read('getBrands',[],refresh).data[0].Name,'External');assert.equal(s.c.executionReadContext_,null);
 const version=s.c.collectionGeneration_('Master_Products'),before=s.calls.length;assert.equal(read('getStockMovementDetail',['SI1'],refresh).success,false);assert.equal(s.calls.length,before);assert.equal(s.c.collectionGeneration_('Master_Products'),version);
 assert.equal(read('getProductCatalogPage',[{cursor:'bad'}],refresh).success,false);assert.equal(s.c.collectionGeneration_('Master_Products'),version);
 read('getBrands',[],refresh);read('getBrands',[],refresh);const count=s.calls.length;assert.equal(read('getBrands',[],refresh).readLimited,true);assert.equal(s.calls.length,count);
 s.c.getSession_=()=>null;assert.equal(read('getBrands',[],refresh).__authError,true);assert.equal(s.commits.length,0);
});

test('gateway memo reuses raw documents and catalog inside one request, but never across invalidation or another request',()=>{
 const s=setup();s.seed();s.c.getSession_=()=>({username:'staff',role:'staff'});let same=false;
 s.c.API_FUNCTIONS.getAllProducts=()=>{const first=s.c.getProductCatalogRows_(),second=s.c.getProductCatalogRows_();same=first===second;const masters=s.c.getAllMasterDropdowns_();return {products:s.c.packProductCatalog_(second),masters};};
 const r=s.c.apiGateway('token','getAllProducts',[],'fixture',{protocol:1,refresh:true});assert(r.data);assert(same);assert.equal(s.calls.filter(x=>/\/Master_Products\?/.test(x.url)).length,1);assert.equal(s.calls.filter(x=>/\/Master_Vendors\?/.test(x.url)).length,1);assert.equal(s.c.executionReadContext_,null);
 s.c.executionReadContext_={collections:Object.create(null),refreshScopes:[],catalog:null};const first=s.c.getProductCatalogRows_();s.put('Master_Products/P1',{Product_Name:'Changed',Current_Stock:9});s.c.clearCollectionCache_('Master_Products');const second=s.c.getProductCatalogRows_();assert.notEqual(first,second);assert.equal(second[0].productName,'Changed');s.c.executionReadContext_=null;assert.equal(s.commits.length,0);
});

test('external writes age out of server collection caches within bounded TTL without changing DB',()=>{
 const s=setup();let now=Date.now();s.c.Date=class extends Date{constructor(...args){super(args.length?args[0]:now);}static now(){return now;}};
 for(const [collection,ttl] of [['Master_Products',300],['Master_Customers',600],['Product_Images',600],['Master_Brands',900]]){
  s.put(collection+'/A',{Name:'Original'});assert.equal(s.c.cacheTtlForCollection_(collection),ttl);s.c.fetchCollectionDocsCached_(collection);s.put(collection+'/A',{Name:'External'});
  assert.equal(s.c.parseFirestoreValue_(s.c.fetchCollectionDocsCached_(collection)[0].fields.Name),'Original');now+=ttl*1000+1;assert.equal(s.c.parseFirestoreValue_(s.c.fetchCollectionDocsCached_(collection)[0].fields.Name),'External');
 }
 assert.equal(s.commits.length,0);
});

test('document sections omit unchanged catalog/customers, retain original age and refresh only changed or expired sections',()=>{
 const s=setup();s.seed();s.put('Master_Customers/C1',{Customer_Name:'Original'});let now=Date.now();s.c.Date=class extends Date{static now(){return now;}};
 for(const [page,collection] of [['getQuotationPageData_','Quotations'],['getTaxInvoicePageData_','Master_Tax_Invoice']]){
  const list=page==='getQuotationPageData_'?'getQuotationListData_':'getTaxInvoiceListData_';s.c[list]=()=>({[collection==='Quotations'?'quotations':'invoices']:[]});
  const first=s.c[page](2569,{compactCatalog:true}),n=s.calls.length;const repeat=s.c[page](2569,{compactCatalog:true,sectionVersions:first.sectionVersions});assert.equal(repeat.products,undefined);assert.equal(repeat.customers,undefined);assert.deepEqual(plain(repeat.sectionVersions),plain(first.sectionVersions));assert.equal(s.calls.length,n);
  s.put('Master_Customers/C1',{Customer_Name:'Updated'});s.c.clearCollectionCache_('Master_Customers');const changed=s.c[page](2569,{compactCatalog:true,sectionVersions:first.sectionVersions});assert.equal(changed.products,undefined);assert.equal(changed.customers[0].Customer_Name,'Updated');
  now+=300001;const expired=s.c[page](2569,{compactCatalog:true,sectionVersions:changed.sectionVersions});assert(expired.products);assert.equal(expired.customers,undefined);assert(expired.sectionVersions.products.loadedAt>changed.sectionVersions.products.loadedAt);
  const legacy=s.c[page](2569,{});assert(Array.isArray(legacy.products));assert(Array.isArray(legacy.customers));
 }
 assert.equal(s.commits.length,0);
});

test('document-year metadata reuses one read, invalidates after year updates and never caches a failed response',()=>{
 const s=setup();for(const [getter,updater,id] of [['getQuotationAvailableYears_','updateQuotationYearsMeta_','quotation_years'],['getTaxInvoiceAvailableYears_','updateTaxInvoiceYearsMeta_','tax_invoice_years']]){
  s.put('Meta_Counters/'+id,{Years:[2569]});const before=s.calls.length;for(let i=0;i<5;i++)assert.deepEqual(plain(s.c[getter]()),[2569]);assert.equal(s.calls.length-before,1);
  s.c[updater](2570);assert.deepEqual(plain(s.c[getter]()),[2570,2569]);s.c.clearCollectionCache_(id==='quotation_years'?'Quotations':'Master_Tax_Invoice');s.c.failRequest=url=>url.includes(id)?503:0;assert.throws(()=>s.c[getter](),/ปีเอกสาร/);s.c.failRequest=null;assert.deepEqual(plain(s.c[getter]()),[2570,2569]);
 }
 assert.equal(s.docs.size,2);
});

test('catalog page/filter/sort cache is shared across pages, and invalidation recomputes the global result',()=>{
 const s=setup();for(let i=0;i<100;i++)s.put('Master_Products/P'+i,{Product_Name:'Part '+i,Current_Stock:i});let sorts=0;const filter=s.c.filterProductCatalog_;s.c.filterProductCatalog_=(...args)=>{sorts++;return filter(...args);};
 const first=s.c.getProductCatalogPage_({pageSize:25,sortCol:'currentStock',sortAsc:false});const second=s.c.getProductCatalogPage_({page:2,pageSize:25,sortCol:'currentStock',sortAsc:false});assert.equal(sorts,1);assert.equal(first.products[0].currentStock,99);assert.equal(second.products[0].currentStock,74);
 s.put('Master_Products/P0',{Product_Name:'Newest',Current_Stock:200});s.c.clearCollectionCache_('Master_Products');assert.equal(s.c.getProductCatalogPage_({pageSize:25,sortCol:'currentStock',sortAsc:false}).products[0].productCode,'P0');assert.equal(sorts,2);assert.equal(s.commits.length,0);
});

test('dashboard delta sends catalog only for structural changes and transient metadata stays out of Backup',()=>{
 const s=setup();s.seed();s.c.readTime=new Date().toISOString();s.c.getAllProducts_=()=>[{productCode:'P1',productName:'Original'}];const version=s.c.dashboardCatalogVersion_();s.c.invalidateCollectionCache_('Master_Products',true);
 let delta=s.c.getDashboardDelta_(new Date(Date.now()-60000).toISOString(),{catalogVersion:version});assert.equal(delta.products,undefined);assert.equal(s.c.dashboardCatalogVersion_(),version);
 const aged=s.c.getDashboardDelta_(new Date(Date.now()-60000).toISOString(),{catalogVersion:version,catalogExpiresAt:Date.now()-1});assert.equal(aged.products[0].productCode,'P1');assert(aged.catalogExpiresAt>Date.now());
 s.c.clearCollectionCache_('Master_Products');delta=s.c.getDashboardDelta_(new Date(Date.now()-60000).toISOString(),{catalogVersion:version});assert.equal(delta.products[0].productCode,'P1');assert.notEqual(delta.catalogVersion,version);assert.equal(s.c.backupScriptProperties_().cache_structure_products,undefined);assert.equal(s.commits.length,0);
});

test('identical Dashboard deltas share a five-second result and committed changes invalidate it',()=>{
 const s=setup();s.c.readTime=new Date().toISOString();const since=new Date(Date.now()-60000).toISOString();for(let i=0;i<10;i++)s.c.getDashboardDelta_(since);
 assert.equal(s.calls.filter(x=>x.url.endsWith(':runQuery')).length,1);s.c.clearCollectionCache_('Stock_Movements');s.c.getDashboardDelta_(since);assert.equal(s.calls.filter(x=>x.url.endsWith(':runQuery')).length,2);assert.equal(s.commits.length,0);
});

test('a derived catalog cannot extend an almost-expired raw snapshot after an external write',()=>{
 const s=setup();let now=Date.now();s.c.Date=class extends Date{constructor(...args){super(args.length?args[0]:now);}static now(){return now;}};s.seed();s.c.fetchCollectionDocsCached_('Master_Products');now+=299000;
 assert.equal(s.c.getProductCatalogRows_()[0].productName,'Part');s.put('Master_Products/P1',{Product_Name:'External update',Current_Stock:7});now+=2000;
 assert.equal(s.c.getProductCatalogRows_()[0].productName,'External update');assert.equal(s.commits.length,0);
});

test('browser page cache expires with its retained document section instead of extending old section data',()=>{
 const b=browser();b.read('getQuotationPageData');b.complete({quotations:[],sectionVersions:{products:{version:'p1',loadedAt:b.c.Date.now()-299000}}});b.tick(2000);b.read('getQuotationPageData');assert.equal(b.calls.length,2);assert.equal(b.calls.at(-1).transport.version,null);
});

test('server and browser conditional caches cannot extend source expiry even when external writes leave generations unchanged',()=>{
 const s=setup();let now=Date.now();s.c.Date=class extends Date{constructor(...args){super(args.length?args[0]:now);}static now(){return now;}};s.c.getSession_=()=>({username:'staff',role:'staff'});s.put('Master_Brands/B1',{Brand_Name:'Original'});
 s.c.getBrands_();now+=899000;const response=s.c.apiGateway('token','getBrands',[],'fixture',{protocol:1});assert.equal(response.expiresAt,now+1000);s.put('Master_Brands/B1',{Brand_Name:'External'});now+=2000;
 const fresh=s.c.apiGateway('token','getBrands',[],'fixture',{protocol:1,version:response.version,loadedAt:now-2000});assert.equal(fresh.notModified,undefined);assert.equal(fresh.data[0].Name,'External');assert.equal(s.commits.length,0);
 const b=browser();b.read('getBrands');b.calls.at(-1).ok({__syyCache:1,version:'same',data:[],expiresAt:b.c.Date.now()+1000});b.tick(2000);b.read('getBrands');assert.equal(b.calls.length,2);assert.equal(b.calls.at(-1).transport.version,null);
});

test('read metrics count actual coalesced RPCs and elapsed time without recording arguments or cached hits as requests',()=>{
 const b=browser();b.read('getBrands');b.read('getBrands');b.tick(25);b.complete([]);b.read('getBrands');b.flush();assert.deepEqual(plain(b.c.syyCacheStats.byApi.getBrands),{rpcCount:1,errorCount:0,totalMs:25,maxMs:25,lastMs:25});
 b.read('getBrands',[],{fresh:true});b.tick(10);b.calls.at(-1).fail({message:'network'});assert.equal(b.c.syyCacheStats.byApi.getBrands.rpcCount,2);assert.equal(b.c.syyCacheStats.byApi.getBrands.errorCount,1);assert.equal(b.c.syyCacheStats.byApi.getBrands.totalMs,35);assert.equal(b.c.syyCacheStats.hits,1);
});

test('changing token or role without starting another read still rejects pending and scheduled cached responses',()=>{
 const b=browser(),pending=b.read('getBrands');b.c.AUTH_TOKEN='new-session';b.complete([{id:'OLD'}]);assert.match(pending.error.message,/เปลี่ยนแปลง/);assert.equal(b.c.syyReadCache.size,0);
 b.read('getBrands');b.complete([{id:'NEW'}]);const scheduled=b.read('getBrands');b.identity({owner:'alice',role:'viewer'});b.flush();assert.match(scheduled.error.message,/เปลี่ยนแปลง/);assert.equal(b.c.syyReadCache.size,0);
});

