# ตรวจการแสดงผลและ Reads ทั้งโปรเจกต์ — 15 ตุลาคม 2569

## ขอบเขตและผลสรุป

ตรวจ Source ของหน้าที่ router ใช้งานทั้ง 15 หน้า, UI/Modal/Filter/แคชร่วม,
API Gateway, การอ่านสินค้า/ข้อมูลหลัก/เอกสาร/ประวัติ/บัญชี และงาน Backup
พร้อมทดสอบบน Chromium ด้วยข้อมูลจำลอง ไม่เชื่อมต่อ Production

รอบนี้แก้บัคขยายรูป 3 จุดและปัญหาประวัติ Activity ในหน้า Profile อีก 2 จุด
ส่วนแนวทางลด Reads ที่เปลี่ยนการซิงก์, วิธีค้นหา หรือวิธี Backup เป็นข้อเสนอ
แยกจากงานที่แก้จริง ไม่มีการเปลี่ยน DB, Index, IAM, สิทธิ์ หรือ Trigger

การผ่าน fixtures ไม่ใช่หลักฐานว่าข้อมูลจริงทุกแบบหรือทุก Deployment ไม่มีบัค
ยังต้อง UAT ด้วยบัญชีจริง โดยเฉพาะ Viewer ที่เคยรายงานหน้าว่าง, ข้อมูลเดิม,
การแก้ข้อมูลพร้อมกันหลายเครื่อง และสภาพเครือข่ายจริง

## บัคที่ยืนยันและแก้แล้ว

| ปัญหา | Root cause | การแก้ไข |
|---|---|---|
| เปิดรูปแล้วกลับมาเปิดจากรายละเอียดสินค้า กดปิดไม่ได้ | Overlay รูปอยู่นอก Modal stack จึงถูก `inert` ของหน้ารายละเอียดบล็อก | ใช้ `openModal` / `closeModal` ชุดเดียวกับหน้ารายละเอียด ให้ overlay เป็น Modal ชั้นบน |
| จอเล็กแตะปุ่มปิด/ซูมไม่ได้ | Toolbar ขึ้นสองบรรทัด แต่ `flex-basis` ยัง 58px ทำให้ stage ทับปุ่ม | ความสูง toolbar ตามเนื้อหา มีชั้นแสดงผลเหนือ stage และปุ่มมือถือ 44px |
| ปิดรูปแล้วหน้ารายละเอียดปลดล็อกการเลื่อนผิด | ฟังก์ชันปิดรูปตั้ง `body.overflow=''` โดยไม่คำนึงถึง Modal ที่ยังเปิด | ให้ Modal กลางคืนค่า overflow/โฟกัส; ยกเลิก pointer capture เมื่อหยุดลาก ปิด รีเซ็ต หรือเปลี่ยนรูป |
| เปิดแท็บ Activity ที่ไม่มีรายการแล้วอ่านซ้ำทุกครั้ง | ใช้ `activityLogCache.length` ตัดสินว่าเคยโหลดหรือยัง จึงแยก “โหลดแล้วแต่ไม่มีข้อมูล” ไม่ได้ | เก็บเวลาโหลดสำเร็จ ใช้ผลเดิมภายในหนึ่งนาที และรวมคำขอที่ยังไม่เสร็จ ปุ่มรีเฟรชยังเรียกใหม่ได้ |
| Activity ล้มเหลวแล้วแสดงเหมือนไม่มีข้อมูล/ทิ้งแถวเดิม | ไม่ตรวจรูปแบบ response ก่อน render และแทนตารางด้วย error เสมอ | ตรวจว่าเป็น array, แสดงข้อผิดพลาดให้ตรงเหตุการณ์ และเก็บแถวเดิมเมื่อโหลดซ้ำล้มเหลว |

Source ที่แก้: `Master_Products.html`, `Profile.html`.
`Shared.html` ไม่ต้องเปลี่ยนในรอบนี้ เพราะนำ Modal stack ที่มีอยู่มาใช้ให้ถูกต้อง
แทนการปิดระบบ `inert` หรือ focus trap ของทั้งระบบ

หน้าขยายรูปยังปิดได้จากปุ่มและ Escape โดยไม่ปิดหน้ารายละเอียด/ร่างด้านล่าง
การดูรูป เปลี่ยนรูป ซูม ลาก และปิดรูปไม่เรียก API เพิ่ม

## ผลตรวจแยก Module

| Module | สิ่งที่ตรวจ / ผลในเครื่อง | ข้อเสนอที่ยังไม่ทำ |
|---|---|---|
| Login / Profile / Users | Login อัตโนมัติ, รหัสผ่านแบบกดค้าง, role, modal, empty/error ของ Activity; แก้ตามด้านบน | คงการตรวจสิทธิ์สดฝั่ง Server; ไม่แคชบัญชีหรือข้อมูลยืนยันตัวตนเพื่อลด Reads |
| Shell / Dashboard | การสลับ iframe, กลับหน้าเดิม, trusted messages, ป้ายเวลา, empty/error และ delta drain ผ่าน Regression | ลด full bootstrap ตามเวลา โดยแยก delta กับ reconciliation |
| จัดการสินค้า / XLFilter | Viewer, รูป, ตาราง, footers, การค้นหา/กรองทั้ง catalog, CSV และชุด 10,000 รายการผ่าน Regression | ลด cold catalog scan / CPU และ invalidate ตามฟิลด์ที่เปลี่ยน |
| แบรนด์ / หมวดหมู่ / Vendor / Customer / Zone / Car | เพิ่ม fixtures ตารางมีข้อมูล 30 แถว ชื่อไทยยาว ที่ 1365/390/320px; ไม่พบ page overflow ในชุดนี้; ค้นหาใช้ข้อมูลเดิมไม่เรียก API | แยกข้อมูล dropdown ออกจาก full-list ตามความจำเป็น และกำหนด authoritative refresh ให้ชัดเจน |
| ตัดสต๊อก / ขายหน้าร้าน | ตะกร้า, stock delta, ยอด/ราคาเจรจา, retry ID, ประวัติ/รายละเอียด, 10,000 ผลลัพธ์แต่ DOM 60 แถว ผ่าน Regression | ค้นหาประวัติจาก Server ตามเลขรายการ/วันที่ก่อนโหลดครบ 1,000 แถว |
| ใบสั่งซื้อ / รับสินค้า | ตาราง/มือถือ, pending summary, รับซ้ำ, snapshot, partial pages ผ่าน Regression | แยก low-stock/pending summary ออกจากการเปิดประวัติหรือการรีเฟรชเฉพาะรายการ |
| ใบเสนอราคา | ราคาเจรจา/ตำแหน่ง cursor, ลูกค้า, ปีเอกสาร, draft, empty/error, print ผ่าน Regression | list-only refresh และ catalog/customer refresh ตาม version แยกส่วน |
| ใบกำกับภาษี | เลขเอกสารข้ามปี, สาขา, saved preview, search/pages, PDF/print ผ่าน Regression | แยก master payload จากรายการ; แคชปีเอกสารเมื่อ invalidate ได้ครบ |
| Backup / Recovery | ตรวจเส้นทาง snapshot, Full/Incremental, deletion tracking, retention และ tests เดิม | Incremental ปัจจุบันลดไฟล์ที่เขียน แต่ยังไม่ลดการสแกน DB |

ไฟล์ `UiEnhancements.html` มี lightbox รุ่นเก่า แต่หน้าที่ใช้งานปัจจุบันไม่ได้
include ไฟล์นี้ จึงไม่เปลี่ยนหรือลบในรอบนี้ และไม่ถือว่าการแก้ lightbox รุ่นเก่า
จะแก้หน้าจัดการสินค้าที่ใช้งานจริง

## ลำดับแนะนำสำหรับลด Reads / เวลารอเพิ่มเติม

ลำดับเรียงตามโอกาสลดภาระและความสำคัญ ไม่ใช่รายการที่นำขึ้น Production แล้ว

| ลำดับ | หลักฐานจาก Source | แนวทาง | ผล/ข้อจำกัด |
|---|---|---|---|
| 1 | `backupCapture_` อ่านทุก document แล้วเทียบ hash กับ prior index; Incremental ที่ไม่มีข้อมูลเปลี่ยนยังสแกนครบ | ออกแบบ change tracking ครบ create/update/delete และทุกแหล่งเขียน ก่อนอ่านเฉพาะส่วนเปลี่ยน | มีโอกาสลด Reads สูงมาก แต่ต้องคง Full/snapshot/deletion/recovery; อาจต้องเพิ่ม schema/บริการ/สิทธิ์ จึงต้องอนุมัติแบบแยก |
| 2 | `index.html` เรียก `dashLoad()` เมื่อหน้าหลัก active และ full snapshot อายุ 5 นาที; `getDashboardBootstrap_` โหลดประวัติช่วงปีเดิมเมื่อแคชหมด | ใช้ `getDashboardDelta_` สำหรับรอบปกติ พร้อมตรวจ catalog generation และคง full reconciliation เมื่อจำเป็น | ลดการอ่านประวัติเดิมในช่วงไม่มีรายการใหม่; delta ใช้ watermark และ overlap 1 นาที จึงต้องทดสอบ dedupe และ direct/legacy writes |
| 3 | `getProductCatalogRows_` โหลดสินค้าทั้งชุดตอน cold miss; paging เกิดหลังกรอง catalog ในหน่วยความจำ | ระยะแรกลดการ unpack/filter ซ้ำใน execution และ reuse snapshot; ระยะถัดไปออกแบบ indexed search ที่ยังรองรับภาษาไทย/substring/หลายคอลัมน์ | แยกให้ชัด: ลด CPU/payload ไม่ได้แปลว่าลด document Reads; query/index/schema ใหม่ต้องอนุมัติและรักษาผลค้นหาทั้งชุด |
| 4 | `getQuotationPageData_` / `getTaxInvoicePageData_` ส่ง products/customers ทั้งชุด; freshness ของหน้าทั้งสองเรียก full bootstrap | ให้รายการเอกสารรีเฟรชแยกจาก products/customers และโหลด master เฉพาะเมื่อ version เปลี่ยน | ลด payload/การประมวลผลก่อน; DB savings ขึ้นกับ server cache; ต้องคงราคาและข้อมูลลูกค้าที่บันทึกในเอกสาร |
| 5 | `searchMovements()` สั่ง `loadMovementPage(true)` หลังพิมพ์ 250ms; โหลดต่อจนถึงขอบเขต 1,000 แถว | เพิ่ม server search แบบ bounded ตามเลขรายการ/วันที่ ใช้ cursor และสถานะผลค้นหาที่ยังไม่ครบ | ลดการอ่านประวัติที่ไม่เกี่ยวข้อง; ต้องคง Viewer list permission และไม่ขยายสิทธิ์รายละเอียด Staff |
| 6 | `STOCK_DELTA` invalidate ขอบเขต `Master_Products`; product page เรียก `filterAndRenderTable()` ซึ่งขอ server page เมื่ออยู่ remote mode | ใช้ stock delta render แถวเดิมเมื่อไม่กระทบการกรอง/เรียง; reload หนึ่งครั้งเมื่อ stock/cost-dependent filters ทำให้ลำดับหรือจำนวนเปลี่ยน | ลด RPC หลังขาย/รับสินค้า; ห้าม patch หน้าเดิมอย่างเดียวเมื่อผลกรองทั้งชุดอาจเปลี่ยน |
| 7 | Facet และ catalog generations รวมข้อมูลหลาย collection; stock change ทำให้ default brand/category facets หมดอายุด้วย | แยก dependency ตามคอลัมน์และ filter context; image cache invalidate เฉพาะ image changes | ลด computation/RPC; ต้องยัง invalidate cascading facets ที่มีตัวกรอง stock/ราคา |
| 8 | `getPurchaseOrderPageData_` bootstrap รวม low-stock, pending query และ history; PO mutation invalidate ชุดรวม | ใช้ targeted PO response หลัง save/status/receive และแยก history refresh จาก low-stock summary | ลดการอ่านข้อมูลไม่เกี่ยวกับการกระทำ; pending ต้องครอบคลุมทั้งชุด ไม่ใช่นับเฉพาะหน้าแรก |
| 9 | `getTaxInvoiceAvailableYears_` / `getQuotationAvailableYears_` อ่าน meta document ใน list requests หลายกรณี | แคชปีเอกสารช่วงสั้นพร้อม invalidate หลังเพิ่ม/ย้ายปี/ลบที่เกี่ยวข้อง | ลด meta reads บางส่วน; ประโยชน์ต่ำกว่า full scans และต้องไม่ทำให้เอกสารข้ามปีหายจากตัวเลือก |
| 10 | แต่ละ iframe มี memory cache ของตนเอง; catalog บางหน้าโหลดซ้ำต่าง API แม้ DB server cache อาจ warm | พิจารณา catalog snapshot ร่วมผ่าน shell พร้อมตรวจ account/role/channel/version | ลด serialization/ส่งข้อมูลซ้ำ; ต้องออกแบบความเป็นส่วนตัวและการเพิกถอนสิทธิ์ ไม่ส่ง token ใน messages |
| 11 | การรีเฟรช browser ไม่ได้บังคับข้าม collection cache ทุกตัว; Firebase console writes ไม่เพิ่ม Script Properties generation | เพิ่มแนวทาง authoritative refresh ที่ rate-limit และกำหนดการรองรับ external writes ชัดเจน | แก้ความเข้าใจผิดเรื่อง “กดรีเฟรชแล้วต้องสด”; เพิ่มต้นทุน Reads ในการ refresh จริง จึงต้องไม่ยิงทุกคลิก |

ปัญหาแท็บ Activity ว่างที่อ่านซ้ำแก้แล้วในรอบนี้ ไม่มีการแคชข้อมูลบัญชี/รหัสผ่าน
หรือแก้ `getSession_` ให้ตรวจผู้ใช้เก่าเพื่อแลกกับ Reads ที่ลดลง

## ผลวัดที่ทำได้จริงในเครื่อง

1. **เปิด/ซูม/เปลี่ยน/ปิดรูป:** 0 RPC เพิ่มระหว่างการทดสอบแต่ละรอบ
   ดังนั้นรอบนี้แก้ UX โดยไม่เพิ่ม Reads/Writes
2. **Activity ว่าง:** หลังโหลดสำเร็จ ใช้ผลเดิมหนึ่งนาทีแม้สลับแท็บซ้ำ
   และคำขอที่ยังไม่เสร็จมีได้ชุดเดียว ปุ่มรีเฟรชและอายุเกินหนึ่งนาทียังเรียกใหม่
   ตัวอย่างเปิดซ้ำ 10 ครั้งจาก 10 RPC เหลือ 1 RPC = ลดคำขอส่วนนี้ 90%
3. **Backup fixture 100 documents ไม่มีการเปลี่ยนแปลง:** Full อ่าน capture
   100 documents; Incremental ถัดมาอ่าน capture 100 documents เช่นกัน
   แม้ `written=0`, `deleted=0`; returned documents รวม snapshot probe เป็น
   101 ทั้งสองรอบ ตัวเลขนี้ยังไม่รวมค่ารายการ collection IDs/index/auth
4. **Dashboard fixture 200 movements:** bootstrap แรกคืนประวัติ 200 documents;
   หลังล้างแคช จำลอง cache expiry เรียกใหม่คืน 200 documentsเดิม
   ยืนยันว่าการลด full reconciliation เป็นจุดที่ควรวัดและปรับต่อ

ตัวอย่างเชิงออกแบบ หาก DB มี N documents คงที่และไม่มีการเปลี่ยนทั้งสัปดาห์
การสแกนทุกวันเป็นประมาณ 7N documents เทียบกับ Full สัปดาห์ละครั้งเป็น N
มีเพดานลด **document capture scans** 6/7 หรือประมาณ 85.7% เฉพาะกรณีนี้
ยังไม่ใช่ผลลด billed Reads และยังไม่มี change tracking ที่พิสูจน์ความครบถ้วน
จึงไม่เปลี่ยน Backup ให้ข้ามการอ่านโดยอาศัยว่า “ไม่มีคนใช้งาน” หรือใช้ cache เก่า

ไม่สามารถสรุปเปอร์เซ็นต์ลด Reads ทั้งระบบจาก Source อย่างเดียว ต้องเก็บ
สัดส่วน API จริง, cold/warm cache, จำนวนผู้ใช้, ความถี่แก้ไข และโครงสร้าง query
โดยแยก RPC, documents returned, billed document/index reads และ payload bytes

Firestore มีขั้นต่ำต่อ query แม้ไม่มีผลลัพธ์ และ collection-ID requests มีค่าอ่าน
จึงไม่ควรตีความว่าจำนวนเอกสารที่คืนเป็นศูนย์เท่ากับค่าอ่านเป็นศูนย์
ดู [Firestore pricing](https://firebase.google.com/docs/firestore/pricing)
การแบ่งหน้าควรใช้ cursor แทน offset ที่คิดค่าเอกสารซึ่งข้ามไปด้วย
ตาม [เอกสาร query cursors](https://firebase.google.com/docs/firestore/query-data/query-cursors)
ส่วน batching/cache เพื่อลด Apps Script service calls สอดคล้องกับ
[Apps Script best practices](https://developers.google.com/apps-script/guides/support/best-practices)

## การทดสอบและผลกระทบ

- Syntax: 69 scripts และ manifest ผ่าน
- Automated backend/security/integrity/cache/recovery tests: 173 ผ่าน
- Browser suite เดิมรวมการทดสอบใหม่: 90 กลุ่มผ่านครบ
- รูป: Viewer/Staff/Admin × 1365/640/390/320px, เปิดซ้ำจากตารางและรายละเอียด,
  zoom/navigation, ปุ่มปิด, Escape, Tab, focus return, scroll lock และยกเลิก drag
- จอเล็กทดสอบใน context ที่รองรับ touch และแตะปุ่มจริง
- ตาราง master 6 หน้า × 3 ขนาดจอ: มีข้อมูล/ชื่อไทยยาว, local search, page overflow
- Profile Activity: empty cache, concurrent clicks, TTL, manual refresh,
  transport failure และ API error response

ไม่มีการอ่านหรือเขียน Production ในการตรวจนี้ ไม่มี schema/index/IAM changes
ไม่มีการขยายสิทธิ์ Viewer หรือเปลี่ยนการ commit สต๊อก/ราคาทางธุรกิจ
ข้อมูลร่างและสถานะ unknown transaction ยังคงตามพฤติกรรมเดิม

## การส่งมอบและงานคงเหลือ

ส่ง Source ผ่าน `main` พร้อมรายงานและ regression tests
ไฟล์ที่เปลี่ยนทั้งหมด: `Master_Products.html`, `Profile.html`, `tests/browser.cjs`,
`README.md` และรายงานฉบับนี้
ยังไม่ได้ Sync หรือ Deploy Apps Script ในรอบนี้ ต้องนำ runtime จากชุด release
เดียวกันขึ้นใช้งานและ UAT จริงก่อนยืนยัน Production

แนะนำทำลำดับ 2, 4, 5, 6 เป็นชุด Source ถัดไปโดยเริ่มจากเก็บ baseline
ส่วนลำดับ 1 และ search/schema/index ใหม่ต้องแยกการออกแบบและขออนุมัติ
รายละเอียดที่กระทบข้อมูลหรือบริการจริงก่อนดำเนินการ
