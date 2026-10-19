const {test}=require('node:test');
const assert=require('node:assert/strict');
const {setup,plain}=require('./support/services.cjs');
const sale={requestId:'bill-request-0001',reason:'ขายหน้าร้าน',items:[{productCode:'P1',qty:2}]};
function old(s,no='SI-old-uuid',stamp='2026-10-18T17:01:00.000Z',id=no+'-1',extra={}){
 s.put('Stock_Movements/'+id,{Doc_No:no,Type:'OUT',Timestamp:stamp,Product_Code:'P1',Qty:2,Unit_Price:125,Stock_Before:10,Stock_After:8,...extra});
}
test('Bangkok midnight starts a new Gregorian daily sequence and supports over 9999 bills',()=>{
 const s=setup();assert.equal(s.c.salesBillDay_('2026-10-18T16:59:59Z'),'20261018');assert.equal(s.c.salesBillDay_('2026-10-18T17:00:00Z'),'20261019');
 assert.equal(s.c.salesBillNumber_('20261019',1),'SI-20261019-0001');assert.equal(s.c.salesBillNumber_('20261019',10000),'SI-20261019-10000');assert.throws(()=>s.c.salesBillDay_('bad'));
});
test('one sale commits stock, alias, counter and unique reservation atomically; replay keeps both identities',()=>{
 const s=setup();s.seed();const r=s.c.issueStock_(sale,'staff');assert.equal(r.success,true,r.message);assert.match(r.billNo,/^SI-\d{8}-0001$/);assert.equal(r.docNo,'SI-'+sale.requestId);
 assert.equal(s.commits.length,1);assert.equal(s.commits[0].length,4);assert.equal(s.value('Stock_Movements/'+r.docNo+'-1','Bill_No'),r.billNo);
 const again=s.c.issueStock_(sale,'staff');assert.equal(again.replayed,true);assert.equal(again.billNo,r.billNo);assert.equal(s.commits.length,1);
 assert.equal(s.c.getStockMovementDetail_(r.docNo).billNo,r.billNo);assert.equal(s.c.stockMovementDto_(s.docs.get('Stock_Movements/'+r.docNo+'-1')).billNo,r.billNo);
 assert.equal(s.c.mapDashboardMovementRow_({document:s.docs.get('Stock_Movements/'+r.docNo+'-1')}).billNo,r.billNo);
});
test('parallel distinct sales retry CAS without reusing a bill number or losing stock',()=>{
 const s=setup();s.seed();let other;s.c.beforeCommit=()=>{other=s.c.issueStock_({...sale,requestId:'bill-request-0002'},'staff');assert.equal(other.success,true,other.message);};
 const r=s.c.issueStock_(sale,'staff');assert.equal(r.success,true,r.message);assert.match(other.billNo,/-0001$/);assert.match(r.billNo,/-0002$/);assert.equal(s.value('Master_Products/P1','Current_Stock'),6);assert.equal(s.commits.length,2);
});
test('a rejected sale or unavailable counter consumes neither number nor stock',()=>{
 for(const mode of ['stock','counter']){const s=setup();s.seed();if(mode==='counter')s.c.failRequest=url=>url.includes('/Doc_Running_Numbers/')?503:0;
 const r=s.c.issueStock_({...sale,items:[{productCode:'P1',qty:mode==='stock'?11:2}]},'staff');assert.equal(r.success,false);assert.equal(s.commits.length,0);assert.equal(s.value('Master_Products/P1','Current_Stock'),10);}
});
test('deleted counter cannot reuse a previously reserved label',()=>{
 const s=setup();s.seed();const first=s.c.issueStock_(sale,'staff');s.docs.delete('Doc_Running_Numbers/SI_'+first.billNo.split('-')[1]);
 assert.equal(s.c.issueStock_({...sale,requestId:'bill-request-0002'},'staff').success,false);assert.equal(s.commits.length,1);assert.equal(s.value('Master_Products/P1','Current_Stock'),8);
});
test('lost commit response and subsequent retry preserve committed bill number',()=>{
 const s=setup();s.seed();s.c.loseCommitResponse=true;s.c.issueStock_(sale,'staff');const r=s.c.issueStock_(sale,'staff');assert.equal(r.replayed,true);assert.match(r.billNo,/-0001$/);assert.equal(s.commits.length,1);
});
test('quotation reference receives human alias while retaining original internal Doc_No and recorded negotiated price',()=>{
 const s=setup();s.seed();s.put('Quotations/Q1',{Status:'ปิดงาน-ขายสำเร็จ',Items_JSON:JSON.stringify([{productCode:'P1',unitPrice:125}])});
 const r=s.c.issueStock_({...sale,quoteId:'Q1'},'staff');assert.equal(r.success,true,r.message);assert.equal(s.value('Quotations/Q1','Stock_Issue_Doc'),r.docNo);assert.equal(s.value('Quotations/Q1','Stock_Issue_Bill_No'),r.billNo);assert.equal(s.value('Stock_Movements/'+r.docNo+'-1','Unit_Price'),125);
});
test('backfill preview is read-only and plans complete bills in chronological order, linked quotes included',()=>{
 const s=setup();old(s,'SI-later','2026-10-19T03:00:00Z');old(s);old(s,'SI-old-uuid','2026-10-18T17:01:00.000Z','SI-old-uuid-2');s.put('Quotations/Q1',{Stock_Issue_Doc:'SI-old-uuid'});
 const plan=s.c.planSalesBillBackfill_('20261019');assert.equal(s.commits.length,0);assert.equal(plan.entries[0].docNo,'SI-old-uuid');assert.equal(plan.entries[0].billNo,'SI-20261019-0001');assert.equal(plan.entries[0].rows.length,2);assert.equal(plan.entries[0].quotes.length,1);assert.equal(s.c.inspectSalesBillBackfill_().writes,0);
});
test('approved backfill patches only alias fields; repeat plans leave existing aliases unchanged',()=>{
 const s=setup();s.seed();old(s);s.put('Quotations/Q1',{Stock_Issue_Doc:'SI-old-uuid',Total_Amount:250});const before=plain(s.docs.get('Stock_Movements/SI-old-uuid-1').fields);
 const plan=s.c.planSalesBillBackfill_('20261019'),result=s.c.applySalesBillBackfill_('20261019',plan.planHash);assert.equal(result.complete,true,result.message);assert.equal(s.value('Stock_Movements/SI-old-uuid-1','Bill_No'),'SI-20261019-0001');
 const after=plain(s.docs.get('Stock_Movements/SI-old-uuid-1').fields);delete after.Bill_No;assert.deepEqual(after,before);assert.equal(s.value('Master_Products/P1','Current_Stock'),10);assert.equal(s.value('Quotations/Q1','Stock_Issue_Doc'),'SI-old-uuid');assert.equal(s.value('Quotations/Q1','Total_Amount'),250);
 assert.equal(s.c.planSalesBillBackfill_('20261019').entries.length,0);assert.throws(()=>s.c.applySalesBillBackfill_('20261019',plan.planHash));
});
test('backfill rejects stale approval, partial/colliding aliases, cross-day bills and corrupt counter',()=>{
 for(const mode of ['stale','partial','collision','crossday','counter']){const s=setup();old(s);
  if(mode==='stale'){const plan=s.c.planSalesBillBackfill_('20261019');old(s,'SI-new');assert.throws(()=>s.c.applySalesBillBackfill_('20261019',plan.planHash));}
  if(mode==='partial'){old(s,'SI-old-uuid',undefined,'SI-old-uuid-2',{Bill_No:'SI-20261019-0001'});assert.throws(()=>s.c.planSalesBillBackfill_('20261019'));}
  if(mode==='collision'){old(s,undefined,undefined,undefined,{Bill_No:'SI-20261019-0001'});old(s,'SI-other',undefined,undefined,{Bill_No:'SI-20261019-0001'});assert.throws(()=>s.c.planSalesBillBackfill_('20261019'));}
  if(mode==='crossday'){old(s,'SI-old-uuid','2026-10-19T17:00:00Z','SI-old-uuid-2');assert.throws(()=>s.c.planSalesBillBackfill_('20261019'));}
  if(mode==='counter'){s.put('Doc_Running_Numbers/SI_20261019',{Value:'broken'});assert.throws(()=>s.c.planSalesBillBackfill_('20261019'));}
  assert.equal(s.commits.length,0);
 }
});
test('backfill stale movement CAS rolls back all aliases and counter changes',()=>{
 const s=setup();old(s);const plan=s.c.planSalesBillBackfill_('20261019');s.c.beforeCommit=()=>old(s,undefined,undefined,undefined,{Note:'concurrent change'});
 const r=s.c.applySalesBillBackfill_('20261019',plan.planHash);assert.equal(r.complete,false);assert.equal(s.commits.length,0);assert.equal(s.value('Stock_Movements/SI-old-uuid-1','Bill_No'),'');
});
test('backfill lost response is reported for reconciliation; next plan recognizes committed alias',()=>{
 const s=setup();old(s);const plan=s.c.planSalesBillBackfill_('20261019');s.c.loseCommitResponse=true;const r=s.c.applySalesBillBackfill_('20261019',plan.planHash);assert.equal(r.complete,false);assert.equal(r.requiresNewPlan,true);assert.equal(s.c.planSalesBillBackfill_('20261019').entries.length,0);assert.equal(s.value('Stock_Movements/SI-old-uuid-1','Bill_No'),'SI-20261019-0001');
});
test('backfilled retries recover alias from movement without rewriting saved request payload',()=>{
 const s=setup();s.seed();const r=s.c.issueStock_(sale,'staff'),row=s.docs.get('Stock_Movements/'+r.docNo+'-1');const stored=JSON.parse(s.c.parseFirestoreValue_(row.fields.Request_Result_JSON));delete stored.billNo;row.fields.Request_Result_JSON={stringValue:JSON.stringify(stored)};
 assert.equal(s.c.issueStock_(sale,'staff').billNo,r.billNo);assert.equal(s.commits.length,1);
});
test('maintenance helpers remain private and movement detail permission remains staff',()=>{
 const s=setup();assert.equal(s.c.API_REGISTRY.getStockMovementDetail,'staff');for(const name of ['inspectSalesBillBackfill','planSalesBillBackfill','applySalesBillBackfill']){assert.equal(s.c.API_REGISTRY[name],undefined);assert.equal(s.c.API_FUNCTIONS[name],undefined);}
});
test('inventory exposes malformed legacy rows instead of silently declaring them migrated',()=>{
 const s=setup();old(s,'SI-bad-type',undefined,undefined,{Type:''});old(s,'SI-bad-date','2026-02-30T00:00:00Z');
 assert.equal(s.c.inspectSalesBillBackfill_().invalidMovementIds.length,2);assert.throws(()=>s.c.planSalesBillBackfill_('20261019'));assert.throws(()=>s.c.salesBillDay_('20261019'));assert.equal(s.commits.length,0);
});
