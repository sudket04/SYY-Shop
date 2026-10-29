// Real HTML/Shared -> real apiGateway/workers -> in-memory Firestore only.
// Session validation is synthetic; all external browser traffic and write RPCs
// are blocked. Timings here are local regression evidence, not Google latency.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {setup}=require('./support/services.cjs');
const {evaluateTemplate}=require('./support/templates.cjs');
const output=path.resolve(__dirname,'../test-results');fs.mkdirSync(output,{recursive:true});
const store=setup(),sessions=new Map(),requests=[],reads={},errors=[];
store.c.readTime=new Date().toISOString();
for(let i=0;i<10000;i++){
 const id='P'+String(i).padStart(5,'0');
 store.put('Master_Products/'+id,{Product_Name:'อะไหล่ '+i,Brand_ID:'B1',Category_ID:'C1',Part_Type:i%2?'แท้':'เทียบ',Part_Number:'PN'+i,Barcode:'BC'+i,Current_Stock:10,Min_Stock:2,Cost_Price:100,Selling_Price:200,Extra_Secret:'never expose'});
 store.put('Product_Images/'+id,{Image_Url:'https://images.invalid/'+id+'.jpg'});
}
store.put('Master_Brands/B1',{Brand_Name:'แบรนด์ไทย'});store.put('Master_Categories/C1',{Category_Name:'อะไหล่'});
store.put('Master_Customers/C1',{Customer_Name:'ผู้ซื้อ',Customer_Type:'ลูกค้าทั่วไป',Branch:'สำนักงานใหญ่'});
store.put('Master_Vendors/V1',{Vendor_name:'ผู้จำหน่าย',Phone:'fixture-only'});
store.put('Master_Zones/Z1',{Area:'A',Build:'โกดัง',Floor:'1',Rack_no:'R1',Rack_Level:'1'});
store.put('Master_Cars/CAR1',{Brand:'รถ',Model:'รุ่น'});
const day=store.c.businessDate_();
for(let i=0;i<125;i++){
 const id=String(i).padStart(4,'0'),date=day; // Document forms save calendar dates, not movement timestamps.
 store.put('Quotations/Q'+id,{Quote_No:'Q'+id,Quote_Date:date,Customer_ID:'C1',Customer_Name:'ผู้ซื้อ',Items_JSON:'[]',Grand_Total:200,Status:'ร่าง'});
 store.put('Master_Tax_Invoice/TX'+id,{Invoice_No:'TX'+id,Invoice_Date:date,Buyer_Name:'ผู้ซื้อ',Items_JSON:'[]',Grand_Total:200});
 store.put('Purchase_Orders/PO'+id,{PO_Number:'PO'+id,Order_Date:date,Vendor_ID:'V1',Status:'Pending',Items_JSON:JSON.stringify([{productCode:'P09999',productName:'อะไหล่ 9999',qty:2,receivedQty:0,costPrice:100}]),Total_Amount:200,Total_Qty:2});
}
for(let i=0;i<1200;i++){
 const id=String(i).padStart(4,'0'),date=new Date(Date.now()-i*1000).toISOString();
 store.put('Stock_Movements/SI'+id+'-1',{Doc_No:'SI'+id,Bill_No:'SI-'+day.replace(/-/g,'')+'-'+id,Type:'OUT',Reason:'ขายหน้าร้าน',Product_Code:'P00000',Product_Name:'อะไหล่ 0',Qty:1,Unit_Price:200,Cost_Price:100,Timestamp:date,Committed_At:date});
}
store.c.getSession_=token=>sessions.get(token)||null;
const fetch=store.c.UrlFetchApp.fetch;
store.c.UrlFetchApp.fetch=(url,options={})=>{
 const result=fetch(url,options);
 if(result.getResponseCode()===200){const body=JSON.parse(result.getContentText());
  const docs=url.endsWith(':runQuery')?body.map(x=>x.document).filter(Boolean):url.endsWith(':batchGet')?body.map(x=>x.found).filter(Boolean):options.method==='get'?(body.documents||(body.name?[body]:[])):[];
  for(const doc of docs){const collection=doc.name.split('/documents/')[1].split('/')[0];reads[collection]=(reads[collection]||0)+1;}
 }
 return result;
};
const allowed=new Set(['getAllProducts','getProductCatalogPage','getProductCatalogFacets','getProductById','getProductImageBatch','getAllMasterDropdowns','getQuotationPageData','getQuotationListData','getTaxInvoicePageData','getTaxInvoiceListData','getStockMovementPage','getStockMovementDetail','getDashboardBootstrap','getDashboardDelta','getPurchaseOrderPageData','getBrands','getCategories','getVendorsFull','getCustomersFull','getZonesFull','getCarsFull']);
const bridge=`<script>
window.gatewayCalls=[];window.Swal={fire:()=>Promise.resolve({isConfirmed:false})};
document.addEventListener('DOMContentLoaded',function(){if(new URL(location.href).searchParams.get('initial')==='history')switchTab('history');});
window.google={script:{run:{withSuccessHandler:function(ok){var runner={withFailureHandler:function(fail){runner.fail=fail;return runner;},apiGateway:function(token,fn,args,ua,metadata){gatewayCalls.push(fn);fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,fn,args,ua,metadata})}).then(r=>{if(!r.ok)throw Error('fixture bridge failed');return r.json();}).then(ok).catch(e=>runner.fail(e));}};return runner;}}}};
</script>`;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(req.method==='POST'&&url.pathname==='/rpc'){
   let input='';for await(const part of req)input+=part;
   const request=JSON.parse(input);if(!allowed.has(request.fn))throw Error('Write or unexpected RPC blocked: '+request.fn);
   const started=performance.now(),result=store.c.apiGateway(request.token,request.fn,request.args,request.ua,request.metadata);
   requests.push({user:request.token,fn:request.fn,options:request.args,elapsedMs:performance.now()-started,notModified:!!result.notModified,success:result.success!==false,message:result.message,rows:result.data?.rows?.length||result.rows?.length});
   res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));return;
  }
  // The last case delivers an already-known page template after revocation;
  // only the real gateway decides whether its stored data may be reused.
  const file=url.searchParams.get('file'),user=url.searchParams.get('user')||'staff',session=sessions.get(user)||(user==='staff'?{username:'fixture-staff',role:'staff'}:null);
  if(!session||!['index.html','Master_Products.html','StockIssue.html','Quotation.html','Master_Tax_Invoice.html','Purchase_Orders.html','Master_Brands.html','Master_Categories.html','Master_Vendors.html','Master_Customers.html','Master_Zones.html','Master_Cars.html'].includes(file)){res.writeHead(404).end();return;}
  const html=evaluateTemplate(file,{username:session.username,userName:session.username,userRole:session.role,authToken:user,webAppUrl:'http://127.0.0.1:'+server.address().port+'/',frameChannel:'',resetMode:'',resetToken:''}).replace(/<script\b[^>]*\bsrc=[^>]*><\/script>/g,'').replace('<head>','<head>'+bridge);
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(html);
 }catch(error){errors.push(error.message);res.writeHead(500).end('Local fixture rejected the request');}
});
let browser,cases=0;
async function main(){
 sessions.set('staff',{username:'fixture-staff',role:'staff'});
 for(let i=0;i<5;i++)sessions.set('viewer'+i,{username:'fixture-viewer'+i,role:'viewer'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
 browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{}),args:['--disable-gpu']});
 const context=await browser.newContext({viewport:{width:1365,height:950}});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const origin='http://127.0.0.1:'+server.address().port;
 async function pageFor(file,user='staff',initial=''){
  const page=await context.newPage();page.errors=[];page.on('pageerror',e=>page.errors.push(e.message));
  await page.goto(origin+'/?file='+file+'&user='+user+'&initial='+initial);return page;
 }
 async function check(name,fn){await fn();cases++;console.log('PASS: '+name);}
 const pages=[];
 await check('five Viewer pages share one cold query and render 50 of 10,000 products without images or editor permissions',async()=>{
  for(let i=0;i<5;i++){
   const page=await pageFor('Master_Products.html','viewer'+i);pages.push(page);
   await page.waitForFunction(()=>!productLoading&&productsCache.length===50);
   assert.match(await page.locator('#productBody').innerText(),/อะไหล่ 0/);
   assert.equal(await page.locator('#productBody img').count(),0);
   assert.equal(await page.locator('#productBody .edit,#productBody .del').count(),0);
   assert.equal(await page.evaluate(()=>productsCache.some(x=>'Extra_Secret' in x)),false);
  }
  assert.equal(reads.Master_Products,51);assert.equal(reads.Product_Images||0,0);
  assert.deepEqual(errors,[]);
 });
 await check('real signed cursor stays on page two, returns to cached page one and survives an image-only version change',async()=>{
  const page=pages[0];await page.locator('#btnNextPage').click();
  await page.waitForFunction(()=>!productLoading&&currentPage===2);
  assert.equal(await page.evaluate(()=>productsCache[0].productCode),'P00050');
  const count=reads.Master_Products;store.c.clearCollectionCache_('Product_Images');
  await page.locator('#btnPrevPage').click();await page.waitForFunction(()=>!productLoading&&currentPage===1);
  await page.locator('#btnNextPage').click();await page.waitForFunction(()=>!productLoading&&currentPage===2);
  assert.equal(await page.evaluate(()=>productsCache[0].productCode),'P00050');assert.equal(reads.Master_Products,count);
  await page.screenshot({path:path.join(output,'backend-viewer-page-two.png')});
 });
 await check('unchanged search finds the final product and full-catalog facets stay global while table images remain absent',async()=>{
  const page=pages[0];await page.locator('#tableSearchInput').fill('BC9999');await page.evaluate(()=>onSearchInput());
  await page.waitForFunction(()=>!productLoading&&productsCache.length===1&&productsCache[0].productCode==='P09999');
  const facet=await page.evaluate(()=>new Promise((resolve,reject)=>callApi('getProductCatalogFacets',[{includeImages:false},'partType'],resolve,reject)));
  assert.deepEqual(facet.values.sort(),['เทียบ','แท้'].sort());assert.equal(reads.Product_Images||0,0);
  assert.equal(await page.locator('#productBody img').count(),0);
 });
 await check('Tax list avoids catalog until editor; POS reuses the validated stored catalog and keyboard reaches the final row',async()=>{
  const tax=await pageFor('Master_Tax_Invoice.html');pages.push(tax);
  await tax.waitForFunction(()=>taxInvoiceBootstrapped&&syyUxBusy===0);
  assert.equal(await tax.evaluate(()=>productsCache.length),0);
  const initial=requests.find(x=>x.user==='staff'&&x.fn==='getTaxInvoicePageData');assert.equal(initial.options[1].deferSections,true);
  await tax.evaluate(()=>openAddModal(true));await tax.waitForFunction(()=>invoiceEditorReady&&productsCache.length===10000);
  assert.equal(await tax.evaluate(()=>productsCache.at(-1).productCode),'P09999');
  try{await tax.waitForFunction(async()=>{const stamp=await syyDiskCache.lookup('getAllProducts[{"compact":true}]');return !!(stamp&&stamp.record);},{},{timeout:3000});}
  catch(error){console.error('Catalog persistence diagnostic',await tax.evaluate(()=>({sections:invoiceSectionVersions,cache:Array.from(syyReadCache.entries()).map(([key,r])=>({key,length:r.raw.length,eligible:syyDiskCache.eligible(key,r.raw),expiresAt:r.expiresAt})),disk:syyDiskCache.stats,errors:window.gatewayCalls})));throw error;}
  const count=reads.Master_Products,pos=await pageFor('StockIssue.html');pages.push(pos);
  try{await pos.waitForFunction(()=>products.length===10000,{},{timeout:5000});}
  catch(error){console.error('POS diagnostic',await pos.evaluate(()=>({length:products.length,status:document.getElementById('resultCount').textContent,body:document.getElementById('resultList').textContent,cache:syyCacheStats,calls:gatewayCalls})),requests.slice(-4),pos.errors);throw error;}
  assert.equal(requests.findLast(x=>x.user==='staff'&&x.fn==='getAllProducts').notModified,true);
  assert.equal(reads.Master_Products,count);
  await pos.evaluate(()=>{document.getElementById('searchInput').value='BC9999';renderResults();});
  await pos.waitForFunction(()=>document.querySelector('#resultList').textContent.includes('อะไหล่ 9999'));
  assert.equal(await pos.locator('#resultList .res-row').count(),1);
  await pos.evaluate(()=>moveSel(1));assert.equal(await pos.evaluate(()=>selIdx),0);
 });
 await check('Dashboard consumes real packed movements and a validated catalog, then reuses its warm snapshot without data reads',async()=>{
  const before={...reads},dashboard=await pageFor('index.html');pages.push(dashboard);
  await dashboard.waitForFunction(()=>DASH.loaded&&!DASH.loading);
  assert.equal(await dashboard.evaluate(()=>DASH.products.length),10000);assert.equal(await dashboard.evaluate(()=>DASH.movements.length),1200);
  assert.equal(await dashboard.evaluate(()=>DASH.movements.reduce((n,m)=>n+m.qty*m.unitPrice,0)),240000);
  assert.equal(reads.Master_Products,before.Master_Products);
  assert.equal(reads.Stock_Movements-(before.Stock_Movements||0),1200);
  assert.equal(await dashboard.locator('#dashKpiRow .sk').count(),0);
  const warm={...reads};await dashboard.evaluate(()=>dashLoad());await dashboard.waitForFunction(()=>!DASH.loading);assert.deepEqual(reads,warm);
 });
 await check('Quotation and Tax list page through real snapshot cursors without duplicate rows or an automatic return to page one',async()=>{
  for(const [file,key,boot] of [['Quotation.html','quotations','quotationBootstrapped'],['Master_Tax_Invoice.html','invoicesCache','taxInvoiceBootstrapped']]){
   const page=await pageFor(file);pages.push(page);await page.waitForFunction(name=>window[name]&&syyUxBusy===0,boot);
   await page.evaluate(()=>switchTab('list'));
   assert.equal(await page.evaluate(name=>window[name].length,key),50);
   const first=await page.evaluate(name=>window[name].map(x=>x.id),key);
   await page.getByRole('button',{name:'โหลดเพิ่ม',exact:true}).click();await page.waitForFunction(()=>!documentPager.busy());
   const all=await page.evaluate(name=>window[name].map(x=>x.id),key);assert.equal(all.length,125);assert.equal(new Set(all).size,125);assert.deepEqual(all.slice(0,50),first);
   await page.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();
   const body=page.locator(file==='Quotation.html'?'#listBody':'#taxBody'),visible=await body.locator('tr[data-row-key]').evaluateAll(rows=>rows.map(row=>row.dataset.rowKey));
   assert.equal(visible.length,50);assert(visible.every(id=>!first.includes(id)));
   const count=requests.length;await page.waitForTimeout(50);assert.equal(requests.length,count);assert.deepEqual(await body.locator('tr[data-row-key]').evaluateAll(rows=>rows.map(row=>row.dataset.rowKey)),visible);
  }
 });
 await check('cold PO history omits product catalog reads and its global pending count includes orders outside the visible page',async()=>{
  store.c.clearCollectionCache_('Master_Products');const before={...reads},orders=await pageFor('Purchase_Orders.html','staff','history');pages.push(orders);
  await orders.waitForFunction(()=>purchaseHistoryLoaded&&syyUxBusy===0);
  assert.equal(await orders.evaluate(()=>purchaseOrders.length),50);assert.equal(await orders.evaluate(()=>purchaseCreateLoaded),false);
  assert.equal(await orders.locator('#statPendingPO').innerText(),'125');assert.equal(reads.Master_Products,before.Master_Products);
  const first=await orders.evaluate(()=>purchaseOrders.map(x=>x.poId));await orders.getByRole('button',{name:'โหลดเพิ่ม',exact:true}).click();await orders.waitForFunction(()=>!documentPager.busy());
  const all=await orders.evaluate(()=>purchaseOrders.map(x=>x.poId));assert.equal(all.length,125);assert.equal(new Set(all).size,125);assert.deepEqual(all.slice(0,50),first);
  await orders.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();const visible=await orders.locator('#historyTableBody tr[data-row-key]').evaluateAll(rows=>rows.map(row=>row.dataset.rowKey));assert.equal(visible.length,50);assert(visible.every(id=>!first.includes(id)));assert.equal(reads.Master_Products,before.Master_Products);
 });
 await check('six master pages render actual gateway rows and repeated reads reuse the snapshot',async()=>{
  for(const file of ['Master_Brands.html','Master_Categories.html','Master_Vendors.html','Master_Customers.html','Master_Zones.html','Master_Cars.html']){
   const page=await pageFor(file);pages.push(page);await page.waitForFunction(()=>cache.length===1&&syyUxBusy===0);
   assert.equal(await page.locator('#tbodyMain tr[data-row-key]').count(),1,file);
   const count=requests.length;await page.evaluate(()=>loadTable());await page.waitForFunction(()=>syyUxBusy===0);assert.equal(requests.length,count,file);
  }
 });
 await check('bill-level history uses real gateway counts, complete summaries and cached view pagination without detail N+1',async()=>{
  const before=reads.Stock_Movements||0,page=await pageFor('StockIssue.html','staff','history');pages.push(page);
  await page.waitForFunction(()=>mvPage.initialized&&!mvPage.busy&&movementBillRows().length===50);
  assert.equal(await page.locator('#panelHistory thead th').count(),6);assert.equal(await page.locator('#mvBody tr').count(),50);assert.equal(reads.Stock_Movements-before,51);
  assert.equal(await page.evaluate(()=>gatewayCalls.filter(x=>x==='getStockMovementDetail').length),0);assert.equal(await page.evaluate(()=>movementBillRows().every(x=>x.complete&&x.amtSell===200)),true);
  await page.locator('#mvViewNext').click();await page.waitForFunction(()=>!mvPage.busy&&mvViewPage===2);const count=requests.length,documents=reads.Stock_Movements;assert.equal(await page.locator('#mvBody tr').count(),50);
  await page.locator('#mvViewPrev').click();await page.locator('#mvViewNext').click();assert.equal(requests.length,count);assert.equal(reads.Stock_Movements,documents);assert.equal(await page.evaluate(()=>mvViewPage),2);
 });
 await check('revoked session cannot open a new page from persisted cache',async()=>{
  sessions.delete('staff');const page=await pageFor('StockIssue.html');pages.push(page);
  await page.waitForFunction(()=>window.syyExpiryStarted===true&&syyUxBusy===0);
  assert.equal(await page.evaluate(()=>products.length),0);
 });
 for(const page of pages){assert.deepEqual(page.errors,[]);await page.close();}
 assert.deepEqual(errors,[]);assert.equal(store.commits.length,0);
 assert(!store.calls.some(x=>['patch','delete'].includes(x.options.method)||x.url.endsWith(':commit')));
 fs.writeFileSync(path.join(output,'backend-browser.json'),JSON.stringify({fixtureOnly:true,products:10000,cases,reads,requests,writes:store.commits.length,sessionValidation:'synthetic; real apiGateway authorization and workers',productionLatencyMeasured:false},null,2));
 console.log('Passed '+cases+' backend-integrated browser groups; no real network or DB writes.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
