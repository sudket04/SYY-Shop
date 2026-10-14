# สินค้า 10,000 รายการ — ผลปรับปรุง Source

เริ่ม 14 ตุลาคม 2026 · ตรวจส่งมอบต่อ 15 ตุลาคม 2026 · Baseline `b6fd3130f76813ad54f30356a3348310b834bb3d`

## สาเหตุและแนวทางที่ใช้จริง

เดิมหน้าสินค้าแบ่งหน้าเฉพาะใน browser หลังรับสินค้าทั้งหมดพร้อม metadata รูป ส่วน POS สร้าง DOM ทุกผลค้นหา Dashboard/ใบเสนอราคา/ใบกำกับภาษี/รายการสั่งซื้ออ่าน DTO สินค้าที่มีรูปทั้งชุดด้วย แม้ไม่ได้ใช้รูป ส่วน read lease ยอมเริ่มอ่านซ้ำเมื่อรอเพียง 900 ms

ปรับโดยคงการค้นหากลางข้อความภาษาไทย การกรองทุกคอลัมน์ การเรียง จำนวนรวม และข้อมูลท้ายแค็ตตาล็อกไว้ครบ **การแบ่งหน้าชุดนี้เป็น API pagination บนแค็ตตาล็อกในแคช ไม่ใช่ Firestore query ที่อ่านเพียง 50 products ตอน cold start** เนื่องจากการแทนที่การค้นหาเดิมด้วย prefix query จะทำให้ผลค้นหาเปลี่ยน ต้องออกแบบ search index/ข้อมูลค้นหาเพิ่มเติมก่อนลด cold product scan ได้จริง

## สิ่งที่เปลี่ยน

- หน้าจัดการสินค้าโหลดตาม page size 10/25/50/100; API จำกัดไม่เกิน 200 ต่อครั้ง กรองและเรียงครบทั้งแค็ตตาล็อกบน server ก่อนแบ่งหน้า ส่งเฉพาะแถวที่แสดง
- ตัวกรอง Excel ขอค่าจากทั้งแค็ตตาล็อกตามเงื่อนไขคอลัมน์อื่น โหลดตัวเลือกใน DOM ครั้งละ 200 และยังค้นหา/เลือกค่าอื่นได้ครบ
- อ่าน metadata รูปเฉพาะ product IDs ในหน้า ผ่าน batchGet; cache ตามชุด IDs และ generation ของรูป ไม่โหลดไฟล์รูปจาก Drive ใน backend
- POS เก็บข้อมูลค้นหาครบ แต่แสดงครั้งละ 60 แถว มีปุ่มก่อน/ถัดไป และลูกศรข้ามหน้าได้ Barcode/Enter ยังค้นหารายการท้ายชุดได้ โหลด metadata รูปเฉพาะหน้าที่แสดง และไม่โหลดเมื่ออยู่แท็บประวัติ
- Dashboard, POS, ใบเสนอราคา และใบกำกับภาษีใช้ transport ชุดย่อแบบ fields/rows ตัดชื่อ property ซ้ำและรูปที่ไม่ได้ใช้; PO low stock ใช้ catalog เดียวกัน ยังคำนวณจากสินค้าครบทุกตัว
- แคช catalog ชุดย่อร่วมกัน 120 วินาที พร้อม generation ของสินค้าและ master ทั้ง 5; แคชดิบยังใช้นโยบายเดิม การบันทึก/stock commit ยังคง invalidation และ authoritative readback เดิม
- cold collection fetch ขอครั้งละ 1,000 documents แทน 300 โดยตาม nextPageToken จนครบและยังปฏิเสธข้อมูลที่ไม่ครบ
- read lease รอ producer เป็นช่วงสูงสุดประมาณ 10 วินาที แล้วแจ้งให้ลองใหม่ แทนเริ่ม full scan ซ้ำขณะ lease ยังอยู่; lease 30 วินาที และ fail-open เมื่อ CacheService ใช้งานไม่ได้
- Export โหลดทีละ 200 แถว แสดงความคืบหน้าในปุ่ม ป้องกันกดซ้ำ รวมครบตามตัวกรองก่อนดาวน์โหลด มี signed cursor ผูกกับ project/query/generation/fingerprint อายุ 5 นาที หากข้อมูลเปลี่ยนหรืออ่านไม่ครบจะหยุดและแจ้งให้เริ่มใหม่ ไม่ดาวน์โหลด CSV ที่ขาดหรือปนข้อมูล
- ร่างแก้สินค้านอกหน้าปัจจุบันโหลดเฉพาะ product ID เพื่อกู้คืน ไม่สรุปว่าสินค้าถูกลบเพียงเพราะไม่ได้อยู่ในหน้าที่โหลด

## ผลจำลองที่ทำซ้ำได้

รัน `npm test` หรือ `node --test tests/catalog-scale.test.cjs` ผลตัวเลขถูกเขียนที่ `test-results/catalog-scale.json` (ignored)

Fixture: 10,000 products, metadata รูป 1 document/product, master 5 documents; ไม่เรียก Production และไม่จำลอง latency, auth reads, index billing หรือ eviction ของบริการจริง

| รายการ | เดิม | ใหม่ | ลดลง |
|---|---:|---:|---:|
| Documents ที่คืนจาก DB เมื่อเปิดหน้าสินค้า cold, 50 แถว | 20,005 | 10,055 | 49.74% |
| Product documents ใน cold scan | 10,000 | 10,000 | 0% |
| Metadata รูปที่อ่านหน้าแรก | 10,000 | 50 | 99.50% |
| Payload ตารางหน้าแรก | 6,488,940 bytes | 32,602 bytes | 99.50% |
| Payload catalog สำหรับหน้าที่ต้องใช้สินค้าครบ | 6,488,940 bytes | 2,304,786 bytes | 64.48% |
| HTTP list products (เมื่อ API คืนเต็มขนาดหน้าที่ขอ) | 34 | 10 | 70.59% |
| POS DOM สำหรับผลค้นหา 10,000 รายการ | 10,000 แถว | 60 แถว | 99.40% |

Warm repeat ของหน้าเดิมใน fixture ไม่เพิ่ม data-document reads; การค้นหาสินค้าท้ายชุดไม่อ่าน products ทั้งชุดเพิ่ม การ Export ครบ 10,000 รายการไม่มี ID หายหรือซ้ำ Stock commit 1 รายการยังอ่าน product 2 ครั้งตาม authoritative precondition/readback เดิม และใช้ atomic commit เดิม

**49.74% ไม่ใช่เปอร์เซ็นต์ลดค่า Firestore ทั้งระบบ และ 99.50% ของ payload ไม่ใช่เปอร์เซ็นต์ลด product reads** เมื่อรูปมีน้อย ผลลด reads จะน้อยลง; batchGet ของรูปที่ไม่มี document ก็มีต้นทุนอ่านที่ต้องวัดจริง รวมถึง session/role validation ต่อ RPC การ Export ทั้งชุดยังต้องอ่าน metadata รูปทั้งชุดเมื่อ cache cold

## Files Changed

- `Code.gs`: catalog/filters/pages/cursors, targeted images, compact bootstrap, bounded leases, fetch page size, authenticated read registry/rate limits
- `Master_Products.html`: server pages, global filter values, stale-response guard, export progress/cursors, off-page draft recovery
- `StockIssue.html`: 60-row display windows, lazy image metadata, compact initial data
- `Shared.html`: decode compact transport, reject malformed data through existing failure callbacks
- `XLFilter.html`: asynchronous facet provider and bounded option rendering, preserving local consumers
- `index.html`, `Quotation.html`, `Master_Tax_Invoice.html`: opt into compact product transport
- `tests/catalog-scale.test.cjs`, `tests/browser.cjs`, `tests/security.test.cjs`, `package.json`: scale, UI, authorization and regression checks
- `README.md`, this report: delivery/limitations

## Validation

- Syntax: 69 scripts/manifest
- Automated: 159 tests, including 7 scale/cache/cursor/integrity cases
- Browser: 85 groups, including real Code.gs in local VM behind browser fixture for 10,000-row Viewer paging/search/facets/export, POS keyboard/window/barcode and compact decoding
- วันที่ 15 ตุลาคม รัน 3 กลุ่มใหม่ซ้ำหลังเพิ่ม malformed-response recovery: ผู้รอ RPC ร่วมกันได้รับ error ครบและ retry ได้ ไม่ค้างสถานะ pending
- Verified initial/page retry, global Thai/brand/barcode search, numeric sort, filter-none, full filtered export, missing cache chunks, missing/failed image reads, cache outage, concurrent generation change, expired/tampered/cross-project cursors, committed stock update, and unchanged Viewer mutation denials
- Screenshots: ignored `test-results/catalog-10000-viewer.png`, `catalog-10000-pos.png`

## Firestore / security impact

ไม่มีการเขียน/ลบ Production data, เพิ่ม collection/field/index, migration, IAM, trigger หรือ role change ในงานนี้ New endpoints เป็น read-only ผ่าน gateway/session/Viewer-or-higher policy เดิมและมี rate limits; mutation routes ไม่เปลี่ยนสิทธิ์ การตัดสต๊อก/รับสินค้า ราคาในเอกสาร และ optimistic concurrency ไม่เปลี่ยน

CacheService เป็น best effort และอาจ evict ก่อน TTL จึงไม่รับประกัน zero reads หรือ single producer เมื่อ cache เสีย/lease หมดอายุ ดู [ข้อจำกัด CacheService](https://developers.google.com/apps-script/reference/cache/cache) แคช 200 chunks อนุญาตเฉพาะ compact catalog; cache ผลลัพธ์อื่นคงเพดาน 60 chunks เดิม

## Deployment และงานตรวจรับที่ยังต้องทำจริง

Source ส่งขึ้น `main`; **ยังไม่ได้ sync source หรือ deploy Apps Script ชุดนี้** Production URL รุ่น 93 เดิมไม่ถูกแก้ การเปิดใช้ต้องส่ง runtime ทั้ง 24 ไฟล์เป็นชุดเดียวและตรวจ checksum เพื่อไม่ให้ backend/Shared/UI ต่างรุ่น

ก่อน Production deployment ต้องตรวจ Staging ด้วย Apps Script จริง: cold/warm latency, serialization ของ compact payload, simultaneous users, cache eviction, billing และ workflow sale/receive/documents/Viewer ที่ยืนยันตัวตนจริง จากนั้นขออนุมัติ deployment ของ URL เป้าหมายตาม Master Instructions §10 Step 5

ข้อจำกัดที่ยังเหลือ: cold scan ของ products ทั้งชุดและการค้นหาในหน่วยความจำยังมีอยู่; compact catalog ของ POS/documents/Dashboard ยังส่งครบทุกสินค้า; cache patch หลัง stock ยังประมวลผล raw catalog ทั้งชุด; Export อาจต้องเริ่มใหม่ถ้ามีรายการแก้ไข/stock commit ระหว่างโหลด ห้ามอ้างว่ารองรับ concurrency หรือความเร็ว Production ตามตัวเลข local fixture แล้ว ปัญหา Viewer หน้าว่างบน URL จริงก่อนหน้านี้ยังต้องตรวจด้วย session ที่เกิดปัญหา ไม่ได้สรุปว่าแก้ได้จากการทดสอบ local
