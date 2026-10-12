// Search regressions use local Firestore fixtures, never a live project.
const test = require('node:test');
const assert = require('node:assert/strict');
const {setup, plain} = require('./support/services.cjs');
function fresh(){const s=setup();s.c.readTime=new Date().toISOString();return s;}
const queries=s=>s.calls.filter(x=>x.url.endsWith(':runQuery')).map(x=>JSON.parse(x.options.payload));

test('exact invoice and quote search finds documents beyond the initial page without collection scans or writes',()=>{
  for(const [collection,dateField,numberField,api,key] of [
    ['Master_Tax_Invoice','Invoice_Date','Invoice_No','getTaxInvoiceListData_','invoices'],
    ['Quotations','Quote_Date','Quote_No','getQuotationListData_','quotations']]){
    const s=fresh();for(let i=0;i<1500;i++)s.put(collection+'/D'+i,{[dateField]:'2026-10-11',[numberField]:'NO '+i});
    const result=s.c[api](2569,{search:{number:'NO 0'}});
    assert.equal(result[key].length,1);assert.equal(result[key][0].id,'D0');assert.equal(result.availableYears,undefined);
    assert.equal(queries(s).length,1);const q=queries(s)[0].structuredQuery;
    assert.equal(q.where.fieldFilter.field.fieldPath,numberField);assert.equal(q.where.fieldFilter.op,'EQUAL');
    assert.deepEqual(plain(q.orderBy),[{field:{fieldPath:'__name__'},direction:'ASCENDING'}]);assert.equal(q.limit,51);
    assert(s.calls.every(x=>x.options.method==='post'&&x.url.endsWith(':runQuery')));
  }
});
test('date search intersects selected year and validates real calendar dates before querying',()=>{
  const s=fresh();for(const date of ['2025-12-31','2026-01-01','2026-02-28','2026-03-01','2027-01-01'])
    s.put('Quotations/'+date,{Quote_Date:date,Quote_No:date});
  const r=s.c.getQuotationListData_(2569,{search:{from:'2025-01-01',to:'2026-02-28'}});
  assert.deepEqual(plain(r.quotations.map(x=>x.quoteDate)),['2026-02-28','2026-01-01']);
  const before=s.calls.length;
  for(const search of [{from:'2026-02-30'},{from:'2026-03-02',to:'2026-03-01'},{number:'x'.repeat(121)},{number:'bad\nnumber'}])
    assert.throws(()=>s.c.getQuotationListData_(2569,{search}),/ไม่ถูกต้อง|วันที่เริ่ม/);
  assert.equal(s.calls.length,before);
});
test('search cursor binds number, dates and year and keeps the snapshot during concurrent changes',()=>{
  const s=fresh();for(let i=0;i<130;i++)s.put('Master_Tax_Invoice/T'+String(i).padStart(3,'0'),{Invoice_Date:'2026-10-11',Invoice_No:'LEGACY DUPLICATE'});
  const search={number:'LEGACY DUPLICATE',from:'2026-10-01',to:'2026-10-31'};
  let r=s.c.getTaxInvoiceListData_(2569,{search,pageSize:50}),ids=r.invoices.map(x=>x.id),cursor=r.pageInfo.nextCursor;
  s.put('Master_Tax_Invoice/NEW',{Invoice_Date:'2026-10-11',Invoice_No:'LEGACY DUPLICATE'});
  const before=s.calls.length;
  for(const change of [{...search,number:'OTHER'},{...search,to:'2026-10-30'},{}])
    assert.throws(()=>s.c.getTaxInvoiceListData_(2569,{search:change,cursor}),/ไม่ถูกต้อง/);
  assert.equal(s.calls.length,before);
  while(r.pageInfo.hasMore){r=s.c.getTaxInvoiceListData_(2569,{search,cursor:r.pageInfo.nextCursor,pageSize:50});ids.push(...r.invoices.map(x=>x.id));}
  assert.equal(new Set(ids).size,130);assert(!ids.includes('NEW'));assert(queries(s).slice(1).every(q=>q.readTime));
});
test('exact-number pages outside the selected dates still expose continuation until the search is complete',()=>{
  const s=fresh();for(let i=0;i<70;i++)s.put('Quotations/T'+String(i).padStart(3,'0'),{Quote_Date:i<50?'2025-01-01':'2026-10-11',Quote_No:'DUP'});
  const search={number:'DUP'};const first=s.c.getQuotationListData_(2569,{search});
  assert.equal(first.quotations.length,0);assert.equal(first.pageInfo.hasMore,true);assert.equal(first.pageInfo.complete,false);
  const last=s.c.getQuotationListData_(2569,{search,cursor:first.pageInfo.nextCursor});assert.equal(last.quotations.length,20);assert.equal(last.pageInfo.complete,true);
});
test('PO exact-number history search uses document identity and omits low-stock and pending-summary reads',()=>{
  const s=fresh();s.put('Purchase_Orders/PO-100',{Order_Date:'2026-10-11',Status:'Pending',Items_JSON:'[]',Receipts_JSON:'[]'});
  s.c.buildVendorMap_=()=>({});const r=s.c.getPurchaseOrderPageData_({search:{number:'PO-100'}});
  assert.equal(r.purchaseOrders[0].poId,'PO-100');assert.equal(r.lowStockItems,undefined);assert.equal(r.pendingSummary,undefined);
  assert.equal(queries(s).length,1);assert.equal(queries(s)[0].structuredQuery.where.fieldFilter.field.fieldPath,'__name__');
  assert.throws(()=>s.c.getPurchaseOrderPageData_({search:{number:'bad/id'}}),/ไม่ถูกต้อง/);
});
test('empty bootstrap search preserves the year selector metadata and query errors never appear as empty success',()=>{
  const s=fresh();s.c.getTaxInvoiceAvailableYears_=()=>[2569,2568];
  assert.deepEqual(plain(s.c.getTaxInvoiceListData_(2569,{search:{}}).availableYears),[2569,2568]);
  s.c.failRequest=url=>url.endsWith(':runQuery')?503:0;
  assert.throws(()=>s.c.getTaxInvoiceListData_(2569,{search:{number:'MISSING'}}),/โหลดหน้าข้อมูลไม่สำเร็จ/);
});
test('cold PO search hydrates only referenced vendors and keeps their contact and tax fields',()=>{
  const s=fresh();s.put('Master_Vendors/V1',{Vendor_name:'Selected vendor',Contact_name:'Contact',Email:'v@example.invalid',Tax_ID:'123'});
  for(let i=0;i<1000;i++)s.put('Master_Vendors/UNUSED'+i,{Vendor_name:'Unused'});
  s.put('Purchase_Orders/PO-1',{Order_Date:'2026-10-11',Vendor_ID:'V1',Status:'Pending',Items_JSON:'[]',Receipts_JSON:'[]'});
  const r=s.c.getPurchaseOrderPageData_({search:{number:'PO-1'}});
  assert.equal(r.purchaseOrders[0].vendorName,'Selected vendor');assert.equal(r.purchaseOrders[0].vendorContact,'Contact');assert.equal(r.purchaseOrders[0].vendorTaxId,'123');
  assert.equal(s.calls.filter(x=>x.url.endsWith('/Master_Vendors/V1')).length,1);
  assert(!s.calls.some(x=>/\/documents\/Master_Vendors\?/.test(x.url)));assert.equal(queries(s).length,1);
});
