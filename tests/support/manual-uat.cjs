const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {barcode} = require('../../scripts/cdn-assets.json');

const pages = new Map([
  ['StockIssue.html', 'ตัดสต๊อกและสแกนสินค้า'],
  ['Master_Products.html', 'ฟอร์มสินค้าและตัวเลือกแบรนด์'],
  ['Purchase_Orders.html', 'ใบสั่งซื้อและหน้ารับสินค้า'],
  ['Master_Tax_Invoice.html', 'ใบกำกับภาษี'],
  ['Quotation.html', 'ใบเสนอราคา'],
  ['index.html', 'Dashboard']
]);

const samples = Array.from({length:20}, (_, index) => {
  const code = index * 500 + 499;
  return {sku:'UAT'+code, barcode:String(code).padStart(12, '0')};
});

const csp = [
  "default-src 'none'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'", "frame-src 'self'",
  "frame-ancestors 'self'", "form-action 'self'", "base-uri 'self'"
].join('; ');

function asset(output) {
  const file = path.join(output, 'quality-cdn-assets', 'barcode.js');
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  const integrity = 'sha384-' + createHash('sha384').update(bytes).digest('base64');
  return integrity === barcode.integrity ? bytes : null;
}

function landing(hasBarcode) {
  const links = [...pages].map(([file, label]) => `<li><a href="/?file=${file}">${label}</a></li>`).join('');
  const labels = samples.map(sample => `<li><b>${sample.sku}</b><br><code>${sample.barcode}</code>${hasBarcode ? `<svg data-code="${sample.barcode}" aria-hidden="true"></svg>` : ''}</li>`).join('');
  const print = hasBarcode
    ? '<button type="button" onclick="window.print()">พิมพ์ฉลากทดสอบ</button>'
    : '<p>ใช้ <code>npm run verify:cdn -- --download</code> เพื่อเตรียมไฟล์บาร์โค้ดที่ตรวจ SHA-384 แล้ว</p>';
  const drawBarcodes = hasBarcode ? `<script src="/uat/barcode.js"></script>
    <script>
      document.querySelectorAll('[data-code]').forEach(svg => {
        JsBarcode(svg, svg.dataset.code, {format:'CODE128', height:36, displayValue:false, margin:10});
      });
    </script>` : '';
  return `<!doctype html>
  <html lang="th">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>SYY-Shop UAT ในเครื่อง</title>
    <style>
      body{font:16px/1.6 system-ui,sans-serif;margin:20px;color:#172033}
      main{max-width:1050px;margin:auto}
      a,button{display:inline-block;padding:8px 0}
      button{padding:8px 16px;font:inherit}
      .labels{padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:8px;list-style:none}
      .labels li{border:1px solid #b5c0cd;padding:8px;break-inside:avoid}
      svg{max-width:100%;height:auto}
      @media print{.instructions{display:none}body{margin:0}}
    </style>
  </head>
  <body>
    <main>
      <h1>SYY-Shop UAT ในเครื่อง</h1>
      <div class="instructions">
        <p>ข้อมูลสังเคราะห์สำหรับตรวจด้วยอุปกรณ์และเบราว์เซอร์</p>
        <ol>
          <li>พิมพ์ฉลาก หรือเปิดฉลากบนจอแยก</li>
          <li>เปิดหน้าตัดสต๊อก กด F2 แล้วสแกนทีละฉลากด้วยโหมดส่ง Enter</li>
          <li>ตรวจว่าตะกร้ามี 20 รหัสตรงตามฉลาก ลองอ่านปุ่มเพิ่ม ลด ลบ และช่องจำนวนด้วยโปรแกรมอ่านหน้าจอ</li>
        </ol>
        <ul>${links}</ul>
        ${print}
      </div>
      <ul class="labels">${labels}</ul>
      ${drawBarcodes}
    </main>
  </body>
  </html>`;
}

function createManualUat(output) {
  const barcodeBytes = asset(output);
  const bootstrap = `<script>
  delete window.Swal;
  const manualProducts = ${JSON.stringify(samples)}.map((sample, index) => ({
    ...fixtureProduct, id:sample.sku, productCode:sample.sku, barcode:sample.barcode,
    productName:'อะไหล่ทดสอบ '+sample.sku, partNumber:index<2?'AMBIGUOUS-PN':'PN-'+sample.sku,
    _imageLoaded:true
  }));
  const manualOrder = {poId:'PO-UAT', vendorName:'ร้านทดสอบ', status:'Ordered', orderDate:'2026-11-07',
    totalQty:5, totalAmount:500, items:[{...manualProducts[0],qty:5,receivedQty:0}], receipts:[]};
  const fixtureRespond = window.respond;
  window.respond = function (name, args, metadata) {
    if (name==='getAllProducts') return args[0]?.includeMasters ? {products:manualProducts,masters:fixtureRespond('getAllMasterDropdowns',[])} : manualProducts;
    if (name==='getDashboardBootstrap') return {...fixtureRespond(name,args,metadata), products:manualProducts};
    if (name==='getPurchaseOrderPageData') return {lowStockItems:[], purchaseOrders:[manualOrder]};
    if (/^(get|fetch)/.test(name)) return fixtureRespond(name,args,metadata);
    return {success:false,message:'โหมดตรวจรับในเครื่องสำหรับตรวจหน้าจอและตะกร้า'};
  };
  </script>`;
  const banner = `<aside aria-label="สถานะโหมดทดสอบ" style="padding:8px 12px;background:#e7f0fc;color:#183b62;font-size:14px"><a href="/">กลับไปที่ฉลาก UAT</a> · ข้อมูลจำลอง <span id="uatViewport"></span></aside><script>
  function showUatViewport() {
    document.getElementById('uatViewport').textContent='· พื้นที่ '+innerWidth+' × '+innerHeight+' · DPR '+devicePixelRatio;
  }
  showUatViewport();
  addEventListener('resize',showUatViewport);
  </script>`;

  function route(req, res, url, port) {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.host !== '127.0.0.1:'+port || req.method !== 'GET') {
      res.writeHead(403).end();
      return true;
    }
    if (url.pathname === '/uat/barcode.js' && barcodeBytes) {
      res.writeHead(200, {'Content-Type':'text/javascript'}).end(barcodeBytes);
      return true;
    }
    if (url.pathname !== '/') {
      res.writeHead(404).end();
      return true;
    }
    if (!url.search) {
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}).end(landing(!!barcodeBytes));
      return true;
    }
    return false;
  }

  return {route, accepts: file => pages.has(file), bootstrap, banner};
}

module.exports = {createManualUat};
