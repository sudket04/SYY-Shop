const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,plain}=require('./support/services.cjs');
function fixture(){const s=setup();s.seed();s.c.validatedGatewaySession_={session:{role:'admin',username:'admin'},token:'test'};const sale=s.c.issueStock_({requestId:'original-sale-0001',reason:'ขายหน้าร้าน',items:[{productCode:'P1',qty:5}]},'admin');assert.equal(sale.success,true,sale.message);return {...s,sale};}
function draft(s,patch={}){return {requestId:'correction-request-0001',docNo:s.sale.docNo,revision:0,action:'replace',correctionReason:'แก้ไขจำนวนที่บันทึกผิด',reason:'ขายหน้าร้าน',refNo:'REF',note:'corrected',items:[{productCode:'P1',qty:3,unitPrice:200}],...patch};}
function preview(s,d){const p=s.c.getStockIssueCorrectionPreview_(d,'admin');return {...d,previewToken:p.previewToken};}
test('5 to 3 correction uses current stock, atomically preserves original values and creates replacement + negative OUT',()=>{
 const s=fixture();s.put('Master_Products/P1',{Product_Name:'Part',Current_Stock:12,Cost_Price:999,Selling_Price:999,Min_Stock:2});const d=preview(s,draft(s)),before=plain(s.docs.get('Stock_Movements/'+s.sale.docNo+'-1').fields);
 const r=s.c.correctStockIssue_(d,'admin');assert.equal(r.success,true,r.message);assert.equal(s.value('Master_Products/P1','Current_Stock'),14);assert.equal(s.value('Stock_Movements/'+s.sale.docNo+'-1','Qty'),5);assert.equal(s.value('Stock_Movements/'+s.sale.docNo+'-1','Committed_At'),s.c.parseFirestoreValue_(before.Committed_At));
 assert.equal(s.value('Stock_Movements/'+r.replacementDocNo+'-1','Cost_Price'),100);assert.equal(s.value('Stock_Movements/SC_correction-request-0001-1','Type'),'OUT');assert.equal(s.value('Stock_Movements/SC_correction-request-0001-1','Qty'),-5);assert.equal(s.commits.length,2);
 assert.equal(s.c.correctStockIssue_(d,'admin').replayed,true);assert.equal(s.value('Master_Products/P1','Current_Stock'),14);assert.equal(s.commits.length,2);
});
test('cancel returns stock once and cannot cancel the original again under a new request',()=>{
 const s=fixture(),d=preview(s,draft(s,{action:'cancel',items:[]})),r=s.c.correctStockIssue_(d,'admin');assert.equal(r.success,true,r.message);assert.equal(s.value('Master_Products/P1','Current_Stock'),10);
 assert.equal(s.c.correctStockIssue_(d,'admin').replayed,true);assert.throws(()=>preview(s,draft(s,{action:'cancel',requestId:'new-cancel-0002',revision:1,items:[]})));assert.equal(s.commits.length,2);
});
test('metadata amendment is audited, keeps stock/timestamps/quantities and increments revision',()=>{
 const s=fixture(),d=preview(s,draft(s,{action:'amend',items:[]})),before=s.value('Stock_Movements/'+s.sale.docNo+'-1','Timestamp');const r=s.c.correctStockIssue_(d,'admin');assert.equal(r.success,true,r.message);assert.equal(s.value('Master_Products/P1','Current_Stock'),5);assert.equal(s.value('Stock_Movements/'+s.sale.docNo+'-1','Note'),'corrected');assert.equal(s.value('Stock_Movements/'+s.sale.docNo+'-1','Timestamp'),before);assert.equal(s.value('Stock_Movements/'+s.sale.docNo+'-1','Issue_Revision'),1);assert(s.value('Doc_No_Reservations/SC_correction-request-0001','Before_JSON'));
});
test('preview reads only, rejects new insufficient stock and stale/changed preview before writing',()=>{
 for(const mode of ['stock','payload','revision']){const s=fixture(),d=preview(s,draft(s));if(mode==='stock')s.put('Master_Products/P1',{Product_Name:'Part',Current_Stock:0,Cost_Price:100,Selling_Price:200});if(mode==='payload')d.items[0].qty=2;if(mode==='revision')d.revision=1;assert.equal(s.c.correctStockIssue_(d,'admin').success,false);assert.equal(s.commits.length,1);}
 const s=fixture();assert.throws(()=>preview(s,draft(s,{items:[{productCode:'P1',qty:20,unitPrice:200}]})));assert.equal(s.commits.length,1);
});
test('CAS contention rolls back correction, stock, reservation, counter and original status together',()=>{
 const s=fixture(),d=preview(s,draft(s));s.c.beforeCommit=()=>s.put('Master_Products/P1',{Product_Name:'Part',Current_Stock:2,Cost_Price:100,Selling_Price:200});const r=s.c.correctStockIssue_(d,'admin');assert.equal(r.success,false);assert.equal(s.commits.length,1);assert.equal(s.value('Stock_Movements/'+s.sale.docNo+'-1','Issue_Status'),'');assert.equal(s.value('Master_Products/P1','Current_Stock'),2);
});
test('lost correction response reconciles from receipt without a second inventory mutation',()=>{
 const s=fixture(),d=preview(s,draft(s));s.c.loseCommitResponse=true;const first=s.c.correctStockIssue_(d,'admin');assert.equal(first.uncertain,true);const again=s.c.correctStockIssue_(d,'admin');assert.equal(again.success,true);assert.equal(again.replayed,true);assert.equal(s.commits.length,2);assert.equal(s.value('Master_Products/P1','Current_Stock'),7);
});
test('same correction key cannot be reused for different payload or actor, and staff cannot preview/write',()=>{
 const s=fixture(),d=preview(s,draft(s));assert.equal(s.c.correctStockIssue_(d,'admin').success,true);assert.equal(s.c.correctStockIssue_({...d,note:'other'},'admin').success,false);s.c.validatedGatewaySession_={session:{username:'staff',role:'staff'}};assert.throws(()=>s.c.getStockIssueCorrectionPreview_(draft(s),'staff'));assert.equal(s.c.correctStockIssue_(d,'staff').success,false);
});
test('SKU replacement nets both stocks and records zero/decimal prices without changing master price',()=>{
 const s=fixture();s.put('Master_Products/P2',{Product_Name:'Other',Current_Stock:10,Cost_Price:50,Selling_Price:200});const r=s.c.correctStockIssue_(preview(s,draft(s,{items:[{productCode:'P2',qty:1.5,unitPrice:0}]})),'admin');assert.equal(r.success,true,r.message);assert.equal(s.value('Master_Products/P1','Current_Stock'),10);assert.equal(s.value('Master_Products/P2','Current_Stock'),8.5);assert.equal(s.value('Stock_Movements/'+r.replacementDocNo+'-1','Unit_Price'),0);assert.equal(s.value('Master_Products/P2','Selling_Price'),200);
});
test('legacy missing prices cannot be silently replaced by current prices',()=>{
 const s=fixture();delete s.docs.get('Stock_Movements/'+s.sale.docNo+'-1').fields.Unit_Price;assert.throws(()=>preview(s,draft(s)));assert.equal(s.commits.length,1);
});
test('retrying the original sale after replacement/cancel never posts stock again',()=>{
 for(const action of ['replace','cancel']){const s=fixture(),r=s.c.correctStockIssue_(preview(s,draft(s,{action})),'admin');assert.equal(r.success,true);const stock=s.value('Master_Products/P1','Current_Stock');const replay=s.c.issueStock_({requestId:'original-sale-0001',reason:'ขายหน้าร้าน',items:[{productCode:'P1',qty:5}]},'admin');assert.equal(replay.success,true,replay.message);assert.equal(replay.issueStatus,action==='replace'?'replaced':'cancelled');assert.equal(s.value('Master_Products/P1','Current_Stock'),stock);assert.equal(s.commits.length,2);}
});
test('amendments chain audit snapshots and detail exposes audit without replay secrets',()=>{
 const s=fixture();assert.equal(s.c.correctStockIssue_(preview(s,draft(s,{action:'amend'})),'admin').success,true);
 const second=draft(s,{action:'amend',revision:1,requestId:'correction-request-0002',note:'second note'});assert.equal(s.c.correctStockIssue_(preview(s,second),'admin').success,true);
 const audit=JSON.parse(s.value('Doc_No_Reservations/SC_correction-request-0002','Before_JSON'));assert.equal(audit[0].correctionId,'SC_correction-request-0001');assert.equal(audit[0].note,'corrected');
 const detail=s.c.getStockMovementDetail_(s.sale.docNo);assert.equal(detail.correction.previousNote,'corrected');assert(!JSON.stringify(detail).includes('Request_Fingerprint'));assert.equal(s.value('Master_Products/P1','Current_Stock'),5);
});
test('cancelling one of several quote issues preserves the active marker, or picks the latest remaining bill',()=>{
 for(const marker of ['SI-kept','missing']){const s=fixture();s.docs.get('Stock_Movements/'+s.sale.docNo+'-1').fields.Quote_Id={stringValue:'Q1'};s.put('Quotations/Q1',{Stock_Issued:'true',Stock_Issue_Doc:marker});
  for(const [id,time] of [['SI-kept','2026-10-01'],['SI-newer','2026-10-20']])s.put('Stock_Movements/'+id+'-1',{Doc_No:id,Bill_No:id+'-bill',Quote_Id:'Q1',Type:'OUT',Reason:'ขายหน้าร้าน',Qty:1,Timestamp:time});
  assert.equal(s.c.correctStockIssue_(preview(s,draft(s,{action:'cancel'})),'admin').success,true);assert.equal(s.value('Quotations/Q1','Stock_Issued'),'true');assert.equal(s.value('Quotations/Q1','Stock_Issue_Doc'),marker==='SI-kept'?marker:'SI-newer');
 }
});
test('quote mutation between validation and commit rejects the entire correction without a misleading uncertain state',()=>{
 const s=fixture();s.docs.get('Stock_Movements/'+s.sale.docNo+'-1').fields.Quote_Id={stringValue:'Q1'};s.put('Quotations/Q1',{Stock_Issued:'true'});const d=preview(s,draft(s));s.c.beforeCommit=()=>s.put('Quotations/Q1',{Stock_Issued:'true',Note:'another operator'});
 const result=s.c.correctStockIssue_(d,'admin');assert.equal(result.success,false);assert.equal(result.uncertain,false);assert.equal(s.commits.length,1);assert.equal(s.value('Master_Products/P1','Current_Stock'),5);assert(!s.docs.has('Doc_No_Reservations/SC_correction-request-0001'));
});
test('malformed quantities/prices, mixed reasons and oversized UTF-8 audit fail before committing',()=>{
 for(const item of [{qty:0,unitPrice:5},{qty:-1,unitPrice:5},{qty:NaN,unitPrice:5},{qty:1,unitPrice:Infinity},{qty:1,unitPrice:-1},{qty:Number.MAX_SAFE_INTEGER,unitPrice:2}]){const s=fixture();assert.throws(()=>preview(s,draft(s,{items:[{productCode:'P1',...item}]})));assert.equal(s.commits.length,1);}
 const s=fixture();s.docs.get('Stock_Movements/'+s.sale.docNo+'-1').fields.Product_Name={stringValue:'ท'.repeat(310000)};const result=s.c.correctStockIssue_(preview(s,draft(s,{action:'amend'})),'admin');assert.equal(result.success,false);assert.equal(result.uncertain,false);assert.equal(s.commits.length,1);
});
test('concurrent admins previewing the same revision cannot both commit',()=>{
 const s=fixture(),a=preview(s,draft(s)),b=preview(s,draft(s,{requestId:'correction-request-0002'}));assert.equal(s.c.correctStockIssue_(a,'admin').success,true);const second=s.c.correctStockIssue_(b,'admin');assert.equal(second.success,false);assert.equal(s.value('Master_Products/P1','Current_Stock'),7);assert.equal(s.commits.length,2);
});
test('audit drilldown is bounded, signed, revision-bound and never exposes receipt fingerprints',()=>{
 const s=fixture();for(let i=0;i<7;i++){const d=preview(s,draft(s,{action:'amend',revision:i,requestId:'correction-page-'+String(i).padStart(4,'0'),note:'revision '+i}));assert.equal(s.c.correctStockIssue_(d,'admin').success,true);}
 const count=s.calls.length,first=s.c.getStockIssueCorrectionHistory_(s.sale.docNo,{});assert.equal(first.entries.length,5);assert(first.nextCursor);assert(s.calls.length-count<=6);assert(!JSON.stringify(first).includes('Request_Fingerprint'));assert.equal(first.entries[0].previousNote,'revision 5');
 const second=s.c.getStockIssueCorrectionHistory_(s.sale.docNo,{cursor:first.nextCursor});assert.equal(second.entries.length,2);assert.equal(second.nextCursor,'');assert.throws(()=>s.c.getStockIssueCorrectionHistory_(s.sale.docNo,{cursor:first.nextCursor+'x'}));assert.throws(()=>s.c.getStockIssueCorrectionHistory_('another-doc',{cursor:first.nextCursor}));
 assert.equal(s.c.correctStockIssue_(preview(s,draft(s,{action:'amend',revision:7,requestId:'correction-page-0007'})),'admin').success,true);assert.throws(()=>s.c.getStockIssueCorrectionHistory_(s.sale.docNo,{cursor:first.nextCursor}));
});
test('corrupt legacy numeric strings and mixed-line reasons never turn into a financial correction',()=>{
 for(const [field,value] of [['Qty','5x'],['Unit_Price',' '],['Unit_Price','1oops'],['Cost_Price',-1]]){const s=fixture();s.docs.get('Stock_Movements/'+s.sale.docNo+'-1').fields[field]={stringValue:String(value)};assert.throws(()=>preview(s,draft(s)));assert.equal(s.commits.length,1);}
 const s=fixture();s.put('Stock_Movements/'+s.sale.docNo+'-2',{Doc_No:s.sale.docNo,Type:'OUT',Qty:1,Product_Code:'P1',Unit_Price:200,Cost_Price:100,Reason:'สินค้าชำรุด'});assert.throws(()=>preview(s,draft(s)));assert.equal(s.commits.length,1);
});
