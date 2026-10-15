# SYY-Shop — Production Version 96, 16 October 2026

## ผลการเผยแพร่

ผู้ใช้สั่ง `deploy เลย` หลังรับสรุป Hybrid Cache จึงอัปเดต Deployment เดิมจาก Version 93 เป็น **Version 96** เมื่อ **16 ตุลาคม 2569 เวลา 06:31 Asia/Bangkok** ตามเวลาที่ Google แสดง

- Runtime commit: `3860e9d9b2036efda231cc72e25b0d5678f2a1d2`.
- Project: [SYY-Shop Apps Script Editor](https://script.google.com/home/projects/16P76qalO_UL1fqbI6mjSDPz0MwUI82f0ZlEXrGkvOsGdCRINM05CuORP/edit).
- Deployment ID เดิม: `AKfycbydnft6V1Fxlm6fm09ySlRwb0-cODawOWGhfMmOLyTsl-7Gyki-qwT_I97CEROTwqHS`.
- [Production URL เดิม](https://script.google.com/macros/s/AKfycbydnft6V1Fxlm6fm09ySlRwb0-cODawOWGhfMmOLyTsl-7Gyki-qwT_I97CEROTwqHS/exec).
- คง execution identity `shopsyy01@gmail.com` และ access `ทุกคน`; ไม่แก้ app roles/credentials/OAuth scopes.
- Description: `main 3860e9d: hybrid cache, bounded product cursor, cache quality and backup checkpoint repair`.

ไม่ได้สร้าง URL ใหม่หรือสั่งเปลี่ยน Deployment URL อื่น รุ่น 95 ที่เป็นอีก URL ไม่ใช่เป้าหมายของรอบนี้

## ตรวจ Source ก่อน/หลัง Deploy

1. Fetch `origin/main`, ไม่มี divergence; release whitelist **24 ไฟล์**, commit ตรง, `sourceDirty:false`, checksum verification ผ่าน
2. อ่าน Source เดิมทั้ง 24 ไฟล์ผ่าน Apps Script UI และเก็บสำเนาใน ignored local evidence; ทุกไฟล์ตรงกับ target หรือ Git history ที่มีอยู่ ไม่พบ unknown manual edits
3. เทียบกับ Head ก่อน Sync: **15 ไฟล์ต่าง / 9 ไฟล์เหมือน** อัปเดตเฉพาะ 15 ไฟล์ที่ต่าง เก็บชื่อ backend บน Apps Script เป็น `รหัส.gs` ตามเดิม (`Code.gs` ใน Git)
4. Apps Script แสดง Save ช้า/มี generic reload error ระหว่างเปิด Editor ครั้งหนึ่ง จึงคงสำเนาทั้งสองรุ่นและตรวจจาก Editor ใหม่ รอ Save จบแล้วอ่าน Head จากเซิร์ฟเวอร์ซ้ำ **24/24 ตรงกับ release** ไม่ใช้เพียง editor buffer เป็นหลักฐาน
5. หลัง Google แสดง deployment success เปิด Manage deployments ยืนยัน persisted Version 96, ID/URL และ execution/access เดิม
6. เปิด Project History เลือก **Version 96** อ่าน immutable Source ครบ **24/24 ไฟล์** และเปรียบเทียบ normalized SHA-256 กับ release ตรงทั้งหมด (normalize CRLF → LF และ trailing newline)

ไฟล์ที่ Sync เทียบ Head เดิม: `Code.gs`, `Master_Brands.html`, `Master_Cars.html`, `Master_Categories.html`, `Master_Customers.html`, `Master_Products.html`, `Master_Tax_Invoice.html`, `Master_Vendors.html`, `Master_Zones.html`, `Profile.html`, `Purchase_Orders.html`, `Quotation.html`, `Shared.html`, `XLFilter.html`, `index.html`.

จึงเปิดใช้ทั้งงาน Hybrid Cache และงานใน main ที่รอ Deploy ก่อนหน้านี้ รวม cache quality/read efficiency และ Backup checkpoint repair ดู [Hybrid audit](HYBRID-CACHE-2026-10-16.md), [Cache quality](CACHE-QUALITY-2026-10-15.md) และ [Backup repair](BACKUP-TIMEOUT-FIX-2026-10-15.md).

## Verification

- Local implementation checks ของ runtime เดิม: **205/205 automated tests**, **103/103 Browser groups**, **69 scripts/manifest syntax**, diff check ผ่าน ไม่มี runtime code edit เพิ่มในรอบ Deploy จึงไม่ได้รัน local suite ซ้ำโดยไม่มีการเปลี่ยน Source
- Release package verification ผ่าน และ published-version checksums ตรงครบ 24 ไฟล์
- เปิด `/exec` จริงในแท็บใหม่ พบหน้า Login มีชื่อผู้ใช้/รหัสผ่าน/ปุ่มเข้าสู่ระบบ ไม่พบ ReferenceError หรือ template/include text ค้างบนหน้า ไม่กรอกหรือ submit application credentials
- **Authenticated UAT ยังไม่รัน**: Viewer/Staff/Admin, product cursor, IndexedDB ใน HtmlService sandbox, search/filter/write/concurrency ต้องทดสอบด้วย existing test session/บัญชีจริงที่เหมาะสมต่อไป
- **ไม่ได้วัด Production billed Reads หรือ latency**; 99.49% ในรายงาน Hybrid เป็น fixture เฉพาะ product documents ของการเปิดหน้าปกติ ไม่ใช่ผล billing หลัง Deploy

## Backup และผลกระทบ DB

ตรวจ Trigger table แบบ read-only หลังเผยแพร่: มี **หนึ่ง Trigger `dailyBackupJob_`**, แสดง Version **96** โดยตาม Deployment เดิมอัตโนมัติ ไม่ต้องแก้หรือติดตั้ง Trigger ใหม่

รายการล่าสุดที่แสดงเป็น **15 ตุลาคม 2569 22:02:30** ก่อน rollout และ historical error rate ยัง **100%** จึงไม่ถือว่า Backup repair ผ่าน Production แล้ว รอบนี้ไม่ได้กด Backup/Resume/Restore หรือลบไฟล์ Backup ต้องรอผล scheduled run ใหม่/manifest ที่ครบถ้วนก่อนยืนยันสำเร็จ

การ Sync/Deploy และ smoke ก่อน Login ไม่เรียก business RPC, ไม่ทำ DB migration/index/IAM/role change, ไม่บันทึกสต๊อก/เอกสาร/ข้อมูลทดสอบลง Production การติดตั้ง Source ใหม่ทำให้โค้ดทำงานตาม read/cache/backup behavior ที่ผ่าน local tests แต่ไม่ใช่หลักฐานว่าธุรกรรมจริงหรือ Backup จริงผ่านแล้ว

## Evidence / rollback

Ignored local evidence อยู่ใน `test-results/deploy-3860e9d-2026-10-16/`: `before/`, `saved-head/`, `version-96/`, checksum inventories, history comparison, `deployment-result.json`, deployment success/config screenshots, production login และ trigger screenshot ไม่มี artifacts/Source snapshot เหล่านี้ถูกเพิ่มเข้า Git

หากต้อง rollback ให้แก้ **Deployment ID เดิม** กลับ Version 93 หลังผู้ใช้อนุมัติ แล้วให้ client reload แบบประสานกัน Source Head/Triggers ควรตรวจให้สอดคล้องด้วย Version 93 ไม่รวม Backup repair ล่าสุด ไม่มี schema migration ของรอบนี้ให้ย้อน DB ห้าม restore DB เพียงเพื่อ rollback UI/cache code

งานคงเหลือ: authenticated UAT, first successful Backup run, staging recovery/concurrency, live billing/latency measurements และ Atomic Delta/search-index งานที่ยังไม่ implement ตาม Hybrid report
