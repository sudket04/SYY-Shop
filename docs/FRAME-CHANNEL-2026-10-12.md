# SYY-Shop — แก้ frameChannel วันที่ 12 ตุลาคม 2569

## 1. สรุปผลการตรวจสอบ

ดำเนินเฉพาะ `ReferenceError: frameChannel is not defined` ที่ผู้ใช้แจ้ง บน main ต่อจาก `4dab2085a52c0d116b21428e498e15b23c977146` ผู้ใช้ยกเลิกงานปรับ Layout/สีปุ่มตามภาพ ไม่มีการแก้ CSS, สัดส่วนหน้าจอหรือ scroll behavior ในรอบนี้

## 2. Root Cause

HTML 13 หน้าอ้าง `<?= frameChannel ?>` โดยตรงใน meta บรรทัด 4 หากตัวแปรไม่ถูกส่งเข้า template จะเกิด ReferenceError ก่อนส่งหน้าให้ browser พิสูจน์ซ้ำด้วยการประเมิน scriptlets ของ Source โดยไม่กำหนดตัวแปรนี้แล้วได้ error เดียวกัน

doGet ใน main ปัจจุบันกำหนด property นี้อยู่แล้ว แต่เดิมอ่าน `e.parameter.channel` โดยไม่ป้องกัน event/parameters ที่หายไป ไม่ได้เข้าถึง deployment จริงเพื่อยืนยัน revision/เส้นทาง render ที่เกิด error จึงไม่ระบุว่า deployed router เป็นเวอร์ชันใด

Browser fixture เดิมแทน scriptlets ด้วย regex และแทนตัวแปรที่ไม่รู้จักเป็นข้อความ ทำให้ไม่ตรวจพบกรณี missing template variable เปลี่ยนให้ประเมิน top-level scriptlets เพื่อให้ข้อผิดพลาดเช่นนี้ทำให้ tests ล้มเหลว

## 3. ผลกระทบต่อ Module อื่น

แก้ meta ของ shell, Stock Issue, Quote, Invoice, PO, Products, Users และ Master Data ทั้ง 6 หน้า เมื่อได้รับ channel ปกติจะส่งค่าเดิม เมื่อไม่มี channel จะเปิดหน้าได้ แต่ trusted frame messaging ยังคงไม่รับข้อความ ไม่เปลี่ยน origin/source/schema checks, API registry, RBAC, auth/session, business payload หรือธุรกรรมสต๊อก

## 4. แนวทางแก้ไข

- HTML ใช้ `typeof frameChannel === 'string' ? frameChannel : ''` ใน printing scriptlet เพื่อไม่อ่านตัวแปรที่ไม่ถูกประกาศ และคง contextual escaping ของ HtmlService
- doGet อ่าน channel ผ่าน event guard และคง allowlist ตัวอักษร/ความยาว 16–80 ตามเดิม ไม่สร้าง channel ทดแทนใน browser
- เพิ่ม local template evaluator สำหรับ tests; includes ยังคงเป็น raw fragments และไม่ evaluate recursively ตามเส้นทาง include_ เดิม

## 5. ความเสี่ยงและข้อจำกัด

การ fallback เป็นค่าว่างป้องกันหน้า crash แต่ไม่ได้เปิดการส่งข้อมูลข้าม frame โดยไม่มี channel ต้องอัปเดต backend และ HTML revision เดียวกันใน Apps Script เพื่อให้ shell/child handoff ทำงานครบ Local evaluator ตรวจ JavaScript/control-flow/scriptlets ของ repository ไม่ใช่ contextual escaping engine ของ Google และไม่ถือว่า live Apps Script UAT ผ่าน

## 6. Files Changed

18 files:

- `Code.gs`: guard event/parameters ก่อนอ่าน frame channel
- `index.html`, `StockIssue.html`, `Quotation.html`, `Master_Tax_Invoice.html`, `Purchase_Orders.html`, `Master_Products.html`, `Manage_Users.html`: meta fallback
- `Master_Brands.html`, `Master_Categories.html`, `Master_Cars.html`, `Master_Customers.html`, `Master_Vendors.html`, `Master_Zones.html`: meta fallback
- `tests/security.test.cjs`: missing-channel, authenticated routing และ unauthenticated routing regressions
- `tests/support/templates.cjs`: local scriptlet evaluator
- `tests/browser.cjs`: ใช้ evaluator แทนการแทนค่าตัวแปรด้วย regex
- `docs/FRAME-CHANNEL-2026-10-12.md`: รายงานนี้

ไม่รวมไฟล์ untracked เดิม `docs/SYSTEM-AUDIT-2026-10-11.md` หรือ generated test artifacts

## 7. ผลการทดสอบ

- `npm test`: 112/112 ผ่าน รวม Security/Routing 19 เคส (เพิ่ม 3 เคสจากรอบก่อน)
- `node tests/browser.cjs`: 60/60 กลุ่มผ่าน รวม smoke 15 หน้า, trusted frame handoff และการปฏิเสธข้อความที่ไม่เชื่อถือ
- `node tests/syntax.cjs`: 68 scripts และ manifest ผ่าน
- `git diff --check` และ staged whitespace check ผ่านก่อน commit

ทดสอบก่อนแก้พบ ReferenceError ตามที่แจ้ง หลังแก้ทุก channel-aware page ประเมินได้ทั้งเมื่อ channel หายและเมื่อมี channel ถูกต้อง doGet รองรับ event/parameters ที่หายหรือ channel ไม่ถูกต้อง และ unauthenticated/expired sessions ยังส่งไป login ไม่มีการเรียก Production services ในการทดสอบ

## 8. Firestore Impact

ไม่มี Firestore reads/writes/deletes จริง ไม่มี schema/index/rules/IAM migration และไม่เพิ่ม reads/writes ใน business flows การแก้เป็น template rendering และการอ่าน request parameter เท่านั้น ไม่เปลี่ยน getSession หรือสิทธิ์ผู้ใช้

## 9. Commit SHA และ Deployment Status

Implementation SHA คือ commit ที่เพิ่มรายงานนี้ ตรวจด้วย `git log -1 --format=%H -- docs/FRAME-CHANNEL-2026-10-12.md` และ SHA ในข้อความส่งมอบ Commit/Push เข้า main ตามคำสั่งถาวรของผู้ใช้ ไม่ force-push ไม่ sync/deploy Apps Script หรือเปลี่ยน Production data/permissions

## 10. งานคงเหลือ

การแก้ Source และ local regressions เสร็จ ต้องยืนยัน Code.gs/HTML revision เดียวกันใน target Apps Script และทดสอบเปิดหน้า/iframe handoff บนบริการจริงเมื่อมี target และการอนุมัติที่เกี่ยวข้อง งาน Layout ตามรูปถูกยกเลิก ไม่รวมในงานค้างของรอบนี้

หลักการ scriptlets, template properties และ contextual escaping อ้างอิง [Google Apps Script — Templated HTML](https://developers.google.com/apps-script/guides/html/templates)
