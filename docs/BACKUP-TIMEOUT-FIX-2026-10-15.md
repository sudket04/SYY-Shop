# Backup timeout repair — 15 October 2026

## สาเหตุที่ยืนยันจากระบบจริง

ตรวจ Apps Script Executions และ Triggers ผ่านหน้า Google ของโปรเจกต์ `16P76qalO_UL1fqbI6mjSDPz0MwUI82f0ZlEXrGkvOsGdCRINM05CuORP` โดยไม่ได้แก้ Source หรือเรียก Backup จริงระหว่างตรวจ:

- `dailyBackupJob_` วันที่ 13 ต.ค. เวลา 22:02:30 ล้มเหลวหลัง 273.008 วินาที
- วันที่ 14 ต.ค. เวลา 22:02:30 ล้มเหลวหลัง 275.278 วินาที
- Log ล่าสุด: `Backup ไม่สำเร็จ: Backup เกินเวลาที่ปลอดภัย ไม่เผยแพร่ชุดข้อมูลที่อ่านไม่ครบ` ที่ `dailyBackupJob_` ใน `รหัส.gs:2677`
- มี Trigger `dailyBackupJob_` หนึ่งตัว แสดง Version 93 และ Error 100% จึงไม่ใช่กรณีไม่มี Trigger

Source เดิมกำหนดเวลาปลอดภัย 270 วินาที แต่ต้องอ่านทั้ง DB และค้นหา subcollections ให้เสร็จในครั้งเดียว เมื่อทำไม่ทันจะทิ้งชุดที่ยังไม่ครบ รอบต่อไปจึงเริ่มใหม่และอ่านข้อมูลเดิมซ้ำ การเพิ่มเวลาอย่างเดียวไม่แก้ข้อจำกัดนี้

Executions ยังพบ `doGet` ของ Version 95 ด้วย จึงไม่สรุปว่า Web App ทุก URL ใช้ Version 93 หรือว่า Head ตรงกับ Git ปัจจุบัน

## การแก้ไข

- `Code.gs`: บันทึก checkpoint หลังจบแต่ละช่วงประมาณ 180 วินาที แล้วสร้าง one-off `continueBackupJob_` เพื่อทำต่อหลังอย่างน้อยหนึ่งนาที ใช้ readTime, page cursor, index, parts และคิว subcollections เดิม
- Checkpoint อยู่ในโฟลเดอร์งาน Backup เดิมบน Drive ส่วนตัว พร้อม checksum ส่วน Script Properties เก็บเพียงตัวชี้และสถานะ ไม่ใส่ข้อมูล DB หรือคีย์ลับลงตัวชี้
- เผยแพร่ `manifest.json` และเลื่อน baseline เฉพาะเมื่ออ่านครบ ตรวจ Script Properties/TOTP key และเงื่อนไขเดิมผ่าน งานที่ยังไม่ครบไม่ปรากฏเป็น Backup สำเร็จ
- เน็ตหรือบริการขัดข้องระหว่างทำต่อจะเก็บ checkpoint ให้กดทำต่อได้ และตารางรายวันสามารถรับช่วงงานที่ค้างได้ สำเนาที่สำเร็จก่อนหน้ายังคงอยู่
- Snapshot เก่ากว่า 50 นาทีจะถูกยกเลิกอย่างชัดเจน เพื่อไม่อ่านข้อมูลต่างเวลากัน ตารางรายวันเริ่มชุดใหม่หลังทิ้งเฉพาะงานที่ไม่ครบและหมดอายุ
- Full ที่เริ่มตามตาราง เมื่อเสร็จผ่าน Trigger หรือปุ่มทำต่อ จะสร้าง daily Incremental จาก snapshot เดียวกันและค่อยบันทึกว่าวันนั้นสำเร็จ ไม่มีการสแกน DB รอบที่สอง
- เก็บ Full 4 รุ่นและ Incremental ตามสายเดิม แยกวันที่ ใช้โฟลเดอร์ปลายทางเดิม และไม่คัดลอก binary รูป ตรวจ ACL/owner/โครงสร้างโฟลเดอร์เดิมก่อนทำต่อ ไม่เพิ่ม OAuth scope หรือเปิด RPC ใหม่
- `index.html`: แสดงจำนวนที่อ่าน สถานะกำลังทำต่อ/พักงาน และปุ่มทำต่อ ไม่แจ้งสำเร็จสำหรับผล `pending` ตรวจสถานะทุก 30 วินาทีเฉพาะเมื่อหน้าต่าง Backup เปิดอยู่

หากบันทึก baseline ไม่สำเร็จหลังสร้าง manifest แล้ว จะเก็บชุดที่ครบและ baseline ก่อนหน้า แต่ล้างตัวชี้งานเดิมเพื่อไม่สร้าง manifest ซ้ำ ผลลัพธ์ยังแจ้งข้อผิดพลาด ไม่อ้างว่ารอบตามตารางเสร็จแล้ว

## ผลกระทบต่อ Firestore / บริการอื่น

- การแก้นี้ไม่เขียน/ลบข้อมูล Firestore ไม่ทำ migration ไม่แก้ index/IAM/role และไม่เปลี่ยนขั้นตอนขาย/รับสินค้า ใช้ UserLock เดิม ไม่ยึด ScriptLock ของธุรกรรมร้านค้า
- ทั้ง Full และ Incremental ยังต้องอ่าน snapshot ทั้ง DB เพื่อค้นพบ collection ใหม่และตรวจ deletion อย่างครบถ้วน การแบ่งช่วงลดการอ่านใหม่ตั้งแต่ต้นเมื่อเกินเวลา ไม่ได้เปลี่ยนเป็น change feed และยังไม่สามารถอ้างเปอร์เซ็นต์ลด billed Reads ของระบบจริง
- การทดสอบแบบหลายช่วงยืนยันว่าไม่อ่าน page ที่ checkpoint สำเร็จแล้วซ้ำ หากบริการขัดข้องก่อน checkpoint อาจอ่านซ้ำเฉพาะงานหลัง checkpoint ล่าสุด
- มีไฟล์ checkpoint และ Trigger ชั่วคราวเพิ่ม ใช้ Drive/UrlFetch/Properties/Trigger quota เดิม งานที่ยาวมากจนเกินอายุ snapshot หรือ quota รายวันยังอาจล้มเหลวอย่างปลอดภัย ต้องวัดจริงหลัง rollout
- Overview อ่านสถานะจาก Properties/Drive ไม่สแกน DB ธุรกิจ แต่ RPC ผ่านการตรวจ session ตามเดิม
- ไม่แตะไฟล์รูปต้นฉบับ Backup เก่า หรือ Trigger งานอื่น ทำความสะอาดเฉพาะ continuation ของ Backup และยังคงนโยบาย retention เดิม

## การตรวจสอบ

- `npm test`: **182/182 ผ่าน** รวม Backup 27 tests, Security, integrity, recovery, cache, catalog 10,000 รายการ และ release
- `npm run test:browser`: **91/91 groups ผ่าน** ด้วย Chromium และ gateway จำลอง ปิด external HTTPS
- `npm run check`: **69 scripts/manifest ผ่าน**
- `git diff --check`: ผ่าน

กรณีใหม่ครอบคลุมหลาย checkpoint, late writes, cursor/snapshot เดิม, Incremental/deletion, กดทำต่อของงานตามตาราง, missed Trigger, snapshot หมดอายุ, checksum เสีย, ย้ายโฟลเดอร์, network/trigger quota/state write failure, ไม่เผยแพร่ partial manifest, ไม่แก้ DB และหยุด polling เมื่อปิดหน้าต่าง รูปหน้าจอทดสอบอยู่ใน ignored `test-results/backup-checkpoint-status.png`

## สถานะส่งมอบและการเปิดใช้

Runtime ที่แก้ใน Git รอบนี้มี **2 ไฟล์: `Code.gs`, `index.html`** อีก 3 ไฟล์เป็น tests/fixture พร้อม README และรายงานนี้ ไม่รวม untracked `docs/SYSTEM-AUDIT-2026-10-11.md`

ยังไม่ได้ sync Source, เปลี่ยน Deployment, แก้ Trigger หรือรัน Backup บน Production ในรอบนี้ ต้องอนุมัติ Production rollout แยกตาม Master Instructions §10 Step 5 ก่อน แล้วจึงตรวจ Source จริงเทียบ package/รักษางานที่ผู้ใช้แก้เอง และยืนยัน URL/รุ่นที่จะอัปเดต ไม่มีการอ้างว่า Backup จริงสำเร็จจากผล fixture

หลัง rollout ให้ตรวจ Execution ต่อเนื่องจนเสร็จ, manifest/counts/checksums, สถานะวันสำเร็จ, Full+Incremental และ Trigger continuation ที่ถูกเก็บกวาด โดยไม่ทดลอง restore ใน Production ตารางเวลาเดิมยังเป็นประมาณ 22:00 Asia/Bangkok และ Full วันอาทิตย์

ข้อจำกัด snapshot อ้างอิง [Firestore ListDocuments REST](https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/list): readTime ปกติต้องอยู่ภายในหนึ่งชั่วโมง ส่วน [Installable Triggers](https://developers.google.com/apps-script/guides/triggers/installable) ทำงานด้วยบัญชีผู้สร้างและอยู่ภายใต้ quota จึงใช้การแบ่งช่วงและตรวจอายุ snapshot แทนการขยาย runtime โดยไม่จำกัด
