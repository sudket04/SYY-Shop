const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup,plain,reply}=require('./support/services.cjs');
function presentation(){const source=fs.readFileSync('Shared.html','utf8'),c=vm.createContext({Intl,Date,console,esc:value=>String(value||'')});vm.runInContext(source.slice(source.indexOf('/* Bill labels'),source.indexOf('var TH_MONTHS=')),c);return c;}
const original=[{id:'B-1',docNo:'B',billNo:'SI-20261028-0003',type:'OUT',timestamp:'2026-10-28T17:01:00Z',user:'saved-user',productCode:'P1',qty:5,unitPrice:200,costPrice:100,hasUnitPrice:true,hasCostPrice:true}];
test('correction estimates use stock deltas and recorded old-SKU cost while preserving valid zero prices',()=>{
 const c=presentation(),products=[{productCode:'P1',currentStock:12,costPrice:999},{productCode:'P2',currentStock:10,costPrice:50}];
 const result=c.syyCorrectionTotals(original,[{productCode:'P1',qty:'3',unitPrice:'200'},{productCode:'P2',qty:'1.5',unitPrice:'0'}],products,'replace');
 assert.equal(result.qty,4.5);assert.equal(result.oldSell,1000);assert.equal(result.sell,600);assert.equal(result.cost,375);assert.equal(result.profit,225);assert.equal(result.difference,-400);assert.deepEqual(plain(result.changes.map(x=>[x.productCode,x.after])),[['P1',14],['P2',8.5]]);
 const increased=c.syyCorrectionTotals(original,[{productCode:'P1',qty:7,unitPrice:200}],products,'replace');assert.equal(increased.changes[0].after,10);
 const cancel=c.syyCorrectionTotals(original,[],products,'cancel');assert.equal(cancel.sell,0);assert.equal(cancel.changes[0].after,17);
 const amend=c.syyCorrectionTotals(original,[],products,'amend');assert.equal(amend.sell,1000);assert.equal(amend.changes.length,0);
});
test('local edits never turn unknown prices, empty input, duplicate SKU or overflow into a valid zero-total sale',()=>{
 const c=presentation();for(const patch of [{qty:''},{qty:NaN},{qty:-1},{unitPrice:''},{unitPrice:Infinity},{unitPrice:-1},{qty:1e308,unitPrice:1e308}]){const r=c.syyCorrectionTotals(original,[{productCode:'P1',qty:1,unitPrice:1,...patch}],[],'replace');assert.equal(r.valid,false,JSON.stringify(patch));}
 const unknown=c.syyCorrectionTotals([{...original[0],hasUnitPrice:false,hasCostPrice:false}],[],[],'amend');assert.equal(unknown.oldSell,null);assert.equal(unknown.sell,null);assert.equal(unknown.cost,null);assert.equal(unknown.profit,null);
 assert.equal(c.syyCorrectionTotals(original,[{productCode:'P1',qty:1,unitPrice:0},{productCode:'P1',qty:2,unitPrice:0}],[],'replace').valid,false);
 assert.equal(c.syyCorrectionTotals([],[],[],'cancel').oldSell,null);
 const pendingPrice=c.syyCorrectionTotals(original,[{productCode:'P1',qty:3,unitPrice:''}],[],'replace');assert.equal(pendingPrice.qty,3);assert.equal(pendingPrice.sell,null);
});
test('bill presentation keeps internal identity, legacy labels, real actors and Thai dates without fabricating SI numbers',()=>{
 const c=presentation(),g=c.syyGroupBillRows([original[0],{...original[0],id:'B-2',qty:1,user:'another-user'}],{B:true})[0];assert.equal(g.items,2);assert.equal(g.amtSell,1200);assert.equal(g.user,'หลายผู้ทำรายการ');assert.equal(g.consistent,false);assert.equal(g.complete,true);
 assert.equal(c.syyBillLabel({docNo:'SI-uuid-legacy'}),'SI-uuid-legacy');assert.equal(c.syyBillLabel(original[0]),'SI-20261028-0003');assert.match(c.syyBillDate(original[0].timestamp),/29/);assert.match(c.syyBillDate(original[0].timestamp),/00:01/);
 assert.equal(c.syyGroupBillRows([{...original[0],hasUnitPrice:false,unitPrice:0}],{B:false})[0].knownSell,false);
 assert.equal(c.syyGroupBillRows([{...original[0],unitPrice:0}],{B:true})[0].knownSell,true);
 assert.equal(c.syyBillDate(null),'ไม่ระบุวันเวลา');assert.equal(c.syyBillDate(''),'ไม่ระบุวันเวลา');assert.equal(c.syyGroupBillRows([{...original[0],unitPrice:1e308,qty:2}],{B:true})[0].knownSell,false);
 const groups=c.syyGroupBillRows([original[0],{...original[0],id:'in',type:'IN'},{...original[0],id:'rev',reversal:true},{id:'legacy-1',qty:1},{id:'legacy-2',qty:1}]);assert.equal(groups.length,5);
});
function movements(s,no,count,prefix='M'){for(let i=0;i<count;i++)s.put('Stock_Movements/'+prefix+String(i).padStart(4,'0'),{Doc_No:no,Bill_No:'SI-20261028-0003',Type:'OUT',Timestamp:'2026-10-28T05:00:00Z',Product_Code:'P'+i,Product_Name:'Part '+i,Qty:1,Unit_Price:2.25,Cost_Price:1,User:'saved-user'});}
function queries(s){return s.calls.filter(x=>x.url.endsWith(':runQuery')).map(x=>JSON.parse(x.options.payload));}
function counts(s){return s.calls.filter(x=>x.url.endsWith(':runAggregationQuery')).map(x=>JSON.parse(x.options.payload));}
test('bill browsing completes a split bill in one batched snapshot query and reuses its per-bill cache on continuation',()=>{
 const s=setup();s.c.readTime=new Date().toISOString();movements(s,'B',80,'Z');movements(s,'A',3,'A');
 const first=s.c.getStockMovementPage_({billMode:true});assert.equal(first.pageInfo.loaded,50);assert.equal(first.movements.length,80);assert.equal(first.billCompleteness[0].complete,true);assert.equal(queries(s).length,2);assert.equal(queries(s)[1].readTime,first.pageInfo.readTime);assert.equal(queries(s)[1].structuredQuery.where.fieldFilter.op,'IN');
 s.put('Stock_Movements/Z0000',{Doc_No:'B',Type:'OUT',Timestamp:'2026-10-28T05:00:00Z',Qty:999});
 const next=s.c.getStockMovementPage_({billMode:true,cursor:first.pageInfo.nextCursor});assert.equal(next.movements.find(x=>x.id==='Z0000').qty,1);assert.equal(queries(s).filter(q=>q.structuredQuery.where?.fieldFilter?.op==='IN').length,1);assert.equal(counts(s).length,2);assert.equal(counts(s).at(-1).structuredAggregationQuery.structuredQuery.where.fieldFilter.value.arrayValue.values.length,1);assert.equal(s.commits.length,0);
});
test('50 complete single-line bills reuse candidate data after five bounded counts, without rereading their documents',()=>{
 const s=setup();s.c.readTime=new Date().toISOString();for(let i=0;i<55;i++)movements(s,'B'+i,1,'M'+String(i).padStart(3,'0'));
 const first=s.c.getStockMovementPage_({billMode:true});assert.equal(first.movements.length,50);assert.equal(first.billCompleteness.length,50);assert.equal(queries(s).length,1);assert.equal(counts(s).length,5);assert(counts(s).every(q=>q.structuredAggregationQuery.aggregations[0].count.upTo==='11'&&q.structuredAggregationQuery.structuredQuery.where.fieldFilter.value.arrayValue.values.length===10));
 s.c.getStockMovementPage_({billMode:true});assert.equal(queries(s).length,2);assert.equal(counts(s).length,5);assert.equal(s.commits.length,0);
 s.c.clearCollectionCache_('Stock_Movements');s.c.getStockMovementPage_({billMode:true});assert.equal(queries(s).length,3);assert.equal(counts(s).length,10);
});
test('oversized hydration never publishes partial totals as complete, and query failure is not empty success',()=>{
 const s=setup();s.c.readTime=new Date().toISOString();movements(s,'HUGE',2010);const r=s.c.getStockMovementPage_({billMode:true});assert.equal(r.billCompleteness[0].complete,false);assert(r.movements.length<=2050);assert.equal(s.commits.length,0);
 const bad=setup();bad.c.readTime=new Date().toISOString();movements(bad,'B',80);const fetch=bad.c.UrlFetchApp.fetch;bad.c.UrlFetchApp.fetch=(url,o)=>url.endsWith(':runQuery')&&JSON.parse(o.payload).structuredQuery.where?.fieldFilter?.op==='IN'?reply(503,{}):fetch(url,o);assert.throws(()=>bad.c.getStockMovementPage_({billMode:true}),/ไม่ครบ/);assert.equal(bad.commits.length,0);
});
test('count failure or inconsistent count cannot certify a partial bill, and Viewer cannot request bill hydration',()=>{
 for(const mode of ['failure','inconsistent']){const s=setup();s.c.readTime=new Date().toISOString();movements(s,'B',80);const fetch=s.c.UrlFetchApp.fetch;s.c.UrlFetchApp.fetch=(url,o)=>url.endsWith(':runAggregationQuery')?mode==='failure'?reply(503,{}):reply(200,[{result:{aggregateFields:{line_count:{integerValue:'0'}}}}]):fetch(url,o);assert.throws(()=>s.c.getStockMovementPage_({billMode:true}));assert.equal(queries(s).filter(q=>q.structuredQuery.where).length,0);assert.equal(s.commits.length,0);}
 const s=setup();s.c.getSession_=()=>({username:'viewer',role:'viewer'});const result=s.c.apiGateway('viewer','getStockMovementPage',[{billMode:true}],'fixture');assert.equal(result.success,false);assert.equal(queries(s).length+counts(s).length,0);
});
