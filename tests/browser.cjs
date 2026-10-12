// Local HTML + mocked Apps Script gateway. Never connects to production services.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {evaluateTemplate} = require('./support/templates.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
fs.mkdirSync(output, {recursive:true});
function render(file, role, channel = '') {
  // Evaluate top-level scriptlets instead of silently replacing missing variables.
  // include_() still returns raw fragments, as it does in the application.
  let html = evaluateTemplate(file, {userRole:role,username:'fixture',userName:'fixture',authToken:'test-token',
    webAppUrl:'http://127.0.0.1:'+server.address().port+'/',frameChannel:channel,resetMode:'',resetToken:''});
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
 if(fn==='getAllProducts')return args[0]&&args[0].includeMasters?{products:[fixtureProduct],masters:respond('getAllMasterDropdowns',[])}:[fixtureProduct];
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
  const html=render(file,u.searchParams.get('role')||'staff',u.searchParams.get('channel')||'').replace('<head>','<head>'+fixture);
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
  let encountered=0;async function check(name,fn){encountered++;if(encountered<Number(process.env.BROWSER_TEST_START||1))return;await fn();cases++;console.log('PASS: '+name);}
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
    assert.match(await p.locator('#toastWrap').innerText(),/บันทึก.*เรียบร้อย/);assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getTaxInvoiceListData').length),0);assert.deepEqual(p.errors,[]);await p.close();
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
    assert.match(await p.locator('#toastWrap').innerText(),/บันทึกแล้ว แต่โหลดปีใหม่ไม่สำเร็จ/);assert.deepEqual(p.errors,[]);await p.close();
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

  await check('Product bootstrap is one RPC and unique counters both finish loading',async()=>{
    const p=await pageFor('Master_Products.html');assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getAllProducts').length),1);assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getAllMasterDropdowns').length),0);
    assert.equal(await p.locator('#recordCount').count(),1);assert.equal(await p.locator('#recordCountToolbar').count(),1);assert.equal(await p.locator('#recordCount').innerText(),await p.locator('#recordCountToolbar').innerText());assert.match(await p.locator('#recordCountToolbar').innerText(),/1/);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Thai calendar defaults and expiry preserve selected date in a UTC browser',async()=>{
    const p=await pageFor('Quotation.html');assert.equal(await p.evaluate(()=>businessDate('2026-10-10T17:30:00Z')),'2026-10-11');assert.equal(await p.evaluate(()=>addCalendarDays('2026-10-11',15)),'2026-10-26');await p.evaluate(()=>{addToBasket('P1');document.getElementById('selCustomer').value='C1';document.getElementById('inpQuoteDate').value='2026-10-11';document.getElementById('selValidDays').value='15';renderDoc();});assert.match(await p.locator('#printArea').innerText(),/26 ต\.ค\. 2569/);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Quote prefill preserves fractional quantity, zero price and provenance; cancel and missing products preserve basket',async()=>{
    const p=await pageFor('StockIssue.html');await p.evaluate(()=>applyPrefillBasket({items:[{productCode:'P1',qty:0.5,unitPrice:0}],quoteId:'Q1',refNo:'Q1',note:'note'}));assert.deepEqual(await p.evaluate(()=>[basket[0].qty,basket[0].unitPrice,pendingQuoteId]),[0.5,0,'Q1']);
    await p.evaluate(async()=>{Swal.fire=()=>Promise.resolve({isConfirmed:false});await applyPrefillBasket({items:[{productCode:'P1',qty:2,unitPrice:125}],quoteId:'Q2'});});assert.equal(await p.evaluate(()=>pendingQuoteId),'Q1');assert.equal(await p.evaluate(()=>basket[0].qty),0.5);
    await p.evaluate(async()=>{Swal.fire=()=>Promise.resolve({isConfirmed:true});await applyPrefillBasket({items:[{productCode:'MISSING',qty:1,unitPrice:0}],quoteId:'Q2'});});assert.equal(await p.evaluate(()=>pendingQuoteId),'Q1');
    await p.evaluate(()=>applyPrefillBasket({items:[{productCode:'P1',qty:1.25,unitPrice:125}],quoteId:'Q2',refNo:'Q2'}));assert.deepEqual(await p.evaluate(()=>[basket[0].qty,basket[0].unitPrice,pendingQuoteId]),[1.25,125,'Q2']);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Year replies arriving backwards keep latest requested invoice and quotation year',async()=>{
    for(const file of ['Master_Tax_Invoice.html','Quotation.html']){const p=await pageFor(file);await p.evaluate(()=>{const old=respond;respond=(fn,args)=>{if(fn==='getTaxInvoiceListData')return {invoices:[Object.assign({},fixtureInvoice,{id:'YEAR'+args[0]})],availableYears:[2569,2568,2567]};if(fn==='getQuotationListData')return {quotations:[{id:'YEAR'+args[0],quoteDate:'2026-10-11',status:'ร่าง',grandTotal:0,items:[]}],availableYears:[2569,2568,2567]};return old(fn,args);};apiHold=typeof loadAll==='function'?'getTaxInvoiceListData':'getQuotationListData';if(typeof loadAll==='function'){loadAll(2568);loadAll(2567);}else{loadPageData(2568);loadPageData(2567);}});await p.evaluate(()=>{apiHold='';apiPending.pop()();apiPending.shift()();});assert.equal(await p.evaluate(()=>currentPageYear),2567);assert.equal(await p.evaluate(()=>typeof invoicesCache==='undefined'?quotations[0].id:invoicesCache[0].id),'YEAR2567');assert.deepEqual(p.errors,[]);await p.close();}
  });
  await check('Incomplete invoice pages cannot show full-year totals; retry, dedupe and load-all complete the summary',async()=>{
    const p=await pageFor('Master_Tax_Invoice.html');await p.evaluate(()=>{const old=respond;respond=(fn,args)=>fn==='getTaxInvoicePageData'?Object.assign({},old(fn,args),{pageInfo:{hasMore:true,nextCursor:'cursor-1',year:'2569'}}):fn==='getTaxInvoiceListData'?{invoices:[fixtureInvoice,Object.assign({},fixtureInvoice,{id:'TX3',grandTotal:200})],pageInfo:{hasMore:false,nextCursor:'',year:'2569'}}:old(fn,args);loadAll(2569,null,null,true);});await p.waitForTimeout(35);assert.equal(await p.evaluate(()=>documentPager.hasMore()),true);assert.equal(await p.locator('#dashStats').innerText(),'');assert.match(await p.locator('.pagination-bar').innerText(),/ยังไม่ครบ/);
    await p.evaluate(()=>{apiFailure='getTaxInvoiceListData';documentPager.next(false);});await p.waitForTimeout(25);assert.equal(await p.evaluate(()=>invoicesCache.length),1);assert.equal(await p.evaluate(()=>documentPager.hasMore()),true);
    await p.evaluate(()=>loadAll(2568));await p.waitForTimeout(25);assert.equal(await p.evaluate(()=>currentPageYear),2569);assert.equal(await p.evaluate(()=>documentPager.hasMore()),true);
    await p.evaluate(()=>{apiFailure='';documentPager.next(true);});await p.waitForTimeout(35);assert.equal(await p.evaluate(()=>invoicesCache.length),2);assert.equal(await p.evaluate(()=>documentPager.hasMore()),false);assert.equal(await p.locator('.pagination-bar button:visible').count(),0);assert.match(await p.locator('#dashStats').innerText(),/307/);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Dashboard switches bounded year on demand, coalesces rapid requests and avoids claiming never moved',async()=>{
    const p=await pageFor('index.html');assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getAllMasterDropdowns').length),0);await p.evaluate(()=>{apiHold='getDashboardBootstrap';dashOnYearSel(DASH.year-1);dashOnYearSel(DASH.year-1);});assert.equal(await p.evaluate(()=>apiPending.length),1);await p.evaluate(()=>{apiHold='';apiPending.shift()();});await p.waitForTimeout(40);assert.equal(await p.evaluate(()=>DASH.loadedYear),await p.evaluate(()=>DASH.year));assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getDashboardBootstrap').at(-1).args[0].year),await p.evaluate(()=>DASH.year));assert.equal(await p.evaluate(()=>DASH.health.rows[0].tag),'ไม่พบในช่วงที่โหลด');assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Car edit round-trips model code/note and original updateTime despite background refresh',async()=>{
    const p=await pageFor('Master_Cars.html');await p.evaluate(()=>{respond=(fn,args)=>fn==='getCarsFull'?[{id:'CAR1',Brand:'Brand',Model:'Model',Model_Code:'CODE',Note:'Original',updateTime:'v1'}]:{success:true,id:'CAR1',data:{Brand:'Brand',Model:'Model',Model_Code:args[0].modelCode,Note:args[0].note},updateTime:'v3'};loadTable();});await p.waitForTimeout(25);await p.evaluate(()=>openEditModal('CAR1'));assert.equal(await p.locator('#fModelCode').inputValue(),'CODE');await p.locator('#fNote').fill('Draft');await p.evaluate(()=>{cache[0].updateTime='v2';handleSubmit({preventDefault(){}});});assert.equal(await p.evaluate(()=>apiCalls.find(x=>x.fn==='saveCar').args[0].expectedUpdateTime),'v1');assert.equal(await p.evaluate(()=>apiCalls.find(x=>x.fn==='saveCar').args[0].note),'Draft');assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Profile shows TOTP actions only for admin with server policy unchanged',async()=>{
    const p=await pageFor('Profile.html');await p.evaluate(()=>switchTab('security'));for(const role of ['viewer','staff','admin']){await p.evaluate(role=>renderTotpStatus({role,totpEnabled:false,recoveryCodesLeft:0}),role);assert.equal(await p.locator('#btnTotpAction').isVisible(),role==='admin');assert.equal(await p.locator('#btnTotpAction').isDisabled(),role!=='admin');}assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('PO mobile cards fit at 390 and 320 px; only history table scrolls horizontally',async()=>{
    const p=await pageFor('Purchase_Orders.html');for(const width of [390,320]){await p.setViewportSize({width,height:844});await p.evaluate(()=>{purchaseOrders=[{poId:'PO1',vendorName:'Vendor',orderDate:'2026-10-11',status:'Pending',totalAmount:1,totalQty:1,items:[{productCode:'P1',qty:1,receivedQty:0}]}];renderHistoryTab();switchTab('create');});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'create '+width);await p.evaluate(()=>switchTab('history'));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'history '+width);await p.screenshot({path:path.join(output,'po-mobile-'+width+'.png')});}assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Modal traps Tab, returns focus, inerts background, allows searchable select and SweetAlert focus',async()=>{
    const p=await pageFor('Master_Products.html');const trigger=p.locator('button[onclick="openAddModal()"]');await trigger.focus();await p.evaluate(()=>openAddModal());await p.waitForTimeout(30);
    assert.equal(await p.evaluate(()=>syyModalStack.at(-1).dialog.getAttribute('aria-modal')),'true');assert.equal(await p.evaluate(()=>!!document.querySelector('.page-body .toolbar').closest('[inert]')),true,JSON.stringify(await p.evaluate(()=>({children:Array.from(document.body.children).map(x=>[x.tagName,x.id,x.className,x.inert]),top:syyModalStack.at(-1).element.id}))));
    await p.evaluate(()=>syyModalFocusables(syyModalStack.at(-1).element).at(-1).focus());await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement===syyModalFocusables(syyModalStack.at(-1).element)[0]),true);await p.keyboard.press('Shift+Tab');assert.equal(await p.evaluate(()=>document.activeElement===syyModalFocusables(syyModalStack.at(-1).element).at(-1)),true);
    await p.keyboard.press('Escape');assert.equal(await p.locator('.modal-overlay.active').count(),1);
    await p.locator('#inp_brandId').locator('..').locator('.syy-select-control').click();await p.waitForTimeout(25);assert.equal(await p.evaluate(()=>document.activeElement.classList.contains('syy-select-search')),true);await p.keyboard.press('Escape');
    await p.evaluate(()=>{const box=document.createElement('div');box.className='swal2-container';box.innerHTML='<button id="testSwalButton">Confirm</button>';document.body.appendChild(box);document.getElementById('testSwalButton').focus();});assert.equal(await p.evaluate(()=>document.activeElement.id),'testSwalButton');await p.evaluate(()=>{document.querySelector('.swal2-container').remove();closeModal(syyModalStack.at(-1).element.id);});assert.equal(await trigger.evaluate(x=>x===document.activeElement),true);assert.equal(await p.evaluate(()=>document.querySelector('.page-body').inert),false);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Trusted cross-page deltas update stock without changing negotiated draft and inactive frames do not poll',async()=>{
    const p=await pageFor('index.html');await p.evaluate(()=>switchPage('quotation'));await p.waitForTimeout(180);const quote=p.frames().find(f=>f.url().includes('page=quotation'));await quote.evaluate(()=>{addToBasket('P1');basket[0].unitPrice=125;document.getElementById('inpNote').value='Draft';});await p.evaluate(()=>switchPage('stockissue'));await p.waitForTimeout(180);const stock=p.frames().find(f=>f.url().includes('page=stockissue'));await stock.evaluate(()=>syyPostParent({action:'STOCK_DELTA',productStocks:[{productCode:'P1',currentStock:7}]}));await p.waitForTimeout(40);assert.deepEqual(await quote.evaluate(()=>[products[0].currentStock,basket[0].stock,basket[0].unitPrice,document.getElementById('inpNote').value]),[7,7,125,'Draft']);assert.equal(await quote.evaluate(()=>syyFreshState.active),false);
    await quote.evaluate(()=>{syyFreshState.lastLoaded=Date.now()-200000;syyFreshState.lastAttempt=0;apiCalls=[];window.dispatchEvent(new Event('focus'));});assert.equal(await quote.evaluate(()=>apiCalls.length),0);await p.evaluate(()=>switchPage('quotation'));await p.waitForTimeout(40);assert.equal(await quote.evaluate(()=>apiCalls.filter(x=>x.fn==='getQuotationPageData').length),1);assert.equal(await quote.locator('#inpNote').inputValue(),'Draft');assert.equal(await quote.evaluate(()=>basket[0].unitPrice),125);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Identical read calls share one RPC and return to both callbacks; saves remain separate',async()=>{
    const p=await pageFor('Quotation.html');await p.evaluate(()=>{apiCalls=[];apiHold='getAllMasterDropdowns';window.received=0;callApi('getAllMasterDropdowns',[],()=>received++);callApi('getAllMasterDropdowns',[],()=>received++);});assert.equal(await p.evaluate(()=>apiCalls.length),1);await p.evaluate(()=>{apiHold='';apiPending.shift()();});assert.equal(await p.evaluate(()=>received),2);await p.evaluate(()=>{callApi('saveCustomer',[{customerName:'A'}],()=>{});callApi('saveCustomer',[{customerName:'A'}],()=>{});});assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='saveCustomer').length),2);assert.deepEqual(p.errors,[]);await p.close();
  });


  await check('Stock cross-browser reconciliation updates basket stock while preserving negotiated quantity/price',async()=>{
    const p=await pageFor('StockIssue.html');await p.evaluate(()=>{addToBasket('P1');basket[0].unitPrice=125;basket[0].qty=1.25;fixtureProduct.currentStock=4;loadProducts();});await p.waitForTimeout(30);assert.deepEqual(await p.evaluate(()=>[basket[0].stock,basket[0].qty,basket[0].unitPrice]),[4,1.25,125]);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Product freshness failure releases busy state and retries with both loading labels completed',async()=>{
    const p=await pageFor('Master_Products.html');await p.evaluate(()=>{syyFreshState.busy=true;apiFailure='getAllProducts';loadTable(true);});await p.waitForTimeout(25);assert.equal(await p.evaluate(()=>syyFreshState.busy),false);assert.match(await p.locator('#recordCountToolbar').innerText(),/โหลดไม่สำเร็จ/);await p.evaluate(()=>{apiFailure='';loadTable(true);});await p.waitForTimeout(30);assert.equal(await p.locator('#recordCountToolbar').innerText(),await p.locator('#recordCount').innerText());assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Fractional quote decrement retains 0.5 and decimal input passes validation',async()=>{
    const p=await pageFor('Quotation.html');await p.evaluate(()=>{addToBasket('P1');setQty('P1','1.5');changeQty('P1',-1);});
    assert.equal(await p.evaluate(()=>basket[0].qty),0.5);assert.equal(await p.locator('.quote-qty').inputValue(),'0.5');
    assert.equal(await p.locator('.quote-qty').evaluate(e=>e.checkValidity()),true);await p.close();
  });
  await check('Dirty quote and stock clear support continuing the draft and explicit discard',async()=>{
    for(const file of ['Quotation.html','StockIssue.html']){
      const p=await pageFor(file);await p.evaluate(()=>{addToBasket('P1');document.getElementById('inpNote').value='Keep draft';Swal.fire=o=>{alerts.push(o);return Promise.resolve({isConfirmed:false});};if(typeof newQuotation==='function')newQuotation();else clearBasket();});
      await p.waitForTimeout(20);assert.equal(await p.evaluate(()=>basket.length),1);assert.equal(await p.locator('#inpNote').inputValue(),'Keep draft');
      await p.evaluate(()=>{Swal.fire=o=>{alerts.push(o);return Promise.resolve({isConfirmed:true});};if(typeof newQuotation==='function')newQuotation();else clearBasket();});
      await p.waitForTimeout(20);assert.equal(await p.evaluate(()=>basket.length),0);assert.equal(await p.locator('#inpNote').inputValue(),'');assert.deepEqual(p.errors,[]);await p.close();
    }
  });
  await check('Quote draft restores invalid raw input, negotiated prices and notes without submitting any write',async()=>{
    const p=await pageFor('Quotation.html');p.on('dialog',dialog=>dialog.accept());
    await p.evaluate(()=>{addToBasket('P1');setQty('P1','1.5');setPrice('P1','0');document.getElementById('inpNote').value='Recovered note';document.getElementById('selCustomer').value='C1';document.querySelector('.price-input').value='';syyDraftFlush();});
    assert.equal(await p.evaluate(()=>Object.values(sessionStorage).some(v=>v.includes('test-token'))),false);
    await p.reload();await p.waitForTimeout(120);assert.deepEqual(await p.evaluate(()=>[basket[0].qty,basket[0].unitPrice]),[1.5,0]);
    assert.equal(await p.locator('.price-input').inputValue(),'');assert.equal(await p.locator('#inpNote').inputValue(),'Recovered note');
    assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='saveQuotation').length),0);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Draft storage binds the authenticated account and role, expires after eight hours and excludes credentials',async()=>{
    const p=await pageFor('Quotation.html');await p.evaluate(()=>{addToBasket('P1');syyDraftFlush();});
    assert.equal(await p.evaluate(()=>!!syyLocalGet('draft','quotation')),true);
    await p.evaluate(()=>document.querySelector('meta[name="syy-owner"]').content='other-account');assert.equal(await p.evaluate(()=>syyLocalGet('draft','quotation')),null);
    await p.evaluate(()=>{document.querySelector('meta[name="syy-owner"]').content='fixture';document.querySelector('meta[name="syy-role"]').content='viewer';});assert.equal(await p.evaluate(()=>syyLocalGet('draft','quotation')),null);
    await p.evaluate(()=>{document.querySelector('meta[name="syy-role"]').content='staff';const key=syyStorageKey('draft','quotation'),r=JSON.parse(sessionStorage.getItem(key));r.at=Date.now()-28800001;sessionStorage.setItem(key,JSON.stringify(r));});
    assert.equal(await p.evaluate(()=>syyLocalGet('draft','quotation')),null);await p.close();
  });
  await check('Invoice close and product image cancel keep dirty drafts when the user continues editing',async()=>{
    for(const file of ['Master_Tax_Invoice.html','Master_Products.html']){
      const p=await pageFor(file);await p.evaluate(()=>{openAddModal();Swal.fire=o=>{alerts.push(o);return Promise.resolve({isConfirmed:false});};if(typeof closeInvoiceModal==='function'){document.getElementById('modalBuyerName').value='Unsaved buyer';closeInvoiceModal();}else{stageProductImageNow('fixture','data:image/jpeg;base64,fixture',0);closeProductModal();}});
      await p.waitForTimeout(20);assert.equal(await p.locator('.modal-overlay.active').count(),1);
      assert.equal(await p.evaluate(()=>apiCalls.some(x=>/^(save|commit)/.test(x.fn))),false);assert.deepEqual(p.errors,[]);await p.close();
    }
  });
  await check('Auth expiry settles coalesced reads, preserves the draft and sends no automatic write',async()=>{
    const p=await pageFor('Quotation.html');await p.evaluate(()=>{
      addToBasket('P1');document.getElementById('inpNote').value='Expiry draft';respond=()=>({__authError:true});apiHold='getAuthFixture';
      Swal.fire=o=>{alerts.push(o);return new Promise(()=>{});};window.expiryFailures=0;callApi('getAuthFixture',[],null,()=>expiryFailures++);callApi('getAuthFixture',[],null,()=>expiryFailures++);
      apiHold='';apiPending.shift()();
    });
    assert.equal(await p.evaluate(()=>expiryFailures),2);assert.equal(await p.evaluate(()=>syyPendingReads.size),0);
    assert.equal(await p.evaluate(()=>syyLocalGet('draft','quotation').fields.inpNote),'Expiry draft');
    assert.equal(await p.evaluate(()=>apiCalls.some(x=>/^(save|issue)/.test(x.fn))),false);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Unknown document save disables resubmission while retaining the editable draft',async()=>{
    for(const file of ['Quotation.html','Master_Tax_Invoice.html','Purchase_Orders.html']){
      const p=await pageFor(file);await p.evaluate(()=>{
        if(typeof saveQuotationNow==='function'){addToBasket('P1');document.getElementById('selCustomer').value='C1';apiFailure='saveQuotation';saveQuotationNow();}
        else if(typeof closeInvoiceModal==='function'){openEditModal('TX1');apiFailure='saveTaxInvoice';handleSubmit();}
        else{pendingConfirmVendor={vendorId:'V1',vendorName:'Vendor',items:[Object.assign({},fixtureProduct,{suggestedQty:1})]};qtyState.P1=1;checkedState.P1=true;document.getElementById('btnConfirmSave').disabled=false;apiFailure='savePurchaseOrder';submitCreateOrder();}
      });await p.waitForTimeout(25);
      await p.evaluate(()=>{if(typeof saveQuotationNow==='function')saveQuotationNow();else if(typeof closeInvoiceModal==='function')handleSubmit();else submitCreateOrder();});
      assert.equal(await p.evaluate(()=>apiCalls.filter(x=>/^save(Quotation|TaxInvoice|PurchaseOrder)$/.test(x.fn)).length),1);
      assert.equal(await p.evaluate(()=>Object.values(syyUnknownWrites).some(Boolean)),true);assert.deepEqual(p.errors,[]);await p.close();
    }
  });
  await check('Server search applies exact document number and dates without loading all and retains old data on failure',async()=>{
    const p=await pageFor('Master_Tax_Invoice.html');await p.evaluate(()=>{const old=respond;respond=(fn,args)=>fn==='getTaxInvoiceListData'?{invoices:[Object.assign({},fixtureInvoice,{id:'FOUND',invoiceNo:args[1].search.number})],pageInfo:{hasMore:false,search:args[1].search,year:'2569'}}:old(fn,args);});
    const form=p.locator('.syy-document-search');await form.locator('[name=number]').fill('OLD 100');await form.locator('[name=from]').fill('2026-01-01');await form.locator('button[type=submit]').click();await p.waitForTimeout(25);
    assert.equal(await p.evaluate(()=>invoicesCache[0].id),'FOUND');assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getTaxInvoiceListData').length),1);
    assert.match(await p.locator('#recordCount').innerText(),/ในช่วงที่เลือก/);assert.equal(await p.locator('#dashStats').innerText(),'');
    await p.evaluate(()=>apiFailure='getTaxInvoiceListData');await form.locator('[name=number]').fill('OTHER');await form.locator('button[type=submit]').click();await p.waitForTimeout(25);
    assert.equal(await p.evaluate(()=>invoicesCache[0].invoiceNo),'OLD 100');assert.equal(await p.evaluate(()=>documentPager.searchOptions().number),'OLD 100');assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Document display windows render at most fifty rows, preserve unchanged row focus and clean select portals',async()=>{
    for(const file of ['Quotation.html','Master_Tax_Invoice.html','Purchase_Orders.html']){
      const p=await pageFor(file);await p.evaluate(()=>{
        if(typeof quotations!=='undefined'){quotations=Array.from({length:1200},(_,i)=>({id:'Q'+i,quoteNo:'Q '+i,quoteDate:'2026-10-11',customerName:'Buyer',grandTotal:i,status:'ร่าง',items:[]}));renderList();switchTab('list');}
        else if(typeof invoicesCache!=='undefined'){invoicesCache=Array.from({length:1200},(_,i)=>Object.assign({},fixtureInvoice,{id:'T'+i}));renderRows();}
        else{purchaseOrders=Array.from({length:1200},(_,i)=>({poId:'O'+i,orderDate:'2026-10-11',vendorName:'Vendor',status:'Pending',items:[],totalQty:0,totalAmount:0}));renderHistoryTab();switchTab('history');}
      });await p.waitForTimeout(30);
      const body=p.locator('#listBody,#taxBody,#historyTableBody');assert.equal(await body.locator('tr').count(),50);
      await body.locator('button').first().focus();const kept=await body.locator('tr').first().evaluate(row=>{window.retainedRow=row;return true;});assert(kept);
      await p.evaluate(()=>{if(typeof renderList==='function')renderList();else if(typeof renderRows==='function')renderRows();else renderHistoryTab();});
      assert.equal(await p.evaluate(()=>retainedRow.isConnected&&retainedRow.contains(document.activeElement)),true,file);
      for(let i=0;i<4;i++){await p.locator('.syy-display-pages button').last().click();await p.waitForTimeout(10);}
      assert.equal(await body.locator('tr').count(),50);assert((await p.locator('.syy-select-panel').count())<60);assert.deepEqual(p.errors,[]);await p.close();
    }
  });
  await check('Filtered quotation empty state and partial invoice count are honest',async()=>{
    const p=await pageFor('Quotation.html');await p.evaluate(()=>{quotations=[{id:'Q1',status:'ร่าง',grandTotal:1}];setListFilter('ปิดงาน-ขายสำเร็จ');});assert.match(await p.locator('#listBody').innerText(),/ตามตัวกรอง/);await p.close();
    const invoice=await pageFor('Master_Tax_Invoice.html');await invoice.evaluate(()=>{documentPager.reset({hasMore:true,nextCursor:'next'});renderRows();});assert.match(await invoice.locator('#recordCount').innerText(),/โหลดแล้ว/);assert.doesNotMatch(await invoice.locator('#recordCount').innerText(),/ทั้งหมด/);await invoice.close();
  });
  await check('Accessible selects, toast announcements and invalid-field focus work with keyboard input',async()=>{
    const p=await pageFor('Quotation.html');assert.equal(await p.locator('.syy-select-control:not([aria-label])').count(),0);
    await p.evaluate(()=>toast('Done'));assert.equal(await p.locator('.toast').last().getAttribute('role'),'status');
    await p.evaluate(()=>saveQuotationNow());assert.equal(await p.evaluate(()=>document.activeElement.id),'selCustomer-control');
    assert.equal(await p.locator('#selCustomer').getAttribute('aria-invalid'),'true');
    await p.locator('#selCustomer-control').press('Enter');assert.equal(await p.locator('#selCustomer-control').getAttribute('aria-expanded'),'true');
    const search=p.locator('.syy-select-panel[data-syy-open=true] input');await search.press('Escape');assert.equal(await p.evaluate(()=>document.activeElement.id),'selCustomer-control');
    await p.locator('#selCustomer-control').press('Enter');await p.locator('.syy-select-panel[data-syy-open=true] .syy-select-option').filter({hasText:'Buyer'}).click();
    assert.equal(await p.locator('#selCustomer-control').getAttribute('aria-invalid'),null);assert.equal(await p.locator('#selCustomer').getAttribute('aria-invalid'),null);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Mobile document cards expose buyer, date and amounts without horizontal navigation and retain touch targets',async()=>{
    for(const width of [320,390]){
      const p=await pageFor('Master_Tax_Invoice.html');await p.setViewportSize({width,height:900});await p.waitForTimeout(180);
      const row=p.locator('#taxBody tr').first();assert.match(await row.innerText(),/Buyer/);assert.match(await row.innerText(),/107/);
      const bounds=await row.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
      const cells=await row.locator('td').all();for(const cell of cells){const box=await cell.boundingBox();assert(box.x+box.width<=width+1);}
      const button=await row.locator('button').first().boundingBox();assert(button.width>=43.99&&button.height>=43.99,JSON.stringify(button));
      await p.screenshot({path:path.join(output,'invoice-cards-'+width+'.png')});assert.deepEqual(p.errors,[]);await p.close();
    }
  });
  await check('Stock-to-invoice button describes the draft step and never saves an invoice automatically',async()=>{
    const p=await pageFor('StockIssue.html');assert.match(await p.locator('button[onclick="confirmIssue(true)"]').innerText(),/เปิดร่าง/);
    await p.evaluate(()=>{const old=respond;respond=(fn,args)=>fn==='issueStock'?{success:true,docNo:'OUT-1',results:[],productStocks:[{productCode:'P1',currentStock:9}]}:old(fn,args);addToBasket('P1');confirmIssue(true);});await p.waitForTimeout(25);
    assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='saveTaxInvoice').length),0);assert.equal(await p.evaluate(()=>basket.length),0);await p.close();
  });
  await check('Long Thai multi-page print keeps saved totals and complete item numbering without overflowing A4',async()=>{
    const p=await pageFor('Master_Tax_Invoice.html');await p.evaluate(()=>{window.longInvoice=Object.assign({},fixtureInvoice,{items:Array.from({length:40},(_,i)=>({name:'สินค้า '+i+' '+('ชื่ออะไหล่ภาษาไทยยาวมาก '.repeat(20)),qty:0.5,unit:'ชิ้น',unitPrice:100})),subtotal:2000,vatAmount:140,grandTotal:2140});openViewModal('TX1',longInvoice);longInvoice.grandTotal=999999;});
    const pages=p.locator('#printArea .a4-page');assert((await pages.count())>3);
    assert.equal(await p.evaluate(()=>currentPrintInvoice.grandTotal),2140);
    const numbers=await p.locator('#printArea tbody .col-no').allTextContents();assert.deepEqual(numbers.map(Number),Array.from({length:40},(_,i)=>i+1));
    assert.match(await p.locator('#printArea').innerText(),/2,140/);for(const page of await pages.all())assert((await page.evaluate(el=>el.scrollHeight))<=1130);
    await p.emulateMedia({media:'print'});await p.pdf({path:path.join(output,'invoice-thai-long.pdf'),format:'A4',printBackground:true});assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Browser Back restores the active document frame and keeps its draft',async()=>{
    const p=await pageFor('index.html');await p.evaluate(()=>switchPage('quotation'));const frame=p.frameLocator('#iframe-quotation');await frame.locator('#inpNote').fill('Back keeps draft');
    await p.evaluate(()=>switchPage('products'));await p.goBack();await p.waitForTimeout(40);
    assert.equal(await p.evaluate(()=>syyNavCurrent),'quotation');assert.equal(await frame.locator('#inpNote').inputValue(),'Back keeps draft');assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Login success redirects immediately without a timed popup',async()=>{
    const p=await pageFor('login.html');await p.evaluate(()=>{window.redirectedToken='';redirectToHome=token=>window.redirectedToken=token;showLoginSuccessThenRedirect('fixture-login');});
    assert.equal(await p.evaluate(()=>redirectedToken),'fixture-login');assert.equal(await p.evaluate(()=>alerts.length),0);await p.close();
  });
  await check('Year, status and server-search scope survive reload with no background Load All',async()=>{
    const p=await pageFor('Quotation.html');p.on('dialog',dialog=>dialog.accept());
    await p.evaluate(()=>{syyLocalSet('view','quotation-year',2568);setListFilter('ร่าง');syyViewFlush();syyLocalSet('view','quotations',{search:{number:'ARCHIVE',from:'2025-01-01',to:'2025-12-31'}});});
    await p.reload();await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>currentPageYear),2568);assert.equal(await p.evaluate(()=>listStatusFilter),'ร่าง');
    const searchCall=await p.evaluate(()=>apiCalls.find(x=>x.fn==='getQuotationListData'));assert.equal(searchCall.args[1].search.number,'ARCHIVE');assert.equal(searchCall.args[1].pageSize,50);
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('CSV exports only filtered rows, reports the count and performs no Firestore read',async()=>{
    const p=await pageFor('Master_Products.html');await p.evaluate(()=>{filteredProducts=[Object.assign({},fixtureProduct,{productName:'=unsafe formula'})];window.exportedBlob=null;URL.createObjectURL=blob=>{exportedBlob=blob;return 'blob:fixture';};HTMLAnchorElement.prototype.click=function(){};window.readsBefore=apiCalls.length;exportAllProductFields();});
    const csv=await p.evaluate(()=>exportedBlob.text());assert.match(csv,/'=unsafe formula/);assert.equal(csv.trim().split('\r\n').length,2);
    assert.match(await p.locator('#toastWrap').innerText(),/1 รายการตามตัวกรอง/);assert.equal(await p.evaluate(()=>apiCalls.length),await p.evaluate(()=>readsBefore));assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('PDF generation keeps the saved snapshot and guards closing or changing the document mid-render',async()=>{
    const p=await pageFor('Master_Tax_Invoice.html');await p.evaluate(()=>{
      openViewModal('TX1');window.pdfRenders=[];window.pdfSaved='';window.canvasRelease=null;
      html2canvas=()=>new Promise(resolve=>{canvasRelease=()=>resolve({width:794,height:1123,toDataURL:()=> 'data:image/png;base64,fixture'});});
      window.jspdf={jsPDF:function(){this.internal={pageSize:{getWidth:()=>210,getHeight:()=>297}};this.addImage=()=>pdfRenders.push('image');this.addPage=()=>{};this.save=name=>pdfSaved=name;}};
      downloadInvoiceFile();closeViewModal();openViewModal('TX1',Object.assign({},fixtureInvoice,{invoiceNo:'OTHER'}));
    });assert.equal(await p.evaluate(()=>invoicePdfBusy),true);assert.equal(await p.evaluate(()=>currentPrintInvoice.invoiceNo),'SYY 0001/10/69');
    await p.evaluate(()=>canvasRelease());await p.waitForTimeout(20);assert.equal(await p.evaluate(()=>invoicePdfBusy),false);assert.match(await p.evaluate(()=>pdfSaved),/SYY-0001-10-69/);assert.equal(await p.evaluate(()=>pdfRenders.length),1);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Logout removes ordinary drafts but retains the original unknown stock request ID',async()=>{
    const p=await pageFor('StockIssue.html');await p.evaluate(()=>{addToBasket('P1');syyDraftFlush();issueRetry={uncertain:true,payload:{requestId:'REQUEST-KEEP',items:[],reason:'ขายหน้าร้าน'}};rememberIssue();syyClearAccountState();window.syyIntentionalExit=true;syyDraftFlush();});
    assert.equal(await p.evaluate(()=>syyLocalGet('draft','stockissue')),null);assert.equal(await p.evaluate(()=>JSON.parse(sessionStorage.getItem(issueStorageKey)).request.payload.requestId),'REQUEST-KEEP');await p.close();
  });
  await check('Saved quote print retains Thai customer branch, totals and all long-name rows across measured pages',async()=>{
    const p=await pageFor('Quotation.html');await p.evaluate(()=>{
      quotations=[{id:'Q-PRINT',quoteNo:'QT 40',status:'ร่าง',quoteDate:'2026-10-11',validUntil:'2026-10-26',validDays:15,customerId:'C1',customerName:'ผู้ซื้อจากเอกสาร',customerBranch:'สาขาเดิม',customerAddress:'ที่อยู่เดิม',discPct:0,subtotal:2000,discAmount:0,vat:140,grandTotal:2140,
        items:Array.from({length:40},(_,i)=>({productCode:'P'+i,productName:'รายการ '+i+' '+('ชื่อภาษาไทยยาวมาก '.repeat(15)),qty:0.5,unitPrice:100,costPrice:50}))}];viewQuotation('Q-PRINT');
    });assert((await p.locator('#printArea .a4-page').count())>4);assert.match(await p.locator('#printArea').innerText(),/สาขาเดิม/);assert.match(await p.locator('#printArea').innerText(),/2,140/);
    assert.equal(await p.locator('#printArea tbody tr').count(),40);for(const page of await p.locator('#printArea .a4-page').all())assert((await page.evaluate(el=>el.scrollHeight))<=1130);
    await p.addStyleTag({content:'.page-head,.page-header{visibility:hidden!important}'});await p.locator('#printArea .a4-page').first().screenshot({path:path.join(output,'quote-thai-print.png')});assert.deepEqual(p.errors,[]);await p.close();
  });
  console.log('PASS: '+cases+' browser regression groups');
  fs.writeFileSync(path.join(output,'browser-result.json'),JSON.stringify({passed:cases,failed:0,environment:'Local Chromium with mocked Apps Script gateway; no production access'},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
