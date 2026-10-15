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
window.apiCalls=[];window.apiRequests=[];window.alerts=[];window.apiFailure='';window.apiHold='';window.apiPending=[];window.fixtureMovements=[];window.fixtureMovementDetails={};
window.Swal={fire:function(o){alerts.push(o);return Promise.resolve({isConfirmed:true});}};
window.fixtureProduct={id:'P1',productCode:'P1',productName:'Test Part',partNumber:'PN1',barcode:'123',sellingPrice:200,costPrice:100,currentStock:10,minStock:2,zoneId:'Z1',zoneName:'A (Rack R1)',status:'Active',imageUrls:[]};
window.fixtureCustomer={id:'C1',Customer_Name:'Buyer',Customer_Type:'ลูกค้าทั่วไป',Address:'Saved address',Branch:'สาขา 2',Tax_ID:'1234567890123'};
window.fixtureInvoice={id:'TX1',invoiceNo:'SYY 0001/10/69',invoiceDate:'2026-10-11',buyerName:'Buyer',buyerAddress:'Saved address',buyerTaxId:'1234567890123',buyerBranch:'สาขา 2',items:[{name:'Test Part',qty:1,unit:'ชิ้น',unitPrice:100}],subtotal:100,vatAmount:7,grandTotal:107};
window.respond=function(fn,args){
 if(fn==='getDashboardBootstrap')return {products:[fixtureProduct],movements:[],poVendorMap:{},serverTime:'2026-10-11T05:00:00Z'};
 if(fn==='getDashboardDelta')return {success:true,productStocks:[],movements:[],serverTime:'2026-10-11T05:01:00Z'};
 if(['getBrands','getCategories','getVendorsFull','getCustomersFull','getCarsFull','getAllUsers','getActivityLog'].includes(fn))return [];
 if(fn==='getStockMovements')return fixtureMovements;
 if(fn==='getStockMovementPage'){var offset=Number(args[0].cursor||0),size=args[0].pageSize||50,end=Math.min(offset+size,Math.min(fixtureMovements.length,1000));return {movements:fixtureMovements.slice(offset,end),pageInfo:{hasMore:end<Math.min(fixtureMovements.length,1000),nextCursor:end<Math.min(fixtureMovements.length,1000)?String(end):''}};}
 if(fn==='getStockMovementDetail')return fixtureMovementDetails[args[0]]||{docNo:args[0],complete:true,movements:fixtureMovements.filter(m=>m.docNo===args[0])};
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
window.google={script:{run:{withSuccessHandler:function(ok){var runner={withFailureHandler:function(fail){runner.fail=fail;return runner;},apiGateway:function(token,fn,args,ua,metadata){apiRequests.push({fn:fn,metadata:metadata});invoke(fn,args,metadata);}};function invoke(fn,args,metadata){apiCalls.push({fn:fn,args:args});var done=function(){if(apiFailure===fn)runner.fail({message:'mock network failure'});else ok(respond(fn,args,metadata));};if(apiHold===fn)apiPending.push(done);else setTimeout(done,5);}['authLogin','authForgotPassword','authVerifyResetToken','authResetPassword','authChangePasswordForced'].forEach(function(fn){runner[fn]=function(){invoke(fn,Array.from(arguments));};});return runner;}}}};
</script>`;
const server = http.createServer((req,res)=>{
  const u = new URL(req.url,'http://localhost');
  if(u.searchParams.get('fixture')==='login-sandbox'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end('<!DOCTYPE html><html><body><iframe id="loginFrame" title="Apps Script sandbox fixture" sandbox="allow-scripts allow-same-origin allow-forms" src="/?file=login.html" style="width:100%;height:900px;border:0"></iframe></body></html>');return;
  }
  const pages={home:'index.html',stockissue:'StockIssue.html',products:'Master_Products.html',taxinvoice:'Master_Tax_Invoice.html',quotation:'Quotation.html',orders:'Purchase_Orders.html',brands:'Master_Brands.html',categories:'Master_Categories.html',zones:'Master_Zones.html'};
  const file = u.searchParams.get('file') || pages[u.searchParams.get('page')] || 'Quotation.html';
  if(!/^[A-Za-z_]+\.html$/.test(file)) {res.writeHead(400).end();return;}
  // A real child route receives its role from the same authenticated session as the shell.
  // Preserve that role in local iframe fixtures instead of silently testing staff under a Viewer shell.
  const referringRole=req.headers.referer?new URL(req.headers.referer,'http://localhost').searchParams.get('role'):null;
  const html=render(file,u.searchParams.get('role')||referringRole||'staff',u.searchParams.get('channel')||'').replace('<head>','<head>'+fixture);
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
  async function pageFor(file,role='staff',browserContext=context){
    const page=await browserContext.newPage();page.errors=[];
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
      const p=await pageFor(file);assert.deepEqual(p.errors,[],file);assert.doesNotMatch(await p.locator('body').innerText(),/<\?!=\s*include_\(/,file);await p.close();
    }
  });
  await check('SweetAlert confirmations have no generated dropdown, retain native input and draft decisions',async()=>{
    const p=await pageFor('Quotation.html');await p.evaluate(()=>{
      const box=document.createElement('div');box.className='swal2-container';box.innerHTML='<select class="swal2-select" style="display:none"><option value="">เลือก...</option></select><button>ทำร่างต่อ</button>';document.body.appendChild(box);
    });await p.waitForTimeout(30);
    assert.equal(await p.locator('.swal2-container .syy-select').count(),0);
    assert.equal(await p.locator('.swal2-select').isVisible(),false);
    await p.evaluate(()=>{const sel=document.querySelector('.swal2-select');sel.style.display='block';sel.innerHTML='<option value="yes">เลือกจริง</option>';SYYSelect.init(document);});
    assert.equal(await p.locator('.swal2-container .syy-select').count(),0);await p.selectOption('.swal2-select','yes');assert.equal(await p.locator('.swal2-select').inputValue(),'yes');
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Stock buttons share color; arrow navigation retains rows and scrolls selection inside the list',async()=>{
    const p=await pageFor('StockIssue.html');await p.evaluate(()=>{products=Array.from({length:80},(_,i)=>({...fixtureProduct,productCode:'P'+String(i).padStart(3,'0'),productName:'อะไหล่ '+i+' ชื่อสินค้ายาวสำหรับทดสอบ',currentStock:i===79?0:10}));renderResults();window.firstResult=document.querySelector('.res-row');window.readsBefore=apiCalls.length;});
    const colors=await p.locator('.btn-add:not(.is-disabled)').evaluateAll(xs=>xs.map(x=>getComputedStyle(x).backgroundColor));assert.equal(new Set(colors).size,1);
    await p.evaluate(()=>{for(let i=0;i<50;i++)moveSel(1);});
    assert.equal(await p.evaluate(()=>document.querySelector('.res-row')===firstResult),true);
    const geometry=await p.evaluate(()=>{const list=document.getElementById('resultList').getBoundingClientRect(),row=document.querySelector('.res-row.sel').getBoundingClientRect();return {top:row.top-list.top,bottom:list.bottom-row.bottom,scroll:document.getElementById('resultList').scrollTop};});
    assert(geometry.scroll>0);assert(geometry.top>=7&&geometry.bottom>=7,JSON.stringify(geometry));
    await p.evaluate(()=>moveSel(-50));assert.equal(await p.evaluate(()=>selIdx),0);assert.equal(await p.evaluate(()=>apiCalls.length),await p.evaluate(()=>readsBefore));
    await p.screenshot({path:path.join(output,'stock-layout-desktop.png')});
    for(const width of [390,320]){await p.setViewportSize({width,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'stock '+width);await p.screenshot({path:path.join(output,'stock-layout-'+width+'.png')});}
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Pages center stable widths by information density, with separated sticky headers and contained mobile scroll',async()=>{
    for(const file of ['Master_Brands.html','Master_Categories.html','Master_Cars.html','Master_Zones.html','Master_Vendors.html','Master_Customers.html','StockIssue.html','Quotation.html','Master_Tax_Invoice.html','Purchase_Orders.html','Master_Products.html','Manage_Users.html']) {
      const p=await pageFor(file);await p.setViewportSize({width:1920,height:1080});
      const frame=await p.locator('.page,.app-container,body>.page-body').count();if(frame){const b=await p.locator('.page,.app-container,body>.page-body').first().boundingBox();const expected=await p.evaluate(()=>Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--syy-content-width')));assert(Math.abs(b.width-expected)<2,file+' content width '+JSON.stringify(b));assert(Math.abs(b.x-(1920-b.width)/2)<2,file+' centered frame');}
      for(const table of await p.locator('table.table-compact').all()){const widths=await table.evaluate(t=>[t.getBoundingClientRect().width,t.parentElement.clientWidth]);assert(Math.abs(widths[0]-widths[1])<3,file+' compact table');}
      await p.setViewportSize({width:320,height:844});const overflow=await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);if(!overflow)console.log('OVERFLOW '+file,await p.evaluate(()=>Array.from(document.body.querySelectorAll('*')).filter(x=>{const r=x.getBoundingClientRect();return r.right>innerWidth+1&&r.width>0&&!x.closest('.table-wrap,.table-container,.modal-overlay');}).slice(0,12).map(x=>({tag:x.tagName,id:x.id,class:x.className,right:x.getBoundingClientRect().right,width:x.getBoundingClientRect().width}))));assert.equal(overflow,true,file+' mobile');assert.deepEqual(p.errors,[]);await p.close();
    }
    const p=await pageFor('Master_Brands.html');await p.evaluate(()=>{cache=Array.from({length:100},(_,i)=>({id:'B'+i,Name:'แบรนด์ '+i}));renderRows();});await p.waitForTimeout(30);
    const type=await p.evaluate(()=>({body:getComputedStyle(document.body).fontSize,font:getComputedStyle(document.body).fontFamily,table:getComputedStyle(document.querySelector('table')).fontSize,title:getComputedStyle(document.querySelector('.crumb b')).fontSize}));assert.equal(type.body,'15px');assert.match(type.font,/Noto Sans Thai/);assert.equal(type.table,'14px');assert.equal(type.title,'17px');
    await p.evaluate(()=>{document.querySelector('.table-wrap').scrollTop=400;});
    const sticky=await p.evaluate(()=>{const head=document.querySelector('thead th').getBoundingClientRect(),box=document.querySelector('.table-wrap').getBoundingClientRect();return {gap:box.top-document.querySelector('.page-head').getBoundingClientRect().bottom,top:head.top-box.top};});assert(sticky.gap>=8);assert(Math.abs(sticky.top)<2);
    await p.screenshot({path:path.join(output,'brands-layout-desktop.png')});assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Small master lists keep aligned centered frames at 100 percent zoom, even after filtering or long names',async()=>{
    for(const file of ['Master_Brands.html','Master_Categories.html']){
      const p=await pageFor(file);await p.evaluate(()=>{const examples=['HONDA','Exedy','Volvo','ISUZU','FORD','MITSUBISHI','Nissan'];cache=Array.from({length:140},(_,i)=>({id:'B'+String(i).padStart(4,'0'),Name:i<examples.length?examples[i]:i===139?'ชื่อยาว '.repeat(25):'แบรนด์ '+i}));renderRows();});
      for(const width of [1498,1920,2557]){await p.setViewportSize({width,height:938});
        const bounds=await p.evaluate(()=>{const selectors=['.page-head','#syyDataStatus','.page-body','.page-body>.card'];return selectors.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,width:r.width};});});
        assert(bounds.every(b=>Math.abs(b.width-880)<2),file+JSON.stringify(bounds));assert(bounds.every(b=>Math.abs(b.x-(width-880)/2)<2));
        assert.equal(await p.evaluate(()=>document.querySelector('table').scrollWidth<=document.querySelector('.table-wrap').clientWidth+1),true);
        const before=bounds[0];await p.locator('#searchInput').fill('HONDA');await p.waitForTimeout(300);assert.equal(await p.locator('#tbodyMain tr').count(),1);const after=await p.locator('.page-head').boundingBox();assert(Math.abs(after.x-before.x)<1&&Math.abs(after.width-before.width)<1);await p.locator('#searchInput').fill('');await p.waitForTimeout(300);
        if(width===1498)await p.screenshot({path:path.join(output,file.replace('.html','')+'-balanced-1498.png')});
      }
      await p.evaluate(()=>{document.querySelector('.table-wrap').scrollTop=400;});const sticky=await p.evaluate(()=>{const box=document.querySelector('.table-wrap').getBoundingClientRect(),head=document.querySelector('thead th').getBoundingClientRect();return head.top-box.top;});assert(Math.abs(sticky)<2);
      for(const width of [390,320]){await p.setViewportSize({width,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        assert.equal(await p.evaluate(()=>document.querySelector('table').scrollWidth<=document.querySelector('.table-wrap').clientWidth+1),true);
        const columns=await p.evaluate(()=>{const name=document.querySelector('tbody td:nth-child(3)').getBoundingClientRect(),actions=document.querySelector('tbody td:last-child').getBoundingClientRect();return {nameWidth:name.width,nameRight:name.right,actionsLeft:actions.left};});assert(columns.nameWidth>=60&&columns.nameRight<=columns.actionsLeft+1,file+' at '+width+': '+JSON.stringify(columns));
        assert.equal(await p.evaluate(()=>Array.from(document.querySelectorAll('th.xlf-th')).every(th=>{const label=th.querySelector('.xlf-th-label').getBoundingClientRect(),button=th.querySelector('.xlf-th-btn').getBoundingClientRect();return label.bottom<=button.top&&button.width>=44&&button.height>=44;})),true);
        for(const scrollLeft of [0,100]){await p.evaluate(left=>document.querySelector('.table-wrap').scrollLeft=left,scrollLeft);const positions=await p.evaluate(()=>{const head=document.querySelector('thead th:last-child').getBoundingClientRect(),cell=document.querySelector('tbody td.col-sticky-right').getBoundingClientRect(),wrap=document.querySelector('.table-wrap').getBoundingClientRect();return {head:head.right,cell:cell.right,left:cell.left,min:wrap.left,max:wrap.right};});assert(Math.abs(positions.head-positions.cell)<2,JSON.stringify(positions));assert(positions.left>=positions.min&&positions.cell<=positions.max+1);}
        await p.evaluate(()=>{document.querySelector('.table-wrap').scrollTop=0;document.querySelector('.table-wrap').scrollLeft=0;document.activeElement.blur();});await p.screenshot({path:path.join(output,file.replace('.html','')+'-balanced-'+width+'.png')});}
      // Older templates with no layout attribute are identified by their four-column master table.
      await p.evaluate(()=>{delete document.body.dataset.syyLayout;document.body.classList.remove('syy-compact-list');syyUpgradeIcons(document);renderHead();});await p.waitForFunction(()=>document.body.dataset.syyLayout==='compact'&&document.body.classList.contains('syy-compact-list'));
      assert.deepEqual(p.errors,[]);await p.close();
    }
  });
  await check('Shell/child master pages expose only the child heading and freshness, then restore dashboard chrome',async()=>{
    const p=await pageFor('index.html');for(const name of ['brands','categories']){
      await p.evaluate(name=>switchPage(name),name);const frame=p.frameLocator('#iframe-'+name);await frame.locator('.page-head').waitFor();await frame.locator('#syyDataStatus').waitFor();
      assert.equal(await p.locator('.main>.page-head').isVisible(),false);assert.equal(await p.locator('.main>#syyDataStatus').isVisible(),false);assert.equal(await p.locator('.main>.page-head').getAttribute('hidden'),'');
      assert.equal(await frame.locator('.page-head').isVisible(),true);assert.equal(await frame.locator('#syyDataStatus').isVisible(),true);
      const data=await frame.locator('.page-body>.card').boundingBox();assert(data.width<=881);
      if(name==='brands')await p.screenshot({path:path.join(output,'brands-balanced-shell.png')});
    }
    await p.evaluate(()=>switchPage('home'));assert.equal(await p.locator('.main>.page-head').isVisible(),true);assert.equal(await p.locator('.main>#syyDataStatus').isVisible(),true);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Backup overview separates Full/deltas, reports actual schedule state and installs only after an admin click',async()=>{
    const p=await pageFor('index.html','admin');await p.evaluate(()=>{const respondBefore=respond;window.backupInstalled=false;respond=function(fn,args){if(fn==='getBackupOverview')return {schedule:{enabled:backupInstalled},files:[{id:'test',kind:'incremental',date:'2026-10-13T15:00:00Z',sizeKB:12,written:2,deleted:1,url:'https://drive.google.com/drive/folders/test'}]};if(fn==='setupBackupSchedule'){backupInstalled=true;return {success:true};}return respondBefore(fn,args);};openBackup();});
    await p.waitForFunction(()=>document.getElementById('backupScheduleStatus').textContent.includes('ยังไม่ได้'));assert.equal(await p.evaluate(()=>apiCalls.some(x=>x.fn==='backupNow'||x.fn==='setupBackupSchedule')),false);assert((await p.locator('#backupList').innerText()).includes('Incremental'));assert((await p.locator('#backupList').innerText()).includes('ลบ 1'));
    await p.screenshot({path:path.join(output,'backup-desktop.png')});
    await p.evaluate(()=>{apiHold='setupBackupSchedule';document.getElementById('btnBackupSchedule').click();document.getElementById('btnBackupSchedule').click();});assert.equal(await p.locator('#btnBackupSchedule').isDisabled(),true);assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='setupBackupSchedule').length),1);await p.evaluate(()=>{apiHold='';apiPending.shift()();});await p.waitForFunction(()=>document.getElementById('backupScheduleStatus').textContent.includes('เปิดใช้งาน'));assert.equal(await p.locator('#btnBackupSchedule').isDisabled(),false);
    await p.setViewportSize({width:320,height:844});assert.equal(await p.evaluate(()=>document.getElementById('backupModal').getBoundingClientRect().right<=innerWidth),true);assert((await p.locator('#backupModal').innerText()).includes('ไม่คัดลอกไฟล์รูป'));
    await p.screenshot({path:path.join(output,'backup-mobile.png')});
    await p.evaluate(()=>{apiFailure='getBackupOverview';loadBackupList();});await p.waitForFunction(()=>document.getElementById('backupScheduleStatus').textContent.includes('ไม่สำเร็จ'));assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='backupNow').length),0);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Viewer opens Products on desktop/mobile and reads details without edit, delete or draft controls',async()=>{
    const shell=await pageFor('index.html','viewer');assert.equal(await shell.locator('#menu-products').count(),1);
    await shell.locator('#menu-products').click();assert.equal(await shell.locator('.main>.page-head').isVisible(),false);
    assert.equal(await shell.locator('#productsForm').isVisible(),true);
    const childView=shell.frameLocator('#iframe-products');await childView.locator('#productBody .view').waitFor({state:'visible'});
    const child=shell.frames().find(f=>f.url().includes('page=products'));assert.equal(await child.evaluate(()=>PRODUCT_ROLE),'viewer');
    assert.equal(await childView.locator('#productReadOnlyLabel').isVisible(),true);assert.equal(await childView.locator('#btnAddProduct').isVisible(),false);
    assert.equal(await childView.locator('#productBody .edit,#productBody .del').count(),0);
    assert.equal(await child.evaluate(()=>apiCalls.filter(x=>x.fn==='getAllProducts').length),1);
    await childView.locator('#productBody .view').click();assert.equal(await childView.locator('#viewProductName').innerText(),'Test Part');await child.evaluate(()=>closeModal('viewProductModal'));
    for(const width of [1365,800,390,320]){await shell.setViewportSize({width,height:844});assert.equal(await childView.locator('#productBody .view').isVisible(),true);const bounds=await shell.locator('#iframe-products').boundingBox();assert(bounds.width>200&&bounds.height>200,'Viewer frame must have usable dimensions');if(width<=800){assert.equal(await shell.locator('#mobile-products').isDisabled(),false);assert.equal(await shell.locator('#mobile-stockissue').isDisabled(),true);assert.equal(await shell.locator('#mobileNav').isVisible(),true);}}
    assert.deepEqual(await child.evaluate(()=>apiCalls.filter(x=>/save|delete|commit|upload/i.test(x.fn))),[]);assert.deepEqual(shell.errors,[]);
    await shell.evaluate(()=>switchPage('home'));assert.equal(await shell.locator('.main>.page-head').isVisible(),true);assert.deepEqual(shell.errors,[]);await shell.close();
    const p=await pageFor('Master_Products.html','viewer');
    assert.equal(await p.locator('#btnAddProduct').isVisible(),false);assert.equal(await p.locator('#productReadOnlyLabel').isVisible(),true);
    assert.equal(await p.locator('#productBody .edit,#productBody .del').count(),0);assert.equal(await p.locator('#productBody .view').count(),1);
    await p.locator('#productBody .view').click();assert.equal(await p.locator('#viewProductModal').isVisible(),true);assert.equal(await p.locator('#viewProductName').innerText(),'Test Part');
    await p.keyboard.press('Escape');await p.evaluate(()=>{openAddModal();openEditModal('P1');editingDocId='P1';handleSubmit({preventDefault(){}});generateBarcodeInForm();confirmDeleteModal('P1');targetDeleteDocId='P1';execDeleteProduct();pickProductImage(0);stageProductImageNow('x','x',0);deleteProductImageNow(0);setPrimaryProductImageNow(0);moveProductImageNow(0,1);});
    assert.equal(await p.locator('#productModal').isVisible(),false);assert.equal(await p.evaluate(()=>apiCalls.some(x=>/save|delete|commit|upload|generate|move|setPrimary/i.test(x.fn))),false);
    await p.locator('#tableSearchInput').fill('missing');assert.equal(await p.locator('#productBody').getByRole('button',{name:'+ เพิ่มสินค้า',exact:true}).count(),0);
    await p.evaluate(()=>{productsCache=[];filterAndRenderTable();});assert.equal(await p.locator('#productBody').getByRole('button',{name:'+ เพิ่มสินค้า',exact:true}).count(),0);
    assert.deepEqual(p.errors,[]);await p.close();
    for(const [role,canEdit,canDelete] of [['staff',true,false],['admin',true,true]]){const q=await pageFor('Master_Products.html',role);assert.equal(await q.locator('#btnAddProduct').isVisible(),canEdit);assert.equal(await q.locator('#productBody .edit').count(),1);assert.equal(await q.locator('#productBody .del').count(),canDelete?1:0);await q.locator('#productBody .edit').click();assert.equal(await q.locator('#productModal').isVisible(),true);assert.deepEqual(q.errors,[]);await q.close();}
  });
  await check('Stock history searches and opens a whole transaction, caches details, and preserves basket and read-only behavior',async()=>{
    const p=await pageFor('StockIssue.html');await p.evaluate(()=>{
      addToBasket('P1');
      const line={id:'SI-test-1',docNo:'SI-test',type:'OUT',productCode:'P1',productName:'อะไหล่',qty:2,stockBefore:10,stockAfter:8,unitPrice:150,hasUnitPrice:true,reason:'ขายหน้าร้าน',refNo:'INV1',quoteId:'QT1',note:'หมายเหตุ',user:'Staff',timestamp:'2026-10-12T01:00:00Z'};
      fixtureMovements=[line];fixtureMovementDetails['SI-test']={docNo:'SI-test',complete:true,movements:[line,{...line,id:'SI-test-2',productCode:'P2',productName:'สินค้าบรรทัดที่ไม่อยู่ในประวัติหน้าแรก',qty:1,unitPrice:0}]};switchTab('history');
    });await p.waitForTimeout(30);assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getStockMovementDetail').length),0);
    await p.locator('#mvSearchInput').fill('SI-test');assert.equal(await p.locator('#mvBody tr').count(),1);await p.locator('#mvBody .movement-link').click();await p.waitForTimeout(30);
    const detail=p.locator('#movementDetailBody');assert.match(await detail.innerText(),/สินค้าบรรทัดที่ไม่อยู่/);assert.match(await detail.innerText(),/QT1/);assert.match(await detail.innerText(),/2 บรรทัด \/ 3 ชิ้น/);assert.match(await detail.innerText(),/300\.00/);
    assert.equal(await detail.locator('input,select,textarea').count(),0);assert.equal(await p.evaluate(()=>basket.length),1);
    await p.keyboard.press('F4');assert.equal(await p.evaluate(()=>apiCalls.some(x=>x.fn==='issueStock')),false);assert.equal(await p.evaluate(()=>alerts.length),0);
    for(const width of [1920,1365,800,390,320]){await p.setViewportSize({width,height:950});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const b=await p.locator('#movementDetailModal .modal-box').boundingBox();assert(b.x>=0&&b.x+b.width<=width+1);}
    await p.screenshot({path:path.join(output,'stock-detail-mobile.png')});await p.setViewportSize({width:1365,height:950});await p.screenshot({path:path.join(output,'stock-detail-desktop.png')});
    await p.keyboard.press('Escape');await p.locator('#mvBody .movement-link').click();await p.waitForTimeout(20);assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getStockMovementDetail').length),1);
    await p.evaluate(()=>loadMovements());await p.waitForTimeout(25);await p.locator('#mvBody .movement-link').click();await p.waitForTimeout(25);assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getStockMovementDetail').length),2);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('History handles legacy data, injection, incomplete results, failed reads and out-of-order responses',async()=>{
    const p=await pageFor('StockIssue.html');await p.evaluate(()=>{
      const a={id:'A',docNo:'SI-A',type:'IN',productCode:'P1',productName:'<img src=x onerror="window.injected=true">',qty:1,stockBefore:'',stockAfter:1,hasUnitPrice:false,note:'<script>window.injected=true</script>'};
      movements=[a,{...a,id:'B',docNo:'SI-B'},{...a,id:'old',docNo:''}];fixtureMovementDetails['SI-A']={docNo:'SI-A',movements:[a],complete:false};fixtureMovementDetails['SI-B']={docNo:'SI-B',movements:[{...a,id:'B',docNo:'SI-B'}],complete:true};document.getElementById('panelHistory').classList.add('active');document.getElementById('panelIssue').classList.remove('active');renderMovements();
      openMovementDetail('old');
    });assert.match(await p.locator('#movementDetailBody').innerText(),/เฉพาะบรรทัดที่เลือก/);assert.match(await p.locator('#movementDetailBody').innerText(),/ไม่ได้บันทึก/);assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getStockMovementDetail').length),0);
    await p.evaluate(()=>{apiHold='getStockMovementDetail';openMovementDetail('A');openMovementDetail('A');openMovementDetail('B');});assert.equal(await p.evaluate(()=>apiPending.length),2);
    await p.evaluate(()=>apiPending[1]());assert.match(await p.locator('#movementDetailBody').innerText(),/SI-B/);await p.evaluate(()=>apiPending[0]());assert.match(await p.locator('#movementDetailBody').innerText(),/SI-B/);
    await p.evaluate(()=>{apiHold='';openMovementDetail('A');});assert.match(await p.locator('#movementDetailBody').innerText(),/ข้อมูลที่แสดงยังไม่ครบ/);assert.equal(await p.locator('#movementDetailBody img,#movementDetailBody script').count(),0);assert.equal(await p.evaluate(()=>!!window.injected),false);
    await p.evaluate(()=>{movementDetailCache=Object.create(null);apiFailure='getStockMovementDetail';openMovementDetail('B');});await p.waitForTimeout(25);assert.match(await p.locator('#movementDetailBody').innerText(),/โหลดรายละเอียดไม่สำเร็จ/);
    await p.evaluate(()=>apiFailure='');await p.locator('#movementDetailBody').getByRole('button',{name:'ลองอีกครั้ง'}).click();await p.waitForTimeout(25);assert.match(await p.locator('#movementDetailBody').innerText(),/SI-B/);
    await p.evaluate(()=>{movementDetailCache=Object.create(null);apiHold='getStockMovementDetail';apiPending=[];openMovementDetail('A');loadMovements();apiPending[0]();});assert.equal(await p.locator('#movementDetailModal').isVisible(),false);assert.equal(await p.evaluate(()=>Object.keys(movementDetailCache).length),0);
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('History initially loads 50 rows, searches the full 1000-row scope and keeps detail access',async()=>{
    const p=await pageFor('StockIssue.html');await p.evaluate(()=>{fixtureMovements=Array.from({length:1200},(_,i)=>({id:'M'+i,docNo:'SI-'+i,type:i===799?'IN':'OUT',productName:i===799?'needle':'Part '+i,productCode:'P1',qty:1,timestamp:'2026-10-12T00:00:00Z',hasUnitPrice:true,unitPrice:10}));switchTab('history');});
    await p.waitForFunction(()=>mvPage.initialized&&!mvPage.busy);assert.equal(await p.evaluate(()=>movements.length),50);assert.equal(await p.locator('#mvBody .movement-link').count(),50);
    assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getStockMovementPage').length),1);
    await p.locator('#mvSearchInput').fill('needle');await p.waitForFunction(()=>mvPage.complete);assert.equal(await p.evaluate(()=>movements.length),1000);assert.equal(await p.locator('#mvBody .movement-link').count(),1);
    assert.match(await p.locator('#mvBody').innerText(),/SI-799/);assert.equal(await p.locator('#mvMore').isVisible(),false);
    await p.locator('#mvBody .movement-link').click();await p.waitForTimeout(30);assert.match(await p.locator('#movementDetailBody').innerText(),/SI-799/);
    await p.evaluate(()=>{closeMovementDetail();document.getElementById('mvSearchInput').value='';setMvFilter('IN',document.querySelector('[data-mv="IN"]'));});assert.equal(await p.locator('#mvBody .movement-link').count(),1);
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Partial history errors retain rows, disclose incomplete search and retry the same snapshot cursor',async()=>{
    const p=await pageFor('StockIssue.html');await p.evaluate(()=>{fixtureMovements=Array.from({length:250},(_,i)=>({id:'M'+i,docNo:'SI-'+i,type:'OUT',productName:i===220?'needle':'Part',qty:1,timestamp:'2026-10-12T00:00:00Z'}));switchTab('history');});await p.waitForFunction(()=>mvPage.initialized&&!mvPage.busy);
    await p.evaluate(()=>apiFailure='getStockMovementPage');await p.locator('#mvSearchInput').fill('needle');await p.waitForFunction(()=>!!mvPage.error);
    assert.equal(await p.evaluate(()=>movements.length),50);assert.equal(await p.evaluate(()=>mvPage.complete),false);assert.match(await p.locator('#mvPageStatus').innerText(),/ยังไม่ครบ/);assert.doesNotMatch(await p.locator('#mvBody').innerText(),/ไม่พบรายการที่ตรง/);
    await p.evaluate(()=>apiFailure='');await p.locator('#mvMore').click();await p.waitForFunction(()=>mvPage.complete);assert.match(await p.locator('#mvBody').innerText(),/SI-220/);
    const cursors=await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getStockMovementPage').map(x=>x.args[0].cursor));assert.deepEqual(cursors,['','50','50']);
    await p.setViewportSize({width:390,height:844});assert.equal(await p.locator('#mvPageStatus').isVisible(),true);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Refreshing history ignores a previous pending generation without coalescing it into the new view',async()=>{
    const p=await pageFor('StockIssue.html');await p.evaluate(()=>{apiHold='getStockMovementPage';apiPending=[];loadMovements();loadMovements();});assert.equal(await p.evaluate(()=>apiPending.length),2);
    await p.evaluate(()=>apiPending[0]());assert.equal(await p.evaluate(()=>mvPage.initialized),false);await p.evaluate(()=>apiPending[1]());assert.equal(await p.evaluate(()=>mvPage.initialized),true);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Dashboard drains all delta pages before updating data/watermark and keeps old state after a failed page',async()=>{
    const p=await pageFor('index.html');await p.evaluate(()=>{DASH.lastSync='old-watermark';DASH.lastFullLoad=Date.now();DASH.nextReconcile=Date.now()+300000;DASH.movements=[];window.deltaFail=true;const original=respond;respond=(fn,args)=>{if(fn!=='getDashboardDelta')return original(fn,args);var next=!!args[1].cursor;if(!next&&deltaFail)apiFailure='getDashboardDelta';return {success:true,movements:[{id:next?'B':'A',type:'OUT',productCode:'P1',timestamp:new Date().toISOString(),qty:1}],productStocks:[{productCode:'P1',currentStock:next?7:8,minStock:2,costPrice:100,sellingPrice:200}],poVendorMap:{},serverTime:'new-watermark',hasMore:!next,nextCursor:next?'':'next'};};dashRefreshDelta();});
    await p.waitForFunction(()=>!DASH.loading);assert.equal(await p.evaluate(()=>DASH.lastSync),'old-watermark');assert.equal(await p.evaluate(()=>DASH.movements.length),0);assert.equal(await p.evaluate(()=>DASH.products[0].currentStock),10);
    await p.evaluate(()=>{apiFailure='';deltaFail=false;dashRefreshDelta();});await p.waitForFunction(()=>!DASH.loading);assert.equal(await p.evaluate(()=>DASH.lastSync),'new-watermark');assert.equal(await p.evaluate(()=>DASH.movements.length),2);assert.equal(await p.evaluate(()=>DASH.products[0].currentStock),7);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('A manual refresh queued during a failed delta still runs once and bypasses the cached snapshot',async()=>{
    const p=await pageFor('index.html');await p.waitForFunction(()=>!DASH.loading);await p.evaluate(()=>{DASH.lastFullLoad=Date.now();DASH.nextReconcile=Date.now()+300000;apiHold='getDashboardDelta';apiPending=[];dashRefreshDelta();dashLoad(true);apiFailure='getDashboardDelta';apiPending[0]();});
    await p.waitForFunction(()=>!DASH.loading);assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getDashboardBootstrap').length),2);assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getDashboardBootstrap').at(-1).args[0].force),true);assert.equal(await p.evaluate(()=>DASH.reloadRequested),false);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Manual dashboard/PO refresh bypasses result snapshots and cached timestamps keep their original age',async()=>{
    const p=await pageFor('index.html');await p.evaluate(()=>{const original=respond;respond=(fn,args)=>{const r=original(fn,args);if(fn==='getDashboardBootstrap')r.snapshotLoadedAt=Date.now()-45000;return r;};dashLoad(true);});await p.waitForFunction(()=>!DASH.loading);assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getDashboardBootstrap').at(-1).args[0].force),true);assert(await p.evaluate(()=>Date.now()-DASH.lastFullLoad>=45000));assert.deepEqual(p.errors,[]);await p.close();
    const po=await pageFor('Purchase_Orders.html');await po.evaluate(()=>{const original=respond;respond=(fn,args)=>{const r=original(fn,args);if(fn==='getPurchaseOrderPageData')r.snapshotLoadedAt=Date.now()-45000;return r;};loadAll(true);});await po.waitForTimeout(50);assert.equal(await po.evaluate(()=>apiCalls.filter(x=>x.fn==='getPurchaseOrderPageData').at(-1).args[0].force),true);assert(await po.evaluate(()=>Date.now()-syyFreshState.lastLoaded>=45000));assert.deepEqual(po.errors,[]);await po.close();
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
  await check('Password reveal appears after one character and lasts only for a primary pointer hold at desktop/mobile widths',async()=>{
    for(const width of [1365,390]){
      const p=await pageFor('login.html');await p.setViewportSize({width,height:844});
      assert.equal(await p.locator('.syy-password-toggle').count(),5);
      const input=p.locator('#inpPassword'),toggle=p.locator('#inpPassword + button');assert.equal(await toggle.isVisible(),false);
      await input.fill('x');assert.equal(await toggle.isVisible(),true);assert.equal(await input.getAttribute('type'),'password');
      await input.fill('fixture-only');await input.evaluate(el=>el.setSelectionRange(2,5));const box=await toggle.boundingBox();assert(box.width>=44&&box.height>=44);
      await p.mouse.move(box.x+22,box.y+22);await p.mouse.down();assert.equal(await input.getAttribute('type'),'text');assert.equal(await toggle.getAttribute('aria-pressed'),'true');
      assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd,document.activeElement.id]),[2,5,'inpPassword']);
      await p.mouse.up();assert.equal(await input.getAttribute('type'),'password');await toggle.click();assert.equal(await input.getAttribute('type'),'password');
      await toggle.click({button:'right'});assert.equal(await input.getAttribute('type'),'password');
      await p.mouse.move(box.x+22,box.y+22);await p.mouse.down();await p.mouse.move(box.x-20,box.y);assert.equal(await input.getAttribute('type'),'password');
      await p.mouse.move(box.x+22,box.y+22);assert.equal(await input.getAttribute('type'),'password');await p.mouse.up();
      assert.equal(await input.inputValue(),'fixture-only');assert.equal(await input.getAttribute('autocomplete'),'current-password');
      await p.screenshot({path:path.join(output,'login-password-control-'+width+'.png')});
      await input.fill('');assert.equal(await toggle.isVisible(),false);assert.equal(await input.getAttribute('type'),'password');assert.deepEqual(p.errors,[]);
      await p.screenshot({path:path.join(output,'login-'+width+'.png')});await p.close();
    }
  });
  await check('Space/Enter reveal only while held, never submit, and mask on blur or Escape without key-repeat reopening',async()=>{
    const p=await pageFor('login.html'),input=p.locator('#inpPassword'),toggle=p.locator('#inpPassword + button');await input.fill('fixture-only');await p.evaluate(()=>{window.passwordSubmits=0;document.getElementById('loginForm').onsubmit=e=>{e.preventDefault();passwordSubmits++;};});
    for(const key of ['Space','Enter']){await toggle.focus();await p.keyboard.down(key);assert.equal(await input.getAttribute('type'),'text');await p.keyboard.down(key);assert.equal(await input.getAttribute('type'),'text');await p.keyboard.up(key);assert.equal(await input.getAttribute('type'),'password');}
    await toggle.focus();await p.keyboard.down('Space');await p.keyboard.press('Escape');assert.equal(await input.getAttribute('type'),'password');await p.keyboard.down('Space');assert.equal(await input.getAttribute('type'),'password');await p.keyboard.up('Space');
    await p.keyboard.down('Enter');await p.keyboard.press('Tab');assert.equal(await input.getAttribute('type'),'password');await p.keyboard.up('Enter');assert.equal(await p.evaluate(()=>passwordSubmits),0);
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Touch hold/release, drag out and cancellation mask passwords without a sticky synthetic click',async()=>{
    const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await touch.route('https://**/*',r=>r.abort());
    const p=await pageFor('login.html','staff',touch),input=p.locator('#inpPassword'),toggle=p.locator('#inpPassword + button');await input.fill('fixture-only');const box=await toggle.boundingBox(),client=await touch.newCDPSession(p),point={x:box.x+22,y:box.y+22};
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});assert.equal(await input.getAttribute('type'),'text');await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal(await input.getAttribute('type'),'password');
    await toggle.tap();assert.equal(await input.getAttribute('type'),'password');
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x-70,y:point.y}]});assert.equal(await input.getAttribute('type'),'password');await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});assert.equal(await input.getAttribute('type'),'text');await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal(await input.getAttribute('type'),'password');
    assert.equal(await input.inputValue(),'fixture-only');assert.deepEqual(p.errors,[]);await p.close();await touch.close();
  });
  await check('Reset, tab/window changes, hidden login views and disabled inputs always mask and retain correct button visibility',async()=>{
    const p=await pageFor('login.html'),input=p.locator('#inpPassword'),toggle=p.locator('#inpPassword + button');await input.fill('fixture-only');
    for(const event of ['blur','pagehide','pageshow']){await toggle.focus();await p.keyboard.down('Space');assert.equal(await input.getAttribute('type'),'text');await p.evaluate(name=>window.dispatchEvent(new Event(name)),event);assert.equal(await input.getAttribute('type'),'password');await p.keyboard.up('Space');}
    await toggle.focus();await p.keyboard.down('Space');await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});assert.equal(await input.getAttribute('type'),'password');await p.keyboard.up('Space');
    await toggle.focus();await p.keyboard.down('Space');await p.evaluate(()=>showView('viewForgot'));await p.waitForFunction(()=>document.getElementById('inpPassword').type==='password');await p.keyboard.up('Space');await p.evaluate(()=>showView('viewLogin'));
    await toggle.focus();await p.keyboard.down('Space');await input.evaluate(el=>el.disabled=true);await p.waitForFunction(()=>document.getElementById('inpPassword').type==='password');assert.equal(await toggle.isVisible(),false);await p.keyboard.up('Space');await input.evaluate(el=>el.disabled=false);await toggle.waitFor({state:'visible'});
    await toggle.focus();await p.keyboard.down('Space');await p.evaluate(()=>document.getElementById('loginForm').reset());await p.keyboard.up('Space');await p.waitForFunction(()=>document.getElementById('inpPassword').value==='');assert.equal(await input.getAttribute('type'),'password');assert.equal(await toggle.isVisible(),false);
    // Present the reset form as it appears after successful token verification.
    await p.evaluate(()=>document.getElementById('resetFromEmailForm').style.display='block');
    for(const [view,id] of [['viewResetFromEmail','inpResetNewPassword'],['viewForcePassword','inpForceNewPassword']]){await p.evaluate(view=>showView(view),view);await p.locator('#'+id).fill('x');assert.equal(await p.locator('#'+id+' + button').isVisible(),true);assert.equal(await p.locator('#'+id).getAttribute('autocomplete'),'new-password');}
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Profile, prefilled and dynamic passwords share hold controls; programmatic clearing and modal close mask them',async()=>{
    const p=await pageFor('Profile.html');assert.equal(await p.locator('.syy-password-toggle').count(),4);
    assert.equal(await p.locator('.syy-password-toggle:visible').count(),0);await p.evaluate(()=>{const input=document.createElement('input');input.id='dynamicPassword';input.type='password';input.value='fixture-only';document.body.appendChild(input);});await p.waitForTimeout(20);
    const input=p.locator('#dynamicPassword'),toggle=p.locator('#dynamicPassword + button');assert.equal(await toggle.getAttribute('aria-label'),'กดค้างเพื่อดูรหัสผ่าน');assert.equal(await toggle.isVisible(),true);
    await toggle.focus();await p.keyboard.down('Space');assert.equal(await input.getAttribute('type'),'text');await p.evaluate(()=>SYYPassword.hide(document));await p.keyboard.up('Space');assert.equal(await input.inputValue(),'fixture-only');assert.equal(await input.getAttribute('type'),'password');
    await p.evaluate(()=>{document.getElementById('dynamicPassword').value='';document.body.dataset.fixture='changed';document.getElementById('pwAlert').textContent='saved';});await toggle.waitFor({state:'hidden'});
    await p.evaluate(()=>openDisableTotpModal());const modalInput=p.locator('#inpDisableTotpPassword');await modalInput.fill('x');await p.locator('#inpDisableTotpPassword + button').focus();await p.keyboard.down('Space');assert.equal(await modalInput.getAttribute('type'),'text');await p.evaluate(()=>closeModal('disableTotpModal'));await p.keyboard.up('Space');assert.equal(await modalInput.getAttribute('type'),'password');
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
    await p.evaluate(()=>{apiFailure='';apiCalls=[];DASH.lastFullLoad=Date.now()-DASH_RECONCILE_MS-1;DASH.nextReconcile=0;dashRefreshDelta();});await p.waitForTimeout(30);
    assert.equal(await p.evaluate(()=>apiCalls[0].fn),'getDashboardBootstrap');assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Real local frame handoff validates channel/source and supports quote, product and invoice workflows',async()=>{
    const p=await pageFor('index.html');await p.evaluate(()=>switchPage('quotation'));
    const quote=p.frameLocator('#iframe-quotation');await quote.locator('body').waitFor();await p.waitForTimeout(100);
    const quotationFrame=p.frames().find(f=>f.url().includes('page=quotation'));
    await quotationFrame.evaluate(()=>syyPostParent({action:'OPEN_STOCK_ISSUE',quoteId:'Q1',refNo:'Q1',items:[{productCode:'P1',productName:'Part',qty:2,unitPrice:125}]}));
    await p.frameLocator('#iframe-stockissue').locator('#searchInput').waitFor();const stock=p.frames().find(f=>f.url().includes('page=stockissue'));assert(stock);await stock.waitForFunction(()=>basket.length>0&&pendingQuoteId==='Q1');
    assert.equal(await stock.evaluate(()=>basket[0].qty),2);assert.equal(await stock.evaluate(()=>pendingQuoteId),'Q1');
    await stock.evaluate(()=>syyPostParent({action:'OPEN_PRODUCT_ADD',barcode:'NEW123'}));await p.frameLocator('#iframe-products').locator('#inp_barcode').waitFor({state:'attached'});
    const product=p.frames().find(f=>f.url().includes('page=products'));await product.waitForFunction(()=>document.getElementById('inp_barcode').value==='NEW123');assert.equal(await product.locator('#inp_barcode').inputValue(),'NEW123');
    await stock.evaluate(()=>syyPostParent({action:'OPEN_TAX_INVOICE',items:[{name:'Part',qty:2,unitPrice:125}],note:'Q1'}));await p.frameLocator('#iframe-taxinvoice').locator('body').waitFor();
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
    await p.locator('#inp_brandId').locator('..').locator('.syy-select-control').click();await p.waitForFunction(()=>document.activeElement.classList.contains('syy-select-search'),{},{timeout:5000});await p.keyboard.press('Escape');
    await p.evaluate(()=>{const box=document.createElement('div');box.className='swal2-container';box.innerHTML='<button id="testSwalButton">Confirm</button>';document.body.appendChild(box);document.getElementById('testSwalButton').focus();});assert.equal(await p.evaluate(()=>document.activeElement.id),'testSwalButton');await p.evaluate(()=>{document.querySelector('.swal2-container').remove();closeModal(syyModalStack.at(-1).element.id);});assert.equal(await trigger.evaluate(x=>x===document.activeElement),true);assert.equal(await p.evaluate(()=>document.querySelector('.page-body').inert),false);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Trusted cross-page deltas update stock without changing negotiated draft and inactive frames do not poll',async()=>{
    const p=await pageFor('index.html');await p.evaluate(()=>switchPage('quotation'));await p.frameLocator('#iframe-quotation').locator('#inpNote').waitFor({state:'attached'});const quote=p.frames().find(f=>f.url().includes('page=quotation'));await quote.waitForFunction(()=>typeof products!=='undefined'&&products.some(product=>product.productCode==='P1'));await quote.evaluate(()=>{addToBasket('P1');basket[0].unitPrice=125;document.getElementById('inpNote').value='Draft';});await p.evaluate(()=>switchPage('stockissue'));await p.frameLocator('#iframe-stockissue').locator('#searchInput').waitFor({state:'attached'});const stock=p.frames().find(f=>f.url().includes('page=stockissue'));await stock.waitForFunction(()=>typeof syyPostParent==='function');await stock.evaluate(()=>syyPostParent({action:'STOCK_DELTA',productStocks:[{productCode:'P1',currentStock:7}]}));await quote.waitForFunction(()=>products[0].currentStock===7&&basket[0].stock===7);assert.deepEqual(await quote.evaluate(()=>[products[0].currentStock,basket[0].stock,basket[0].unitPrice,document.getElementById('inpNote').value]),[7,7,125,'Draft']);assert.equal(await quote.evaluate(()=>syyFreshState.active),false);
    await quote.evaluate(()=>{syyFreshState.lastLoaded=Date.now()-200000;syyFreshState.lastAttempt=0;apiCalls=[];window.dispatchEvent(new Event('focus'));});assert.equal(await quote.evaluate(()=>apiCalls.length),0);await p.evaluate(()=>switchPage('quotation'));await quote.waitForFunction(()=>apiCalls.some(x=>x.fn==='getQuotationPageData'));assert.equal(await quote.evaluate(()=>apiCalls.filter(x=>x.fn==='getQuotationPageData').length),1);assert.equal(await quote.locator('#inpNote').inputValue(),'Draft');assert.equal(await quote.evaluate(()=>basket[0].unitPrice),125);assert.deepEqual(p.errors,[]);await p.close();
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
  await check('Asynchronous login, OTP and forced-password success enter index inside a restricted sandbox without another click',async()=>{
    for(const flow of ['login','otp','password']){
      const p=await context.newPage();p.errors=[];p.on('pageerror',e=>p.errors.push(e.message));
      const outerUrl='http://127.0.0.1:'+port+'/?fixture=login-sandbox';await p.goto(outerUrl);
      const frame=p.frames().find(f=>f.url().includes('file=login.html'));await frame.waitForFunction(()=>typeof doLogin==='function');
      await frame.evaluate(flow=>{
        window.loginResponse=flow==='otp'?{needOtp:true}:flow==='password'?{needPasswordChange:true,tempToken:'fixture-temp'}:{success:true,token:'fixture-session /?&%'};
        const original=respond;respond=(fn,args)=>fn==='authLogin'||fn==='authChangePasswordForced'?loginResponse:original(fn,args);
        document.getElementById('inpUsername').value='fixture';document.getElementById('inpPassword').value='fixture-password';
        // The iframe disallows top navigation regardless of RPC completion timing.
        doLogin({preventDefault(){}});
      },flow);
      if(flow!=='login'){
        await frame.locator(flow==='otp'?'#viewOtp.active':'#viewForcePassword.active').waitFor();assert.equal(p.url(),outerUrl);
        await frame.evaluate(flow=>{
          loginResponse={success:true,token:'fixture-session /?&%'};
          if(flow==='otp'){document.getElementById('inpOtp').value='123456';doLoginWithOtp({preventDefault(){}});}
          else{document.getElementById('inpForceNewPassword').value='fixture-new-password';document.getElementById('inpForceConfirmPassword').value='fixture-new-password';doForceChangePassword({preventDefault(){}});}
        },flow);
      }
      await frame.waitForURL(url=>url.searchParams.get('page')==='home');await frame.locator('#menu-products').waitFor();
      const landed=new URL(frame.url());assert.equal(landed.searchParams.get('token'),'fixture-session /?&%');assert.equal(landed.searchParams.get('ua'),await frame.evaluate(()=>navigator.userAgent));
      assert.equal(p.url(),outerUrl);assert.equal(await frame.locator('#loginForm').count(),0);assert.equal(await frame.evaluate(()=>alerts.length),0);assert.deepEqual(p.errors,[]);await p.close();
    }
  });
  await check('Rejected login and RPC failure remain on login and never enter index',async()=>{
    const p=await pageFor('login.html');await p.evaluate(()=>{
      const original=respond;respond=(fn,args)=>fn==='authLogin'?{success:false,message:'fixture rejected'}:original(fn,args);
      document.getElementById('inpUsername').value='fixture';document.getElementById('inpPassword').value='fixture-password';doLogin({preventDefault(){}});
    });await p.locator('#loginAlert.error.show').waitFor();assert.match(await p.locator('#loginAlert').innerText(),/fixture rejected/);assert(new URL(p.url()).searchParams.has('file'));
    await p.evaluate(()=>{apiFailure='authLogin';doLogin({preventDefault(){}});});await p.waitForFunction(()=>document.getElementById('loginAlert').innerText.includes('mock network failure'));
    assert.equal(await p.locator('#btnLogin').isEnabled(),true);assert.equal(await p.locator('#viewLogin.active').count(),1);assert(new URL(p.url()).searchParams.has('file'));assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Product type shows genuine, replacement and pending with older column preferences and viewer access',async()=>{
    const p=await pageFor('Master_Products.html','viewer');await p.evaluate(()=>{
      localStorage.setItem(productColumnPrefKey,JSON.stringify({version:PRODUCT_PREF_VERSION,visibleColumns:['productCode','productName','currentStock','actions'],pageSize:50}));
    });await p.reload();await p.waitForTimeout(100);await p.evaluate(()=>{
      productsCache=['แท้','เทียบ','PENDING'].map((partType,i)=>Object.assign({},fixtureProduct,{id:'TYPE'+i,productCode:'TYPE'+i,partType}));
      document.getElementById('tableSearchInput').value='';XLF.clearAll('products');filterAndRenderTable();
    });assert.equal(await p.evaluate(()=>pageSize),50);assert.equal(await p.evaluate(()=>visibleProductColumns.includes('image')),false);
    assert.match(await p.locator('#productThead').innerText(),/แท้ \/ เทียบ/);
    assert.deepEqual(await p.evaluate(()=>{const column=visibleProductColumns.indexOf('partType');return Array.from(document.getElementById('productBody').rows).map(row=>row.cells[column].innerText.trim());}),['แท้','เทียบ','รอดำเนินการ']);
    assert.equal(await p.locator('#productBody .edit,#productBody .del').count(),0);
    await p.evaluate(()=>{pendingProductColumns=normalizeProductColumns(PRODUCT_COLUMN_PRESETS.sales.columns);saveProductColumnPreference();});assert.equal(await p.evaluate(()=>visibleProductColumns.includes('partType')),true);
    assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Product and document table footers fit the viewport and stay reachable on small screens without extra reads',async()=>{
    for(const file of ['Master_Products.html','Quotation.html','Master_Tax_Invoice.html','Purchase_Orders.html','StockIssue.html']){
      const p=await pageFor(file);await p.evaluate(()=>{
        if(document.getElementById('productBody')){productsCache=Array.from({length:200},(_,i)=>Object.assign({},fixtureProduct,{id:'P'+i,productCode:'P'+i,partType:i%2?'แท้':'เทียบ'}));document.getElementById('pageSizeSelect').value='100';document.getElementById('tableSearchInput').value='';XLF.clearAll('products');changePageSize(100);SYYSelect.refresh(document);}
        else if(typeof quotations!=='undefined'){quotations=Array.from({length:120},(_,i)=>({id:'Q'+i,quoteNo:'Q '+i,quoteDate:'2026-10-11',customerName:'Buyer',grandTotal:i,status:'ร่าง',items:[]}));listStatusFilter='';renderList();switchTab('list');}
        else if(typeof invoicesCache!=='undefined'){invoicesCache=Array.from({length:120},(_,i)=>Object.assign({},fixtureInvoice,{id:'T'+i}));renderRows();}
        else if(typeof purchaseOrders!=='undefined'){purchaseOrders=Array.from({length:120},(_,i)=>({poId:'O'+i,orderDate:'2026-10-11',vendorName:'Vendor',status:'Pending',items:[],totalQty:0,totalAmount:0}));historyStatusFilter='all';renderHistoryTab();switchTab('history');}
        else{fixtureMovements=Array.from({length:80},(_,i)=>({id:'M'+i,docNo:'MV'+i,type:'OUT',productCode:'P1',productName:'Test Part',qty:1,timestamp:'2026-10-11T05:00:00Z'}));switchTab('history');loadMovements();}
      });await p.waitForTimeout(80);const before=await p.evaluate(()=>apiCalls.length);
      for(const size of [{width:1365,height:720},{width:1920,height:1080},{width:390,height:568},{width:320,height:420}]){
        await p.setViewportSize(size);await p.evaluate(()=>{window.scrollTo(0,0);syyFitTableFooters();});await p.waitForTimeout(80);
        const footer=p.locator('.syy-table-footer:visible').first(),wrap=p.locator('.syy-table-viewport:visible').first();assert.equal(await footer.count(),1,file);
        if(size.width>=1365){const rect=await footer.boundingBox();assert(rect.y+rect.height<=size.height+1,file+' desktop footer '+JSON.stringify(rect));}
        await footer.scrollIntoViewIfNeeded();const rect=await footer.boundingBox();assert(rect.y>=-1&&rect.y+rect.height<=size.height+1,file+' footer '+JSON.stringify(rect));assert(rect.x>=-1&&rect.x+rect.width<=size.width+1,file+' footer width');
        assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,file+' horizontal overflow');
        const atBottom=await wrap.evaluate(el=>{el.scrollTop=el.scrollHeight;return el.scrollTop;});assert(atBottom>0,file+' independently scrolls rows');
        const next=p.locator('#btnNextPage:visible,.syy-display-pages button:visible').last();if(await next.count()&&await next.isEnabled()){await next.click();await p.waitForTimeout(20);}
        if(file==='Master_Products.html'&&(size.width===1365||size.width===390))await p.screenshot({path:path.join(output,'product-footer-'+size.width+'.png')});
      }
      assert.equal(await p.evaluate(()=>apiCalls.length),before,file+' viewport/display paging must not request data');assert.deepEqual(p.errors,[]);await p.close();
    }
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
  await check('10,000-row backend pages preserve Viewer search, global facets, pagination, export and retry',async()=>{
    const {setup,plain}=require('./support/services.cjs'),s=setup();
    for(let i=0;i<10000;i++)s.put('Master_Products/P'+String(i).padStart(5,'0'),{Product_Name:'อะไหล่ '+i,Part_Type:i%2?'แท้':'เทียบ',Barcode:'BC'+i,Current_Stock:10,Min_Stock:2,Cost_Price:i,Selling_Price:i+10});
    const p=await pageFor('Master_Products.html','viewer');
    await p.exposeFunction('catalogRpc',async(fn,args)=>plain(s.c[fn+'_'](...args)));
    await p.evaluate(()=>{
      const original=respond;respond=(fn,args)=>['getAllProducts','getProductCatalogPage','getProductCatalogFacets','getProductById'].includes(fn)?catalogRpc(fn,args):original(fn,args);
      // The real gateway asynchronously serializes the result; retain this behavior for the VM-backed fixture.
      google.script.run.withSuccessHandler=function(ok){
        return {withFailureHandler:function(fail){
          return {apiGateway:function(token,fn,args){
            apiCalls.push({fn,args});
            if(apiFailure===fn){fail({message:'mock network failure'});return;}
            Promise.resolve(respond(fn,args)).then(ok,fail);
          }};
        }};
      };
      pageSize=25;currentPage=1;XLF.clearAll('products');document.getElementById('tableSearchInput').value='';loadTable(true);
    });
    await p.waitForFunction(()=>productRemote&&productRemote.total===10000);
    assert.equal(await p.locator('#productBody tr').count(),25);
    assert.match(await p.locator('#paginationInfo').innerText(),/10000/);
    await p.evaluate(()=>nextPage());await p.waitForFunction(()=>productRemote.page===2);assert.equal(await p.evaluate(()=>productsCache[0].productCode),'P00025');
    await p.locator('#tableSearchInput').fill('BC9999');await p.waitForFunction(()=>productRemote.total===1);assert.match(await p.locator('#productBody').innerText(),/อะไหล่ 9999/);
    await p.locator('[data-xlf-col="productName"]').click();await p.waitForSelector('.xlf-popover');
    assert.equal(await p.locator('.xlf-item').count(),200);
    await p.locator('.xlf-search').fill('อะไหล่ 9998');assert.equal(await p.locator('.xlf-item').count(),1);await p.evaluate(()=>XLF.closePopover());
    // Export every match, including rows not loaded in the table, with the real cursor implementation.
    await p.locator('#tableSearchInput').fill('อะไหล่ 99');await p.waitForFunction(()=>productRemote.total===111);
    await p.evaluate(()=>changePageSize(25));await p.waitForFunction(()=>productsCache.length===25);
    const download=p.waitForEvent('download');await p.evaluate(()=>exportAllProductFields());const file=await download;
    const csv=fs.readFileSync(await file.path(),'utf8');assert.equal(csv.trim().split('\r\n').length,112);assert.match(csv,/P09999/);
    assert.equal(await p.evaluate(()=>apiCalls.some(x=>/^(save|delete|issue)/.test(x.fn))),false);
    await p.evaluate(()=>{apiFailure='getAllProducts';loadTable(true);});await p.waitForFunction(()=>document.getElementById('recordCountToolbar').innerText.includes('โหลดไม่สำเร็จ'));
    await p.evaluate(()=>{apiFailure='';loadTable(true);});await p.waitForFunction(()=>productRemote.total===111&&document.querySelectorAll('#productBody tr').length===25);
    await p.screenshot({path:path.join(output,'catalog-10000-viewer.png')});assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('10,000 POS matches mount only 60 rows; keyboard crosses windows and barcode selects the final product',async()=>{
    const p=await pageFor('StockIssue.html');
    await p.evaluate(()=>{
      products=Array.from({length:10000},(_,i)=>Object.assign({},fixtureProduct,{id:'P'+i,productCode:'P'+i,barcode:'BC'+i,productName:'สินค้า '+String(i).padStart(5,'0'),_imageLoaded:true}));
      selIdx=0;renderResults();
    });
    assert.equal(await p.locator('#resultList .res-row').count(),60);assert.equal(await p.evaluate(()=>results.length),10000);
    await p.evaluate(()=>{selIdx=59;moveSel(1);});assert.equal(await p.evaluate(()=>resultWindowStart),60);assert.equal(await p.locator('#resultList .sel').count(),1);
    await p.evaluate(()=>moveSel(-1));assert.equal(await p.evaluate(()=>resultWindowStart),0);
    await p.locator('#searchInput').fill('BC9999');await p.locator('#searchInput').press('Enter');assert.equal(await p.evaluate(()=>basket[0].productCode),'P9999');
    await p.screenshot({path:path.join(output,'catalog-10000-pos.png')});assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('compact catalog RPC decoding preserves zero values, IDs, Unicode and nested document bootstraps',async()=>{
    const p=await pageFor('Quotation.html');
    await p.evaluate(()=>{
      respond=()=>({products:{catalogFormat:1,fields:['productCode','productName','sellingPrice','currentStock','carIds'],rows:[['Pท้าย','ชื่อไทย',0,0,['CAR1']]]}});
      callApi('getQuotationPageData',[],value=>{window.decodedCatalog=value.products;});
    });
    await p.waitForFunction(()=>window.decodedCatalog);assert.deepEqual(await p.evaluate(()=>({id:decodedCatalog[0].id,price:decodedCatalog[0].sellingPrice,stock:decodedCatalog[0].currentStock,cars:decodedCatalog[0].carIds})),{id:'Pท้าย',price:0,stock:0,cars:['CAR1']});
    await p.evaluate(()=>{
      respond=()=>({catalogFormat:1,fields:['productCode'],rows:[null]});window.decodeFailures=0;
      callApi('getAllProducts',[],()=>{throw Error('malformed result accepted');},()=>decodeFailures++);
      callApi('getAllProducts',[],()=>{throw Error('malformed duplicate accepted');},()=>decodeFailures++);
    });
    await p.waitForFunction(()=>decodeFailures===2);assert.equal(await p.evaluate(()=>syyPendingReads.size),0);
    await p.evaluate(()=>{respond=()=>({catalogFormat:1,fields:['productCode'],rows:[['RECOVERED']]});callApi('getAllProducts',[],rows=>window.recoveredCatalog=rows);});
    await p.waitForFunction(()=>window.recoveredCatalog);assert.equal(await p.evaluate(()=>recoveredCatalog[0].id),'RECOVERED');assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('XLFilter opens immediately, closes pending loads without extra RPC, caches complete facets and retries errors',async()=>{
    const p=await pageFor('Master_Products.html');
    await p.evaluate(()=>{
      syyClearReadCache();pageSize=25;
      respond=(fn,args)=>({__syyCache:1,version:'catalog-version',data:fn==='getAllProducts'?{catalogPage:true,products:[fixtureProduct],masters:{brands:[],categories:[],vendors:[],zones:[],cars:[]},page:1,total:1,unfilteredTotal:1,facets:{partType:{values:['แท้','เทียบ'],numeric:false}},facetVersion:'facet-version'}:fn==='getProductCatalogFacets'?{values:['Honda','Ford'],numeric:false}:[]});
      loadTable(true);
    });
    await p.waitForFunction(()=>productRemote&&syyReadCache.size>0);
    const before=await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getProductCatalogFacets').length);
    await p.locator('#productThead [data-xlf-col="partType"]').click();await p.waitForSelector('.xlf-item');assert.equal(await p.locator('.xlf-item').count(),2);assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getProductCatalogFacets').length),before);
    await p.keyboard.press('Escape');await p.evaluate(()=>{apiHold='getProductCatalogFacets';});
    const brand=p.locator('#productThead [data-xlf-col="brandName"]');await brand.click();await p.waitForSelector('.xlf-popover[aria-busy="true"]');assert.match(await p.locator('.xlf-popover').innerText(),/กำลังโหลด/);
    await brand.click();assert.equal(await p.locator('.xlf-popover').count(),0);assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getProductCatalogFacets').length),before+1);
    await p.evaluate(()=>{apiHold='';apiPending.splice(0).forEach(done=>done());});await p.waitForTimeout(30);assert.equal(await p.locator('.xlf-popover').count(),0);
    await brand.click();await p.waitForSelector('.xlf-item');assert.equal(await p.locator('.xlf-item').count(),2);await brand.click();await brand.click();await p.waitForSelector('.xlf-item');assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getProductCatalogFacets').length),before+1);
    await p.keyboard.press('Escape');await p.evaluate(()=>{syyInvalidateReadScopes(['Master_Products'],false);apiFailure='getProductCatalogFacets';});await brand.click();await p.getByRole('button',{name:'ลองอีกครั้ง',exact:true}).waitFor();
    await p.evaluate(()=>{apiFailure='';});await p.getByRole('button',{name:'ลองอีกครั้ง',exact:true}).click();await p.waitForSelector('.xlf-item');assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('business cache makes ten real browser reads one RPC and explicit refresh bypasses reuse',async()=>{
    const p=await pageFor('Master_Brands.html');
    const result=await p.evaluate(async()=>{
      syyClearReadCache();respond=()=>({__syyCache:1,version:'brands-v1',data:[{id:'B1',Name:'Honda'}]});var start=apiCalls.length;
      function read(options){return new Promise((resolve,reject)=>callApi('getBrands',[],resolve,reject,options));}
      var first=await read();first[0].Name='unsaved';for(var i=0;i<9;i++){var rows=await read();if(rows[0].Name!=='Honda')throw Error('shared snapshot was mutated');}
      var repeated=apiCalls.length-start;await read({fresh:true});return {repeated:repeated,total:apiCalls.length-start};
    });assert.deepEqual(result,{repeated:1,total:2});assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('product image viewer closes repeatedly for every role and viewport, restores modal focus/scroll, traps keys and cancels drag',async()=>{
    for(const role of ['viewer','staff','admin'])for(const width of [1365,640,390,320]){
      const touch=width<=640?await browser.newContext({hasTouch:true,viewport:{width,height:900}}):null;if(touch)await touch.route('https://**/*',r=>r.abort());
      const p=await pageFor('Master_Products.html',role,touch||context);await p.setViewportSize({width,height:900});
      await p.evaluate(()=>{var image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="skyblue"/></svg>');productsCache[0].imageUrl=image;productsCache[0].imageUrls=[image,image];document.body.style.overflow='auto';openTableProductImageLightbox('P1');});
      const viewer=p.locator('#productImageViewer'),close=viewer.locator('[aria-label="ปิด"]');
      await close.click();assert.equal(await viewer.isVisible(),false);assert.equal(await p.evaluate(()=>document.body.style.overflow),'auto');
      await p.evaluate(()=>openViewModal('P1'));const opener=p.locator('#viewImgBox .view-product-gallery-main');
      for(let attempt=0;attempt<3;attempt++){
        const before=await p.evaluate(()=>apiCalls.length);if(touch)await opener.tap();else await opener.click();await close.waitFor();
        assert.equal(await viewer.evaluate(el=>el.inert),false,role+'/'+width);
        assert.equal(await p.evaluate(()=>syyModalStack.at(-1).element.id),'productImageViewer');
        assert.equal(await close.evaluate(el=>{var r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'close must receive the pointer');
        await p.waitForTimeout(20);await p.keyboard.press('Shift+Tab');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('#productImageViewer')),true);
        await viewer.locator('[aria-label="ซูมเข้า"]').click();await p.locator('#productImageViewerNext').click();assert.equal(await p.evaluate(()=>PRODUCT_VIEWER.index),1);
        if(attempt===1){await p.keyboard.press('+');await p.mouse.move(width/2,400);await p.mouse.down();await p.mouse.move(width/2+30,420);assert.equal(await p.evaluate(()=>PRODUCT_VIEWER.drag),true);await p.keyboard.press('Escape');await p.mouse.up();}
        else if(touch)await close.tap();else await close.click();
        assert.equal(await viewer.isVisible(),false);assert.equal(await p.evaluate(()=>PRODUCT_VIEWER.drag),false);
        assert.equal(await p.evaluate(()=>document.body.style.overflow),'hidden');assert.equal(await p.locator('#viewProductModal').isVisible(),true);
        assert.equal(await p.evaluate(()=>document.activeElement===document.querySelector('#viewImgBox .view-product-gallery-main')),true,'return focus to the image opener');
        assert.equal(await p.evaluate(()=>apiCalls.length),before,'view/zoom/close makes no RPC');
      }
      await p.evaluate(()=>closeModal('viewProductModal'));assert.equal(await p.evaluate(()=>document.body.style.overflow),'auto');assert.deepEqual(p.errors,[]);await p.close();if(touch)await touch.close();
    }
  });
  await check('all six master tables render populated long Thai values, keep page scroll contained and filter without RPC',async()=>{
    for(const file of ['Master_Brands.html','Master_Categories.html','Master_Vendors.html','Master_Customers.html','Master_Zones.html','Master_Cars.html'])for(const width of [1365,390,320]){
      const p=await pageFor(file,'admin');await p.setViewportSize({width,height:900});
      await p.evaluate(()=>{
        ['brands','categories','vendors','customers','zones','cars'].forEach(key=>XLF.clearAll(key));document.getElementById('searchInput').value='';
        var label='ชื่อข้อมูลภาษาไทยสำหรับตรวจสอบหน้าจอและการตัดบรรทัดที่มีความยาวมาก';
        respond=()=>Array.from({length:30},(_,i)=>({id:'AUDIT'+i,Name:label+i,Brand_Name:label+i,Category_Name:label+i,Vendor_name:label+i,Customer_Name:label+i,Customer_Type:'ลูกค้าทั่วไป',Address:label,Branch:'สำนักงานใหญ่',Tax_ID:'1234567890123',Phone:'0812345678',Area:label,Build:'อาคาร',Floor:'ชั้น 1',Rack_no:'R1',Rack_Level:'1',Brand:label,Model:label,Model_Code:'M'+i,Year:'2026',Type_Car:'รถบรรทุก',Note:label}));
        loadTable();
      });
      await p.waitForFunction(()=>document.getElementById('tbodyMain').querySelectorAll('tr').length===30);await p.waitForTimeout(35);
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,file+'/'+width+' page overflow');
      const calls=await p.evaluate(()=>apiCalls.length);await p.locator('#searchInput').fill('AUDIT29');await p.locator('#searchInput').dispatchEvent('input');await p.waitForTimeout(200);
      assert.equal(await p.locator('#tbodyMain tr').count(),1,file+'/'+width+' local search');assert.equal(await p.evaluate(()=>apiCalls.length),calls,'typing does not read');
      assert.deepEqual(p.errors,[],file+'/'+width);await p.close();
    }
  });
  await check('profile empty activity log is reused for one minute, concurrent reads coalesce, refresh retries and failures retain prior rows',async()=>{
    const p=await pageFor('Profile.html','admin');
    await p.evaluate(()=>{apiHold='getActivityLog';switchTab('log');for(var i=0;i<10;i++)switchTab('log');});
    assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getActivityLog').length),1);
    await p.evaluate(()=>{apiHold='';apiPending.splice(0).forEach(done=>done());});await p.waitForFunction(()=>activityLogLoadedAt>0);
    await p.evaluate(()=>{for(var i=0;i<10;i++){switchTab('profile');switchTab('log');}});assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getActivityLog').length),1);
    await p.evaluate(()=>{activityLogLoadedAt=Date.now()-60001;switchTab('log');});await p.waitForFunction(()=>!activityLogLoading);assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getActivityLog').length),2);
    await p.evaluate(()=>{respond=(fn,args)=>fn==='getActivityLog'?[{timestamp:new Date().toISOString(),username:'admin',action:'save',label:'Saved record',docId:'P1',success:true}]:[];loadActivityLog();});await p.waitForFunction(()=>!activityLogLoading);assert.match(await p.locator('#logTableBody').innerText(),/Saved record/);
    await p.evaluate(()=>{apiFailure='getActivityLog';loadActivityLog();});await p.waitForFunction(()=>!activityLogLoading);assert.match(await p.locator('#logTableBody').innerText(),/Saved record/);
    await p.evaluate(()=>{apiFailure='';respond=()=>({success:false,message:'permission denied'});loadActivityLog();});await p.waitForFunction(()=>!activityLogLoading);assert.match(await p.locator('#logTableBody').innerText(),/Saved record/);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('Backup shows pending progress and paused errors without reporting partial data as complete; polling stops when closed',async()=>{
    const p=await pageFor('index.html','admin');await p.evaluate(()=>{
      var originalTimeout=window.setTimeout;window.backupPolls=[];window.backupToasts=[];
      window.setTimeout=function(fn,ms){if(ms===30000){backupPolls.push(fn);return 987654;}return originalTimeout.apply(this,arguments);};
      toast=function(message){backupToasts.push(message);};window.jobPaused=false;
      var before=respond;respond=function(fn,args){if(fn==='getBackupOverview')return {activeJob:{kind:'full',readDocuments:300,lastError:jobPaused?'Drive unavailable':''},files:[],schedule:{enabled:true}};if(fn==='backupNow')return {success:true,pending:true,readDocuments:300};return before(fn,args);};openBackup();
    });
    await p.waitForFunction(()=>document.getElementById('backupJobStatus').textContent.includes('300'));
    assert.match(await p.locator('#backupList').innerText(),/ยังไม่มีชุดที่สำรองครบ/);assert.match(await p.locator('#btnBackupNow').innerText(),/ทำ Backup ที่ค้างต่อ/);
    await p.locator('#btnBackupNow').click();await p.waitForFunction(()=>backupToasts.length>0);assert.match(await p.evaluate(()=>backupToasts[0]),/ทำต่ออัตโนมัติ/);assert(!await p.evaluate(()=>backupToasts.some(t=>t.includes('สำรองข้อมูลสำเร็จ'))));
    await p.evaluate(()=>{jobPaused=true;loadBackupList();});await p.waitForFunction(()=>document.getElementById('backupJobStatus').textContent.includes('Drive unavailable'));
    await p.screenshot({path:path.join(output,'backup-checkpoint-status.png')});
    const count=await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getBackupOverview').length);await p.evaluate(()=>{closeModal('backupModal');backupPolls.forEach(fn=>fn());});await p.waitForTimeout(30);
    assert.equal(await p.evaluate(()=>apiCalls.filter(x=>x.fn==='getBackupOverview').length),count);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('manual refresh explicitly bypasses all cache layers, coalesces simultaneous refreshes and retains master rows after failure',async()=>{
    for(const file of ['Master_Brands.html','Master_Categories.html','Master_Vendors.html','Master_Customers.html','Master_Zones.html','Master_Cars.html']){
      const p=await pageFor(file,'admin');await p.evaluate(()=>{respond=()=>({__syyCache:1,version:'v1',data:[{id:'A1',Name:'Original',Customer_Name:'Original',Vendor_name:'Original',Area:'Original',Brand:'Original',Model:'Model'}]});loadTable();});await p.waitForFunction(()=>cache.length===1);const count=await p.evaluate(()=>apiCalls.length);
      await p.evaluate(()=>loadTable());await p.waitForTimeout(20);assert.equal(await p.evaluate(()=>apiCalls.length),count);
      await p.getByRole('button',{name:/รีเฟรช/}).click();await p.waitForTimeout(30);assert.equal(await p.evaluate(()=>apiRequests.at(-1).metadata.refresh),true,file);assert.equal(await p.evaluate(()=>cache.length),1);
      await p.evaluate(()=>{apiFailure=API.list;});await p.getByRole('button',{name:/รีเฟรช/}).click();await p.waitForTimeout(30);assert.match(await p.locator('#tbodyMain').innerText(),/Original/);assert.match(await p.locator('#toastWrap').innerText(),/ข้อมูลเดิม/);assert.deepEqual(p.errors,[]);await p.close();
    }
    const p=await pageFor('Master_Brands.html');await p.evaluate(()=>{apiHold='getBrands';window.refreshResults=0;callApi('getBrands',[],()=>refreshResults++,()=>{}, {authoritative:true});callApi('getBrands',[],()=>refreshResults++,()=>{}, {authoritative:true});});assert.equal(await p.evaluate(()=>apiPending.length),1);await p.evaluate(()=>{apiHold='';apiPending.splice(0).forEach(done=>done());});await p.waitForFunction(()=>refreshResults===2);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('document revalidation omits unchanged sections without losing products, customers or typed drafts; manual refresh requests all sections',async()=>{
    for(const file of ['Quotation.html','Master_Tax_Invoice.html']){
      const p=await pageFor(file);await p.evaluate(isQuote=>{
        const prior=respond;respond=(fn,args,meta)=>{const data=prior(fn,args);if(fn==='getQuotationPageData'||fn==='getTaxInvoicePageData'){
          const held=args[1]&&args[1].sectionVersions||{};data.sectionVersions={products:{version:'products-v1',loadedAt:Date.now()},customers:{version:'customers-v1',loadedAt:Date.now()}};
          if(held.products&&!meta.refresh)delete data.products;if(held.customers&&!meta.refresh)delete data.customers;
        }return data;};
        if(isQuote){loadPageData(currentPageYear,null,null,true);}else loadAll(currentPageYear,null,null,true);
      },file==='Quotation.html');await p.waitForTimeout(40);
      await p.evaluate(isQuote=>{if(isQuote){basket=[{...fixtureProduct,qty:1,unitPrice:123.45,stock:10}];renderBasket();document.querySelector('.price-input').value='123.45';loadPageData(currentPageYear,null,null,true);}else{openAddModal(true);document.querySelector('.item-price').value='123.45';loadAll(currentPageYear,null,null,true);}},file==='Quotation.html');await p.waitForTimeout(40);
      assert.equal(await p.evaluate(isQuote=>(isQuote?products:productsCache)[0].productCode,file==='Quotation.html'),'P1');assert.equal(await p.evaluate(isQuote=>(isQuote?customers:customersCache)[0].id,file==='Quotation.html'),'C1');assert.equal(await p.locator(file==='Quotation.html'?'.price-input':'.item-price').first().inputValue(),'123.45');
      await p.evaluate(isQuote=>{if(isQuote)switchTab('list');else closeModal('invoiceModal');},file==='Quotation.html');await p.getByRole('button',{name:/รีเฟรช/}).first().click();await p.waitForTimeout(40);
      assert.equal(await p.evaluate(()=>apiRequests.at(-1).metadata.refresh),true);assert.deepEqual(await p.evaluate(()=>apiCalls.at(-1).args[1].sectionVersions),{});assert.deepEqual(p.errors,[]);await p.close();
    }
  });
  await check('dashboard uses deltas between reconciliations, adopts structural catalog changes and recovers expired delta watermarks',async()=>{
    const p=await pageFor('index.html');await p.evaluate(()=>{apiCalls=[];DASH.lastFullLoad=Date.now()-300001;DASH.nextReconcile=0;const old=respond;respond=(fn,args)=>fn==='getDashboardDelta'?{success:true,movements:[],productStocks:[],poVendorMap:{},serverTime:new Date().toISOString(),products:[{...fixtureProduct,productName:'Catalog changed'}],catalogVersion:'v2',catalogExpiresAt:Date.now()+90000}:old(fn,args);dashRefreshDelta();});await p.waitForFunction(()=>!DASH.loading);
    assert.equal(await p.evaluate(()=>apiCalls[0].fn),'getDashboardDelta');assert.equal(await p.evaluate(()=>DASH.products[0].productName),'Catalog changed');assert.equal(await p.evaluate(()=>DASH.catalogVersion),'v2');assert(await p.evaluate(()=>DASH.catalogExpiresAt>Date.now()));
    await p.evaluate(()=>{const old=respond;respond=(fn,args)=>fn==='getDashboardDelta'?{success:false,fullRefresh:true,message:'expired'}:old(fn,args);apiCalls=[];dashRefreshDelta();});await p.waitForFunction(()=>!DASH.loading&&apiCalls.some(x=>x.fn==='getDashboardBootstrap'));assert.deepEqual(await p.evaluate(()=>apiCalls.map(x=>x.fn)),['getDashboardDelta','getDashboardBootstrap']);assert.deepEqual(p.errors,[]);await p.close();
  });
  await check('PO stock freshness callbacks do not reference an absent draft and unknown drafts remain guarded',async()=>{
    const p=await pageFor('index.html');await p.evaluate(()=>switchPage('orders'));const frame=p.frameLocator('#iframe-orders');await frame.locator('body').waitFor();await p.waitForTimeout(150);const child=p.frames().find(f=>f.url().includes('page=orders'));const errors=[];child.page().on('pageerror',e=>errors.push(e.message));
    await p.evaluate(()=>syyPostFrame(document.getElementById('iframe-orders'),{action:'STOCK_DELTA',productStocks:[{productCode:'P1',currentStock:1}]}));await p.waitForTimeout(40);assert.deepEqual(errors,[]);assert.deepEqual(p.errors,[]);
    await child.evaluate(()=>{syyDrafts.orders.adapter.restore({checked:{P1:true},qty:{P1:1},unknown:true});});assert.equal(await child.evaluate(()=>syyUnknownWrites.savePurchaseOrder),true);await p.close();
  });
  console.log('PASS: '+cases+' browser regression groups');
  fs.writeFileSync(path.join(output,'browser-result.json'),JSON.stringify({passed:cases,failed:0,environment:'Local Chromium with mocked Apps Script gateway; no production access'},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
