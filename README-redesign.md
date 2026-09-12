# SYY Shop Control — ชุดไฟล์ UI ที่ปรับปรุงแล้วทั้งระบบ (Google Apps Script)

ไฟล์ในโฟลเดอร์นี้คือระบบ SYY Shop Control ฉบับสมบูรณ์ที่ผ่านการ implement ตามดีไซน์ใน
`UI Audit and Redesign.dc.html` แล้วครบทุกหน้า — พร้อมวางทับโปรเจกต์ Apps Script เดิมได้ทันที

## ไฟล์ทั้งหมด — สร้างใน Apps Script ตามชื่อนี้เป๊ะๆ (ไม่ต้องใส่นามสกุล .html)

| ไฟล์ | สร้างใน Apps Script ชื่อ | ประเภท | หมายเหตุ |
|---|---|---|---|
| `Code.gs` | **Code** | Script | Backend ทั้งหมด — คัดลอกจากของเดิม + เพิ่มส่วนตัดสต๊อก + แก้บั๊ก 2 จุด (ดูหัวข้อ "สิ่งที่แก้ไป" ด้านล่าง) |
| `Styles.html` | **Styles** | HTML | CSS กลางทั้งระบบ (ปุ่ม/ตาราง/โมดัล/badge/toast/XLFILTER/SweetAlert) |
| `Shared.html` | **Shared** | HTML | esc/money/thDate, toast, modal helper, skeleton, empty state, callApi |
| `XLFilter.html` | **XLFilter** | HTML | ตัวกรอง/เรียงแบบ Excel — เหลือที่เดียวทั้งระบบ |
| `ThaiAddressData.html` | **ThaiAddressData** | HTML | ฐานข้อมูลจังหวัด/อำเภอ/ตำบล/รหัสไปรษณีย์ (ของเดิม ไม่ได้แก้) |
| `index.html` | **index** | HTML | เปลือกหน้าใหม่ทั้งหมด (sidebar ย่อได้, Ctrl+K, การ์ดสถิติกดกรองได้) |
| `StockIssue.html` | **StockIssue** | HTML | หน้าตัดสต๊อก/ขายหน้าร้าน |
| `Master_Brands.html` | **Master_Brands** | HTML | แบรนด์สินค้า |
| `Master_Categories.html` | **Master_Categories** | HTML | หมวดหมู่สินค้า |
| `Master_Zones.html` | **Master_Zones** | HTML | โซนจัดเก็บ |
| `Master_Cars.html` | **Master_Cars** | HTML | ข้อมูลรถ |
| `Master_Vendors.html` | **Master_Vendors** | HTML | ผู้จัดจำหน่าย |
| `Master_Customers.html` | **Master_Customers** | HTML | ลูกค้า |
| `Master_Products.html` | **Master_Products** | HTML | จัดการสินค้า |
| `Master_Tax_Invoice.html` | **Master_Tax_Invoice** | HTML | ใบกำกับภาษี + แดชบอร์ดสรุป |
| `Purchase_Orders.html` | **Purchase_Orders** | HTML | สั่งซื้อสินค้า + รับสินค้า + ประวัติ |
| `Profile.html` | **Profile** | HTML | บัญชีของฉัน + 2FA + ประวัติการใช้งาน |

> ไฟล์ที่ **ไม่ได้รวมมาในชุดนี้** เพราะไม่ได้อยู่ในขอบเขตงานนี้ (ไม่มีอยู่ในไฟล์ที่แนบมาให้ตั้งแต่แรก): `Login.html`, `Manage_Users.html` — คัดลอกของเดิมมาวางเพิ่มได้เลย ไม่ต้องแก้อะไร

## 1. ลำดับการติดตั้ง
1. สร้าง `Styles`, `Shared`, `XLFilter`, `ThaiAddressData` ก่อน (ไฟล์ฐานที่ไฟล์อื่นเรียกใช้)
2. ทับ `Code.gs` เดิมด้วยไฟล์นี้ (หรือ diff เทียบก่อนถ้ามีโค้ดเฉพาะของหน้าร้านที่เพิ่มเองภายหลัง)
3. ทับไฟล์ HTML ที่เหลือทั้งหมดตามตารางด้านบน
4. เพิ่ม `Login.html`, `Manage_Users.html` ของเดิมกลับเข้ามา (ไม่ได้แก้ไข ไม่ต้องทำอะไรเพิ่ม)
5. Deploy ใหม่ (Deploy → Manage deployments → แก้ไข → เวอร์ชันใหม่)
6. ทดสอบ login → เข้าหน้า Dashboard → ลองเพิ่ม/แก้/ลบข้อมูลทุกหน้า → ลองตัดสต๊อก → ลองออกใบกำกับภาษี → ลองสั่งซื้อ/รับสินค้า

## 2. สิ่งที่ทำครบตามดีไซน์ (`UI Audit and Redesign.dc.html`)
- **หัวเรื่องซ้อนสองชั้น** → รวมเป็น breadcrumb แถวเดียวทุกหน้า (`.page-head` + `.crumb`)
- **hover แถวสีฟ้าเข้ม + border-left กระตุก** → พื้นอ่อน + เส้นซ้ายแบบ `inset box-shadow` ไม่ทำให้แถวขยับ (แก้ที่ `Styles.html` มีผลทุกตารางทุกหน้า รวมถึงตารางที่หัวเข้มเดิมใน Tax Invoice/Purchase Orders/Profile ที่ไม่เคยผ่านการปรับปรุงมาก่อน)
- **ปุ่มกรอง/ไอคอนเล็กกว่าเกณฑ์แตะ** → ปุ่ม ▾ กรอง 30px, ปุ่มไอคอนแถว 36px ทุกหน้า
- **ไม่สม่ำเสมอ**: alert()/confirm() ดั้งเดิมทั้งหมด (รวมถึงในหน้า Products/Tax Invoice/Purchase Orders/Profile ที่ไม่เคยแตะ) เปลี่ยนเป็น toast/SweetAlert2 ชุดเดียวกันหมดแล้ว
- **โหลดข้อมูล/ตารางว่าง** → skeleton แถวจำลอง + empty state ที่มีปุ่มทางออก (ล้างตัวกรอง/เพิ่มรายการแรก) ทุกหน้า
- **CSS + XLFILTER ซ้ำ 10+ ไฟล์** → เหลือที่เดียวใน `Styles.html`/`XLFilter.html`/`Shared.html` ทุกหน้ารวมถึงหน้าที่ซับซ้อนที่สุด (ตะกร้าสินค้าใน Tax Invoice, multi-select รุ่นรถใน Products, ฟอร์มรับสินค้าใน Purchase Orders) — เหลือเฉพาะ CSS/JS ที่ไม่ซ้ำใครในแต่ละไฟล์เป็น `<style>`/`<script>` เสริมท้ายไฟล์นั้นๆ
- **เรียก backend ตรงด้วย `google.script.run` ข้าม apiGateway** — พบว่าเกือบทุกหน้า (Master_Categories/Zones/Cars/Vendors/Customers/Products/Tax_Invoice/Purchase_Orders) เขียนขึ้นก่อนระบบ session/สิทธิ์ตาม role จะถูกเพิ่มเข้ามาใน `Code.gs` จึงไม่เคยผ่านการตรวจสิทธิ์เลย — แก้ให้ทุกหน้าเรียกผ่าน `callApi()` (เช็ค token + role ทุกครั้ง) เหมือนกันหมดแล้ว

## 3. บั๊กที่พบและแก้ระหว่างทำ (นอกเหนือจากดีไซน์)
1. **`saveMasterData` ไม่เคยอยู่ใน `API_REGISTRY`** — ทำให้ทุกครั้งที่กดบันทึกแบรนด์/หมวดหมู่ (ทั้งหน้าเดิมและหน้าใหม่) จะถูก `apiGateway` ปฏิเสธเสมอ (เป็นบั๊กเดิมที่ซ่อนอยู่เพราะหน้าพวกนี้ไม่เคยผ่าน apiGateway มาก่อน — เพิ่งโผล่ตอนย้ายมาใช้ `callApi()`). แก้แล้วใน `Code.gs`
2. **ฝั่ง "รับของ" ไม่มีประวัติเข้า** — `receiveGoods()` เดิมใช้ `incrementProductStockBatch()` เพิ่มสต๊อกเฉยๆ ไม่บันทึกลง `Stock_Movements` เลย ต่างจากฝั่งตัดสต๊อกที่มี log ทุกครั้ง เปลี่ยนให้เรียก `logStockIn_()` แทนแล้ว (มีประวัติ "รับของตาม PO" ให้ดูคู่กับฝั่งตัดออก)
3. **`issueStock`/`logStockIn_` ไม่รู้ว่าใครทำรายการจริง** — เดิมพึ่ง `Session.getActiveUser()` ซึ่งใช้ไม่ได้กับระบบ login แบบ username/password ของแอปนี้ แก้ให้ `apiGateway` ส่ง username จาก session จริงเข้าไปให้อัตโนมัติแทน

## 4. รู้ไว้ก่อนใช้งาน (ไม่ใช่บั๊ก แต่เป็นพฤติกรรมเดิมที่ยังไม่ได้แก้)
- **`StockIssue.html` และ `index.html` เป็นไฟล์ที่ทีมออกแบบส่งมาให้ก่อนหน้านี้แล้ว** งานนี้ไม่ได้แตะทั้งสองไฟล์ตามขอบเขตที่ตกลงกัน แต่ตรวจพบว่า `StockIssue.html` ยังเรียก backend ด้วย `google.script.run` ตรงๆ (ไม่ผ่าน `callApi()`/`apiGateway` เหมือนหน้าอื่นที่ทำใหม่ทั้งหมด) ผลคือ (ก) ไม่เช็คสิทธิ์ role ทาง client เหมือนหน้าอื่น (ฝั่ง server ยัง apiGateway อยู่ดีถ้าจะเรียกผ่าน token แต่หน้านี้เลือกไม่ผ่าน) และ (ข) ช่อง "User" ใน log ตัดสต๊อกจะได้ username เพี้ยน (`Session.getActiveUser()` ว่าง → บันทึกเป็น "system" แทนชื่อพนักงานจริง) ถ้าต้องการ ให้แจ้งมาเดี๋ยวปรับให้ใช้ `callApi()` เหมือนหน้าอื่นได้
- **การเปิด/ปิด 2FA จำกัดเฉพาะ admin** (`authStartTotpSetup`/`authConfirmTotpSetup`/`authDisableTotp` ใน `API_REGISTRY` เป็น `"admin"`) เป็นการตั้งค่าที่มีอยู่แล้วในโค้ดเดิม ไม่ได้เปลี่ยน — staff/viewer จะกดเปิด 2FA ในหน้า "บัญชีของฉัน" ไม่ได้ ถ้าอยากให้ทุก role เปิดเองได้ แจ้งมาแก้ค่านี้จุดเดียว
- **`Master_Cars.html`**: ช่อง "รหัสรุ่น" กับ "หมายเหตุ" ในฟอร์มเพิ่ม/แก้ไขรถ ไม่ได้ถูกบันทึกจริงฝั่ง backend (`saveCar()` เดิมรับแค่ brand/model/year/typeCar) — เป็นพฤติกรรมเดิมของระบบตั้งแต่ก่อนงานนี้ คงไว้ตามเดิมเพราะไม่ได้อยู่ในขอบเขตของการปรับ UI ครั้งนี้

## 5. โครงหน้าใหม่ที่ทุกหน้าใช้ร่วมกัน
```html
<head>
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
  <?!= include('Styles'); ?>
  <style> /* CSS เฉพาะหน้านี้ ถ้ามี — widget ที่ไม่ซ้ำกับหน้าอื่น */ </style>
</head>
<body>
  <div class="page-head">
    <div class="crumb"><span>กลุ่ม</span><span class="sep">›</span><b>ชื่อหน้า</b></div>
    <div>...ปุ่ม...</div>
  </div>
  <div class="page-body"> …การ์ด/ตาราง/แท็บ… </div>

  <?!= include('XLFilter'); ?>  <!-- เฉพาะหน้าที่มีตารางกรองได้ -->
  <?!= include('Shared'); ?>
  <script>
    var AUTH_TOKEN  = "<?= authToken ?>";
    var WEB_APP_URL = "<?= webAppUrl ?>";
    /* logic ของหน้านี้ — เรียก backend ผ่าน callApi(fnName, args, onSuccess, onFailure) เสมอ */
  </script>
</body>
```

## 6. route + เมนู (ไม่ต้องแก้ — มีอยู่แล้วใน `Code.gs`/`index.html` ที่แนบมา)
`doGet(e)` มี route `stockissue` และเมนูใน `index` อ่านจากตัวแปร `MENU` เดียวอยู่แล้ว รวมถึงเพิ่มทางเข้าไปหน้า "บัญชีของฉัน" จากคลิกที่ชื่อผู้ใช้มุมล่าง sidebar ให้แล้ว (ของเดิมไม่มีทางกดเข้าหน้านี้เลยจากเมนู)
