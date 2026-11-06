# SYY-Shop — Engineering Quality

เริ่ม 6 พฤศจิกายน 2026 (Asia/Bangkok) ตามแผน V2 และคำสั่งให้ดำเนินการตามลำดับ

## ขอบเขตและ Baseline

- Source baseline: `c6329b774542bb68a9e899af2e8284061c728ad6`; ตรวจ GitHub main และ fetch แล้วตรงกัน
- 25 runtime files: 2 GS + 22 HTML + manifest; Production V104 เป็นหลักฐานประวัติ ไม่ได้ตรวจ Editor/Deployment ใหม่ในงานนี้
- ไม่เขียน/แก้/ลบ Production DB, ไม่ Login/Save/Backup/Restore จริง, ไม่เปลี่ยน schema/index/IAM/roles/trigger และไม่ Sync/Deploy
- ผู้ใช้มี ZIP ของตนเองตามแผน แต่ยังไม่ได้รับ ZIP เพื่อตรวจ ไม่สร้าง ZIP เพิ่ม
- เก็บไฟล์เดิม `docs/SYSTEM-AUDIT-2026-10-11.md` ที่ untracked ไว้โดยไม่แก้ไข
- เอกสารนี้เป็น living document ฉบับเดียวสำหรับ baseline/contracts/decisions/results/rollback งาน V2

## G0 / Contracts

- ใช้ gateway/session/authorization และ response เดิม; ไม่แก้ธุรกรรม stock, receiving, numbering, VAT, auth state หรือ Backup
- Product search: คง SKU/Barcode/P/N/Thai substring/car model/XLFilter ทั้ง catalog; Browse cursor แยกจาก complex cached catalog search
- Query response: รักษา total=null/hasMore/readTime และ cursor เมื่อไม่ทราบจำนวนจริง ห้ามแปลงข้อมูลบางส่วนเป็นยอดรวมทั้งช่วง
- Display pagination แบ่ง DOM หลัง global loaded-set search/filter/sort; ไม่อ้างว่าลด Firestore reads ของ Master ที่ยังอ่านทั้ง collection
- Selection: explicit IDs, Select All เฉพาะหน้า; เปลี่ยน query/scope/version ให้ล้าง selection; ไม่เพิ่ม bulk mutations
- UI preferences: เฉพาะข้อมูลมุมมอง แยก deployment/account/role/page ในเครื่อง ไม่เก็บ token/PII ลง preference
- Cache: ใช้ CacheService/L1/IndexedDB/generation เดิม; no auto-refresh/prefetch ข้ามเมนู; unknown write ห้าม auto-retry
- หนึ่งเจ้าของต่อ shared file/Code.gs; Frontend และ Backend เปลี่ยนแยกตาม contract; Integrator เดียวรวม main
- Tests ใช้ local fixture/mock; browser block external requests; real gateway-to-mock tests ต้องไม่มี REST commit/patch/delete

## Decision Log

| เรื่อง | สถานะ/ขอบเขต |
|---|---|
| Page size | ดำเนินตามคำสั่งล่าสุดให้ทำตามแผน V2: Products default 50, options 25/50/100; Documents 25; Stock history 50; Master 25 |
| รูปสินค้า | ใช้ on-demand metadata สำหรับ view/edit/export พร้อม coalesce/cache; งด grid prefetch หลังวัด fixture ไม่โหลดรูปทั้ง catalog; หากเปิดรายละเอียดทุกแถวอาจมี RPC มากขึ้น |
| Select all filtered | ไม่เพิ่มจน exact count/snapshot พร้อม; เริ่ม explicit page IDs สำหรับ export/print เท่านั้น |
| Stock direct edit/ledger | ตรวจความเสี่ยงและเสนอแยก ไม่เปลี่ยน write semantics ในงานนี้ |
| VAT/rounding/issued invoice edit/void/delete | รอ Business/Accounting Owner; รักษาสูตร/สถานะเดิม |
| PO default selection | รักษาเดิม; แก้ feedback/quantity validation โดยไม่เปลี่ยน default business choice |
| Auth migration/roles | รอ System Owner/Security Reviewer; ไม่เปลี่ยนสิทธิ์ |
| Staging/real cost | ยังไม่อนุมัติ provisioning; real billed reads และ GAS latency = NOT MEASURED |
| Deploy | NOT DEPLOYED; ต้องมีคำสั่งอนุมัติแยก |

## Baseline และผลวัด

Artifacts เก็บเฉพาะใน ignored `test-results/quality-*`; ตัวเลข local/mock แยกจาก Google latency และ billed reads

- Baseline ที่รันใหม่: Unit 296/296, Browser 155/155, Browser-to-backend 10/10, syntax/read model ผ่าน
- วัด feedback/render/RPC/payload/mock documents แยก Cold/Warm; p50/p95 ระบุ sample และข้อจำกัด ไม่ถือ skeleton ว่า usable
- เป้าหมาย V2 เป็น engineering targets ไม่ใช่รับประกัน GAS cold start หรือผลจริงในเครือข่ายผู้ใช้
- Historical V104 296/155/10 เป็นข้อมูลอ้างอิง; ต้องใช้ logs รอบนี้ยืนยันอีกครั้ง

## ความเสี่ยงที่ตรวจพบ

- `Shared.escJs` และ Manage Users local copy ไม่ escape backslash; ต้องแก้ compatibility helper และย้าย dynamic handlers เป็น data + listener ตามจุดที่แตะ
- Quotation status chips ใช้ innerHTML; ปัจจุบันต้นทางเป็น server-defined statuses จึงยังไม่สรุป stored-XSS exploit จากจุดนี้เพียงอย่างเดียว
- CDN lazy loader มี broad SweetAlert major และไม่มี SRI; ต้อง pin/hash/CORS/fallback ทดสอบจริงก่อนใช้
- POS global arrows แย่ง number/select input; scanner Enter อาจเลือก first ambiguous match
- PO invalid quantity ถูกแทนด้วย 1; ต้องแจ้งและบล็อกการยืนยันโดยไม่ทิ้ง input
- Direct product stock edit มี baseline/CAS แต่ต้องตรวจ ledger แยกก่อนอนุมัติ redesign
- Backup restore health, authenticated UAT, screen reader/manual scanner และ 400% zoom ยังไม่ได้ยืนยัน

## แผนส่งมอบและ Gates

1. G0: baseline + no-production guard + contracts
2. WP08/WP01: safe DOM/dependencies/shared pagination/typography/accessibility
3. WP02/WP03: measured read/cache optimization + Products/Master
4. WP04/WP05/WP06: POS/PO/receiving/documents/dashboard safe UX
5. WP07/G1 ต่อเนื่อง: relevant tests ต่อชุด; G2: full integrated regression + known limits

## Rollback

Revert เฉพาะ commits ของงาน V2 ผ่าน ordinary Git history; ไม่ force push/reset main และไม่รวมไฟล์ untracked เดิม การคืน Source ไม่คืน DB การย้อน Apps Script version ต้องได้รับอนุมัติแยก

## ผลดำเนินการรอบแรก

| Package | สิ่งที่ทำ/รักษาไว้ | ข้อจำกัด |
|---|---|---|
| WP00 | ตรวจ remote/main, รัน baseline ใหม่, 10k fixtures, กำหนด contracts และ mock/no-external guards | ไม่ได้ตรวจ ZIP หรือ GAS Saved Head ใหม่; ไม่ได้เข้าถึง Production |
| WP08 | Harden `escJs` ทั้ง Shared/Users; Master/Product actions ใช้ data + delegated ID; status chips ใช้ textContent; CSV ป้องกัน formula รวม whitespace/control prefix | ยังต้องขยาย source-to-sink review ทุกส่วน ไม่ถือว่าเป็น penetration test ทั้งระบบ |
| WP01 | เพิ่ม UI-only pager/preferences แยก deployment/account/role/page, labels/lang/title/contrast; native size selectors; touch checkbox targets ≥44px บน mobile | ยังไม่รับรอง manual screen reader/400% zoom และ typography ทุก metadata |
| WP02 | Cache reference DTO ที่ validate/project แล้ว โดย generation และชุด IDs; ไม่ใส่ subset ลง full collection cache; POS image queue มี priority/obsolete guard | Cold substring/XLFilter ยังใช้ full catalog ตามเดิม; ไม่มี index/schema ใหม่ |
| WP03 | Products default 50, choices 25/50/100; Master 6 หน้า/Users display pagination 25; explicit selection ข้ามหน้า ≤1000, header mixed state, selected CSV/print | Master queries ยังอ่าน loaded set ครบ; global all-filter selection ยังไม่เพิ่มจนมี authoritative snapshot contract |
| WP03 freshness | Selection ผูก account/role/deployment/cache identity/revision; clear เมื่อ query/size/own mutation/snapshot rebase เปลี่ยน; export/print ใช้ snapshot ตาม intent | ไม่บันทึก selection/transaction rows ลง localStorage |
| WP03 images | ยกเลิก grid metadata prefetch; detail/edit เปิดข้อมูลหลักก่อนรูป, coalesce/reuse cache เดิม; export ขอรูปเฉพาะ scope | หากเปิดรายละเอียดทุกแถว อาจมี image RPC มากกว่าการ prefetch ทั้งหน้า ต้องวัดรูปแบบใช้งานจริง |
| WP03 car picker | ค้นหาทั้ง loaded set แต่แสดงครั้งละ 200 รุ่น/โหลดเพิ่ม; เลือกทั้งหมดเฉพาะผลที่แสดงและรักษา legacy IDs; checkbox มีชื่อ รองรับ Enter/Space คืน focus และไม่ submit ฟอร์ม | ไม่ใช่ server search; physical keyboard/scanner และ assistive technology UAT ยังต้องตรวจ |
| WP04 | Barcode exact match priority, ambiguous Enter ต้องเลือก; keyboard intent ผูก query/filter/ID; ลูกศรไม่แย่ง native inputs; memo normalization ตรวจ field mutations | คง POS window 60; physical scanner/UAT ยังไม่ตรวจ |
| WP04 PO | เก็บ invalid quantity เดิมและแจ้ง inline; ไม่แทนค่าเป็น 1; บล็อก confirm/save เมื่อผิด; per-vendor select/deselect ไม่มี RPC | คง default selected/minimum/business payload เดิม; ไม่เปลี่ยน Receiving transaction |
| WP05 | Documents default display 25 และเลือก 25/50/100 แยกจาก fetch window 50/200; status saving/duplicate guard/rollback; PDF lossless compression | คง VAT/rounding/document numbers/issued-state semantics; รอตัดสินใจแยกถ้าจะเปลี่ยน |
| WP06 | เพิ่มความชัดเจนของ sidebar/Dashboard contrast/labels; คง KPI/exception cards/table ก่อน analytics ที่มีอยู่แล้ว | ไม่เพิ่ม scans/widgets/aggregations ใหม่; KPI จริงยังไม่ได้ UAT |
| WP07/09 | Unit/security/read/browser/backend/axe/real-CDN compatibility และ Thai multi-page PDF บน fixtures | Automated gate ผ่านเฉพาะขอบเขตที่ทดสอบ; G2 ยังมี manual/real-system validation ค้าง |

### Read graph / side effects ที่ต้องคงไว้

| หน้า | Read path หลัก | Scope/ข้อควรระวัง |
|---|---|---|
| Products browse | gateway → cursor query `limit=size+1` → referenced master DTO cache → bounded DOM | อย่าเอา lookahead มาแสดงเป็นจำนวนรวม; snapshot rebase คงหน้าแต่ล้าง selection |
| Products search/facets | existing complete catalog cache → full-scope filter/sort → page/facet values | ไม่เปลี่ยน substring เป็น prefix หรือ search เฉพาะหน้าที่โหลด |
| Product detail/edit | existing row → targeted images; edit-only master dropdowns ตาม intent | รูปล้มเหลวไม่ลบรูปเดิม ไม่ปิดการแก้ข้อความ; foreground image reads เมื่อผู้ใช้รอ |
| POS | compact permitted catalog → local scoring/window → visible images | memo เป็น WeakMap เฉพาะ memory และตรวจ field changes ไม่ persist ข้อมูลเพิ่ม |
| Master | gateway → existing collection/cache → filter/sort ทั้ง loaded set → display pager | การลด DOM ไม่ลด collection reads โดยตัวมันเอง |
| Quote/Invoice | bounded list/search/year → existing document pager; editor sections เมื่อใช้ | fetched 50/display 25 ช่วยให้เปลี่ยนสองหน้าจอแรกโดยไม่ยิง RPC เพิ่ม; summary ยังระบุ loaded scope |
| PO | create/history แยก section, pending summary เดิม → user review | ไม่สรุป pending จากแค่หน้าประวัติแรก; ไม่แก้ stock/receipt write semantics |
| Dashboard | bootstrap/cache/catalog/movement scope เดิม → existing summaries | ไม่เพิ่ม read เพื่อปรับ layout; ต้องแยก partial/full period |
| Users/Profile/Login | existing authorized/custom helpers | UI metadata ไม่เปลี่ยน auth/role policy; ห้ามใช้ชื่อ `get` รับรองว่าไม่มี side effects โดยไม่ตรวจ |

`apiGateway` บางเส้นทางมี rate-counter writes ใน GAS Script Properties และ CacheService ตามระบบเดิม จึงไม่เรียก Production เพื่อทดสอบว่าเป็น pure read งานนี้ใช้ mock services ทั้งหมด และไม่ทำ Production Login/Save/Backup/Restore

### Dependency review

- Dev dependency ใหม่ตาม V2: `@axe-core/playwright@4.14.0`; มี lockfile และ npm audit: 0 known findings ณ วันที่ตรวจ (ไม่ใช่การรับรองตลอดไป)
- Pin JS 6 assets พร้อม SHA384/CORS และ license inventory ที่ `scripts/cdn-assets.json`; loader ยังคง defer/fallback เดิม
- พบ QR URL เดิม `qrcode@1.5.3/build/qrcode.min.js` ตอบ 404; เปลี่ยนเป็น browser build ที่ตรวจจริง `1.4.4` และทดสอบ toDataURL
- เปลี่ยน SheetJS npm CDN 0.18.5 → official standalone 0.20.3 และ jsPDF 2.5.1 → 4.2.1 หลังพบ advisory ในรุ่นเดิม
- Isolated npm audit ของอีก 5 packages รุ่นปัจจุบัน: 0 findings; **ไม่รวม SheetJS standalone** เพราะ npm registry เก่ายังเป็น 0.18.5 ไม่อ้างว่า npm audit ครอบคลุม build 0.20.3
- ตรวจ SHA384 ทั้ง 6 ไฟล์; actual local browser ทดสอบ Excel Thai round-trip, Barcode, QR, html2canvas/jsPDF และ PDF invoice หลายหน้า; digest mismatch ถูกปฏิเสธก่อนรัน JS
- ทำซ้ำ offline: `npm run verify:cdn`; ดาวน์โหลดเพื่อทดสอบแยกโดยตั้งใจ: `node scripts/verify-cdn.cjs --download` (เฉพาะ public reviewed assets ไม่ใช่ Production)
- Real asset tests: ตั้ง `QUALITY_CDN_ASSETS=1` แล้ว `npm run test:browser`; ต้องมี cached assets ใน ignored `test-results/quality-cdn-assets`
- แหล่งตรวจ: [SheetJS standalone](https://docs.sheetjs.com/docs/getting-started/installation/standalone/), [jsPDF releases](https://github.com/parallax/jsPDF/releases), [OWASP XSS](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)

### ผลทดสอบและการวัด

Environment: Node v24.21.0, npm 11.19.0, Playwright 1.62.1, local headless installed Chrome, synthetic fixtures; browser external traffic blocked (CDN success tests fulfill reviewed bytes locally)

| Check | ผล |
|---|---|
| Unit/security/integrity/regression | **304/304** |
| Browser regression รวม V2 และ real CDN/PDF tests | **169 กลุ่ม** |
| Real local gateway → mock Firestore browser | **10/10 กลุ่ม**, 10,000 products, no REST mutations ใน read workflows |
| Syntax/manifest | **53 scripts** ผ่าน |
| Read model / diff whitespace | ผ่าน |
| axe WCAG tags | **30 route/state scans, 0 findings**; 15 routes + primary modals/security/Login states |
| Search differential | **60,000 score comparisons** ตรง baseline รวม Thai/P/N/Barcode/car model และ field mutation |
| Responsive | 6 workflow pages ที่ 320/390/768/1280/1920px; additional existing mobile/keyboard regressions |
| Production DB/API writes | **0 จากงานนี้**; ไม่เรียก Production endpoints |

ผล local ที่วัดได้ (ค่าปัจจุบันให้ยึด JSON artifacts; ไม่ใช่ Production SLO/billing):

| Scenario | Before | After | ความหมาย |
|---|---:|---:|---|
| Master DOM rows, loaded 1000 records | 1000 | 25 | ลดแถว DOM 97.5%; RPC=1 และ mock collection reads=1000 เท่าเดิม |
| Initial Product browse, shared 5 Viewer requests | 101 product documents / 100 image documents | 51 product documents / 0 image documents | เปลี่ยน default 100→50 และไม่ prefetch รูป; ไม่รวม auth/index billing/ส่วนอื่น |
| Reference reads, 3 browse pages sharing brand/category | 6 batch requests ตาม behavior เดิม | 2 batch requests ใน fixture ใหม่ | reuse validated reference cache; generation change ยังอ่านใหม่ |
| Thai invoice PDF, 55 rows / 4 pages | 42,804,633 bytes | 986,193 bytes | lossless compression ลดขนาด ~97.7% ใน fixture นี้; คง resolution/จำนวนหน้า/สูตรเดิม |

`quality-baseline-measurements.json`, `quality-after-measurements.json` และ `quality-pos-search.json` เก็บ p50/p95, samples=30 ต่อช่วง **เป็น repeated measurements ใน context เดิม ไม่ใช่ 30 independent production runs**; POS timing เป็น render handler ไม่รวม debounce/paint/GAS; ห้ามนำไปกล่าวอ้าง p95 ของระบบจริง

Artifacts หลัก: `test-results/quality-baseline-*.log`, `quality-unit-final.log`, `quality-browser-final.log`, `quality-backend-final.log`, `quality-check-final.log`, `quality-reads-final.log`, `quality-accessibility.json`, `quality-cdn-*.json`, `quality-pdf-snapshot.json` และ measurement JSON

### Files changed

- Runtime 19 files: `Code.gs`, `Shared.html`, `Styles.html`, `UiSystem.html`, `index.html`, `login.html`, `Master_Products.html`, `Master_Brands.html`, `Master_Categories.html`, `Master_Cars.html`, `Master_Customers.html`, `Master_Vendors.html`, `Master_Zones.html`, `Manage_Users.html`, `Profile.html`, `Purchase_Orders.html`, `StockIssue.html`, `Quotation.html`, `Master_Tax_Invoice.html`
- Source support: `package.json`, `package-lock.json`, `scripts/cdn-assets.json`, `scripts/verify-cdn.cjs`
- Tests: extend existing browser/backend/hybrid/integrity suites; add `tests/xss.test.cjs`, `tests/quality-read.test.cjs`, `tests/quality-browser.cjs`, `tests/support/quality-ui.cjs`
- เอกสารฉบับนี้; ไม่แก้ manifest, `ProductImagesV2.gs`, authorization/stock write rules, historical reports หรือไฟล์ untracked เดิม

## Accounting / issued-document decision record

ตรวจ Source เดิมโดยไม่เรียก Production: `calcTaxInvoiceTotals_` รวม qty×price ก่อนคำนวณ VAT 7% และปัดเป็นสองตำแหน่งด้วย `Math.round`; `calcQuoteTotals_` จำกัดส่วนลด 0–100%, ปัดส่วนลด → ยอดหลังส่วนลด → VAT → ยอดรวมตามลำดับ ส่วน Invoice preview คำนวณ floating-point แล้วจัดรูปแบบ และใบที่บันทึกใช้ค่าจาก server จึงต้องให้ผู้ใช้ตรวจ preview/saved snapshot ใน UAT เพิ่ม

| เรื่อง | As-is / หลักฐาน fixture | ทางเลือกที่ต้องตัดสินใจ | ผู้ตัดสินใจ / checkpoint |
|---|---|---|---|
| VAT / rounding | Tax 100→VAT 7/total 107; สองบรรทัด 0.05→VAT 0.01 รวม 0.11; 3×0.335→subtotal 1.01/VAT 0.07/total 1.08; มี golden tests ไม่เขียน DB | ปัดระดับบรรทัดหรือยอดรวม, integer satang/decimal, กติกาครึ่งสตางค์; อาจเปลี่ยนยอดเอกสารจึงยังไม่แก้สูตร | Business owner + accountant/tax advisor ก่อน merge สูตรใหม่ |
| ส่วนลด Quote | 100 ส่วนลด 10%→90+VAT 6.30=96.30; ทดสอบ clamp <0/>100 และราคา 0 | คงส่วนลดก่อน VAT หรือกติกาอื่น ต้องมีตัวอย่างที่เจ้าของยอมรับ | Business owner + accountant ก่อน merge สูตรใหม่ |
| Tax Invoice edit | `saveTaxInvoice_` ที่มี docId อ่านเอกสารเดิม รักษาเลขเดิม ใช้ updateTime/CAS; ไม่พบ dedicated issued/draft state gate ในฟังก์ชันนี้ | ล็อกเอกสารออกแล้ว หรือ reversal/credit note แทนแก้ทับ; ต้องออกแบบ state/audit แยก | Business owner + accountant + Security reviewer ก่อน coding semantics ใหม่ |
| Tax Invoice delete/void | `deleteTaxInvoice_` เรียก delete document ผ่าน gateway สิทธิ์ admin เดิม; ไม่ใช่ credit-note workflow | ห้าม hard delete/ใช้ void หรือเครดิตโน้ต; อย่าสรุปจาก Source ว่าผิดกฎหมายโดยไม่ให้ผู้เชี่ยวชาญตรวจ | เจ้าของเดียวกับข้างต้น ก่อน implementation และ Deploy |
| Quote state | 4 สถานะเดิม: ร่าง/ส่งลูกค้าแล้ว/ปิดงาน-ขายสำเร็จ/ยกเลิก-ไม่ได้งาน; updater ตรวจ allowlist แต่ไม่มี transition matrix; delete ใช้ admin เดิม | กำหนด permitted transitions และ guard เอกสารผูก stock โดยไม่เดากติกา | Business owner + Security reviewer ก่อนเปลี่ยน workflow |
| Stock direct edit / auth | รักษา CAS/ledger/role/session contract เดิม; ไม่มี Production transaction test | แยก adjustment ledger, auth migration/role redesign เป็นงานใหม่ | Inventory controller/System owner + Security reviewer ก่อน write-path/policy change |

สถานะทุกรายการ: **รอ owner decision; ไม่ใช่การอนุมัติเปลี่ยน semantics จากงาน V2**. Golden tests แช่พฤติกรรมเดิมเพื่อจับ regression ไม่ใช่การรับรองสูตรทางบัญชีหรือกฎหมาย

## งานต่อ / Release readiness

1. ขยาย safe DOM/source-to-sink review ของส่วนที่ยังไม่แตะและ third-party tooltip/print paths พร้อม attack fixtures; รอบนี้แก้ car picker/IDs, numeric attributes และ phone display แล้ว แต่ยังไม่ถือว่าเป็น penetration test ทั้งระบบ
2. ขยาย page-level forms/error-summary/advanced fields และ typography computed-style audit ตาม WP03–06; car picker แบบ bounded DOM ที่ค้นหาเต็ม loaded set และ selection scope ผ่าน fixture แล้ว ส่วน manual ergonomics ยังต้องตรวจ
3. ตรวจด้วยผู้ใช้: physical scanner 20 SKUs, ambiguous P/N, quantities/PO/partial receipts, keyboard focus, screen reader, zoom 200/400%; ใช้ Mock ก่อน ไม่มีการส่ง transaction กับ Production
4. ถ้าจะยืนยัน GAS/Firestore latency, index cost หรือ billed savings ต้องอนุมัติ Staging แยก Firebase/GAS/Drive/mail/credentials/budget ก่อน; ตอนนี้ **NOT MEASURED** ไม่มีเปอร์เซ็นต์ลด Reads ทั้งระบบ
5. Owner decisions: VAT/rounding/issued invoice edit/void/delete, stock adjustment ledger และ auth migration แยกก่อนเปลี่ยน semantics; ไม่เป็นเหตุให้หยุด safe source work
6. Backup health/restore drill เป็นความเสี่ยงเดิมที่ต้องตรวจแยก ไม่ได้รันหรือรับรองในงานนี้
7. ก่อน future sync/deploy ต้องตรวจ Git ↔ fresh Saved Head พร้อม complete inventory อีกครั้ง เก็บ manual changes และให้ผู้ใช้สั่ง Deploy แยก

**สถานะรอบนี้: SOURCE IMPROVEMENTS + AUTOMATED VALIDATION; NOT DEPLOYED. ยังไม่ประกาศว่าจบ Master Plan V2 ทั้งหมดหรือผ่าน authenticated Production UAT.**

## รอบต่อเนื่อง — 7 พฤศจิกายน 2026

Baseline `1f0d959444da3ea3d4b711892e1a1717209da52d`; fetch แล้วตรงกับ `origin/main` ก่อนแก้ งานนี้ยังใช้ local fixtures เท่านั้น ไม่มี Production API/DB, Login, Trigger, Backup/Restore, Sync หรือ Deploy

| งาน | Root cause / สิ่งที่ปรับ | ผลและผลกระทบ |
|---|---|---|
| Shared icon upgrade | ตัวแปลงไอคอนใช้ `innerHTML` กับ text node ทั้งก้อน ทำให้ข้อความที่ escape มาแล้วถูก parse ซ้ำเมื่อมี emoji; เพิ่ม regression ก่อนแก้ พบ `<img>`/`<b>` ถูกสร้างจริงใน fixture | ใช้ text nodes สำหรับข้อความ และ parse เฉพาะ SVG คงที่จาก allowlist; ทดสอบ explicit upgrade ซ้ำและ MutationObserver ไม่เพิ่มรูป/script จาก payload ไม่อ้างว่าพบ exploit ใน Production |
| PO / print sinks | ปิด raw output ของเลข PO/quantity/cost/received quantity/ยอดและสถานะผิดรูปแบบ, print quantity และ date fallback ของ Invoice/Quote; `escHtml` เดิมไม่ encode quotes และทำ 0 หาย | reuse shared escaping; ค่า 0 ยังแสดงถูกต้อง; สถานะที่ไม่รู้จักแสดงเป็นข้อความ ไม่มี dropdown ที่เลือก Pending โดยปริยาย; status ที่รองรับและ backend rules เดิมไม่เปลี่ยน |
| Car picker keyboard | ตัวเปิดและ Select/Clear เป็น click-only controls; เพิ่ม native buttons, expanded state, Enter/Space/ลูกศร, Escape ปิดเฉพาะ picker, focus หลังโหลดเพิ่ม/ลบ chip และป้องกัน Enter ใน search ส่งฟอร์ม | ยังค้นหาครบ loaded set 1,000 รุ่นใน fixture, window 200/400, เลือกเฉพาะผลที่แสดงและรักษา hidden IDs; ไม่มี RPC จากการเลือก/ค้นหา/คีย์บอร์ด |
| Form errors | เพิ่ม summary พร้อมปุ่มไปช่องผิดใน Product และ Master 6 หน้า (Cars ใช้ duplicate-code rule เดิม); Invoice ใช้ validation เดิมรวม field/line errors | รักษา input/draft/คำอธิบายเดิมใน aria-describedby; การ blur ด้วยค่าเดิมไม่ลบ custom error; reset/แก้ไขล้างสถานะ; summary อยู่ใน modal scroller เพื่อให้ footer มือถือยังอยู่ในจอ ไม่เพิ่ม required/min/กติกาบัญชีใหม่ |

Runtime ที่แก้ในรอบนี้: `Shared.html`, `UiSystem.html`, `Styles.html`, `Master_Products.html`, Master อีก 6 หน้า, `Purchase_Orders.html`, `Quotation.html`, `Master_Tax_Invoice.html` (13 ไฟล์) พร้อม `tests/support/quality-followup.cjs` และการเรียกผ่าน suite เดิม ไม่มี backend/write-path changes

หลักฐาน: `test-results/quality-followup-before.log` (regression แสดงปัญหา icon ก่อนแก้), `quality-followup-targeted.log`, `quality-followup-unit.log`, `quality-followup-browser-full.log`, `quality-followup-backend.log`, `quality-followup-checks.json`. 4 browser groups ใหม่ตรวจ hostile fields/print, keyboard, native/manual form errors รวม mobile footer และ 0 RPC เพิ่มจาก UI interactions; Full suite และสถานะ release ให้ยึดผลจบด้านล่าง

งานค้างเรียงต่อ: source-to-sink review ของ chart/tooltip/export ที่ยังไม่ครอบคลุม, typography computed-style inventory และ progressive disclosure ของฟอร์มซับซ้อน, จากนั้น manual scanner/keyboard/AT/zoom/UAT ตามข้อ 3 ข้างบน; การวัด billed reads/latency จริงยังต้องแยก Staging และ owner decisions เดิมยังค้าง ไม่รวมอยู่ในการแก้รอบนี้

ผลจบรอบนี้: **Unit 304/304, Browser เต็ม 173 กลุ่ม, Backend-integrated 10/10, Syntax 53 scripts + manifest, read model และ diff whitespace ผ่าน**. Axe เดิม 30 route/state scans และเพิ่มอีก 2 error-state scans ของ Product/Invoice: 0 findings ในขอบเขต automated tags ที่ตรวจ (`quality-followup-accessibility.json`); ยังไม่ใช่ manual WCAG certification

**Firestore impact รอบต่อเนื่อง: ไม่มี query/write-path changes, ไม่มี RPC เพิ่มจาก UI interactions ที่ทดสอบ และไม่มีการเรียก Production DB/API. สถานะ: SOURCE VALIDATED; NOT SYNCED / NOT DEPLOYED.**
