# ตรวจ Source / Executions ต่อ — 29 ตุลาคม 2569

Baseline `44607c159047553a3e16d4ee51a2722ec36836c2` ต่อจาก [รายงานวันที่ 28](READONLY-AUDIT-BACKUP-2026-10-28.md) ผู้ใช้ยืนยันว่า session ยังไม่พร้อม ให้ตรวจ Source และ Executions ต่อ ไม่มี Staging และห้ามเขียน แก้ไข หรือลบ DB จริง

**รอบนี้ไม่ได้ Login, เรียก business API บน Production, Sync/Deploy, รัน Backup/Restore หรือแก้ Trigger/สิทธิ์/ข้อมูลจริง** อ่านเฉพาะ Executions และ Cloud logs เดิม ส่วนการทดสอบทั้งหมดต่อไปนี้ใช้บริการ/ข้อมูลในหน่วยความจำ

## สิ่งที่พบและแก้เพิ่ม

การทดสอบ HTML → Shared → `apiGateway` → worker จริงในเครื่องพบว่า การอ่านใบเสนอราคาอาจเขียน DB โดยไม่ผ่านคำสั่งบันทึก:

1. `getQuotationAvailableYearsUncached_()` พบ `Meta_Counters/quotation_years` เป็น 404
2. เรียก `seedQuotationYearsMeta_()` ซึ่งดึงใบเสนอราคาทั้ง collection พร้อมทุก field เพื่อหาปี
3. เรียก `updateQuotationYearsMeta_()` ทีละปี ทำ `fsCommit_()` สร้าง/เพิ่ม metadata และ invalidate Quotation cache ระหว่างคำขออ่านเอง

อาการนี้เกิดตามเงื่อนไข metadata หาย ไม่ได้ยืนยันว่า metadata ของ Production ปัจจุบันหาย การจำลองกับ Source ก่อนแก้ทำให้ read-only browser suite ตรวจพบ Firestore commit หลังเปิดหน้า จึงไม่สั่งเปิดหน้านี้ในระบบจริงเพื่อพิสูจน์

แพตช์ใน `Code.gs`:

- Getter ที่ metadata หายหรือ `Years` ว่างใช้ `discoverQuotationYears_()` ซึ่ง **อ่านอย่างเดียว** คงผลเรียงปีเก่าจากใหม่ไปเก่าและ cache เดิม 120 วินาที
- Query `Quote_Date` ล่าสุดด้วย `limit:1` และ projection เฉพาะวันที่ แล้วข้ามไปก่อนวันที่ 1 มกราคมของปีนั้น ทำซ้ำเฉพาะจำนวนปีจริง โดยใช้ `readTime` เดียวกัน ไม่ใช้ offset และไม่ดึงรายการสินค้า/ลูกค้า/รายการในบิลมาเพื่อหาปี
- จำกัดตามช่วงปีที่ระบบรองรับเดิม พ.ศ.2400–3000; ถ้าพบวันที่ legacy ผิดรูปแบบ ใช้ projected scan เฉพาะ `Quote_Date` เพื่อคงพฤติกรรมเดิมที่ข้ามวันที่ผิด ไม่ทิ้งปีที่ถูกต้องหรือเขียนแก้ข้อมูลเอง กรณีนี้ยังอ่านจำนวนมากได้
- การสร้าง/เติม metadata ย้ายไปเส้นทางบันทึกใบเสนอราคาที่มีอยู่แล้วเท่านั้น: เมื่อตัว metadata หาย/ว่าง ให้รวมปีเก่าและปีที่เพิ่งบันทึกในหนึ่ง commit; หากชน concurrent create ใช้ array union รักษาปีของอีกคำขอ ไม่ทับ field อื่น
- ถ้า metadata มีข้อมูลแล้ว ใช้ fast path เดิม ไม่สแกนปีซ้ำทุกครั้งที่บันทึก; ถ้า lookup ล้มเหลวไม่ cache รายการปีที่ไม่ครบ
- ไม่แก้เลขบิลเก่า, รูปแบบค้นหา/XLFilter, สิทธิ์ Viewer, collection/schema/indexes/IAM หรือเปิด migration/backfill จริง

การบันทึกเอกสารที่สำเร็จแล้วแต่เติม metadata ไม่สำเร็จยังใช้ `refreshWarning` เดิม ไม่รายงานว่าเอกสารไม่เคยบันทึกหรือส่งธุรกรรมซ้ำเอง

Query ใช้ projection/limit ตาม [StructuredQuery](https://firebase.google.com/docs/firestore/reference/rest/v1/StructuredQuery) และตรึง snapshot ตาม [`runQuery.readTime`](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/runQuery) ใช้ field วันที่เดียวกับ query รายการที่มีอยู่ ไม่เพิ่ม index ใหม่ในแพตช์นี้ ยังไม่ได้ทดสอบ query ใหม่บน Google จริง

## ผลเปรียบเทียบที่วัดในเครื่อง

เรียก private getter เดิมจาก `git show 44607c1:Code.gs` และ getter ใหม่กับ fixture เดียวกัน: ใบเสนอราคา 1,250 ใบ มี 2 ปี, metadata ยังไม่มี, cache เย็น

| ตัวชี้วัดเฉพาะ getter ปี | ก่อน | หลัง | ความหมาย |
|---|---:|---:|---|
| เอกสาร Quotation ที่คืนจาก DB mock | 1,250 | 2 | ลด **99.84%** เฉพาะ returned documents ในกรณีนี้ |
| คำขอ REST ใน cold call | 8 | 4 | ลด 50%; หลังคือ metadata lookup + 3 queries รวม query สุดท้ายที่ว่าง |
| Firestore commit จากการอ่าน | 2 | 0 | ตัด hidden metadata writes จาก read path |
| ปีที่ได้ | 2569, 2567 | 2569, 2567 | เก็บผลเดิมครบ |
| เปิด getter เดิมซ้ำขณะ cache ยังใช้ได้ | 0 เอกสาร Quotation เพิ่ม | 0 เอกสาร Quotation เพิ่ม | ไม่อ้างเป็นผลเพิ่มใหม่ |

**ไม่ใช่ผลลดค่าใช้จ่ายทั้งระบบหรือเปอร์เซ็นต์เวลาเว็บ** ตัวเลข returned documents ไม่รวม metadata/missing-document read, minimum charge ของ empty query, index-entry billing, session validation และการใช้งานหน้าอื่น [Firestore pricing](https://firebase.google.com/docs/firestore/pricing) ระบุ minimum read แม้ query ว่าง จึงห้ามนำ 99.84% ไปใช้เป็น billed reduction ตรง ๆ หาก metadata มีอยู่แล้ว เส้นทางอ่าน metadata เดิมไม่ได้ประหยัดเพิ่มเท่ากรณีนี้

ไฟล์หลักฐาน local: `test-results/2026-10-29-years-before-after.json`, `2026-10-29-years-reproduction.log`, `2026-10-29-years-final.log` ไฟล์เหล่านี้ไม่รวมใน Git; ตัวเลข/เงื่อนไขสำคัญรวมไว้ในรายงานนี้แล้ว

## Executions จริงย้อนหลัง

กรองเฉพาะประเภท **ตามเวลา** ใน Apps Script ได้ 11 executions ในช่วง 7 วันที่ UI แสดง (22–28 ต.ค.) ทุกแถวระบุ **Version100** ไม่มีการกด Run หรือตั้งค่า Trigger

| วันที่ / เวลาเริ่ม (ไทย) | Handler | วินาที | สถานะ execution |
|---|---|---:|---|
| 28 ต.ค. 22:02:30 | dailyBackupJob_ | 360.807 | timeout |
| 27 ต.ค. 22:02:30 | dailyBackupJob_ | 360.916 | timeout |
| 26 ต.ค. 22:02:30 | dailyBackupJob_ | 360.574 | timeout |
| 25 ต.ค. 22:22:00 | continueBackupJob_ | 360.971 | timeout |
| 25 ต.ค. 22:17:14 | continueBackupJob_ | 189.741 | completed |
| 25 ต.ค. 22:12:13 | continueBackupJob_ | 190.939 | completed |
| 25 ต.ค. 22:07:37 | continueBackupJob_ | 189.462 | completed |
| 25 ต.ค. 22:02:30 | dailyBackupJob_ | 222.020 | completed |
| 24 ต.ค. 22:02:30 | dailyBackupJob_ | 360.877 | timeout |
| 23 ต.ค. 22:02:30 | dailyBackupJob_ | 218.253 | failed |
| 22 ต.ค. 22:02:30 | dailyBackupJob_ | 361.065 | timeout |

รวม timeout 6, failed 1, completed 4 **นับต่อ execution ไม่ใช่ต่อชุด Backup** completed ของงานย่อยไม่ได้ยืนยันว่า Full/delta จบครบ วันที่23 Cloud log เวลา22:06:08 ระบุเพียงข้อผิดพลาดเซิร์ฟเวอร์ทั่วไป ไม่มี phase/stack ที่ระบุสาเหตุได้; วันที่28 log เป็น execution time limit ตามรายงานก่อนหน้า

รูปแบบวันที่25 มี continuation สำเร็จหลายรอบแล้ว timeout แต่ยังสรุปไม่ได้จาก log ว่าค้างใน phase ใด แพตช์ verifier/discovery ใน commit44607c1 ยังไม่ Deploy จึงไม่ใช่หลักฐานว่าแพตช์นั้นทำงานล้มเหลว

รายการ API เดิมที่เปิดดู 23.217s แสดงเพียงชื่อ `apiGateway`; ยังไม่มีชื่อ operation ที่โยงไปเมนูได้ จึงไม่สรุปว่าเป็นหน้า Products หรือเป็น read request โดยเฉพาะ ไม่มีข้อมูล billed Reads/Writes ใหม่มาเทียบก่อน/หลัง

## ต้นทุน Backup ที่ต้องนับเพิ่มใน monitoring

Source ค้น subcollections ของทุก parent เพื่อสำรอง DB ครบ รวมกรณีมี child ที่ไม่ได้กำหนดไว้ล่วงหน้า ค่าอ่านจึงไม่ได้มีแค่จำนวนเอกสารใน JSON ตาม [Firestore pricing — queries other than document reads](https://firebase.google.com/docs/firestore/pricing#queries_other_than_document_reads) การขอ collection IDs คิดเป็น read ต่อ request รวม pagination

จำลอง Full แบบ flat 2 collections รวม100 documents: อ่านเอกสารรวม probe101 results และเรียก `listCollectionIds`101 requests คิดฐานประมาณ202 document reads ก่อนค่าอื่นใน fixture; Firestore writes0 ไม่ใช่ bill ของ Production ข้อมูลอยู่ใน `test-results/2026-10-29-backup-read-model.json`

ไม่ได้ข้าม discovery เพื่อลดต้นทุน เพราะจะเสี่ยงไม่เก็บ subcollections ครบ การเปลี่ยน incremental เป็น change feed หรือใช้ managed export ต้องมี design/ขอบเขต/สิทธิ์เพิ่มเติมแยกจากแพตช์นี้ กลไก checkpoint ลดการเริ่มงานใหม่ซ้ำ แต่ไม่ทำให้การสแกน snapshot และ discovery กลายเป็นศูนย์ read

## การทดสอบรอบนี้

- Unit **275 ผ่าน**, รวม metadata missing/empty, read-only Viewer, วันที่ legacy ผิดรูปแบบ, partial query failure ไม่ถูก cache, save initialization/CAS race และรักษา field อื่น
- Browser regression **131 กลุ่มผ่าน** กับ gateway fixtures
- Backend-integrated browser **9 กลุ่มผ่าน ครอบคลุม12หน้า** ใช้สินค้า10,000รายการ, movements1,200รายการ และ Quotation/Tax/PO อย่างละ125เอกสาร
- Dashboard decode compact movements คำนวณยอดขาย240,000ตาม fixture และ warm reload ไม่อ่าน data docs เพิ่ม; Quotation/Tax/PO โหลดเพิ่มครบ125ไม่มี ID ซ้ำ แล้วแสดง50แถวหน้าสองโดยไม่เด้งกลับ
- PO history เมื่อ product cache เย็นไม่อ่าน catalog และยอด Pending125รวมเอกสารนอกหน้าปัจจุบัน; masters6หน้าแสดงข้อมูลจริงจาก backend mockและใช้ cache เมื่อเปิดซ้ำ
- ทดสอบ POS รับ validated IndexedDB และ revoked session เดิมต่อ ผ่าน; ตรวจทุก request ว่าไม่มี Firestore commit/patch/delete ใน browser read scenarios
- `npm run check`: **70 scripts + manifest ผ่าน**; `npm run test:reads` และ `git diff --check` ผ่าน

Browser bridge ใช้ HTML/Shared/gateway/workers จริง แต่ session validation/activity logging และ Firestore/Drive เป็น fixtures, external network ถูกบล็อก **ไม่ใช่ Google UAT หรือผลยืนยันเวลา ≤10s** การทดสอบ save/CAS เขียนเฉพาะ DB ในหน่วยความจำ

## ส่งมอบและงานค้าง

Files changed: `Code.gs`, `tests/read-efficiency.test.cjs`, `tests/browser-backend.cjs`, เอกสารนี้, `docs/CODEX-HANDOFF-2026-10-28.md`, `docs/READONLY-AUDIT-BACKUP-2026-10-28.md` ส่ง commit ของเอกสารนี้ขึ้น `origin/main` ตามคำสั่งถาวร เตรียม review bundle24ไฟล์และตรวจ checksum โดยไม่ Sync/Deploy

1. รออนุมัติ Deploy ชุดรวมก่อนเปิดใช้จริง ต้องเทียบ Editor Head ที่อาจถูกแก้ด้วยมือและ immutable version คง URL/สิทธิ์/Trigger เดิม
2. session ยังไม่พร้อมตามผู้ใช้ จึงยังวัด click-to-usable-data บน Google รายหน้าไม่ได้ ต้องวัด cold/warm/page2/p50/p95 แยก auth/RPC/decode/render ภายหลัง ห้ามรับรองทุกหน้า ≤10s จาก local fixture
3. บน runtime เดิม หลีกเลี่ยงการใช้หน้า Quotation พิสูจน์ read-only จนลงแพตช์หรือยืนยันเงื่อนไข metadata แล้ว เพราะ getter เดิมอาจเขียน DB ตามสาเหตุที่พบ
4. Backup health ต้องตรวจ executions/manifest/checksum/retention หลัง Deploy ที่อนุมัติ ไม่ใช้สถานะ completed ของ job slice แทนความครบของชุดสำรอง
5. Actual billed Read/Write monitoring, write UAT, historical bill backfill และ cloud Restore ยังไม่ได้ดำเนินการ ไม่มีการสร้าง automation หรือเปลี่ยนโครงสร้าง DB
