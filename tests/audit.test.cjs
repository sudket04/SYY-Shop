// Regression for audit 19-40: real workers with deterministic mock services.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,plain}=require('./support/services.cjs');
function fresh(){const s=setup();s.c.readTime=new Date().toISOString();return s;}
const queries=s=>s.calls.filter(x=>x.url.endsWith(':runQuery')).map(x=>JSON.parse(x.options.payload));

test('first admin creation never logs or returns a password, fails creation and emails a bound reset link',()=>{
 const s=fresh();s.c.allocateNextAutoId_=()=> 'U1';let logged=[];s.c.Logger={log:(...args)=>logged.push(args)};let mail=[];s.c.MailApp.sendEmail=(...args)=>mail.push(args);
 s.fail=true;s.c.failRequest=(url,o)=>s.fail&&o.method==='post'&&!url.endsWith(':runQuery')?503:0;
 assert.equal(s.c.setupFirstAdmin_().success,false);assert.equal(mail.length,0);
 s.fail=false;const r=s.c.setupFirstAdmin_();assert.equal(r.success,true,r.message);assert.equal(r.emailSent,true);assert.equal(logged.length,0);assert.equal(r.password,undefined);assert.match(mail[0][2],/mode=reset&rtoken=/);assert.equal(s.value('Master_Users/U1','Must_Change_Password'),'true');
 const count=s.docs.size;assert.equal(s.c.setupFirstAdmin_().success,false);assert.equal(s.docs.size,count);
});
test('reset validation and failed write leave token usable; lost response and concurrent use cannot write twice',()=>{
 const s=fresh(),user=s.user(),token=s.c.storePasswordResetToken_(user),key='pwreset_'+token;
 assert.equal(s.c.authResetPassword(token,'short').success,false);assert(s.cache.has(key));
 assert.equal(s.c.authResetPassword(token,'old-password').success,false);assert(s.cache.has(key));
 s.c.failRequest=(url,o)=>o.method==='patch'?503:0;assert.equal(s.c.authResetPassword(token,'new-password').success,false);assert(s.cache.has(key));
 s.c.failRequest=null;s.c.losePatchResponse=true;assert.equal(s.c.authResetPassword(token,'new-password').success,true);assert(!s.cache.has(key));const hash=s.value('Master_Users/U1','Password_Hash');assert.equal(s.c.authResetPassword(token,'another-password').success,false);assert.equal(s.value('Master_Users/U1','Password_Hash'),hash);
 const other=fresh(),t=other.c.storePasswordResetToken_(other.user());let inner;other.c.beforePatch=()=>{inner=other.c.authResetPassword(t,'concurrent-password');};assert.equal(other.c.authResetPassword(t,'outer-password').success,false);assert.equal(inner.success,true);assert.equal(other.value('Master_Users/U1','Password_Hash'),other.c.hashPassword_('concurrent-password',other.value('Master_Users/U1','Salt')));
});
test('revoked/disabled reset binding cannot restore a session or password',()=>{
 for(const change of [{Session_Version:'revoked'},{Status:'Inactive'}]){const s=fresh(),user=s.user(),token=s.c.storePasswordResetToken_(user);s.put('Master_Users/U1',{...user,...change});assert.equal(s.c.authVerifyResetToken(token).success,false);assert.equal(s.c.authResetPassword(token,'new-password').success,false);assert.equal(s.calls.filter(x=>x.options.method==='patch').length,0);}
});
test('failed login CAS counts interleaved attempts, locks at five, and account throttles survive cache eviction',()=>{
 const s=fresh(),user=s.user({Failed_Attempts:3});s.c.beforePatch=()=>s.c.recordFailedLogin_('U1');const r=s.c.recordFailedLogin_('U1');assert.equal(r.ok,true);assert.equal(r.locked,true);assert.equal(s.value('Master_Users/U1','Failed_Attempts'),0);assert(Date.parse(s.value('Master_Users/U1','Locked_Until'))>Date.now());
 for(let i=0;i<20;i++){assert.equal(s.c.allowAuthRequest_('login','same-user'),true);s.cache.clear();}assert.equal(s.c.allowAuthRequest_('login','same-user'),false);s.c.lockBusy=true;assert.equal(s.c.allowAuthRequest_('forgot','new@example.invalid'),false);
});
test('account lookup reads a targeted user, keeps counters fresh, caches only IDs and supports legacy case',()=>{
 const s=fresh();s.user();for(let i=0;i<100;i++)s.put('Master_Users/X'+i,{Username:'user'+i,Email:'u'+i+'@example.invalid',Status:'Active'});
 assert.equal(s.c.findUserByUsername_('admin').docId,'U1');assert.equal(queries(s)[0].structuredQuery.where.fieldFilter.field.fieldPath,'Username');assert(!s.calls.some(x=>/\/documents\/Master_Users\?/.test(x.url)));
 s.put('Master_Users/U1',{Username:'admin',Status:'Inactive',Failed_Attempts:4});assert.equal(s.c.findUserByUsername_('ADMIN').Failed_Attempts,4);assert([...s.cache].filter(([k])=>k.startsWith('auth_lookup_')).every(([,v])=>v==='U1'));
 s.put('Master_Users/LEGACY',{Username:'MixedCase',Email:'Mixed@Example.Invalid',Status:'Active'});assert.equal(s.c.findUserByUsername_('mixedcase').docId,'LEGACY');const before=s.calls.filter(x=>/\/documents\/Master_Users\?/.test(x.url)).length;assert.equal(s.c.findUserByEmail_('mixed@example.invalid').docId,'LEGACY');assert.equal(s.calls.filter(x=>/\/documents\/Master_Users\?/.test(x.url)).length,before);
});
test('master masked writes preserve extra fields; stale baseline and deleted edit do not overwrite or recreate',()=>{
 const s=fresh();s.put('Master_Brands/B1',{Brand_Name:'Original',Note:'keep'});const version=s.docs.get('Master_Brands/B1').updateTime;
 assert.equal(s.c.saveBrand_({docId:'B1',brandName:'New',expectedUpdateTime:version}).success,true);assert.equal(s.value('Master_Brands/B1','Note'),'keep');
 assert.equal(s.c.saveBrand_({docId:'B1',brandName:'Stale',expectedUpdateTime:version}).success,false);assert.equal(s.value('Master_Brands/B1','Brand_Name'),'New');s.docs.delete('Master_Brands/B1');assert.equal(s.c.saveBrand_({docId:'B1',brandName:'Missing'}).success,false);assert(!s.docs.has('Master_Brands/B1'));
});
test('normalized duplicate/customer mapping and read failure block saves before any write',()=>{
 const s=fresh();s.put('Master_Customers/C1',{Customer_Name:'  Buyer   NAME  '});assert.equal(s.c.getFirestoreRawList_('Master_Customers')[0].name,'buyer name');assert.equal(s.c.hasNormalizedDuplicate_('Master_Customers','Customer_Name','Buyer name'),true);
 s.c.failRequest=url=>url.endsWith(':runQuery')?503:0;assert.equal(s.c.saveCustomer_({customerName:'Other'}).success,false);assert.equal(s.calls.filter(x=>x.options.method==='patch').length,0);
});
test('referenced master/product and received/history PO deletion is restricted; empty unused product deletes',()=>{
 const s=fresh();s.seed();s.put('Master_Brands/B1',{Brand_Name:'Brand'});s.put('Master_Products/P1',{Product_Name:'Part',Brand_ID:'B1',Current_Stock:0});assert.equal(s.c.deleteBrand_('B1').success,false);
 s.put('Stock_Movements/M1',{Product_Code:'P1',Qty:1});assert.equal(s.c.deleteProduct_('P1').success,false);s.docs.delete('Stock_Movements/M1');assert.equal(s.c.deleteProduct_('P1').success,true);
 s.put('Purchase_Orders/PO1',{Status:'Received',Items_JSON:'[]',Receipts_JSON:'[]'});assert.equal(s.c.deletePurchaseOrder_('PO1').success,false);
 s.put('Master_Products/P2',{Current_Stock:0});s.put('Purchase_Orders/PO2',{Status:'Cancelled',Items_JSON:'[{"productCode":"P2"}]',Receipts_JSON:'[]'});assert.equal(s.c.deleteProduct_('P2').success,false);assert.equal(s.c.deletePurchaseOrder_('PO2').success,true);
});
test('Thai business date, leap dates and quote expiry are calendar-safe around midnight',()=>{
 const s=fresh();assert.equal(s.c.businessDate_('2026-10-10T17:30:00Z'),'2026-10-11');assert.equal(s.c.addCalendarDays_('2026-10-11',15),'2026-10-26');assert.equal(s.c.addCalendarDays_('2024-02-28',1),'2024-02-29');assert.throws(()=>s.c.addCalendarDays_('2026-02-29',1),/วันที่/);
});
test('cache invalidation rejects old publishers and incomplete chunks, and cache outage does not fail committed write',()=>{
 const s=fresh(),old=s.c.collectionGeneration_('Master_Brands');assert.equal(s.c.writeCollectionCache_('Master_Brands',[{id:'OLD',fields:{}}],old),true);s.c.clearCollectionCache_('Master_Brands');assert.equal(s.c.writeCollectionCache_('Master_Brands',[{id:'STALE',fields:{}}],old),false);
 const gen=s.c.collectionGeneration_('Master_Brands');s.c.writeCollectionCache_('Master_Brands',[{id:'NEW',fields:{}}],gen);assert.equal(s.c.readCollectionCache_('Master_Brands')[0].id,'NEW');const key=[...s.cache.keys()].find(k=>k.includes('__')&&!k.endsWith('manifest'));s.cache.delete(key);assert.equal(s.c.readCollectionCache_('Master_Brands'),null);
 s.put('Master_Brands/B1',{Brand_Name:'Old'});const get=s.c.PropertiesService.getScriptProperties;s.c.PropertiesService.getScriptProperties=()=>({...get(),setProperty(){throw Error('quota');}});assert.equal(s.c.saveBrand_({docId:'B1',brandName:'Saved'}).success,true);assert.equal(s.value('Master_Brands/B1','Brand_Name'),'Saved');assert.equal(s.c.readCollectionCache_('Master_Brands'),null);assert.equal(s.c.writeCollectionCache_('Master_Brands',[],gen),false);
});
test('combined product bootstrap reuses master docs even when cache is unavailable',()=>{
 const s=fresh();s.seed();s.c.CacheService.getScriptCache=()=>({get:()=>null,getAll:()=>({}),put(){},putAll(){},remove(){},removeAll(){}});const r=s.c.getAllProducts_({includeMasters:true});assert.equal(r.products.length,1);assert.equal(r.masters.vendors[0].id,'V1');assert.equal(s.calls.filter(x=>/\/documents\/Master_Vendors\?/.test(x.url)).length,1);
});
test('PO post-save DTO and targeted refresh preserve vendor/contact/cost; numbering outage never scans history',()=>{
 const s=fresh();s.seed();const r=s.c.savePurchaseOrder_({vendorId:'V1',orderDate:'2026-10-11',items:[{productCode:'P1',qty:2,costPrice:0}]});assert.equal(r.success,true,r.message);assert.equal(r.po.items[0].costPrice,0);assert.equal(s.c.getPurchaseOrderPageData_({poId:r.id}).po.poId,r.id);assert(!queries(s).some(x=>x.structuredQuery.from[0].collectionId==='Purchase_Orders'));assert(!s.calls.some(x=>/\/documents\/Master_Vendors\?/.test(x.url)));
 const other=fresh();other.c.nextRunningNumber_=()=>null;const failure=other.c.saveTaxInvoice_({invoiceDate:'2026-10-11',buyerName:'Buyer',items:[{name:'Part',qty:1,unitPrice:1}]});assert.equal(failure.success,false);assert(!other.calls.some(x=>/\/documents\/Master_Tax_Invoice\?/.test(x.url)));
});
test('retention cleanup queries only expired rows, batches guarded deletes and reports only successful commits',()=>{
 const s=fresh();s.put('Activity_Log/old',{Timestamp:'2020-01-01T00:00:00Z'});s.put('Activity_Log/recent',{Timestamp:new Date().toISOString()});s.c.failRequest=url=>url.endsWith(':commit')?503:0;const bad=s.c.cleanupOldActivityLogs_();assert.equal(bad.success,false);assert.equal(bad.deleted,0);assert(s.docs.has('Activity_Log/old'));
 s.c.failRequest=null;const good=s.c.cleanupOldActivityLogs_();assert.equal(good.deleted,1);assert(!s.docs.has('Activity_Log/old'));assert(s.docs.has('Activity_Log/recent'));assert.equal(queries(s)[0].structuredQuery.where.fieldFilter.op,'LESS_THAN');assert(!s.calls.some(x=>/\/documents\/Activity_Log\?/.test(x.url)));
});
test('stable same-date pages return all 1207 invoices without duplicates, hold snapshot, validate cursors and never claim partial totals',()=>{
 const s=fresh();for(let i=0;i<1207;i++)s.put('Master_Tax_Invoice/T'+String(i).padStart(5,'0'),{Invoice_Date:'2026-10-11',Invoice_No:'T'+i});s.c.getTaxInvoiceAvailableYears_=()=>[2569];let page=s.c.getTaxInvoiceListData_(2569,{pageSize:200}),ids=page.invoices.map(x=>x.id);assert.equal(ids.length,200);assert.equal(page.pageInfo.hasMore,true);assert.equal(page.pageInfo.complete,false);
 s.put('Master_Tax_Invoice/NEW',{Invoice_Date:'2026-10-11',Invoice_No:'NEW'});while(page.pageInfo.hasMore){page=s.c.getTaxInvoiceListData_(2569,{pageSize:200,cursor:page.pageInfo.nextCursor});ids.push(...page.invoices.map(x=>x.id));}assert.equal(ids.length,1207);assert.equal(new Set(ids).size,1207);assert(!ids.includes('NEW'));assert.equal(page.pageInfo.complete,true);assert(queries(s).slice(1).every(x=>x.readTime));
 const first=s.c.getTaxInvoiceListData_(2569);assert.throws(()=>s.c.getTaxInvoiceListData_(2568,{cursor:first.pageInfo.nextCursor}),/ไม่ถูกต้อง/);assert.throws(()=>s.c.getTaxInvoiceListData_(2569,{cursor:'invalid'}),/ไม่ถูกต้อง/);assert.throws(()=>s.c.getTaxInvoiceListData_(2569,{pageSize:201}),/ขนาด/);
});
test('open PO product markers and pending count include rows beyond first history page',()=>{
 const s=fresh();for(let i=0;i<70;i++)s.put('Purchase_Orders/O'+i,{Order_Date:'2026-10-11',Status:i===0?'Pending':'Cancelled',Items_JSON:JSON.stringify([{productCode:'OFFPAGE',qty:2,receivedQty:1}]),Receipts_JSON:'[]'});const result=s.c.getPurchaseOrderPageData_();assert.equal(result.purchaseOrders.length,50);assert.equal(result.pageInfo.hasMore,true);assert.equal(result.pendingSummary.codes.OFFPAGE,true);assert.equal(result.pendingSummary.pendingCount,1);
});
test('Dashboard defaults to current/previous Thai years, loads historic year on demand and keeps current health history',()=>{
 const s=fresh(),year=Number(s.c.businessDate_().slice(0,4));s.seed();for(let i=0;i<5;i++)s.put('Stock_Movements/M'+i,{Timestamp:(year-i)+'-07-01T00:00:00Z',Product_Code:'P1',Type:'OUT',Qty:1,Reason:'ขายหน้าร้าน'});
 const r=s.c.getDashboardBootstrap_();assert.equal(r.movements.length,2);assert.equal(r.rangeStart,(year-2)+'-12-31T17:00:00.000Z');assert.equal(r.year,year);const historic=s.c.getDashboardBootstrap_({year:year-3});assert.equal(historic.movements.length,4);assert.equal(historic.healthRangeStart,r.rangeStart);assert.throws(()=>s.c.getDashboardBootstrap_({year:year-5}),/ปี/);
});
test('Car fields round-trip and legacy callers preserve code/note; model-code duplicate is normalized',()=>{
 const s=fresh();s.c.allocateNextAutoId_=()=> 'CAR1';const created=s.c.saveCar_({brand:'Brand',model:'Model',modelCode:'CODE 1',note:'Note'});assert.equal(created.success,true,created.message);let row=s.c.getCarsFull_()[0];assert.equal(row.Model_Code,'CODE 1');assert.equal(row.Note,'Note');assert.equal(s.c.saveCar_({docId:'CAR1',brand:'Updated',model:'Model'}).success,true);assert.equal(s.value('Master_Cars/CAR1','Model_Code'),'CODE 1');assert.equal(s.value('Master_Cars/CAR1','Note'),'Note');assert.equal(s.c.saveCar_({brand:'B',model:'M',modelCode:' code   1 '}).success,false);
});
test('first counter seed includes numbers retained after date edits; write outages fail without reservations',()=>{
 const s=fresh();s.put('Master_Tax_Invoice/OLD',{Invoice_Date:'2025-01-11',Invoice_No:'SYY 10000/10/69'});s.put('Quotations/OLD',{Quote_Date:'2025-01-11',Quote_No:'QT 0035/10/69'});
 assert.equal(s.c.getNextInvoiceRunningNumber_('2026-10-11'),10001);assert.equal(s.c.getNextQuoteRunningNumber_('2026-10-11'),36);assert(queries(s).every(q=>q.structuredQuery.select.fields.length===1));
 s.put('Doc_Running_Numbers/TaxInvoice_1069',{Value:3});s.c.failRequest=url=>url.endsWith(':commit')?503:0;assert.equal(s.c.nextRunningNumber_('TaxInvoice','1069',()=>{throw Error('must not seed');}),null);
});
test('concurrent cache publishers use private chunk IDs so complete snapshots never mix',()=>{
 const s=fresh(),a=[{id:'A1',padding:'a'.repeat(60000)},{id:'A2',padding:'a'.repeat(60000)}],b=[{id:'B1',padding:'b'.repeat(60000)},{id:'B2',padding:'b'.repeat(60000)}],get=s.c.CacheService.getScriptCache;let nested=false;
 s.c.CacheService.getScriptCache=()=>{const cache=get();return {...cache,putAll(values){cache.putAll(values);if(!nested){nested=true;s.c.writeCollectionCache_('Master_Brands',b);}}};};assert.equal(s.c.writeCollectionCache_('Master_Brands',a),true);assert.deepEqual(plain(s.c.readCollectionCache_('Master_Brands')).map(x=>x.id),['A1','A2']);
});
test('reference mutations reuse their lock during auto-ID allocation and release on failure',()=>{
 const s=fresh();s.seed();let held=false,releases=0;s.c.LockService.getScriptLock=()=>({tryLock(){if(held)throw Error('nested acquisition');held=true;return true;},waitLock(){if(held)throw Error('nested acquisition');held=true;},releaseLock(){held=false;releases++;}});
 const r=s.c.withReferenceMutationLock_(()=>s.c.savePurchaseOrder_({vendorId:'V1',orderDate:'2026-10-11',items:[{productCode:'P1',qty:1,costPrice:0}]}));assert.equal(r.success,true,r.message);assert.equal(releases,1);assert.equal(held,false);assert.throws(()=>s.c.withReferenceMutationLock_(()=>{throw Error('test');}),/test/);assert.equal(held,false);
});
test('cold product readback hydrates only its referenced masters, never whole collections',()=>{
 const s=fresh();s.put('Master_Brands/B1',{Brand_Name:'Brand'});s.put('Master_Products/P1',{Product_Name:'Part',Brand_ID:'B1',Current_Stock:0});for(let i=0;i<100;i++)s.put('Master_Brands/X'+i,{Brand_Name:'Unused'+i});const p=s.c.getProductById_('P1');assert.equal(p.brandName,'Brand');assert(!s.calls.some(x=>/\/documents\/Master_(Brands|Categories|Vendors|Zones|Cars)\?/.test(x.url)));assert.equal(s.calls.filter(x=>x.url.endsWith('/Master_Brands/B1')).length,1);
});
test('PO pending summary uses the history snapshot and one projected status-IN query during concurrent status change',()=>{
 const s=fresh();s.put('Purchase_Orders/P1',{Order_Date:'2026-10-11',Status:'Pending',Items_JSON:'[{"productCode":"P1","qty":1}]',Receipts_JSON:'[]'});const fetch=s.c.UrlFetchApp.fetch;s.c.UrlFetchApp.fetch=(url,options)=>{const res=fetch(url,options);if(url.endsWith(':runQuery')&&JSON.parse(options.payload).structuredQuery.orderBy)s.put('Purchase_Orders/P1',{Order_Date:'2026-10-11',Status:'Cancelled',Items_JSON:'[]',Receipts_JSON:'[]'});return res;};
 const r=s.c.getPurchaseOrderPageData_();assert.equal(r.purchaseOrders[0].status,'Pending');assert.equal(r.pendingSummary.pendingCount,1);assert.equal(r.pendingSummary.codes.P1,true);const query=queries(s).find(q=>q.structuredQuery.where?.fieldFilter?.op==='IN');assert(query);assert.equal(query.readTime,r.pageInfo.readTime);assert.equal(query.structuredQuery.select.fields.length,2);
});
