# SYY-Shop — UI, Viewer และรายละเอียดประวัติสต๊อก (12 ตุลาคม 2569)

## 1. ผลลัพธ์
ปรับกรอบข้อมูลให้กึ่งกลางและจำกัดความกว้างตามประเภทหน้า เพิ่มระยะห่าง เส้นขอบและเงาอ่อน ใช้ Noto Sans Thai / Inter พร้อมขนาดตามลำดับความสำคัญ Viewer เปิดจัดการสินค้าเพื่อค้นหา กรองและดูรายละเอียดได้แบบอ่านอย่างเดียว ประวัติเข้า–ออกแสดงเลขรายการที่คลิกดูข้อมูลทั้งรายการได้

## 2. Root Cause
หน้าข้อมูลหลักที่มีคอลัมน์น้อยเคยยืดเต็มจอ ทำให้ชื่อและปุ่มจัดการห่างกันมาก ตัวอักษรหลัก/ป้ายข้อมูลบางจุดเล็ก และ shell แสดงหัวข้อ/เวลาอัปเดตซ้ำกับ iframe สิทธิ์ getAllProducts ฝั่ง server อนุญาต Viewer อยู่แล้ว แต่เมนู Products และ mobile nav ปิดทางเข้า ส่วนปุ่มเพิ่ม/แก้ไข/ลบไม่ได้แยกตาม role ประวัติสต๊อกมี Doc_No ในข้อมูลที่บันทึกและ DTO อยู่แล้ว แต่ไม่ได้แสดงหรือเปิดรายละเอียด

## 3. ผลกระทบต่อ Module
Styles และ UiSystem ครอบคลุมหน้า shell, ข้อมูลหลัก, สินค้า, เอกสาร, สต๊อก, Profile และ Users ปรับ data-syy-layout บนแต่ละหน้าเพื่อให้ความกว้างคงที่ตามประเภทข้อมูล ไม่เปลี่ยนตามจำนวนแถวหรือผลกรอง เมนู Viewer เปลี่ยนเฉพาะ Products การสร้าง/แก้ไขสินค้ายังใช้ staff/admin และการลบยังใช้ admin ตาม gateway เดิม ไม่แก้บัญชีผู้ใช้จริง

## 4. วิธีแก้
กำหนด compact 1040px, standard/Users 1360px, workspace 1560px, Products 1800px และ Profile 1000px โดยหดตาม viewport อัตโนมัติ ปรับ body 15px, ตาราง desktop 14px, หัวตาราง 12.5px, หัวหน้า 17px และป้ายรายละเอียด 12.5px คงราคาสินค้าที่เด่นและตัวเลขแบบ tabular ซ่อนหัวข้อซ้ำของ shell เมื่อเปิดหน้าลูก โดย mobile nav และการกลับ Dashboard ยังทำงาน

Products แสดงป้ายอ่านอย่างเดียวและปุ่มดูข้อมูลให้ Viewer ซ่อนปุ่มเขียนข้อมูลทั้ง toolbar/แถว/empty state ไม่เปิด edit draft และ guard ทางเข้าการแก้ไข รูปภาพ บาร์โค้ดและการลบ ฝั่ง gateway ยังคงเป็นด่านบังคับสิทธิ์จริง Staff ไม่เห็นปุ่มลบที่ server ไม่อนุญาตอยู่แล้ว

เพิ่ม getStockMovementDetail ผ่าน gateway สำหรับ staff/admin ใช้ Doc_No EQUAL เพื่ออ่านเฉพาะบรรทัดของเลขรายการที่คลิก รวมบรรทัดที่อยู่นอกประวัติล่าสุด 1,000 บรรทัด แสดงชื่อ/รหัสสินค้า จำนวน สต๊อกก่อน–หลัง ราคาขายที่บันทึก ยอดรวม เวลา ผู้ทำ เหตุผล อ้างอิง ใบเสนอราคาและหมายเหตุ Cache รายละเอียดและคำขอที่กำลังทำงานในหน้านั้น ล้างเมื่อรีเฟรช ป้องกันผลตอบกลับเก่าทับรายการใหม่ รองรับ retry และ Escape พร้อมปิดทาง F4 ทำรายการขณะเปิดรายละเอียด

## 5. ความเสี่ยงและขอบเขต
CSS กลางมีผลหลายหน้า จึงตรวจ desktop/mobile และ regression เอกสาร/พิมพ์/ร่าง/คีย์บอร์ด รายละเอียดเป็น read-only และ escape ค่าข้อมูลทั้งหมด ข้อมูลเดิมไม่มี Doc_No แสดงเฉพาะบรรทัดที่เลือก ไม่สร้างเลขหรือเดาการจัดกลุ่ม ราคาที่ไม่มีหรือไม่ถูกต้องแสดงว่าไม่ได้บันทึก ราคาศูนย์ที่บันทึกจริงยังแสดง 0 ได้

รายการ stock issue และรับสินค้าในระบบปัจจุบันจำกัด 200 บรรทัด รายละเอียดอ่านสูงสุด 1,001 เอกสารเพื่อจับข้อมูลเดิมที่เกินขนาด หากเกิน 1,000 จะแจ้งว่าไม่ครบและระบุยอดเฉพาะบรรทัดที่แสดง ไม่มี backfill หรือ migration

## 6. Files Changed
- UI กลาง: Styles.html, UiSystem.html
- หน้าสินค้าและเมนู: Master_Products.html, index.html
- ประวัติและ server: StockIssue.html, Code.gs
- กรอบหน้าข้อมูลหลัก: Master_Brands.html, Master_Categories.html, Master_Zones.html, Master_Cars.html, Master_Vendors.html, Master_Customers.html
- กรอบเอกสาร/บัญชี: Master_Tax_Invoice.html, Purchase_Orders.html, Quotation.html, Profile.html, Manage_Users.html
- Regression: tests/browser.cjs, tests/security.test.cjs, tests/ux.test.cjs
- รายงานฉบับนี้ ไม่รวม untracked audit เดิมหรือ generated test/release files

## 7. การทดสอบ
ตรวจด้วยข้อมูลจำลองในเครื่อง ไม่เรียก Production: backend/security/integrity/audit/recovery/release/UX 115/115 รายการ, syntax และ manifest 68 scripts, browser 66/66 กลุ่ม รวม 15 routes ผ่านทั้งหมด

กรณีใหม่ตรวจ Viewer desktop/mobile ดูสินค้าได้และไม่เกิด write RPC แม้เรียก handler ตรง, staff/admin editing เดิม, document number search, รายละเอียดทั้งรายการที่อยู่นอก history page, ราคาศูนย์/ราคาหาย/ราคาเสีย, ไม่มีเลขเก่า, invalid input ก่อน query, HTTP failure, เกินขนาด, cache/in-flight dedupe, stale response, retry, injection, Escape/F4 และเก็บตะกร้าเดิม ตรวจกรอบ 12 หน้าที่ 1920px/320px และ modal รายละเอียดที่ 1920/1365/800/390/320px ตรวจภาพ brands หลัง scroll และรายละเอียด desktop/mobile

Regression เดิมครอบคลุม Firestore atomic stock/receipt, concurrency/retry/idempotency, role/session revocation, รูปภาพ/ร่าง, focus/modal/select, frame handoff, ปฏิทินไทย, ประวัติเอกสาร/การค้นหา/CSV และใบเสนอราคา/ใบกำกับหลายหน้า A4 Browser ใช้ mock gateway และไม่โหลด CDN ภายนอก จึงยังต้อง smoke test font/CDN และ deployment จริงเมื่อ sync รุ่นนี้

## 8. Firestore Impact
UI/font และการเปิดเมนูไม่เพิ่ม reads/writes ในแต่ละโหลดหน้าเดิม รายการสินค้าใช้ bootstrap/RPC เดิม ประวัติเริ่มต้นใช้ query เดิมและ DTO เพิ่มฟิลด์จากเอกสารที่อ่านอยู่แล้ว

คลิกรายละเอียดครั้งแรกเพิ่ม 1 targeted query อ่านเฉพาะเอกสารที่ Doc_No ตรงกัน สูงสุด 1,001 เอกสาร พร้อมการตรวจ session ตาม gateway เดิม การเปิดเลขเดิมซ้ำหรือคลิกซ้ำระหว่างโหลดใช้ cache/in-flight เดิม ไม่เพิ่ม RPC จนรีเฟรช ไม่มี collection scan เพิ่ม ไม่มี writes/deletes ไม่มี schema/rules/IAM/index configuration เปลี่ยน Query อาศัย single-field index มาตรฐานของ Doc_No และแสดงข้อผิดพลาดหาก environment จริงไม่พร้อม ไม่ได้วัด billing หรืออ้างเปอร์เซ็นต์ประหยัด

## 9. Commit และ Deployment
Commit/Push main ตามคำสั่งถาวร SHA คือ commit ที่เพิ่มรายงานนี้ ส่งมอบ source bundle ที่ตรวจ checksum หลัง commit โดยเครื่องมือ release เดิม ไม่รวม credentials ไม่มี Apps Script sync หรือ Production deployment และไม่มีการเปลี่ยนข้อมูล Production

## 10. คงเหลือ
อัปเดต Source ใน Apps Script ให้เป็นรุ่นเดียวกัน แล้วทดสอบด้วยบัญชี Viewer/staff/admin ที่ Test deployment: login, Products read-only, ประวัติเลขรายการจริง/ข้อมูลเดิม, mobile nav, font, scroll และเอกสารก่อน rollout ที่ได้รับอนุมัติ การเพิ่ม getStockMovementDetail ต้องอัปเดต Code.gs พร้อม StockIssue.html และการตั้งความกว้างต้องอัปเดต UiSystem/Styles พร้อมหน้าที่ระบุ เก็บเวอร์ชันก่อนหน้าไว้ rollback
