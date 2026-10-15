# Hybrid Cache audit and implementation — 16 October 2026

**Rollout ภายหลัง:** ผู้ใช้อนุมัติ Deploy และอัปเดต URL เดิมเป็น Version 96 เมื่อ 16 ตุลาคม 2569 เวลา 06:31 แล้ว ตรวจ published Source ครบ 24/24 ไฟล์ตรง `3860e9d` และ Login smoke ผ่าน ดู [ผล Deployment](DEPLOYMENT-2026-10-16.md) ข้อความ “ยังไม่ Deploy” ด้านล่างเป็นสถานะ ณ implementation; ข้อจำกัด Delta/production UAT ยังใช้ตามเดิม

## ขอบเขตและสถานะ

ตรวจและปรับจาก `main` baseline `57da06e22b500629bcad9751cef10e6ec722ec54` ตาม Hybrid Cache task โดยคง HTML Service → `google.script.run` → `apiGateway` → Firestore REST เดิม ไม่เพิ่ม Firebase SDK, Redis, Cloud Functions หรือ dependency ใหม่

**ทำแล้วใน Source:** IndexedDB สำหรับ reference ที่ไม่อ่อนไหว, การตรวจสิทธิ์ก่อนนำ persistent response กลับมาใช้, Cache ข้ามแท็บใน Session เดียวกัน, Cursor สำหรับการเปิดตารางสินค้าปกติ, Projection/Batch สำหรับข้อมูลอ้างอิง และ Regression tests

**ยังไม่ครบทุกข้อของ task:** ไม่มี `sync_meta`/ordered change log/tombstones ที่ผูก atomic กับทุก write, ไม่ได้เปลี่ยนการค้นหา substring/XLFilter เป็น indexed search และไม่ได้ persist Product Detail/Page ที่มีต้นทุน/สต๊อกลง IndexedDB ส่วนเหล่านี้ระบุแผนและข้อจำกัดด้านล่าง ไม่อ้างว่าเป็นระบบ Delta ครบทุก collection หรือ Production verified

รอบนี้ไม่มีการอ่าน/เขียน Production, Sync Apps Script, Deploy, ตั้ง Trigger, เปลี่ยน schema/index/IAM/credentials/role จริง การส่ง `origin/main` เป็นไปตามคำสั่ง Git ถาวรของผู้ใช้

## A. Current architecture และ Baseline

| เส้นทาง | สิ่งที่ตรวจพบก่อนปรับ | ผลในรอบนี้ |
|---|---|---|
| `Shared.html`: `callApi`, `syyReadPolicy`, `syyStoreRead` | มี Map, TTL, single-flight, copies, scope invalidation และ sessionStorage แล้ว ไม่มี IndexedDB | ใช้ของเดิม เพิ่ม persistent layer เฉพาะ allowlist และ LRU touch |
| `getAllProducts_({paged:true})` → `getProductCatalogPage_` | แบ่ง payload แต่ cold request ยังอ่าน products ทั้ง collection เพื่อกรอง/เรียงใน Apps Script | New client ขอ `cursorMode:true`; การ browse ไม่กรอง/เรียงรหัส ใช้ REST `runQuery` ทีละหน้า |
| `getProductCatalogRows_`, facets, substring search | catalog ครบชุดจำเป็นต่อพฤติกรรมค้นหาเดิม; raw/compact catalog ถูกเก็บแบบ chunk ใน Script Cache | คง fallback สำหรับ global search/filter/export; ordinary browse ไม่สร้าง catalog นี้ |
| `readProductReferenceDocs_` | ข้อมูลอ้างอิงอ่านราย ID และอาจอ่าน ID เดิมซ้ำ | Deduplicate, batch สูงสุด 100 IDs/request, fetchAll, projection เฉพาะ browse |
| `apiGateway` | ตรวจ Session, user จริง, role, allowlist, read limit ก่อน cached/not-modified response | คงลำดับเดิม เพิ่ม optional `restartPage` ใน error สำหรับ browse |
| `clientReadVersion_` | generation UUID ใน Script Properties ใช้ตรวจ version โดยไม่อ่าน Firestore metadata | คงใช้ตรวจการเปลี่ยนผ่านแอป ไม่อ้างว่าเป็น sequential/atomic sync version |
| Dashboard | `Committed_At`/cursor/overlap และ authoritative stock checks มีอยู่แล้ว | ไม่เปลี่ยนธุรกรรมหรืออ้างว่า stock delta เป็น change feed ของ product/master delete |
| Backup | snapshot ทุก collection แม้ Incremental output มีเฉพาะการเปลี่ยนแปลง | ไม่เปลี่ยนเป็น CDC และไม่รันจริง |

Baseline fixture 10,000 สินค้า: legacy product page อ่านเอกสารสินค้า 10,000 รายการก่อนส่ง 50 แถว; warm repeat ใช้ Server Cache ได้อยู่แล้ว จึงไม่ควรนำ 99.49% ไปคูณกับทุกการใช้งานเดิม

Reference files `CacheApi.gs`, `CacheClient.html`, `IntegrationExample.html` ไม่พบใน repository จึงไม่ได้คัดลอก reference implementation ทับระบบ

## B. Findings และ Action Items

| Priority | Issue | Root Cause | Risk | Recommended Fix | Status |
|---|---|---|---|---|---|
| P1 | เปิดตารางสินค้า cold อ่านครบ 10,000 | page เป็นการ slice catalog ใน memory | Reads/Apps Script latency สูง | Snapshot cursor, `limit=pageSize+1`, projection | ทำแล้วสำหรับ ordinary browse |
| P1 | ไม่มี durable reference cache | sessionStorage อย่างเดียว | ส่ง reference เดิมซ้ำหลังเปิดหน้าใหม่ | IndexedDB allowlist + server validation | ทำแล้ว: Brands/Categories |
| P1 | Session/role เปลี่ยนขณะ response กำลังกลับ | response ตรวจ identity snapshot แต่ไม่ได้คำนวณ identity ใหม่ | คำตอบเก่าอาจกลับมาใส่ memory | ตรวจ identity อีกครั้งก่อน callback/restore | ทำแล้วและมี regression |
| P1 | หลายแท็บอาจใช้ snapshot เก่าหลังอีกแท็บเขียน | เดิมส่งเฉพาะ trusted parent/child messages | แสดงข้อมูลเก่าจน revalidate | Session-scoped BroadcastChannel, local revision fence | ทำแล้วภายใน origin/session เดียวกัน |
| P1 | ทุก write ยังไม่มี atomic change event | หลาย PATCH/POST/DELETE และ stock commits คนละเส้นทาง; generation เปลี่ยนหลัง DB commit | ขยาย Delta แล้วข้าม update/delete ได้ | ออกแบบ atomic journal ทุก writer ก่อนเปิด CDC | ออกแบบแล้ว ยังไม่ implement/เปิดใช้ |
| P1 | substring/facets ต้องเห็นข้อมูลทุกแถว | ไม่มี normalized search index; filter อาศัย joined names/เปรียบเทียบ stock | ถ้าแทนด้วย filter เฉพาะหน้าจะค้นไม่ครบ | คง complete fallback จนมีแผน search index ที่รักษาความหมายเดิม | คง fallback; งาน index ยังเหลือ |
| P2 | ข้อมูลอ้างอิงซ้ำหลาย ID | loop อ่านทีละรายการ | REST requests เพิ่ม | dedupe + batch + whitelist collection | ทำแล้ว |
| P2 | การ restore จาก sessionStorage ใช้ cached result ก่อนยืนยัน Session รอบใหม่ | checkedAt เดิมยังอยู่ใน TTL | authorization freshness ลดลงตอนเปิดหน้าใหม่ | restore แล้ว revalidate ก่อนคืน response | ทำแล้ว; อาจมี RPC เพิ่มหนึ่งครั้งหลัง reload |
| P2 | DB/Browser Cache เสียหรือโควตาเต็ม | Storage เป็น best effort | UI ค้างหรือเกิด uncaught callback error | bounded open/transaction, validation, eviction, guarded callbacks | ทำแล้ว |
| P2 | raw/compact full catalogs ยังอาศัย Script Cache แบบ chunk | global-search compatibility เดิม | CacheService pressure/eviction ใน complex workloads | วัดจริง แล้วออกแบบ search index/ปรับ catalog footprint | ยังเหลือ; ordinary browse เลี่ยงแล้ว |

ไม่พบช่องทางใหม่ที่ข้าม gateway/role จากงานนี้ ผล security tests เป็นหลักฐานของรายการที่ทดสอบ ไม่ใช่การรับรองว่าไม่มีช่องโหว่ใดเลยทั้งระบบ

## C. Implementation

### Layer 1: Memory และ request coordination

- ใช้ Map เดิม จำกัด 40 entries / serialized text 6 ล้านตัวอักษร (ไม่ใช่จำนวน byte จริงของ JavaScript heap); แตะลำดับ LRU เมื่ออ่าน ไม่ต่ออายุข้อมูลต้นทาง
- Key เดิมรวม API + canonical args; identity/epoch แยก account, role, Session และ write scopes; cursor/query/sort/pageSize อยู่ใน args ด้วย
- มี single-flight สำหรับ RPC เดิมและ response copies; Cursor browse สามารถ reuse visited page ใน memory ได้ ส่วน export cursor ยัง bypass แบบเดิม
- ตรวจ identity ใหม่ก่อนส่ง cached callback, หลัง IndexedDB lookup และหลัง RPC response เพื่อกัน Session เปลี่ยนระหว่างรอ
- การเขียนที่สำเร็จ invalidate ตาม API scopes เดิม; transport uncertainty ยัง invalidate ตามเดิม ไม่ใช้การ invalidate เป็นหลักฐานว่าเขียนสำเร็จ

### Layer 2: IndexedDB

- DB ชื่อ `syy-hybrid-cache`, schema version 1, stores `records` และ `meta`; initialization สร้างเฉพาะ stores ที่ขาด และปิด connection เมื่อ version เปลี่ยน
- **Allowlist เฉพาะ `getBrands[]`, `getCategories[]`** พร้อมฟิลด์ `id`, `Name`, `name`, `updateTime` เท่านั้น; extra fields/ผิดชนิด/ข้อมูลใหญ่เกินขอบเขตไม่ persist
- Vendors/Customers/Dropdown รวม/Users/Permissions/Orders/Transactions/Product pages/details ไม่ลง IndexedDB เพราะมี contacts, free text หรือ commercial/stock values; product pages ยังใช้ memory เดิม ไม่มีการตัด fields ออกจาก response ที่ผู้ใช้ต้องเห็น
- Scope เป็น SHA-256 ของ Session identity และ app URL ใน memory; เก็บเพียง fingerprint ไม่มี token, OAuth credential, password หรือ authorization decision ลง IndexedDB; fingerprint ไม่ใช่ credential ที่ใช้เรียก API ได้
- Record มี dataset version, original loadedAt, checkedAt, expiresAt, syncedAt, schema และ local revision อายุไม่ขยายจาก cache ชั้นก่อน
- ทุก restore จาก IndexedDB หรือ sessionStorage ต้องผ่าน gateway validation ก่อน callback ให้หน้าเว็บ ไม่ทำ offline-first display ของ protected data
- Read/open/transaction มี fallback และ deadline 1.2 วินาทีต่อขั้นตอน; corruption ไม่ผ่าน validation, quota/abort/private mode ใช้ network + memory ต่อ
- Prune expired/corrupt entries และเก่าสุด จำกัดต่อ scope 40 records / ประมาณ 2 MB ของ raw UTF-16 และรวมทุก scope 80 records / ประมาณ 8 MB (ไม่รวม IndexedDB overhead และ revision metadata ขนาดเล็ก)
- Invalidation ล้าง persistent records ใน Session scope ทั้งชุดเพื่อให้ revision fence เรียบง่าย; memory ยัง invalidate แค่ dependencies การเพิ่มข้อมูลไม่ต้องมี DB write เพื่อจัด Cache
- Atomic transaction ใน **local IndexedDB** ตรวจ revision ก่อน publish ป้องกัน put เก่ากลับมาหลัง purge; ไม่ใช่ Firestore sync journal
- Logout/session/role change ล้าง scope; tabs ที่ใช้ Session เดียวกันรับ invalidation/logout โดยไม่ส่ง business data/token ผ่าน channel พร้อมเรียก freshness guard ของหน้าที่ active
- ข้อจำกัด: browser storage เป็น untrusted, XSS/ผู้ใช้ควบคุมเครื่องยังแก้ local data ได้; write validation ไม่เชื่อข้อมูลนี้ และ Browser partition/origin ต่างกันอาจไม่แชร์ DB/channel ต้องใช้ TTL/server validation ตามปกติ

### Layer 3: Apps Script CacheService

- ใช้ result cache/lease/generation เดิมสำหรับ browse rows 30 วินาที ข้อมูลแชร์ได้เฉพาะ dataset ที่ทุก role ใน route ได้สิทธิ์อ่านอยู่แล้ว; gateway ตรวจสิทธิ์ก่อนเสมอ
- Shared result ไม่มีข้อมูลเฉพาะ caller; sign cursor แยก account/role หลัง reuse cache จึงแชร์ first-page query ระหว่างผู้ใช้ได้โดยไม่แชร์ cursor ข้ามบัญชี
- Missing/evicted/unavailable cache กลับไป query แบบ bounded ไม่ return partial data เป็น success
- Browser transport รับ expiry เดิมของ browse result ด้วย การใช้ result ที่เหลืออายุ 1 วินาทีไม่เริ่ม TTL ใหม่ให้ client
- ไม่เพิ่ม CacheService user cache ที่อาศัย effective Google user เป็น app user เพราะ deploy รันในนามผู้ deploy หลาย app users อาจใช้ effective identity เดียวกัน
- Master generations ยังใช้ Script Properties ไม่เพิ่ม Firestore reads สำหรับ version document แต่ทุก RPC จริงยังมี targeted user read เพื่อเช็กการเพิกถอนสิทธิ์ตามระบบเดิม

### Layer 4: REST pagination และ reference reads

- Client ใหม่ขอ `cursorMode:true` อัตโนมัติสำหรับ ordinary browse; default page size 50 และยังรักษาค่า page size ที่ผู้ใช้บันทึกไว้
- Query ใช้ `__name__` แบบ ASC/DESC, `limit=pageSize+1`, `startAt` แบบ exclusive, ไม่มี `offset` หรือการสมมติว่า runQuery มี page token
- Signed continuation ผูก spec, pageSize, account/role, generations, last ID, page number, snapshot readTime และอายุไม่เกิน 2 นาที; write/หมดอายุให้ `restartPage` แล้ว UI เริ่มหน้าแรกหนึ่งครั้ง
- Projection เลือกเฉพาะ product fields ที่ใช้จริง; lazy images และ deduplicated reference batch อ่านเฉพาะ IDs ของหน้านั้น
- คง `total:null` สำหรับ cursor browse เพื่อไม่อ่านทั้ง collection/ทำ aggregation เพียงเพื่อนับทั้งหมด; UI ระบุช่วง/หน้าและยังมีหน้าถัดไป ไม่แสดงตัวเลขรวมที่ไม่ทราบ
- หน้าเดิมที่ล้มเหลวเพราะ network ยังแสดงได้ พร้อมแจ้งว่าเป็นข้อมูลเดิม; pagination อยู่ในกรอบเดิม
- Legacy APIs, global substring/XLFilter, numerical/name sorts และ Export ยังใช้ catalog path เดิมเพื่อให้ค้นหา/Export ครบทุก eligible record การตั้ง `cursorMode` ไม่ทำให้ค้นหาเฉพาะ visited pages
- Reference helper ใช้ masked batch เฉพาะ browse; PO/default caller ยังได้ Phone/Tax/contact fields ครบ และ missing references แสดง fallback ID ได้

### Write consistency / security inventory

| กลุ่ม write | กลไกที่ตรวจ | สถานะ Cache / ข้อจำกัด |
|---|---|---|
| Master CRUD, customer/vendor/car/zone, product CRUD | gateway registry + reference lock + masked PATCH/updateTime หรือ create exists-check; delete ตรวจ reference และ updateTime | มี generation invalidation; ยังไม่ atomic กับ journal |
| แก้ stock จากฟอร์มสินค้า | อ่าน stock จริง, baseline/expected stock และ updateTime precondition; ไม่ทับ stock จาก snapshot ที่ไม่ได้ตั้งใจแก้ | regression เดิมยังผ่าน |
| `issueStock_`, `receiveGoods_`, stock helpers | batchGet authoritative + atomic commit ของ stock/movements/quote marker/receipt; idempotent request ID และ precondition retries | คง checks เดิม ไม่ใช้ browser stock แทน DB; targeted patch/invalidation หลัง commit |
| PO/Quotation/Tax Invoice saves/status/deletes | business validation, dates/amounts, unique numbering, updateTime/atomic commit ตาม flow เดิม | invalidates document scopes; ยังไม่ journal ทุก PATCH |
| Product image V1/V2 | staged Drive files, updateTime metadata, cleanup หลัง confirmed save | invalidate Product_Images; Drive + Firestore ไม่ใช่ transaction เดียวกัน ไม่มีการปรับรูปจริง |
| Auth/User management | gateway admin policy, fresh readAuthUser, Session_Version / revocation | ไม่แคช authorization decision ใน IndexedDB และไม่เปลี่ยนสิทธิ์ |
| Restore/maintenance/cleanup | private helpers/admin gate, staging restore restrictions และ guarded writes | ต้องรวมใน journal หากเปิด CDC ภายหลัง; รอบนี้ไม่เรียกจริง |

Manifest ยังเป็น `USER_DEPLOYING`; protected calls ใช้ app Session + `readAuthUser_` ตรวจ current role/status/version และ fail closed เมื่ออ่านไม่ได้ `Session.getActiveUser()` เป็น fallback ของ private/editor helpers ไม่ใช่แหล่งยืนยัน app user ใน gateway ปกติ OAuth token อยู่ backend ไม่ส่งลง Cache หน้าเว็บ การยืนยัน IAM/index/OAuth ของโปรเจกต์จริงยังไม่ได้ทำรอบนี้

## D. Verification และผลวัด

ทดสอบด้วย mock Firestore/Apps Script และ local Chromium ปิด external HTTPS ไม่มี Production credentials หรือ Live DB ใน fixtures

| กรณี | ผลที่วัด/ตรวจได้ |
|---|---|
| Cold ordinary product page, 10,000 records, page 50 | **10,000 → 51 returned product documents**, ลด **99.49% เฉพาะเอกสารสินค้าใน action นี้** |
| Warm page repeat | 0 additional product documents ใน fixture |
| ผู้ใช้ 5 บัญชีขอ first page ใน cache window | 1 shared product query / 51 product documents; cursor ต่างกันและใช้ข้ามบัญชี/role ไม่ได้ |
| Memory reuse 10 ครั้งหลังโหลด | 0 additional RPC / 0 IndexedDB lookup; ten-read test เดิมยังใช้ 1 initial RPC |
| Pagination ASC/DESC, concurrent external insert/delete | snapshot คงเดิม ไม่มีซ้ำ/ข้ามภายใน snapshot |
| Search แถวท้าย / global facet / filtered Export | ยังค้นและ Export ครบ รวมรายการที่ไม่เคยเปิด |
| Add/Edit/Delete + generation change | browse ใหม่เห็นผลล่าสุด ไม่ดึง record ที่ลบกลับจาก cache |
| Concurrent edits / stock atomic failure / retry | ใช้ regression integrity/recovery เดิม ไม่เกิด write ซ้ำจาก Cache layer |
| Role/Session change / auth denied | old pending response ถูกปฏิเสธ; persistent restore ไม่ผ่านก่อน server validation |
| Network/IndexedDB unavailable, blocked, corrupt, expired, quota, transaction exception | fallback/ข้อความ error ถูกต้อง; ไม่แสดง incomplete เป็น success |
| Multiple tabs / delayed response / old put after purge | invalidate และ revision fence ปฏิเสธ snapshot เก่า |

ผล fixture อยู่ใน ignored `test-results/hybrid-cache-model.json` และผล Browser ใน `test-results/browser-result.json` ตัวนับ returned documents ไม่เท่ากับ billed Reads: ยังมี auth user reads, reference/image document reads (รวม missing docs), empty query minimum และ billing/index rules ที่ fixture ไม่จำลอง Projection ลด payload ไม่ได้ลดจำนวน document reads ต่อเอกสารเอง

ผลตรวจรับ: `npm test` **205/205 ผ่าน**, `npm run test:browser` **103/103 กลุ่มผ่าน**, `npm run check` **69 scripts/manifest ผ่าน**, `git diff --check` ผ่าน ไม่มี tests ที่ล้มเหลวค้างอยู่ Browser ทั้งชุดผ่านก่อนเพิ่ม transport expiry ใน backend; targeted 36 tests และ backend ทั้งชุดยืนยันการเปลี่ยนสุดท้ายนี้อีกครั้ง

**ยังไม่ได้วัด:** Production first/repeat latency, p50/p95, daily billed Reads, live hit rate, browser จริงใน Apps Script sandbox/storage partition, 5 Apps Script executions ที่วิ่งพร้อมกันจริง หรือ index explain การจำลอง 5 บัญชีเป็นการตรวจ reuse/authorization ส่วน contention ใช้ mocked lease และ interleaved precondition tests ไม่ใช่ load test จริง 5 คน

## E. Delta Sync ที่ยังเหลือ — design ก่อน migration

ไม่สร้าง UUID cursor หรือเก็บ deletion marker ใน Script Cache แล้วเรียกว่า durable delta เพราะ eviction/parallel writes อาจทำ event หายได้ และ generation ที่เปลี่ยนหลัง write ไม่ใช่ atomic version

หากอนุมัติเพิ่มโครงสร้าง DB และรับต้นทุน writes เพิ่ม แผนที่ต้องทำให้ครบก่อนเปิดใช้คือ:

1. Dataset metadata แยก domains มี `currentVersion`, `minAvailableVersion`, `schemaVersion`, server timestamps และ bootstrap baseline/readTime
2. ทุก business writer ต้องอ่าน metadata/updateTime แล้ว commit business mutation + metadata version ที่เพิ่มหนึ่ง + immutable UPSERT/DELETE event ใน **Firestore commit เดียวกัน** พร้อม precondition ทั้งคู่ Retry เฉพาะ contention และ reuse mutation ID เพื่อกัน duplicate
3. Event เป็น envelope ของ transaction (หลาย record IDs ได้) หรือมี sequence+event-index ที่เรียงไม่ซ้ำ; deletion ต้องบันทึก tombstone ใน commit นั้น ไม่อาศัยการลบแล้วค่อยเขียน log
4. ครอบคลุม POST/PATCH/DELETE ปัจจุบัน, image metadata, batch stock, documents/status, restore และ maintenance; Direct Firebase Console/external writer ที่ไม่ร่วม protocol ต้องถูกห้ามใน operational policy หรือมี authoritative full-resync ทางเลือก
5. Delta reader ตรวจ auth/dataset allowlist, อ่าน immutable events แบบ cursor `(version, eventIndex)` จนถึง upper version เดียวกัน; client apply batch + advance applied cursor ใน local transaction หลังอ่านครบเท่านั้น
6. ถ้าต่ำกว่า minAvailableVersion, schema เปลี่ยน หรือ event chain ขาด ให้ bootstrap/resync ใหม่อย่างชัดเจน; retention ขยับ minimum ก่อน prune โดยไม่ทำให้ active cursor ข้ามช่วง
7. ทดสอบ failure หลัง DB commit ก่อน cache invalidation, parallel CAS, duplicate retry, tombstone, continuation, pruning และ historical legacy data ใน staging ก่อน Production

แผนนี้เพิ่ม DB writes ต่อ mutation และต้องเปลี่ยนทุก writer ไม่ใช่เพียงเพิ่ม endpoint Cache จึงยังไม่เปิดไว้ครึ่งระบบ การออกแบบ search index ก็ต้องอนุมัติ fields/index/backfill เพิ่มต่างหาก ตอนนี้ใช้ bounded TTL, version validation, authoritative critical checks และ reconciliation เดิมเป็น fallback ที่ตรวจได้

## F. Rollout / rollback / งานคงเหลือ

- ไม่มี config/DB migration จำเป็นสำหรับส่วนที่ทำแล้ว IndexedDB ถูกสร้างเมื่อ browser รองรับและใช้ eligible route
- เตรียม release ของ client/backend ชุดเดียวกันตาม whitelist เดิมก่อน Staging; mixed old deployment ไม่ได้ประโยชน์ทั้งหมด แต่อินเทอร์เฟซเก่าคงอยู่
- ทดสอบ staging 10,000 records/5 users, Viewer/Staff/Admin, products empty/full/delete, refresh หลัง write, Session revocation, private browser/mobile และ storage partition จริง
- เมื่อได้รับอนุมัติ Deploy จึง Sync/อัปเดต Deployment เดิมและคง URL/access; รอบนี้ยังไม่ทำ
- Rollback เฉพาะ feature ได้ด้วย `window.SYY_HYBRID_CACHE=false` ก่อน include Shared และ `window.SYY_CURSOR_BROWSE=false` ก่อนโหลดตารางสินค้า แล้ว reload; flags เป็น source/config สำหรับ release ไม่ใช่การบันทึกค่าลง DB
- Rollback ทั้งชุดโดย ordinary Git revert ของ delivery commit และ Deploy source ชุดที่ผ่านตรวจรับตามอนุมัติ ไม่ force-push; ไม่มี schema ให้ย้อนกลับ DB `syy-hybrid-cache` เป็น disposable browser cache รุ่นเก่าจะไม่ใช้มัน
- หลังเปิดใช้ ดู `syyCacheStats` / `syyCacheStats.disk` ใน memory ต่อหน้า (ไม่มี token/args/PII/telemetry), Apps Script execution errors/latency และ Firestore usage แยก cold/warm/search/backup อย่าใช้ cache hit rate แทน billing measurement

### ไฟล์เปลี่ยน

- Runtime: `Code.gs`, `Shared.html`, `Master_Products.html`
- Verification: `tests/hybrid-cache.test.cjs`, `tests/client-cache.test.cjs`, `tests/browser.cjs`, `package.json`
- Documentation: `README.md`, รายงานฉบับนี้
- ไม่รวม unrelated untracked `docs/SYSTEM-AUDIT-2026-10-11.md` และ generated test/release artifacts

### เอกสารอ้างอิงที่ตรวจประกอบ

- [Firestore REST authentication and authorization](https://firebase.google.com/docs/firestore/use-rest-api)
- [runQuery และ readTime](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/runQuery)
- [StructuredQuery: ordering, projection และ cursor](https://firebase.google.com/docs/firestore/reference/rest/v1/StructuredQuery)
- [Apps Script Cache: limits และ eviction](https://developers.google.com/apps-script/reference/cache/cache)
- [Apps Script web app execution identity](https://developers.google.com/apps-script/guides/web)
- [IndexedDB lifecycle, upgrades และ transactions](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
