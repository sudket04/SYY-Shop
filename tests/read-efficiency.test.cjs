// In-memory Firestore/Apps Script fixtures only. No live project or credentials.
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,plain,reply}=require('./support/services.cjs');
function fresh(){const s=setup();s.c.readTime=new Date().toISOString();s.reads={};const fetch=s.c.UrlFetchApp.fetch;
 s.c.UrlFetchApp.fetch=(url,o={})=>{const r=fetch(url,o);if(r.getResponseCode()===200){const b=JSON.parse(r.getContentText());const docs=url.endsWith(':runQuery')?b.filter(x=>x.document).map(x=>x.document):url.endsWith(':batchGet')?b.filter(x=>x.found).map(x=>x.found):o.method==='get'?(b.documents||(b.name?[b]:[])):[];for(const d of docs){const col=d.name.split('/documents/')[1].split('/')[0];s.reads[col]=(s.reads[col]||0)+1;}}return r;};
 s.c.UrlFetchApp.fetchAll=rs=>rs.map(r=>s.c.UrlFetchApp.fetch(r.url,r));return s;}
function products(s,n=769){for(let i=0;i<n;i++)s.put('Master_Products/P'+i,{Product_Name:'Part '+i,Current_Stock:10,Min_Stock:2,Cost_Price:100,Selling_Price:200,Extra:'keep'});}
const issue={requestId:'read-test-stock-0001',reason:'ขายหน้าร้าน',items:[{productCode:'P1',qty:2}]};
const queries=s=>s.calls.filter(x=>x.url.endsWith(':runQuery')).map(x=>JSON.parse(x.options.payload));
test('document lists defer all editor collections, editor-only loading does not query documents or years',()=>{
 const s=fresh();products(s,2);s.put('Master_Customers/C1',{Customer_Name:'Buyer'});s.put('Meta_Counters/tax_invoice_years',{Years:[2569]});s.put('Meta_Counters/quotation_years',{Years:[2569]});
 for(const [fn,col] of [['getTaxInvoicePageData_','Master_Tax_Invoice'],['getQuotationPageData_','Quotations']]){s.calls.length=0;const list=s.c[fn](2569,{deferSections:true});assert.equal(list.products,undefined);assert.equal(list.customers,undefined);assert(s.calls.every(c=>!/(Master_Products|Master_Customers)(?:\?|\/|\")/.test(c.url+' '+(c.options.payload||''))));
  s.calls.length=0;const editor=s.c[fn](2569,{editorOnly:true,compactCatalog:true});assert.equal(editor.products.catalogFormat,1);assert.equal(editor.products.rows.length,2);assert.equal(editor.customers.length,1);assert(!s.calls.some(c=>(c.options.payload||'').includes('"collectionId":"'+col+'"')||c.url.includes('/Meta_Counters/')));
 }assert.equal(s.commits.length,0);
});
test('PO history skips the catalog; create skips the history list and both retain the full pending summary',()=>{
 const s=fresh();products(s,3);s.put('Purchase_Orders/PO1',{Status:'Pending',Order_Date:'2026-10-01',Items_JSON:'[{"productCode":"P1","qty":4}]',Receipts_JSON:'[]'});
 const history=s.c.getPurchaseOrderPageData_({section:'history'});assert.equal(history.purchaseOrders.length,1);assert.equal(history.lowStockItems,undefined);assert.equal(history.pendingSummary.pendingCount,1);assert.equal(s.reads.Master_Products||0,0);
 const before=s.calls.length,create=s.c.getPurchaseOrderPageData_({section:'create'});assert.equal(create.purchaseOrders,undefined);assert.equal(create.pendingSummary.pendingCount,1);assert(!s.calls.slice(before).some(c=>{const q=c.options.payload&&JSON.parse(c.options.payload).structuredQuery;return q&&q.from[0].collectionId==='Purchase_Orders'&&q.orderBy;}));assert.equal(s.commits.length,0);
});

test('10,000-product document refresh model measures section payload savings and reused year metadata without DB mutations',()=>{
 const s=fresh();products(s,10000);s.put('Master_Customers/C1',{Customer_Name:'Buyer'});s.put('Meta_Counters/quotation_years',{Years:[2569]});
 for(let i=0;i<50;i++)s.put('Quotations/Q'+i,{Quote_Date:'2026-10-01',Quote_No:'Q'+i,Items_JSON:'[]'});
 const first=s.c.getQuotationPageData_(2569,{compactCatalog:true}),before=s.reads.Master_Products;let repeat;
 for(let i=0;i<9;i++)repeat=s.c.getQuotationPageData_(2569,{compactCatalog:true,sectionVersions:first.sectionVersions});
 const fullBytes=Buffer.byteLength(JSON.stringify(first)),repeatBytes=Buffer.byteLength(JSON.stringify(repeat)),saved=100*(1-repeatBytes/fullBytes),yearRequests=s.calls.filter(x=>x.url.includes('/Meta_Counters/quotation_years')).length;
 assert.equal(first.products.rows.length,10000);assert.equal(repeat.products,undefined);assert.equal(repeat.customers,undefined);assert(saved>95);assert.equal(s.reads.Master_Products,before);assert.equal(yearRequests,1);assert.equal(s.commits.length,0);
 require('node:fs').writeFileSync(require('node:path').join(__dirname,'..','test-results','cache-quality-read-model.json'),JSON.stringify({fixtureOnly:true,products:10000,requests:10,initialPayloadBytes:fullBytes,unchangedPayloadBytes:repeatBytes,payloadReductionPercent:Number(saved.toFixed(2)),yearMetadataRequests:yearRequests,yearRequestReductionPercent:90,additionalProductDocumentsRead:s.reads.Master_Products-before,productionMeasurements:false},null,2));
});

test('stock commit patches only one authoritative product; cache order/unknown fields/expiry survive, stock writes remain atomic with bill metadata',()=>{
 const s=fresh();products(s);s.c.getAllProducts_();const base=s.c.collectionCacheBaseKey_('Master_Products'),expiry=JSON.parse(s.cache.get(base+'__manifest')).expiresAt,order=s.c.readCollectionCache_('Master_Products').map(x=>x.id);
 s.reads={};const r=s.c.issueStock_(issue,'staff');assert.equal(r.success,true,r.message);assert.equal(s.value('Master_Products/P1','Current_Stock'),8);
 // One authoritative stock precondition read and one raw read for the cache patch.
 assert.equal(s.reads.Master_Products,2);const before=s.reads.Master_Products;assert.equal(s.c.getAllProducts_().find(p=>p.id==='P1').currentStock,8);assert.equal(s.reads.Master_Products,before);
 const cached=s.c.readCollectionCache_('Master_Products');assert.deepEqual(plain(cached.map(x=>x.id)),plain(order));assert.equal(s.c.parseFirestoreValue_(cached.find(p=>p.id==='P1').fields.Extra),'keep');assert.equal(JSON.parse(s.cache.get(base+'__manifest')).expiresAt,expiry);
 assert.equal(s.commits.length,1);assert.equal(s.commits[0].length,4);assert.equal(s.docs.size,772);
});
test('concurrent cache patches discard the stale publisher and recover all affected products',()=>{
 const s=fresh();products(s,3);s.c.getAllProducts_();s.put('Master_Products/P1',{Product_Name:'P1',Current_Stock:8});
 const fetch=s.c.UrlFetchApp.fetch;let interleaved=false;s.c.UrlFetchApp.fetch=(url,o)=>{if(url.endsWith(':batchGet')&&!interleaved){interleaved=true;s.put('Master_Products/P2',{Product_Name:'P2',Current_Stock:7});s.c.refreshChangedProductsCache_(['P2']);}return fetch(url,o);};
 s.c.refreshChangedProductsCache_(['P1']);assert.equal(s.c.readCollectionCache_('Master_Products'),null);const rows=s.c.getAllProducts_();assert.equal(rows.find(x=>x.id==='P1').currentStock,8);assert.equal(rows.find(x=>x.id==='P2').currentStock,7);
});
test('cache outage and patch read failure cannot turn a successful stock commit into a retry',()=>{
 for(const mode of ['cache','read']){const s=fresh();products(s,3);s.c.getAllProducts_();
  if(mode==='cache')s.c.CacheService.getScriptCache=()=>({get(){throw Error('cache outage');},put(){throw Error('cache outage');}});
  else {let n=0;s.c.failRequest=url=>url.endsWith(':batchGet')&&++n===2?503:0;}
  const r=s.c.issueStock_(issue,'staff');assert.equal(r.success,true,r.message);assert.equal(s.value('Master_Products/P1','Current_Stock'),8);assert.equal(s.c.readCollectionCache_('Master_Products'),null);
 }
});
test('missing and expired catalog caches never cause a full collection read inside a stock commit',()=>{
 for(const expired of [false,true]){const s=fresh();products(s,3);if(expired){s.c.getAllProducts_();const key=s.c.collectionCacheBaseKey_('Master_Products')+'__manifest',m=JSON.parse(s.cache.get(key));m.expiresAt=Date.now()-1;s.cache.set(key,JSON.stringify(m));}s.calls.length=0;
  assert.equal(s.c.issueStock_(issue,'staff').success,true);assert(!s.calls.some(x=>/Master_Products\?/.test(x.url)));assert.equal(s.c.readCollectionCache_('Master_Products'),null);
 }
});
test('dashboard adjacent year has no overlap; repeat snapshot is shared and force/reconciliation still reads fresh',()=>{
 const s=fresh(),year=Number(s.c.businessDate_().slice(0,4));s.c.getAllProducts_=()=>[];
 for(let age=0;age<5;age++)for(let i=0;i<1000;i++)s.put('Stock_Movements/M'+age+'-'+i,{Timestamp:(year-age)+'-07-01T00:00:00Z',Type:'OUT',Qty:1});
 let r=s.c.getDashboardBootstrap_({year:year-1});assert.equal(r.movements.length,3000);assert.equal(s.reads.Stock_Movements,3000);
 for(let i=0;i<4;i++)s.c.getDashboardBootstrap_({year:year-1});assert.equal(s.reads.Stock_Movements,3000);
 s.c.getDashboardBootstrap_({year:year-1,force:true});assert.equal(s.reads.Stock_Movements,6000);
 s.c.clearCollectionCache_('Stock_Movements');s.c.getDashboardBootstrap_({year:year-1});assert.equal(s.reads.Stock_Movements,9000);
 const old=s.c.getDashboardBootstrap_({year:year-4});assert.equal(old.movements.length,3000);const q=queries(s).slice(-2);assert.equal(q[1].readTime,q[0].readTime||s.c.readTime);
});
test('stale/future delta cursors are rejected before Firestore; valid delta drains 550 rows with same-time ties',()=>{
 const s=fresh();s.seed();for(const value of ['2000-01-01','bad',new Date(Date.now()+120000).toISOString()])assert.equal(s.c.getDashboardDelta_(value).fullRefresh,true);assert.equal(s.calls.length,0);
 const since=new Date(Date.now()-20000).toISOString(),committed=new Date(Date.now()-10000).toISOString();
 for(let i=0;i<550;i++){const key='Stock_Movements/M'+String(i).padStart(4,'0');s.put(key,{Type:'OUT',Product_Code:'P1',Timestamp:'2020-01-01T00:00:00Z',Qty:1});s.docs.get(key).fields.Committed_At={timestampValue:committed};}
 let r=s.c.getDashboardDelta_(since),ids=r.movements.map(x=>x.id),pages=1;assert.equal(ids.length,200);s.put('Stock_Movements/NEW',{Type:'OUT',Timestamp:'2020-01-01T00:00:00Z',Committed_At:new Date().toISOString(),Product_Code:'P1'});
 while(r.hasMore){r=s.c.getDashboardDelta_(since,{cursor:r.nextCursor});ids.push(...r.movements.map(x=>x.id));pages++;}
 assert.equal(pages,3);assert.equal(ids.length,550);assert.equal(new Set(ids).size,550);assert(!ids.includes('NEW'));assert.equal(r.serverTime,s.c.readTime);assert(queries(s).every(q=>q.structuredQuery.limit===201));assert(queries(s).slice(1).every(q=>q.readTime===s.c.readTime));
});
test('history loads 51 document results initially, drains the original 1000-row scope and holds its snapshot',()=>{
 const s=fresh();for(let i=0;i<1200;i++)s.put('Stock_Movements/M'+String(i).padStart(4,'0'),{Timestamp:'2026-10-01T00:00:00Z',Doc_No:'SI'+i,Type:'OUT',Qty:1});
 let r=s.c.getStockMovementPage_(),ids=r.movements.map(x=>x.id);assert.equal(s.reads.Stock_Movements,51);assert.equal(ids.length,50);const cursor=r.pageInfo.nextCursor;
 s.put('Stock_Movements/NEW',{Timestamp:'2026-10-12T00:00:00Z',Type:'OUT'});
 while(r.pageInfo.hasMore){r=s.c.getStockMovementPage_({pageSize:200,cursor:r.pageInfo.nextCursor});ids.push(...r.movements.map(x=>x.id));}
 assert.equal(ids.length,1000);assert.equal(new Set(ids).size,1000);assert(!ids.includes('NEW'));assert.equal(r.pageInfo.olderAvailable,true);assert.equal(r.pageInfo.scopeComplete,true);
 for(const options of [{pageSize:201},{pageSize:-1},{cursor:'bad'}])assert.throws(()=>s.c.getStockMovementPage_(options));
 assert.throws(()=>s.c.getDashboardDelta_(new Date().toISOString(),{cursor}),/ไม่ถูกต้อง/);
});
test('history cursor tampering cannot reset the row cap, change position or replay across projects',()=>{
 const s=fresh();for(let i=0;i<55;i++)s.put('Stock_Movements/M'+i,{Timestamp:'2026-10-01T00:00:00Z',Type:'OUT'});
 const token=s.c.getStockMovementPage_().pageInfo.nextCursor,[encoded,signature]=token.split('.'),cursor=JSON.parse(Buffer.from(encoded,'base64').toString()),before=s.calls.length;
 for(const patch of [{offset:1},{name:cursor.name+'-old'},{readTime:'2000-01-01T00:00:00Z'}]){const bad=Buffer.from(JSON.stringify({...cursor,...patch})).toString('base64')+'.'+signature;assert.throws(()=>s.c.getStockMovementPage_({cursor:bad}),/ไม่ถูกต้อง/);}
 s.c.PROJECT_ID='another-project';assert.throws(()=>s.c.getStockMovementPage_({cursor:token}),/ไม่ถูกต้อง/);assert.equal(s.calls.length,before);
});
test('a streamed first page pins its latest guaranteed readTime for every continuation',()=>{
 const s=fresh();for(let i=0;i<55;i++)s.put('Stock_Movements/M'+i,{Timestamp:'2026-10-01T00:00:00Z',Type:'OUT'});
 const fetch=s.c.UrlFetchApp.fetch;s.c.UrlFetchApp.fetch=(url,o)=>{const r=fetch(url,o);if(url.endsWith(':runQuery')&&!JSON.parse(o.payload).readTime){const rows=JSON.parse(r.getContentText());rows[0].readTime=new Date(Date.parse(s.c.readTime)-1000).toISOString();return reply(200,rows);}return r;};
 const first=s.c.getStockMovementPage_();assert.equal(first.pageInfo.readTime,s.c.readTime);const last=s.c.getStockMovementPage_({cursor:first.pageInfo.nextCursor});assert.equal(last.movements.length,5);assert.equal(queries(s).at(-1).readTime,s.c.readTime);
});
test('PO bootstrap shares a complete page and pending snapshot, and invalidates on status/receipt/create/delete paths',()=>{
 const s=fresh();for(let i=0;i<200;i++)s.put('Purchase_Orders/PO'+i,{Order_Date:'2026-10-01',Status:'Pending',Items_JSON:'[]',Receipts_JSON:'[]'});
 const first=s.c.getPurchaseOrderPageData_();assert.equal(first.pendingSummary.pendingCount,200);assert.equal(s.reads.Purchase_Orders,251);s.c.getPurchaseOrderPageData_();assert.equal(s.reads.Purchase_Orders,251);
 assert.equal(s.c.updatePurchaseOrderStatus_('PO0','Ordered').success,true);assert.equal(s.c.getPurchaseOrderPageData_().pendingSummary.pendingCount,199);
 const before=s.reads.Purchase_Orders;s.c.getPurchaseOrderPageData_({force:true});assert.equal(s.reads.Purchase_Orders-before,251);
 const version=s.c.collectionGeneration_('Purchase_Orders');s.c.fsCommit_([{update:{name:s.c.fsDocPath_('Purchase_Orders','PO1'),fields:s.c.mapToFirestoreFields_({Status:'Received'})},updateMask:{fieldPaths:['Status']}}]);assert.notEqual(s.c.collectionGeneration_('Purchase_Orders'),version);
 assert.equal(s.c.getPurchaseOrderPageData_().pendingSummary.pendingCount,198);
 assert.equal(s.c.deletePurchaseOrder_('PO2').success,true);assert.equal(s.c.getPurchaseOrderPageData_().pendingSummary.pendingCount,197);
 assert.equal(s.c.saveMasterData_('Purchase_Orders','PO',null,{Order_Date:'2026-10-01',Status:'Pending',Items_JSON:'[]',Receipts_JSON:'[]'}).success,true);assert.equal(s.c.getPurchaseOrderPageData_().pendingSummary.pendingCount,198);
});
test('PO historic costs reuse reads, preserve zero and recorded costs, and follow PO invalidation',()=>{
 const s=fresh();s.seed();s.put('Purchase_Orders/PO1',{Vendor_ID:'V1',Items_JSON:'[{"productCode":"P1","costPrice":0}]'});
 const rows=()=>[{type:'IN',refNo:'PO1',productCode:'P1',costPrice:null},{type:'IN',refNo:'PO1',productCode:'P1',costPrice:55}];
 for(let i=0;i<3;i++){const r=rows();s.c.buildPoVendorMapForMovements_(r);assert.equal(r[0].costPrice,0);assert.equal(r[1].costPrice,55);}assert.equal(s.reads.Purchase_Orders,1);
 s.put('Purchase_Orders/PO1',{Vendor_ID:'V1',Items_JSON:'[{"productCode":"P1","costPrice":25}]'});s.c.clearCollectionCache_('Purchase_Orders');const r=rows();s.c.buildPoVendorMapForMovements_(r);assert.equal(r[0].costPrice,25);assert.equal(s.reads.Purchase_Orders,2);
});
test('duplicate validation shares one scan during cache outage without weakening exact/normalized checks',()=>{
 const s=fresh();products(s);s.c.CacheService.getScriptCache=()=>({get:()=>null,getAll:()=>({}),put(){},putAll(){},remove(){},removeAll(){}});
 const memo={};for(const field of ['Product_Name','Part_Number','Barcode'])assert.equal(s.c.hasNormalizedDuplicate_('Master_Products',field,'new','',memo),false);assert.equal(s.reads.Master_Products,769);assert.equal(queries(s).length,3);
 assert.equal(s.c.hasNormalizedDuplicate_('Master_Products','Product_Name','  PART   1 ','',{}),true);
});
test('PO cost cache keys distinguish delimiter-containing IDs and inherited object names',()=>{
 const s=fresh();s.seed();['A|B','C','A','B|C','constructor'].forEach((id,i)=>s.put('Purchase_Orders/'+id,{Vendor_ID:'V1',Items_JSON:JSON.stringify([{productCode:'P1',costPrice:i+10}])}));
 const rows=ids=>ids.map(refNo=>({type:'IN',refNo,productCode:'P1',costPrice:null}));
 for(const ids of [['A|B','C'],['A','B|C'],['constructor']]){const r=rows(ids);s.c.buildPoVendorMapForMovements_(r);assert(r.every(x=>x.costPrice!==null));}
 const r=rows(['A','B|C']);s.c.buildPoVendorMapForMovements_(r);assert.deepEqual(r.map(x=>x.costPrice),[12,13]);assert.equal(s.reads.Purchase_Orders,5);
});
test('ambiguous stock/delete responses invalidate snapshots and replay never repeats a committed sale',()=>{
 const s=fresh();products(s,3);s.c.getAllProducts_();s.c.loseCommitResponse=true;
 const result=s.c.issueStock_(issue,'staff');assert.equal(result.success,false);assert.equal(s.value('Master_Products/P1','Current_Stock'),8);assert.equal(s.c.readCollectionCache_('Master_Products'),null);
 const replay=s.c.issueStock_(issue,'staff');assert.equal(replay.success,true);assert.equal(replay.replayed,true);assert.equal(s.commits.length,1);assert.equal(s.c.getAllProducts_().find(p=>p.id==='P1').currentStock,8);
 s.put('Purchase_Orders/PO1',{Status:'Pending',Items_JSON:'[]',Receipts_JSON:'[]'});s.c.getPurchaseOrderPageData_();const generation=s.c.collectionGeneration_('Purchase_Orders'),fetch=s.c.UrlFetchApp.fetch;
 s.c.UrlFetchApp.fetch=(url,o)=>{const r=fetch(url,o);if(o.method==='delete')throw Error('lost delete response');return r;};
 assert.equal(s.c.deletePurchaseOrder_('PO1').success,false);assert(!s.docs.has('Purchase_Orders/PO1'));assert.notEqual(s.c.collectionGeneration_('Purchase_Orders'),generation);assert.equal(s.c.getPurchaseOrderPageData_().pendingSummary.pendingCount,0);
});
test('gateway throttling stops heavy reads while authentication/revocation still use fresh user documents',()=>{
 const s=fresh(),user=s.user({Role:'viewer'}),token=s.c.createSession_(user).token;let reached=0;s.c.API_FUNCTIONS.getDashboardBootstrap=()=>({success:true,count:++reached});
 for(let i=0;i<30;i++)assert.equal(s.c.apiGateway(token,'getDashboardBootstrap',[]).success,true);
 assert.equal(s.c.apiGateway(token,'getDashboardBootstrap',[]).readLimited,true);assert.equal(reached,30);assert.equal(s.reads.Master_Users,32);
 s.docs.get('Master_Users/U1').fields.Status={stringValue:'Inactive'};assert.equal(s.c.apiGateway(token,'getDashboardBootstrap',[]).__authError,true);assert.equal(reached,30);assert.equal(s.reads.Master_Users,33);assert.equal(s.commits.length,0);
});
test('car reference checks query only a matching legacy/scalar or array reference and fail closed on errors',()=>{
 const s=fresh();products(s);s.put('Master_Products/P1',{Car_IDs:['CAR1']});assert.throws(()=>s.c.assertDeleteAllowed_('Master_Cars','CAR1',{fields:{}}),/อ้างอิง/);assert.equal(s.reads.Master_Products,1);
 s.c.assertDeleteAllowed_('Master_Cars','UNUSED',{fields:{}});assert(!s.calls.some(x=>/Master_Products\?/.test(x.url)));assert(queries(s).every(q=>q.structuredQuery.limit===1));
 s.put('Master_Products/P2',{Car_ID:'CAR2'});assert.throws(()=>s.c.assertDeleteAllowed_('Master_Cars','CAR2',{fields:{}}),/อ้างอิง/);
 s.c.failRequest=url=>url.endsWith(':runQuery')?503:0;assert.throws(()=>s.c.assertDeleteAllowed_('Master_Cars','UNUSED',{fields:{}}));
});
test('overlapping cold callers wait for a producer, then reuse the same collection without another scan',()=>{
 const s=fresh();products(s,100);const lease=s.c.readCacheKey_('lease:collection:Master_Products');s.cache.set(lease,JSON.stringify({owner:'producer',until:Date.now()+15000}));let filled=false;
 s.c.Utilities.sleep=()=>{if(!filled){filled=true;const all=s.c.fetchAllPagesRaw_('Master_Products');s.c.writeCollectionCache_('Master_Products',all.docs,s.c.collectionGeneration_('Master_Products'));}};
 for(let i=0;i<5;i++)assert.equal(s.c.fetchCollectionDocsCached_('Master_Products').length,100);assert.equal(s.reads.Master_Products,100);assert.equal(JSON.parse(s.cache.get(lease)).owner,'producer');
});
test('result caches reject changed generations, missing chunks, expired values and failed loaders',()=>{
 const s=fresh(),scopes=['Stock_Movements'];let calls=0;const run=()=>s.c.cachedReadResult_('test',scopes,60000,()=>({value:++calls}));assert.equal(run().value,1);assert.equal(run().value,1);
 const key=s.c.readCacheKey_('test'),m=JSON.parse(s.cache.get(key));s.cache.delete(key+'_'+m.id+'_0');assert.equal(run().value,2);
 s.c.clearCollectionCache_('Stock_Movements');assert.equal(run().value,3);const expired=JSON.parse(s.cache.get(key));expired.expiresAt=Date.now()-1;s.cache.set(key,JSON.stringify(expired));assert.equal(run().value,4);
 assert.throws(()=>s.c.cachedReadResult_('failed',scopes,60000,()=>{throw Error('read failure');}));assert.equal(s.c.readResultCache_('failed',scopes,60000),null);
 const version=s.c.readCacheVersion_(scopes);s.c.clearCollectionCache_('Stock_Movements');s.c.writeResultCache_('stale',scopes,{value:'old'},60000,version,Date.now());assert.equal(s.c.readResultCache_('stale',scopes,60000),null);
});
test('read throttles survive cache eviction, isolate accounts and never throttle writes; backup excludes counters',()=>{
 const s=fresh();for(let i=0;i<30;i++){assert.equal(s.c.allowReadRequest_('getDashboardBootstrap','viewer'),true);s.cache.clear();}assert.equal(s.c.allowReadRequest_('getDashboardBootstrap','viewer'),false);assert.equal(s.c.allowReadRequest_('getDashboardBootstrap','another'),true);
 for(let i=0;i<200;i++)assert.equal(s.c.allowReadRequest_('issueStock','viewer'),true);assert(!Object.keys(s.c.backupScriptProperties_()).some(k=>k.startsWith('read_rate_')));assert.equal(s.calls.length,0);assert.equal(s.commits.length,0);
});
