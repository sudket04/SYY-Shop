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
