# ส่งต่องานเพิ่มเติม: บิล ประวัติ Dashboard และหน้าแก้ไขสินค้า — 29 ตุลาคม 2569

## 1. สถานะคำสั่งและขอบเขตการอนุมัติ

**สถานะล่าสุด: ผู้ใช้สั่ง “ทำต่อ” หลังเอกสารนี้ จึงอนุมัติ implementation ตามขอบเขตแล้ว พัฒนาและทดสอบชุด Source เสร็จที่ runtime commit `715532687293e66d6f3d68be744b8d82732a5a7f` แต่ยังไม่ Sync Apps Script, Deploy รอบใหม่ หรือเปลี่ยนข้อมูลย้อนหลัง**

อ่าน [ผลพัฒนาและงานค้างล่าสุด](BILL-UX-IMPLEMENTATION-2026-10-29.md) ก่อนรับช่วง: 286 unit tests, 140 Browser groups, 10 backend-integrated Browser groups ผ่าน และมี review bundle 24 ไฟล์ที่ตรวจ checksum แล้ว การอ่านระบบจริงพบ session หมดอายุ จึงยังยืนยัน authenticated UAT/เวลาไม่เกิน10วินาทีไม่ได้ รายละเอียดข้อ4–6ด้านล่างเป็นแผนและเหตุผลตั้งต้น ไม่ใช่งานทั้งหมดที่ยังไม่เริ่ม อย่านำการอนุมัติ Deploy ที่ใช้ไปแล้วกับ Version102 มาใช้อนุมัติ release ถัดไป

งานต่อจากบิล: ผู้ใช้สั่งปรับรูปสินค้า/100รายการต่อหน้า/skeleton แล้ว เสร็จที่ runtime `3a82708895dce542966675205a5a18cbc97cf406` ซึ่งรวมงานบิลเดิม ผลล่าสุด286 unit/144 Browser/10 backend Browser ผ่าน ดู [รายงานชุดล่าสุด](PRODUCT-IMAGES-SKELETON-2026-10-29.md) และใช้ review bundle ของ3a82708สำหรับ release ถัดไป ยังไม่ Sync/Deploy/เขียน DB จริง

ข้อกำหนดที่ผู้ใช้ยืนยัน:

- แก้ไข/ยกเลิกเฉพาะ **บิลตัดสต๊อก/ขายหน้าร้าน OUT** บิลรับเข้า IN เปิดดูรายละเอียดตามสิทธิ์เดิม
- รักษาสิทธิ์ Admin สำหรับ correction เดิม ไม่เพิ่มสิทธิ์ Staff/Viewer
- ไม่มี Staging อ่านผ่านระบบจริงเดิมได้ แต่ **ห้ามเขียน แก้ไข หรือลบ Production DB ระหว่างทดสอบ**
- ให้คงสถาปัตยกรรม Google Apps Script + Vanilla HTML/CSS/JS + Firestore REST + Drive
- คงการค้นหา/XLFilter เดิมและขอบเขตข้อมูล ไม่เปลี่ยนให้ค้นเฉพาะหน้าที่แสดง
- ใช้ main ตาม AGENTS.md; งานที่เสร็จและตรวจแล้วต้อง explicit stage, commit และ ordinary push ไป origin/main โดยรักษาการเปลี่ยนแปลงของผู้อื่น
- ทำงานเงียบ อัปเดตเฉพาะจุดสำคัญ สรุปภาษาไทยให้สั้นเมื่อเสร็จ

## 2. Baseline ที่ตรวจแล้ว: อย่าทำงานเดิมซ้ำ

Workspace: `C:\Users\sudket\Documents\ChatGPT\SYY-Shop`

| รายการ | Baseline / หลักฐาน |
|---|---|
| Runtime ล่าสุดที่ยืนยันในรายงาน | Version102 วันที่29ต.ค.2026 เวลา07:05 Asia/Bangkok |
| Runtime SHA | `568ffb474c71cd99d706b476975ee8f715fbd6d0` |
| แพตช์เริ่มโหลดหน้า/session | `1746ee2` รวมอยู่ใน runtime568ffb4 |
| เอกสารก่อนเริ่ม handoff รอบนี้ | main `c70b7e272054925a0f5a8dbdf3eeeaf68a8e1ec6` |
| Source verification เดิม | Saved Headและ immutable Version102 เทียบตรง24/24ไฟล์ |
| ผลทดสอบ release เดิม | 279 unit tests, 135 Browser groups, 9 backend-integrated Browser groups; syntax70 scripts/manifest และ read model ผ่าน |
| Smoke จริงที่ผ่าน | หน้า Login และการกดกลับ Login จาก protected route ที่ไม่มี session โดยไม่ส่ง Login form |
| ยังไม่ผ่านการยืนยันจริง | เมนูหลัง Login, เวลาโหลดจริงทุกหน้า, ธุรกรรม correction บน Production และเปอร์เซ็นต์ Reads ลดจริง |

[Production URL เดิม](https://script.google.com/macros/s/AKfycbydnft6V1Fxlm6fm09ySlRwb0-cODawOWGhfMmOLyTsl-7Gyki-qwT_I97CEROTwqHS/exec)

[Apps Script Editor เดิม](https://script.google.com/home/projects/16P76qalO_UL1fqbI6mjSDPz0MwUI82f0ZlEXrGkvOsGdCRINM05CuORP/edit)

สถานะข้างต้นมาจากรายงานที่ยืนยันไว้ ไม่ได้เปิดตรวจ deployment สดในงานจัดทำเอกสารนี้ ให้ตรวจ live state/remote changes ก่อน implementation หรือ release รอบถัดไป

ไฟล์นอกขอบเขตที่ต้องรักษา: `docs/SYSTEM-AUDIT-2026-10-11.md` เป็น untracked ที่มีมาก่อน ห้าม stage ทับ ลบ หรือรวมกับงานนี้โดยอัตโนมัติ

อ่านก่อนรับช่วง:

- [AGENTS.md](../AGENTS.md)
- [ผล Deploy102 และขอบเขต UAT](DEPLOYMENT-2026-10-29-V102.md)
- [แพตช์โหลดหน้า/session](FRAME-LOADING-RECOVERY-2026-10-29.md)
- [ตัวแก้ไขบิลและปุ่ม Save/Cancel ที่มีแล้ว](HISTORY-BILL-EDITOR-2026-10-29.md)
- [Implementation performance/correction ก่อนหน้า](PERFORMANCE-STOCK-CORRECTION-2026-10-28.md)
- [Handoff เดิมและประวัติการตัดสินใจ](CODEX-HANDOFF-2026-10-28.md)

## 3. สรุปช่องว่างจาก Source ปัจจุบัน

1. ตัวแก้ไขบิลมีแล้ว แต่ยังเป็นตารางรหัส/จำนวน/ราคา แยกจากรูปแบบบัตรสินค้า “รายการที่จะตัดออก” และยังไม่มีสรุปยอดจากการแก้ไขในเครื่องแบบทันทีที่ครบตามข้อเสนอใหม่
2. ประวัติยังแสดงหนึ่งแถวต่อ movement/สินค้า รวม9คอลัมน์ ผู้ใช้เสนอให้เหลือ5คอลัมน์ข้อมูลและ Action โดยรายละเอียดไปอยู่ในหน้าดูบิล
3. Dashboard Sales Invoices แสดงเวลาอย่างเดียว ยังไม่แสดงวันที่และผู้ทำรายการ ทั้งที่ timestamp/user มีอยู่ในข้อมูลที่ส่งมาแล้ว
4. dashGroupDocs ยังไม่ส่งต่อสถานะและผู้ทำรายการเข้าแถวสรุป การแสดง Bill_No ใช้ fallback เป็น Doc_No เมื่อไม่มีเลขมาตรฐาน จึงมีบิลย้อนหลังหลายรูปแบบ
5. Dashboard รายการบิลปัดยอดด้วย Math.round ควรแสดงเงิน2ตำแหน่งและรักษาการคำนวณให้ตรง ledger/backend
6. การรวมรายการจาก movement page ที่โหลดไม่ครบอาจทำให้ยอดต่อบิลขาดหาย จึงห้ามแก้เพียงซ่อนคอลัมน์หรือ group เฉพาะหน้า50movement
7. ยังไม่มีผลวัด authenticated runtime ที่รองรับคำกล่าวว่าทุกหน้าไม่เกิน10วินาที หรือ Reads ลดจริงกี่เปอร์เซ็นต์

## 4. แผนและเกณฑ์ตั้งต้น — ตรวจสถานะที่ทำแล้วจากรายงานผลพัฒนา

### P0 — ยืนยันการเปิดหน้าและข้อมูลจริงแบบอ่านอย่างเดียว

- ตรวจทุกเมนูใน session ที่ผู้ใช้ Login ไว้อยู่แล้ว รวม Products, StockIssue/History, Dashboard, masters, PO, Quotation และ Tax ตามสิทธิ์บัญชีนั้น
- หากไม่มี session ให้ตรวจ Source/Executions ต่อและรายงานข้อจำกัด ไม่ส่ง Login form เพราะอาจเขียน auth/activity metadata ไม่ขอรหัสผ่านหรือ token ในแชต
- แยกผล page readiness ออกจาก business-data readiness; หน้าแสดง UI สำเร็จไม่ได้แปลว่า RPC รับข้อมูลครบ
- คง syyOnReady ที่รองรับ late script installation, channel/source/origin validation, session-expired recovery และปุ่ม retry เดิม
- ทดสอบสลับหน้าเร็ว เปิดซ้ำ Back/Forward, timeout, network failure และ revoked session รวมการคงหน้า/ตัวกรอง/ตำแหน่งเลื่อน
- เป้าหมายไม่เกิน10วินาทีให้วัดจากคลิกเมนูจนเห็นข้อมูลหน้าแรกที่ใช้งานได้ แยก cold/warm cache, ครั้งแรก/เปิดซ้ำ, จำนวนสินค้า และเครือข่าย อย่ารับรองผลจาก mock tests

### P1 — รูปแบบเลขบิลและข้อมูลร่วมทุกหน้า

- มาตรฐาน human Bill_No: `SI-YYYYMMDD-NNNN` ตัวอย่าง `SI-20261028-0003` วันที่เป็นปีค.ศ.ตามวันธุรกิจ Asia/Bangkok และลำดับต่อวันอย่างน้อย4หลัก
- แสดงเลขเดียวกันของบิลเดียวกันในประวัติ, Dashboard, รายละเอียด, ตัวแก้ไข, บิลทดแทน, ลิงก์อ้างอิงและ Export ที่เกี่ยวข้อง
- ใช้ Bill_No สำหรับแสดงผล; ใช้ Doc_No/IDเดิมสำหรับ lookup, stock movements, audit, retry และความสัมพันธ์ ห้ามแทน key เหล่านี้ด้วยข้อความเลขบิล
- รวม formatter/label/resolver ที่ใช้ร่วมกันเท่าที่เหมาะสม หลีกเลี่ยงการเขียนกฎแยกหลายหน้าและการผูกรหัสกับชื่อผู้ใช้ปัจจุบัน
- วันที่–เวลาแสดงด้วยเขตเวลาไทยอย่างชัดเจน ไม่ขึ้นกับ timezone เครื่องผู้ใช้ ไม่ใช้เวลาแก้ไขมาแทนวันที่ออกบิลเดิม
- ผู้ทำรายการใช้ข้อมูลที่บันทึกกับ transaction หากไม่มีให้แสดง “ไม่ระบุ”; หากข้อมูลภายในบิลไม่ตรงกัน ให้แจ้งว่าไม่สอดคล้องแทนการเลือกค่าบรรทัดแรกโดยไม่ตรวจ
- แสดงเงิน2ตำแหน่ง กติกาคำนวณ/ปัดเศษต้องตรง backend; ข้อมูลที่ไม่ทราบต้องแยกจากศูนย์จริง
- **ห้ามสร้างเลขบิลย้อนหลังใน Browser จาก UUID, ลำดับแถว, วันที่เปิดหน้า หรือการ sort** เพราะจะเปลี่ยนเลขอ้างอิงและทำให้ตรวจย้อนกลับไม่ได้

เรื่องบิลเก่าที่ไม่มี Bill_No เป็นงานแยกตามข้อ8ด้านล่าง การใช้ formatter อย่างเดียวไม่ได้ทำให้บิลย้อนหลังทั้งหมดเป็นมาตรฐาน

### P1 — ประวัติเข้า-ออก: หนึ่งแถวต่อบิลและ Action

รูปแบบที่เสนอ:

`เลขบิล | วันที่–เวลา | ประเภท | มูลค่ารวมบิล | เหตุผล | จัดการ`

- ลดจำนวน/ชื่อสินค้า/คงเหลือรายสินค้า/ผู้ทำรายการ/หมายเหตุออกจากคอลัมน์หลัก ไปแสดงในรายละเอียด โดยยังค้นจากข้อมูลเหล่านี้ตามขอบเขตเดิมได้
- แสดงหนึ่งแถวต่อธุรกรรม โดยใช้ identity จริง ไม่ group จาก label เลขบิลที่อาจว่างหรือซ้ำใน legacy และไม่ปน IN/OUT/reversal ต่างธุรกรรม
- ยอดรวมต้องครบทั้งบิล หากข้อมูลยังไม่ครบให้แสดงสถานะโหลด/ไม่ครบ ไม่แสดงยอดบางส่วนเป็นยอดสมบูรณ์
- คงการกรองเข้า/ออก/ค้นหา และแสดงขอบเขตวันที่/จำนวนข้อมูลที่โหลดตามจริง
- ค่าเริ่มต้นแนะนำเรียงวันที่–เวลาล่าสุดก่อน พร้อมตัวเลือกเรียงยอดตามความเหมาะสม โดยรักษาการเรียงเมื่อเปลี่ยนหน้า
- แสดงป้าย active/ยกเลิก/มีบิลทดแทนข้างเลขบิล และลิงก์ความสัมพันธ์ให้ตรวจได้
- Action ตามรูปแบบหน้าจัดการสินค้า: ดูรายละเอียด, แก้ไขรายการสินค้า, ยกเลิกบิล พร้อมข้อความหรือ tooltip ที่ชัด และรองรับ keyboard/mobile
- ดูรายละเอียดตามสิทธิ์เดิม; Edit/Cancel เฉพาะ Admin + OUT active + ข้อมูลครบและอยู่ในขอบเขต atomic เดิม บิล IN, reversal, cancelled/replaced เป็น read-only
- ใช้ “ยกเลิกบิล” ที่รักษาประวัติ ไม่ใช้ปุ่มลบข้อมูลถาวรเหมือนลบ master record

**ข้อกำหนดสำคัญด้าน pagination:** ปัจจุบัน getStockMovementPage คืน movement pages จึงไม่สามารถ group เฉพาะหน้าที่โหลดแล้วและถือว่ายอดครบได้ ออกแบบ/ทดสอบแนวทางอ่านแบบ bounded ที่คืนกลุ่มบิลครบหรือมีการเติมกลุ่มอย่างจำกัดก่อนแสดงยอด โดยรายงานต้นทุนจริง

- หลีกเลี่ยง N+1: เปิดหน้ารายการแล้วเรียกรายละเอียดเพิ่มทุกแถวไม่ใช่แนวทางเริ่มต้น
- ห้ามแก้ด้วยการสแกน Stock_Movements ทั้ง collection ทุกครั้งที่เปิดหน้า
- cursor ต้องสัมพันธ์กับตัวกรอง/sort/snapshot และไม่ทำให้บิลซ้ำ หลุด หรือเด้งกลับหน้าแรกเมื่อมีข้อมูลใหม่
- หากต้องเพิ่ม summary collection, schema, index หรือเส้นทางเขียนเพื่อแก้โจทย์นี้ ต้องนำ design/ต้นทุน/ความเสี่ยงมาอนุมัติเพิ่มก่อน ไม่ทำเป็นผลข้างเคียงของงาน UI

### P1 — ตัวแก้ไขบิลใช้รูปแบบ “รายการที่จะตัดออก” และคำนวณทันที

เมื่อกด **แก้ไขรายการสินค้า**:

1. แสดง workspace/ฟอร์มในรูปแบบเดียวกับหน้าตัดสต๊อก: เลือกสินค้าและบัตรรายการสินค้า ตะกร้า เหตุผล อ้างอิง หมายเหตุ และยอดรวม
2. แสดง “กำลังแก้ไขบิล SI-…” และสถานะ correction ให้เด่น เพื่อแยกจากการขายใหม่
3. เติมสินค้าทั้งบิลจากรายละเอียดบิลเดิม พร้อมชื่อ จำนวน ราคาขายและทุนที่บันทึกไว้ ไม่แทนราคาเดิมด้วยราคาปัจจุบันโดยอัตโนมัติ
4. ปรับเพิ่ม/ลดจำนวนด้วยปุ่ม−/+หรือกรอก เพิ่มสินค้า และลบเฉพาะแถวได้ รักษาราคาแก้ไขโดย Admin ตาม workflow เดิม
5. คำนวณในเครื่องทันทีทุกครั้งที่เปลี่ยนรายการ โดยไม่เรียก preview API ทุก keystroke
6. ตรวจผล Server อย่างชัดเจนก่อนเปิดให้บันทึก และยังใช้ atomic correction เดิมเมื่อยืนยัน

ยอดที่ต้องมี:

| ข้อมูล | วิธีคำนวณ/ข้อควรระวัง |
|---|---|
| ยอดต่อบรรทัด | จำนวนใหม่ × ราคาต่อหน่วยของบรรทัดนั้น |
| จำนวนรวม/จำนวนรายการ | รวมจำนวนใหม่ และจำนวน SKU/บรรทัดตามกฎเดิม |
| ยอดขายรวม | รวมยอดสินค้าใหม่ทั้งหมด |
| ยอดเดิม → ยอดใหม่ | แสดงทั้งสองยอดและผลต่าง มี label ว่าเป็นตัวอย่างก่อนตรวจ Server |
| ต้นทุนและกำไรประมาณการ | SKUเดิมอิงทุนเดิมตาม backend; SKUเพิ่มใหม่อิงข้อมูล Master ที่อนุญาต มีสถานะไม่ทราบเมื่อข้อมูลไม่ครบ |
| ผลต่างสต๊อกต่อ SKU | จำนวนเดิม − จำนวนใหม่; สต๊อกหลังแก้ = สต๊อกปัจจุบัน + ผลต่าง |
| ลบสินค้าเดิม | จำนวนใหม่เป็น0ในเชิงคำนวณ จึงคืนจำนวนเดิมทั้งหมดใน preview |
| เพิ่มสินค้าใหม่ | จำนวนเดิมเป็น0 จึงตัดเพิ่มตามจำนวนใหม่ |

ตัวอย่างทดสอบ: เดิมขาย5ชิ้น สต๊อกปัจจุบัน12 แก้เหลือ3 → คืน2 เหลือ14; แก้เป็น7 → ตัดเพิ่ม2 เหลือ10; ลบแถวนั้น → คืน5 เหลือ17 ข้อมูลสต๊อกใน Browser เป็นประมาณการ Serverต้องอ่าน/ตรวจซ้ำก่อนยืนยันเสมอ

รายละเอียดที่ต้องรักษา:

- ใช้รูปแบบ/ส่วนประกอบ UI ร่วมกันได้ โดยแยก state ของบิลขายใหม่กับ correction รักษาตะกร้าใหม่และ draft ที่ทำค้างไว้เมื่อเปิด/ปิดการแก้บิลเก่า
- ปุ่ม Save ของ correction ต้องไม่เรียก issueStock แบบขายใหม่ และ F4/ปุ่มเปิดร่างใบกำกับของหน้าปกติต้องไม่ส่งบิลใหม่ขณะที่อยู่โหมดแก้ไข
- client validation: จำนวนมากกว่า0, ราคาตั้งแต่0, finite numbers, ไม่ซ้ำSKU, ไม่เกินจำนวนรายการ/ขอบเขต atomic เดิม และรองรับจำนวนทศนิยมตามกฎเดิม
- ลบทุกสินค้าแล้วต้องแจ้งให้ใช้ยกเลิกบิล ไม่แปลง Save เป็น Cancel โดยเงียบ
- เมื่อปรับสินค้าหรือราคา/ref/noteหลัง preview ให้ยกเลิก preview token เดิมและล็อก Save จนตรวจผลใหม่
- ค้นสินค้าใน catalog/cache ที่ผ่านการตรวจแล้ว แสดงผลค้นแบบจำกัด ใช้กฎรวม SKUเดิมเมื่อเพิ่มซ้ำ และรักษาราคาที่ผู้ใช้กำลังแก้
- คำนวณ/อัปเดตเฉพาะส่วนที่เปลี่ยน รักษา focus/cursor ของช่องกรอก หลีกเลี่ยงสร้าง DOMสินค้าทั้ง10,000รายการหรือเขียนตะกร้าใหม่ทั้งชุดทุก keystroke
- ไม่ persist draftใหม่พร้อมข้อมูลอ่อนไหวโดยไม่มีการออกแบบ owner/role/อายุข้อมูลให้สอดคล้องระบบเดิม

### P1 — แยก Save/Cancel พร้อม audit และป้องกันบันทึกซ้ำ

- รักษา **บันทึกการแก้ไข**, **ยกเลิกบิล**, **ยืนยันยกเลิกบิล** เป็น action ที่แยกกันเหมือน Version102
- ทั้งสองเส้นทางต้องระบุเหตุผลและ preview ที่ยังตรงกับข้อมูลปัจจุบัน
- ยกเลิกแสดงสินค้าทั้งบิลเดิมแบบอ่านอย่างเดียวและจำนวนที่จะคืน ให้ยืนยันผลก่อนดำเนินการ
- คง backend role enforcement, revision/updateTime, preview token, request ID, receipt และ CAS/atomic commit เดิม
- หากไม่ทราบผลคำขอ ให้ล็อกการแก้ข้อมูล เก็บคำขอเดิม ตรวจคำขอเดิมหลัง reload และไม่ส่ง write ซ้ำอัตโนมัติ
- รักษาบิลเดิม เลขอ้างอิง ความสัมพันธ์ Quote และ correction audit; การเปลี่ยนสินค้าใช้ reversal/replacement ตามระบบเดิม ไม่แก้ประวัติด้วย PATCH ตรงหรือเปลี่ยนราคาทุน Master
- หลังบันทึกสำเร็จ patch/invalidate cache ที่เกี่ยวข้องตามผล Server คงตัวกรอง/หน้าที่อยู่ และแสดงเลขบิลทดแทน/สถานะใหม่
- ใบกำกับภาษีเป็นเอกสารแยก ต้องคงข้อความให้ตรวจเอกสารที่เกี่ยวข้อง ไม่แก้อัตโนมัตินอกขอบเขต

### P2 — Dashboard เลขบิล วันที่–เวลา ผู้ทำรายการ และยอดที่เข้าใจตรงกัน

รูปแบบที่เสนอสำหรับ Sales Invoices:

`เลขบิล | วันที่–เวลา | ผู้ทำรายการ | มูลค่ารวมบิล | สถานะ | จัดการ`

- แสดง Bill_Noจริงมาตรฐานและเปิดรายละเอียดด้วย Doc_Noเดิม ตามสิทธิ์ที่มีอยู่
- ใช้ timestamp/user ที่มีใน Dashboard payload แล้ว ส่งต่อเข้า doc grouping อย่างครบถ้วน ไม่เรียก Master_Users เพิ่มทุกบิลเพื่อแสดงชื่อ
- ใช้เวลาไทยแม้ Browserอยู่เขตเวลาอื่น แสดงทั้งวันและเวลา และแยกวันที่ออกบิลกับวันที่แก้/ยกเลิก
- เปลี่ยนยอดเงินรายการจาก Math.round เป็นรูปแบบเงิน2ตำแหน่ง โดยไม่เปลี่ยนสูตรยอดสุทธิหรือใช้ราคาสินค้าปัจจุบันทับราคาที่บันทึกไว้
- แนะนำค่าเริ่มต้นใหม่สุดก่อน พร้อมเลือกยอดมากไปน้อย แยก “มูลค่าบิล” ออกจาก “ยอดขายสุทธิในช่วงเวลา” ให้ชัด
- แสดงสถานะและลิงก์บิลเดิม/บิลทดแทน โดยไม่ทำให้จำนวนบิลหรือยอดซ้ำ
- **ห้ามแก้ยอด Dashboard ด้วยการกรอง cancelled/replaced/reversalทิ้งทั้งหมด** ledgerมีรายการย้อนผลจำนวนติดลบและ billCountDelta ซึ่งจำเป็นต่อยอดสุทธิ รวมกรณีบิลเดิมกับวันแก้อยู่คนละเดือน/ปี
- แสดงผลกระทบจาก correction ในวันที่ทำจริง และแยกรายการปรับปรุงให้ตรวจได้ คงยอดเดิม/ย้อนผล/ทดแทนตามหลักฐานบัญชี
- แบ่งแถวที่ render ตามจำนวนหน้าจอ และเปิดรายละเอียดเมื่อผู้ใช้เลือก คง cache/coalescing และ error/retryเดิม
- Viewerคง summaryตามสิทธิ์เดิม ไม่เพิ่มสิทธิ์ดู movement detail หรือ commercial fieldsจากการเพิ่ม Action

### P2 — ประสิทธิภาพ Reads/cache และหลักฐานก่อน–หลัง

- เพิ่มคอลัมน์วันที่/userจากข้อมูลที่โหลดแล้วทำได้โดยไม่มี business readใหม่เฉพาะเพื่อเติมคอลัมน์ ไม่ได้แปลว่าทั้งหน้าไม่มี Reads เพราะยังมีการตรวจ session/ข้อมูลเดิม
- คำนวณแก้ไขใน Browser และค้นสินค้าใน catalog/cacheเดิม การอ่าน/ตรวจใหม่อยู่ที่เปิดรายละเอียด ตรวจผล และยืนยันตามความจำเป็น
- รวมคำขอซ้ำของบิลเดียวกัน เปิดรายละเอียดซ้ำจาก cacheที่ตรวจแล้ว และ invalidateเมื่อ correction/สิทธิ์/ข้อมูลเปลี่ยน
- คง session/role isolation, version validation และอายุ cache; ไม่ใช้ cacheข้ามบัญชีเพื่อหลีกเลี่ยง auth checks
- ไม่เพิ่ม auto refresh, timer polling, โหลดทั้ง collection หรือสร้าง RPCตามทุก input/การเปิด dropdown
- วัดเวลารับข้อมูล vs render, จำนวน RPC, cache hit/miss และจำนวนเอกสารที่อ่าน โดยแยกข้อมูลจำลองจาก usageจริง Firestore
- การลดคอลัมน์/จำนวนDOMช่วย UX/render แต่ไม่ได้ลด document readsโดยตรง ห้ามอ้างเปอร์เซ็นต์จากความรู้สึกหรือเทียบกับหน้าที่เสียจนไม่อ่านข้อมูลเลย
- การวัด Read/Writeจริงต้องใช้ช่วงก่อน–หลังที่ปริมาณงานใกล้เคียงกัน แยก business, authentication, Backup/trigger และ maintenance; ห้ามนับ RPCเท่ากับdocument readsหรือbillable readsโดยอัตโนมัติ
- เก็บ performance telemetryใน Browser/หลักฐานทดสอบตามจำเป็น ไม่เพิ่ม Firestore logwriteทุกคลิกเพื่อวัดการประหยัด Reads
- หากต้องติดตั้ง monitor/automation ให้ตรวจของเดิมและขอบเขตคำสั่งแยก งานเอกสารนี้ไม่สร้าง scheduleหรือเปลี่ยน Trigger

## 5. แผนทดสอบและเกณฑ์รับงาน

| กลุ่ม | ต้องพิสูจน์ |
|---|---|
| เริ่มโหลดหน้า | ทุกเมนูปกติ/late HTML/กรอบซ้อนข้าม origin; once-only initialization; timeoutและsessionหมดอายุมีทางออก |
| Identity | Bill_Noเดียวกันทุกหน้า Lookupใช้Doc_Noเดิม; legacy/missing/duplicate metadataไม่ทำให้เปิดผิดบิล |
| วันที่/ผู้ทำรายการ | ไทย/UTC/เขตเวลาอื่น/ใกล้เที่ยงคืน; ผู้ทำเดิมไม่เปลี่ยนตามบัญชีที่เปิดดู; ข้อมูลหายแสดงตามจริง |
| ประวัติระดับบิล | บิลหลายบรรทัดตัดผ่านหน้า movement; เลขบิลซ้ำ/ว่างในlegacy; ขอบเขตที่โหลดไม่ครบ; สินค้าในบิลอยู่นอกหน้าปัจจุบัน |
| Pagination/search | ถัดไป/ก่อนหน้า/Back/Forward/cache/new data; ไม่ซ้ำหรือข้ามบิล; ค้นSKU/ชื่อในรายละเอียดได้ตามขอบเขตเดิม |
| Live totals | เพิ่ม/ลด/กรอกจำนวน ลบแถว เพิ่มSKU เปลี่ยนราคา ราคา0 จำนวนทศนิยม ข้อมูลทุนหาย inputว่าง/NaN/Infinity; ไม่เรียกRPCตอนพิมพ์ |
| ตะกร้าปกติ | เปิด/ปิด correctionรักษาบิลใหม่ที่ค้างไว้; F4ไม่สร้างรายการผิดโหมด; ref/noteและdraftไม่ปะปน |
| Save/Cancel | ปุ่มแยก ตรวจผลก่อนยืนยัน ข้อมูลเปลี่ยนทำให้previewเก่าใช้ไม่ได้ ลบทุกแถวไม่กลายเป็นCancelเอง |
| Integrity | สต๊อกเปลี่ยนระหว่างpreview/commit, concurrent Admin, revisionผิด, CASfail, lost response/retry/reload; atomicหรือไม่เปลี่ยนอะไรทั้งชุด |
| Audit/บัญชี | เดิม+ย้อนผล+ทดแทน ยอดเงิน/ทุน/จำนวน/จำนวนบิลถูกต้อง รวมกรณีข้ามวัน/เดือน/ปีและQuota/PO-related referencesเดิม |
| สิทธิ์ | Admin/Staff/Viewer; OUT activeเท่านั้นสำหรับแก้; IN/reversal/cancelled/replaced/incompleteเป็นread-only; serverปฏิเสธการข้ามUI |
| UX/mobile | 320/390/1365/1920px, 100%zoom, scroll/paginationไม่หลุดจอ, focus/keyboard, ปุ่มมีlabel, loading/empty/errorแยกกัน |
| Scale | catalog10,000รายการ รายการบิลหลายหน้า detailถึงขอบเขตserver; DOMจำกัด ไม่เกิดN+1/whole-collection scanโดยไม่ตั้งใจ |

ใช้ test fixtures/Firestoreจำลองสำหรับ write flow ห้ามทดสอบ correction/cancel/save/restoreบน DBจริงตามข้อกำหนดปัจจุบัน Authenticated UATจริงทำเฉพาะ read-onlyในsessionที่มีอยู่ และรายงานส่วนที่ทดสอบไม่ได้อย่างชัดเจน

คำสั่งตรวจตามขอบเขตโค้ดที่เปลี่ยน:

```powershell
npm run check
npm test
npm run test:reads
$env:NODE_PATH='C:\Users\sudket\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
npm run test:browser
npm run test:browser-backend
git diff --check
```

เพิ่ม tests ที่พิสูจน์พฤติกรรม/ผลสต๊อกจริงในแบบจำลอง ไม่เพิ่มเพียง string assertionsที่สะท้อน implementation คง testsเดิมและแก้ fixtureเมื่อพฤติกรรมเปลี่ยนตาม requirement โดยไม่ลดการตรวจ security/integrity

## 6. จุดเริ่มต้นใน Source

| ไฟล์/ฟังก์ชัน | หน้าที่ / สิ่งที่ต้องตรวจ |
|---|---|
| StockIssue.html: renderBasket/renderPreview | รูปแบบบัตรสินค้า qty controls เหตุผล/ref/note ยอดจำนวน/ทุน/กำไร/ขายของตะกร้าปกติ |
| StockIssue.html: loadMovementPage/renderMovements | ประวัติระดับmovement ปัจจุบัน; pagination/filterและจุดเปลี่ยนเป็นระดับบิล |
| StockIssue.html: requestMovementDetail/renderMovementDetail | อ่านบิลตามDoc_No การ coalesce/cache และปุ่มActionเดิม |
| StockIssue.html: correctionModal/addCorrectionLine/openIssueCorrection | ตัวแก้ไขแบบตารางเดิม จุดปรับเป็นรูปแบบเดียวกับตะกร้าโดยไม่ปนstate |
| StockIssue.html: correctionChanged/previewIssueCorrection/commitIssueCorrection | invalidatepreview, server validation, request persistenceและuncertain flow |
| index.html: dashGroupDocs/dashBuildDocList/dashBillLink | สรุปบิล วันที่/user/status แสดงเลขบิลและปัดยอดปัจจุบัน |
| index.html: dashOpenBill/dashBuildAggregates | รายละเอียดตามสิทธิ์และledgerสุทธิ อย่าแก้สูตรโดยกรองmovementทิ้ง |
| Code.gs: stockMovementDto_/getStockMovementPage_/getStockMovementDetail_ | DTO, cursorระดับmovement, queryรายละเอียดเฉพาะบิลและcompleteflag |
| Code.gs: packDashboardMovements_/getDashboardBootstrap_ | Compact payloadมีuser/timestampอยู่แล้ว ตรวจcache/projectionเมื่อเพิ่มfieldอื่น |
| Code.gs: salesBillDay_/salesBillNumber_/prepareSalesBillNumber_ | เลขบิลวันไทย counter/CASเดิม คงimmutableIDsและretrykeys |
| Code.gs: stockCorrectionDraft_/buildStockCorrection_/correctStockIssue_ | role, validation, audit, ledger, currentstock, CAS/atomic/replay protection |
| Shared.html | money/date formatting, detail HTML, authenticated read cache, draft, versioningและinvalidation |
| UiSystem.html | once-only readiness, layout/mobile, typography, table footer/focus behavior |
| tests/browser.cjs | มีcase full bill lines, bounded10k picker, distinctSaveCancel, uncertain retry/reload, Dashboardและroleอยู่แล้ว |
| tests/stock-corrections.test.cjs, tests/sales-bills.test.cjs | Integrity/counter/correction และเรื่องlegacy/backfillที่ต้องรักษา |

ใช้ rgค้นชื่อฟังก์ชันจาก Sourceล่าสุด แทนการอาศัยเลขบรรทัดเก่าที่เลื่อนหลังแก้ไข

## 7. Git / release / รายงานส่งมอบ

1. ตรวจ cwd, AGENTS, git status และfetch origin/mainก่อนรวมงาน เก็บuntrackedของผู้ใช้ไว้นอกscope
2. เมื่ออนุมัติimplementationแล้ว แบ่งงานให้ตรวจย้อนกลับได้ เช่น sharedbillpresentation → editorlivecalc → historygroup/pagination → Dashboard → regression
3. Commit/Pushเฉพาะไฟล์ที่ตั้งใจบนmain ไม่ใช้forcepush ไม่ใส่credentials/.clasp/dependencies/test-resultsในcommit
4. เตรียม reviewbundleด้วย `npm run release:prepare` และverifyด้วย `node scripts/prepare-release.cjs --verify <directory>`
5. **รออนุมัติ Production deployment รอบใหม่** หลังมีชุดSourceและผลทดสอบที่ตรวจได้ การอนุมัติVersion102จบไปแล้ว
6. เมื่ออนุมัติ ให้เทียบ/สำรองSourceจริงก่อนSync รักษาmanualchanges ตรวจsavedHeadและimmutablepublishedVersionกับbundleครบทุกไฟล์ คงURL/owner/access/scopes/Triggerเดิม
7. ตรวจLogin smokeโดยไม่ส่งฟอร์ม และauthenticatedread-only UATตามsessionที่ได้รับ ไม่มีธุรกรรมเขียนจริง/Backfillแฝงในrelease
8. รายงาน Files Changed, Root Cause, Tests, Firestore Read/Write impact, Runtime SHA, main SHA, Version/URL/เวลาDeploy และข้อจำกัด/งานค้างที่ยังไม่ผ่าน

## 8. งานแยกที่ยังไม่อนุมัติให้ดำเนินการในชุด UI

### 8.1 เลขบิลย้อนหลังให้เป็นมาตรฐานทั้งหมด

ความต้องการรูปแบบเดียวกันทุกบิลต้องตรวจข้อมูลจริงและทำ mapping ไม่ใช่เปลี่ยนformatterอย่างเดียว Sourceมี maintenance helpers inspectSalesBillBackfill_, planSalesBillBackfill_ และ applySalesBillBackfill_ อยู่แล้ว แต่ยังไม่เคยรันbackfillจริงตามหลักฐานrelease

- อย่าเรียกinspectแบบสแกนทั้งหมดอัตโนมัติจากหน้าเว็บ/startup/deploy/trigger เพื่อแก้การแสดงเลข
- หากต้องการauditข้อมูลย้อนหลัง ให้ระบุช่วงวัน/ขอบเขตReadsและเตรียมแผนread-onlyอย่างจำกัดก่อน ห้ามใช้read-onlyauditเป็นเหตุให้เขียนmappingต่อเอง
- ก่อนเขียนจริงต้องมีเลขเดิม→เลขใหม่, Doc_Noเดิม, วันไทยจากTimestampจริง, จำนวนบรรทัด/บิล, เลขซ้ำ/ข้อมูลผิด, counterผลกระทบ, เอกสารอ้างอิง, approvedplanhash และแนวทางตรวจคืน
- รักษาเลขมาตรฐานที่ถูกต้องแล้ว ไม่เปลี่ยนidentityเดิม ไม่ทำเลขใหม่ทับตามการเรียงหน้า และไม่ใช้เลขที่อาจชนกับบิลที่ออกพร้อมกัน
- ตรวจความเข้ากันได้กับcancel/reversal/replacementและเอกสารเกี่ยวข้องก่อนใช้maintenancehelperเดิม
- **ต้องได้รับอนุมัติแก้ข้อมูลProductionย้อนหลังแยกต่างหาก** ปัจจุบันยังห้ามDBwritesจริง

### 8.2 งานตรวจจริงที่ค้างจากรอบก่อน

- ยืนยันเมนูหลังLogin/การโหลดไม่เกิน10วินาทีจากsessionจริง พร้อมcold/warmbaseline
- ตรวจRead/Writeusageจริงและการmonitorตามขอบเขตที่ตกลง ไม่รับรองเปอร์เซ็นต์ที่ยังไม่มีหลักฐาน
- Backup: รายงานVersion102บันทึกTrigger1รายการและerrorย้อนหลัง83.33% ณเวลาตรวจ ไม่ใช่สถานะสดและไม่ใช่หลักฐานBackupสำเร็จ ไม่รันBackup/Restoreหรือเปลี่ยนTriggerเพื่อทดสอบUIชุดนี้

## 9. Prompt สำหรับ Codex ที่รับช่วง

```text
รับช่วง SYY-Shop ที่ C:\Users\sudket\Documents\ChatGPT\SYY-Shop
อ่าน AGENTS.md, docs/BILL-UX-IMPLEMENTATION-2026-10-29.md, docs/CODEX-HANDOFF-BILLS-UX-2026-10-29.md และ docs/DEPLOYMENT-2026-10-29-V102.md ก่อน
ผู้ใช้สั่งทำต่อแล้ว implementationเสร็จที่715532687293e66d6f3d68be744b8d82732a5a7f มีผล286unit/140Browser/10backend Browserและreviewbundle24ไฟล์ ห้ามทำงานเดิมซ้ำ ห้ามSync/Deploy/Backfillจากเอกสารนี้เพียงอย่างเดียว
Productionที่ยืนยันในรายงานเดิมคือVersion102 runtime568ffb4 รวม1746ee2 ยังไม่ได้Deploy7155326 ให้ตรวจlive stateและremote changesก่อนrelease
งานที่ทำแล้ว: editorแบบตะกร้าพร้อมlive totals/stock delta, ประวัติหนึ่งแถวต่อบิล5คอลัมน์+Action/ยอดครบจากboundedCOUNTและbatchINsnapshot/cache, Dashboardวันเวลาไทย/ผู้ทำเดิม/สถานะ/เงิน2ตำแหน่ง, คงcache/security/paginationและpreview/retry/audit
งานค้าง: อนุมัติDeployรอบใหม่, authenticatedread-onlyUATและวัดเวลาcold/warmจริง ขณะตรวจsessionเดิมหมดอายุ ไม่ได้ส่งLoginform ไม่มีหลักฐานรับรองทุกหน้าไม่เกิน10วินาทีหรือเปอร์เซ็นต์Readsจริง
CorrectionเฉพาะAdminและOUT active บิลรับเข้าอ่านอย่างเดียว ไม่มีStaging อ่านProductionผ่านระบบเดิมได้แต่ห้ามเขียน/แก้/ลบDBจริงระหว่างทดสอบ คงค้นหา/XLFilterและarchitectureเดิม
งานแก้ไขเพิ่มเติมที่ได้รับอนุมัติให้ทดสอบและCommit/Push mainตามAGENTS โดยไม่ถามGitapprovalซ้ำ แยกFirestoreimpact/commit/สถานะDeployและงานที่ยังไม่ผ่านการตรวจจริง
การDeployใหม่ การbackfillเลขย้อนหลัง และการเพิ่มschema/index/IAM/summarywrite ต้องแยกขอบเขตและขออนุมัติให้ถูกประเภท ห้ามตีความการอนุมัติDeploy102ที่ทำเสร็จแล้วเป็นอนุมัติรอบใหม่
รักษา docs/SYSTEM-AUDIT-2026-10-11.md ที่เป็นuntrackedเดิมไว้นอกcommit
```
