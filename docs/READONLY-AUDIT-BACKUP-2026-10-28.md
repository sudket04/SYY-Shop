# ผลตรวจระบบจริงแบบอ่านอย่างเดียว และแพตช์ต่อจาก b6609c2

ต่อจาก [implementation รอบแรก](PERFORMANCE-STOCK-CORRECTION-2026-10-28.md) บน `main` baseline `b6609c28afab40e95eadb1268d0862a99d28eeaf` ผู้ใช้ยืนยันว่าไม่มี Staging และอนุญาตอ่านผ่านระบบเดิม แต่ห้ามเขียน แก้ไข หรือลบ DB จริง

ผลตรวจรอบถัดไป29ต.ค.อยู่ใน [Source/Executions audit](SOURCE-EXECUTIONS-AUDIT-2026-10-29.md): เพิ่ม read-only year getter, integration12หน้า และประวัติ Backupย้อนหลัง11 executions เนื้อหาด้านล่างเป็นผลรอบ28ต.ค. ไม่ใช่ baseline ใหม่หลัง Deploy

## ขอบเขตที่ดำเนินการจริง

- อ่าน Apps Script Executions, Cloud log ของงานเดิม และรายการชื่อไฟล์/โฟลเดอร์ Backup ใน Drive เท่านั้น
- แท็บเว็บ Production อยู่หน้า Login จึงไม่ได้สั่ง Login หรือเรียกเมนูธุรกิจด้วย session ใหม่ การ Login มีผลเขียนข้อมูลบัญชี/กิจกรรม จึงรอ session ที่ผู้ใช้เปิดใช้งานไว้แล้ว
- **ไม่ได้ Sync/Deploy, รัน Backup/Restore จริง, แก้ Trigger, อ่านเนื้อหาไฟล์ secrets, หรือเขียนข้อมูล DB** การทดสอบธุรกรรม/Restore ด้านล่างใช้ข้อมูลจำลองในหน่วยความจำทั้งหมด
- ไม่เปลี่ยนวิธีค้นหา/XLFilter, collection/schema, indexes, Rules, IAM, สิทธิ์ผู้ใช้ หรือเลขบิลย้อนหลัง

## หลักฐานจากระบบจริง

Executions ล่าสุดที่มองเห็น 50 รายการ ณ รอบตรวจนี้ ไม่ใช่ข้อมูลการใช้งานทั้งวัน:

| Handler | จำนวน | p50 | p95 | สูงสุด | เกิน 10 วินาที |
|---|---:|---:|---:|---:|---:|
| `apiGateway` | 37 | 5.735s | 20.125s | 23.217s | 7 |
| `doGet` | 9 | 1.496s | 1.678s | 1.678s | 0 |
| `authLogin` | 3 | 4.875s | 5.754s | 5.754s | 0 |
| `dailyBackupJob_` | 1 | 360.807s | 360.807s | 360.807s | 1 — timed out |

งาน Backup ที่พบเป็น **Version 100** เริ่ม 28 ต.ค. 2569 เวลา **22:02:30** และ Cloud log เวลา **22:08:31** ระบุ “เวลาประมวลผลเกินขีดจำกัดสูงสุด” ไม่มี stack/phase ที่ยืนยันว่าค้างตรงฟังก์ชันใด จึงแยกข้อเท็จจริงนี้จากสาเหตุที่จำลองใน Source ได้

ตัวเลขเป็นเวลา handler ที่ Google แสดง รวมทั้งคำขออ่าน/เขียนที่ผู้ใช้อื่นทำไว้ก่อนหน้า ไม่ใช่ click-to-usable-data รายหน้า ไม่รวมเวลาวาด UI/เครือข่ายทั้งหมด และไม่ใช่ผลหลังลงแพตช์นี้ ห้ามนำไปอ้างว่าทุกหน้าเร็วขึ้นแล้ว หรือคำนวณ billed Reads/Writes จากจำนวน execution

Drive ปลายทางที่ผู้ใช้กำหนด:

- พบ Full วันที่ 13, 14, 15, 16, 18 และ 25 ต.ค. การมีโฟลเดอร์ไม่ได้ยืนยันว่าเป็น Full ที่สมบูรณ์ทั้งหมด
- run วันที่ 25 ต.ค. `full_22-02-49_d3356274-194b-4236-bd5f-11d4d42a0738` มี 18 โฟลเดอร์ collection, 4 checkpoint files, `index.json`, `manifest.json`, `script-properties.json`
- โฟลเดอร์ `Incremental` ว่างหลังโหลดรายการเสร็จ
- ตรวจเพียง metadata ไม่เปิดเนื้อหา `script-properties.json` และไม่ได้ตรวจ checksum ของชุดจริง จึง **ยังรับรองความกู้คืนได้ของ Full วันที่ 25 ไม่ได้** จำนวน Full ที่ตรวจว่ากู้คืนได้/เงื่อนไขเก็บ 4 รุ่นยังต้องยืนยันต่างหาก

## Root cause ที่ตรวจและแก้ใน Source

| จุด | สิ่งที่พิสูจน์ได้ | การแก้ |
|---|---|---|
| POS เปิดหน้าแล้วว่างจาก cache | HTML/Shared เรียก backend จริงผ่าน gateway จำลองได้ `notModified:true` จาก IndexedDB แต่ `loadProducts()` return ก่อนนำแถวไปแสดง ทั้งที่ `products` ยังว่าง | ข้าม render เฉพาะเมื่อหน้านั้นมีสินค้าอยู่แล้ว; initial validated cache ต้องนำมาแสดง คงการตรวจ session/version เดิม |
| ค้นหา subcollections ของ Backup | ช่วงค้นลูก 100 parent documents เดิมวนหลาย `fetchAll` จนพ้น slice โดยไม่มีจุดพักระหว่าง wave; จำลอง 60s/wave แล้วล้มเหลวก่อนแก้ | เก็บ discovery queue/page token ใน checkpoint ทำครั้งละไม่เกิน 20 parent requests ต่อ wave แล้วพัก/ทำต่อ ไม่อ่านหน้าข้อมูลที่เสร็จแล้วซ้ำ |
| เริ่ม Incremental | เดิม materialize/ตรวจ prior Full+delta ทั้ง chain ก่อนสร้าง checkpoint; จำลอง 60s/part แล้วเกิน deadline | verifier ที่พักได้ระหว่าง manifest/part ตรวจ checksum, paths, duplicate/deletion, index/counts และ properties ครบก่อนเริ่ม DB snapshot ใหม่; เก็บ digest map แทนสำเนา business rows อีกชุด |
| Snapshot ระหว่างรอตรวจชุดเดิม | การใช้เวลาไปกับ Drive verification ทำให้อายุ snapshot สำหรับ DB สั้นลง | เริ่ม readTime หลังตรวจต้นทางเสร็จ ข้อมูลใหม่ระหว่าง verification จึงรวมใน snapshot ใหม่; DB capture ยังคงอายุสูงสุดเดิม |
| Full วันอาทิตย์กับ daily delta | delta ที่พักได้อาจถูกตีความว่าตารางวันนี้เสร็จแล้ว; retention อาจกินเวลาก่อนสร้าง delta | ส่งต่อ scheduled marker ข้าม Full → delta → continuation; ตั้ง marker สำเร็จเมื่อ delta สมบูรณ์เท่านั้น ทำ retention หลัง delta และไม่วนตรวจ retention เพิ่มทุกวัน Incremental |
| สถานะ Backup | ผู้ใช้อาจเข้าใจว่าขั้นตรวจชุดเดิมกำลังอ่าน DB ใหม่แล้ว | แสดง phase `verify` และข้อความตรวจ checksum ก่อนอ่าน DB ชุดใหม่; capture progress/error/polling เฉพาะ modal เดิมยังทำงาน |
| Retention/ตัวตรวจ synchronous | ตรวจไฟล์/ACL ต่อเนื่องโดยไม่มี deadline checks ย่อยเพียงพอ | ตรวจ deadline ก่อนแต่ละ part และระหว่างตรวจสิทธิ์; หากเวลาไม่พอคืน warning ไม่รายงาน pruning สำเร็จ ไม่ลบชุดที่ยังไม่ผ่านการตรวจ |

ใช้ handler `continueBackupJob_` และกลไก one-off continuation เดิมใน Source ไม่ได้ติดตั้ง Trigger จริงเพิ่ม โครงสร้าง Backup schema v3 และ checkpoint v1 ยังเดิม มี regression ให้ checkpoint เดิมที่ไม่มี discovery queue ทำต่อได้

การจำลอง reproductions ที่ล้มเหลวก่อนแก้ใช้ fixture เท่านั้น ไม่ใช่ข้อพิสูจน์ phase ของงานจริงที่ timeout; การเรียกบริการภายนอกครั้งเดียวที่นานมากยังทำให้เกิน execution limit ได้ และ retention อาจคืน warning จึงไม่รับรอง Backup สำเร็จบน cloud จนกว่าจะตรวจการทำงานจริงหลัง Deploy ที่อนุมัติ

## ผลทดสอบและ Firestore impact

- Unit **271 ผ่าน** รวม Backup 35 tests และกรณี stock correction ข้ามเที่ยงคืน Bangkok, เปลี่ยนเฉพาะราคา/เหตุผลไม่เขียน stock, Full/Restore counter/audit/replay protection ใน DB จำลอง
- Browser regression **131 กลุ่มผ่าน** รวม Backup verification/capture/paused status และหยุด polling เมื่อปิด modal
- เพิ่ม `npm run test:browser-backend`: **5 กลุ่มผ่าน** ใช้ HTML + Shared + `apiGateway` + workers จริงกับ Firestore/Drive ในหน่วยความจำ; session validation และ activity logging เป็น fixtures ไม่ใช่ UAT ของ Google
- 5 Viewer pages บนสินค้า 10,000 รายการใช้ cold query ร่วมกัน: 51 returned product documents รวม lookahead, ไม่อ่าน metadata รูปสำหรับตาราง; การกลับหน้า 1/2 ไม่อ่าน product docs เพิ่ม และยังอยู่หน้าที่ผู้ใช้เลือก
- ค้นบาร์โค้ดของรายการสุดท้ายและ facets ครบชุดสำเร็จ คง substring/filter เดิมซึ่ง cold path ยังอาจอ่าน catalog ทั้งหมด
- Tax list ไม่รอ catalog ของ editor; เมื่อเปิด editor จึงโหลด catalog และ seed IndexedDB จากข้อมูลที่ server ยืนยัน POS รับ `notModified:true` แล้วแสดง 10,000 สินค้าจาก snapshot นั้น **โดยไม่อ่าน product docs เพิ่ม** เมื่อ revoke session ใน fixture จะไม่แสดง catalog จาก disk
- `npm run check`: **70 scripts + manifest ผ่าน**; `npm run test:reads` และ `git diff --check` ผ่าน
- Browser tests ทั้งสองแบบบล็อก network ภายนอกและไม่เชื่อม Production ชุด backend bridge ปฏิเสธ write RPC และตรวจว่าไม่มี Firestore commit/patch/delete

**รอบนี้ไม่มีการเขียน DB จริง** Source แก้ Backup ทำเพียง Firestore reads และเขียน JSON/checkpoint/properties/continuation ใน Drive/Apps Script เมื่อมีการเปิดใช้ภายหลัง; ไม่เขียนเอกสาร Firestore ไม่คัดลอกรูป ไม่มี schema/index เพิ่ม

Incremental ยังต้องสแกนข้อมูล DB ทั้ง snapshot เพื่อจับเอกสารที่เปลี่ยน/หาย เพราะไม่ได้เปลี่ยนเป็น change feed ดังนั้นไม่อ้างว่าแพตช์ Backup ลด billed Reads เป็นเปอร์เซ็นต์ จุดพักช่วยลดการเริ่มใหม่ทั้งงานและ verifier ลดการ materialize แถวซ้ำ แต่เพิ่ม/เก็บ checkpoint Drive ตามจำนวน slice ส่วน POS fix รับข้อมูลที่ยืนยันแล้วจาก cache โดยไม่เพิ่ม read เพื่อแก้หน้าว่าง

ผลลด returned documents/JSON จาก `test:reads` เป็นแบบจำลองของชุดก่อนหน้าที่รัน regression ซ้ำ ไม่ใช่ % ผลเพิ่มของแพตช์นี้ และยังไม่มี Firebase billed usage baseline ที่เทียบโหลดการใช้งานได้

## ไฟล์และสถานะส่งมอบ

- Runtime: `Code.gs`, `StockIssue.html`, `index.html`
- Tests/commands: `tests/backup.test.cjs`, `tests/stock-corrections.test.cjs`, `tests/browser.cjs`, `tests/browser-backend.cjs`, `package.json`
- Reports: เอกสารนี้, `docs/CODEX-HANDOFF-2026-10-28.md`, `docs/PERFORMANCE-STOCK-CORRECTION-2026-10-28.md`
- ไม่รวมไฟล์เดิมของผู้ใช้ `docs/SYSTEM-AUDIT-2026-10-11.md`, credentials, clasp, dependencies, test artifacts หรือ release bundles ใน commit

Source ส่งที่ `main` ตามคำสั่งถาวร ดู SHA จาก commit ของเอกสารนี้ใน Git; เตรียมและตรวจ checksum review bundle 24 ไฟล์หลัง commit โดยไม่ Sync/Deploy ผลตรวจระบบจริงข้างต้นยังเป็น runtime ก่อนแพตช์

## งานค้างที่ยังต้องดำเนินการ

1. รอ session ที่เข้าสู่ระบบไว้แล้วเพื่อวัด click-to-usable-data แบบอ่านอย่างเดียวทุกเมนู แยก cold/warm/กลับหน้า/หน้า 2, p50/p95/max และ auth/RPC/decode/render **ยังยืนยันทุกหน้า ≤10 วินาทีไม่ได้**
2. ขออนุมัติ Deploy ชุดรวมหลัง review, เทียบ Editor Head ที่อาจเปลี่ยนด้วยมือและ immutable published version คง URL/สิทธิ์/Trigger เดิม การอัปเดต GitHub ไม่ใช่การอนุมัติ Production
3. หลัง Deploy ที่อนุมัติ ให้ตรวจ Backup execution/checkpoint/manifest ใหม่และ retention warnings เพื่อยืนยันว่ามี Full/delta ครบจริง การตรวจครั้งนี้ไม่สั่งรัน Backup/Restore หรือแก้ตารางจริง
4. ไม่มี Staging: write UAT รวมขาย/แก้บิล/Restore ยังพิสูจน์ได้เฉพาะ local ต้องมีขอบเขตใหม่ก่อนทดสอบที่เขียนข้อมูลจริง ห้ามถือคำอนุญาตอ่านว่าอนุญาตเขียน
5. Read/Write monitoring ต้องมี billed usage และจำนวนผู้ใช้/ธุรกรรม/รอบ Backup ที่เทียบกันได้; ไม่มีการสร้าง automation เพิ่มหรืออ้างเปอร์เซ็นต์ที่ไม่วัด
6. หาก cold Dashboard/POS ยังเกินเป้าจริง ให้ review durable snapshot/materialized summary เป็นงานแยกตาม handoff ไม่สร้าง storage/Trigger หรือ business writes ใหม่ในแพตช์นี้
