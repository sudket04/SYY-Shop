# เลขบิลรายวันและรายละเอียดบิลขาย — 19 ตุลาคม 2569

## ผลที่พัฒนา

เลขแสดงผลของรายการตัดสต๊อกใช้ `SI-YYYYMMDD-0001` ตามวันที่ทำรายการใน Asia/Bangkok (ค.ศ.) เริ่มลำดับใหม่ทุกวัน และขยายเกิน 9999 ได้ เช่น `SI-20261019-10000` รหัส `Doc_No`, movement ID และ request UUID เดิมยังเป็นตัวเชื่อมข้อมูลและป้องกันส่งรายการซ้ำ ไม่เปลี่ยนตามเลขแสดงผล

- เพิ่ม `Bill_No` ใน Stock_Movements และ `Stock_Issue_Bill_No` ในใบเสนอราคาที่เชื่อมโยง บันทึกพร้อมสต๊อก ตัวนับ และตัวจองเลขใน atomic commit เดียว
- ตัวนับรายวันอยู่ใน collection เดิม `Doc_Running_Numbers` (`SI_YYYYMMDD`) ใช้ updateTime/exists precondition ตัวจองอยู่ใน collection เดิม `Doc_No_Reservations` (`SI_BILL__SI_YYYYMMDD_NNNN`) ป้องกันใช้เลขเก่าซ้ำหากตัวนับถูกลบ
- ส่งคำขอเดิมซ้ำได้ผลและเลขเดิม กรณีคำตอบสูญหายให้ตรวจด้วย request เดิม ไม่มีการสร้างเลขใหม่จาก browser หรือสุ่มเลขแทนลำดับ
- หน้าตัดสต๊อก: ผลสำเร็จ ประวัติ ค้นหาทั้งเลขบิลและรหัสเดิม รายละเอียดรายการ แสดงเลขใหม่เมื่อมี
- Dashboard: รายการบิลขายคลิกเลขเพื่อดูรายการสินค้าทั้งบิลจาก equality query ของ `Doc_No` เดิม แสดงราคาที่บันทึกจริง สต๊อกก่อน/หลัง หมายเหตุและผู้ทำรายการ รวมถึงบรรทัดที่ไม่อยู่ในช่วง Dashboard
- ใช้ renderer รายละเอียดร่วมกับ StockIssue; มีสถานะโหลด ลองใหม่ ปิดด้วย Escape กลับโฟกัส และป้องกันคำตอบเก่าเปิดหน้าต่างหลังปิด
- Viewer ยังดูสรุปเดิมได้ ไม่มีปุ่มเปิดรายละเอียดที่ต้องใช้ staff/admin; ไม่เปลี่ยน API registry หรือสิทธิ์บัญชี
- การอ่านเก่าที่ไม่มี Bill_No ยังใช้ Doc_No ได้ ไม่สร้างเลขย้อนหลังจากลำดับหน้า/ตัวกรอง ค่า optional นี้ต้องเติมจริงก่อนประวัติทุกบิลจะเป็นรูปแบบเดียวกัน
- ปรับ version ของผลอ่านที่เกี่ยวข้องเพื่อไม่รับ notModified จาก DTO เก่าที่ไม่มีเลขบิล; แยก key ของ Dashboard snapshot/delta รุ่นใหม่

ไม่มี export บิลขายเดิมในสองหน้านี้ ปุ่ม Export สินค้า Dashboard คงความหมายเดิม ไม่มีการเปลี่ยนเลขใบกำกับภาษี ใบเสนอราคา หรือใบรับเข้า SR

## Files changed

Runtime: `Code.gs`, `Shared.html`, `StockIssue.html`, `index.html`, `Quotation.html`

Checks: `tests/sales-bills.test.cjs`, `tests/browser.cjs`, ปรับ assertion จำนวน metadata writes ที่เพิ่มใน backend/integrity/catalog/read-efficiency tests และเพิ่ม test file ใน `package.json`

## Firestore impact

| การทำงาน | ผลกระทบ |
|---|---|
| ตัดสต๊อกสำเร็จหนึ่งบิล | เพิ่ม targeted counter lookup 1 ครั้งและ metadata document writes 2 ครั้งใน commit เดิม; การใส่ Bill_No ไม่เพิ่มจำนวน movement writes |
| ส่งคำขอเดิมซ้ำ | อ่านรายการเดิมเพื่อตรวจผล; ไม่เพิ่ม counter/reservation/stock writes |
| ทำรายการพร้อมกัน | อาจอ่าน/ลอง commit เพิ่มเมื่อ CAS ชนกัน จำกัดตาม retry เดิม 3 ครั้ง; ไม่สามารถรับประกัน latency เมื่อโหลดสูงโดยไม่มีการวัดจริง |
| เปิดรายละเอียดครั้งแรก | อ่านเฉพาะเอกสารในบิลที่เลือก ไม่อ่านประวัติทั้งหมด; จำกัด 1001 เอกสารและแจ้งหากแสดงไม่ครบ 1000 |
| เปิดรายละเอียดซ้ำ | ใช้ Shared cache ตาม TTL/การยกเลิกแคชเดิม; cache ที่ยังสดไม่เรียก RPC เพิ่ม เมื่อหมดอายุใช้เส้นทางตรวจ version/อ่านจริงตามปกติ |
| เติมเลขย้อนหลัง | อ่าน inventory ครั้งเดียวและ query รายวัน/รายบิล; ต่อบิลเขียนเฉพาะแต่ละ movement alias + ใบเสนอราคาที่เชื่อม + metadata 2 เอกสาร ต้องประเมินจาก preview ก่อนทำจริง |

ไม่มีการลด Read/Write รวมเป็นเปอร์เซ็นต์จากงานนี้ การมีลำดับรายวันที่เชื่อถือได้มีต้นทุน metadata เพิ่ม ตัวเลขข้างต้นไม่รวม session/account reads, retries, index-entry billing หรือค่าใช้บริการจริง ไม่มี polling/trigger ใหม่และไม่มี full-history scan ในเส้นทางตัดสต๊อกปกติ

## แผนเติมเลขย้อนหลัง (ยังไม่รัน Production)

เครื่องมือเหล่านี้เป็น private Apps Script functions ไม่อยู่ใน apiGateway ไม่เรียกจากการเปิดหน้าเว็บ trigger หรือ deploy อัตโนมัติ ต้องอนุมัติชุดข้อมูลและแผนก่อนใช้จริง ห้ามเรียก apply ด้วย hash ที่ยังไม่ได้ตรวจ

1. เตรียม/ตรวจ Backup ที่อ่านคืนได้ บันทึก inventory และ source/deployment ปัจจุบัน กำหนดช่วงหยุดรับรายการสต๊อกโดยตกลงกับผู้ใช้ เพื่อไม่ให้ source รุ่นเก่าสร้างรายการที่ยังไม่มี alias ระหว่าง cutover ไม่เพิ่ม maintenance flag หรือระงับสิทธิ์เอง
2. หลังอนุมัติให้นำ source ไปยัง Editor แต่ยังไม่เผยแพร่ ให้ operator เรียก `inspectSalesBillBackfill_()` ผ่าน wrapper ชั่วคราวใน Editor ดู `project`, รายวัน และ `invalidMovementIds` ขั้นนี้อ่านอย่างเดียว แต่มีค่า reads ตามจำนวนประวัติทั้งหมด หากอ่านไม่ครบจะหยุด
3. เรียก `planSalesBillBackfill_('20261019')` เปลี่ยนวันตาม inventory ตรวจ `entries` (รหัสเดิม→เลขใหม่), `rows`, `quotes`, `counter`, `remaining`, `alreadyAssigned`, `planHash` เก็บแผนที่ตรวจแล้วให้ผู้ใช้อนุมัติ แต่ละครั้งสูงสุด 20 บิล แผนเรียงวัน/เวลาเดิมก่อนรหัสอ้างอิง ไม่ใช้ปี พ.ศ.
4. หลังได้รับอนุมัติ mapping/hash ให้เรียก `applySalesBillBackfill_(day, approvedPlanHash)` เฉพาะแผนนั้น ฟังก์ชันอ่านแผนใหม่และเปรียบเทียบ hash ก่อนเขียน ทุกบิล commit พร้อม counter/reservation แบบ CAS และ field mask เฉพาะ `Bill_No`/`Stock_Issue_Bill_No` ไม่มีการเปลี่ยน Doc_No, ID, ราคา, จำนวน, Timestamp, Committed_At หรือ JSON ผลคำขอเก่า
5. ตรวจ `completed`, `complete`, `message`, `requiresNewPlan` แล้ว preview/อนุมัติส่วนที่เหลือใหม่จนหมดทุกวันที่มี OUT หยุดเมื่อมีข้อมูลข้ามวัน เลขซ้ำ alias ไม่ครบบิล counter ผิดปกติ หรือเอกสารเปลี่ยน ไม่ข้ามข้อผิดพลาดแล้วรายงานว่าเสร็จ
6. ถ้าคำตอบ commit สูญหาย ผล apply อาจระบุว่ายังไม่ยืนยันแม้ DB บันทึกแล้ว ต้องตรวจ DB และสร้างแผนใหม่ บิลที่มี alias แล้วจะไม่ถูกเปลี่ยนเลข ห้ามใช้ hash เดิมรันซ้ำโดยไม่ตรวจ Cache จะถูก invalidate แม้มีเพียงความพยายาม commit
7. ข้อจำกัดที่หยุดให้ตรวจแผนย่อย: เกิน 10,000 movement rows ต่อวัน, เกินขอบเขต 450 writes ต่อบิลรวม metadata/quotes หรือบิลข้ามวัน ข้อมูล Type/Timestamp/Doc_No ผิดปกติต้องตรวจแยก ไม่มีการเดาวันที่ใหม่
8. ตรวจครบทุกวันและอ้างอิงจากใบเสนอราคา เปรียบเทียบจำนวนบิล/สินค้าและยอดก่อน–หลัง รวมทั้งราคาที่ไม่ได้บันทึกและราคาศูนย์ ตัวนับกับ reservation ต้องตรงกัน จากนั้นจึง Deploy ชุด source ที่ตรวจและอนุมัติ ใช้ URL/สิทธิ์เดิม และเปิดรับรายการอีกครั้ง บังคับโหลดหน้าใหม่เพื่อใช้ DTO/แคชรุ่นใหม่

Rollback source ได้ด้วยรุ่นก่อน แต่ alias/counter ที่ commit แล้วไม่ควรถูกลบหรือรีเซ็ต การย้อนข้อมูลต้องมีแผนและอนุมัติใหม่ หาก rollback ระหว่าง cutover ต้องจัดการบิลไม่มี alias ที่เกิดเพิ่มด้วย preview รอบใหม่ เก็บรหัสภายในเดิมไว้เสมอ

## Verification / release status

Local mocked regression: 237 unit tests ผ่าน; syntax/manifest 71 scripts ผ่าน และ read-model เดิมผ่าน (เป็นข้อมูลจำลอง ไม่ใช่ billed reads Production) Full browser suite: 125 กลุ่มผ่าน รวม 4 กลุ่มใหม่ ตรวจภาพรายละเอียดจอ 390px แล้ว มี hint เลื่อนตารางราคาและปุ่มปิดเข้าถึงได้

ทดสอบขอบเขตวันเวลา การส่งซ้ำ คำตอบสูญหาย สต๊อกไม่พอ ตัวนับล่ม ตัวนับถูกลบ การชนของคำขอคนละบิล ราคาเจรจาเดิม preview อ่านอย่างเดียว stale hash, CAS, เลขซ้ำ/เลขไม่ครบ/บิลข้ามวัน การรักษา field เดิมและการวางแผนต่อหลัง commit ไม่ทราบผล รวมถึง permissions, click/cache/retry/Escape/focus/mobile และค้น alias ใน browser

อัปเดต 20 ตุลาคม 2569: ผู้ใช้อนุมัติ Deploy แล้ว เผยแพร่ runtime `036e3b0` เป็น **Version 100** และตรวจ Source 24/24 ตรงกัน ดู [ผล Deployment](DEPLOYMENT-2026-10-20-V100.md) ยังไม่รันเติมเลขย้อนหลังหรือเปลี่ยนข้อมูลธุรกิจ/Trigger จริง การนำแผนด้านบนไปรันกับ Production ต้องตรวจและอนุมัติ mapping/hash แยกก่อน
