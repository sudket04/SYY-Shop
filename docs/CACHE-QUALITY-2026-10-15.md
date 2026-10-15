# Cache quality and read efficiency — 15 October 2026

## ขอบเขตและผลลัพธ์

ปรับ Cache และการโหลดข้อมูลซ้ำตามสรุปล่าสุด โดยคง API เดิม รูปแบบข้อมูลเดิมสำหรับ client เก่า และการตรวจสิทธิ์/สต๊อกจริงก่อนธุรกรรม ไม่แก้ schema, index, IAM หรือข้อมูล Production และยังไม่ Deploy ตามคำสั่งผู้ใช้

สาเหตุหลักจาก Source คือปุ่มรีเฟรชข้ามเพียง Browser Cache, Cache หลายชั้นอาจต่ออายุข้อมูลที่อ่านจากชั้นก่อนหน้า, เอกสารส่งสินค้า/ลูกค้าทั้งชุดซ้ำ และ Dashboard ใช้ full reconciliation ทุก 5 นาที แม้ไม่มีรายการใหม่

## สิ่งที่ปรับแล้ว

1. **รีเฟรชจาก DB จริง**: ปุ่มรีเฟรชส่ง metadata แยกจากการข้าม Browser Cache ของ export กรณีรีเฟรชจะ invalidate เฉพาะ scope ของ API ที่ผ่านการตรวจ session/role แล้ว ข้าม raw/result cache ของ scope นั้น และไม่ใช้ conditional not-modified แทนการอ่านจริง จำกัด 3 ครั้งต่อนาทีต่อบัญชี ถ้าถูกจำกัดหรือโหลดล้มเหลว UI แสดงข้อผิดพลาดและเก็บข้อมูลเดิม
2. **ไม่ต่ออายุข้อมูลเก่าข้ามชั้น**: Result Cache และ Browser Cache รับวันหมดอายุจาก raw source ข้างใต้ และ conditional response ไม่ยืดอายุเดิม ชุดสินค้า/ลูกค้าที่หน้าเอกสารเก็บไว้มีเวลาของข้อมูลต้นทางประกอบ ไม่ใช้เวลาที่ส่งซ้ำมาเริ่มอายุใหม่
3. **ขอบเขตอายุ Server Cache**: สินค้า 5 นาที, รูปแบบ metadata รูปและลูกค้า 10 นาที, master อื่น 15 นาที พร้อม invalidate หลังการเขียนผ่านแอปตามเดิม `Master_Users`/การยืนยันตัวตนไม่ได้เปลี่ยนนโยบายเพื่อแลก Reads
4. **ลดงานซ้ำใน execution เดียว**: เก็บ raw documents และ unpacked catalog เฉพาะระหว่าง request ตรวจ generation ก่อนนำกลับมาใช้ และล้าง context ใน `finally` ไม่มีข้อมูลข้ามคำขอ/บัญชีโดยอาศัย memo นี้
5. **สินค้า / XLFilter**: ใช้ผลกรองและเรียงลำดับเดียวกันข้ามหน้า โดยผูกกับ query, generation และ digest ของ catalog ส่งเฉพาะสินค้าหน้านั้นและโหลดรูปที่เกี่ยวข้อง การ seed facet รับอายุ Cache ต้นทางด้วย
6. **ใบเสนอราคา / ใบกำกับภาษี**: แยก version ของสินค้าและลูกค้า ส่วนที่ยังตรงและไม่หมดอายุไม่ส่งทั้งก้อนซ้ำ เก็บ array และร่างเดิมไว้ การเปลี่ยนปี/ค้นหา/list-only ยังคงรูปแบบเดิม เพิ่มปุ่มรีเฟรชจาก DB ในหน้าใบกำกับภาษี
7. **ปีเอกสาร**: เก็บ metadata ปี 2 นาที พร้อม invalidate หลังบันทึกปีสำเร็จ ไม่แคชข้อผิดพลาด และไม่เพิ่มการเขียน metadata นอก flow เดิม
8. **Dashboard**: ขณะเปิดใช้งานซิงก์ delta ประมาณทุกนาที ทำ full reconciliation ทุก 15 นาทีแทน 5 นาที ส่ง catalog เพิ่มเมื่อโครงสร้างสินค้าเปลี่ยนหรืออายุ catalog หมด คงการอ่านสต๊อกเป้าหมาย, overlap, cursor และ advance watermark หลังอ่านครบทุกหน้า คำขอ delta เดียวกันแชร์ Server Result Cache 5 วินาที โดย invalidate ตาม write generations
9. **UX เมื่ออ่านล้มเหลว**: master ทั้ง 6 หน้าเก็บข้อมูลที่โหลดสำเร็จก่อนหน้า รวมกรณีผลว่าง และแจ้งว่าแสดงข้อมูลเดิม ปุ่ม busy ไม่ทำ label เดิมหายเมื่อมี load ซ้อน
10. **บัคที่พบระหว่างตรวจ**: callback stock ของหน้าใบสั่งซื้ออ้าง `d.unknown` ทั้งที่ไม่มี `d` จึงเกิด ReferenceError ย้ายการกู้ unknown-write guard ไปไว้ใน draft restore ที่มีข้อมูล `d` จริง และแก้การส่ง `fullRefresh` ของ Dashboard ให้ client เริ่ม bootstrap ได้แทนการถูก gateway wrapper ดักเป็น generic error
11. **เตรียมวัดผลหลังเปิดใช้**: `syyCacheStats` ในแต่ละหน้าเก็บ hit/miss และ `byApi` มีจำนวน RPC/error และเวลารวม/ล่าสุด/สูงสุด นับคำขอที่รวมกันเพียงครั้งเดียว เก็บเฉพาะตัวเลขใน memory ไม่บันทึก argument, token หรือข้อมูลลูกค้า ไม่ส่ง telemetry หรือเพิ่ม DB read/write ตัวเลขนี้ยังไม่ใช่ billed Reads

Raw/result cache ใช้ namespace ใหม่ `docs_v4_`/`read_v2_` เพื่อไม่รับ Cache อายุยาวจาก Source รุ่นเดิม ไม่ใช่การเปลี่ยน collection หรือ DB migration ช่วงเปิดใช้ครั้งแรกจึงมี cold-cache load และ export cursor รุ่นก่อนอัปเดตอาจต้องเริ่มใหม่

## ผลวัดใน fixture

ทดสอบด้วย Firestore/Apps Script จำลอง ไม่ใช่ billed Reads หรือ latency ของ Production:

| กรณี | ผล |
|---|---|
| หน้าเอกสารมีสินค้า 10,000 รายการ แล้วข้อมูลสินค้า/ลูกค้าไม่เปลี่ยน | payload จาก **914,787 → 26,435 bytes**, ลด **97.11%** ต่อ response นี้ |
| โหลดหน้าเอกสาร 10 ครั้งในช่วง metadata cache | อ่านเอกสารปี **1 ครั้ง** แทน 10 ครั้ง ลด **90% เฉพาะ metadata reads นี้** |
| เรียก Dashboard delta 10 ครั้งด้วย watermark/options เดียวกันในช่วง 5 วินาที | query ใน fixture **1 ครั้ง** และการเปลี่ยน generation ทำให้ query ใหม่ |
| เปลี่ยนหน้าผลกรอง/เรียงเดียวกัน | ใช้ผลเรียงเดิม ไม่กรอง/เรียง catalog ใหม่ทุกหน้า |
| เรียก Browser read เดิม 10 ครั้งใน reuse window | ยังคง **1 RPC** ตาม test เดิม; callback แต่ละตัวได้ snapshot แยกกัน |

โมเดลเอกสารอยู่ใน ignored `test-results/cache-quality-read-model.json` ผล warm read ไม่ได้แปลว่าการลด payload 97.11% ลด Firestore Reads 97.11% เพราะ Server Cache เดิมอาจหลีกเลี่ยงการอ่านสินค้าได้อยู่แล้ว

## ข้อจำกัดและผลกระทบ

- การลด TTL เพื่อให้ข้อมูลสดขึ้นอาจ **เพิ่ม Reads เมื่อ Cache หมดอายุ** เทียบกับการยอมใช้ข้อมูลเดิมหลายชั่วโมง และการกดรีเฟรชจาก DB มีต้นทุนอ่านจริง จึงจำกัดความถี่ ไม่รับประกันเปอร์เซ็นต์ Reads รวมโดยไม่มีตัววัดจริง
- ยังไม่มี Firestore listener/change feed สำหรับการแก้ตรง Firebase Console ข้อมูลใหม่จากแหล่งภายนอกพบเมื่อ Cache หมดอายุ/ตรวจซ้ำหรือกดรีเฟรชจาก DB ประวัติที่แก้/ลบตรง DB และไม่มี commit watermark ต้องรอ full reconciliation ของ Dashboard หรือกดรีเฟรช
- Browser cache ยังแยกตามบัญชี/role/URL และแต่ละ iframe มี memory ของตนเอง มี trusted invalidation เดิม ไม่มีการส่ง token หรือข้อมูลบัญชีไปทำ shared cross-frame data cache
- ไม่แคช login/สิทธิ์/บัญชี/Backup เป็น snapshot ธุรกิจ Activity ของ Profile ใช้นโยบายหนึ่งนาทีจากรอบก่อน การตัด/รับสต๊อกและการ retry ธุรกรรมยังตรวจ authoritative data และ commit แบบเดิม
- เก็บ `cache_structure_products` ใน Script Properties เพื่อแยกการแก้สินค้าออกจาก stock-only patch ไม่มี Firestore revision document และไม่เพิ่ม DB write สำหรับ Cache คีย์นี้เป็น transient และถูกตัดออกจาก Backup Properties
- Backup ยังอ่าน snapshot ทั้ง DB เพื่อตรวจ create/update/delete ตามระบบเดิม การแก้ Backup timeout ใน commit `26e10e6` ยังรวมอยู่ใน main แต่รอบนี้ไม่ได้เปลี่ยนเป็น incremental change feed หรือตั้ง Trigger จริง

## การตรวจสอบ

- `npm test`: **196/196 ผ่าน** รวม cache 27 tests, 10,000 สินค้า, stock concurrency/retry, session/role, Backup และ recovery
- `npm run test:browser`: **95/95 groups ผ่าน** และ rerun 4 กลุ่มใหม่หลังปรับ catalog expiry ผ่าน ใช้ local Chromium/gateway จำลองและปิด external HTTPS
- `npm run check`: **69 scripts/manifest ผ่าน**; `git diff --check` ผ่าน
- กรณีสำคัญใหม่: direct/external writes โดย generation ไม่เปลี่ยน, อายุ raw/result/browser ไม่ถูกยืดต่อ, reload สินค้า Dashboard เมื่อ catalog หมดอายุ, conditional section/typed draft, authoritative refresh/coalescing/rate limit, role/session/cursor rejection, memo invalidation, metadata failure และ PO unknown draft

Runtime ที่เปลี่ยน: `Code.gs`, `Shared.html`, `index.html`, `Quotation.html`, `Master_Tax_Invoice.html`, `Purchase_Orders.html` และ master 6 หน้า (`Master_Brands`, `Master_Categories`, `Master_Vendors`, `Master_Customers`, `Master_Zones`, `Master_Cars`) อีก 3 ไฟล์เป็น tests พร้อม README/รายงาน ไม่รวม untracked `docs/SYSTEM-AUDIT-2026-10-11.md`

## สถานะเปิดใช้

ส่ง Source ที่ตรวจแล้วไป `origin/main` ตามคำสั่งถาวร เตรียม release whitelist 24 ไฟล์พร้อม checksum ได้ แต่ **ไม่ได้ sync Apps Script, Deploy, แก้ Trigger หรืออ่าน/เขียน Production ในรอบนี้** การเปิดใช้จริงยังรอคำสั่งเปลี่ยนจากผู้ใช้ ต้องอัปเดต client/backend จาก package เดียวกัน แล้ววัด cold/warm reads, hit/miss, payload และ latency พร้อม UAT หลายบัญชี/เครื่องก่อนยืนยันผลจริง
