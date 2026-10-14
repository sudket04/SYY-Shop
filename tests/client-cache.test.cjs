// Business caches against fake browser/Apps Script services; no production access.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup,plain}=require('./support/services.cjs');
const source=fs.readFileSync('Shared.html','utf8');
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
 const b=browser();b.read('getBrands');b.complete([{id:'B1'}]);assert.equal(Object.keys(b.storage).length,1);b.c.syyReadCache.clear();const restored=b.read('getBrands');b.flush();assert.equal(restored.value[0].id,'B1');assert.equal(b.calls.length,1);
 b.identity({owner:'alice',role:'viewer'});b.read('getBrands');assert.equal(b.calls.length,2);b.complete([{id:'VIEWER'}]);b.c.syyClearReadCache();assert(!Object.keys(b.storage).some(k=>k.includes(':viewer:')));
 b.identity({owner:'bob',role:'staff'});b.read('getBrands');assert.equal(b.calls.length,3);
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

