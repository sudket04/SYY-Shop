# ผลพัฒนาบิล ประวัติ และ Dashboard — 29 ตุลาคม 2569

## สถานะและขอบเขต

ผู้ใช้สั่ง “ทำต่อ” จากเอกสาร `CODEX-HANDOFF-BILLS-UX-2026-10-29.md` จึงดำเนินการแก้ Source และทดสอบตามขอบเขตในเอกสาร งานนี้ยังไม่ Sync Apps Script และยังไม่ Deploy รอบใหม่ การอนุมัติ Version102 ได้ใช้เสร็จแล้ว

- Runtime commit ของชุดนี้: `715532687293e66d6f3d68be744b8d82732a5a7f`
- ทำงานบน `main` และส่งขึ้น `origin/main` ตาม AGENTS.md
- Production ที่ยืนยันล่าสุดในรายงานเดิม: Version102 / runtime `568ffb474c71cd99d706b476975ee8f715fbd6d0` ไม่ได้ตรวจ immutable version ใหม่ในรอบนี้
- คง Google Apps Script + Vanilla HTML/CSS/JS + Firestore REST + Drive
- ไม่สั่งเขียน แก้ไข หรือลบข้อมูล Production, backfill, Backup/Restore หรือเปลี่ยน Trigger/schema/index/IAM
- Correction คง Admin และบิล OUT active เท่านั้น; IN อ่านรายละเอียดอย่างเดียวตามสิทธิ์เดิม Staff/Viewer ไม่ได้รับสิทธิ์แก้ไขเพิ่ม

## Root cause และสิ่งที่แก้

### หน้าแก้ไขบิล

เดิมตัวแก้ไขเป็นตารางแยกจากตะกร้าปกติ และไม่มีผลรวม/ผลสต๊อกระหว่างแก้จำนวน จึงเทียบผลกับบิลเดิมยาก

- เปลี่ยนเป็นกรอบค้นสินค้าและตะกร้า “รายการที่จะตัดออก” แบบการ์ด เพิ่ม/ลบ SKU, ปุ่ม +/−, กรอกจำนวนทศนิยมและราคาได้ตามสิทธิ์ Admin เดิม
- แสดงจำนวน ยอดขาย ต้นทุน กำไร ผลต่างยอดเดิม และผลสต๊อกก่อน→หลังทันทีจากข้อมูลที่โหลดแล้ว ไม่ส่ง RPC ทุกครั้งที่พิมพ์
- คำนวณ SKU เดิมด้วยต้นทุนที่บันทึกกับบิล ไม่ใช้ต้นทุน Master ปัจจุบันทับ; SKU ใหม่ใช้ catalog เพื่อประมาณการ แล้วตรวจใหม่บน Server
- แยกค่าที่ไม่ทราบจากศูนย์จริง รองรับราคา 0 ปฏิเสธค่าว่าง/NaN/Infinity/รหัสซ้ำ/ยอดเกินขอบเขต
- ปุ่ม “บันทึกการแก้ไข” และ “ยกเลิกบิล” แยกกัน การยกเลิกแสดงรายการเดิมและผลคืนสต๊อก; ลบทุกแถวไม่เปลี่ยนเป็นยกเลิกอัตโนมัติ
- คง server preview, revision, CAS/atomic commit, request ID และการตรวจผลคำขอเดิมเมื่อไม่ทราบผล ไม่ส่ง write ซ้ำอัตโนมัติ
- Notification ที่เปลี่ยนข้อมูลทำให้ preview เดิมใช้ไม่ได้ รวมกรณีเปลี่ยนระหว่างรอคำตอบตรวจผล
- รักษาตะกร้าขายใหม่และ draft เดิม ปุ่ม F4 ขณะอยู่ในตัวแก้ไขไม่ส่งบิลขายใหม่ผิดโหมด
- จอ Desktop แยกค้นหา/ตะกร้า; มือถือวางตะกร้าก่อน ปุ่มท้าย modal อยู่ในจอ ทดสอบ 1365, 390 และ 320px

### ประวัติเข้า–ออกสินค้า

เดิมหนึ่งแถวหมายถึงหนึ่ง movement หากรวมเฉพาะหน้า 50 movement จะได้ยอดบิลไม่ครบ และการรีเฟรชอาจกลับหน้าแรก

- แสดง 6 คอลัมน์: เลขบิล / วันที่–เวลา / ประเภท / มูลค่า / เหตุผล / จัดการ
- รวมตาม Doc_No + ประเภท + รายการย้อนผล ไม่รวมตามข้อความ Bill_No ซึ่งอาจซ้ำ และไม่รวม legacy ที่ไม่มี Doc_No เข้าด้วยกัน
- เติมบรรทัดของบิลที่พบให้ครบก่อนแสดงยอด; ข้อมูลไม่ครบ/ราคาหรือจำนวนหายแสดงขีดพร้อมคำอธิบาย
- แสดงไม่เกิน 50 บิลต่อหน้าจอ ค้นชื่อ/SKU ที่มีในข้อมูล movement ตามขอบเขตเดิม รวมช่องที่ซ่อนไว้ในตารางย่อ
- ขอบเขตยังเป็น 1,000 movement ล่าสุดสำหรับค้นจุดอ้างอิง แล้วเติมบรรทัดทั้งบิลที่พบ ไม่อ้างว่าเป็นประวัติทั้งหมดของระบบ
- ปุ่มดูรายละเอียด/แก้ไข/ยกเลิกแสดงตามสิทธิ์และสถานะ; ข้อมูล metadata ในบิลไม่ตรงกันมีคำเตือนและไม่เปิดแก้ไขอัตโนมัติ
- ถัดไป/ก่อนหน้าจากข้อมูลที่โหลดแล้วไม่ส่ง RPC เพิ่ม รีเฟรชหรือกลับจากบันทึกพยายามคืนหน้าที่เลือก; หากจำนวนบิลลดจนไม่มีหน้านั้นจะใช้หน้าสุดท้ายที่มี
- เก็บตัวค้นหาและหน้าประวัติใน view state ไม่ใช้ผลตอบกลับเก่าทับ generation ใหม่

### Dashboard และข้อมูลบิลร่วม

เดิมรายการบิลแสดงเฉพาะเวลา ไม่มีผู้ทำรายการ ยอดใช้ Math.round และบางหน้ารายละเอียดอิง timezone ของเครื่อง

- ตารางบิลขาย/รับเข้า/ตัดออกแสดงเลขบิล วันที่–เวลาไทย ผู้ทำรายการ มูลค่าในช่วง สถานะ และ Action
- ใช้ผู้ทำรายการที่บันทึกใน transaction ไม่แทนด้วยบัญชีผู้เปิดดู และไม่อ่าน Master_Users เพิ่มทุกบิล
- เรียงล่าสุดก่อน หรือเลือกเรียงยอดมากไปน้อย แสดง 50 แถวต่อหน้าด้วยข้อมูลในเครื่อง
- ใช้เวลา Asia/Bangkok ในตาราง รายละเอียด และประวัติการแก้ไข ทดสอบขอบเดือนเมื่อ Browser อยู่ America/Los_Angeles
- ใช้เงิน 2 ตำแหน่ง คงสูตรยอดสุทธิจาก ledger เดิม รวม cancelled/replaced/reversal และกรณีย้อนผลข้ามเดือน
- ระบุชัดว่ามูลค่าใน Dashboard เป็นของช่วงที่เลือก ส่วนรายละเอียดบิลเต็มเปิดเมื่อเลือก
- ใช้ Bill_No จริงสำหรับแสดงและ Doc_No เดิมสำหรับ lookup; legacy แสดงรหัสจริงพร้อมป้าย “เลขเดิม · ยังไม่ปรับย้อนหลัง” ไม่สร้างเลขย้อนหลังใน Browser
- บิลใหม่คงรูปแบบ `SI-YYYYMMDD-NNNN` ตามระบบ counter เดิม ไม่แก้เลขหรือ ID ที่มีอยู่

## Firestore และประสิทธิภาพ

### วิธีพิสูจน์ยอดทั้งบิลโดยไม่ทำ N+1

`getStockMovementPage({billMode:true})` ใช้ signed cursor และ readTime เดิม:

1. อ่าน candidate page ตามขอบเขตเดิม
2. ใช้ cache ต่อ Doc_No + readTime ที่ผูก generation และอายุ 60 วินาที
3. รวมบิลที่ยังไม่ cache เป็นชุดละไม่เกิน 10 Doc_No ตรวจ COUNT_UP_TO จำนวนบรรทัดที่รู้ + 1 ณ readTime เดียวกัน
4. ถ้าจำนวนเท่ากับ candidate ที่มี แปลว่ามีทุกบรรทัดแล้ว ใช้ข้อมูลเดิมโดยไม่อ่านเอกสารซ้ำ
5. เฉพาะชุดที่มีบรรทัดเกิน candidate จึง query `Doc_No IN [...]` แบบขนานที่ snapshot เดียวกัน
6. จำกัด hydration ไม่เกิน 2,000 document results ต่อ RPC บวก lookahead (สูงสุด 20) และไม่เกิน 1,000 บรรทัดต่อบิลที่จะรับรองว่าครบ ชุดที่ถูกตัดไม่แสดงยอดว่าเป็นบิลเต็ม

สิทธิ์ `billMode` ถูกตรวจฝั่ง apiGateway ให้ Staff ขึ้นไปเหมือน full-detail endpoint เดิม แม้ endpoint แบบ movement ปกติมีสิทธิ์ Viewer อยู่ก่อนแล้ว จึงไม่เปิดทางข้ามสิทธิ์ผ่าน parameter ใหม่

ไม่เพิ่ม polling, collection scan จาก Browser, การ query รายละเอียดทีละแถว หรือ telemetry write ลง DB ตัว representation cache ของ Dashboard เปลี่ยน key รุ่นเพื่อไม่ใช้ payload เก่าที่ขาด flags บอกความครบของราคา/จำนวน

### ผลจำลองที่วัดได้ และข้อจำกัด

Fixture 50 บิล บิลละหนึ่งบรรทัด:

| วิธี | Document results | COUNT requests |
|---|---:|---:|
| UI เดิมระดับ movement ซึ่งยังไม่พิสูจน์ยอดทั้งบิล | 51 รวม lookahead | 0 |
| วิธีอ่านรายละเอียดครบแยกทุกบิล | 101 | 0 |
| ชุดนี้ เมื่อ cache เย็น | 51 | 5 |
| เรียก worker ซ้ำเมื่อ cache บิลอุ่น | เพิ่ม 51 candidate | เพิ่ม 0 |

Browser/page/conditional cache อาจเลี่ยงการเรียก worker ซ้ำได้อยู่แล้ว แต่ไม่อ้างว่าค่า 51 ในแถวสุดท้ายเป็นศูนย์ ส่วนบิลหลายบรรทัดข้ามหน้าจำเป็นต้องอ่านเพิ่มเพื่อให้ยอดถูกต้อง

COUNT มีค่าใช้จ่าย: โมเดลนี้มี aggregation reads อย่างน้อย 5 หน่วยตามเงื่อนไข pricing ไม่ใช่อ่านฟรี และยังไม่รวม auth/ค่า index/ค่า query อื่นที่เกิดจริง จึง **ไม่สรุปเปอร์เซ็นต์ Reads ลดทั้ง Production** เทียบกับ UI เดิมที่ไม่พิสูจน์ยอดครบ การประหยัดหลักคือไม่อ่านเอกสารซ้ำเมื่อ candidate ครบ และไม่ทำ detail query รายบิล

อ้างอิงหลักที่ตรวจขณะออกแบบ: [Firestore queries](https://firebase.google.com/docs/firestore/query-data/queries), [runQuery/readTime](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/runQuery), [runAggregationQuery/upTo](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/runAggregationQuery), [pricing](https://firebase.google.com/docs/firestore/pricing)

## ผลทดสอบ

| การตรวจ | ผล |
|---|---|
| `npm test` | 286/286 ผ่าน |
| Browser regression ทั้งระบบ | 140/140 กลุ่มผ่าน; ตรวจ 5 กลุ่ม Bill UX ซ้ำหลังเก็บงานรายละเอียดและ pagination |
| Browser เชื่อม backend/gateway จริงในเครื่อง | 10/10 กลุ่มผ่าน ด้วย fixture ไม่มี Production network/DB |
| `npm run check` | 70 scripts และ manifest ผ่าน |
| `npm run test:reads` | ผ่าน โมเดล document results/COUNT/transport ไม่ใช่ใบแจ้งค่าใช้จ่ายจริง |
| `git diff --check` | ผ่าน |

ครอบคลุมบิลข้าม movement page, snapshot เก่าเมื่อข้อมูลเปลี่ยน, cache invalidation, count/query failure, บิลเกินเพดาน, Viewer parameter bypass, ราคา0/ข้อมูลหาย/overflow, ตะกร้าเดิม, preview stale, retry/reload, Admin/Staff/Viewer และ ledger/reversal ข้ามเดือน

หลักฐานใน `test-results/` เป็น ignored local artifacts ไม่รวมใน Git: unit/browser/backend/read model logs และ screenshots ของ editor, history และ Dashboard

## ตรวจเว็บจริงและงานที่ยังค้าง

- ใช้แท็บที่มี session เดิมและมีข้อมูลหน้าตัดสต๊อกอยู่แล้ว คลิกประวัติแบบอ่านอย่างเดียว จากนั้น UI แจ้ง session หมดอายุ ไม่ส่ง Login form หรือธุรกรรมเขียนเพื่อทดสอบ
- แท็บเดิมอาจโหลดก่อน deployment เดิม จึงไม่ใช้เป็นหลักฐานรับรอง runtime ใหม่หรืออาการของ Source ชุดนี้
- ยังไม่มี authenticated UAT ของ Source ชุดนี้ และยังรับรองเป้าหมายทุกหน้าไม่เกิน 10 วินาทีหรือเปอร์เซ็นต์ Reads/Write จริงไม่ได้
- รออนุมัติ Sync/Deploy รอบใหม่ก่อนใช้งาน Source นี้จริง เมื่ออนุมัติต้องเทียบ/เก็บ Source เดิม ตรวจ saved Head และ immutable published version ให้ตรง review bundle ครบ 24 ไฟล์ คง URL/สิทธิ์/Trigger เดิม
- หลัง Deploy ตรวจ Login smoke และอ่านทุกเมนูผ่าน session ที่ผู้ใช้เปิดไว้แล้ว แยก cold/warm และเวลา UI พร้อมออกจากเวลา business data พร้อม
- การทดสอบแก้/ยกเลิกบิลจริง การเปลี่ยนเลขย้อนหลัง งาน Backup และการติดตั้ง monitor เป็นคนละขอบเขต ไม่ได้ดำเนินการแฝงในชุดนี้
- ก่อน backfill ต้องมี mapping/hash/counter-impact review และอนุมัติเขียนข้อมูลย้อนหลังแยก บิลเก่าจึงยังไม่ได้เปลี่ยนเลขให้เป็นมาตรฐานทั้งหมด

## Files changed

- `Code.gs`: complete-bill read worker, role guard, DTO knownness และ Dashboard cache format
- `Shared.html`: labels/date/status/grouping/live totals, unknown-value safeguards และรายละเอียดบิล
- `StockIssue.html`: editor cards, live estimates, history summary/pagination/view state และ preview invalidation
- `index.html`: Dashboard bill tables/date/actor/status/local paging
- `tests/bill-ux.test.cjs`, `tests/browser.cjs`, `tests/browser-backend.cjs`, `tests/read-model.cjs`, `tests/support/services.cjs`: regression และ read model
- `package.json`: รวม unit tests ใหม่
- เอกสารผลพัฒนาและ handoff ฉบับปรับสถานะ

Review bundle: `test-results/releases/review-715532687293-4df7b20d-b596-43b8-a1d9-7bba015f5bd8` ตรวจครบ 24 ไฟล์, sourceDirty=false, deployed=false

รักษา untracked เดิม `docs/SYSTEM-AUDIT-2026-10-11.md` ไว้นอก commit
