const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function response(code, body) { return {getResponseCode:()=>code, getContentText:()=>JSON.stringify(body)}; }
function setup() {
  const calls = [], docs = new Map();
  const c = vm.createContext({console:{error(){},log(){}}, Utilities:{formatDate:()=> '261011-120000',getUuid:()=> 'abcd1234'},
    UrlFetchApp:{fetch(url, options) {
      calls.push({url, options});
      const u = new URL(url), key = decodeURIComponent(u.pathname.split('/documents/')[1] || '');
      if(options.method === 'get') return docs.has(key) ? response(200, structuredClone(docs.get(key))) : response(404, {});
      if(options.method === 'patch') {
        if(c.beforePatch) { c.beforePatch(key); c.beforePatch = null; }
        const doc = docs.get(key);
        if((u.searchParams.get('currentDocument.exists') === 'true' && !doc) ||
          (u.searchParams.has('currentDocument.updateTime') && (!doc || doc.updateTime !== u.searchParams.get('currentDocument.updateTime')))) {
          return response(400, {error:{status:'FAILED_PRECONDITION'}});
        }
        const fields = JSON.parse(options.payload).fields;
        const mask = u.searchParams.getAll('updateMask.fieldPaths');
        const result = doc || {fields:{}};
        if(mask.length) mask.forEach(k => result.fields[k] = fields[k]); else result.fields = fields;
        result.updateTime = 'v2'; docs.set(key, result);
        return response(200, result);
      }
      throw new Error('Unexpected call: '+url);
    }}});
  vm.runInContext(source, c);
  Object.assign(c, {getAuthHeader:()=>({}), clearCollectionCache:()=>{}, queryByEqualityField_:()=>[], peekCollectionDocsCache_:()=>null,
    getFirestoreRawList:()=>[], updateTaxInvoiceYearsMeta_:()=>{}, updateQuotationYearsMeta_:()=>{}, logActivity_:()=>{},
    getProductById:id=>({id, productCode:id, currentStock:c.parseFirestoreValue(docs.get('Master_Products/'+id).fields.Current_Stock)}),
    getCurrentUsername_:()=> 'staff'});
  function put(key, fields) { docs.set(key, {fields:c.mapToFirestoreFields(fields), updateTime:'v1'}); }
  return {c, calls, docs, put, value:(key,field)=>c.parseFirestoreValue(docs.get(key).fields[field])};
}
const product = {docId:'P1',productName:'Part',currentStock:10,originalStock:10,barcode:'123'};
test('normal product edit preserves stock changed by another browser and unknown fields',()=>{
  const s = setup(); s.put('Master_Products/P1',{Current_Stock:8, Other:'retain', Barcode:'123'});
  s.c.beforePatch = key => {s.docs.get(key).fields.Current_Stock = {integerValue:'7'};};
  const result = s.c.saveProduct(product);
  assert.equal(result.success,true); assert.equal(s.value('Master_Products/P1','Current_Stock'),7);
  assert.equal(s.value('Master_Products/P1','Other'),'retain'); assert.equal(result.product.currentStock,7);
  const patch = s.calls.find(x=>x.options.method==='patch'); assert(!patch.url.includes('fieldPaths=Current_Stock'));
});
test('legacy product client cannot overwrite stock without baseline',()=>{
  const s=setup(); s.put('Master_Products/P1',{Current_Stock:8});
  assert.equal(s.c.saveProduct({...product, originalStock:undefined}).success,true);
  assert.equal(s.value('Master_Products/P1','Current_Stock'),8);
});
test('intentional stock edit rejects stale baseline and performs no write',()=>{
  const s=setup(); s.put('Master_Products/P1',{Current_Stock:8});
  assert.equal(s.c.saveProduct({...product,currentStock:12}).success,false);
  assert.equal(s.calls.filter(x=>x.options.method==='patch').length,0);
});
test('intentional stock edit uses updateTime and rejects interleaved stock write',()=>{
  const s=setup(); s.put('Master_Products/P1',{Current_Stock:10});
  s.c.beforePatch=key=>{s.docs.get(key).updateTime='v-other';s.docs.get(key).fields.Current_Stock={integerValue:'9'};};
  assert.equal(s.c.saveProduct({...product,currentStock:12}).success,false);
  assert.equal(s.value('Master_Products/P1','Current_Stock'),9);
});
test('intentional uncontended stock edit still works',()=>{
  const s=setup();s.put('Master_Products/P1',{Current_Stock:10});
  assert.equal(s.c.saveProduct({...product,currentStock:12}).success,true);
  assert.equal(s.value('Master_Products/P1','Current_Stock'),12);
});
test('editing deleted or unreadable products never recreates them',()=>{
  const s=setup();assert.equal(s.c.saveProduct(product).success,false);assert.equal(s.calls.length,1);
});
const invoice = {docId:'TX1',invoiceDate:'2025-10-11',buyerName:'Buyer',items:[{name:'Part',qty:2,unitPrice:100}]};
test('invoice edit keeps number across years, unspecified branch and totals; returns saved preview',()=>{
  const s=setup();s.put('Master_Tax_Invoice/TX1',{Invoice_No:'SYY 0001/10/69',Buyer_Branch:'สำนักงานใหญ่',Other:'keep'});
  const r=s.c.saveTaxInvoice({...invoice,buyerBranch:''});
  assert.equal(r.success,true);assert.equal(r.invoice.id,'TX1');assert.equal(r.invoice.buyerBranch,'ไม่ระบุ');
  assert.equal(r.invoice.invoiceNo,'SYY 0001/10/69');assert.equal(r.invoice.grandTotal,214);
  assert.equal(s.value('Master_Tax_Invoice/TX1','Other'),'keep');
});
test('invoice actual branch is preserved when omitted or provided',()=>{
  for (const branch of [undefined,'สาขา 00002']) {
    const s=setup();s.put('Master_Tax_Invoice/TX1',{Invoice_No:'SYY 0001/10/69',Buyer_Branch:'สาขา 00002'});
    assert.equal(s.c.saveTaxInvoice({...invoice,buyerBranch:branch}).invoice.buyerBranch,'สาขา 00002');
  }
});
test('failed invoice read never allocates a new number or writes',()=>{
  const s=setup();assert.equal(s.c.saveTaxInvoice(invoice).success,false);assert.equal(s.calls.length,1);
});
test('invoice concurrent deletion fails precondition instead of recreating',()=>{
  const s=setup();s.put('Master_Tax_Invoice/TX1',{Invoice_No:'SYY 0001/10/69'});s.c.beforePatch=key=>s.docs.delete(key);
  assert.equal(s.c.saveTaxInvoice(invoice).success,false);assert(!s.docs.has('Master_Tax_Invoice/TX1'));
});
test('new invoice/customer branch defaults and explicitly known branches',()=>{
  const s=setup();s.c.saveMasterData=(col,prefix,id,data)=>({success:true,id:id||'NEW',data});
  s.c.nextRunningNumber_=()=>1;s.c.reserveDocNo_=()=>true;
  assert.equal(s.c.saveTaxInvoice({...invoice,docId:null}).invoice.buyerBranch,'ไม่ระบุ');
  assert.equal(s.c.saveCustomer({customerName:'New'}).data.Branch,'ไม่ระบุ');
  assert.equal(s.c.saveCustomer({customerName:'New',branch:'สำนักงานใหญ่'}).data.Branch,'สำนักงานใหญ่');
});
const quote={docId:'QT1',customerId:'C1',quoteDate:'2026-10-11',discPct:10,items:[{productCode:'P1',productName:'Part',qty:2,unitPrice:150,costPrice:100}]};
function putQuote(s){s.put('Quotations/QT1',{Quote_No:'QT 0001/10/69',Customer_ID:'C1',Customer_Name:'Historical buyer',Customer_Branch:'สาขา 2',Status:'ปิดงาน-ขายสำเร็จ',Stock_Issued:'true',Stock_Issue_Doc:'SI1'});}
test('quotation negotiated price, historical customer and stock-issued metadata survive edit',()=>{
  const s=setup();putQuote(s);s.c.getCustomerById_=()=>{throw new Error('Must use snapshot');};
  const r=s.c.saveQuotation(quote,'staff');assert.equal(r.success,true);assert.equal(r.quotation.id,'QT1');
  assert.equal(r.quotation.items[0].unitPrice,150);assert.equal(r.quotation.customerName,'Historical buyer');
  assert.equal(r.quotation.stockIssueDoc,'SI1');assert.equal(r.quotation.stockIssued,true);
  assert.equal(r.quotation.grandTotal,288.9);assert.equal(r.quotation.profit,70);
  assert.equal(s.calls.some(x=>x.url.includes('Master_Products')),false);
});
test('invalid negotiated prices/quantities are rejected, not silently dropped',()=>{
  for(const values of [{unitPrice:-1},{unitPrice:Infinity},{unitPrice:''},{qty:0},{qty:Infinity}]){
    const s=setup();const r=s.c.saveQuotation({...quote,items:[{...quote.items[0],...values}]},'staff');
    assert.equal(r.success,false);assert.equal(s.calls.length,0);
  }
});
test('quotation missing historical document fails without writes',()=>{
  const s=setup();assert.equal(s.c.saveQuotation(quote,'staff').success,false);assert.equal(s.calls.length,1);
});
test('zone rack level validates 1-5 and keeps legacy records readable/editable',()=>{
  const s=setup();s.put('Master_Zones/Z1',{Area:'A',Rack_no:'R1',Car_ID:'CAR1',Status:'Inactive'});
  const r=s.c.saveZone({docId:'Z1',area:'A',rackNo:'R1'});
  assert.equal(r.success,true);assert.equal(r.data.Rack_Level,'');assert.equal(r.data.Car_ID,'CAR1');assert.equal(r.data.Status,'Inactive');
  for(const d of [{area:'B',rackNo:'R2'},{area:'B',rackNo:'R2',rackLevel:'6'},{area:'B',rackLevel:'2'},{area:''}])assert.equal(s.c.saveZone(d).success,false);
  s.c.saveMasterData=(col,prefix,id,data,duplicate)=>({success:true,id:'Z2',data,duplicate});
  for(const rackLevel of ['1','2','3','4','5']){
    const res=s.c.saveZone({area:'B',rackNo:'R2',rackLevel});assert.equal(res.data.Rack_Level,rackLevel);assert.equal(res.duplicate,'B');
    assert.equal(s.c.mapToFirestoreFields(res.data).Rack_Level.stringValue,rackLevel);
  }
});
test('zone labels distinguish floor/rack/level and work for legacy data',()=>{
  const s=setup();const label=s.c.zoneDisplayLabel_(s.c.mapToFirestoreFields({Area:'A',Floor:'ชั้น 2',Rack_no:'R1',Rack_Level:'3'}),'Z1');
  assert(label.includes('ชั้น 2'));assert(label.includes('Rack R1 · ระดับ 3'));
  assert.equal(s.c.zoneDisplayLabel_(s.c.mapToFirestoreFields({Area:'A',Rack_no:'R1'}),'Z1'),'A (Rack R1)');
});
test('Viewer remains unable to quick-add customers, edit product or zones; can save documents',()=>{
  const s=setup();s.c.getSession_=()=>({role:'viewer',username:'viewer'});
  for(const api of ['saveCustomer','saveProduct','saveZone'])assert.equal(s.c.apiGateway('token',api,[{}],'ua').success,false);
  assert.equal(s.calls.length,0);assert.equal(s.c.API_REGISTRY.saveTaxInvoice,'viewer');assert.equal(s.c.API_REGISTRY.saveQuotation,'viewer');
});
test('API registry and function dispatch remain consistent',()=>{
  const s=setup();for(const api of Object.keys(s.c.API_REGISTRY))assert.equal(typeof s.c.API_FUNCTIONS[api],'function',api);
});
test('list HTTP failures propagate instead of appearing to be empty successful refreshes',()=>{
  const s=setup();s.c.UrlFetchApp.fetch=()=>response(503,{error:{status:'UNAVAILABLE'}});
  for(const name of ['getTaxInvoiceList','getTaxInvoiceListByYear','getQuotationList','getQuotationListByYear']){
    assert.throws(()=>s.c[name](2569),/ไม่สำเร็จ/);
  }
});
test('legacy zone client preserves already assigned rack level',()=>{
  const s=setup();s.put('Master_Zones/Z1',{Area:'A',Rack_no:'R1',Rack_Level:'4'});
  const r=s.c.saveZone({docId:'Z1',area:'A',rackNo:'R1',note:'Changed'});
  assert.equal(r.success,true);assert.equal(r.data.Rack_Level,'4');
});
test('stock issue retains atomic movement+stock and approved quotation price, master price unchanged',()=>{
  const s=setup();putQuote(s);s.docs.get('Quotations/QT1').fields.Items_JSON={stringValue:JSON.stringify([{productCode:'P1',unitPrice:125}])};
  s.c.getProductStockMap_=()=>({P1:{name:'Part',stock:10,minStock:2,costPrice:100,sellingPrice:200,updateTime:'v1'}});
  let writes;s.c.fsCommit_=w=>{writes=w;return {ok:true};};
  const r=s.c.issueStock({quoteId:'QT1',items:[{productCode:'P1',qty:2,unitPrice:1}],reason:'ขายหน้าร้าน'},'staff');
  assert.equal(r.success,true);assert.equal(r.results[0].after,8);assert.equal(writes.length,2);
  assert.equal(writes[0].currentDocument.updateTime,'v1');assert.equal(writes[0].transform.fieldTransforms[0].increment.doubleValue,-2);
  assert.equal(writes[1].update.fields.Unit_Price.doubleValue,125);
  assert.equal(writes.some(w=>w.update?.fields.Selling_Price),false);
});
test('stock issue refuses insufficient stock and does not commit',()=>{
  const s=setup();s.c.getProductStockMap_=()=>({P1:{name:'Part',stock:1,minStock:2,costPrice:100,sellingPrice:200,updateTime:'v1'}});
  s.c.fsCommit_=()=>{throw new Error('Must not commit');};
  assert.equal(s.c.issueStock({items:[{productCode:'P1',qty:2}],reason:'ขายหน้าร้าน'},'staff').success,false);
});
test('receive goods keeps stock, movement and receipt/status in a single preconditioned commit',()=>{
  const s=setup();s.put('Purchase_Orders/PO1',{Status:'Pending',Items_JSON:JSON.stringify([{productCode:'P1',productName:'Part',qty:2,receivedQty:0}]),Receipts_JSON:'[]'});
  s.c.getProductStockMap_=()=>({P1:{name:'Part',stock:10,minStock:2,costPrice:100,sellingPrice:200,updateTime:'v1'}});
  let writes;s.c.fsCommit_=w=>{writes=w;return {ok:true};};
  const r=s.c.receiveGoods({poId:'PO1',invoiceNo:'INV1',receiptDate:'2026-10-11',receiverName:'Staff',items:[{productCode:'P1',qtyReceivedNow:2}]},'staff');
  assert.equal(r.success,true);assert.equal(r.productStocks[0].currentStock,12);assert.equal(r.po.status,'Received');assert.equal(writes.length,3);
  assert.equal(writes[0].currentDocument.updateTime,'v1');assert.equal(writes[2].currentDocument.updateTime,'v1');
  assert.equal(writes[1].update.fields.Type.stringValue,'IN');assert.equal(writes[2].update.fields.Status.stringValue,'Received');
});
test('invoice rejects invalid lines without silently dropping them',()=>{
  for(const values of [{unitPrice:-1},{unitPrice:Infinity},{unitPrice:''},{qty:0},{qty:Infinity},{name:''}]){
    const s=setup();const r=s.c.saveTaxInvoice({...invoice,items:[{...invoice.items[0],...values}]});
    assert.equal(r.success,false);assert.equal(s.calls.length,0);
  }
});
test('document dates reject calendar rollovers and accept real leap dates',()=>{
  const s=setup();s.c.getCustomerById_=()=>({Customer_Name:'Buyer'});assert.equal(s.c.isValidBusinessDate_('2024-02-29'),true);
  for(const date of ['2025-02-29','2026-02-31','2026-13-01','invalid']){
    assert.equal(s.c.isValidBusinessDate_(date),false);
    assert.equal(s.c.saveTaxInvoice({...invoice,invoiceDate:date}).success,false);
    assert.equal(s.c.saveQuotation({...quote,docId:null,quoteDate:date,customerId:'C1'}).success,false);
  }
});
