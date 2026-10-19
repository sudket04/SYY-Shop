// Deterministic in-memory services: no production credentials, data or network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {setup:setupServices,plain}=require('./support/services.cjs');
const setup=()=>setupServices({legacyBackup:true});

const issue={requestId:'request-stock-0001',reason:'ขายหน้าร้าน',items:[{productCode:'P1',qty:2}]};
const receive={requestId:'request-receive-0001',poId:'PO1',invoiceNo:'INV1',receiptDate:'2026-10-11',receiverName:'Staff',deliveryNoteNo:'DN1',items:[{productCode:'P1',qtyReceivedNow:5}]};
function po(s){s.put('Purchase_Orders/PO1',{Status:'Ordered',Vendor_ID:'V1',Items_JSON:JSON.stringify([{productCode:'P1',productName:'Part',qty:10,costPrice:75,receivedQty:0}]),Receipts_JSON:'[]'});}

test('stock retry replays committed result without a second stock or movement write',()=>{
  const s=setup();s.seed();const first=s.c.issueStock_(issue,'staff'),second=s.c.issueStock_(plain(issue),'staff');
  assert.equal(first.success,true,first.message);assert.equal(second.docNo,first.docNo);assert.equal(second.replayed,true);assert.equal(s.value('Master_Products/P1','Current_Stock'),8);assert.equal(s.commits.length,1);assert.equal(s.docs.size,5);
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
  const s=setup();s.c.readTime=new Date().toISOString();s.seed();s.put('Stock_Movements/late',{Doc_No:'SI-late',Type:'OUT',Product_Code:'P1',Qty:1,Timestamp:'2026-10-11T04:00:00Z',Committed_At:new Date(Date.now()-10000).toISOString()});
  const data=s.c.getDashboardDelta_(new Date(Date.now()-20000).toISOString());assert.equal(data.movements.length,1);assert.equal(data.serverTime,s.c.readTime);
  s.c.failRequest=url=>url.endsWith(':runQuery')?503:0;assert.throws(()=>s.c.getDashboardDelta_(data.serverTime));
});
test('historic receiving cost comes from PO snapshot, including zero; missing cost remains unknown',()=>{
  const s=setup();s.seed();po(s);const rows=[{type:'IN',refNo:'PO1',productCode:'P1',costPrice:null},{type:'IN',refNo:'MISSING',productCode:'P1',costPrice:null}];
  assert.equal(s.c.buildPoVendorMapForMovements_(rows).PO1,'Vendor');assert.equal(rows[0].costPrice,75);assert.equal(rows[1].costPrice,null);
  s.put('Purchase_Orders/PO1',{Vendor_ID:'V1',Items_JSON:JSON.stringify([{productCode:'P1',costPrice:0}])});s.c.clearCollectionCache_('Purchase_Orders');rows[0].costPrice=null;s.c.buildPoVendorMapForMovements_(rows);assert.equal(rows[0].costPrice,0);
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
