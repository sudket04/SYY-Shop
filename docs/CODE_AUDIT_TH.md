# รายงานตรวจสอบโค้ด SYY-Shop (Phase 2)

## ขอบเขต

Phase นี้ปรับ Application Shell, navigation และการจัดลำดับข้อมูลบน Dashboard เท่านั้น โดย **ไม่เปลี่ยน collection, field, API contract, ข้อมูลเดิม หรือ role permission**

## UI/UX

- Desktop ใช้ sidebar แบบย่อ/ขยายได้และแสดงเมนูตาม role เดิม
- Mobile ใช้ bottom navigation 5 จุด: หน้าหลัก, ตัดสต๊อก, สินค้า, เอกสาร และเพิ่มเติม
- เมนูเอกสารบนมือถือเปิดตัวเลือกใบเสนอราคา ใบกำกับภาษี และใบสั่งซื้อ
- icon ใน shell และ navigation เป็น local inline SVG แบบเส้น จึงไม่เพิ่ม request ไปยัง icon service
- Dashboard เริ่มที่เดือนปัจจุบัน และจัด KPI เป็น Stock, Sales และ Purchasing Overview ตามลำดับ
- Desktop คงความหนาแน่นของข้อมูล ส่วน mobile ใช้ card สองคอลัมน์และ control ที่เลื่อนได้เพื่อไม่บีบเนื้อหา

## Firestore Reads/Writes

- การเปลี่ยนช่วงเวลา, filter, sort, tab และมุมมอง ทำบนข้อมูลที่อยู่ในหน่วยความจำฝั่ง client ไม่มี read/write เพิ่ม
- ยังใช้ `getDashboardBootstrap` contract เดิมหนึ่งครั้งต่อการโหลด Dashboard; ไม่มี collection/field ใหม่และไม่มี migration
- เพิ่ม in-flight guard ป้องกันการเรียก bootstrap ซ้อนระหว่าง request เดิมยังไม่จบ
- เมื่อกลับหน้า Dashboard จะ refresh เฉพาะ cache ที่เก่ากว่า 5 นาที (เดิม 1 นาที)
- event ที่เปลี่ยนเฉพาะสินค้าใช้ `getAllProducts` แล้ว aggregate ใหม่ใน client แทนการอ่าน movements และ PO ซ้ำ

## ความเสี่ยงและข้อเสนอสำหรับปริมาณเป้าหมาย

`getDashboardBootstrap` ยังอ่านประวัติ Stock Movements เพื่อ aggregate ใน browser ตาม contract ปัจจุบัน จึงโตตามประวัติและไม่เหมาะกับเป้าหมาย 300–1,000 movements ต่อวันในระยะยาว แม้ Phase นี้จะลดการ refresh ซ้ำแล้วก็ตาม

ก่อนขยายงาน backend ควรขออนุมัติการเปลี่ยน data design แยกต่างหาก เช่น daily/monthly aggregate documents, bounded date query และ cursor pagination พร้อม backfill plan เพราะแนวทางเหล่านี้มีผลต่อ schema, index, write volume และข้อมูลเดิม ห้ามทำ migration โดยไม่ได้รับอนุมัติ

## การตรวจสอบสิทธิ์

Mobile navigation สร้างจากเงื่อนไข role ชุดเดียวกับ sidebar และ `switchPage` ตรวจ permission ซ้ำก่อนเปิดปลายทาง จึงไม่ลดทอน role-based navigation เดิม ทั้งนี้ backend gateway ยังคงเป็นแหล่งบังคับสิทธิ์หลัก

## Typography System (Product Listing และทั้งระบบ)

- ใช้ `Noto Sans Thai` เป็นฟอนต์หลักสำหรับภาษาไทย และ `Inter` เป็น fallback สำหรับอักษรละติน โดยมี `system-ui` รองรับกรณีโหลด web font ไม่สำเร็จ
- เนื้อหาทั่วไป: 14px บน desktop, line-height 1.65, letter-spacing 0.005em; mobile เพิ่มเป็น 15px และ line-height 1.7
- ชื่อสินค้า: 14px/600/line-height 1.55 บน desktop และ 15px/line-height 1.6 บน mobile ใช้สี `--ink`
- ราคาขาย: 16px/700 บน desktop และ 17px บน mobile ใช้สี primary พร้อม tabular numerals; ราคาทุนลดลำดับชั้นเป็น 13px/500 และสี muted
- form controls รับ font และ spacing จากระบบเดียวกัน เพื่อไม่ให้ browser fallback ทำให้ข้อความไทยสูงไม่เท่ากัน
- การเปลี่ยนแปลงเป็น CSS/presentation เท่านั้น ไม่มี Firestore read/write, schema หรือ API contract เพิ่มเติม

## UI Consistency Audit (Tables, Icons, Modals)

- ตารางถูกจำแนกตามจำนวนคอลัมน์อัตโนมัติ: ตารางไม่เกิน 5 คอลัมน์ใช้ความกว้างตามเนื้อหาและชิดซ้าย ส่วนตารางตั้งแต่ 9 คอลัมน์รักษาความกว้างคอลัมน์และเลื่อนแนวนอนแทนการบีบข้อความ
- Product Listing แก้ `colgroup` ให้จำนวนและลำดับตรงกับ header รวมคอลัมน์ Part Number แล้ว
- เพิ่ม local inline SVG icon system และ runtime upgrader สำหรับ markup เดิม ทำให้ emoji ที่ผู้ใช้มองเห็นถูกแทนด้วย line icon ขนาดมาตรฐาน โดยไม่เรียก icon CDN และไม่เปลี่ยนข้อความสำหรับ screen reader
- Add/Edit modal ใช้ viewport-safe max height, body scroll ภายใน, stable scrollbar gutter และ overscroll containment; mobile แสดงเป็น bottom-aligned sheet โดย footer ยังเข้าถึงได้
- การเปลี่ยนแปลงทั้งหมดเป็น presentation/client-side enhancement ไม่เพิ่ม Firestore reads/writes และไม่เปลี่ยน API contract

## Product Table Custom Views

- Master Product ใช้ `PRODUCT_COLUMNS` เป็นแหล่งข้อมูลเดียวสำหรับ colgroup, header, body และ dynamic colspan
- มี preset งานขาย, งานจัดซื้อ, งานคลัง และข้อมูลครบ พร้อมบังคับรหัสสินค้า ชื่อสินค้า และคอลัมน์จัดการ
- ค่า visible columns และ page size บันทึกใน `localStorage` โดยแยก key ด้วย authenticated username; ไม่ sync ข้ามอุปกรณ์ตามขอบเขตที่อนุมัติ
- Mobile ที่ยังไม่มี preference เริ่มด้วยชุดย่อ รหัส/ชื่อ/ราคาขาย/คงเหลือ/จัดการ
- Global search, Excel-style filter และ sort ยังใช้ข้อมูลทุก field แม้ field ถูกซ่อน
- Export CSV ส่งออกทุก field ที่ใช้งาน ไม่ขึ้นกับ visible columns และป้องกัน spreadsheet formula injection เบื้องต้น
- การเปลี่ยน view, preset, page size และ export ทำจาก cache ฝั่ง client: Firestore reads เพิ่ม 0, writes เพิ่ม 0 และไม่มีการเพิ่ม `Ui_Preferences` หรือแก้ schema
