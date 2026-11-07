const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function ({pageFor, check, output}) {
  const evidence = {environment:'Local browser and synthetic RPC fixtures', checks:{}};
  function record(id, result) {
    evidence.checks[id] = result;
    fs.writeFileSync(path.join(output, 'quality-uat.json'), JSON.stringify(evidence, null, 2));
  }

  await check('V2 UAT keyboard scanner enters 20 SKUs, handles ambiguity and submits the reviewed quantities once', async () => {
    const page = await pageFor('StockIssue.html');
    await page.evaluate(() => {
      products = Array.from({length:10000}, (_, index) => ({
        ...fixtureProduct,
        id:'UAT'+index,
        productCode:'UAT'+index,
        productName:'อะไหล่สำหรับทดสอบ '+index,
        barcode:String(index).padStart(12, '0'),
        partNumber:index===0 || index===1 ? 'AMBIGUOUS-PN' : 'PN-'+index,
        _imageLoaded:true
      }));
      basket = [];
      renderResults();
      renderBasket();
      window.scanTimes = [];
      let sample;
      document.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.target.id !== 'searchInput') return;
        sample = {started:performance.now(), lines:basket.length};
      }, true);
      new MutationObserver(() => {
        if (sample && basket.length > sample.lines) {
          scanTimes.push(performance.now() - sample.started);
          sample = null;
        }
      }).observe(document.getElementById('basketLines'), {childList:true});
    });
    const input = page.locator('#searchInput');
    const initialCalls = await page.evaluate(() => apiCalls.length);
    const codes = Array.from({length:20}, (_, index) => index * 500 + 499);
    for (const index of codes) {
      await page.keyboard.press('F2');
      await input.pressSequentially(String(index).padStart(12, '0'));
      await input.press('Enter');
      await page.waitForFunction(code => basket.some(line => line.productCode === code), 'UAT'+index);
    }
    assert.deepEqual(await page.evaluate(() => basket.map(line => line.productCode)), codes.map(index => 'UAT'+index));
    const times = await page.evaluate(() => scanTimes.slice().sort((a,b) => a-b));
    assert.equal(times.length, 20);
    await page.keyboard.press('F2');
    await input.pressSequentially('AMBIGUOUS-PN');
    await input.press('Enter');
    assert.equal(await page.evaluate(() => basket.length), 20);
    assert.match(await page.locator('#resultCount').ariaSnapshot(), /status.*พบหลายรายการ/);
    await input.press('ArrowDown');
    const selected = await page.evaluate(() => results[selIdx].productCode);
    await input.press('Enter');
    assert.equal(await page.evaluate(() => basket.at(-1).productCode), selected);
    const quantity = page.getByRole('spinbutton', {name:'จำนวน อะไหล่สำหรับทดสอบ 499', exact:true});
    await quantity.fill('2.5');
    await quantity.press('Tab');
    assert.equal(await page.evaluate(() => basket[0].qty), 2.5);
    assert.equal(await page.evaluate(() => apiCalls.length), initialCalls);
    await page.evaluate(() => {
      Swal.fire = () => Promise.resolve({isConfirmed:false});
    });
    await page.keyboard.press('F4');
    await page.waitForFunction(() => !issueBusy);
    assert.equal(await page.evaluate(() => apiCalls.filter(call => call.fn==='issueStock').length), 0);
    await page.evaluate(() => {
      apiHold = 'issueStock';
      Swal.fire = () => Promise.resolve({isConfirmed:true});
    });
    await page.keyboard.press('F4');
    await page.waitForFunction(() => apiPending.length === 1);
    await page.keyboard.press('F4');
    const payloads = await page.evaluate(() => apiCalls.filter(call => call.fn==='issueStock').map(call => call.args[0]));
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].items.length, 21);
    assert.deepEqual(payloads[0].items[0], {productCode:'UAT499',productName:'อะไหล่สำหรับทดสอบ 499',qty:2.5});
    assert(payloads[0].requestId);
    await page.evaluate(() => {apiHold=''; apiPending.shift()();});
    await page.waitForFunction(() => basket.length === 0 && !issueBusy);
    assert.deepEqual(page.errors, []);
    record('scanner', {catalog:10000, uniqueScans:20, ambiguousRequiresSelection:true, readsDuringSearch:0, mockSubmissions:1, enterToDomMs:{p50:times[9],p95:times[18]}});
    await page.close();
  });

  await check('V2 UAT partial receipt preserves quoted SKU, exposes named quantities and locks the completed PO', async () => {
    const page = await pageFor('Purchase_Orders.html');
    const sku = 'SKU"-B';
    await page.evaluate(sku => {
      const order = {poId:'PO-UAT',vendorName:'ร้านทดสอบ',status:'Ordered',orderDate:'2026-11-07',totalQty:5,totalAmount:500,items:[
        {productCode:sku,productName:'อะไหล่รุ่น B',qty:5,receivedQty:0,costPrice:100}
      ],receipts:[]};
      purchaseOrders = [structuredClone(order)];
      const original = respond;
      respond = (name, args, metadata) => {
        if (name === 'getPurchaseOrderPageData') return {lowStockItems:[],purchaseOrders:[structuredClone(order)]};
        if (name !== 'receiveGoods') return original(name, args, metadata);
        order.items[0].receivedQty += args[0].items[0].qtyReceivedNow;
        order.status = order.items[0].receivedQty===5 ? 'Received' : 'PartiallyReceived';
        return {success:true,message:'รับสินค้าแล้ว',po:structuredClone(order)};
      };
      switchTab('history');
      renderHistoryTab();
    }, sku);
    await page.waitForFunction(() => syyUxBusy === 0);
    const receive = page.getByRole('button', {name:'บันทึกรับสินค้า', exact:true});
    await receive.click();
    assert.equal(await page.locator('#receiveItemsBody tr').getAttribute('data-product'), sku);
    const quantity = page.getByRole('spinbutton', {name:'จำนวนที่รับ อะไหล่รุ่น B', exact:true});
    assert.match(await quantity.ariaSnapshot(), /spinbutton.*จำนวนที่รับ อะไหล่รุ่น B/);
    await quantity.fill('2');
    await page.locator('#recvInvoiceNo').fill('INV-UAT-1');
    await page.locator('#recvReceiverName').fill('ผู้รับทดสอบ');
    await page.locator('#btnReceiveSave').click();
    await page.locator('#receiveAlert').waitFor({state:'visible'});
    assert.match(await page.locator('#receiveAlert').textContent(), /ใบส่งของ/);
    assert.equal(await page.evaluate(() => apiCalls.filter(call => call.fn==='receiveGoods').length), 0);
    await page.locator('#recvDeliveryNoteNo').fill('DN-UAT-1');
    await page.locator('#btnReceiveSave').click();
    await page.locator('#receiveModal').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(() => purchaseOrders[0].status), 'PartiallyReceived');
    await receive.click();
    assert.equal(await quantity.inputValue(), '3');
    await page.locator('#recvInvoiceNo').fill('INV-UAT-2');
    await page.locator('#recvReceiverName').fill('ผู้รับทดสอบ');
    await page.locator('#btnReceiveSave').click();
    await page.locator('#receiveModal').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(() => purchaseOrders[0].status), 'Received');
    assert.equal(await receive.count(), 0);
    const requests = await page.evaluate(() => apiCalls.filter(call => call.fn==='receiveGoods').map(call => call.args[0]));
    assert.deepEqual(requests.map(request => request.items), [[{productCode:sku,qtyReceivedNow:2}],[{productCode:sku,qtyReceivedNow:3}]]);
    assert.notEqual(requests[0].requestId, requests[1].requestId);
    assert.deepEqual(page.errors, []);
    record('receipt', {ordered:5, received:[2,3], deliveryNoteRequiredForPartial:true, finalStatus:'Received', mockSubmissions:2});
    await page.close();
  });

  await check('V2 UAT reduced viewports keep primary actions reachable at 200 and 400 percent reflow equivalents', async () => {
    const workflows = [
      {file:'index.html',selector:'#btnDashExport'},
      {file:'StockIssue.html',selector:'#searchInput'},
      {file:'Master_Products.html',selector:'#modalBtnSave',open:() => openAddModal()},
      {file:'Master_Tax_Invoice.html',selector:'#modalBtnSave',open:() => openAddModal()},
      {file:'Quotation.html',selector:'#qcBtnSave',open:() => openQuickAddCustomer()},
      {file:'Purchase_Orders.html',selector:'#btnReceiveSave',open:() => {
        purchaseOrders = [{poId:'PO-REFLOW',vendorName:'ร้านทดสอบ',status:'Ordered',items:[{productCode:'P1',productName:'อะไหล่',qty:3,receivedQty:0}]}];
        openReceiveModal('PO-REFLOW');
      }}
    ];
    const widths = [{width:640,height:480},{width:320,height:240}];
    const results = [];
    for (const workflow of workflows) {
      const page = await pageFor(workflow.file);
      if (workflow.open) await page.evaluate(workflow.open);
      const control = page.locator(workflow.selector);
      await control.waitFor();
      for (const viewport of widths) {
        await page.setViewportSize(viewport);
        await control.scrollIntoViewIfNeeded();
        await control.focus();
        const metrics = await control.evaluate(element => {
          const box = element.getBoundingClientRect();
          const center = document.elementFromPoint(box.x + box.width/2, box.y + box.height/2);
          const documentWidth = document.documentElement.scrollWidth;
          const overflow = documentWidth > innerWidth+1 ? [...document.querySelectorAll('body *')]
            .filter(node => node.getBoundingClientRect().right > innerWidth+1 && !node.closest('svg,.table-wrap,.modal-body'))
            .slice(0, 8).map(node => ({id:node.id, className:node.className, right:node.getBoundingClientRect().right})) : [];
          return {width:innerWidth, document:documentWidth, reachable:element.contains(center), focused:document.activeElement===element, top:box.top, bottom:box.bottom, overlay:center?.id || center?.className || null, overflow};
        });
        assert(metrics.document <= metrics.width+1 && metrics.reachable && metrics.focused, workflow.file+' '+JSON.stringify(viewport)+' '+JSON.stringify(metrics));
        if (workflow.file==='Master_Products.html' && viewport.width===320) {
          const picker = page.locator('#inp_brandId-control');
          await picker.scrollIntoViewIfNeeded();
          await picker.press('Enter');
          const panel = page.locator('#inp_brandId-panel');
          const bounds = await panel.evaluate(element => {
            const box = element.getBoundingClientRect();
            return {top:box.top,bottom:box.bottom,height:innerHeight};
          });
          assert(bounds.top>=0 && bounds.bottom<=bounds.height, 'Brand picker '+JSON.stringify(bounds));
          const search = panel.getByRole('searchbox');
          await search.fill('B');
          await search.press('ArrowDown');
          const option = panel.getByRole('option', {name:'B',exact:true});
          assert.equal(await option.evaluate(element => document.activeElement===element), true);
          await option.press('Enter');
          assert.equal(await page.locator('#inp_brandId').inputValue(), 'B1');
          assert.equal(await picker.evaluate(element => document.activeElement===element), true);
        }
        results.push({file:workflow.file,...viewport});
      }
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    record('reflow', {method:'Viewport reduction from 1280 x 960', cases:results, keyboardPickerAt320x240:true});
  });
};
