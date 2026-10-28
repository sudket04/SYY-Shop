# ส่งต่องาน SYY-Shop — 28 ตุลาคม 2569

เอกสารนี้เป็นแผนและ baseline ตอนส่งต่องาน ให้ตรวจสถานะล่าสุดก่อนเริ่มทุกครั้ง

อัปเดตหลังรับช่วง: ลง Source ชุดถอดรูปตาราง, shared compact catalog, แยกโหลดเอกสาร/PO และ Admin correction แล้ว ดูรายละเอียด ผลทดสอบ และงานที่ยังไม่ผ่านเกณฑ์ที่ [รายงาน implementation](PERFORMANCE-STOCK-CORRECTION-2026-10-28.md) ตาราง baseline ด้านล่างเป็นสถานะ **ก่อน** ชุดนี้ ยังไม่ได้ Deploy ชุดใหม่ และยังไม่ยืนยันว่าทุกหน้าโหลดภายใน 10 วินาที

อัปเดตรอบต่อ: ผู้ใช้ยืนยัน **ไม่มี Staging; อ่านระบบเดิมได้ แต่ห้ามเขียน/แก้/ลบ DB จริง** ตรวจพบ Backup Version100 วันที่28 เวลา22:02:30 timeout 360.807s และ Incremental folder ว่าง เพิ่ม verifier/discovery ที่พักงานได้ และแก้ POS ข้าม initial render เมื่อ server ยืนยัน catalog จาก IndexedDB; ดู [หลักฐานล่าสุดและงานค้าง](READONLY-AUDIT-BACKUP-2026-10-28.md) ชุดนี้ยังไม่ Sync/Deploy และต้องรอ session ที่ Login ไว้แล้วเพื่อวัดเมนูจริง

อัปเดต29ต.ค.: ผู้ใช้ยังไม่พร้อม Login ให้ตรวจ Source/Executions ต่อ พบ getter ปี Quotation เขียน metadata และสแกนทั้ง collection เมื่อ metadata หาย แก้เป็น read-only distinct-year discovery และ seed เฉพาะ save path แล้ว; ดู [รายงาน Source/Executions ล่าสุด](SOURCE-EXECUTIONS-AUDIT-2026-10-29.md) รวมผล275 unit tests และ140 browser groups, ประวัติ Backup11 executions และข้อจำกัดการนับ Reads ยังไม่ Sync/Deploy หรือเขียน DB จริง

## 1. คำสั่งสำหรับ Codex ที่รับช่วง

```text
รับช่วงโปรเจกต์ SYY-Shop ที่ C:\Users\sudket\Documents\ChatGPT\SYY-Shop
อ่าน AGENTS.md และ docs/CODEX-HANDOFF-2026-10-28.md ให้ครบก่อนเริ่ม
ผู้ใช้อนุมัติให้แก้ประสิทธิภาพการโหลดทุกหน้าและเพิ่ม workflow แก้/ยกเลิกบิลตัดสต๊อกแล้ว มี Source implementation ตามรายงาน PERFORMANCE-STOCK-CORRECTION-2026-10-28.md ให้อ่านผลและงานค้างก่อนทำต่อ อย่าลงแพตช์เดิมซ้ำ
ให้รวมคำขอล่าสุดเรื่องเอารูปตัวอย่างออกจากตารางจัดการสินค้า โดยหยุดอ่าน metadata รูปในเส้นทางตารางด้วย และเก็บรูป/การดูรูปในรายละเอียดและแก้ไขไว้
ตรวจ source ล่าสุด วัด baseline ทำงานตามลำดับในเอกสาร ทดสอบความถูกต้องและ regression ให้ครบ แล้ว commit/push main ตามคำสั่งถาวร
อย่าเปลี่ยนการค้นหา/XLFilter ให้ค้นแค่หน้าปัจจุบัน อย่าลดการตรวจสิทธิ์ อย่าแก้ยอดสต๊อกหรือประวัติ Production โดยตรง และอย่ารับรองเวลา/เปอร์เซ็นต์ที่ไม่ได้วัด
การ Deploy ครั้งก่อนสิ้นสุดที่ Version 100 ไม่ใช่การอนุมัติ Deploy รอบใหม่หรือ backfill ข้อมูลย้อนหลัง เตรียมชุดที่ตรวจแล้วและรายงานผลก่อนขออนุมัติขั้น Production
ผู้ใช้ต้องการทำงานเงียบและสรุปภาษาไทยตอนเสร็จให้กระชับ อัปเดตเฉพาะจุดสำคัญหรือเมื่อจำเป็น
```

## 2. สถานะ ณ เวลาส่งต่อ

| รายการ | สถานะที่ตรวจแล้ว |
|---|---|
| Workspace | `C:\Users\sudket\Documents\ChatGPT\SYY-Shop` |
| Git | `main` tracking `origin/main`; ก่อน commit เอกสารนี้ HEAD คือ `a61f45858d368be035256853e2f33e6c3edeb400` และ fetch แล้ว ahead/behind 0/0 |
| Runtime ล่าสุดที่เผยแพร่ | `036e3b0cd2bdf685878e94eb5c3a84d7a5447ad8` |
| Apps Script | **Version 100**, เผยแพร่ 20 ต.ค. 2569 เวลา 06:07 Asia/Bangkok |
| Source Editor | วันที่ 28 ต.ค. อ่านกลับทั้ง 24 ไฟล์ตรงกับ main หลัง normalize CRLF/newline ท้ายไฟล์ |
| Deployment ปัจจุบัน | ตรวจหน้าจัดการวันที่ 28 ต.ค. ยังเป็น Version 100, URL/execute as/access เดิม |
| Tests ของชุดที่เผยแพร่ | 237 unit tests, 125 browser groups, syntax/manifest 71 scripts และ read-model ผ่าน ณ รอบก่อน Deploy ไม่ใช่ผลทดสอบ implementation ใหม่ |
| งานใหม่ตามเอกสารนี้ | **ยังไม่มี runtime code changes** ยังไม่ได้ถอดรูปตาราง ยังไม่มี API/UI แก้หรือยกเลิก stock issue แบบครบวงจร |
| ข้อมูลย้อนหลัง | ยังไม่รันเติมเลขบิลย้อนหลัง และไม่เคยเปลี่ยน business data เพื่อทดสอบงานนี้ |
| ไฟล์อื่นของผู้ใช้ | มี untracked `docs/SYSTEM-AUDIT-2026-10-11.md` อยู่ก่อนแล้ว ต้องรักษาไว้ ไม่ stage รวมโดยพลการ |

รายงาน deployment ที่เชื่อถือได้: [Version 100](DEPLOYMENT-2026-10-20-V100.md) อย่าอ้างข้อความสถานะเก่าใน README/รายงานรุ่นก่อนว่าเป็นสถานะปัจจุบันโดยไม่ตรวจวันที่

### URLs ที่ใช้

- [Apps Script Editor](https://script.google.com/home/projects/16P76qalO_UL1fqbI6mjSDPz0MwUI82f0ZlEXrGkvOsGdCRINM05CuORP/edit)
- [Production URL เดิม](https://script.google.com/macros/s/AKfycbydnft6V1Fxlm6fm09ySlRwb0-cODawOWGhfMmOLyTsl-7Gyki-qwT_I97CEROTwqHS/exec)
- [โฟลเดอร์ Backup ที่ผู้ใช้กำหนด](https://drive.google.com/drive/folders/1QqJRj1vet9nkcAn8-bfKDStnhXKGQqWk)

ห้ามเก็บ URL ที่มี session token, password, OAuth token หรือ local clasp credentials ใน Git/รายงาน

## 3. อำนาจอนุมัติและข้อจำกัด

- ผู้ใช้เคยสั่งให้แก้ตามการวิเคราะห์ทั้งหมด จากนั้นขอรายละเอียดผลกระทบของการถอดรูป และล่าสุดขอเอกสารส่งต่อ ไม่ได้ยกเลิกวัตถุประสงค์เดิม
- Source implementation และการ commit/push main ได้รับอนุมัติแล้ว ไม่ต้องขออนุมัติซ้ำสำหรับงานภายในขอบเขตนั้น
- ใช้ `main` ตาม AGENTS.md, fetch ก่อนรวมงาน, stage เฉพาะไฟล์ตั้งใจแก้, ordinary push เท่านั้น รักษางานผู้ใช้และ remote history
- การอนุมัติ Deploy รุ่น 100 ถูกใช้กับ release นั้นแล้ว ต้องแยกอนุมัติ deployment ใหม่
- การเพิ่ม durable snapshots/summary metadata/ดัชนี/เส้นทางเขียน ต้องระบุ design และต้นทุนให้ตรวจได้ก่อนนำไปเปลี่ยน Production ไม่เปลี่ยน schema/index/Rules/IAM/สิทธิ์บัญชีจริงเอง
- ไม่มีสิทธิ์รัน backfill เลขบิลเก่า, restore, แก้ยอด DB จริง, เปลี่ยน Trigger หรือสร้างบิลจริงเพื่อทดสอบ จากการอนุมัติ Source อย่างเดียว
- ห้ามลด authentication, session revocation หรือ role enforcement เพื่อให้เร็ว ห้ามใช้ cache แทนการตรวจสต๊อก/ราคาบน server ตอนเขียน
- การค้นหา/กรอง/เรียง/XLFilter ต้องคงความหมายครบชุดเดิม รวมข้อมูลนอกหน้าแรก

## 4. เป้าหมายที่ต้องส่งมอบ

1. ทุกหน้าแสดง **ข้อมูลหลักที่ใช้งานได้ภายใน 10 วินาที** โดยรองรับสินค้า 10,000 รายการ ไม่ใช่แค่แสดง skeleton หรือหน้าว่างเร็วขึ้น
2. เอารูปตัวอย่างออกจากตารางจัดการสินค้า และหยุดดึง metadata รูปที่ไม่ใช้ในรายการ โดยไม่ลบรูปหรือทำลาย gallery/detail/edit/export เดิม
3. ลดการอ่าน/ส่งข้อมูลซ้ำและความช้าจาก cache miss โดยรักษาความสดและ permission scope
4. เพิ่ม workflow แก้หมายเหตุ/อ้างอิง แก้จำนวน/สินค้า/ราคา/เหตุผล และยกเลิกบิลตัดสต๊อก พร้อม audit และผลต่อรายงานที่ถูกต้อง
5. มีผลวัดและ regression ที่พิสูจน์ได้ รายงานข้อจำกัดจริง ไม่กล่าวอ้างว่าเร็วขึ้นหรือ Reads ลดตามเปอร์เซ็นต์ที่ยังไม่ได้วัด

ต้องวัดทั้ง cold cache, warm cache, กลับหน้าเดิม, หลัง mutation, session/role เปลี่ยน และหลายผู้ใช้ เก็บ p50/p95/max พร้อมจำนวนรอบ แต่ไม่เปลี่ยนเกณฑ์ผู้ใช้เป็นแค่ p95 ≤10 วินาทีโดยไม่ตกลง หากทุกกรณียังทำไม่ได้ให้รายงานกรณีที่ไม่ผ่านและทางเลือก ไม่ตัด timeout จาก 45 เหลือ 10 แล้วอ้างว่าเร็วขึ้น

## 5. หลักฐานความช้าปัจจุบัน

วันที่ 28 ต.ค. อ่านหน้า Apps Script Executions ที่แสดง 50 รายการล่าสุด ได้ผลดังนี้:

| Handler | ตัวอย่าง | ต่ำสุด–สูงสุด (วินาที) | Median | p95 ของตัวอย่าง | มากกว่า 10 วินาที |
|---|---:|---:|---:|---:|---:|
| apiGateway | 44 | 1.451–23.217 | 4.915 | 15.281 | 6 |
| doGet | 5 | 0.888–1.663 | 1.496 | 1.663 | 0 |
| authLogin | 1 | 5.754 | 5.754 | 5.754 | 0 |

**ขอบเขตหลักฐาน:** ตัวอย่างนี้ไม่ใช่เวลา click-to-data รายหน้า ไม่ใช่ผลก่อน–หลัง และ apiGateway รวมได้ทั้ง reads/writes log ไม่บอกชื่อ operation จึงยังบอกไม่ได้ว่า 23.217 วินาทีเป็นหน้าใดหรือเป็นการอ่าน ค่าจริงรวม browser/network/render ยังต้องวัด

ตอนตรวจยังไม่มี authenticated shop session ใน Browser ของ Codex ได้เปิดหน้า Login และขอผู้ใช้ Login โดยไม่ขอ password ในแชตแล้ว ผู้รับช่วงต้องตรวจสถานะ Browser ใหม่ ไม่ถือว่า login สำเร็จจากการ login บัญชี Google ใน Editor

### ผลจำลองถอดรูปในตาราง

จำลองกับ backend เดิมใน local mocks โดยข้าม `getProductImageBatch_` เฉพาะ fixture ยังไม่ได้เพิ่ม option หรือแก้ Source จริง กำหนดสินค้า/รูปครบและ master อ้างอิงร่วม 5 รายการ cache ว่าง ใช้ cursor browse:

| ขนาดหน้า | ก่อน (เอกสารที่คืนจาก query/batchGet) | หลังไม่อ่านรูป | ลดลง | JSON ก่อน → หลัง |
|---|---:|---:|---:|---:|
| 25 | 56 = สินค้า 26 + references 5 + รูป 25 | 31 | 44.6% | 14,149 → 12,325 bytes |
| 50 | 106 = สินค้า 51 + references 5 + รูป 50 | 56 | 47.2% | 27,778 → 24,125 bytes |

มี lookahead สินค้า 1 แถว ตัวเลขนี้ไม่รวม auth/session reads, index-entry billing, missing-document charges, การใช้ cache จริง หรือเวลาเครือข่าย Payload ลดประมาณ 13% ใน fixture เท่านั้น ไม่ใช่หลักฐานว่าเว็บเร็วขึ้น 45–47% รูปปัจจุบันใช้ lazy loading และตารางไม่รอรูป binary โหลดครบ จึงห้ามสัญญาว่าถอดรูปอย่างเดียวจะทำให้ request 23 วินาทีเหลือไม่เกิน 10

## 6. แผนงานตามลำดับ

### P0 — A. ยืนยัน baseline และเพิ่มการวัดที่จำเป็น

- ตรวจ main/Editor/Deployment อีกครั้งก่อนแก้ รักษา Source ที่มีคนแก้ด้วยมือ
- แยกช่วง click→frame, auth/session, cache, DB fetch/จำนวนเอกสาร, payload, JSON decode และ render
- ใช้ `syyCacheStats.byApi`, `syyRecordViewTiming` ที่มีอยู่ก่อนเพิ่ม telemetry ใหม่ ข้อมูลสรุปต้องมีชื่อ operation/cache hit/miss/version และ correlation ที่ไม่เป็น credential
- ไม่บันทึก token/password/customer rows และไม่เขียน Firestore ทุก metric จนเพิ่มค่าใช้บริการเอง
- ทำเส้นทางทดสอบแบบอ่านอย่างเดียวของหน้าจริงหลัง Login ก่อนสร้างข้อมูล Staging สำหรับงานเขียน

### P1 — B. ถอดรูปจากตารางจัดการสินค้าให้ครบทั้ง UI และ backend

- ลบคอลัมน์รูปจาก `PRODUCT_COLUMNS`, preset งานขาย/ข้อมูลครบ และ normalize preference เก่าที่เคยเลือก `image`; รักษาคอลัมน์/ขนาดหน้าอื่นของผู้ใช้ ไม่ reset ทั้ง preference โดยไม่จำเป็น
- ไม่ใช้ CSS ซ่อน `<img>` อย่างเดียว ต้องไม่สร้าง image DOM และไม่อ่าน Product_Images ใน request ตาราง
- ออกแบบ option ของ list API อย่างชัดเจน เช่น `includeImages:false` โดยคง default เดิมให้ caller อื่น; ตรวจ validation/cache keys/cursors/persistent-cache identity ไม่ให้ response แบบมีรูปและไม่มีรูปปนกัน
- ครอบคลุมทั้ง `getAllProducts({paged:true})`, cursor browse, search/filter fallback, หน้า 2+, refresh และ cache restore
- รายละเอียด/แก้ไข/zoom/gallery ยังโหลดรูปเมื่อเปิดจริง ไม่ตีความรายการไม่มี image fields ว่า “สินค้านี้ไม่มีรูป” ไม่บันทึกทับ metadata รูปเป็นค่าว่าง
- Export เดิมมีคอลัมน์ URL รูป หากคงไว้ให้ hydrate เมื่อ export อย่างชัดเจน ไม่ดึงรูปทุกครั้งที่เปิดตาราง; ไม่เปลี่ยนความหมาย export เงียบ ๆ
- อย่าถอดรูปหน้า POS หรือส่วนอื่นเพิ่มเอง คำขอถอดรูปเจาะจงตารางจัดการสินค้า

**ผลรับงาน:** เปิด/เปลี่ยนหน้า/ค้น/กรองตารางไม่เกิด image requests หรือ Product_Images reads จากเส้นทางรายการ; detail/edit/export ที่เกี่ยวข้องยังได้รูปครบ และ Viewer ยัง read-only

### P1 — C. ลดเวลารอเริ่มต้นและ resources ที่ไม่จำเป็น

- POS, Quotations, Tax Invoice, PO และหลาย master pages ยังเริ่มข้อมูลที่ `window.onload` ให้เริ่มเมื่อ DOM พร้อมโดยจัดลำดับ initialization ให้ถูกต้อง
- Products เคยแก้ให้เริ่มเร็วและแยก edit dropdowns แล้ว อย่าย้อนพฤติกรรมนี้
- Lazy-load library หนักตามการใช้ เช่น XLSX export/JsBarcode ห้ามทำให้การดึงรายการรอ library ที่ยังไม่ใช้; แค่ใส่ defer แล้ว DOMContentLoaded ยังรอไฟล์นั้นอาจไม่แก้คอขวด
- ป้องกัน init/pager/draft/view restore ยิง bootstrap สองครั้ง รักษา focus, filter, หน้าปัจจุบันและร่าง
- คง iframe ที่เปิดแล้ว ไม่ reload ทั้งหน้าเมื่อสลับเมนูหรือหลัง delta โดยไม่จำเป็น

### P1 — D. Cache ที่ใช้ร่วมและโหลดข้อมูลเป็นส่วน

- ปัจจุบัน memory cache แยก iframe; IndexedDB whitelist เน้น product browse และ Brands/Categories ไม่ใช่ full POS/Dashboard catalog
- เพิ่มการใช้ข้อมูล catalog/snapshot ร่วมกันใน scope project/deployment/account/role ที่ตรวจแล้ว ไม่เก็บ credential หรือถือ cache ว่าเป็นสิทธิ์
- ตรวจ auth/role ก่อนนำ persistent business data มาแสดง ตัด cache เมื่อ logout, account/role/session เปลี่ยน, schema/version เปลี่ยน หรือ data invalidation
- เก็บ chunk/manifest/version/expiry อย่างมีขอบเขต รองรับ quota, partial/corrupt cache, IDB unavailable, storage errors และ memory fallback
- Coalesce requests เดียวกัน ส่งเฉพาะ delta หรือ version confirmation เมื่อข้อมูลไม่เปลี่ยน ไม่ prefetch ทุกหน้าจนเพิ่ม reads
- ใช้ postMessage เฉพาะ source/origin/channel ที่ผูกไว้ รักษาการป้องกัน menu blank/frame readiness ที่ทำมาแล้ว
- ลดเวลารอ `withReadLease_` ซึ่งปัจจุบัน 20×500 ms + overhead แต่ห้ามกลับไปทำ full scan ซ้ำพร้อมกันจำนวนมากหรือถือว่าแค่ตอบ “กำลังเตรียม” ผ่านเป้า 10 วินาทีแล้ว
- แยก/ย่อ result snapshots แทนเพิ่มเพดาน cache อย่างเดียว ปัจจุบัน cache ทั่วไปเกิน 60×16000 ตัวอักษรจะไม่ถูกเก็บ; compact catalog เพดาน 200×16000
- local fixture movements 10,000 แถว ขนาด 3,066,686 ตัวอักษรยืนยันว่า dashboard result cache ไม่ถูกเก็บ แต่ยังไม่ยืนยันว่า Production payload เกินเพดาน ต้องวัดจริง

**ขอบเขตเพิ่มเติมที่ต้องเตรียมให้ review:** หากใช้ durable snapshot หรือ materialized summaries ให้ระบุที่เก็บ ขนาด chunk, owner/version, rebuild, invalidation, concurrent writes, correction/restore handling, backup และ Reads/Writes ที่เพิ่มก่อนนำไปใช้จริง ไม่เพิ่ม polling หรือ full scan ทุก mutation

### P1 — E. แยก bootstrap รายหน้า

| หน้า | งานที่ต้องปรับ | สิ่งที่ห้ามทำให้ผิด |
|---|---|---|
| POS | ปัจจุบัน `loadProducts()` รอ compact catalog ทั้งหมด ใช้ shared/versioned catalog, ชุดแรกที่เลือก/สแกนได้จริง, targeted barcode lookup เมื่อเหมาะสม | การค้นหา substring/หมวดหมู่/จำนวนทั้งหมดต้องครบ ไม่แสดง “ไม่พบ” เพราะยังโหลดบางส่วน; ต้องอ่านสต๊อก/ราคาจริงก่อนเขียน |
| Dashboard | แยก stock health/KPI/กราฟ/drilldown; ใช้ summary snapshot ที่ตรวจ version แทนส่ง movements ทั้งช่วงทุกครั้ง | ยอดรวมทั้งช่วงต้องไม่กลายเป็นยอดเฉพาะ 50 แถว ห้ามเปลี่ยนสูตร health/aging โดยไม่ได้อธิบาย |
| Products | คง bounded cursor/paging, metadata อ้างอิงเฉพาะที่ใช้ และไม่มีรูปในเส้นทางรายการ | คง global search/sort/XLFilter และ export ครบ |
| Quotation/Tax Invoice | แยกรายการ/years จาก products/customers ที่ใช้สร้างฟอร์ม; โหลดตามแท็บ/การเปิด editor | หน้า build ที่เปิดอยู่ต้องมี picker ที่ทำงานจริงและค้นครบ รักษาราคา/ส่วนลด/ภาษีเดิม |
| PO | แยก history, low-stock และ pending summary ไม่รอกันก่อนเห็นรายการ | ประวัติต้องต่อครบได้ ยอดค้าง/รับของและ state ต้องไม่ถูกคำนวณจากหน้าปัจจุบันอย่างเดียว |
| Master pages | DOM-ready, reuse scoped cache และ windowed render เมื่อข้อมูลมาก | การบันทึก/ลบ/อ้างอิงในสินค้าและร่างเดิมต้องทำงาน |
| Profile/Users/Activity | แยกส่วนที่โหลด ใช้ bounded lists ตาม API ที่รองรับ ไม่ prefetch ข้อมูลอ่อนไหว | ไม่ cache สิทธิ์/ข้อมูลผู้ใช้จน session revocation ใช้ไม่ได้ |
| Backup UI | เปิดหน้าสถานะให้เร็วและทำงานยาวแบบ job/checkpoint | ไม่อ้างว่า full backup ต้องสร้างไฟล์ครบใน 10 วินาที หรือว่างานสำเร็จทั้งที่ยัง pending/failed |

การแยกโหลดลดเวลารอ แต่หากภายหลังยังดึงทุกแถว จำนวน reads รวมอาจเท่าเดิม/มากขึ้น ต้องตรวจทั้งเวลาและต้นทุน ไม่ใช้จำนวน DOM rows หรือ projection อ้างว่า billed reads ลด

### P1 — F. ออกแบบ workflow แก้/ยกเลิกบิลแบบรักษา ledger

ปัจจุบัน `issueStock_` เป็น create-only, request UUID ผูก `Request_Fingerprint` และ `Request_Result_JSON` ใน movement แรก การใช้ requestId เดิมส่ง payload ที่แก้ต้องถูกปฏิเสธตามเดิม ห้ามทำให้กลายเป็นแก้รายการเงียบ ๆ

**ความสามารถหลักที่ต้องเพิ่ม:**

| กรณี | พฤติกรรมที่ต้องมี |
|---|---|
| หมายเหตุ/อ้างอิงที่ไม่กระทบธุรกิจ | Amendment ที่เก็บ before/after, ใคร/เมื่อไร/เหตุผลและ revision; ไม่แตะสต๊อก |
| จำนวนผิด | Preview ผลต่างและปรับจากสต๊อกปัจจุบัน; เก็บรายการเดิมและ correction/replacement ที่เชื่อมกัน |
| สินค้าผิด | ย้อนผลสินค้าตัวเดิมและตัดตัวใหม่ในธุรกรรมเดียว ตรวจ stock ของทุกตัวที่กระทบ |
| ราคาผิด | Adjustment มูลค่าหรือรายการทดแทนที่ตรวจราคาบน server ตามสิทธิ์ เก็บราคาขาย/ทุนเดิม ไม่เปลี่ยนราคาสินค้าทั้งระบบ |
| เปลี่ยนเหตุผลขาย→ใช้ภายใน ฯลฯ | เป็น business correction เพราะเปลี่ยนยอดขาย/ต้นทุน ไม่ใช่แก้ข้อความทั่วไป |
| ยกเลิกบิล | Reversal พร้อมเหตุผลและสถานะ cancelled ป้องกันคืนสต๊อกซ้ำ ไม่ลบประวัติ |

การรับคืนสินค้าจริงบางส่วนเป็น workflow คนละกรณีกับแก้บิลผิด ให้เตรียม design รองรับ cumulative returned quantities/ยอดที่เหลือ แต่ไม่เพิ่มกติกาการคืนเงิน/บัญชีใหม่เองหากยังไม่ได้ตกลง

**แนวทางที่เสนอ:** ย้อนผลเดิม + รายการทดแทนที่อ้างอิงกันใน atomic commit หรือ immutable correction delta ledger ที่ให้ผลเท่ากัน ให้เลือกแบบเดียวและบันทึก design ก่อนลงรายละเอียด ไม่ทำสองแบบที่ให้ยอดไม่ตรงกัน

- เก็บ `Doc_No`, UUID และประวัติเดิมไว้เสมอ หากออกบิลทดแทนให้ใช้เลข `SI-YYYYMMDD-NNNN` ใหม่ตาม counter/reservation เดิมและเชื่อมบิลต้นฉบับ ไม่ reuse เลขยกเลิก
- หากเลือก correction delta โดยคงเลขแสดงผล ต้องมี revision และวิธีแสดง original/effective transaction ชัดเจน ไม่เขียนทับต้นฉบับจนตรวจย้อนหลังไม่ได้
- อ่านบิล/สต๊อกจริงจาก server; ใช้ CAS/updateTime/revision และ operation request UUID
- สต๊อก, correction/reversal/replacement, bill state, audit, counter/reservation ที่เกี่ยวข้อง และ quote references ต้องสำเร็จครบหรือไม่เปลี่ยนเลย
- จำกัดจำนวน affected products/writes/payload ให้ครบใน atomic commit ตามขอบเขตระบบ ห้ามแบ่งคืนของครึ่งบิล บิลใหญ่เกินขอบเขตต้องแจ้งอย่างชัดเจนก่อนเขียน
- ตัดสิน retry จากผลจริง: double-click, request ซ้ำ, commit response lost, concurrent correction, correction ชน sale/receive ต้องไม่คืนหรือตัดซ้ำ
- สิทธิ์ correction เริ่มต้นแนะนำ **Admin** ผ่าน registry/gateway ฝั่ง server พร้อมเหตุผลบังคับ; ไม่เชื่อ username/role/ราคา/stock จาก client และไม่เปลี่ยนสิทธิ์บัญชีจริงเอง
- Staff/Viewer ต้องมี UX ชัดเจนตาม role ที่อนุมัติ ไม่โชว์ปุ่มเขียนที่เรียกแล้วล้มเหลว ไม่เพิ่มสิทธิ์เพียงเพื่อหลบ error
- บิลเก่าที่ขาดราคา/ต้นทุน/อ้างอิงต้องหยุดให้ตรวจ ไม่ใช้ราคาสินค้าปัจจุบันปลอมเป็นราคาตอนขาย
- ไม่เอา `Stock_Before` เก่าไปตั้งทับ current stock; ตัวอย่าง **เดิมตัด 5 ต้องเป็น 3 ปัจจุบันเหลือ 12 → คืน 2 เป็น 14** แม้มีรายการอื่นเกิดขึ้นหลังขาย
- แนะนำเก็บเวลาแก้จริงพร้อมเวลา/บิลต้นฉบับ และอธิบายนโยบายยอดปรับปรุงรายวัน/เดือน ไม่เปลี่ยน `Timestamp`/`Committed_At` เดิมเพื่อให้ยอดดูลงตัว

### P1 — G. ปรับโมดูลที่เกี่ยวข้องกับ correction พร้อมกัน

- **Dashboard:** ตอนนี้ IN ถูกนับเป็นรับเข้า และยอดขายนับ OUT ตาม reason การเพิ่ม reversal เป็น IN เฉย ๆ จะสร้างยอดรับเข้าปลอม ยอดขายเดิมยังอยู่ และ OUT ใหม่อาจนับซ้ำ ต้องแยกชนิด event/state และ net quantity/value ให้ถูกต้อง
- ตรวจยอดขาย จำนวนบิล เฉลี่ยต่อบิล ต้นทุน/กำไร ยอดรับเข้า/ตัดออก health/aging ทุก drilldown และทุกช่วงเวลา โดยรักษาประวัติเดิมที่ตรวจสอบได้
- **Quotation:** marker ปัจจุบันเก็บ stock issue ล่าสุด และมีฟังก์ชันตัดซ้ำได้ ต้องตรวจบิลที่เกี่ยวข้องทั้งหมดก่อน reset `Stock_Issued` ไม่เคลียร์เพราะยกเลิกแค่บิลเดียว
- **Tax Invoice:** POS ส่งร่างใบกำกับจาก basket เป็นเอกสารอิสระ ต้องตรวจอ้างอิง/กำหนด workflow แก้เอกสาร ไม่ย้อนสต๊อกอัตโนมัติเพียงเพราะแก้ใบกำกับ และไม่แก้ใบกำกับที่เผยแพร่แล้วโดยเงียบ ๆ
- **History/detail:** แสดงต้นฉบับ สถานะปัจจุบัน การแก้/ยกเลิก ใคร/เมื่อไร/เหตุผล และลิงก์รายการที่เกี่ยวข้อง; อ่านเฉพาะบิลเมื่อเปิด ไม่ทำ N+1 หรือ full-history scan เพื่อวาดแต่ละแถว
- **Cache/snapshots:** invalidate เฉพาะ product codes/scopes ที่กระทบ ส่ง delta ไปหน้าที่เปิดอยู่ อัปเดต/ทำเครื่องหมาย summary ที่เกี่ยวข้องให้ถูกต้องหลัง commit สำเร็จ ไม่ full reload ทั้งระบบทุกครั้ง
- **Backup/Restore:** ฟิลด์หรือ collection ที่เพิ่มต้องถูก backup ครบ Restore ต้องไม่ทำให้ counter ต่ำลงหรือ correction replay ซ้ำ และต้องมีการตรวจ version/invalidation

## 7. จุดเริ่มอ่าน Source

เลขบรรทัดเป็นของ baseline นี้ อาจเลื่อนเมื่อแก้ ให้ยึดชื่อฟังก์ชันเป็นหลัก

| ไฟล์ | จุดที่เกี่ยวข้อง |
|---|---|
| `Master_Products.html` | `PRODUCT_COLUMNS` ~462, presets/preferences, `renderProductCell` ~564, `loadProductPage` ~765, row image rendering, detail/gallery/edit/export |
| `Code.gs` | `writeResultCache_` ~612, `withReadLease_` ~625, `getProductCatalogRows_` ~1110, `getProductCatalogPage_` ~1142, `getProductBrowsePage_` ~1191, `getProductImageBatch_` ~1246 |
| `Shared.html` | scoped cache/IDB, `syyReadPolicy`, `callApi` ~597, timeouts, `syyMovementDetailHtml` ~774, frame/security/freshness helpers |
| `StockIssue.html` | window.onload ~338, `loadProducts` ~427, basket/retry/uncertain writes, movement paging/search/detail |
| `index.html` | iframe open/switch ~750–810, `dashLoad` ~895, aggregates/health, document drawers, sales details |
| `Code.gs` | `documentPageSections_` ~2122, invoice/quotation PageData, PO bootstrap/summary |
| `Code.gs` | `fsCommit_` ~4834, `issueStock_` ~4911, `stockMovementDto_` ~5105, `getStockMovementDetail_` ~5131, `mapDashboardMovementRow_` ~5260, Dashboard bootstrap/delta, `stockRequest_`/`replayStockRequest_`/`sealStockRequest_` |
| `Quotation.html`, `Master_Tax_Invoice.html`, `Purchase_Orders.html` | first load/pager/sections, authoritative prices, quote markers, receiving, invoice handoff |
| `tests/support/services.cjs` | In-memory Firestore/GAS services; supports CAS/atomic commits/hooks/lost responses; ไม่ต่อ Production |
| `tests/browser.cjs` | Local HTML + mocked gateway + blocked external HTTPS; held requests, errors, role/large-dataset fixtures |

## 8. เกณฑ์ทดสอบที่ต้องเพิ่มและรักษา

### Performance / image-free table

- Table 25/50/100 rows, หน้าถัดไป, query/filter/sort/XLFilter และ refresh/cache restore ไม่มี Product_Images fetch เมื่อไม่ต้องใช้รูป
- Thumbnail DOM และ network image requests ในรายการต้องเป็นศูนย์ รูปใน detail/edit/zoom ยังคงโหลดถูกตัว และ imageUpdateTime/concurrent image changes ไม่หาย
- Preference เก่าที่มี image, presets, mobile/desktop, roles, search สินค้าตัวท้ายของ 10,000 แถว และ export ครบทุกแถว/fields ผ่าน
- Cold/warm, หลัง mutation, concurrent tabs/users, IDB corrupt/quota failure, cache chunk missing/oversize/expired, producer slow/fails ต้องไม่ค้าง/แสดง empty success
- Skeleton ไม่ค้าง; retry กู้คืนได้; response เก่าไม่ทับหน้าใหม่; paginator ไม่เด้งหน้าแรก; ร่าง/scroll/focus ไม่หาย
- ไม่เกิด full catalog/collection scans ในเส้นทาง browse ปกติโดยไม่จำเป็น และไม่เพิ่ม metric/polling writes

### Stock correction / security / accounting

- ตัวอย่าง 5→3/current12 ได้14; แก้เป็นมากขึ้น, เปลี่ยน SKU, เปลี่ยนราคาอย่างเดียว, เปลี่ยน reason, cancel, แก้ซ้ำ/คำขอซ้ำ
- คำขอ retry เดิมหลัง original bill commit ต้องไม่กลายเป็นบิลใหม่/คืนสต๊อกใหม่ แม้บิลถูกแก้แล้ว
- Two admins แก้ revision เดียวกันพร้อมกัน, ขาย/รับสินค้าแทรก, stale preview, server read failure, CAS failure, commit lost response ต้องได้ทั้งหมดหรือไม่มีผล
- สต๊อกไม่พอ, เกินจำนวนที่ย้อนคืนได้, negative/NaN/infinite/invalid input, ราคา 0/ทศนิยม/negotiated quote price, missing legacy fields, รายการใหญ่เกินขอบเขต ต้องจัดการอย่างถูกต้อง
- ยอด sales/receipts/issues/net totals/profit/bill count/aging และรายละเอียด ต้องตรงกันหลัง cancel/replacement ทั้งเดือนเดียวกันและข้ามช่วงรายงาน
- ตรวจ quote หลายบิล, independent tax invoice, original numbering/UUID, daily counter/Bangkok midnight และเลขเก่าที่ยังไม่ backfill
- Viewer/Staff เรียก write โดยตรงไม่ได้เมื่อ policy ไม่อนุญาต forged identity/role/price ถูกปฏิเสธ session revoked/expired และ cache ข้ามผู้ใช้ไม่เปิดข้อมูล
- ไม่มี raw CRUD endpoint ที่ bypass gateway และ audit metadata ไม่รั่ว credentials

### คำสั่งตรวจหลัก

```text
npm test
npm run check
npm run test:browser
npm run test:browser-backend
npm run test:reads
npm run release:prepare
node scripts/prepare-release.cjs --verify <release-directory>
git diff --check
```

หา runtime/packages ที่มีอยู่ก่อน install; ใช้ `load_workspace_dependencies` หากจำเป็น Browser tests ใช้ Playwright/Chrome ถ้า module path ไม่พบ ให้ใช้ bundled node_modules ตาม tool ปัจจุบัน ห้าม hardcode ว่า bundle รุ่นเก่ายังอยู่ จำนวน tests ต้องรายงานตามรอบใหม่ ไม่ reuse 237/125 ว่าเป็นผลของงานใหม่

ไม่ต้องเขียน test ที่แค่ลอก implementation แต่ต้องมี tests ที่ตรวจธุรกรรม/ผลรวม/permissions/races และวัด cold/warm ที่มีความหมาย

## 9. งานค้างเดิมที่ต้องแยกจาก release นี้

1. **เลขบิลย้อนหลัง:** เตรียม private inspect/plan/apply ไว้แล้วใน [แผนเลขบิล](SALES-BILL-NUMBERS-2026-10-19.md) ยังไม่เคยอนุมัติ mapping/hash หรือรัน Production อย่า backfill อัตโนมัติขณะ Deploy/cache rebuild; อย่า renumber เลขที่ออกแล้ว
2. **Backup:** เมื่อ Deploy รุ่น100 หน้า Trigger แสดง historical error 71.43%, last run 19 ต.ค. 22:02:30 เป็นหลักฐานเก่าวันที่20 ไม่ใช่สถานะวันที่28 ต้องตรวจ executions/manifests/ความครบของ backup ใหม่แบบอ่านอย่างเดียวก่อนสรุป ห้ามอ้างว่า Backup ใช้งานได้เพราะมี Trigger
3. **Read/Write monitoring:** ผู้ใช้เคยขอ monitor ผลจริง ยังไม่มี baseline billed usage/ผลเปรียบเทียบที่พิสูจน์แล้วในงานล่าสุด อย่าอ้างว่าลดค่าใช้บริการตามผลจำลอง ต้องเทียบช่วงเวลา/จำนวนผู้ใช้/ธุรกรรม/Backup และ cache cold/warm ที่เทียบกันได้ ถ้าจะตั้ง automation ให้ตรวจของเดิมก่อน ไม่สร้างซ้ำ และใช้เครื่องมือ automation ของแอป
4. **Authenticated UAT:** รอบ Version100 ตรวจ Login + checksum แต่ไม่ได้ทดสอบสร้างบิลจริง ห้ามสร้างข้อมูลขายบน Production โดยถือว่าเป็น smoke อ่านอย่างเดียว

## 10. การส่งมอบ / Rollout

- แบ่ง implementation เป็นชุดที่ review ได้ เช่น image-free list + init, scoped cache/bootstrap, correction + accounting modules ไม่รวมการเปลี่ยนธุรกิจที่ไม่เกี่ยวข้อง
- รัน checks ที่เหมาะสมก่อน commit/push ทุกชุด และระบุ dependency ของชุดถัดไป ถ้ายังไม่จบทั้งหมดอย่ารายงานว่าปรับครบ
- สรุป Files Changed, พฤติกรรมก่อน/หลัง, ผลทดสอบ/จำนวนจริง, measured timings, ผล Reads/Writes, commit SHA, และ Deployment Status
- ชุดถอดรูปควรไม่มี business DB writes; summary metadata/corrections มี write footprint ต้องแจกแจงต่อ operation และกรณี contention ไม่อ้างว่าไม่มีผลกระทบ DB
- เตรียม review release จาก source ที่ตรง commit และตรวจ checksum ไม่ hardcode ว่าต้องมี24ไฟล์ถ้ามีการเพิ่ม runtime fileจริง ต้องตรวจ manifest/include/route dependencies ครบ
- ก่อน Deploy ขออนุมัติ release/URL/ขอบเขตชัดเจน สำรอง sourceจริง ตรวจ concurrent manual changes คงสิทธิ์/Trigger/URLเดิม แล้วอ่าน saved Head และ immutable published version เทียบ checksum
- หลัง Deploy ตรวจ Login และ read-only authenticated workflows; staging ใช้ข้อมูลจำลองสำหรับ correction/cancel/price/stock ไม่ใช้ Production เป็น test fixture
- Rollback source ไม่เท่ากับ rollback data ห้ามลบ/รีเซ็ต counter/reservations/ledger หรือย้อนสต๊อกที่มีรายการจริงเกิดแล้วโดยไม่มีแผนและอนุมัติ

## 11. หลักฐานและเอกสารประกอบ

เอกสาร tracked ที่ผู้รับช่วงอ่านต่อได้จาก Git:

- [คำสั่ง Git/ขอบเขตโครงการ](../AGENTS.md)
- [Deployment Version100](DEPLOYMENT-2026-10-20-V100.md)
- [เลขบิลรายวันและแผนย้อนหลัง](SALES-BILL-NUMBERS-2026-10-19.md)
- [แก้โหลดข้อมูล/สเกเลตันรอบก่อน](DATA-LOADING-DASHBOARD-2026-10-19.md)
- [แก้เมนู/iframe readiness](MENU-FRAME-RECOVERY-2026-10-19.md)
- [Hybrid cache และ 10,000 products](HYBRID-CACHE-2026-10-16.md)
- [Version-first cache](VERSION-FIRST-CACHE-2026-10-16.md)

หลักฐาน local ที่ไม่ได้อยู่ใน Git (อาจไม่มีในเครื่องของผู้รับช่วงใหม่):

- `test-results/performance-audit-2026-10-28/ANALYSIS.md`
- `test-results/performance-audit-2026-10-28/source-comparison.json`, `editor/`, `deployment-current.txt`, `executions.txt`, `execution-summary.json`
- `test-results/deploy-036e3b0-2026-10-20/` และ review release ของ runtime036e3b0

ข้อเท็จจริงสำคัญจากหลักฐาน local รวมไว้ในเอกสารนี้แล้ว อย่าใช้การไม่มีไฟล์ ignored ใน fresh clone เป็นเหตุให้เดาตัวเลขหรืออ้างว่ามีผลวัดใหม่

แหล่งอ้างอิงทางเทคนิคที่ตรวจไว้:

- [Apps Script Best Practices](https://developers.google.com/apps-script/guides/support/best-practices)
- [HTML Service Best Practices](https://developers.google.com/apps-script/guides/html/best-practices)
- [Firestore Best Practices](https://firebase.google.com/docs/firestore/best-practices)
- [Firestore Transactions / Batched Writes](https://firebase.google.com/docs/firestore/manage-data/transactions)
