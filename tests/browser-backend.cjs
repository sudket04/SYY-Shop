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
const allowed=new Set(['getAllProducts','getProductCatalogPage','getProductCatalogFacets','getProductById','getProductImageBatch','getAllMasterDropdowns','getQuotationPageData','getQuotationListData','getTaxInvoicePageData','getTaxInvoiceListData','getStockMovementPage','getStockMovementDetail']);
const bridge=`<script>
window.gatewayCalls=[];window.Swal={fire:()=>Promise.resolve({isConfirmed:false})};
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
  if(!session||!['Master_Products.html','StockIssue.html','Quotation.html','Master_Tax_Invoice.html'].includes(file)){res.writeHead(404).end();return;}
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
 async function pageFor(file,user='staff'){
  const page=await context.newPage();page.errors=[];page.on('pageerror',e=>page.errors.push(e.message));
  await page.goto(origin+'/?file='+file+'&user='+user);return page;
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
