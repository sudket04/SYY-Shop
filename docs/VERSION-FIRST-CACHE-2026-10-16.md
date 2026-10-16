# Version-first manual refresh และ Cache หน้าสินค้า — 16 ตุลาคม 2569

**สถานะล่าสุด:** เผยแพร่แล้วเป็น **Version 98 เวลา 23:50 วันที่ 16 ตุลาคม 2569** Runtime `cfafa3e` พร้อมงานแก้บัคท้ายรายงาน ตรวจ published Source ครบ 24 ไฟล์ ดู [ผล Deployment](DEPLOYMENT-2026-10-16-V98.md) ส่วนข้อความยังไม่ Deploy ด้านล่างเป็นสถานะขณะพัฒนา

## ขอบเขตและสถานะ

ผู้ใช้อนุมัติให้ดำเนินการหลังตรวจข้อกำหนด Production-Safe Performance Optimization โดยยืนยัน **ใช้การค้นหา/กรองชุดเดิม** งานนี้ต่อยอด Source `0b40586` บน `main` ไม่สร้างระบบใหม่ ไม่เพิ่ม Infrastructure และ **ยังไม่ Sync Apps Script หรือ Deploy** Production ล่าสุดที่ตรวจยืนยันในงานก่อนหน้าคือ Version 97 (`b6e2d40`)

## Findings และการแก้ไข

| Priority | จุดเดิม / Root cause | การปรับ |
|---|---|---|
| P0 | `Shared.syyRegisterFreshness` ยังเรียก reload จาก dirty activation/master notification/BroadcastChannel แม้เลิก interval แล้ว | เหตุการณ์เหล่านี้ invalidate/patch ในเครื่องและแจ้งควรรีเฟรช ไม่สร้าง RPC; โหลดครั้งแรก คำขอจากผู้ใช้ และการตรวจธุรกรรมยังทำงาน |
| P0 | `callApi` ถือการคลิกรีเฟรชเป็น authoritative ทำให้ทิ้ง Cache ก่อนตรวจ Version; `apiGateway` เปลี่ยน generation และล้าง server caches | Manual ส่ง Version/อายุ/expiry ที่ถืออยู่ไปตรวจหลัง authentication/authorization; unchanged ใช้ `notModified` โดยไม่เรียก data worker ไม่ล้าง Cache หรือเปลี่ยน generation; cache miss/เปลี่ยน/หมดอายุเข้าทางอ่านปกติ |
| P0 | Cursor ปกติบังคับรัน worker แม้ถือหน้าที่ผ่านการตรวจอยู่แล้ว; การใช้ conditional ตรง ๆ อาจข้าม cursor validation | แยก `productBrowseContext_` ตรวจลายเซ็น อายุ บัญชี บทบาท query ขนาดหน้า และเลขหน้าก่อนอนุญาต conditional; Export/document cursors คงทางเดิม |
| P0 | คำตอบ ordinary กับ manual อาจตอบต่างลำดับ และ callback จาก memory ถูกหน่วงไว้ | เพิ่ม request sequence ต่อ key/identity รวม deferred callbacks และกัน bootstrap mirror ทับหน้าที่ร้องขอใหม่กว่า; คง epoch/session fences เดิม |
| P1 | IndexedDB เดิมมี Brands/Categories เท่านั้น และ invalidation ล้าง Session scope ทั้งชุด | เพิ่มเฉพาะ bounded ordinary product pages ที่ผ่าน field allowlist; ใช้ revision ต่อ Dataset + logout revision ใน IndexedDB transaction; ล้างเฉพาะ dependent records พร้อมป้องกัน delayed put |
| P1 | Bootstrap หน้าสินค้าและ navigation ใช้คนละ API/cache key | เก็บ memory mirror ของหน้า bootstrap ที่ไม่มี dropdown เพื่อให้กลับหน้าแรกที่เคยเปิดได้โดยไม่ขอข้อมูลซ้ำ |
| P1 | Manual เอกสารทิ้ง section versions และ unchanged refresh reset ตารางที่โหลดเพิ่ม/อยู่หน้าถัดไป | คง section hints; unchanged manual response ปลด loading โดยรักษารายการ ตำแหน่งหน้า และ draft; หากข้อมูลเปลี่ยนหรือ Cache หมดอายุยังโหลดชุดล่าสุดตาม flow เดิม |
| P1 | Dashboard bootstrap ส่ง catalog เต็มซ้ำ แม้เปลี่ยนเฉพาะ movements | เพิ่ม optional catalog-section stamp ใช้ generation รวม stock และ hard source age; unchanged section ไม่ส่ง products ซ้ำ; unchanged whole response ไม่คำนวณ/Render Dashboard ใหม่ |
| P1 | POS มีรีเฟรชเฉพาะประวัติ และ notification อาจทำให้ lazy image loader เรียกข้อมูลต่อ | เพิ่มปุ่มรีเฟรชสินค้า ป้องกันการโหลดซ้อน/ระหว่างธุรกรรม เก็บสินค้ากับราคาตะกร้าเดิมเมื่อผิดพลาด; local notification render ไม่เริ่มอ่านรูป |
| P1 | Legacy refresh messages ล้าง dependencies กว้าง และสถานะไม่แยกโหลดกับตรวจ Version | จำกัด scopes ของแต่ละ message; แยกเวลาโหลด/เวลาตรวจ/Cache/ควรรีเฟรช และอ่านชุดอื่นไม่ล้างสถานะ dirty ของข้อมูลที่ยังไม่ได้ตรวจ |

## Cache / Security / Compatibility

- Memory, bounded TTL, single-flight, session isolation และ fallback เดิมยังใช้ต่อ; เพิ่ม single-flight สำหรับ IndexedDB lookup และจำกัด request fences 200 keys
- IndexedDB database/object stores เดิม ใช้ **record schema 2** พร้อม per-dataset epochs; records รุ่นเดิมถือเป็น cache miss แล้วสร้างใหม่ ไม่มีการ migrate business data
- Persist เฉพาะ Brands/Categories ที่มี fields อนุญาต และหน้าสินค้าปกติไม่เกิน 200 แถว/serialized 1 ล้านอักขระ ไม่ persist catalog เต็ม การค้นหา/XLFilter เอกสาร ธุรกรรม Users/Profile หรือ credentials
- หน้าสินค้าที่ persist มีชื่อ รหัส ราคา ต้นทุน สต๊อก และข้อมูลแสดงที่บัญชีนั้นมีสิทธิ์อ่านอยู่แล้ว แยก fingerprint ตาม Session/role/app และล้างเมื่อ logout/เปลี่ยน Session; **ไม่ได้เข้ารหัสเพื่อป้องกันผู้ที่ควบคุมเครื่องหรือ XSS**
- Bootstrap สำหรับแก้ไขที่มี vendor dropdown ไม่ persist เพราะ label มีเบอร์โทรศัพท์; หน้า Viewer และหน้าถัดไปที่ไม่มี dropdown ติดต่อสามารถ persist ได้ การเก็บ sessionStorage เดิมไม่ได้ขยายเพิ่มในงานนี้
- จำกัด IndexedDB ต่อ scope ประมาณ 2 MB และรวมประมาณ 8 MB ของ raw UTF-16 / 40 และ 80 entries ไม่รวม database overhead; quota/private/blocked/corrupt cases ใช้ fallback เดิม
- ทุก restore จาก browser storage ต้องตรวจผ่าน gateway ก่อนนำมาแสดง Memory ที่ยังใช้ได้ reuse ตามอายุเดิม ไม่เก็บ password/OAuth token/authorization decision ใน IndexedDB
- Database generation ยังคงอยู่ใน Script Properties และไม่ใช่ atomic Firestore journal: การแก้ตรงใน Console/external writers อาจไม่เปลี่ยน Version จึงคง **hard expiry และ authoritative stock/write checks** ห้ามแปล `notModified` ว่ารับรองการแก้จากภายนอกทันที
- Source อายุไม่ต่อเพิ่มจาก conditional hit; เมื่อหมดอายุอาจอ่าน records ใหม่แม้ generation เดิม ไม่รับรอง 0 Reads ตลอดไป
- API operation names/legacy result shapes, role policy, stock preconditions/idempotency, search/filter/sort/export semantics และ business write paths เดิมยังอยู่ Explicit `authoritative:true` สำหรับการอ่านบังคับภายในยังรองรับ ไม่ใช่ค่าเริ่มต้นของปุ่มรีเฟรช
- UI timers ที่อัปเดตป้าย/controls ในเครื่อง และการติดตาม Backup progress ที่ผู้ใช้เปิดดูยังอยู่ ไม่เปลี่ยนตารางหรือ workers Backup

## ผลวัดและ QA

Baseline ก่อนแก้: `npm test` **209/209 ผ่าน** (`test-results/manual-cache-baseline-unit.log`)

| กรณี | ก่อน | หลัง | ความหมาย |
|---|---:|---:|---|
| 5 บัญชีกด manual refresh ของ Master ที่ Version/อายุยังใช้ได้ | 5 record REST requests | 0 record REST requests | ลด 100% เฉพาะ scenario นี้; mock session และ rate limiter เพื่อแยกต้นทุนข้อมูล ไม่รวม auth Reads |
| กลับหน้าที่ dirty / รับ notifications หลังโหลดแล้ว | อาจโหลดจากเหตุการณ์ | 0 extra RPC ใน Browser scenarios | ตรวจ Products, Brands, POS, PO, Quote, Invoice, Dashboard รวม new-product notification |
| เปิดหน้าสินค้าที่เคย persist หลัง reload | เดิมไม่รองรับ product persistence | Validate แล้วคืนจาก IndexedDB; 0 product workers ใน reload/navigation scenario | ยังมี RPC ตรวจสิทธิ์/Version ไม่อ้างว่าไม่ติดต่อ server |
| Manual document refresh ที่ unchanged ขณะหน้า 2 | reset รายการได้ | คงหน้า 2 และรายการที่โหลดไว้ใน 3 Modules | PO, Quote, Invoice |
| Warm memory | มีอยู่แล้ว | ยัง 0 RPC สำหรับ repeat ที่ใช้ได้ | ผลเดิมที่รักษาไว้ ไม่อ้างเป็น improvement ใหม่ |
| Browse 10,000 สินค้า หน้า 50 | มี bounded browse แล้ว | ยังคง 51 returned product documents รวม sentinel | Regression เดิม ไม่ใช่ลดใหม่จาก Version 97 |
| Production first/cached latency, p50/p95, billed document/index Reads | N/A | N/A | ไม่ได้วัด Production จึงยังไม่มีเปอร์เซ็นต์ทั้งระบบ |

ผลตรวจรับสุดท้าย: backend/cache/security/integrity/Backup regression **219/219**, Browser regression **110/110 กลุ่ม**, syntax **69 scripts/manifest**, `git diff --check` ผ่าน

หลักฐาน local ที่ไม่ส่งเข้า Git: `test-results/manual-cache-{baseline-unit,unit,browser}.log`, `manual-version-read-model.json`; Browser suite ใช้ local HTTP/RPC fixtures และ block external HTTPS ไม่ใช่ authenticated Production UAT หรือ Apps Script executions 5 คนพร้อมกันจริง การจำลอง 5 บัญชีและ race/precondition tests ไม่แทน live concurrency benchmark

## Files Modified

- Runtime: `Code.gs`, `Shared.html`, `index.html`, `Master_Products.html`, `StockIssue.html`, `Purchase_Orders.html`, `Quotation.html`, `Master_Tax_Invoice.html`
- Tests: `tests/client-cache.test.cjs`, `tests/hybrid-cache.test.cjs`, `tests/browser.cjs`
- Documentation: รายงานนี้ และ `README.md`
- Functions added: `productBrowseContext_`, `clientConditionalCursorAllowed_`, `clientSectionReusable_` และ IndexedDB internal dependency/revision helpers; ใช้ utilities เดิมสำหรับ query/write/cache/gateway
- ไม่มี schema/index/Rules/IAM/OAuth/config/Trigger changes และไม่มีการอ่านหรือเขียน business data Production ในงานนี้

## ส่งมอบ / Rollback / ข้อจำกัด

1. Commit/push เฉพาะไฟล์ที่ตั้งใจบน `main` ตาม standing instruction; เก็บ unrelated untracked audit ไว้
2. เตรียม review package 24 runtime files พร้อม checksum หลัง commit โดยไม่ Sync/Deploy
3. หลังได้รับอนุมัติ Production แยก: สำรอง/เทียบ server Head, Sync source ชุดเดียวกัน, ตรวจ saved และ published 24/24, คง URL/access/Trigger เดิม แล้วตรวจ Viewer/Staff/Admin, private/mobile browser, storage partition และ workflow จริง
4. Rollback ผ่าน ordinary Git revert และเผยแพร่ runtime เดิมหลังอนุมัติ; ไม่มี DB migration ให้ย้อนกลับ Cache schema 2 เป็นสำเนาที่ทิ้งได้ รุ่นก่อนหน้าไม่ใช้ records ที่ validation ไม่ผ่าน

Search/XLFilter/contains/complex sort/Export **ใช้ชุดเดิม**: cold path ยังอาจอ่านทั้ง catalog; Dashboard/POS cold load ที่ต้องคำนวณหรือค้นหาครบสินค้ายังใช้ catalog เดิม ไม่มี aggregation/index/search-engine rewrite ในงานนี้ การเปลี่ยนข้อมูลจากเครื่องอื่นอาจต้องกดรีเฟรชก่อนเห็น การไม่มี polling ไม่ได้ให้ realtime consistency

สิ่งที่ Not Tested: authenticated Production UAT, latency/billing/Query Explain จริง, browser partition ของ Apps Script จริง และ 5 executions พร้อมกันจริง ต้องใช้ staging/บัญชีจริงตามแผนตรวจรับก่อนอ้างผล Production

## แก้บัคที่พบจากการตรวจซ้ำ

ผู้ใช้อนุมัติแก้สองจุดที่ยืนยันจาก Browser fixtures บน Source `8374896`:

- `StockIssue.html`: เมื่อรีเฟรชได้ `notModified` จะคง DOM หมวดหมู่ หน้ารายการและตำแหน่งเลื่อนเดิม; หากได้ข้อมูลใหม่จะคงหมวดหมู่ที่ยังมีอยู่ หากหมวดหมู่นั้นไม่มีสินค้าแล้วจะกลับไป “ทั้งหมด” โดยไม่เก็บตัวเลือกที่ใช้ไม่ได้
- `index.html`: แสดง “โหลดข้อมูลเมื่อ” ตามเวลาโหลดเดิม และแยก “Cache / ตรวจล่าสุด” เมื่อได้รับการยืนยัน Version; การใช้ Cache ไม่ขยายอายุ snapshot ในกรณี server รุ่นเดิมไม่ได้ส่ง `snapshotLoadedAt`
- `tests/browser.cjs`: เพิ่ม regression สำหรับ unchanged/changed/removed category, ตำแหน่งรายการและ DOM, เวลาโหลด/ตรวจ Cache, ข้อมูลใหม่ และเครือข่ายล้มเหลว; การทดสอบใช้ข้อมูลจำลองเท่านั้น

ผลตรวจหลังแก้: **219/219 tests**, **112/112 Browser regression groups**, syntax **69 scripts/manifest** และ `git diff --check` ผ่าน หลักฐาน local: `test-results/refresh-ui-bugs-unit.log`, `refresh-ui-bugs-full-browser.log`

ไม่มีการเปลี่ยน backend, query, สิทธิ์ หรือข้อมูล DB และไม่เพิ่ม Firestore Reads/Writes; ไม่มีการ Sync Apps Script หรือ Deploy ในงานแก้บัคนี้
