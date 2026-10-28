# ผลรับช่วง: Performance และการแก้บิลตัดสต๊อก

รับช่วงจาก [handoff](CODEX-HANDOFF-2026-10-28.md) บน `main` baseline `3d2de33992cf68e8ec9a83dcba1bd8110e66f682` เอกสารนี้รายงาน Source และผลทดสอบ local ไม่ใช่รายงานว่าเปิดใช้บน Production แล้ว

## สถานะและข้อจำกัด

- ลง Source และทดสอบชุดถอดรูปตาราง, DOM-ready, shared compact catalog, cache compression, แยกโหลดเอกสาร/PO และ workflow แก้/ยกเลิกบิลแล้ว
- **ยังไม่ Deploy/Sync Apps Script และไม่ได้เขียน business data บน Production** ไม่เปลี่ยน URL, Trigger, Rules, indexes, IAM หรือบัญชีผู้ใช้จริง
- **ยังไม่ผ่านการพิสูจน์ว่าทุกหน้าโหลดข้อมูลที่ใช้งานได้ภายใน 10 วินาที** ต้องทดสอบหลัง Login ใน Staging/สภาพเครือข่ายจริง ทั้ง cold/warm, หลายผู้ใช้ และหลัง mutation ก่อนรับรอง
- ผล % ด้านล่างเป็นเอกสารที่ fixture คืนและขนาด JSON ไม่ใช่ Firestore billing ทั้งระบบ หรือ % เวลาเว็บจริง

## Root cause และสิ่งที่แก้

| จุด | ปัญหาเดิม | Source ชุดนี้ |
|---|---|---|
| Products | ตารางอ่าน metadata รูปทุกแถว ทั้งที่ต้องการรายการสินค้าเป็นหลัก | ถอดคอลัมน์รูป/preset และส่ง `includeImages:false` ทั้ง browse และ search/filter fallback |
| รูปในรายละเอียด | ถ้ารายการไม่มีรูป อาจถูกตีความว่าไม่มีรูปจริง | `imageDataLoaded:false` แยกสถานะยังไม่อ่าน; detail/edit ดึงเฉพาะ SKU, coalesce และป้องกัน callback เปิดสินค้าผิดตัว |
| Export | การถอดรูปอาจทำให้ URL รูปหายจาก export | export ขอ `includeImages:true` เฉพาะตอนใช้งาน ไม่ลบรูปหรือแก้ข้อมูลรูปใน DB |
| Initial load | หลายหน้าเริ่มอ่านเมื่อ `window.onload` ซึ่งรอ resources | เริ่มที่ DOMContentLoaded โดยคง pager/draft/view initialization; XLSX/JsBarcode โหลดเมื่อใช้ |
| ข้อมูลซ้ำระหว่างหน้า | catalog อยู่ใน memory แยก iframe | compact catalog ใช้ IndexedDB ร่วมในขอบเขต deployment/account/role/session; Dashboard/เอกสาร seed snapshot ที่ server ยืนยันแล้วให้ POS ใช้ต่อ |
| Cache ใหญ่ | result เกินเพดาน chunk แล้วไม่ถูกเก็บ ทำงานหนักซ้ำ | gzip/base64 เฉพาะ oversize; คง version และ source expiry เดิม ตรวจ manifest/chunks และ fallback เมื่อเสียหาย |
| Lease | follower รอ sleep สูงสุด 10 วินาทีบวก overhead | รอ 8 × 250ms ก่อนคืน error ที่ลองใหม่ได้ ไม่เปิด producer full scan ซ้ำ ไม่ถือ error ว่าผ่านเป้าโหลด 10 วินาที |
| Dashboard payload | ส่งชื่อ field ซ้ำทุก movement | opt-in matrix transport ใช้ข้อมูล/สูตรเดิม; legacy callers ยังได้ array เดิม |
| Tax Invoice | รายการรอ products/customers ของ modal | รายการ defer editor sections; เปิดฟอร์มจึงอ่าน metadata และรองรับร่างที่รอโหลด/ล้มเหลว |
| Quotation | bootstrap ส่ง catalog ที่หน้าอื่นมีแล้วซ้ำ | ยืนยัน section version จาก shared catalog ก่อน reuse; ปี/หน้ารายการใช้ list API เดิม |
| PO | ประวัติรอ low-stock catalog และกลับกัน | โหลด `section:create/history` แยกกัน; pending summary ครบทุก open PO ไม่คำนวณจากหน้าปัจจุบัน |
| Refresh | response ใหม่/reset pager อาจทำหน้าที่เลือกหาย | pager รองรับคงหน้าปัจจุบันตอน manual refresh; clamp เมื่อจำนวนลด และไม่ให้ stale history ทับ pending summary ใหม่ |
| Diagnostics | มีเวลา RPC รวม แต่แยก server กับ decode ไม่ได้ | bounded samples 20 ครั้ง/API, auth/operation/server/decode/wire characters และ p50/p95; ไม่มี telemetry RPC/Firestore write |

การค้นหา substring, global sort/XLFilter, ราคาที่ตกลงในร่าง, จำนวนครบชุด และการค้นสินค้าท้าย 10,000 รายการยังใช้ความหมายเดิม ไม่เปิด polling, refresh-on-focus หรือ prefetch ทุกเมนู

## Correction design ที่ใช้จริง

เลือกแนวทาง **ย้อนผลเดิมและออกบิลทดแทนใน atomic commit** ไม่ลบต้นฉบับ ไม่ reuse เลขบิล และไม่เปลี่ยนประวัติ Production ย้อนหลังขณะ Deploy

### สิทธิ์และการยืนยัน

- Preview/commit อนุญาต Admin ผ่าน registry/gateway ฝั่ง server เท่านั้น actor มาจาก session ไม่รับ username/role จาก client
- Staff อ่านรายละเอียด/ประวัติ correction ได้ตามสิทธิ์ stock detail เดิม Viewer ไม่ได้สิทธิ์เขียนหรืออ่านรายละเอียด Staff เพิ่ม
- ต้องระบุเหตุผล 5–1,000 ตัวอักษร และ preview ก่อน commit
- preview token ผูก payload, revision, updateTime ของทุก movement, stock และ quote; server อ่านจริงอีกครั้งแล้วตรวจ CAS ทุก write ที่เกี่ยวข้อง
- Admin ระบุราคาใหม่ได้โดยผ่าน validation ฝั่ง server ไม่เปลี่ยนราคาสินค้าหลัก ทุน SKU เดิมคงทุนเดิม ส่วน SKU ใหม่ใช้ทุนจาก server
- สต๊อกจริงไม่พอสำหรับการตัดเพิ่ม, ตัวเลขผิด, ราคาหรือทุนเดิมขาด, ราคา/จำนวน legacy แปลความไม่ตรงกัน, เหตุผลหลายแบบในบิลเดียว หรือทุนเดิมหลายราคาของ SKU เดียว ต้องหยุดให้ตรวจ ไม่เติมราคาปัจจุบันเป็นอดีต

### ผลของแต่ละ action

| Action | สิ่งที่เปลี่ยน | สิ่งที่คงไว้ |
|---|---|---|
| `amend` | Ref_No/Note, revision, correction pointer และ before/after audit | จำนวน ราคา ทุน สต๊อก Timestamp/Committed_At และเลขบิล |
| `replace` | สถานะต้นฉบับเป็น replaced; negative OUT reversal; OUT ใหม่และเลข SI รายวันใหม่; net stock delta | ต้นฉบับและ request receipt เดิมยังตรวจได้ |
| `cancel` | สถานะ cancelled; negative OUT reversal; คืนสต๊อกปัจจุบันตามจำนวนเดิม | ไม่ลบ movement หรือเอายอด Stock_Before เดิมมาตั้งทับ |

ตัวอย่าง เดิมตัด 5 ต้องการ 3 ปัจจุบันเหลือ 12 → เพิ่มสุทธิ 2 เป็น **14** ไม่ตั้งเป็นยอดก่อนขายและไม่ย้อน transaction อื่นที่เกิดภายหลัง

Reversal เป็น `Type:OUT`, Qty ติดลบ, `Is_Reversal:true`, `Reverses_Doc` และ Doc_No ใหม่ `SC-...` จึงหักยอดขาย/ตัดออก ไม่กลายเป็นยอดรับเข้า PO ปลอม แถวแรกมี `Bill_Count_Delta:-1`; บิลทดแทนนับเป็นบิลใหม่ +1

ต้นฉบับมี `Issue_Status`, `Issue_Revision`, `Correction_Id`, `Replaced_By`; บิลใหม่มี `Replaces_Doc` Audit/receipt ใช้ `Doc_No_Reservations/SC_<requestId>` ที่มีในระบบ Backup อยู่แล้ว ไม่มี collection ใหม่

receipt เก็บ before/after, เหตุผล, actor/time, fingerprint และผลสำเร็จใน commit เดียวกัน API อ่าน audit คืนเฉพาะข้อมูลแสดงผล ไม่คืน fingerprint/ผล replay ภายใน

### ความพร้อมกันและคำขอที่ยังไม่ทราบผล

- ใช้ UUID เดิมและ fingerprint ของ normalized payload; retry หลัง commit response lost อ่าน receipt ไม่ตัด/คืนสต๊อกซ้ำ
- request ID เดิมกับ payload/actor อื่นถูกปฏิเสธ; retry `issueStock` ต้นฉบับหลัง cancel/replace คืนสถานะเดิมพร้อมยอดล่าสุด ไม่สร้างบิลใหม่
- CAS ล้มเหลวแบบรู้ผลแน่นอนให้ตรวจ preview ใหม่; network/5xx ที่ยังไม่แน่ชัดล็อกฟอร์มและตรวจคำขอเดิม
- เก็บคำขอรอยืนยันผลใน sessionStorage ของ account/role/app; โหลดหน้าใหม่ไม่ auto-write ปุ่มตรวจผลใช้ payload เดิม
- จำกัดต้นฉบับ/ทดแทนไม่เกิน 200 SKU/บรรทัดตาม validation และรวม **ไม่เกิน 450 writes**, request JSON UTF-8 ไม่เกิน 8MiB, update document ไม่เกิน 900,000 bytes; ไม่มีการแบ่งครึ่งบิลเพื่อหลบขีดจำกัด
- การแก้ขาย/รับสินค้า/ใบเสนอราคาแทรกทำให้ precondition ปฏิเสธทั้งชุด ไม่เขียนได้เพียงบางส่วน

### โมดูลที่เกี่ยวข้อง

- Dashboard ใช้ signed quantity/value/cost และ bill-count delta; aging/movers ใช้รายการ active ที่ไม่ใช่ reversal ยอดปรับปรุงอยู่ใน **วันที่แก้จริง** ช่วงก่อนหน้าไม่ถูกเปลี่ยนวันย้อนหลัง
- ข้ามเดือนอาจเห็นยอด/จำนวนบิลสุทธิติดลบจากการย้อนรายการ ไม่ตีความเป็น receipt; ค่าเฉลี่ยใช้จำนวนบิลสุทธิและกันหารศูนย์
- Detail แสดงสถานะ ลิงก์ต้นฉบับ/บิลทดแทน และประวัติ correction เมื่อผู้ใช้ขอ ครั้งละไม่เกิน 5 audit docs พร้อม signed cursor ผูก revision และหมดอายุ ไม่ scan ทั้งประวัติเพื่อวาดทุกแถว
- Quote ยกเลิกเพียงหนึ่งบิลแล้วไม่ล้าง marker หากมีบิล active อื่น; คง marker ที่ยังใช้ได้ หรือเลือกบิลล่าสุดที่เหลือ ภายใต้ quote updateTime เดียวกัน
- Tax Invoice เป็นเอกสารอิสระ UI แจ้งให้ตรวจแยก ไม่ย้อนสต๊อกหรือแก้ใบกำกับที่ออกแล้วให้เอง
- หลัง commit patch เฉพาะ product codes ที่กระทบและ invalidate scopes ที่เกี่ยวข้อง หน้าที่เปิดอยู่รับ stock delta; ข้อมูลการเงิน/ประวัติหน้าอื่นตรวจใหม่ด้วย explicit refresh ตามนโยบายไม่มี polling
- Backup เก็บฟิลด์ correction ใน collections เดิมด้วยกลไกเดิม ยังไม่ได้ทดสอบ restore ข้อมูล correction จริงบน cloud และไม่ถือว่ามี Trigger เท่ากับ Backup สุขภาพดี

## Firestore impact

เส้นทางแสดงรายการ/รูปแบบใหม่/cache/diagnostics ไม่มี business DB writes เพิ่ม Auth/session ยังตรวจตามเดิม warm cache ไม่ข้ามการเพิกถอนสิทธิ์

ให้ N = แถวต้นฉบับ, M = แถวทดแทน, K = SKU ที่ delta ไม่เป็นศูนย์, Q = มี quote 1 หรือไม่มี 0:

| Operation | Writes ใน commit สำเร็จ |
|---|---:|
| แก้หมายเหตุ | N + 1 receipt |
| ยกเลิก | 2N + K + 1 receipt + Q |
| ทดแทน | 2N + M + K + 3 (counter, bill reservation, correction receipt) + Q |
| Exact retry ที่พบ receipt แล้ว | 0 business writes |
| Preview | 0 business writes |

Preview อ่านบิลเฉพาะ Doc_No และ batch stock เฉพาะ SKU ที่กระทบ/quote ถ้ามี Confirm อ่านตรวจซ้ำและตรวจ receipt/counterตามเส้นทางเลขบิลเดิม จึงเป็น reads ที่จำเป็นเพื่อรักษาความถูกต้อง ไม่ได้อ้างว่า workflow ใหม่ลด writes

การแยก PO/editor อาจมี auth RPC เพิ่มเมื่อเปิดทั้งสองส่วน แต่ส่วนที่ไม่เปิดไม่ต้องอ่าน/ส่งข้อมูล ส่วนทั้งหมดที่เปิดในภายหลังอาจมี total reads เท่าเดิมหรือมากขึ้น ต้องวัดตามการใช้งานจริง

## ผลวัดและการทดสอบ

ผลรอบนี้ใช้ local Firestore/GAS mocks และ Chromium บล็อก external HTTPS ไม่ใช้ Production เป็น test fixture:

- `npm test`: **260 passed, 0 failed** รวม correction, quote concurrency, lost response, audit cursor, cache corruption/expiry และ strict persisted catalog
- `npm run test:browser`: **131 groups passed** รวม 15 routes, roles, pagination, draft, image viewer, correction recovery, Dashboard ข้ามเดือน และ deferred editor/PO
- `npm run check`: **70 scripts + manifest** parse ผ่าน (ต่างจาก baseline เพราะย้าย barcode script ไป lazy loader)
- `npm run test:reads`: ผ่าน; มีผลใหม่ใน `test-results/read-model.json` และ assertion ของค่าที่ใช้รายงาน
- `git diff --check`: ผ่าน; release review bundle ตรวจ source/checksum แยกหลัง commit

| Fixture ใหม่ | ก่อน | หลัง | การตีความ |
|---|---:|---:|---|
| Products 50 แถว, references 5, lookahead 1, มีรูปทุกแถว | 106 document results | 56 document results | ลด **47.17%** เฉพาะข้อมูลเส้นทางนี้ ไม่รวม auth/index billing |
| JSON ของรายการเดียวกัน | 29,872 bytes | 26,275 bytes | ลดประมาณ **12.04%** ไม่ใช่เปอร์เซ็นต์เวลาเว็บ |
| เปิดรายการเดิมซ้ำใน server cache | — | 0 additional data-document results | ไม่รวม security validation/เวลาจริง |
| Dashboard 10,000 movements fixture | 4,064,451 bytes | 2,074,689 bytes | ลด JSON **48.96%**, DB reads ลด **0%** จาก matrix เพียงอย่างเดียว |

ผลก่อนหน้าใน read-model อื่นเป็น regression ของการแก้รอบเก่า ไม่ถือเป็นกำไรเพิ่มจาก release นี้ ตัวอย่าง Executions 44 รายการใน handoff เป็น baseline เดิม ไม่ใช่ page timing หลังแก้

## งานต่อที่ยังต้องพิสูจน์/เตรียม

1. วัด authenticated click-to-usable-data รายหน้าใน Staging/candidate release 10,000 products และข้อมูล movements/PO ตามจริง: อย่างน้อย cold/warm, กลับหน้าเดิม, หลัง stock/product/customer mutation, revoked session, 2 tabs และ 5 users; เก็บจำนวนรอบ p50/p95/max แยก auth/RPC/payload/decode/render
2. **Cold Dashboard ยังอ่าน movements ครบช่วง** และสร้าง health/graphs/drilldowns จากข้อมูลจริง ไม่ได้ทำ materialized summary/snapshot ใหม่ ส่วน cold POS/Quotation build/PO create ยังอาจต้องใช้ full catalog เพื่อคงการค้นหาครบชุด จึงยังรับรองทุกหน้า ≤10s ไม่ได้
3. ถ้ายังไม่ผ่าน ให้ review summary/snapshot design แยก: versioned chunks/manifest, owner/schema, source watermark, immutable generation, age, rebuild single producer, invalidate เฉพาะ scope/affected periods, correction/restore handling และปริมาณ read/write จาก rebuild ก่อนสร้าง durable storage บน Production
4. ตัวเลือก durable design: Drive snapshot folder แยกจากรูปและ Backup, catalog chunks ประมาณ 128–256KiB + dashboard summary แบ่ง period; อ่าน stale generation ไม่ได้แม้ไฟล์ยังอยู่; เก็บ generation ก่อนหน้าสำหรับ rollback/recovery; rebuild แบบ job/checkpoint ห้าม full scan ทุก mutation ต้องทำ load test และขออนุมัติที่เก็บ/สิทธิ์/Trigger ก่อนเปิดใช้ ไม่ได้สร้างของจริงในชุดนี้
5. ทดสอบ write workflow ใน Staging: midnight numbering, same-SKU/เปลี่ยน SKU/ราคา/เหตุผล, quote หลายบิล, lost response, Backup/Restore พร้อม counter/receipt ก่อนเปิด correction บน Production
6. ยืนยัน release/URL ใหม่ก่อน Deploy ตรวจ Editor ที่อาจมีการแก้ด้วยมือ สำรองและเทียบ saved Head/immutable version แล้วตรวจ Login/read-only UAT แยกจาก write UAT
7. Backfill เลขบิลเก่า, Backup health และ billed Read/Write monitoring เป็น backlog เดิมที่ต้องมีหลักฐาน/ขอบเขตแยก ไม่รันเองพร้อม release นี้

Source rollback ไม่ย้อน correction ที่ commit ไปแล้ว ห้ามลบ receipt/ledger หรือถอย daily counter เพราะจะเสี่ยงซ้ำ/ทำลาย audit

## Files changed

- Backend/API: `Code.gs`
- Catalog/cache/diagnostics/dialogs: `Shared.html`, `Master_Products.html`, `index.html`, `StockIssue.html`
- Document loading: `Quotation.html`, `Master_Tax_Invoice.html`, `Purchase_Orders.html`
- DOM-ready: `Master_Brands.html`, `Master_Categories.html`, `Master_Vendors.html`, `Master_Customers.html`, `Master_Zones.html`, `Master_Cars.html`, `Profile.html`, `Manage_Users.html`, `UiSystem.html`
- Verification: `package.json`, `tests/stock-corrections.test.cjs`, `tests/browser.cjs`, `tests/catalog-scale.test.cjs`, `tests/client-cache.test.cjs`, `tests/hybrid-cache.test.cjs`, `tests/read-efficiency.test.cjs`, `tests/read-model.cjs`, `tests/security.test.cjs`, `tests/support/services.cjs`
- Handoff/report: `docs/CODEX-HANDOFF-2026-10-28.md`, เอกสารนี้

ไฟล์ untracked `docs/SYSTEM-AUDIT-2026-10-11.md` เป็นงานเดิมของผู้ใช้ ไม่รวมใน commit นี้ Credentials, clasp, test outputs และ review bundles ไม่รวมใน Git

## เอกสารทางเทคนิคที่ตรวจ

- [Firestore quotas](https://firebase.google.com/docs/firestore/quotas): ใช้ขอบเขต payload/document ที่ต่ำกว่าเพดานบริการ และคง atomicity
- [Apps Script Cache](https://developers.google.com/apps-script/reference/cache/cache): cache อาจถูก evict ก่อน expiry จึงต้องรองรับ missing/corrupt chunks และ cache miss
- [HTML Service best practices](https://developers.google.com/apps-script/guides/html/best-practices): asynchronous data และแยก resource ที่ยังไม่ใช้จาก critical path
