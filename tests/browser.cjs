// Local HTML + mocked Apps Script gateway. Never connects to production services.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
fs.mkdirSync(output, {recursive:true});
function render(file, role, ancestors = [], channel = '') {
  if (ancestors.includes(file)) return '';
  let html = fs.readFileSync(path.join(root, file), 'utf8');
  // include_() returns raw HtmlOutput in Code.gs; included fragments are not recursively evaluated.
  if (!ancestors.length) html = html.replace(/<\?!= include_\('([^']+)'\); \?>/g, (_, name)=>render(name+'.html', role, [file]));
  html = html.replace(/<\? if \(userRole === 'staff' \|\| userRole === 'admin'\) \{ \?>([\s\S]*?)<\? \} \?>/g, (_,content)=>role==='viewer'?'':content);
  html = html.replace(/<\?= userRole \?>/g, role).replace(/<\?= authToken \?>/g,'test-token')
    .replace(/<\?= webAppUrl \?>/g, 'http://127.0.0.1:'+server.address().port+'/').replace(/<\?= frameChannel \?>/g,channel).replace(/<\?[\s\S]*?\?>/g,'fixture');
  html = html.replace(/<script\b[^>]*\bsrc=[^>]*><\/script>/g, '');
  return html;
}
const fixture = `<script>
window.apiCalls=[];window.alerts=[];window.apiFailure='';window.apiHold='';window.apiPending=[];
window.Swal={fire:function(o){alerts.push(o);return Promise.resolve({isConfirmed:true});}};
window.fixtureProduct={id:'P1',productCode:'P1',productName:'Test Part',partNumber:'PN1',barcode:'123',sellingPrice:200,costPrice:100,currentStock:10,minStock:2,zoneId:'Z1',zoneName:'A (Rack R1)',status:'Active',imageUrls:[]};
window.fixtureCustomer={id:'C1',Customer_Name:'Buyer',Customer_Type:'ลูกค้าทั่วไป',Address:'Saved address',Branch:'สาขา 2',Tax_ID:'1234567890123'};
window.fixtureInvoice={id:'TX1',invoiceNo:'SYY 0001/10/69',invoiceDate:'2026-10-11',buyerName:'Buyer',buyerAddress:'Saved address',buyerTaxId:'1234567890123',buyerBranch:'สาขา 2',items:[{name:'Test Part',qty:1,unit:'ชิ้น',unitPrice:100}],subtotal:100,vatAmount:7,grandTotal:107};
window.respond=function(fn,args){
 if(fn==='getDashboardBootstrap')return {products:[fixtureProduct],movements:[],poVendorMap:{},serverTime:'2026-10-11T05:00:00Z'};
 if(fn==='getDashboardDelta')return {success:true,productStocks:[],movements:[],serverTime:'2026-10-11T05:01:00Z'};
 if(['getBrands','getCategories','getVendorsFull','getCustomersFull','getCarsFull','getAllUsers','getActivityLog','getStockMovements'].includes(fn))return [];
 if(fn==='getPurchaseOrderPageData')return {lowStockItems:[],purchaseOrders:[]};
 if(fn==='saveMasterData')return {success:true,id:'NEW',data:args[3]};
 if(fn==='getQuotationPageData')return {products:[fixtureProduct],customers:[fixtureCustomer],quotations:[],availableYears:[2569],seller:{name:'Seller'},statuses:['ร่าง'],marginMin:15};
 if(fn==='getQuotationListData')return {quotations:window.savedQuote?[window.savedQuote]:[],availableYears:[2569,2568]};
 if(fn==='getTaxInvoicePageData')return {products:[fixtureProduct],customers:[fixtureCustomer],invoices:[fixtureInvoice],availableYears:[2569,2568],seller:{name:'Seller',branch:'สำนักงานใหญ่',address:'Address',taxId:'1234567890123'}};
 if(fn==='getTaxInvoiceListData')return {invoices:window.savedInvoice?[window.savedInvoice]:[fixtureInvoice],availableYears:[2569,2568]};
 if(fn==='saveTaxInvoice'){var d=args[0];window.savedInvoice=Object.assign({},fixtureInvoice,d,{id:d.docId||'TX2',invoiceNo:fixtureInvoice.invoiceNo,buyerBranch:d.buyerBranch||'ไม่ระบุ'});return {success:true,id:savedInvoice.id,invoice:savedInvoice,message:'saved'};}
 if(fn==='saveCustomer')return {success:true,id:'C2',data:{Customer_Name:args[0].customerName,Customer_Type:'ลูกค้าทั่วไป',Branch:args[0].branch,Address:args[0].address||''}};
 if(fn==='getZonesFull')return [{id:'Z1',Area:'A',Build:'โกดัง',Floor:'ชั้น 2',Rack_no:'R1',Rack_Level:''}];
 if(fn==='getAllMasterDropdowns')return {brands:[{id:'B1',Name:'B'}],categories:[{id:'CAT1',Name:'CAT'}],vendors:[{id:'V1',Name:'V'}],zones:[{id:'Z1',Name:'A (Rack R1)'}],cars:[]};
 if(fn==='getAllProducts')return [fixtureProduct];
 if(fn==='saveZone')return {success:true,id:args[0].docId||'Z2',data:{Area:args[0].area,Build:args[0].build,Floor:args[0].floor,Rack_no:args[0].rackNo,Rack_Level:args[0].rackLevel}};
 if(fn==='authGetMyProfile')return {success:true,username:'staff',fullName:'Staff',role:'staff',totpEnabled:false,recoveryCodesLeft:0};
 return {success:true};
};
window.google={script:{run:{withSuccessHandler:function(ok){var runner={withFailureHandler:function(fail){runner.fail=fail;return runner;},apiGateway:function(token,fn,args){apiCalls.push({fn:fn,args:args});var done=function(){if(apiFailure===fn)runner.fail({message:'mock network failure'});else ok(respond(fn,args));};if(apiHold===fn)apiPending.push(done);else setTimeout(done,5);}};return runner;}}}};
</script>`;
const server = http.createServer((req,res)=>{
  const u = new URL(req.url,'http://localhost');
  const pages={home:'index.html',stockissue:'StockIssue.html',products:'Master_Products.html',taxinvoice:'Master_Tax_Invoice.html',quotation:'Quotation.html',orders:'Purchase_Orders.html',brands:'Master_Brands.html',categories:'Master_Categories.html',zones:'Master_Zones.html'};
  const file = u.searchParams.get('file') || pages[u.searchParams.get('page')] || 'Quotation.html';
  if(!/^[A-Za-z_]+\.html$/.test(file)) {res.writeHead(400).end();return;}
  const html=render(file,u.searchParams.get('role')||'staff',[],u.searchParams.get('channel')||'').replace('<head>','<head>'+fixture);
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);
});
let browser, cases=0;
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const executable=process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
  browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{}),args:['--disable-gpu']});
  const context=await browser.newContext({viewport:{width:1365,height:950}});
  await context.route('https://**/*',r=>r.abort());
  async function pageFor(file,role='staff'){
    const page=await context.newPage();page.errors=[];
    page.on('pageerror',e=>page.errors.push(e.message));
    await page.goto('http://127.0.0.1:'+port+'/?file='+file+'&role='+role);
    await page.waitForTimeout(100);
    return page;
  }
  async function check(name,fn){await fn();cases++;console.log('PASS: '+name);}
  await check('All 15 routed pages load after private include rename',async()=>{
    for(const file of ['index.html','Master_Products.html','StockIssue.html','Purchase_Orders.html','Quotation.html',
      'Master_Tax_Invoice.html','Master_Brands.html','Master_Categories.html','Master_Vendors.html','Master_Customers.html',
      'Master_Zones.html','Master_Cars.html','Profile.html','Manage_Users.html','login.html']) {
      const p=await pageFor(file);assert.deepEqual(p.errors,[],file);await p.close();
    }
  });
  await check('Brands and Categories keep saveMasterData operation through gateway',async()=>{
    for(const [file,collection] of [['Master_Brands.html','Master_Brands'],['Master_Categories.html','Master_Categories']]) {
      const p=await pageFor(file);await p.evaluate(()=>openAddModal());await p.locator('#fName').fill('New master');
      await p.evaluate(()=>handleSubmit({preventDefault(){}}));await p.waitForTimeout(40);
      const calls=await p.evaluate(()=>apiCalls.filter(call=>call.fn==='saveMasterData'));
      assert.equal(calls.length,1);assert.equal(calls[0].args[0],collection);assert.deepEqual(p.errors,[]);await p.close();
    }
  });
  await check('Quotation input keeps DOM, focus and decimal typing; totals/profit and master price',async()=>{
    const p=await pageFor('Quotation.html');await p.evaluate(()=>addToBasket('P1'));
    const price=p.locator('#itemBasket .price-input');await price.focus();await price.press('Control+A');
    await p.evaluate(()=>window.originalPriceInput=document.querySelector('.price-input'));
    await price.pressSequentially('150.25');
    assert.equal(await price.inputValue(),'150.25');
    assert.equal(await p.evaluate(()=>document.activeElement===originalPriceInput&&document.querySelector('.price-input')===originalPriceInput),true);
    assert.equal(await p.evaluate(()=>basket[0].unitPrice),150.25);assert.equal(await p.evaluate(()=>products[0].sellingPrice),200);
    const qty=p.locator('.quote-qty');await qty.fill('2');await p.locator('#inpDiscPct').fill('10');
    assert.deepEqual(await p.evaluate(()=>{const t=currentTotals();return [t.subtotal,t.vat,t.grandTotal,t.profit];}),[300.5,18.93,289.38,70.45]);
    const totals=await p.evaluate(()=>currentTotals());assert.equal(totals.marginPct,26);
    await p.screenshot({path:path.join(output,'quotation-desktop.png')});assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Quotation quick customer add/cancel preserves draft, uses single save and selects returned customer',async()=>{
    const p=await pageFor('Quotation.html');await p.evaluate(()=>{addToBasket('P1');document.getElementById('inpNote').value='Draft note';openQuickAddCustomer();});
    await p.locator('#qcName').fill('Quick Buyer');await p.locator('#qcAddress').fill('Quick address');
    await p.evaluate(()=>apiHold='saveCustomer');await p.locator('#qcBtnSave').click();
    await p.evaluate(()=>submitQuickAddCustomer({preventDefault(){}}));
    assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='saveCustomer').length),1);
    await p.evaluate(()=>{apiHold='';apiPending.shift()();});
    assert.equal(await p.locator('#selCustomer').inputValue(),'C2');assert.equal(await p.locator('#inpNote').inputValue(),'Draft note');
    assert.equal(await p.evaluate(()=>basket.length),1);assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getCustomersFull').length),0);
    await p.evaluate(()=>{openQuickAddCustomer();closeQuickAddCustomer();});assert.equal(await p.evaluate(()=>basket[0].unitPrice),200);
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Quotation validation stops empty price and zero quantity before write',async()=>{
    const p=await pageFor('Quotation.html');await p.evaluate(()=>{addToBasket('P1');document.getElementById('selCustomer').value='C1';});
    await p.locator('.price-input').fill('');await p.evaluate(()=>saveQuotationNow());
    await p.locator('.price-input').fill('100');await p.locator('.quote-qty').fill('0');await p.evaluate(()=>saveQuotationNow());
    assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='saveQuotation').length),0);assert.equal(await p.evaluate(()=>alerts.length),2);await p.close();
  });
  await check('Quotation saved price and historical/deleted customer survive loading and preview',async()=>{
    const p=await pageFor('Quotation.html');await p.evaluate(()=>{quotations=[{id:'QT1',quoteNo:'QT 1',customerId:'DELETED',customerName:'Historical Buyer',customerAddress:'Historical Address',customerTaxId:'1234567890123',quoteDate:'2026-10-11',status:'ร่าง',items:[{productCode:'P1',productName:'Part',qty:2,unitPrice:125,costPrice:100}]}];loadQuotationIntoBuild('QT1');switchTab('doc');});
    assert.equal(await p.evaluate(()=>basket[0].unitPrice),125);assert.match(await p.locator('#printArea').innerText(),/Historical Buyer/);
    assert.match(await p.locator('#printArea').innerText(),/Historical Address/);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Invoice saves across years, refreshes list only and saved preview; prevents double submit',async()=>{
    const p=await pageFor('Master_Tax_Invoice.html');await p.evaluate(()=>{openEditModal('TX1');document.getElementById('modalInvoiceDate').value='2025-10-11';document.getElementById('modalBuyerBranch').value='สาขา 3';apiHold='saveTaxInvoice';handleSubmit();handleSubmit();});
    assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='saveTaxInvoice').length),1);
    await p.evaluate(()=>{apiHold='';apiPending.shift()();});await p.waitForTimeout(50);
    assert.equal(await p.evaluate(()=>currentPageYear),2568);assert.equal(await p.evaluate(()=>currentPrintInvoice.invoiceDate),'2025-10-11');
    assert.equal(await p.evaluate(()=>currentPrintInvoice.invoiceNo),'SYY 0001/10/69');assert.equal(await p.evaluate(()=>currentPrintInvoice.buyerBranch),'สาขา 3');
    assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getTaxInvoicePageData').length),1);
    assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getTaxInvoiceListData').length),1);
    assert.match(await p.locator('#dashStats').innerText(),/2568/);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Invoice write succeeds but refresh fails: preview survives and write is not retried',async()=>{
    const p=await pageFor('Master_Tax_Invoice.html');await p.evaluate(()=>{openEditModal('TX1');document.getElementById('modalBuyerName').value='Saved Buyer';apiFailure='getTaxInvoiceListData';handleSubmit();});await p.waitForTimeout(60);
    assert.equal(await p.evaluate(()=>currentPrintInvoice.buyerName),'Saved Buyer');
    assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='saveTaxInvoice').length),1);
    assert.match(await p.locator('#toastWrap').innerText(),/บันทึกสำเร็จแล้ว/);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Invoice buyer branch defaults and actual legacy branch',async()=>{
    const p=await pageFor('Master_Tax_Invoice.html');await p.evaluate(()=>openAddModal());assert.equal(await p.locator('#modalBuyerBranch').inputValue(),'ไม่ระบุ');
    await p.evaluate(()=>{document.getElementById('modalCustomerSelect').value='C1';onCustomerSelect();});assert.equal(await p.locator('#modalBuyerBranch').inputValue(),'สาขา 2');
    await p.evaluate(()=>openQuickAddCustomer());assert.equal(await p.locator('#qcBranch').inputValue(),'');await p.close();
  });
  await check('Refresh API failure payload preserves invoice cache and calls failure callback',async()=>{
    const p=await pageFor('Master_Tax_Invoice.html');await p.evaluate(()=>{window.respond=()=>({success:false,message:'mock server failure'});loadAll(2569,null,()=>window.loadFailed=true);});await p.waitForTimeout(30);
    assert.equal(await p.evaluate(()=>window.loadFailed),true);assert.equal(await p.evaluate(()=>invoicesCache.length),1);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Quotation save across years and refresh failure preserves saved preview without duplicate write',async()=>{
    const p=await pageFor('Quotation.html');await p.evaluate(()=>{
      addToBasket('P1');document.getElementById('selCustomer').value='C1';document.getElementById('inpQuoteDate').value='2025-10-11';
      const original=window.respond;window.respond=function(fn,args){
        if(fn==='saveQuotation')return {success:true,id:'QT2',quotation:{id:'QT2',quoteNo:'QT saved',customerId:'C1',customerName:'Snapshot Buyer',customerAddress:'Snapshot Address',quoteDate:args[0].quoteDate,status:'ร่าง',items:args[0].items}};
        if(fn==='getQuotationListData')return {success:false,message:'failed list'};
        return original(fn,args);
      };apiHold='saveQuotation';saveQuotationNow();saveQuotationNow();
    });
    assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='saveQuotation').length),1);
    await p.evaluate(()=>{apiHold='';apiPending.shift()();});await p.waitForTimeout(40);
    assert.match(await p.locator('#printArea').innerText(),/QT saved/);assert.match(await p.locator('#printArea').innerText(),/Snapshot Buyer/);
    assert.equal(await p.evaluate(()=>apiCalls.find(x=>x.fn==='getQuotationListData').args[0]),2568);
    assert.match(await p.locator('#toastWrap').innerText(),/บันทึกสำเร็จแล้ว/);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Viewer has no quick-add controls and cannot open quick-add workflow',async()=>{
    for(const file of ['Quotation.html','Master_Tax_Invoice.html']){
      const p=await pageFor(file,'viewer');assert.equal(await p.locator('button[onclick="openQuickAddCustomer()"]',).count(),0);
      await p.evaluate(()=>openQuickAddCustomer());assert.equal(await p.locator('#quickCustomerModal.active').count(),0);await p.close();
    }
  });
  await check('Zone level form, legacy edit, search/filter and delta display',async()=>{
    const p=await pageFor('Master_Zones.html');await p.evaluate(()=>openAddModal());assert.equal(await p.locator('#fRackLevel').isDisabled(),true);
    await p.waitForTimeout(80);
    await p.locator('#fArea').fill('B');await p.locator('#fRackNo').fill('R2');assert.equal(await p.evaluate(()=>document.getElementById('fRackLevel').required),true);
    await p.selectOption('#fRackLevel','3',{force:true});await p.evaluate(()=>handleSubmit({preventDefault(){}}));await p.waitForTimeout(40);
    assert.match(await p.locator('#tbodyMain').innerText(),/R2/);assert.equal(await p.evaluate(()=>cache.find(x=>x.id==='Z2').Rack_Level),'3');
    await p.evaluate(()=>{openEditModal('Z1');});assert.equal(await p.evaluate(()=>document.getElementById('fRackLevel').required),false);
    await p.screenshot({path:path.join(output,'zone-legacy-desktop.png')});assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Product stock delta respects dirty stock input and baseline, zone labels propagate',async()=>{
    const p=await pageFor('Master_Products.html');await p.evaluate(()=>openEditModal('P1'));
    await p.evaluate(()=>applyStockDeltaToProductPage([{productCode:'P1',currentStock:8}]));assert.equal(await p.locator('#inp_currentStock').inputValue(),'8');
    await p.locator('#inp_currentStock').fill('12');await p.evaluate(()=>applyStockDeltaToProductPage([{productCode:'P1',currentStock:7}]));
    assert.equal(await p.locator('#inp_currentStock').inputValue(),'12');assert.equal(await p.evaluate(()=>document.getElementById('inp_currentStock').dataset.originalStock),'8');
    await p.evaluate(()=>applyMasterDeltaToProduct({kind:'zones',item:{id:'Z1',Area:'A',Floor:'ชั้น 2',Rack_no:'R1',Rack_Level:'3'}}));
    assert.equal(await p.evaluate(()=>productsCache[0].zoneName),'A — ชั้น 2 (Rack R1 · ระดับ 3)');assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Product image draft staging, move, primary, delete and cancel make no server calls',async()=>{
    const p=await pageFor('Master_Products.html');await p.evaluate(()=>{openEditModal('P1');window.callsBefore=apiCalls.length;stageProductImageNow('AA','data:image/jpeg;base64,AA',0);stageProductImageNow('BB','data:image/jpeg;base64,BB',1);setPrimaryProductImageNow(1);moveProductImageNow(1,0);deleteProductImageNow(1);});await p.waitForTimeout(30);
    assert.equal(await p.evaluate(()=>apiCalls.length),await p.evaluate(()=>callsBefore));
    assert.equal(await p.evaluate(()=>productImageDraftDirty),true);await p.evaluate(()=>closeProductModal());
    assert.equal(await p.evaluate(()=>apiCalls.length),await p.evaluate(()=>callsBefore));assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Password eye controls preserve value/handlers, keyboard toggle and hide on reset at desktop/mobile',async()=>{
    for(const width of [1365,390]){
      const p=await pageFor('login.html');await p.setViewportSize({width,height:844});
      assert.equal(await p.locator('.syy-password-toggle').count(),5);
      const input=p.locator('#inpPassword');await input.fill('fixture-only');const toggle=p.locator('#inpPassword + button');
      await toggle.focus();await p.keyboard.press('Enter');assert.equal(await input.getAttribute('type'),'text');assert.equal(await input.inputValue(),'fixture-only');
      assert.equal(await toggle.getAttribute('aria-pressed'),'true');await p.keyboard.press('Space');assert.equal(await input.getAttribute('type'),'password');
      await toggle.click();await p.evaluate(()=>document.getElementById('loginForm').reset());assert.equal(await input.getAttribute('type'),'password');
      const box=await toggle.boundingBox();assert(box.width>=38&&box.height>=36);assert.deepEqual(p.errors,[]);
      await p.screenshot({path:path.join(output,'login-'+width+'.png')});await p.close();
    }
  });
  await check('Profile password fields and dynamically added password fields share accessible eye controls',async()=>{
    const p=await pageFor('Profile.html');assert.equal(await p.locator('.syy-password-toggle').count(),4);
    await p.evaluate(()=>{const input=document.createElement('input');input.id='dynamicPassword';input.type='password';document.body.appendChild(input);});await p.waitForTimeout(20);
    assert.equal(await p.locator('#dynamicPassword + button').getAttribute('aria-label'),'แสดงรหัสผ่าน');
    await p.evaluate(()=>{document.getElementById('dynamicPassword').value='fixture-only';document.querySelector('#dynamicPassword + button').click();SYYPassword.hide(document);});
    assert.equal(await p.locator('#dynamicPassword').inputValue(),'fixture-only');assert.equal(await p.locator('#dynamicPassword').getAttribute('type'),'password');
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Mobile quotation price and quick customer modal remain usable',async()=>{
    const p=await pageFor('Quotation.html');await p.setViewportSize({width:390,height:844});await p.evaluate(()=>{addToBasket('P1');openQuickAddCustomer();});
    await p.locator('#qcName').fill('Mobile Buyer');const box=await p.locator('#quickCustomerModal .modal-box').boundingBox();assert(box.width<=390);
    await p.screenshot({path:path.join(output,'quotation-mobile-quick-add.png')});assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Stock F4/double confirmation submits once and escapes hostile product names in Swal',async()=>{
    const p=await pageFor('StockIssue.html');
    await p.evaluate(()=>{products[0].productName='<img src=x onerror=alert(1)>';addToBasket('P1');window.confirmResolve=null;Swal.fire=o=>{alerts.push(o);return new Promise(resolve=>confirmResolve=resolve);};confirmIssue();confirmIssue();confirmIssue();});
    assert.equal(await p.evaluate(()=>alerts.length),1);assert.equal(await p.evaluate(()=>alerts[0].html.includes('<img')),false);assert.equal(await p.evaluate(()=>alerts[0].html.includes('&lt;img')),true);
    await p.evaluate(()=>{apiHold='issueStock';confirmResolve({isConfirmed:true});});await p.waitForTimeout(20);
    await p.keyboard.press('F4');await p.evaluate(()=>confirmIssue());
    assert.equal(await p.evaluate(()=>apiCalls.filter(c=>c.fn==='issueStock').length),1);assert.equal(await p.evaluate(()=>issueBusy),true);
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Unknown stock result keeps its request ID across retries and page reload',async()=>{
    const p=await pageFor('StockIssue.html');await p.evaluate(()=>{apiFailure='issueStock';addToBasket('P1');confirmIssue();});await p.waitForTimeout(30);
    const id=await p.evaluate(()=>apiCalls.find(c=>c.fn==='issueStock').args[0].requestId);
    assert(id);assert.equal(await p.evaluate(()=>basket.length),1);assert.equal(await p.locator('#inpRefNo').isDisabled(),true);
    await p.reload();await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>basket.length),1);
    await p.evaluate(()=>{apiFailure='issueStock';confirmIssue();});await p.waitForTimeout(30);
    assert.equal(await p.evaluate(()=>apiCalls.find(c=>c.fn==='issueStock').args[0].requestId),id);
    await p.evaluate(()=>{apiFailure='';confirmIssue();});await p.waitForTimeout(30);
    assert.equal(await p.evaluate(()=>basket.length),0);assert.equal(await p.evaluate(()=>sessionStorage.getItem(issueStorageKey)),null);
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Receive confirmation locks duplicate submits and retains original request on transport failure',async()=>{
    const p=await pageFor('Purchase_Orders.html');
    await p.evaluate(()=>{purchaseOrders=[{poId:'PO1',vendorName:'Vendor',status:'Ordered',items:[{productCode:'P1',productName:'Part',qty:10,receivedQty:0}],receipts:[]}];openReceiveModal('PO1');document.getElementById('recvInvoiceNo').value='INV1';document.getElementById('recvReceiverName').value='Staff';apiFailure='receiveGoods';apiHold='receiveGoods';submitReceiveGoods();submitReceiveGoods();});await p.waitForTimeout(20);
    assert.equal(await p.evaluate(()=>apiCalls.filter(c=>c.fn==='receiveGoods').length),1);
    const id=await p.evaluate(()=>apiCalls.find(c=>c.fn==='receiveGoods').args[0].requestId);
    await p.evaluate(()=>{apiHold='';apiPending.shift()();});await p.waitForTimeout(20);await p.evaluate(()=>submitReceiveGoods());await p.waitForTimeout(20);
    assert.equal(await p.evaluate(()=>apiCalls.filter(c=>c.fn==='receiveGoods')[1].args[0].requestId),id);assert.equal(await p.locator('#recvInvoiceNo').isDisabled(),true);
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Dashboard includes Online sales and immutable receiving cost, marks missing historical cost',async()=>{
    const p=await pageFor('index.html');await p.evaluate(()=>{
      DASH.year=2026;DASH.month=9;DASH.gran='m';DASH.products=[Object.assign({},fixtureProduct,{costPrice:999})];
      DASH.movements=[{id:'online',type:'OUT',reason:'ขาย Online',qty:2,unitPrice:125,costPrice:75,docNo:'SI1',productCode:'P1',timestamp:'2026-10-11T05:00:00Z'},
        {id:'received',type:'IN',qty:3,costPrice:50,docNo:'SR1',productCode:'P1',timestamp:'2026-10-11T05:00:00Z'},
        {id:'unknown',type:'IN',qty:1,costPrice:null,docNo:'SR2',productCode:'P1',timestamp:'2026-10-11T05:00:00Z'}].map(m=>Object.assign(m,{ts:new Date(m.timestamp)}));dashBuildAggregates();dashRenderAll();
    });
    const data=await p.evaluate(()=>dashPeriod().cur);assert.equal(data.salesValue,250);assert.equal(data.salesBills,1);assert.equal(data.recvValue,150);assert.equal(data.recvUnknown,1);
    assert((await p.locator('#dashKpiRow').innerText()).includes('ต้นทุนไม่ครบ 1 รายการ'));assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Failed dashboard delta/bootstrap retains data and cursor; periodic reconciliation uses bootstrap',async()=>{
    const p=await pageFor('index.html');const before=await p.evaluate(()=>JSON.stringify({products:DASH.products,movements:DASH.movements,sync:DASH.lastSync}));
    await p.evaluate(()=>{const old=respond;respond=(fn,args)=>fn==='getDashboardDelta'?{success:false,message:'read failure'}:old(fn,args);dashRefreshDelta();});await p.waitForTimeout(30);
    assert.equal(await p.evaluate(()=>JSON.stringify({products:DASH.products,movements:DASH.movements,sync:DASH.lastSync})),before);
    await p.evaluate(()=>{apiFailure='getDashboardBootstrap';dashLoad();});await p.waitForTimeout(30);
    assert.equal(await p.evaluate(()=>JSON.stringify({products:DASH.products,movements:DASH.movements,sync:DASH.lastSync})),before);
    assert.equal(await p.evaluate(()=>DASH.nextReconcile>Date.now()),true,'Failed full reads wait before automatic reconciliation');
    await p.evaluate(()=>{apiFailure='';apiCalls=[];DASH.lastFullLoad=Date.now()-300001;DASH.nextReconcile=0;dashRefreshDelta();});await p.waitForTimeout(30);
    assert.equal(await p.evaluate(()=>apiCalls[0].fn),'getDashboardBootstrap');assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Real local frame handoff validates channel/source and supports quote, product and invoice workflows',async()=>{
    const p=await pageFor('index.html');await p.evaluate(()=>switchPage('quotation'));
    const quote=p.frameLocator('#iframe-quotation');await quote.locator('body').waitFor();await p.waitForTimeout(100);
    const quotationFrame=p.frames().find(f=>f.url().includes('page=quotation'));
    await quotationFrame.evaluate(()=>syyPostParent({action:'OPEN_STOCK_ISSUE',quoteId:'Q1',refNo:'Q1',items:[{productCode:'P1',productName:'Part',qty:2,unitPrice:125}]}));
    await p.waitForTimeout(250);const stock=p.frames().find(f=>f.url().includes('page=stockissue'));assert(stock);
    assert.equal(await stock.evaluate(()=>basket[0].qty),2);assert.equal(await stock.evaluate(()=>pendingQuoteId),'Q1');
    await stock.evaluate(()=>syyPostParent({action:'OPEN_PRODUCT_ADD',barcode:'NEW123'}));await p.waitForTimeout(250);
    const product=p.frames().find(f=>f.url().includes('page=products'));assert.equal(await product.locator('#inp_barcode').inputValue(),'NEW123');
    await stock.evaluate(()=>syyPostParent({action:'OPEN_TAX_INVOICE',items:[{name:'Part',qty:2,unitPrice:125}],note:'Q1'}));await p.waitForTimeout(250);
    const invoice=p.frames().find(f=>f.url().includes('page=taxinvoice'));assert(invoice);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Untrusted frame source, origin, channel, action and malformed messages cannot alter caches',async()=>{
    const p=await pageFor('index.html');await p.evaluate(()=>switchPage('products'));await p.waitForTimeout(200);
    const before=await p.evaluate(()=>JSON.stringify(DASH.products));
    await p.evaluate(()=>{
      const frame=document.getElementById('iframe-products'),data={action:'PRODUCT_DELTA',channel:frame.dataset.channel,product:{id:'evil',productCode:'evil'}};
      for(const init of [{data,origin:location.origin,source:null},{data,origin:'https://evil.invalid',source:frame.contentWindow},{data:Object.assign({},data,{channel:'wrong-channel'}),origin:location.origin,source:frame.contentWindow},{data:Object.assign({},data,{product:null}),origin:location.origin,source:frame.contentWindow}])window.dispatchEvent(new MessageEvent('message',init));
      window.dispatchEvent(new MessageEvent('message',{data:{action:'REFRESH_STOCK_FULL',channel:frame.dataset.channel},origin:location.origin,source:frame.contentWindow}));
    });
    assert.equal(await p.evaluate(()=>JSON.stringify(DASH.products)),before);
    const child=p.frames().find(f=>f.url().includes('page=products'));assert.equal(await child.evaluate(()=>syyTrustedParentMessage({data:{action:'OPEN_PRODUCT_ADD',barcode:'X',channel:syyFrameChannel()},origin:location.origin,source:window})),false);
    assert.deepEqual(p.errors,[]);await p.close();
  });
  console.log('PASS: '+cases+' browser regression groups');
  fs.writeFileSync(path.join(output,'browser-result.json'),JSON.stringify({passed:cases,failed:0,environment:'Local Chromium with mocked Apps Script gateway; no production access'},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
