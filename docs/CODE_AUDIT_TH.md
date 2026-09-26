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
