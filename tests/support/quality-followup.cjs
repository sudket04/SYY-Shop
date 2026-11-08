// Source-only continuation: hostile text stays text through shared upgrades.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {default:AxeBuilder}=require('@axe-core/playwright');
module.exports=async function({pageFor,check,output}){
 const audits=[];
 async function auditErrors(page,file){
  await page.locator('.modal-overlay.active .modal-box').last().evaluate(box=>Promise.all(box.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  audits.push({file,state:'validation errors',violations:result.violations});
  fs.writeFileSync(path.join(output,'quality-followup-accessibility.json'),JSON.stringify(audits,null,2));
  assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],file);
 }
 await check('V2 follow-up icon upgrade never reparses escaped emoji text as HTML',async()=>{
  const p=await pageFor('Master_Brands.html');
  const payload='<img src=x onerror="window.fixtureXss=true">📦 อะไหล่ & <b>ชื่อ</b>';
  await p.evaluate(payload=>{window.fixtureXss=false;const root=document.createElement('div');root.id='iconHostileFixture';root.textContent=payload;document.body.appendChild(root);syyUpgradeIcons(root);syyUpgradeIcons(root);},payload);
  assert.equal(await p.locator('#iconHostileFixture img,#iconHostileFixture b').count(),0);
  assert.equal(await p.locator('#iconHostileFixture svg').count(),1);
  assert.match(await p.locator('#iconHostileFixture').textContent(),/<img src=x/);
  await p.evaluate(payload=>{const child=document.createElement('div');child.id='iconMutationFixture';child.textContent=payload;document.body.appendChild(child);},payload);
  await p.waitForFunction(()=>document.querySelector('#iconMutationFixture svg'));
  assert.equal(await p.locator('#iconMutationFixture img,#iconMutationFixture b').count(),0);
  assert.equal(await p.evaluate(()=>fixtureXss),false);assert.deepEqual(p.errors,[]);await p.close();
 });
 await check('V2 follow-up PO history and document print keep hostile legacy fields inert, preserve zero and issue no writes',async()=>{
  const payload='<img data-fixture-attack src=x onerror="window.fixtureXss=true">📦\\\');window.fixtureXss=true;//';
  const p=await pageFor('Purchase_Orders.html');const calls=await p.evaluate(()=>apiCalls.length);
  await p.evaluate(payload=>{window.fixtureXss=false;purchaseOrders=[{poId:payload,vendorName:payload,orderDate:'2026-11-07',status:payload,totalQty:0,totalAmount:payload,items:[{productName:payload,qty:payload,costPrice:payload}],receipts:[{date:'2026-11-07',invoiceNo:payload,items:[{productName:payload,qtyReceivedNow:payload}]}]}];renderHistoryTab();switchTab('history');},payload);
  assert.equal(await p.locator('#historyTableBody [data-fixture-attack]').count(),0);assert.equal(await p.locator('#historyTableBody tr[data-row-key] td').nth(4).textContent(),'0');assert.equal(await p.locator('#historyTableBody select').count(),0);
  await p.locator('#historyTableBody button.view').click();assert.match(await p.locator('#detailHeaderTitle').textContent(),/data-fixture-attack/);assert.equal(await p.locator('#detailModal [data-fixture-attack]').count(),0);assert.equal(await p.evaluate(()=>fixtureXss),false);assert.equal(await p.evaluate(()=>apiCalls.length),calls);assert.deepEqual(p.errors,[]);await p.close();
  for(const file of ['Master_Tax_Invoice.html','Quotation.html']){
   const q=await pageFor(file);const before=await q.evaluate(()=>apiCalls.length);
   await q.evaluate(({payload,file})=>{window.fixtureXss=false;const box=document.createElement('div');box.id='printSecurityFixture';if(file==='Master_Tax_Invoice.html')box.innerHTML=buildA4Page({...fixtureInvoice,invoiceDate:payload},[{name:payload,qty:payload,unit:payload,unitPrice:0}],1,2,false,0);else box.innerHTML=buildQuotePage({sellerInfo:{},cust:{},quoteNo:payload,quoteDateTxt:payload,validUntilTxt:payload},[{productName:payload,productCode:payload,qty:payload,unitPrice:0}],1,2,false,0);document.body.appendChild(box);syyUpgradeIcons(box);},{payload,file});
   assert.equal(await q.locator('#printSecurityFixture [data-fixture-attack]').count(),0);assert.equal(await q.evaluate(()=>fixtureXss),false);assert.equal(await q.evaluate(()=>apiCalls.length),before);assert.deepEqual(q.errors,[]);await q.close();
  }
 });
 await check('V2 follow-up car picker keyboard opens, searches full scope, loads more and returns focus without submitting',async()=>{
  const p=await pageFor('Master_Products.html');await p.evaluate(()=>openAddModal());await p.locator('#productModal.active').waitFor();await p.waitForFunction(()=>syyUxBusy===0);const calls=await p.evaluate(()=>apiCalls.length);
  await p.evaluate(()=>{carOptionsCache=Array.from({length:1000},(_,i)=>({id:'CAR'+i,Name:'รถ '+i}));selectedCarIds=[];renderCarChips();window.carFixtureSubmits=0;document.getElementById('productForm').addEventListener('submit',event=>{event.preventDefault();event.stopImmediatePropagation();carFixtureSubmits++;},true);});
  const toggle=p.locator('#carPickerToggle');await toggle.focus();await toggle.press('Enter');assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await p.locator('#carSearchInput').evaluate(el=>document.activeElement===el),true);
  await p.locator('#carSearchInput').fill('รถ 999');await p.locator('#carSearchInput').press('Enter');const match=p.locator('#carDropdownItems input[data-id="CAR999"]');assert.equal(await match.evaluate(el=>document.activeElement===el),true);await match.press('Space');assert.equal(await match.isChecked(),true);await match.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await toggle.evaluate(el=>document.activeElement===el),true);
  await toggle.press('Space');const more=p.locator('#carDropdownItems button');await more.focus();await more.press('Enter');assert.equal(await p.locator('#carDropdownItems input').count(),400);assert.equal(await p.locator('#carDropdownItems input[data-id="CAR200"]').evaluate(el=>document.activeElement===el),true);
  await p.getByRole('button',{name:'เลือกทั้งหมดที่แสดง',exact:true}).focus();await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>selectedCarIds.length),401);await p.getByRole('button',{name:'ล้างทั้งหมด',exact:false}).filter({has:p.locator('svg')}).first().press('Enter');assert.equal(await p.evaluate(()=>selectedCarIds.length),0);
  assert.equal(await p.evaluate(()=>carFixtureSubmits),0);assert.equal(await p.evaluate(()=>apiCalls.length),calls);assert.deepEqual(p.errors,[]);await p.close();
 });
 await check('V2 follow-up form summaries link invalid fields, preserve hints, clear after correction and make no RPC',async()=>{
  for(const file of ['Master_Products.html','Master_Brands.html','Master_Categories.html','Master_Cars.html','Master_Customers.html','Master_Vendors.html','Master_Zones.html']){
   const p=await pageFor(file);await p.evaluate(()=>openAddModal());await p.locator('.modal-overlay.active').waitFor();await p.waitForFunction(()=>syyUxBusy===0);const calls=await p.evaluate(()=>apiCalls.length);
   const id=await p.evaluate(()=>{const form=document.querySelector('form[data-syy-error-summary]'),field=form.querySelector('[required]')||document.getElementById('fModelCode');field.value='';if(field.id==='fModelCode'){cache=[{_code:'existing',_modelCode:'DUP'}];field.value='DUP';}const hint=document.createElement('span');hint.id='validationHintFixture';hint.textContent='คำแนะนำเดิม';field.after(hint);field.setAttribute('aria-describedby',hint.id);form.requestSubmit();return field.id;});
   await p.locator('.syy-validation-summary').waitFor();assert((await p.locator('#'+id).getAttribute('aria-describedby')).includes('validationHintFixture'));await p.locator('.syy-validation-summary button').first().click();assert.equal(await p.evaluate(id=>{const field=document.getElementById(id);return document.activeElement===field||document.activeElement===document.getElementById(id+'-control');},id),true);
   if(file==='Master_Products.html'){await p.setViewportSize({width:390,height:640});await p.evaluate(()=>{document.querySelectorAll('#productForm input[type="number"][min="0"]').forEach(field=>field.value='-1');document.getElementById('productForm').requestSubmit();});await p.waitForFunction(()=>document.querySelectorAll('.syy-validation-summary li').length>=3);assert.equal(await p.evaluate(()=>{const save=document.getElementById('modalBtnSave').getBoundingClientRect(),body=document.querySelector('#productForm .modal-body');return save.bottom<=innerHeight&&save.top>=0&&body.contains(document.querySelector('.syy-validation-summary'))&&body.getBoundingClientRect().height>100;}),true);await auditErrors(p,file);}
   await p.evaluate(()=>document.querySelector('form[data-syy-error-summary]').reset());assert.equal(await p.locator('.syy-validation-summary').count(),0);assert.equal(await p.evaluate(()=>apiCalls.length),calls);assert.deepEqual(p.errors,[],file);await p.close();
  }
  const p=await pageFor('Master_Tax_Invoice.html');await p.evaluate(()=>openAddModal());await p.locator('#invoiceModal.active').waitFor();const calls=await p.evaluate(()=>apiCalls.length);assert.equal(await p.evaluate(()=>validateForm()),false);assert((await p.locator('.syy-validation-summary button').count())>0);await auditErrors(p,'Master_Tax_Invoice.html');
  await p.locator('#modalBuyerName').fill('ลูกค้าทดสอบ');await p.locator('#itemBasket .item-name').first().fill('อะไหล่');await p.locator('#itemBasket .item-qty').first().fill('0');assert.equal(await p.evaluate(()=>validateForm()),false);
  await p.locator('.syy-validation-summary button').last().click();
  const state=await p.evaluate(()=>({active:document.activeElement.outerHTML,summary:document.querySelector('.syy-validation-summary').textContent}));
  assert.equal(await p.locator('#itemBasket .item-qty').first().evaluate(el=>document.activeElement===el),true,JSON.stringify(state));
  await p.locator('#itemBasket .item-qty').first().fill('1');await p.locator('#itemBasket .item-price').first().fill('0');assert.equal(await p.evaluate(()=>validateForm()),true);assert.equal(await p.locator('.syy-validation-summary').count(),0);assert.equal(await p.evaluate(()=>apiCalls.length),calls);assert.deepEqual(p.errors,[]);await p.close();
 });
};
