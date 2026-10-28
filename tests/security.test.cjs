// Local VM only: never calls Apps Script, Firestore, Drive or Mail in production.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sources = ['Code.gs', 'ProductImagesV2.gs'].map(file => fs.readFileSync(path.join(root, file), 'utf8'));
const declared = [...sources.join('\n').matchAll(/^function\s+(\w+)\s*\(/gm)].map(m => m[1]);
const publicNames = declared.filter(name => !name.endsWith('_'));
const expectedPublic = ['doGet','apiGateway','apiGatewayV2','authLogin','authForgotPassword','authVerifyResetToken','authResetPassword','authChangePasswordForced'];
const roles = {viewer: 1, staff: 2, admin: 3};
const imageRoles = {getProductImagesV2:'viewer',uploadProductImageV2:'staff',deleteProductImageV2:'staff',setPrimaryProductImageV2:'staff',deleteProductWithImagesV2:'admin'};
const {evaluateTemplate} = require('./support/templates.cjs');
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function setup() {
  const cache = new Map(), network = [], mail = [], writes = [], logs = [], created = [], removed = [];
  let sequence = 0; const authDocs = new Map(),props={};
  const c = vm.createContext({
    console:{error(){},log(){}},
    CacheService:{getScriptCache:()=>({get:key=>cache.get(key)||null,put:(key,value)=>cache.set(key,value),remove:key=>cache.delete(key)})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>props[key]||null,setProperty:(key,value)=>props[key]=value,setProperties:values=>Object.assign(props,values)})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}}),getUserLock:()=>({tryLock:()=>true,releaseLock(){}})},
    Utilities:{base64Encode:v=>Buffer.from(v).toString('base64'),DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,value)=>Array.from(require('node:crypto').createHash('sha256').update(String(value)).digest()),getUuid:()=> 'dummy-'+(++sequence),formatDate:()=> '2026-10-11'},
    ScriptApp:{getOAuthToken:()=> 'dummy-oauth',getService:()=>({getUrl:()=> 'https://example.invalid/shop'}),
      WeekDay:{SUNDAY:'SUNDAY'},getProjectTriggers:()=>[],deleteTrigger:t=>removed.push(t),
      newTrigger(handler){const config={handler}; const builder={
        timeBased(){return builder;},onWeekDay(day){config.day=day;return builder;},
        atHour(hour){config.hour=hour;return builder;},everyDays(days){config.days=days;return builder;},nearMinute(minute){config.minute=minute;return builder;},inTimezone(zone){config.timezone=zone;return builder;},
        create(){created.push(config);return {getUniqueId:()=> 'trigger-'+sequence};}};return builder;}},
    UrlFetchApp:{fetch(url,options){network.push({url,options});var id=url.split('/Master_Users/')[1];if(options.method==='get' && id && authDocs.has(id)){var body={fields:c.mapToFirestoreFields_(authDocs.get(id)),updateTime:'v1'};return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(body)};}throw new Error('Unmocked service request');}},
    DriveApp:{getFileById(){throw new Error('Unmocked Drive request');}},
    MailApp:{sendEmail(...args){mail.push(args);}}
  });
  sources.forEach(source=>vm.runInContext(source,c));
  c.logActivity_=(...args)=>logs.push(args);
  c.logActivityV2_=(...args)=>logs.push(args);
  c.updateUserFields_=(id,data)=>{writes.push({id,data:plain(data)});if(authDocs.has(id))Object.assign(authDocs.get(id),data);return true;};
  function session(role='staff') {authDocs.set('U-'+role,{Username:role,Role:role,Status:'Active',Full_Name:role});return {username:role,role,fullName:role,docId:'U-'+role,issuedAt:Date.now()};}
  function loginUser(overrides={}) {
    const user={docId:'U1',Username:'staff',Full_Name:'Staff',Email:'staff@example.invalid',Role:'staff',Status:'Active',
      Session_Version:'',Password_Hash:'hash:password',Salt:'salt',Totp_Enabled:false,Must_Change_Password:false,Failed_Attempts:0,
      Password_Changed_At:new Date().toISOString(),...overrides};
    authDocs.set('U1',user);c.findUserByUsername_=()=>user;c.findUserByEmail_=()=>user;
    c.hashPassword_=password=>'hash:'+password;c.makeSalt_=()=> 'new-salt';
    return user;
  }
  // Models the documented HtmlService public/private export boundary, not live RPC.
  function rpc(name,args=[]) {
    if (!publicNames.includes(name)) throw new Error('Function is not browser-callable: '+name);
    return c[name](...args);
  }
  return {c,cache,network,mail,writes,logs,created,removed,session,loginUser,rpc};
}
test('browser surface contains only routing, gateways and five pre-login endpoints',()=>{
  assert.deepEqual([...publicNames].sort(),[...expectedPublic].sort());
  assert.equal(new Set(declared).size,declared.length,'No duplicate global functions');
});
test('OAuth header, CRUD, users, restore and maintenance cannot be called directly from browser',()=>{
  const s=setup();
  for(const name of ['getAuthHeader','saveMasterData','deleteFirestoreDocument','getAllUsers','createUserAccount',
    'restoreFromBackup','incrementProductStockBatch','setupFirstAdmin','weeklyBackupJob','cleanupOldActivityLogs',
    'include','authStartTotpSetup','issueStock','receiveGoods']) {
    assert.equal(typeof s.c[name],'undefined',name);
    assert.equal(typeof s.c[name+'_'],'function',name+'_');
    assert.throws(()=>s.rpc(name),/not browser-callable/);
    assert.throws(()=>s.rpc(name+'_'),/not browser-callable/);
  }
  assert.equal(s.network.length+s.writes.length+s.mail.length,0);
  assert.deepEqual(plain(s.c.getAuthHeader_()),{Authorization:'Bearer dummy-oauth','Content-Type':'application/json'});
});
test('unauthenticated callers cannot reach any registered V1 or V2 worker',()=>{
  const s=setup();
  for(const name of Object.keys(s.c.API_REGISTRY)) assert.equal(s.rpc('apiGateway',['',name,[]]).__authError,true,name);
  for(const name of Object.keys(imageRoles)) assert.equal(s.rpc('apiGatewayV2',['',name,[]]).__authError,true,name);
  assert.equal(s.network.length+s.writes.length+s.logs.length,0);
});
test('all V1 operations retain names, private dispatch, response and existing role policy',()=>{
  const s=setup();
  const expected={viewer: ['getProductById','getProductCatalogPage','getProductCatalogFacets','getProductImageBatch','getAllProducts','getAllMasterDropdowns','getBrands','getCategories','getVendorsFull','getCustomersFull',
    'getZonesFull','getCarsFull','getPurchaseOrderPageData','getTaxInvoicePageData','getTaxInvoiceListData','getQuotationPageData',
    'getQuotationListData','getStockMovements','getStockMovementPage','getDashboardBootstrap','getDashboardDelta','saveTaxInvoice','saveQuotation',
    'updateQuotationStatus','authGetMyProfile','authChangePassword','authLogout'],
    staff:['saveBrand','saveCategory','saveVendor','saveCustomer','saveZone','saveCar','saveProduct','uploadProductImage',
    'deleteProductImage','setPrimaryProductImage','moveProductImage','commitProductImageDraft','generateProductBarcode',
    'saveMasterData','savePurchaseOrder','receiveGoods','updatePurchaseOrderStatus','issueStock','getStockMovementDetail','getStockIssueCorrectionHistory','markQuotationStockIssued'],
    admin:['getStockIssueCorrectionPreview','correctStockIssue','deleteTaxInvoice','deleteQuotation','deleteBrand','deleteCategory','deleteVendor','deleteCustomer','deleteZone',
    'deleteCar','deleteProduct','deletePurchaseOrder','backupNow','listBackupFiles','getBackupOverview','setupBackupSchedule','getActivityLog','getAllUsers',
    'createUserAccount','updateUserAccount','resetUserPassword','toggleUserStatus','authStartTotpSetup','authConfirmTotpSetup','authDisableTotp']};
  const expectedRegistry=Object.fromEntries(Object.entries(expected).flatMap(([role,names])=>names.map(name=>[name,role])));
  assert.deepEqual(plain(s.c.API_REGISTRY),expectedRegistry);
  for(const [name,minRole] of Object.entries(expectedRegistry)) {
    assert.equal(s.c.API_FUNCTIONS[name],s.c[name+'_'],name);
    for(const role of Object.keys(roles)) {
      let reached=false;
      s.c.getSession_=()=>s.session(role);
      s.c.API_FUNCTIONS[name]=()=>{reached=true;return {success:true,id:'unchanged-response'};};
      const args=name==='saveMasterData'?['Master_Brands','B','',{Brand_Name:'B'},'B']:[];
      const result=s.rpc('apiGateway',['dummy',name,args]);
      const allowed=roles[role]>=roles[minRole];
      assert.equal(reached,allowed,name+'/'+role);assert.equal(result.success,allowed,name+'/'+role);
      if(allowed) assert.equal(result.id,'unchanged-response');
    }
  }
  assert.equal(s.network.length+s.writes.length,0);
});
test('V2 images retain viewer/staff/admin permissions and response shapes',()=>{
  for(const [name,minRole] of Object.entries(imageRoles)) for(const role of Object.keys(roles)) {
    const s=setup();let reached=false;s.c.getSession_=()=>s.session(role);
    s.c[name+'_']=()=>{reached=true;return {success:true,imageUrls:['dummy-image'],primaryIndex:0};};
    const result=s.rpc('apiGatewayV2',['dummy',name,['P1',0]]);
    const allowed=roles[role]>=roles[minRole];
    assert.equal(reached,allowed,name+'/'+role);assert.equal(result.success,allowed,name+'/'+role);
    if(allowed) assert.deepEqual(plain(result.imageUrls),['dummy-image']);
    assert.equal(s.network.length+s.writes.length,0);
  }
});
test('both gateways reject helpers, unknown/inherited keys, non-string names and malformed arguments',()=>{
  const s=setup();s.c.getSession_=()=>s.session('admin');
  for(const gateway of ['apiGateway','apiGatewayV2']) {
    for(const name of ['getAuthHeader_','saveMasterData_','restoreFromBackup_','constructor','toString','__proto__',null,{}]) {
      assert.equal(s.rpc(gateway,['dummy',name,[]]).success,false,String(name));
    }
    const name=gateway==='apiGateway'?'saveProduct':'uploadProductImageV2';
    for(const args of [{0:'P1',length:1},'P1',42]) assert.equal(s.rpc(gateway,['dummy',name,args]).success,false);
  }
  assert.equal(s.network.length+s.writes.length+s.logs.length,0);
});
test('invalid session roles fail closed in both gateways',()=>{
  const s=setup();
  for(const role of ['constructor','toString','__proto__','unknown','',null]) {
    s.c.getSession_=()=>s.session(role);
    assert.equal(s.rpc('apiGateway',['dummy','saveProduct',[]]).success,false);
    assert.equal(s.rpc('apiGatewayV2',['dummy','uploadProductImageV2',[]]).success,false);
  }
  assert.equal(s.network.length+s.writes.length,0);
});
test('generic master gateway still allows Brands/Categories only, including for Admin',()=>{
  const s=setup();let reached=0;s.c.getSession_=()=>s.session('admin');
  s.c.API_FUNCTIONS.saveMasterData=()=>{reached++;return {success:true};};
  for(const collection of ['Master_Users','Master_Products','Stock_Movements','Arbitrary']) {
    assert.equal(s.rpc('apiGateway',['dummy','saveMasterData',[collection]]).success,false);
  }
  assert.equal(reached,0);
  for(const collection of ['Master_Brands','Master_Categories']) assert.equal(s.rpc('apiGateway',['dummy','saveMasterData',[collection]]).success,true);
  assert.equal(reached,2);assert.equal(s.network.length,0);
});
test('expired session is rejected and normal session still reaches private reads',()=>{
  const s=setup();s.cache.set('sess_dummy',JSON.stringify(s.session('viewer')));
  s.c.API_FUNCTIONS.getAllProducts=()=>[{productCode:'P1',currentStock:7}];
  assert.deepEqual(plain(s.rpc('apiGateway',['dummy','getAllProducts',[]])),[{productCode:'P1',currentStock:7}]);
  s.cache.delete('sess_dummy');
  assert.equal(s.rpc('apiGateway',['dummy','getAllProducts',[]]).__authError,true);
});
test('login and OTP pre-login endpoint still issue existing sessions',()=>{
  const s=setup();const user=s.loginUser();
  let result=s.rpc('authLogin',['staff','password',undefined,'ua']);
  assert.equal(result.success,true);assert.equal(s.c.getSession_(result.token).role,'staff');
  user.Totp_Enabled=true;s.c.decryptSecret_=()=> 'dummy-secret';s.c.verifyTotp_=(_,otp)=>otp==='123456';
  assert.equal(s.rpc('authLogin',['staff','password',undefined,'ua']).needOtp,true);
  result=s.rpc('authLogin',['staff','password','123456','ua']);assert.equal(result.success,true);
  assert.equal(s.c.getSession_(result.token).username,'staff');assert(s.network.every(x=>x.options.method==='get'));
});
test('forgot, verify and reset endpoints retain valid reset flow without a session',()=>{
  const s=setup();s.loginUser();
  assert.equal(s.rpc('authForgotPassword',['staff@example.invalid']).success,true);assert.equal(s.mail.length,1);
  const key=[...s.cache.keys()].find(key=>key.startsWith('pwreset_'));assert(key);
  const token=key.slice('pwreset_'.length);
  assert.equal(s.rpc('authVerifyResetToken',[token]).success,true);
  assert.equal(s.rpc('authResetPassword',[token,'new-password']).success,true);
  assert.equal(s.writes.length,1);assert.equal(s.writes[0].data.Password_Hash,'hash:new-password');
  assert.equal(s.rpc('authVerifyResetToken',[token]).success,false);assert(s.network.every(x=>x.options.method==='get'));
});
test('forced password change remains available before login and creates a session',()=>{
  const s=setup();s.loginUser({Must_Change_Password:true});
  const start=s.rpc('authLogin',['staff','password']);assert.equal(start.needPasswordChange,true);
  const result=s.rpc('authChangePasswordForced',[start.tempToken,'new-password','ua']);
  assert.equal(result.success,true);assert.equal(s.c.getSession_(result.token).username,'staff');
  assert.equal(s.writes.length,2);assert(s.network.every(x=>x.options.method==='get'));
});
test('logout and admin-only TOTP cannot bypass the gateway',()=>{
  const s=setup();s.cache.set('sess_dummy',JSON.stringify(s.session('staff')));
  assert.equal(s.rpc('apiGateway',['dummy','authStartTotpSetup',['dummy']]).success,false);
  assert.equal(s.rpc('apiGateway',['dummy','authLogout',['dummy']]).success,true);
  assert.equal(s.c.getSession_('dummy'),null);assert.equal(s.writes.length,0);assert(s.network.every(x=>x.options.method==='get'));
});
test('trigger setup replaces legacy/private handlers once and preserves unrelated schedules',()=>{
  const s=setup();let triggers=['weeklyBackupJob','weeklyBackupJob_','cleanupOldActivityLogs','cleanupOldActivityLogs_','unrelated']
    .map(handler=>({getHandlerFunction:()=>handler}));
  s.c.getOrCreateBackupFolder_=()=>({});s.c.assertPrivateBackupFolder_=()=>{};
  s.c.ScriptApp.getProjectTriggers=()=>triggers;
  s.c.ScriptApp.deleteTrigger=t=>{s.removed.push(t.getHandlerFunction());triggers=triggers.filter(item=>item!==t);};
  s.c.ScriptApp.newTrigger=handler=>{const config={handler};const builder={timeBased:()=>builder,
    onWeekDay(day){config.day=day;return builder;},atHour(hour){config.hour=hour;return builder;},
    everyDays(days){config.days=days;return builder;},nearMinute(minute){config.minute=minute;return builder;},inTimezone(zone){config.timezone=zone;return builder;},create(){s.created.push(config);triggers.push({getHandlerFunction:()=>handler});return {getUniqueId:()=> 'trigger'};}};return builder;};
  for(let pass=0;pass<2;pass++){s.c.setupWeeklyBackupTrigger_();s.c.setupActivityLogCleanupTrigger_();}
  assert.deepEqual(triggers.map(t=>t.getHandlerFunction()).sort(),['cleanupOldActivityLogs_','dailyBackupJob_','unrelated']);
  assert.deepEqual(s.created[0],{handler:'dailyBackupJob_',days:1,hour:22,minute:0,timezone:'Asia/Bangkok'});
  assert.deepEqual(s.created[1],{handler:'cleanupOldActivityLogs_',days:1,hour:3});
  assert.equal(s.removed.includes('unrelated'),false);assert.equal(s.network.length+s.writes.length,0);
});
test('private scheduled backup and cleanup still execute their existing workers',()=>{
  const s=setup();let backups=0,deleted=[];
  s.c.backupAllDataToBackup_=()=>{backups++;return {success:true};};
  s.c.weeklyBackupJob_();assert.equal(backups,1);
  s.c.UrlFetchApp.fetch=(url,options)=>{const q=JSON.parse(options.payload).structuredQuery;assert.equal(q.where.fieldFilter.op,'LESS_THAN');assert.equal(q.limit,450);return {getResponseCode:()=>200,getContentText:()=>JSON.stringify([{document:{name:'projects/syy-shop/databases/(default)/documents/Activity_Log/old',updateTime:'v1'}}])};};
  s.c.fsCommit_=writes=>{deleted.push(...writes.map(w=>w.delete.split('/').slice(-2)));return {ok:true};};
  assert.equal(s.c.cleanupOldActivityLogs_().deleted,1);assert.deepEqual(deleted,[['Activity_Log','old']]);
  assert.equal(s.network.length+s.writes.length,0);
});
test('all HTML includes point to private server helper; browser direct calls are allowlisted',()=>{
  const endpoints=new Set(expectedPublic);
  for(const file of fs.readdirSync(root).filter(file=>file.endsWith('.html'))) {
    const html=fs.readFileSync(path.join(root,file),'utf8');
    assert.equal(/<\?!=\s*include\(/.test(html),false,file);
    for(const match of html.matchAll(/<\?!=\s*include_\('([^']+)'\)/g)) assert(fs.existsSync(path.join(root,match[1]+'.html')),file+'/'+match[1]);
    for(const match of html.matchAll(/\.((?:auth|apiGateway)[A-Za-z0-9_]*)\s*\(/g)) {
      if(match[1]==='authError')continue;
      assert(endpoints.has(match[1]),file+'/'+match[1]);
    }
  }
  const profile=fs.readFileSync(path.join(root,'Profile.html'),'utf8');
  assert.equal(/runner\[fnName\]/.test(profile),false);
});

test('every channel-aware page evaluates without a channel and preserves a supplied channel',()=>{
  const values={username:'staff',userRole:'staff',userName:'Staff',authToken:'fixture',webAppUrl:'https://example.invalid/shop',resetMode:'',resetToken:''};
  for(const file of fs.readdirSync(root).filter(file=>file.endsWith('.html'))) {
    if(!fs.readFileSync(path.join(root,file),'utf8').includes('<meta name="syy-frame-channel"'))continue;
    const missing=evaluateTemplate(file,values);
    assert.match(missing,/<meta name="syy-frame-channel" content="">/,file);
    const supplied=evaluateTemplate(file,{...values,frameChannel:'fixture-channel-123456'});
    assert.match(supplied,/<meta name="syy-frame-channel" content="fixture-channel-123456">/,file);
  }
});

function routingSetup(requireLegacyChannel=false) {
  const s=setup();
  s.c.HtmlService={XFrameOptionsMode:{ALLOWALL:'ALLOWALL'},createTemplateFromFile(name){
    const template={evaluate(){if(requireLegacyChannel){const channel=vm.runInNewContext('frameChannel',template);if(name==='login')assert.equal(channel,'');}const output={file:name,html:evaluateTemplate(name+'.html',template),setTitle(){return output;},setXFrameOptionsMode(){return output;}};return output;}};
    return template;
  }};
  return s;
}
test('doGet evaluates every authenticated route, normalizes missing parameters and validates channel',()=>{
  const s=routingSetup();s.c.getSession_=()=>s.session('staff');
  const routes={home:'index',brands:'Master_Brands',categories:'Master_Categories',vendors:'Master_Vendors',zones:'Master_Zones',products:'Master_Products',cars:'Master_Cars',orders:'Purchase_Orders',taxinvoice:'Master_Tax_Invoice',quotation:'Quotation',customers:'Master_Customers',profile:'Profile',manageusers:'Manage_Users',stockissue:'StockIssue'};
  for(const [page,file] of Object.entries(routes)) {
    const output=s.c.doGet({parameter:{page,token:'fixture',channel:'fixture-channel-123456'}});
    assert.equal(output.file,file);if(output.html.includes('<meta name="syy-frame-channel"'))assert.match(output.html,/<meta name="syy-frame-channel" content="fixture-channel-123456">/,file);
  }
  for(const event of [undefined,{}, {parameter:{}},{parameter:{channel:'<invalid>'}}]) {
    const output=s.c.doGet(event);assert.equal(output.file,'index');assert.match(output.html,/<meta name="syy-frame-channel" content="">/);
  }
  assert.equal(s.network.length+s.writes.length+s.mail.length,0);
});
test('doGet never renders authenticated templates for absent or expired sessions',()=>{
  const s=routingSetup();s.c.getSession_=()=>null;
  for(const page of ['home','stockissue','quotation','products','manageusers','unknown']) {
    const output=s.c.doGet({parameter:{page,token:'expired',channel:'fixture-channel-123456'}});
    assert.equal(output.file,'login');assert.doesNotMatch(output.html,/<meta name="syy-frame-channel"/);
  }
  assert.equal(s.c.doGet().file,'login');assert.equal(s.network.length+s.writes.length+s.mail.length,0);
});

test('legacy direct frameChannel scriptlets work in login, reset and every authenticated route',()=>{
  const s=routingSetup(true);s.c.getSession_=()=>null;
  for(const event of [undefined,{}, {parameter:{}}, {parameter:{page:'login'}},
    {parameter:{page:'home',token:'expired'}},
    {parameter:{page:'login',mode:'reset',rtoken:'reset-fixture',channel:'<invalid>'}}]) {
    const output=s.c.doGet(event);assert.equal(output.file,'login');
    if(event?.parameter?.mode==='reset')assert.match(output.html,/reset-fixture/);
  }
  s.c.getSession_=()=>s.session('staff');
  for(const page of ['home','brands','categories','vendors','zones','products','cars','orders',
    'taxinvoice','quotation','customers','profile','manageusers','stockissue','unknown']) {
    assert.doesNotThrow(()=>s.c.doGet({parameter:{page,token:'fixture',channel:'fixture-channel-123456'}}),page);
    assert.doesNotThrow(()=>s.c.doGet({parameter:{page,token:'fixture'}}),page+' without channel');
  }
  assert.equal(s.network.length+s.writes.length+s.mail.length,0);
});
