// Stateful UAT: browser -> application gateway -> in-memory Firestore/Drive/Mail.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');
const {setup} = require('./support/services.cjs');
const {evaluateTemplate} = require('./support/templates.cjs');

const output = path.resolve(__dirname, '../test-results/workflow-uat.json');
const pages = {
  login:'login.html', home:'index.html', brands:'Master_Brands.html', categories:'Master_Categories.html',
  vendors:'Master_Vendors.html', customers:'Master_Customers.html', zones:'Master_Zones.html', cars:'Master_Cars.html',
  products:'Master_Products.html', orders:'Purchase_Orders.html', stockissue:'StockIssue.html',
  quotation:'Quotation.html', taxinvoice:'Master_Tax_Invoice.html', manageusers:'Manage_Users.html', profile:'Profile.html'
};
const store = setup(), api = store.c;
const users = {}, tokens = {}, mail = [], evidence = [], rpc = [], bridgeErrors = [], observations = [], triggers = [];
const password = 'Fixture-Test-only-2026!';
for (const role of ['admin','staff','viewer']) {
  const username = 'uat-' + role;
  store.put('Master_Users/UAT-' + role, {
    Username:username, Full_Name:'UAT '+role, Role:role, Status:'Active',
    Email:username+'@example.invalid', Salt:role, Password_Hash:api.hashPassword_(password,role),
    Password_Changed_At:new Date().toISOString()
  });
  users[role] = api.readAuthUser_('UAT-' + role);
  tokens[role] = api.createSession_(users[role]).token;
}
api.MailApp.sendEmail = (...args) => mail.push(args.length);
api.logActivity_ = (username,fn,args,result) => {
  const meta=api.ACTIVITY_ACTIONS[fn];
  if(meta) store.put('Activity_Log/LOG-'+rpc.length,{
    Username:username, Action:meta.action, Function:fn, Label:meta.label,
    DocId:api.guessDocId_(fn,args,result), Success:result?.success!==false?'true':'false', Timestamp:new Date().toISOString()
  });
};
api.ScriptApp.getProjectTriggers = () => triggers.slice();
api.ScriptApp.deleteTrigger = trigger => triggers.splice(triggers.indexOf(trigger),1);
api.ScriptApp.newTrigger = handler => {
  const trigger={getHandlerFunction:()=>handler,getUniqueId:()=>handler+'-fixture'};
  const builder={timeBased:()=>builder,everyDays:()=>builder,atHour:()=>builder,nearMinute:()=>builder,
    inTimezone:()=>builder,after:()=>builder,create(){triggers.push(trigger);return trigger;}};
  return builder;
};
store.put('Master_Products/P001', {
  Product_Name:'ผ้าเบรกทดสอบ', Part_Number:'PN-UAT-01', Barcode:'100001',
  Brand_ID:'B001', Category_ID:'C001', Default_Vendor_ID:'V001',
  Cost_Price:70.25, Selling_Price:119.75, Current_Stock:6, Min_Stock:10, Status:'Active'
});
store.put('Master_Brands/B001',{Brand_Name:'แบรนด์ตั้งต้น',Status:'Active'});
store.put('Master_Categories/C001',{Category_Name:'ระบบเบรก',Status:'Active'});
store.put('Master_Vendors/V001',{Vendor_name:'ผู้จำหน่ายทดสอบ',Tax_ID:'1234567890121',Status:'Active'});
store.put('Master_Customers/C001',{Customer_Name:'ลูกค้าทดสอบ',Customer_Type:'ลูกค้าทั่วไป',Status:'Active'});

function installBridge() {
  window.google = {script:{run:{withSuccessHandler(ok) {
    const call = (fn,args) => fetch('/rpc', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({fn,args})
    }).then(response => {
      if (!response.ok) throw Error('Local workflow RPC failed');
      return response.json();
    }).then(ok).catch(error => runner.fail(error));
    const runner = {withFailureHandler(fail) {runner.fail=fail;return runner;}, apiGateway(...args) {call('apiGateway',args);}};
    for (const fn of ['authLogin','authForgotPassword','authResetPassword','authChangeForcedPassword','authValidateResetToken'])
      runner[fn] = (...args) => call(fn,args);
    return runner;
  }}}};
}
const publicRpc = new Set(['authLogin','authForgotPassword','authResetPassword','authChangeForcedPassword','authValidateResetToken']);
const server = http.createServer(async (req,res) => {
  try {
    if (req.headers.host !== '127.0.0.1:'+server.address().port) {res.writeHead(403).end();return;}
    const url = new URL(req.url,'http://'+req.headers.host);
    if (url.pathname === '/rpc' && req.method === 'POST') {
      let input = '';
      for await (const chunk of req) {input += chunk;if(input.length>5_000_000) throw Error('Fixture request too large');}
      const {fn,args} = JSON.parse(input);
      if (fn !== 'apiGateway' && !publicRpc.has(fn)) throw Error('Unexpected fixture RPC '+fn);
      const op = fn === 'apiGateway' ? args[1] : fn;
      const before = store.calls.length, started = performance.now();
      const result = api[fn](...args);
      const calls = store.calls.slice(before);
      rpc.push({op,ok:result?.success!==false,ms:Math.round(performance.now()-started),
        firestoreRequests:calls.length, writeRequests:calls.filter(c => ['patch','delete'].includes(c.options.method) ||
          c.url.endsWith(':commit') || (c.options.method==='post' && c.url.includes('documentId='))).length});
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));
      return;
    }
    const route = url.searchParams.get('page') || 'login';
    if (req.method !== 'GET' || !Object.hasOwn(pages,route)) {res.writeHead(404).end();return;}
    const token = url.searchParams.get('token') || '', session = api.getSession_(token);
    const file = route === 'login' || !session ? pages.login : pages[route];
    const channel = url.searchParams.get('frameChannel') || '';
    const html = evaluateTemplate(file,{
      username:session?.username || '', userName:session?.fullName || '', userRole:session?.role || '',
      authToken:token, webAppUrl:url.origin+'/', frameChannel:channel, frameParentOrigin:url.origin,
      resetMode:'', resetToken:'', connectionUnavailable:false, connectionRetryUrl:'', embeddedSessionExpired:false
    }).replace('<head>','<head><script>('+installBridge.toString()+')()</script>');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(html);
  } catch (error) {
    bridgeErrors.push(error.message);
    res.writeHead(500).end('Local workflow fixture failed');
  }
});

let browser, context, origin, page;
const findDoc = (collection,field,value) => [...store.docs.keys()].find(key => key.startsWith(collection+'/') && store.value(key,field)===value);
const fill = async fields => {for (const [id,value] of Object.entries(fields)) await page.locator('#'+id).fill(value);};
const click = selector => page.locator(selector).click();
const confirm = () => click('.syy-dialog-actions .swy-confirm-btn');
async function open(route,role='staff') {
  await page.goto(origin+'/?page='+route+'&token='+encodeURIComponent(tokens[role]));
}
async function check(name,run) {
  const start = rpc.length, now = performance.now(), pageErrors = [];
  page = await context.newPage();
  page.setDefaultTimeout(3500);
  page.on('pageerror',error => pageErrors.push(error.message));
  const result = {name};
  try {await run();assert.deepEqual(pageErrors,[]);result.status='pass';}
  catch(error) {result.status='fail';result.error=error.message;}
  finally {
    await page.close();
    result.ms=Math.round(performance.now()-now);result.rpc=rpc.slice(start);result.pageErrors=pageErrors;
    evidence.push(result);
    console.log(result.status.toUpperCase()+': '+name+(result.error?' - '+result.error.split('\n')[0]:''));
  }
}

async function main() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+server.address().port;
  const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
  context=await browser.newContext({viewport:{width:1365,height:900}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());

  await check('Login: wrong password, valid credentials and Dashboard redirect',async()=>{
    await page.goto(origin+'/?page=login');
    await fill({inpUsername:users.staff.Username,inpPassword:'wrong-fixture-password'});
    await click('#btnLogin');
    await page.waitForFunction(()=>document.querySelector('#loginAlert').textContent.trim());
    assert.equal(new URL(page.url()).searchParams.get('page'),'login');
    await fill({inpPassword:password});
    await click('#btnLogin');
    await page.waitForURL(url=>url.searchParams.get('page')==='home');
    await page.waitForFunction(()=>DASH.loaded&&!DASH.loading);
  });

  const masters = [
    ['brands','Master_Brands','Brand_Name','fName','แบรนด์ใหม่ UAT',{}],
    ['categories','Master_Categories','Category_Name','fName','หมวดใหม่ UAT',{}],
    ['vendors','Master_Vendors','Vendor_name','fVendorName','ผู้จำหน่ายใหม่ UAT',{fTaxId:'1234567890121',fPhone:'0812345678',fEmail:'vendor@example.invalid'}],
    ['customers','Master_Customers','Customer_Name','fCustomerName','ลูกค้าใหม่ UAT',{fPhone:'0891234567'}],
    ['zones','Master_Zones','Area','fArea','โซนใหม่ UAT',{fRackNo:'R-02'}],
    ['cars','Master_Cars','Model','fModel','รุ่นใหม่ UAT',{fModelCode:'UAT-X2',fYear:'2025-2026'}]
  ];
  for (const [route,collection,field,id,label,other] of masters) {
    await check(route+': add, persist, edit, search, delete',async()=>{
      await open(route,'admin');
      await page.waitForFunction(()=>typeof cache!=='undefined' && syyUxBusy===0);
      await page.locator('button[onclick="openAddModal()"]').first().click();
      if (route==='customers') await page.locator('#fCustomerType').selectOption({label:'ลูกค้าทั่วไป'},{force:true});
      if (route==='cars') await page.locator('#fBrand').selectOption('Toyota',{force:true});
      await fill({[id]:label,...other});
      if (route==='zones') await page.locator('#fRackLevel').selectOption('2',{force:true});
      await click('#btnSave');
      const body=page.locator('#tbodyMain');
      await body.getByText(label,{exact:true}).waitFor();
      const key=findDoc(collection,field,label);
      assert(key);
      const row=body.locator('tr').filter({hasText:label});
      await row.locator('button.edit').click();
      await fill({[id]:label+' แก้'});
      await click('#btnSave');
      await body.getByText(label+' แก้',{exact:true}).waitFor();
      assert.equal(store.value(key,field),label+' แก้');
      await fill({searchInput:'คำค้นไม่มีข้อมูล'});
      await body.getByText(label+' แก้',{exact:true}).waitFor({state:'detached'});
      await fill({searchInput:label});
      await body.getByText(label+' แก้',{exact:true}).waitFor();
      await row.locator('button.del').click();
      await click('#btnDelete');
      await body.getByText(label+' แก้',{exact:true}).waitFor({state:'detached'});
      assert.equal(store.docs.has(key),false);
    });
  }

  await check('Products: typed prices and stock, image upload, verified badge and image removal',async()=>{
    await open('products');
    await page.waitForFunction(()=>!productLoading&&productsCache.length>0);
    await click('#btnAddProduct');
    await click('#productAdvancedDetails summary');
    await fill({inp_productName:'กรองน้ำมัน UAT',inp_barcode:'00000131001',inp_costPrice:'75.25',inp_sellingPrice:'129.50',inp_currentStock:'0'});
    const png=Buffer.from(await page.evaluate(()=>{
      const canvas=document.createElement('canvas');
      canvas.width=canvas.height=128;
      canvas.getContext('2d').fillRect(0,0,128,128);
      return canvas.toDataURL('image/png').split(',')[1];
    }),'base64');
    await page.locator('#inp_imageFile').setInputFiles({name:'uat.png',mimeType:'image/png',buffer:png});
    await page.waitForFunction(()=>productImageDraftDirty);
    await click('#modalBtnSave');
    await page.waitForFunction(()=>!productImageDraftDirty&&!document.getElementById('modalBtnSave').disabled);
    const key=findDoc('Master_Products','Product_Name','กรองน้ำมัน UAT');
    assert(key);assert.equal(store.value(key,'Barcode'),'00000131001');assert.equal(store.value(key,'Selling_Price'),129.5);
    assert.equal(store.value(key,'Has_Image'),true);
    const id=key.split('/')[1];
    await open('products');await fill({tableSearchInput:id});
    await page.locator('#productBody .product-image-badge').waitFor();
    assert.equal(await page.locator('#productBody img').count(),0);
    await page.locator('#productBody tr').filter({hasText:'กรองน้ำมัน UAT'}).locator('button.edit').click();
    await page.waitForFunction(()=>productImagesReady&&productImageUrls.length===1);
    await page.locator('#productImageSlots button').filter({hasText:'ลบ'}).first().click();
    await confirm();
    await click('#modalBtnSave');
    await page.waitForFunction(()=>!productImageDraftDirty&&!document.getElementById('modalBtnSave').disabled);
    assert.equal(store.value(key,'Has_Image'),false);assert.equal(store.docs.has('Product_Images/'+id),false);
  });

  await check('POS: keyboard scan, typed quantity and reference, confirmation and posted movement',async()=>{
    await open('stockissue');
    await page.waitForFunction(()=>products.some(p=>p.productCode==='P001'));
    await fill({searchInput:'100001'});
    await page.locator('#searchInput').press('Enter');
    const qty=page.locator('#basketLines input[type=number]').first();
    await qty.fill('2');await qty.press('Tab');
    await fill({inpRefNo:'UAT-POS-001'});
    assert.match(await page.locator('#basketLines .price-locked').innerText(),/119\.75/);
    await click('#btnConfirm');
    await confirm();
    await page.waitForFunction(()=>!issueBusy&&document.getElementById('btnConfirm').disabled);
    assert.equal(store.value('Master_Products/P001','Current_Stock'),4);
    const movement=findDoc('Stock_Movements','Unit_Price',119.75);
    assert(movement);assert.match(store.value(movement,'Bill_No'),/^SI-\d{8}-\d{4}$/);
    await confirm();
    await click('#tabBtnHistory');
    await page.locator('#mvBody .movement-link').first().click();
    await page.locator('#movementDetailBody .product-name-cell').getByText(/ผ้าเบรกทดสอบ/).waitFor();
  });

  await check('Quotation: Viewer picks customer and SKU, types quantity and saves',async()=>{
    await open('quotation','viewer');
    await page.waitForFunction(()=>document.querySelector('#selCustomer option[value="C001"]'));
    await page.locator('#selCustomer').selectOption('C001',{force:true});
    await fill({inpCustomerPo:'UAT-QUOTE-001',searchInput:'100001'});
    await page.locator('#searchInput').press('Enter');
    await page.locator('.quote-qty').fill('0');
    await click('#btnSaveQuote');
    await confirm();
    assert.equal(findDoc('Quotations','Customer_PO','UAT-QUOTE-001'),undefined);
    await page.locator('.quote-qty').fill('3');
    await click('#btnSaveQuote');
    const key=await waitForDoc('Quotations','Customer_PO','UAT-QUOTE-001');
    assert.equal(JSON.parse(store.value(key,'Items_JSON'))[0].qty,3);
  });

  await check('Tax invoice: Viewer types buyer, quantity and decimal price, then saves',async()=>{
    await open('taxinvoice','viewer');
    await click('button[onclick="openAddModal()"]');
    await fill({modalBuyerName:'ผู้ซื้อใบกำกับ UAT',modalBuyerAddress:'123 ถนนทดสอบ กรุงเทพ 10200'});
    await page.locator('.item-name').fill('อะไหล่ UAT');
    await page.locator('.item-qty').fill('2');
    await page.locator('.item-price').fill('99.75');
    await click('#modalBtnSave');
    const key=await waitForDoc('Master_Tax_Invoice','Buyer_Name','ผู้ซื้อใบกำกับ UAT');
    assert.equal(JSON.parse(store.value(key,'Items_JSON'))[0].qty,2);
    assert.equal(store.value(key,'Grand_Total'),213.47);
  });

  await check('Audit probe: invoice rounding with fractional quantity',async()=>{
    await open('taxinvoice','viewer');
    await click('button[onclick="openAddModal()"]');
    await fill({modalBuyerName:'ผู้ซื้อทดสอบเศษสตางค์'});
    await page.locator('.item-name').fill('อะไหล่แบ่งหน่วย UAT');
    await page.locator('.item-qty').fill('1.005');
    await page.locator('.item-price').fill('1');
    await click('#modalBtnSave');
    const key=await waitForDoc('Master_Tax_Invoice','Buyer_Name','ผู้ซื้อทดสอบเศษสตางค์');
    const subtotal=store.value(key,'Subtotal'), vat=store.value(key,'Vat_Amount'), total=store.value(key,'Grand_Total');
    observations.push({id:'INVOICE-ROUNDING',quantity:1.005,unitPrice:1,subtotal,vat,total,
      reconciles:Math.round(subtotal*100)+Math.round(vat*100)===Math.round(total*100)});
  });

  await check('PO: enter order quantity and note, receive partially and finish receipt',async()=>{
    await open('orders');
    const qty=page.locator('#poQty_P001');
    await qty.fill('5');await qty.press('Tab');
    await click('#btnCreatePO_V001');
    await fill({confirmNote:'UAT-PO-001'});
    await click('#btnConfirmSave');
    const key=await waitForDoc('Purchase_Orders','Note','UAT-PO-001');
    const id=key.split('/')[1];
    assert.equal(JSON.parse(store.value(key,'Items_JSON'))[0].qty,5);
    await click('#btnConfirmClose');
    await click('#tabBtnHistory');
    const row=page.locator('#historyTableBody tr').filter({hasText:id});
    for (const [quantity,stock,status] of [['2',6,'PartiallyReceived'],['3',9,'Received']]) {
      await row.locator('button.receive').click();
      await fill({recvReceiverName:'พนักงาน UAT',recvInvoiceNo:'UAT-R-'+quantity,recvDeliveryNoteNo:'DN-'+quantity});
      await page.locator('.recv-qty-input').fill(quantity);
      await page.locator('.recv-qty-input').press('Tab');
      await click('#btnReceiveSave');
      await confirm();
      await waitForDoc('Purchase_Orders','Status',status);
      assert.equal(store.value('Master_Products/P001','Current_Stock'),stock);
      if (await page.locator('#receiveModal.active').count()) await page.locator('#receiveModal .modal-close').click();
    }
  });

  await check('Account management: fill name/email and create Viewer through admin screen',async()=>{
    await open('manageusers','admin');
    await click('button[onclick="openAddModal()"]');
    await fill({modalFullName:'ผู้ใช้ใหม่ UAT',modalEmail:'new-viewer@example.invalid'});
    await page.locator('#modalRole').selectOption('viewer',{force:true});
    await click('#modalBtnSave');
    const key=await waitForDoc('Master_Users','Email','new-viewer@example.invalid');
    assert.equal(store.value(key,'Role'),'viewer');
    assert.equal(mail.length,1);
  });

  await check('Viewer: no catalog edit action and gateway rejects a forged stock write',async()=>{
    await open('products','viewer');
    await page.waitForFunction(()=>!productLoading&&productsCache.length>0);
    assert.equal(await page.locator('#btnAddProduct').isVisible(),false);
    const before=store.commits.length;
    const response=await page.evaluate(async token=>{
      const request=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({fn:'apiGateway',args:[token,'issueStock',[{items:[{productCode:'P001',qty:1}]}]]})});
      return request.json();
    },tokens.viewer);
    assert.equal(response.success,false);assert.equal(store.commits.length,before);
  });

  await check('Audit probe: real catalog pages carrying image status reach the IndexedDB eligibility check',async()=>{
    await open('products','viewer');
    await page.waitForFunction(()=>!productLoading&&productsCache.length>0);
    const cache=await page.evaluate(()=>{
      const entry=Array.from(syyReadCache.entries()).find(([key])=>key.startsWith('getAllProducts[')&&key.includes('"paged":true'));
      if(!entry) return null;
      const [key,record]=entry, payload=JSON.parse(record.raw);
      const withoutStatus=JSON.stringify({...payload,products:payload.products.map(({hasImage,...row})=>row)});
      return {rows:payload.products.length, fieldPresent:payload.products.every(row=>Object.hasOwn(row,'hasImage')),
        eligibleAsSent:syyDiskCache.eligible(key,record.raw),
        eligibleWithoutStatus:syyDiskCache.eligible(key,withoutStatus)};
    });
    assert(cache);
    observations.push({id:'CATALOG-DISK-SCHEMA',...cache});
  });

  await check('Audit probe: POS price changes after the operator reviews the basket',async()=>{
    await open('stockissue');
    await page.waitForFunction(()=>products.some(p=>p.productCode==='P001'));
    await fill({searchInput:'100001',inpRefNo:'UAT-PRICE-RACE'});
    await page.locator('#searchInput').press('Enter');
    const displayed=await page.locator('#basketLines .price-locked').innerText();
    await page.evaluate(()=>{
      const post=syyPostParent;
      syyPostParent=function(message){
        if(message.action==='OPEN_TAX_INVOICE')window.uatInvoiceDraft=message.items;
        return post.apply(this,arguments);
      };
    });
    await page.getByRole('button',{name:'ตัดสต๊อก + เปิดร่างใบกำกับ',exact:true}).click();
    const source=store.docs.get('Master_Products/P001');
    source.fields.Selling_Price={doubleValue:135.25};
    source.updateTime='uat-price-change';
    api.clearCollectionCache_('Master_Products');
    const stockBefore=store.value('Master_Products/P001','Current_Stock');
    await confirm();
    await page.locator('.syy-dialog-actions .swy-confirm-btn').waitFor();
    const movement=findDoc('Stock_Movements','Ref_No','UAT-PRICE-RACE');
    const invoiceDraftPrice=await page.evaluate(()=>window.uatInvoiceDraft?.[0]?.unitPrice ?? null);
    observations.push({id:'POS-PRICE-DRIFT',displayed,invoiceDraftPrice,
      recorded:movement?store.value(movement,'Unit_Price'):null,
      stockBefore,stockAfter:store.value('Master_Products/P001','Current_Stock'),
      reproduced:!!movement&&/119\.75/.test(displayed)&&store.value(movement,'Unit_Price')===135.25});
    await confirm();
  });

  await check('Audit probe: staff submits malformed and duplicate master data through gateway',async()=>{
    await open('brands');
    const response=await page.evaluate(async token=>{
      const results=[];
      for(const [collection,prefix,fields] of [
        ['Master_Brands','UAT',{Brand_Name:'แบรนด์ตั้งต้น',Status:'INVALID-UAT',Unexpected_Field:'UAT-probe'}],
        ['Master_Categories','UAT',{Category_Name:'   '}]
      ]){
        const request=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({fn:'apiGateway',args:[token,'saveMasterData',[collection,prefix,'',fields,'']]})});
        results.push(await request.json());
      }
      return results;
    },tokens.staff);
    const [brand,category]=response;
    observations.push({id:'MASTER-VALIDATION',duplicateAndUnexpectedFieldAccepted:brand.success===true,
      blankCategoryAccepted:category.success===true,
      brandFieldPersisted:store.value('Master_Brands/'+brand.id,'Unexpected_Field')==='UAT-probe',
      blankCategoryPersisted:store.value('Master_Categories/'+category.id,'Category_Name')==='   '});
  });

  await check('Stock history: Admin edits a posted POS bill, previews totals, then cancels it',async()=>{
    const movement=findDoc('Stock_Movements','Ref_No','UAT-POS-001');
    assert(movement);
    const bill=store.value(movement,'Bill_No'), stock=store.value('Master_Products/P001','Current_Stock');
    await open('stockissue','admin');
    await click('#tabBtnHistory');
    await page.getByText(bill,{exact:true}).click();
    await page.getByRole('button',{name:'แก้ไขรายการสินค้า',exact:true}).click();
    await fill({correctionReason:'ทดสอบแก้จำนวนสินค้า'});
    await page.locator('.correction-qty').fill('1');
    assert(await page.locator('#correctionConfirm').isDisabled());
    await click('#correctionPreviewButton');
    await click('#correctionConfirm');
    await page.waitForFunction(()=>!correctionBusy&&!correctionPayload);
    assert.equal(store.value('Master_Products/P001','Current_Stock'),stock+1);
    const replacement=findDoc('Stock_Movements','Replaces_Doc',store.value(movement,'Doc_No'));
    assert(replacement);
    const currentBill=store.value(replacement,'Bill_No');
    await open('stockissue','admin');
    await click('#tabBtnHistory');
    await page.getByText(currentBill,{exact:true}).click();
    await page.getByRole('button',{name:'ยกเลิกบิล',exact:true}).click();
    await fill({correctionReason:'ทดสอบยกเลิกบิล'});
    await click('#correctionPreviewButton');
    await click('#correctionCancelConfirm');
    await page.waitForFunction(()=>!correctionBusy&&!correctionPayload);
    assert.equal(store.value('Master_Products/P001','Current_Stock'),stock+2);
  });

  await check('Dashboard: admin opens Backup and Activity Log',async()=>{
    await open('home','admin');
    await page.waitForFunction(()=>DASH.loaded&&!DASH.loading);
    await page.getByText('สำรองข้อมูล',{exact:true}).first().click();
    await page.locator('#backupModal.active').waitFor();
    await click('#btnBackupNow');
    await page.waitForFunction(()=>!document.getElementById('btnBackupNow').disabled);
    assert([...store.files.values()].some(file=>file.getName()==='manifest.json'));
    await click('#btnBackupSchedule');
    await page.waitForFunction(()=>!document.getElementById('btnBackupSchedule').disabled);
    assert(triggers.some(trigger=>trigger.getHandlerFunction()==='dailyBackupJob_'));
    await click('#backupModal .modal-close');
    await page.getByText('Activity Log',{exact:true}).first().click();
    await page.locator('#logModal.active').waitFor();
    await page.locator('#logBody').getByText('uat-staff',{exact:true}).first().waitFor();
  });

  await check('Profile: wrong confirmation is blocked, new password revokes the old session',async()=>{
    await open('profile','staff');
    await page.getByText('UAT staff',{exact:true}).first().waitFor();
    const next='New-fixture-password-2026!';
    await fill({inpOldPassword:password,inpNewPassword:next,inpConfirmPassword:next+'x'});
    await click('#btnChangePassword');
    await page.locator('#err_inpConfirmPassword.show').waitFor();
    assert(api.getSession_(tokens.staff));
    await fill({inpConfirmPassword:next});
    await click('#btnChangePassword');
    await page.locator('#pwAlert.success').waitFor();
    assert.equal(api.getSession_(tokens.staff),null);
  });
}

async function waitForDoc(collection,field,value) {
  const end=Date.now()+3500;
  while(Date.now()<end) {
    const key=findDoc(collection,field,value);
    if(key)return key;
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  throw Error('Expected saved fixture missing: '+collection+'/'+field+'='+value);
}

main().catch(error=>{bridgeErrors.push(error.message);process.exitCode=1;})
  .finally(async()=>{
    if(browser)await browser.close();
    server.close();
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify({fixtureOnly:true,sourceRoutes:Object.keys(pages),evidence,observations,bridgeErrors},null,2));
    const failures=evidence.filter(row=>row.status==='fail').length;
    console.log((evidence.length-failures)+'/'+evidence.length+' stateful workflows passed');
    if(failures||bridgeErrors.length)process.exitCode=1;
  });
