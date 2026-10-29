# แก้การเริ่มต้นหน้าและ session ในกรอบซ้อน — 29 ตุลาคม 2569

ผู้ใช้รายงานว่าเมนูทุกหน้าค้างที่ “ยังเปิดหน้าไม่สำเร็จ” หลัง Version101 และแนบ Console ที่เบราว์เซอร์บล็อกการเปลี่ยนหน้าระดับบนแบบไม่มี user activation

## ข้อบกพร่องที่ยืนยันจาก Source และการจำลอง

- ตัวเริ่มต้นหน้าและ PAGE_READY รอ DOMContentLoaded อย่างเดียว หาก host ติดตั้ง script หลัง event นี้ หน้าไม่เริ่มอ่านข้อมูลและ shell ไม่ได้รับ readiness จำลองการติดตั้งช้าแล้วตรวจครบ14หน้า การแก้ใช้ readyState + DOMContentLoaded/load fallback ที่เข้าคิวครั้งเดียว เพื่อรักษาลำดับประกาศตัวแปรและไม่อ่านซ้ำ
- เมื่อ doGet ตรวจ session ไม่ผ่าน จะส่ง Login ที่ไม่มี channel กลับในกรอบเมนู shell จึงแยก session หมดอายุออกจาก network timeout ไม่ได้ การแก้ส่งกลับเฉพาะ channel ที่ตรวจรูปแบบแล้ว และ SESSION_EXPIRED โดยยังไม่ render template หรือข้อมูลที่ต้องยืนยันตัวตน
- RPC auth failure พยายามเปลี่ยน window.top หลัง Promise/timer ซึ่งขัดข้อจำกัด sandbox การแก้แสดงลิงก์ Login ที่ผู้ใช้คลิกได้ พร้อมรักษาร่างและล้าง cache เดิม แทนการเปลี่ยนหน้าที่ถูกบล็อก

ข้อจำกัดหลักฐาน: Browser ของ Codex ยังอยู่หน้า Login จึงยังไม่ยืนยันว่ากรณีใดเป็นตัวกระตุ้นใน session จริงของผู้ใช้ ไม่อ้างว่าผ่าน authenticated UAT หรือรับรองเวลาโหลดจากผลจำลอง

ข้อกำหนด sandbox อ้างอิง [Google HtmlService restrictions](https://developers.google.com/apps-script/guides/html/restrictions) การแก้ไม่เพิ่ม allow-top-navigation หรือใช้ wildcard postMessage

## ผลกระทบและทดสอบ

- ไม่เปลี่ยน query, TTL, schema, indexes, Rules, IAM หรือสิทธิ์ผู้ใช้ ทุก business read ยังผ่าน apiGateway และ server authorization
- ไม่เพิ่ม polling/auto retry หรือ business RPC จาก readiness; callback เริ่มต้นทำงานครั้งเดียวทั้ง lifecycle ปกติและติดตั้งช้า
- DB Production: ไม่มีการเขียน แก้ไข หรือลบ ไม่ Login/ส่งธุรกรรมจริง ไม่รัน Backup/Restore หรือแก้ Trigger
- Unit **279/279**, Browser **133/133** กลุ่ม และเพิ่ม cross-origin wrapper regression อีก **1/1** กลุ่ม; backend-integrated browser **9/9** กลุ่ม ด้วย Firestore จำลอง
- Syntax70 scripts/manifest และ diff whitespace ตรวจผ่าน หลักฐาน `test-results/2026-10-29-frame-*.log`

ไฟล์ runtime: Code.gs, login.html, UiSystem.html, Shared.html, index.html และ initializer ของ13หน้าอื่น Deployพร้อมตัวแก้ไขประวัติแล้วใน [Version102](DEPLOYMENT-2026-10-29-V102.md) ตรวจ saved/published Sourceตรง24/24ไฟล์และเส้นทางLogin/sessionใช้ไม่ได้บนเว็บจริงผ่าน โดยไม่ส่งLoginหรือเขียนDB
