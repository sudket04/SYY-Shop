// VM/fixtures only: no real Google, Firestore, Drive or authentication requests.
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,plain}=require('./support/services.cjs');
const {evaluateTemplate}=require('./support/templates.cjs');
function authenticated(){const s=setup(),user=s.user();s.token=s.c.createSession_(user).token;return s;}
test('temporary auth read failures fail closed without revoking a valid session or running the worker',()=>{
 for(const status of [429,500,503]){
  const s=authenticated(),before=plain([...s.docs]);let worker=0;s.c.API_FUNCTIONS.getAllProducts=()=>{worker++;return [];};
  s.c.failRequest=url=>url.includes('/Master_Users/')?status:0;
  const result=s.c.apiGateway(s.token,'getAllProducts',[]);
  assert.equal(result.success,false);assert.equal(result.code,'AUTH_UNAVAILABLE');assert.equal(result.__authError,undefined);assert.equal(result.retryable,true);assert.equal(worker,0);assert(s.cache.has('sess_'+s.token));
  assert.deepEqual(plain([...s.docs]),before);assert.equal(s.commits.length,0);
  s.c.failRequest=null;assert.equal(s.c.getSession_(s.token,'',true).username,'admin');
 }
});
test('a deleted, disabled or role-changed user still loses access immediately and never reuses business cache',()=>{
 for(const change of ['deleted','disabled','role']){const s=authenticated();if(change==='deleted')s.docs.delete('Master_Users/U1');else s.docs.get('Master_Users/U1').fields[change==='disabled'?'Status':'Role']={stringValue:change==='disabled'?'Inactive':'viewer'};
  let called=false;s.c.API_FUNCTIONS.getAllProducts=()=>{called=true;return [];};assert.equal(s.c.apiGateway(s.token,'getAllProducts',[]).__authError,true);assert.equal(called,false);assert.equal(s.commits.length,0);
 }
});
test('image V2 auth outages remain transient failures without data or writes',()=>{
 const s=authenticated();s.c.failRequest=url=>url.includes('/Master_Users/')?503:0;const result=s.c.apiGatewayV2(s.token,'getProductImagesV2',['P1']);assert.equal(result.code,'AUTH_UNAVAILABLE');assert.equal(result.__authError,undefined);assert.equal(s.commits.length,0);
});
test('first read blocked by a shared lock reports busy, not a quota violation; explicit retry works',()=>{
 const s=authenticated(),before=plain([...s.docs]);let reached=0;s.c.API_FUNCTIONS.getAllProducts=()=>({success:true,count:++reached});s.c.lockBusy=true;
 const blocked=s.c.apiGateway(s.token,'getAllProducts',[]);assert.equal(blocked.code,'READ_BUSY');assert.equal(blocked.readLimited,undefined);assert.equal(reached,0);assert(!Object.keys(s.props).some(k=>k.startsWith('read_rate_')));
 s.c.lockBusy=false;assert.equal(s.c.apiGateway(s.token,'getAllProducts',[]).count,1);assert.deepEqual(plain([...s.docs]),before);assert.equal(s.commits.length,0);
});
test('actual read-rate exhaustion remains enforced and preserves its retry window',()=>{
 const s=setup();for(let i=0;i<30;i++)assert(s.c.allowReadRequest_('getDashboardBootstrap','viewer'));
 assert.equal(s.c.allowReadRequest_('getDashboardBootstrap','viewer'),false);const result=s.c.readRequestFailure_();assert.equal(result.code,'READ_LIMITED');assert.equal(result.readLimited,true);assert(result.retryAfterMs>0&&result.retryAfterMs<=60000);assert.equal(s.commits.length,0);
});
test('doGet emits a read-only connection status page, validates origin hints and never renders business data on an auth outage',()=>{
 const s=authenticated(),before=plain([...s.docs]);
 s.c.HtmlService={XFrameOptionsMode:{ALLOWALL:'ALLOWALL'},createTemplateFromFile(name){const t={evaluate(){const output={file:name,html:evaluateTemplate(name+'.html',t),setTitle(){return output;},setXFrameOptionsMode(){return output;}};return output;}};return t;}};
 s.c.failRequest=url=>url.includes('/Master_Users/')?503:0;
 const result=s.c.doGet({parameter:{page:'products',token:s.token,channel:'fixture-channel-123456',parentOrigin:'https://shell-script.googleusercontent.com'}});
 assert.equal(result.file,'login');assert.match(result.html,/syy-session-state" content="unavailable"/);assert.match(result.html,/syy-parent-origin" content="https:\/\/shell-script.googleusercontent.com"/);assert.match(result.html,/ยังตรวจสอบการเชื่อมต่อไม่ได้/);assert.doesNotMatch(result.html,/id="productBody"/);assert.deepEqual(plain([...s.docs]),before);assert.equal(s.commits.length,0);
 for(const hint of ['https://script.google.com.evil.invalid','https://user@script.google.com','javascript:alert(1)','https://script.google.com/path','http://script.google.com']){
  const rejected=s.c.doGet({parameter:{page:'products',token:s.token,channel:'fixture-channel-123456',parentOrigin:hint}});assert.match(rejected.html,/syy-parent-origin" content=""/);
 }
});


test('a busy cache producer is a bounded retryable response with no duplicate scan or DB writes',()=>{
 const s=authenticated(),before=plain([...s.docs]);let workers=0,slept=0;
 const key=s.c.readCacheKey_('lease:loading-audit');s.cache.set(key,JSON.stringify({owner:'other',until:Date.now()+30000}));s.c.Utilities.sleep=ms=>slept+=ms;
 s.c.API_FUNCTIONS.getBrands=()=>s.c.withReadLease_('loading-audit',()=>null,()=>{workers++;return [];});
 const result=s.c.apiGateway(s.token,'getBrands',[]);assert.equal(result.code,'CACHE_BUILDING');assert.equal(result.retryable,true);assert.equal(result.retryAfterMs,2000);assert.equal(workers,0);assert.equal(slept,2000);assert.deepEqual(plain([...s.docs]),before);assert.equal(s.commits.length,0);
 s.cache.delete(key);const next=s.c.apiGateway(s.token,'getBrands',[]);assert(Array.isArray(next));assert.equal(workers,1);
});

function transportFixture(parent,token='fixture-token'){
 const vm=require('node:vm'),fs=require('node:fs'),source=fs.readFileSync('Shared.html','utf8');let now=0;const timers=[],calls=[],results=[],failures=[];
 const c={window:null,AUTH_TOKEN:token,navigator:{userAgent:'fixture'},Map,JSON,Math,Number,Array,Date:{now:()=>now},syyUxBusy:0,syyUxLoaded:0,syyUxStatus(){},syyWriteButtons:{},syyUnknownWrites:{},syyLockUnknownWrite(){},syyDraftFlush(){},syyErrorMessage:e=>e.message,syyShowSessionExpired(){},syyPostParent(){},document:{querySelectorAll:()=>[]},
 setTimeout(fn,ms){const t={fn,at:now+ms};timers.push(t);return t;},clearTimeout(t){if(t)t.cancelled=true;},google:{script:{run:{withSuccessHandler(ok){return {withFailureHandler(fail){return {apiGateway(token,fn,args,ua,metadata){calls.push({token,fn,args,metadata,ok,fail});}};}};}}}}};
 c.window=c;c.parent=parent||c;vm.createContext(c);vm.runInContext(source.slice(source.indexOf('/* One pool per same-origin'),source.indexOf('// Fetch only requested pages')),c);
 return {c,calls,results,failures,read(fn='getBrands',args=[],options,metadata){c.syyCallApiRaw(fn,args,x=>results.push(x),e=>failures.push(e),metadata,options);},tick(ms){now+=ms;let due;while((due=timers.find(t=>!t.cancelled&&t.at<=now))){due.cancelled=true;due.fn();}}};
}

test('transient completed reads retry once and coalesce; network, rate limits and writes never auto-retry',()=>{
 for(const code of ['CACHE_BUILDING','READ_BUSY','AUTH_UNAVAILABLE']){
  const f=transportFixture();f.read();f.read();assert.equal(f.calls.length,1);f.calls[0].ok({success:false,code,retryable:true,retryAfterMs:1000});f.tick(1500);assert.equal(f.calls.length,2);
  f.calls[1].ok({success:false,code,retryable:true,retryAfterMs:1000});f.tick(1500);assert.equal(f.calls.length,2);assert.equal(f.failures.length,2);
 }
 for(const fn of ['getBrands','saveBrand']){const f=transportFixture();f.read(fn);f.calls[0].fail({message:'network'});f.tick(5000);assert.equal(f.calls.length,1);}
 for(const code of ['READ_LIMITED','REQUEST_FAILED']){const f=transportFixture();f.read();f.calls[0].ok({success:false,code,retryable:true});f.tick(5000);assert.equal(f.calls.length,1);}
 const forced=transportFixture();forced.read('getBrands',[],{}, {refresh:true});forced.calls[0].ok({success:false,code:'READ_BUSY',retryable:true});forced.tick(5000);assert.equal(forced.calls.length,1);
});

test('timeout keeps the physical slot; retry joins the pending RPC and late data never reaches the timed-out observer',()=>{
 const f=transportFixture();f.read();f.tick(45001);assert.equal(f.failures.length,1);assert.equal(f.c.syyReadCoordinator().active,1);
 f.read();assert.equal(f.calls.length,1);f.calls[0].ok([{id:'B1'}]);assert.equal(f.results.length,1);assert.equal(f.c.syyReadCoordinator().active,0);assert.equal(f.c.syyReadCoordinator().pending.size,0);
});

test('same-session child frames share three slots and isolate coalesced response objects; different sessions never share',()=>{
 const parent=transportFixture(),child=transportFixture(parent.c),other=transportFixture(parent.c,'another-token');
 parent.read();child.read();assert.equal(parent.calls.length,1);assert.equal(child.calls.length,0);parent.calls[0].ok([{id:'B1'}]);parent.results[0][0].id='changed';assert.equal(child.results[0][0].id,'B1');
 ['getA','getB','getC'].forEach(fn=>parent.read(fn));child.read('getD');assert.equal(child.calls.length,0);other.read('getE');assert.equal(other.calls.length,1);
 parent.calls[1].ok([]);assert.equal(child.calls.length,1);assert.equal(parent.c.syyReadCoordinator().active,3);
 // A removed child no longer advances its own timers. The surviving shell
 // still releases the child's abandoned transport without issuing another RPC.
 parent.tick(370001);assert.equal(parent.c.syyReadCoordinator().active,0);assert.equal(parent.c.syyReadCoordinator().pending.size,0);assert.equal(child.calls.length,1);
});

test('queued expired work never dispatches and abandoned transports eventually release bookkeeping',()=>{
 const f=transportFixture();['getA','getB','getC','getD'].forEach(fn=>f.read(fn));f.tick(45001);assert.equal(f.calls.length,3);assert.equal(f.failures.length,4);f.tick(370000);assert.equal(f.calls.length,3);assert.equal(f.c.syyReadCoordinator().active,0);assert.equal(f.c.syyReadCoordinator().pending.size,0);
});

test('three stalled requests admit one distinct bounded foreground read while keeping all physical slots',()=>{
 const f=transportFixture();['getA','getB','getC'].forEach(fn=>f.read(fn));
 f.read('getDashboardBootstrap');f.read('getBrands');f.read('getBrands');f.read('getCategories',[],{background:true});
 f.tick(9999);assert.equal(f.calls.length,3);f.tick(1);
 assert.deepEqual(f.calls.map(call=>call.fn),['getA','getB','getC','getBrands']);
 assert.equal(f.c.syyReadCoordinator().active,4);
 f.calls[3].ok([]);f.read('getProductById',['P1']);f.tick(35001);
 assert.equal(f.calls.length,4);assert.equal(f.results.length,2);
 assert.equal(f.failures.filter(error=>error.code==='READ_TIMEOUT').length,3);
 assert.equal(f.failures.filter(error=>error.code==='READ_QUEUE_TIMEOUT').length,2);
});

test('a shared invalidation fence prevents fresh callers joining transports from before a change',()=>{
 const parent=transportFixture(),child=transportFixture(parent.c);parent.read();child.c.syyFenceReadPool();child.read();assert.equal(parent.calls.length,1);assert.equal(child.calls.length,1);assert.equal(parent.c.syyReadCoordinator().active,2);
 parent.calls[0].ok([{id:'old'}]);assert.equal(parent.c.syyReadCoordinator().pending.size,1);assert.equal(child.results.length,0);child.calls[0].ok([{id:'new'}]);assert.equal(child.results[0][0].id,'new');assert.equal(parent.c.syyReadCoordinator().active,0);
});


test('staged Dashboard keeps the 10000-product read volume and adds only one authenticated round trip',()=>{
 function sample(staged){
  const s=authenticated();s.c.readTime=new Date().toISOString();
  for(let i=0;i<10000;i++)s.put('Master_Products/P'+String(i).padStart(5,'0'),{Product_Name:'Part '+i,Current_Stock:10,Min_Stock:2,Selling_Price:200,Cost_Price:100});
  for(let i=0;i<100;i++)s.put('Stock_Movements/M'+i,{Timestamp:new Date().toISOString(),Type:'OUT',Reason:'ขายหน้าร้าน',Product_Code:'P00001',Qty:1,Unit_Price:200,Cost_Price:100});
  const counts={products:0,history:0,auth:0};let requests=0;const fetch=s.c.UrlFetchApp.fetch;
  s.c.UrlFetchApp.fetch=(url,options)=>{requests++;const res=fetch(url,options);if(res.getResponseCode()===200){const body=JSON.parse(res.getContentText()),docs=Array.isArray(body)?body.map(x=>x.document||x.found).filter(Boolean):body.documents||(body.name?[body]:[]);docs.forEach(d=>{const name=d.name.split('/documents/')[1].split('/')[0];if(name==='Master_Products')counts.products++;if(name==='Stock_Movements')counts.history++;if(name==='Master_Users')counts.auth++;});}return res;};
  const opts={compactCatalog:true,compactMovements:true,includePoVendorMap:false};let catalog;
  if(staged){catalog=s.c.apiGateway(s.token,'getAllProducts',[{compact:true}],null,{protocol:1});assert.equal(catalog.__syyCache,1);opts.catalogSection={version:catalog.version,loadedAt:Date.now()};assert.equal(catalog.data.rows.length,10000);}
  const reply=s.c.apiGateway(s.token,'getDashboardBootstrap',[opts],null,{protocol:1});assert.equal(reply.__syyCache,1);assert.equal(reply.data.movements.rows.length,100);
  if(staged)assert.equal(reply.data.products,undefined);else assert.equal(reply.data.products.rows.length,10000);
  assert.equal(s.commits.length,0);assert(!s.calls.some(x=>['patch','delete'].includes(x.options.method)||x.url.endsWith(':commit')));
  return {counts,requests};
 }
 const before=sample(false),after=sample(true);assert.equal(after.counts.products,10000);assert.equal(after.counts.products,before.counts.products);assert.equal(after.counts.history,before.counts.history);assert.equal(after.counts.auth,before.counts.auth+1);
 const total=x=>Object.values(x.counts).reduce((a,b)=>a+b,0);const ratio=total(after)/total(before);assert(ratio<1.01);
 require('node:fs').mkdirSync('test-results',{recursive:true});require('node:fs').writeFileSync('test-results/loading-read-budget.json',JSON.stringify({fixtureOnly:true,excludes:'empty-query minimums, index reads, billing, production timing',before,after,ratio,productionWrites:0},null,2));
});
