// Deterministic in-memory services: no production credentials, data or network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const plain=x=>JSON.parse(JSON.stringify(x));
const reply=(code,body)=>({getResponseCode:()=>code,getContentText:()=>JSON.stringify(body)});
const iterator=items=>{let i=0;return {hasNext:()=>i<items.length,next:()=>items[i++]};};
function setup(){
  const docs=new Map(),cache=new Map(),props={AUTH_MASTER_KEY:'test-only-key'},calls=[],commits=[],files=new Map(),folders=new Map(),snapshots=new Map();
  let version=1,sequence=0;
  const owner={getEmail:()=> 'owner@example.invalid'};
  function blob(data){const b=Buffer.isBuffer(data)?data:Buffer.from(typeof data==='string'?data:Uint8Array.from(data));return {getBytes:()=>Array.from(b),getDataAsString:()=>b.toString('utf8')};}
  const permissions={getOwner:()=>owner,getEditors:()=>[],getViewers:()=>[],getSharingAccess:()=> 'PRIVATE'};
  function makeFile(data,name='image.jpg',parent){
    const id='file-'+(++sequence),item={...permissions,id,name,blob:blob(data),trashed:false,updated:1,
      getId(){return id;},getName(){return item.name;},setName(n){item.name=n;return item;},getBlob(){return item.blob;},
      getLastUpdated(){return new Date(item.updated);},getDateCreated:()=>new Date(sequence),getSize:()=>item.blob.getBytes().length,
      getUrl:()=> 'https://drive.invalid/'+id,setSharing(){return item;},setTrashed(v){item.trashed=v;return item;},
      getParents:()=>iterator(parent?[parent]:[])};
    files.set(id,item);if(parent)parent.files.push(item);return item;
  }
  function makeFolder(name,parent){
    const id='folder-'+(++sequence),item={...permissions,id,name,files:[],trashed:false,
      getId:()=>id,getName:()=>name,getParents:()=>iterator(parent?[parent]:[]),
      createFolder:n=>makeFolder(n,item),createFile:(data,name,mime)=>mime?makeFile(name,data,item):makeFile(data?.getBytes?data.getBytes():data,name,item),
      getFilesByType:()=>iterator(item.files.filter(x=>!x.trashed)),getFilesByName:n=>iterator(item.files.filter(x=>x.name===n&&!x.trashed)),
      setTrashed(v){item.trashed=v;return item;}};
    folders.set(id,item);return item;
  }
  function keyFor(name){const project=name.match(/projects\/([^/]+)/)?.[1];return (project && project!=='syy-shop'?project+'::':'')+name.split('/documents/')[1];}
  function checked(doc,pre){return !pre || (pre.exists===undefined || pre.exists===!!doc) && (!pre.updateTime || doc?.updateTime===pre.updateTime);}
  function commit(writes){
    if(c.beforeCommit){const hook=c.beforeCommit;c.beforeCommit=null;hook(writes);}
    for(const w of writes){const key=keyFor(w.update?.name||w.transform?.document||w.delete);if(!checked(docs.get(key),w.currentDocument))return reply(400,{error:{status:'FAILED_PRECONDITION'}});}
    for(const w of writes){
      const name=w.update?.name||w.transform?.document||w.delete,key=keyFor(name),old=docs.get(key);
      if(w.delete){docs.delete(key);continue;}
      const doc=old?plain(old):{name,fields:{}};
      if(w.update){if(w.updateMask)w.updateMask.fieldPaths.forEach(k=>{if(w.update.fields[k])doc.fields[k]=plain(w.update.fields[k]);else delete doc.fields[k];});else doc.fields=plain(w.update.fields);}
      for(const transform of [...(w.transform?.fieldTransforms||[]),...(w.updateTransforms||[])]){
        const k=transform.fieldPath;
        if(transform.increment)doc.fields[k]={doubleValue:Number(c.parseFirestoreValue_(doc.fields[k])||0)+Number(c.parseFirestoreValue_(transform.increment))};
        if(transform.appendMissingElements){const values=doc.fields[k]?.arrayValue?.values||[];for(const x of transform.appendMissingElements.values)if(!values.some(v=>String(c.parseFirestoreValue_(v))===String(c.parseFirestoreValue_(x))))values.push(plain(x));doc.fields[k]={arrayValue:{values}};}
        if(transform.setToServerValue)doc.fields[k]={timestampValue:c.readTime};
      }
      doc.updateTime='v'+(++version);docs.set(key,doc);
    }
    commits.push(plain(writes));
    if(c.loseCommitResponse){c.loseCommitResponse=false;throw Error('network response lost after commit');}
    return reply(200,{commitTime:c.readTime});
  }
  function fetch(url,options={}){
    calls.push({url,options:plain(options)});
    if(c.failRequest){const failure=c.failRequest(url,options);if(failure)return reply(failure,{error:{status:'UNAVAILABLE'}});}
    const u=new URL(url),body=options.payload?JSON.parse(options.payload):{},project=u.pathname.match(/projects\/([^/]+)/)?.[1],key=(project && project!=='syy-shop'?project+'::':'')+decodeURIComponent(u.pathname.split('/documents/')[1]||'');
    if(u.pathname.endsWith(':beginTransaction')){const token='snapshot-'+(++sequence);snapshots.set(token,new Map([...docs].map(([k,v])=>[k,plain(v)])));return reply(200,{transaction:token});}
    if(u.pathname.endsWith(':rollback')){snapshots.delete(body.transaction);return reply(200,{});}
    if(u.pathname.endsWith(':batchGet'))return reply(200,body.documents.map(name=>docs.has(keyFor(name))?{found:docs.get(keyFor(name))}:{missing:name}));
    if(u.pathname.endsWith(':commit'))return commit(body.writes);
    if(u.pathname.endsWith(':runQuery')){
      const q=body.structuredQuery,col=q.from[0].collectionId;
      let list=[...docs].filter(([k])=>k.startsWith(col+'/')).map(([,v])=>v);
      let filters=q.where?.compositeFilter?.filters || (q.where?[q.where]:[]);
      for(const f of filters){const x=f.fieldFilter,k=x.field.fieldPath,want=c.parseFirestoreValue_(x.value);list=list.filter(doc=>{const v=c.parseFirestoreValue_(doc.fields[k]);return v!=null && (x.op==='EQUAL'?v===want:x.op==='LESS_THAN_OR_EQUAL'?v<=want:x.op==='GREATER_THAN'?v>want:v>=want);});}
      if(q.orderBy)list=list.filter(doc=>doc.fields[q.orderBy[0].field.fieldPath]);
      if(q.limit)list=list.slice(0,q.limit);
      return reply(200,list.length?list.map(document=>({document,readTime:c.readTime})):[{readTime:c.readTime}]);
    }
    if(options.method==='get' && key && !key.includes('/')){
      const store=snapshots.get(u.searchParams.get('transaction'))||docs;
      const all=[...store].filter(([k])=>k.startsWith(key+'/')).map(([,v])=>v),offset=Number(u.searchParams.get('pageToken')||0),size=c.pageSize||Number(u.searchParams.get('pageSize')||300);
      return reply(200,{documents:all.slice(offset,offset+size),...(offset+size<all.length?{nextPageToken:String(offset+size)}:{})});
    }
    if(options.method==='get')return docs.has(key)?reply(200,docs.get(key)):reply(404,{});
    if(options.method==='patch'){
      if(c.beforePatch){const hook=c.beforePatch;c.beforePatch=null;hook(key);}
      const pre=u.searchParams.has('currentDocument.updateTime')?{updateTime:u.searchParams.get('currentDocument.updateTime')}:u.searchParams.has('currentDocument.exists')?{exists:u.searchParams.get('currentDocument.exists')==='true'}:null;
      if(!checked(docs.get(key),pre))return reply(400,{error:{status:'FAILED_PRECONDITION'}});
      const old=docs.get(key)||{name:'projects/syy-shop/databases/(default)/documents/'+key,fields:{}},mask=u.searchParams.getAll('updateMask.fieldPaths');
      if(mask.length)mask.forEach(k=>old.fields[k]=body.fields[k]);else old.fields=body.fields;
      old.updateTime='v'+(++version);docs.set(key,old);
      if(c.losePatchResponse){c.losePatchResponse=false;throw Error('network response lost after patch');}
      return reply(200,old);
    }
    if(options.method==='delete'){
      if(!checked(docs.get(key),{updateTime:u.searchParams.get('currentDocument.updateTime')}))return reply(400,{error:{status:'FAILED_PRECONDITION'}});
      docs.delete(key);return reply(200,{});
    }
    throw Error('Unmocked '+url);
  }
  const c=vm.createContext({console:{error(){},warn(){},log(){}},
    Utilities:{getUuid:()=>crypto.randomUUID(),formatDate:()=> '2026-10-11_12-00-00',sleep(){},
      base64Encode:x=>(typeof x==='string'?Buffer.from(x):Buffer.from(Uint8Array.from(x))).toString('base64'),base64Decode:x=>Array.from(Buffer.from(x,'base64')),newBlob:blob,DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'UTF8'},
      MacAlgorithm:{HMAC_SHA_1:'sha1'},computeHmacSignature:(algo,data,key)=>Array.from(crypto.createHmac(algo,Buffer.from(Uint8Array.from(key))).update(Buffer.from(Uint8Array.from(data))).digest()),
      computeHmacSha256Signature:(data,key)=>Array.from(crypto.createHmac('sha256',String(key)).update(String(data)).digest()),
      computeDigest:(algo,input)=>Array.from(crypto.createHash('sha256').update(typeof input==='string'?input:Buffer.from(Uint8Array.from(input))).digest())},
    CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,getAll:keys=>Object.fromEntries(keys.filter(k=>cache.has(k)).map(k=>[k,cache.get(k)])),put:(k,v)=>cache.set(k,v),putAll:values=>Object.entries(values).forEach(([k,v])=>cache.set(k,v)),remove:k=>cache.delete(k),removeAll:keys=>keys.forEach(k=>cache.delete(k))})},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v,getProperties:()=>({...props}),setProperties:p=>Object.assign(props,p)})},
    LockService:{getScriptLock:()=>({tryLock:()=>!c.lockBusy,releaseLock(){}})},
    UrlFetchApp:{fetch,fetchAll:requests=>requests.map(r=>fetch(r.url,r))},
    DriveApp:{Access:{PRIVATE:'PRIVATE',ANYONE_WITH_LINK:'LINK'},Permission:{VIEW:'VIEW'},getFileById:id=>{if(!files.has(id))throw Error('Missing file');return files.get(id);},getFolderById:id=>folders.get(id),getFoldersByName:n=>iterator([...folders.values()].filter(f=>f.name===n)),createFolder:makeFolder},
    ScriptApp:{getOAuthToken:()=> 'mock',getService:()=>({getUrl:()=> 'https://example.invalid/shop'})},
    Session:{getEffectiveUser:()=>owner,getActiveUser:()=>owner},MimeType:{PLAIN_TEXT:'text/plain'},MailApp:{sendEmail(){}}
  });
  for(const file of ['Code.gs','ProductImagesV2.gs'])vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8'),c);
  c.readTime='2026-10-11T05:10:00.000Z';c.logActivity_=()=>{};
  const put=(key,data)=>docs.set(key,{name:'projects/syy-shop/databases/(default)/documents/'+key,fields:c.mapToFirestoreFields_(data),updateTime:'v'+(++version)});
  const value=(key,field)=>c.parseFirestoreValue_(docs.get(key)?.fields[field]);
  const seed=()=>{put('Master_Products/P1',{Product_Name:'Part',Current_Stock:10,Min_Stock:2,Cost_Price:100,Selling_Price:200});put('Master_Vendors/V1',{Vendor_name:'Vendor'});};
  function user(overrides={}){const data={Username:'admin',Role:'admin',Status:'Active',Full_Name:'Admin',Email:'admin@example.invalid',Salt:'salt',Password_Hash:c.hashPassword_('old-password','salt'),Password_Changed_At:new Date().toISOString(),...overrides};put('Master_Users/U1',data);return c.readAuthUser_('U1');}
  return {c,docs,cache,props,calls,commits,put,value,seed,user,makeFile,makeFolder,files,folders};
}
const issue={requestId:'request-stock-0001',reason:'ขายหน้าร้าน',items:[{productCode:'P1',qty:2}]};
const receive={requestId:'request-receive-0001',poId:'PO1',invoiceNo:'INV1',receiptDate:'2026-10-11',receiverName:'Staff',deliveryNoteNo:'DN1',items:[{productCode:'P1',qtyReceivedNow:5}]};
function po(s){s.put('Purchase_Orders/PO1',{Status:'Ordered',Vendor_ID:'V1',Items_JSON:JSON.stringify([{productCode:'P1',productName:'Part',qty:10,costPrice:75,receivedQty:0}]),Receipts_JSON:'[]'});}

test('stock retry replays committed result without a second stock or movement write',()=>{
  const s=setup();s.seed();const first=s.c.issueStock_(issue,'staff'),second=s.c.issueStock_(plain(issue),'staff');
  assert.equal(first.success,true,first.message);assert.equal(second.docNo,first.docNo);assert.equal(second.replayed,true);assert.equal(s.value('Master_Products/P1','Current_Stock'),8);assert.equal(s.commits.length,1);assert.equal(s.docs.size,3);
  assert.equal(s.c.issueStock_({...issue,items:[{productCode:'P1',qty:3}]},'staff').success,false);
  assert.equal(s.c.issueStock_(issue,'other-user').success,false);
});
test('lost commit response, simultaneous duplicate and stock contention cannot decrement twice',()=>{
  for(const mode of ['lost','duplicate','contention']){
    const s=setup();s.seed();
    if(mode==='lost')s.c.loseCommitResponse=true;
    if(mode==='duplicate')s.c.beforeCommit=()=>assert.equal(s.c.issueStock_(issue,'staff').success,true);
    if(mode==='contention')s.c.beforeCommit=()=>s.put('Master_Products/P1',{Product_Name:'Part',Current_Stock:1,Min_Stock:2,Cost_Price:100,Selling_Price:200});
    const r=s.c.issueStock_(issue,'staff');
    if(mode==='lost'){assert.equal(r.success,false);assert.equal(s.c.issueStock_(issue,'staff').replayed,true);}
    if(mode==='duplicate')assert.equal(r.replayed,true);
    assert.equal(s.value('Master_Products/P1','Current_Stock'),mode==='contention'?1:8);
    assert.equal(s.commits.length,mode==='contention'?0:1);
  }
});
test('quote marker, negotiated price, stock and movements commit together or all fail',()=>{
  for(const changed of [false,true]){
    const s=setup();s.seed();s.put('Quotations/Q1',{Status:'ปิดงาน-ขายสำเร็จ',Items_JSON:JSON.stringify([{productCode:'P1',unitPrice:125}])});
    if(changed)s.c.beforeCommit=()=>s.put('Quotations/Q1',{Status:'ร่าง'});
    const r=s.c.issueStock_({...issue,quoteId:'Q1'},'staff');assert.equal(r.success,!changed);
    assert.equal(s.value('Master_Products/P1','Current_Stock'),changed?10:8);
    if(!changed){assert.equal(s.value('Quotations/Q1','Stock_Issue_Doc'),r.docNo);assert.equal(s.value('Stock_Movements/'+r.docNo+'-1','Unit_Price'),125);}
  }
});
test('receipt original delivery identity stays unique when a retry would become final',()=>{
  const s=setup();s.seed();po(s);
  const first=s.c.receiveGoods_(receive,'staff');assert.equal(first.success,true,first.message);assert.equal(first.status,'PartiallyReceived');
  assert.equal(s.c.receiveGoods_(receive,'staff').replayed,true);
  assert.equal(s.c.receiveGoods_({...receive,requestId:'other-receipt-001'},'staff').success,false);
  assert.equal(s.value('Master_Products/P1','Current_Stock'),15);
  assert.equal(s.c.receiveGoods_({...receive,requestId:'final-receipt-001',deliveryNoteNo:'DN2'},'staff').status,'Received');
  assert.equal(s.value('Master_Products/P1','Current_Stock'),20);
  assert.equal(s.value('Stock_Movements/SR-final-receipt-001-1','Cost_Price'),75);
});
test('receipt rejects excess, unknown codes, invalid dates and corrupt history before writing',()=>{
  for(const patch of [{items:[{productCode:'P1',qtyReceivedNow:11}]},{items:[{productCode:'MISSING',qtyReceivedNow:1}]},{receiptDate:'2026-02-31'}]){
    const s=setup();s.seed();po(s);assert.equal(s.c.receiveGoods_({...receive,...patch},'staff').success,false);assert.equal(s.commits.length,0);
  }
  const s=setup();s.seed();po(s);s.docs.get('Purchase_Orders/PO1').fields.Receipts_JSON={stringValue:'broken'};assert.equal(s.c.receiveGoods_(receive,'staff').success,false);assert.equal(s.commits.length,0);
});
test('receive/cancel interleaving uses PO preconditions and preserves receipt status',()=>{
  const s=setup();s.seed();po(s);s.c.beforePatch=()=>assert.equal(s.c.receiveGoods_(receive,'staff').success,true);
  assert.equal(s.c.updatePurchaseOrderStatus_('PO1','Cancelled').success,false);assert.equal(s.value('Purchase_Orders/PO1','Status'),'PartiallyReceived');
  assert.equal(s.c.updatePurchaseOrderStatus_('PO1','arbitrary').success,false);
});
test('gateway rejects forged identity, binds account tokens and validates a session only once',()=>{
  const s=setup();const u=s.user(),token=s.c.createSession_(u).token;
  for(const [name,args] of [['issueStock',[issue,'forged']],['updateUserAccount',['U1','Admin','admin@example.invalid','staff','forged']],['toggleUserStatus',['U1','Inactive','forged']]])assert.equal(s.c.apiGateway(token,name,args).success,false);
  let delivered;s.c.API_FUNCTIONS.authGetMyProfile=other=>{delivered=other;return s.c.getSession_(other);};
  const before=s.calls.length;s.c.apiGateway(token,'authGetMyProfile',['stolen-other-token']);assert.equal(delivered,token);assert.equal(s.calls.length-before,1);
});
test('password, role and status revoke sessions durably even after revocation caches disappear',()=>{
  for(const mode of ['password','role','status','reset']){
    const s=setup();const u=s.user({Username:'target',Role:'staff'}),token=s.c.createSession_(u).token;
    let result;
    if(mode==='password')result=s.c.authChangePassword_(token,'old-password','new-password');
    if(mode==='role')result=s.c.updateUserAccount_('U1','Target','admin@example.invalid','viewer','other-admin');
    if(mode==='status')result=s.c.toggleUserStatus_('U1','Inactive','other-admin');
    if(mode==='reset'){s.c.revokeUserSessions_('target');result={success:true};}
    assert.equal(result.success,true,result.message);assert(s.value('Master_Users/U1','Session_Version'));
    for(const k of s.cache.keys())if(!k.startsWith('sess_'))s.cache.delete(k);
    assert.equal(s.c.getSession_(token),null);
  }
});
test('failed password write keeps the original session; user read outage fails closed',()=>{
  const s=setup();const u=s.user(),token=s.c.createSession_(u).token;
  s.c.failRequest=(_,o)=>o.method==='patch'?503:0;assert.equal(s.c.authChangePassword_(token,'old-password','new-password').success,false);assert(s.c.getSession_(token));
  s.c.failRequest=()=>503;assert.equal(s.c.getSession_(token),null);
});
test('recovery code is consumed only after a successful preconditioned write',()=>{
  for(const mode of ['normal','failure','concurrent']){
    const s=setup();const hash=s.c.hashPassword_('RECOVERY','recovery'),u=s.user({Recovery_Codes:JSON.stringify([hash])});
    if(mode==='failure')s.c.failRequest=(_,o)=>o.method==='patch'?503:0;
    if(mode==='concurrent')s.c.beforePatch=()=>assert.equal(s.c.consumeRecoveryCode_(u,'RECOVERY'),true);
    assert.equal(s.c.consumeRecoveryCode_(u,'RECOVERY'),mode==='normal');
    if(mode!=='failure')assert.equal(s.c.consumeRecoveryCode_(u,'RECOVERY'),false);
    else assert.equal(JSON.parse(s.value('Master_Users/U1','Recovery_Codes')).length,1);
  }
});
test('product and PO validation rejects invalid references, finite prices, quantities and calendar dates',()=>{
  const s=setup();s.seed();
  for(const d of [{productName:''},{productName:'X',costPrice:-1},{productName:'X',sellingPrice:'1x'},{productName:'X',status:'arbitrary'},{productName:'X',brandId:'missing'}])assert.equal(s.c.saveProduct_(d).success,false);
  const order={vendorId:'V1',orderDate:'2026-10-11',items:[{productCode:'P1',qty:1,costPrice:50}]};
  for(const d of [{orderDate:'2026-02-31'},{vendorId:'missing'},{status:'Received'},{items:[{productCode:'P1',qty:0,costPrice:50}]},{items:[{productCode:'P1',qty:1,costPrice:Infinity}]}])assert.equal(s.c.savePurchaseOrder_({...order,...d}).success,false);
  assert.equal(s.commits.length,0);assert.equal(s.calls.filter(x=>x.options.method==='patch').length,0);
});
test('valid PO input retains zero negotiated cost, quantities, real product names and selected vendor',()=>{
  const s=setup();s.seed();let stored;s.c.saveMasterData_=(col,prefix,id,data)=>{stored=plain(data);return {success:true,id:'PO-new'};};
  const result=s.c.savePurchaseOrder_({vendorId:'V1',orderDate:'2026-10-11',status:'Ordered',items:[{productCode:'P1',productName:'Forged',qty:1.5,costPrice:0}]});
  assert.equal(result.success,true);assert.equal(stored.Total_Qty,1.5);assert.equal(stored.Total_Amount,0);assert.equal(stored.Vendor_ID,'V1');assert.equal(JSON.parse(stored.Items_JSON)[0].productName,'Part');
  for(const costPrice of [true,'',[],{},'0x10'])assert.equal(s.c.savePurchaseOrder_({vendorId:'V1',orderDate:'2026-10-11',items:[{productCode:'P1',qty:1,costPrice}]}).success,false);
});
test('confirmed retries return current stock without replacing a successful result on refresh errors',()=>{
  const s=setup();s.seed();assert.equal(s.c.issueStock_(issue,'staff').success,true);
  s.put('Master_Products/P1',{Product_Name:'Part',Current_Stock:4,Min_Stock:2,Cost_Price:100,Selling_Price:200});
  assert.equal(s.c.issueStock_(issue,'staff').productStocks[0].currentStock,4);
  s.c.failRequest=url=>url.endsWith(':batchGet')?503:0;const retry=s.c.issueStock_(issue,'staff');assert.equal(retry.success,true);assert(retry.refreshWarning);assert.equal(retry.productStocks.length,0);assert.equal(s.commits.length,1);
});
test('read failures never cache empty products, PO, movements, audit logs or dropdowns',()=>{
  const s=setup();s.seed();s.c.failRequest=()=>503;
  for(const name of ['getAllProducts_','getPurchaseOrders_','getStockMovements_','getActivityLog_','getAllMasterDropdowns_'])assert.throws(()=>s.c[name]());
  assert.equal(s.cache.size,0);
  s.c.failRequest=null;assert.equal(s.c.getAllProducts_().length,1);s.c.failRequest=()=>503;assert.equal(s.c.getAllProducts_().length,1);
});
test('dashboard delta uses commit time, includes late business timestamps and fails without advancing',()=>{
  const s=setup();s.seed();s.put('Stock_Movements/late',{Doc_No:'SI-late',Type:'OUT',Product_Code:'P1',Qty:1,Timestamp:'2026-10-11T04:00:00Z',Committed_At:'2026-10-11T05:09:50.000Z'});
  const data=s.c.getDashboardDelta_('2026-10-11T05:09:40.000Z');assert.equal(data.movements.length,1);assert.equal(data.serverTime,s.c.readTime);
  s.c.failRequest=url=>url.endsWith(':runQuery')?503:0;assert.throws(()=>s.c.getDashboardDelta_(data.serverTime));
});
test('historic receiving cost comes from PO snapshot, including zero; missing cost remains unknown',()=>{
  const s=setup();s.seed();po(s);const rows=[{type:'IN',refNo:'PO1',productCode:'P1',costPrice:null},{type:'IN',refNo:'MISSING',productCode:'P1',costPrice:null}];
  assert.equal(s.c.buildPoVendorMapForMovements_(rows).PO1,'Vendor');assert.equal(rows[0].costPrice,75);assert.equal(rows[1].costPrice,null);
  s.put('Purchase_Orders/PO1',{Vendor_ID:'V1',Items_JSON:JSON.stringify([{productCode:'P1',costPrice:0}])});rows[0].costPrice=null;s.c.buildPoVendorMapForMovements_(rows);assert.equal(rows[0].costPrice,0);
});
test('atomic year append survives concurrent writers and refuses read/write failures',()=>{
  const s=setup(),id=s.c.TAX_INVOICE_YEARS_ID;s.put('Meta_Counters/'+id,{Years:[2567]});
  s.c.beforeCommit=()=>s.c.updateTaxInvoiceYearsMeta_(2568);s.c.updateTaxInvoiceYearsMeta_(2569);
  assert.deepEqual(plain(s.value('Meta_Counters/'+id,'Years')).map(Number).sort(),[2567,2568,2569]);
  const count=s.commits.length;s.c.failRequest=()=>503;assert.throws(()=>s.c.updateTaxInvoiceYearsMeta_(2570));assert.equal(s.commits.length,count);
});
function image(s){s.seed();const old=s.makeFile([255,216,255,1]);s.put('Product_Images/P1',{Image_Urls:['https://lh3.googleusercontent.com/d/'+old.id],Drive_File_Ids:[old.id],Primary_Index:0});return old;}
test('image read/delete/write failures leave old files and metadata intact in both APIs',()=>{
  for(const failure of ['read','delete','patch']){
    const s=setup(),old=image(s),cur=s.c.getProductImageDocData_('P1');
    s.c.failRequest=(url,o)=>url.includes('/Product_Images/')&&o.method===(failure==='read'?'get':failure)?503:0;
    const draft={expectedUpdateTime:cur.updateTime,items:failure==='patch'?[{base64:Buffer.from([255,216,255,2]).toString('base64')}]:[],primaryIndex:0};
    assert.equal(s.c.commitProductImageDraft_('P1',draft).success,false);assert.equal(old.trashed,false);assert(s.docs.has('Product_Images/P1'));
    const v2=failure==='patch'?s.c.uploadProductImageV2_('P1',Buffer.from([255,216,255,2]).toString('base64'),0):s.c.deleteProductImageV2_('P1',0);
    assert.equal(v2.success,false);assert.equal(old.trashed,false);
  }
});
test('stale image drafts conflict; lost metadata response keeps files referenced by committed metadata',()=>{
  const s=setup(),old=image(s),cur=s.c.getProductImageDocData_('P1'),draft={expectedUpdateTime:cur.updateTime,items:[{base64:Buffer.from([255,216,255,2]).toString('base64')}],primaryIndex:0};
  s.c.losePatchResponse=true;assert.equal(s.c.commitProductImageDraft_('P1',draft).success,false);
  const current=s.c.getProductImageDocData_('P1');assert.notEqual(current.ids[0],old.id);assert.equal(s.files.get(current.ids[0]).trashed,false);assert.equal(old.trashed,false);
  assert.equal(s.c.commitProductImageDraft_('P1',draft).success,false);
});
test('V2 replacement saves metadata before trashing old file and interoperates with legacy gallery',()=>{
  const s=setup(),old=image(s),r=s.c.uploadProductImageV2_('P1',Buffer.from([255,216,255,2]).toString('base64'),0);
  assert.equal(r.success,true,r.message);assert.equal(old.trashed,true);assert.deepEqual(plain(s.c.getProductImageDocData_('P1').urls),plain(r.imageUrls));
});
test('complete backup has all collections, private image copies, properties and one Firestore snapshot',()=>{
  const s=setup(),original=image(s);s.user({Totp_Enabled:'true'});s.put('Stock_Movements/M1',{Qty:1});s.pageSize=1;s.c.pageSize=1;
  const result=s.c.backupAllDataToBackup_();assert.equal(result.success,true,JSON.stringify(result.errors));
  const bundle=JSON.parse(s.files.get(result.fileId).getBlob().getDataAsString());assert.equal(Object.keys(bundle.collections).length,17);assert.equal(bundle.scriptProperties.AUTH_MASTER_KEY,'test-only-key');assert.equal(bundle.assets[0].originalId,original.id);
  const reads=s.calls.filter(x=>x.url.includes('transaction='));assert.equal(new Set(reads.map(x=>new URL(x.url).searchParams.get('transaction'))).size,1);assert.equal(s.commits.length,0);
  const restore=s.c.restoreFromBackup_(result.fileId,'all');assert.equal(restore.success,true);assert.equal(restore.dryRun,true);assert.equal(s.commits.length,0);
});
test('backup aborts shared storage, partial reads and missing images without publishing a manifest',()=>{
  for(const mode of ['shared','read','image']){
    const s=setup();s.seed();
    if(mode==='shared'){const folder=s.makeFolder(s.c.BACKUP_FOLDER_NAME);folder.getSharingAccess=()=> 'LINK';}
    if(mode==='read')s.c.failRequest=url=>url.includes('/Master_Users?')?503:0;
    if(mode==='image')s.put('Product_Images/P1',{Image_Url:'https://lh3.googleusercontent.com/d/missing',Drive_File_Id:'missing'});
    const r=s.c.backupAllDataToBackup_();assert.equal(r.success,false);assert.equal([...s.files.values()].filter(f=>f.name.startsWith('syy-shop-backup_')&&!f.trashed).length,0);assert.equal(s.commits.length,0);
  }
});
test('restore rehearsal rejects corrupt manifests, incomplete assets and any production target',()=>{
  const s=setup();image(s);const r=s.c.backupAllDataToBackup_();assert.equal(r.success,true);const file=s.files.get(r.fileId),original=file.blob;
  const restore=s.c.restoreFromBackup_(r.fileId,'all',{confirmRestore:true,targetProjectId:'syy-shop'});assert.equal(restore.success,false);assert.equal(s.commits.length,0);
  const bundle=JSON.parse(original.getDataAsString());bundle.collections.Master_Products=[];file.blob=s.c.Utilities.newBlob(JSON.stringify(bundle));assert.equal(s.c.restoreFromBackup_(r.fileId,'all').success,false);assert.equal(s.commits.length,0);
});
test('backup restores into an empty staging database with remapped images, usable accounts and rotated sessions',()=>{
  const s=setup(),original=image(s);s.user();po(s);s.put('Quotations/Q1',{Status:'ร่าง',Quote_Date:'2026-10-11'});
  const backup=s.c.backupAllDataToBackup_();assert.equal(backup.success,true);
  const originalStock=s.value('Master_Products/P1','Current_Stock');s.c.PROJECT_ID='staging-shop';
  const restored=s.c.restoreFromBackup_(backup.fileId,'all',{sourceProjectId:'syy-shop',confirmRestore:true,targetProjectId:'staging-shop',restoreProperties:true,confirmStagingScript:true});
  assert.equal(restored.success,true,JSON.stringify(restored.errors));assert.equal(restored.dryRun,false);
  assert.equal(s.value('staging-shop::Master_Products/P1','Current_Stock'),10);assert.equal(s.value('Master_Products/P1','Current_Stock'),originalStock);
  const newId=restored.imageFileMap[original.id];assert(newId);assert.notEqual(newId,original.id);assert.equal(s.files.get(newId).trashed,false);
  assert.equal(s.value('staging-shop::Product_Images/P1','Drive_File_Id'),newId);assert(s.value('staging-shop::Master_Users/U1','Session_Version'));
  const login=s.c.authLogin('admin','old-password');assert.equal(login.success,true,login.message);assert.equal(s.c.getSession_(login.token).role,'admin');
  assert.equal(s.c.restoreFromBackup_(backup.fileId,'all',{sourceProjectId:'syy-shop',confirmRestore:true,targetProjectId:'staging-shop',restoreProperties:true,confirmStagingScript:true}).success,false,'Non-empty target cannot be overwritten');
});
test('backup recovery restores TOTP key material and accepts a valid OTP on staging',()=>{
  const s=setup(),secret='JBSWY3DPEHPK3PXP';s.user({Totp_Enabled:'true',Totp_Secret_Enc:s.c.encryptSecret_(secret)});
  const backup=s.c.backupAllDataToBackup_();assert.equal(backup.success,true);
  s.c.PROJECT_ID='staging-shop';s.props.AUTH_MASTER_KEY='different-staging-key';
  const restored=s.c.restoreFromBackup_(backup.fileId,'all',{sourceProjectId:'syy-shop',confirmRestore:true,targetProjectId:'staging-shop',restoreProperties:true,confirmStagingScript:true});
  assert.equal(restored.success,true,JSON.stringify(restored.errors));assert.equal(s.c.decryptSecret_(s.value('staging-shop::Master_Users/U1','Totp_Secret_Enc')),secret);
  const otp=s.c.computeTotp_(secret,Math.floor(Date.now()/30000));assert.equal(s.c.authLogin('admin','old-password',otp).success,true);
});
test('a forced password token cannot revive a session after durable revocation',()=>{
  const s=setup();s.user({Must_Change_Password:'true'});const login=s.c.authLogin('admin','old-password');assert.equal(login.needPasswordChange,true);
  s.c.revokeUserSessions_('admin');const writes=s.calls.filter(x=>x.options.method==='patch').length;
  assert.equal(s.c.authChangePasswordForced(login.tempToken,'new-password').success,false);assert.equal(s.calls.filter(x=>x.options.method==='patch').length,writes);
});
