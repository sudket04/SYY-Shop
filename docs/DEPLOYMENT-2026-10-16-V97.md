# Production Version 97 — 16 October 2026

ผู้ใช้อนุมัติ “ดำเนินการแก้ไขและ deploy เลย” หลังเคยพัก Deploy งาน `fc02367` จึงเผยแพร่ทั้งงาน Pagination/ลดโหลดซ้ำ และการยกเลิก polling ตามเวลาในชุดเดียวกัน

## ผลการเผยแพร่

- **Deployment 96 → 97 สำเร็จ** เมื่อ **16 ตุลาคม 2569 เวลา 18:26 Asia/Bangkok** ตามเวลาที่ Google แสดง
- Runtime commit: `b6e2d40d4bd3cb9195d225ac6e10c28e9cc60c7a` รวม `fc02367fb48b21ccd026eff983bb0fd919dcbe15`
- [Production URL เดิม](https://script.google.com/macros/s/AKfycbydnft6V1Fxlm6fm09ySlRwb0-cODawOWGhfMmOLyTsl-7Gyki-qwT_I97CEROTwqHS/exec)
- [Apps Script project เดิม](https://script.google.com/home/projects/16P76qalO_UL1fqbI6mjSDPz0MwUI82f0ZlEXrGkvOsGdCRINM05CuORP/edit)
- Deployment ID เดิม: `AKfycbydnft6V1Fxlm6fm09ySlRwb0-cODawOWGhfMmOLyTsl-7Gyki-qwT_I97CEROTwqHS`
- Execution/access คงเดิม: `shopsyy01@gmail.com` / ทุกคน ไม่มีการเปลี่ยน OAuth scopes หรือสิทธิ์ผู้ใช้
- Description: `main b6e2d40: manual/change-driven refresh, faster tables and stable pagination (includes fc02367)`

## ตรวจ Source และผลทดสอบ

1. สำรอง Head จาก Apps Script ผ่าน Editor ครบ **24 ไฟล์** ตรวจตรงกับ Source ของ Version 96 ทุกไฟล์ จึงไม่ทับการแก้ด้วยมือที่ไม่ทราบที่มา
2. ตรวจ release package `review-b6e2d40d4bd3-a4c49760-eca7-4016-839e-b2a7ad98a9c7` ผ่าน: 24 files, sourceDirty=false
3. Sync เฉพาะ **14 ไฟล์ที่เปลี่ยน** และตรวจ clipboard/readback ก่อน Save; `รหัส.gs` ใน UI ตรงกับ `Code.gs` ใน Git
4. รอ Google บันทึกเสร็จ แล้วโหลด Editor ใหม่ อ่าน server Head ซ้ำ **24/24 ตรงกับ release**
5. หลัง deployment success เปิด Manage deployments ใหม่ ตรวจ persisted Version 97, URL และ execution/access เดิม
6. เปิด Project History เลือก immutable **Version 97** อ่าน Source ครบ **24/24 ตรงกับ release** ใช้ SHA-256 โดย normalize CRLF → LF และละเฉพาะ newline ท้ายไฟล์
7. Reload Production URL หน้า Login แสดง username/password/ปุ่มเข้าสู่ระบบตามปกติ ไม่มีการส่งรหัสผ่านหรือทำธุรกรรมจริง
8. ตรวจ Trigger แบบอ่านอย่างเดียว: ยังมี **1 time-driven trigger `dailyBackupJob_`** หน้า Google แสดง Version 97 ไม่มีการติดตั้ง/แก้/ลบ Trigger หรือรัน Backup ใหม่ในงานนี้

Local regression: **209/209 tests**, **106/106 Browser groups**, **69 scripts/manifest syntax**, diff check ผ่าน พร้อมทดสอบซ้ำกรณีเดินเวลา 5 นาทีโดยติดตั้ง clock ก่อน navigation: ไม่มีคำขอเพิ่มจากเวลา/focus/กลับ Home; Manual refresh ยังทำงาน

## Files Changed และพฤติกรรมที่เปิดใช้

ไฟล์ที่ Sync: `Code.gs`, `index.html`, `Master_Brands.html`, `Master_Cars.html`, `Master_Categories.html`, `Master_Customers.html`, `Master_Products.html`, `Master_Tax_Invoice.html`, `Master_Vendors.html`, `Master_Zones.html`, `Purchase_Orders.html`, `Quotation.html`, `Shared.html`, `StockIssue.html`

- คงหน้าและตำแหน่งสินค้าเมื่อ refresh/cursor snapshot หมดอายุหรือสต๊อกเปลี่ยน; ป้องกันคำขอซ้อนและการกดเปลี่ยนหน้าระหว่างโหลด
- รักษาข้อมูล/DOM/focus ระหว่างรอและเมื่อข้อมูลไม่เปลี่ยน ลดการโหลดที่ไม่จำเป็นจาก stock delta และ dropdown ของ Viewer
- ยกเลิกการอ่านข้อมูลตาม interval และ focus/visibility; เปิดครั้งแรก, ปุ่มรีเฟรช และเหตุการณ์เปลี่ยนข้อมูลยังทำงาน
- รายละเอียดและข้อจำกัด: [Pagination/performance](PAGINATION-PERFORMANCE-2026-10-16.md), [Manual refresh](MANUAL-REFRESH-2026-10-16.md)

## Firestore Impact และข้อจำกัด

ไม่มี business DB writes, restore/migration, schema/index/Rules/IAM หรือสิทธิ์บัญชีเปลี่ยนในขั้น Deploy นี้ การตรวจสต๊อกจริงและ atomic writes ฝั่ง server คงเดิม

ผลลดคำขอ/จำนวน product reads เป็น local/mock; ยังไม่ได้วัด billed Reads หรือ latency Production หลัง Login การเปลี่ยนจากอีกเครื่องต้องกดรีเฟรชเมื่อไม่มี event ถึงเครื่องนี้ ส่วน substring/XLFilter ที่ซับซ้อนยังอาจอ่านแค็ตตาล็อกครบเพื่อคงผลลัพธ์

ไม่ได้ทำ authenticated UAT หรือรัน Backup/ขาย/รับสินค้าใน Production รอบนี้ ผู้ใช้ที่เปิดเว็บค้างไว้ควร Reload หนึ่งครั้งเพื่อรับ client version ใหม่

หลักฐานในเครื่อง: `test-results/deploy-manual-refresh-2026-10-16/` มี Source ก่อนแก้, saved-head, version-97, checksum reports, deployment config/success, Login และ Trigger screenshots พร้อม `deployment-result.json`
