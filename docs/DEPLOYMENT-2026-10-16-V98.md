# Production Version 98 — 16 October 2026

ผู้ใช้อนุมัติ “deploy ทั้งหมดเลย” จึงเผยแพร่งาน Version-first cache และการแก้บัค POS/Dashboard ทั้งชุด

## ผลการเผยแพร่

- **Version 97 → 98 สำเร็จ** เมื่อ **16 ตุลาคม 2569 เวลา 23:50 Asia/Bangkok** ตามเวลาที่ Google แสดง
- Runtime commit: `cfafa3eaf39e1012aa7b65d2460e0997e321db86` รวมงาน `8374896`
- [Production URL เดิม](https://script.google.com/macros/s/AKfycbydnft6V1Fxlm6fm09ySlRwb0-cODawOWGhfMmOLyTsl-7Gyki-qwT_I97CEROTwqHS/exec)
- [Apps Script project](https://script.google.com/home/projects/16P76qalO_UL1fqbI6mjSDPz0MwUI82f0ZlEXrGkvOsGdCRINM05CuORP/edit)
- Deployment ID: `AKfycbydnft6V1Fxlm6fm09ySlRwb0-cODawOWGhfMmOLyTsl-7Gyki-qwT_I97CEROTwqHS`
- Execution/access คงเดิม: `shopsyy01@gmail.com` / ทุกคน ไม่เปลี่ยน OAuth scopes หรือสิทธิ์บัญชี
- Description: `main cfafa3e: version-first refresh, scoped product cache, POS context and dashboard cache age`

## การตรวจรับ

1. สำรอง Source จริงผ่าน Editor **24 ไฟล์** ก่อนแก้ ตรวจตรงกับ immutable Version 97 ทุกไฟล์ ไม่มีการแก้ด้วยมือที่ถูกทับ
2. ตรวจ release package `review-cfafa3eaf39e-40e7f955-a89d-4803-a384-402269afbfa4`: 24 files, sourceDirty=false
3. Sync เฉพาะ **8 ไฟล์ที่เปลี่ยน** ตรวจ readback ก่อนบันทึก; ชื่อ `รหัส.gs` ใน UI ตรงกับ `Code.gs`
4. เปิด Editor ใหม่จาก server และอ่าน saved Head **24/24 ตรงกับ release**
5. Google แสดง deployment success: Version 98 และ URL เดิม
6. เปิด Project History เลือก immutable **Version 98** อ่าน Source **24/24 ตรงกับ release** ด้วย SHA-256 หลัง normalize CRLF → LF และละเฉพาะ newline ท้ายไฟล์
7. เปิด Production URL: หน้า Login แสดงชื่อผู้ใช้ รหัสผ่าน และปุ่มเข้าสู่ระบบตามปกติ ไม่มี ReferenceError ที่หน้าเริ่มต้น ไม่ส่งรหัสผ่านหรือทำธุรกรรมจริง
8. ตรวจ Trigger แบบอ่านอย่างเดียว: ยังมี **1 time-driven trigger `dailyBackupJob_`** หน้า Google แสดง Version 98; ประวัติเรียกใช้ล่าสุด 16 ต.ค. 22:02:30 และ historical error rate 75% ไม่ได้รัน Backup ใหม่ จึงไม่อ้างว่า Backup ผ่านหลัง Deploy

ผล local regression ก่อน Deploy: **219/219 tests**, **112/112 Browser groups**, syntax **69 scripts/manifest**, diff check ผ่าน ไม่ใช่ authenticated Production UAT หรือผลวัด latency/billing จริง

## Files Changed และผลที่เปิดใช้

`Code.gs`, `Master_Products.html`, `Master_Tax_Invoice.html`, `Purchase_Orders.html`, `Quotation.html`, `Shared.html`, `StockIssue.html`, `index.html`

- Manual refresh ตรวจ Version ก่อนอ่านข้อมูลซ้ำ; notifications/dirty activation ไม่เริ่มโหลดข้อมูลเอง
- Cache หน้าสินค้าใน IndexedDB ตาม Session/role และ field allowlist พร้อม invalidation ตาม Dataset และป้องกันคำตอบเก่าทับคำตอบใหม่
- รักษาหน้าเอกสารเมื่อข้อมูลไม่เปลี่ยน และลดการส่ง catalog ซ้ำใน Dashboard
- POS คงหมวดหมู่ หน้ารายการและ DOM เมื่อ refresh unchanged; เมื่อหมวดหมู่ที่เลือกไม่มีแล้วจะกลับไปทั้งหมด
- Dashboard แยกเวลาโหลดข้อมูลกับเวลาตรวจ Cache โดยไม่ต่ออายุ snapshot จากการ reuse
- การค้นหา/XLFilter/Export ใช้ชุดเดิม รายละเอียดและข้อจำกัด: [Version-first cache](VERSION-FIRST-CACHE-2026-10-16.md)

## Firestore และข้อจำกัด

ไม่มีการเขียน business data, restore/migration หรือเปลี่ยน schema/index/Rules/IAM ในขั้น Deploy ไม่มีการติดตั้งหรือเปลี่ยน Trigger และไม่ได้เรียก Backup/ขาย/รับสินค้า การเปิด Login และการตรวจ Source ไม่ยืนยัน workflow หลัง Login

Cache ยังมี hard expiry และตรวจสิทธิ์ผ่าน gateway; การแก้ตรงจาก Console/external writers อาจไม่เปลี่ยน generation จึงไม่รับรอง realtime การค้นหา/กรองซับซ้อนและ cold Dashboard/POS ยังอาจโหลด catalog ครบ ไม่มีเปอร์เซ็นต์ Reads/ความเร็วทั้งระบบ Production ที่วัดจริง

ผู้ที่เปิดเว็บค้างไว้ควร Reload หนึ่งครั้งเพื่อรับ client version ใหม่ Rollback ใช้ Version 97 ผ่านการอนุมัติ deployment ไม่ต้องย้อนข้อมูล DB

หลักฐาน local: `test-results/deploy-cache-cfafa3e/` มี Source ก่อนแก้, saved-head, immutable version-98, checksum reports, deployment success และ Production Login
