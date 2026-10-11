# SYY-Shop — รายงาน Backlog วันที่ 11 ตุลาคม 2569

## 1. สรุปผลการตรวจสอบ

ดำเนินการทั้ง 6 รายการที่ผู้ใช้อนุมัติจาก Master AI Development Instructions: Tax Invoice Consistency, Quotation Price Editing, Product/Stock Concurrency, Quotation Quick Add Customer, Storage Zone Rack Level และ Password Visibility

ตรวจ Source จาก `origin/main` และ fetch ยืนยันอีกครั้งก่อน Commit: `6210f7418b6e69d21d876a9fd6a68b1d06fcb76b` ไม่มี Source changes ของผู้ใช้อยู่ใน Workspace เมื่อเริ่มงาน สร้าง Branch `codex/daily-backlog-20261011` แยกจาก main

สถานะ: Implemented in Source, Static Checks Passed, Automated Tests Passed, Local Browser Regression Passed และพร้อมทดสอบ UAT บน Apps Script สภาพแวดล้อมจริง ยังไม่ได้ Sync หรือ Deploy

## 2. Root Cause

| งาน | สาเหตุที่ยืนยันจาก Source |
|---|---|
| Tax Invoice | ค่าเริ่มต้น Buyer/Quick Add Branch เป็นสำนักงานใหญ่; หลัง Save โหลดปีที่กำลังดูแทนปีของเอกสาร; Dashboard ไม่ render ใหม่; อ่านเอกสารเดิมล้มเหลวแล้วอาจจัดสรรเลขใหม่; HTTP error ของ list ถูกกลืนเป็น array ว่าง |
| Quotation Price Editing | `setPrice()` และ `setQty()` เรียก `renderBasket()` ซึ่งแทนที่ input DOM ทุก keystroke ทำให้ focus/cursor หาย |
| Product/Stock Concurrency | `saveProduct()` ส่ง Current_Stock จากฟอร์มและ PATCH ทั้งเอกสาร จึงเขียนทับ Stock Issue/Receive Goods ที่บันทึกจากอีกเบราว์เซอร์แล้วได้ |
| Quotation Customer Workflow | ไม่มี Quick Add Customer ในหน้า Quotation; preview ใช้ Customer master ปัจจุบันแทน snapshot ในเอกสาร |
| Rack Level | ไม่มี field, validation, form, column หรือ search/filter; Zone label บางจุดไม่แสดง Rack No และไม่มี Rack Level |
| Password Visibility | ช่องรหัสผ่านเดิมไม่มี Eye/Eye-Off presentation control ร่วมกัน |

ยืนยันจาก Code และการจำลองสถานการณ์ใน automated tests ไม่ได้อ้างว่า reproduction บน Production ผ่านแล้ว

## 3. ผลกระทบ

- Product Management, Dashboard, Stock Issue และ Receive Goods ต้องเห็น Current_Stock จาก Firestore หลัง Save การแก้ชื่อ/ราคาไม่ควรเขียนสต๊อกเก่าทับ
- Tax Invoice List, Dashboard, View/Print/PDF source ต้องอ้างอิงเอกสารที่บันทึกจริง รวมถึงกรณีเปลี่ยนปีโดยคง Invoice_No เดิม
- Quotation ต้องคงราคาที่เจรจาและ Customer snapshot เดิม ไม่เปลี่ยน Product Selling Price และคง Stock_Issued metadata เมื่อแก้ไข
- Zone labels ของ Product table, Product dropdown และ Dashboard ต้องแสดง Rack Level เหมือนกันหลัง delta update
- Quick Add Customer ใช้ `saveCustomer` ผ่าน `apiGateway` ตามเดิม: Staff/Admin เพิ่มลูกค้าได้ Viewer สร้างเอกสารได้แต่ไม่ได้สิทธิ์เพิ่ม Master Customer
- Eye/Eye-Off ใช้ input เดิม ค่าเดิม และ auth handlers เดิม ไม่เปลี่ยน password hashing, session หรือ OTP/TOTP

## 4. แนวทางแก้ไข

- Product edit ใช้ updateMask; normal edit ตัด Current_Stock ออกจาก payload ส่วนการแก้สต๊อกโดยตั้งใจส่ง `originalStock` ตรวจเทียบกับ server และใช้ updateTime precondition หากมี concurrent write จะให้ผู้ใช้รีเฟรชและตรวจสอบใหม่ Old client ที่ไม่มี baseline จะไม่เขียน cached stock กลับ
- Tax Invoice/Quotation edit อ่านเอกสารเดิมแบบ fail closed; PATCH พร้อม precondition และคง document number; ส่ง saved document ใน response เพื่อใช้ preview โดยไม่เพิ่มการอ่านเอกสารหลัง Save
- Refresh หลัง Save ใช้ list-only endpoint ของปีที่บันทึกหรือมุมมองทุกปีเดิม; แยก write success กับ refresh failure และไม่ retry write อัตโนมัติ; ไม่แสดง server error เป็นข้อมูลว่าง
- Quotation input เปลี่ยนเฉพาะ line totals/stock warning/summary ไม่แทน input DOM ระหว่างพิมพ์; ตรวจราคากับจำนวนทั้ง client และ server
- Quick Add Customer เพิ่มข้อมูลครั้งเดียว ใช้ response patch local customer state และเลือก record ใหม่ โดยคง basket, note และ draft
- Rack_Level เก็บเป็น string 1–5; เมื่อมี Rack No ใหม่หรือเปลี่ยนเลข Rack ต้องเลือกระดับ; legacy rack เดิมที่ไม่มีระดับยังอ่านและแก้ข้อมูลอื่นได้ กฎชื่อ Area ซ้ำยังเหมือนเดิม
- Password control ใช้ native button, SVG, aria-label/aria-pressed และ keyboard; ซ่อนกลับเมื่อ reset, ปิด modal ผ่าน Shared หรือออกจากหน้าไป background

Firestore field mask และ precondition ใช้ตาม [REST PATCH documentation](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/patch) และ [Precondition documentation](https://firebase.google.com/docs/firestore/reference/rest/v1/Precondition)

## 5. ความเสี่ยงและข้อจำกัด

- ทดสอบ REST/transaction payload ผ่าน mock ยังไม่ได้พิสูจน์ Apps Script OAuth, Firestore rules/index/quota, Drive หรือ Production concurrency จริง
- การแก้ stock โดยตรงจาก Product Management ยังคง workflow เดิม ไม่มีการเพิ่ม Stock Movement ใหม่สำหรับ manual adjustment
- ต้อง Sync frontend/backend ที่เปลี่ยนร่วมกันและ reload หน้าใช้งานหลัง rollout โดยเฉพาะ client เดิมที่ยังไม่มี stock baseline
- กฎ Area uniqueness ยังเป็น policy เดิมและใช้ collection cache ตรวจซ้ำ ไม่มีการเปลี่ยนเป็น composite location key หรือสร้าง database uniqueness constraint
- list query ยังมีเพดานเดิม 1,000 records/ปี และ 1,500 records สำหรับมุมมองทุกปี; ไม่ได้ขยายเป็น pagination หรือเปลี่ยนระบบรายงาน
- Meta years ใช้ helper เดิม มี fallback ฝั่ง UI ให้เลือกปีที่ร้องขอได้แม้ metadata ยังไม่รวมปีนั้น ไม่ได้ย้าย/ลบเอกสารย้อนหลัง
- การ Save สำเร็จแต่ refresh ล้มเหลวยังแสดงคำเตือนและคง saved preview; ข้อมูลอื่นที่ refresh ไม่สำเร็จต้องให้ผู้ใช้รีเฟรชก่อนถือว่า synchronized

## 6. รายการที่แก้ไขแล้ว / Files Changed

| File | การแก้ไข |
|---|---|
| `Code.gs` | Mask/precondition options, readExistingDocument_, Product stock guard, document dates/line validation, unspecified branch, saved response, historical customer snapshot, list error propagation, Rack_Level validation/serialization/labels |
| `Master_Products.html` | Stock baseline, dirty-input-safe STOCK_DELTA, saved baseline reset, recovery refresh, duplicate submit/close guard และ zone delta labels |
| `index.html` | Dashboard Product Edit ส่ง stock baseline, ใช้ Product delta หลัง Save และ zone label propagation |
| `Master_Tax_Invoice.html` | Buyer/Quick Add branch, Staff/Admin Quick Add controls, duplicate submit protection, refresh ปีที่บันทึก, Dashboard update และ saved preview/error recovery |
| `Quotation.html` | Stable price/qty input, realtime outputs, Quick Add Customer modal, draft preservation, saved prices/customer preview, Save/Refresh recovery และ validation |
| `Master_Zones.html` | Rack Level form/conditional requirement, table/search/filter, legacy state และ delta |
| `UiSystem.html` | Shared accessible password Eye/Eye-Off controls รองรับ static/dynamic fields |
| `Shared.html` | ซ่อน password ที่แสดงอยู่เมื่อปิด modal |
| `.gitignore` | ไม่ track dependencies, test output และ local clasp credentials/config |
| `package.json` | Test/check commands และ Playwright development dependency เท่านั้น |
| `tests/backend.test.cjs` | 25 Backend regression cases |
| `tests/browser.cjs` | 16 local Browser regression groups พร้อม screenshot evidence |
| `tests/syntax.cjs` | Parse Script/inline JS/Apps Script manifest |
| `docs/DAILY-BACKLOG-2026-10-11.md` | รายงานส่งมอบและ UAT checklist |

API contract additions: `saveProduct` รับ optional `originalStock`; `saveTaxInvoice` คืน `invoice`; `saveQuotation` คืน `quotation`; `saveZone` รับ optional `rackLevel`; Zone readers คืน `Rack_Level`; `saveMasterData` มี internal editOptions สำหรับ callers ที่ใช้ masked edits ไม่มีการเพิ่ม callable endpoint หรือเปลี่ยน role requirement

## 7. ผลการทดสอบ

| สถานะ | การตรวจ |
|---|---|
| Passed | Backend regression 25/25: stale/legacy/intentional product stock edits, concurrent write/deletion, invoice number/branch/totals, quotation negotiated price/snapshot/stock metadata, invalid lines/dates, Rack Level/legacy/string field, RBAC และ API dispatch |
| Passed | Stock Issue mock integration: stock+movement ใน commit เดียว, updateTime precondition, ไม่ยอม stock ไม่พอ, ใช้ราคาจาก quotation ที่ปิดงานโดยไม่เขียน Master Selling Price |
| Passed | Receive Goods mock integration: stock+movement+PO receipt/status ใน commit เดียวพร้อม preconditions |
| Passed | Browser regression 16/16: decimal typing/focus/input identity, totals/VAT/profit/margin, Quick Add/draft/cancel/duplicate save, cross-year invoice, saved preview, refresh errors, Viewer controls, zones, stock/master deltas, Image Draft และ password controls |
| Passed | Browser desktop 1365px และ mobile 390px; keyboard Eye/Eye-Off, native form reset, Profile และ dynamic password fields |
| Passed | Syntax 43 script blocks/files และ manifest JSON; `git diff --check` ไม่มี whitespace errors |
| Passed | ตรวจภาพ local mobile Quick Add และ Login ว่า form/toggle อยู่ภายใน viewport |
| Failed | ไม่มี failures คงเหลือในรอบตรวจสุดท้าย |
| Not Tested | Apps Script runtime integration, Firestore/Drive จริง, live invoice print/PDF generation, actual login/OTP/reset credentials และ Production Browser UAT |
| Approved | ผู้ใช้อนุมัติ Push Branch ไป GitHub สาธารณะและสร้าง Draft PR สำหรับ Review แล้ว ไม่รวม merge หรือ Production deployment |
| Blocked | Production sync/deploy/verification ยังไม่ได้ดำเนินการ ต้องมี target Apps Script/deployment และการอนุมัติ Production deployment ตาม Master Instructions §10 Step 5 |

คำสั่งทดสอบ:

```text
npm test
npm run check
npm run test:browser
```

Backend/check ใช้ Node โดยไม่ต้องติดตั้ง runtime dependencies สำหรับ Browser ต้องมี Playwright 1.62.1 และ Chrome/Edge หรือ Playwright Chromium ใช้ `BROWSER_EXECUTABLE` เพื่อระบุ executable อื่นได้ การทดสอบครั้งนี้ใช้ Node v24.21.0 และ Playwright จาก bundled workspace runtime, Chrome headless local และ mocked Apps Script gateway ปิดการเข้าถึง HTTPS ภายนอกใน browser tests

หลักฐาน Browser อยู่ใน `test-results/browser-result.json` และ screenshot PNG ภายใต้ `test-results/` ซึ่งถูก ignore จาก Git เพราะเป็น generated output

## 8. ผลกระทบต่อ Firestore

ระหว่างดำเนินงานนี้ไม่มีการอ่านหรือเขียน Firestore Production; การทดสอบทั้งหมดใช้ mock

| Flow หลังนำ Source นี้ไปใช้ | Reads/Writes และผลกระทบ |
|---|---|
| Product normal edit | คง targeted read เอกสารเดิมที่มีอยู่ใน flow เดิม; masked write 1 ครั้งไม่รวม Current_Stock; readback/duplicate queries/cache invalidation ตามเดิม |
| Intentional stock edit | ใช้ read เดิมตรวจ baseline และ updateTime; write เมื่อไม่ conflict; reject ก่อนเขียนเมื่อ stale baseline และไม่มี blind retry |
| Invoice/Quotation save | ไม่เพิ่ม read เพื่อสร้าง saved preview ใช้ค่าที่ server บันทึกใน response; list-only refresh 1 call หลัง Save และไม่ hydrate Product/Customer collections ซ้ำ |
| Quotation price/qty typing | Browser test ใช้ state/output ฝั่ง client ไม่ส่ง Save API ระหว่างพิมพ์; ไม่เพิ่ม Firestore write |
| Quick Add Customer | saveCustomer 1 call; ใช้ saved response patch local state ไม่เรียก getCustomersFull ซ้ำ |
| Zone edit | เพิ่ม targeted read เอกสารเดิม 1 ครั้งสำหรับ legacy validation/รักษา hidden fields/precondition; write 1 ครั้งตามเดิม; create ไม่มี targeted legacy read |
| Zone search/filter/label delta | ทำจาก cache ไม่มี write/read เพิ่มจาก interaction เหล่านี้ |
| Password visibility | Presentation only ไม่มี Firestore/API mutation |
| Product Image Draft | Regression ยืนยัน staging/delete/move/primary/cancel ไม่เรียก mutation API; commit-on-Save behavior เดิมยังอยู่ |

Schema: เพิ่ม `Master_Zones.Rack_Level` แบบ optional string (1–5 หรือว่างใน legacy record ที่ถูกแก้ไข) ไม่มี collection ใหม่ ไม่มี rename/delete/migration/backfill ไม่มี mass update และไม่มีการคำนวณ stock ย้อนหลัง

จำนวน call ข้างต้นที่เป็น regression evidence มาจาก mock; ไม่ใช่การวัด Firestore billing/จำนวน billed reads หรือ latency บน Production จึงไม่มีการอ้างเปอร์เซ็นต์ลดค่าใช้จ่าย

## 9. Git Commit และ Deployment

- Implementation Commit SHA: `d4bc92ea53003a65270ecb386d37220a2c45a0d7`
- Branch: `codex/daily-backlog-20261011`
- Base: `6210f7418b6e69d21d876a9fd6a68b1d06fcb76b`
- Commit แยกเอกสารส่งมอบจาก Implementation
- Remote push / Draft PR: ได้รับอนุมัติจากผู้ใช้แล้ว กำลังดำเนินการเผยแพร่ Branch สำหรับ Review
- `main` ไม่ได้ merge การเปลี่ยนแปลงนี้
- Apps Script Synced: ไม่ได้ดำเนินการ
- Deployment Updated: ไม่ได้ดำเนินการ
- Production Browser UAT / Production Verified: ยังไม่ได้ดำเนินการ
- Local automated results ไม่ใช่หลักฐานว่าการ Deploy ปัจจุบันได้รับ Source ใหม่แล้ว

## 10. งานคงเหลือ

Source implementation ทั้ง 6 รายการและ local regression เสร็จแล้ว ต้อง Review และ UAT บน Apps Script ที่ระบุไว้ก่อนอนุมัติ Production rollout:

1. ทดสอบ 2 browser: A เปิด Product Edit, B ตัด/รับ stock, A Save ชื่อหรือราคา; stock ต้องคงค่าที่ B commit และ manual stock edit ที่ stale ต้องถูก reject
2. ทดสอบ Tax Invoice branch ว่าง/จริง, Quick Add, Save/Preview/Dashboard และย้าย Invoice_Date ไปอีกปีโดยคง Invoice_No; ตรวจ Print/PDF และเอกสารเก่า
3. ทดสอบ Quotation typing/Select All/Paste, negotiated price, totals/VAT/profit/margin, reopen saved quote, Quick Add ตาม role และตัด stock จาก quotation ที่ปิดงานแล้ว
4. ทดสอบ Rack Level 1–5, legacy rack, disabled/required state, Area duplicate policy, filter/search และ labels ใน Product/Dashboard
5. ทดสอบ Login/Reset/Force Change/Profile/Disable TOTP password fields รวม keyboard/mobile โดยไม่เปลี่ยน auth payload
6. ตรวจ quota/real read-write telemetry และ Stock Issue/Receive Goods atomic failure scenarios ใน non-production environment
7. Sync files ที่เปลี่ยนไปยัง target Apps Script แล้วสร้าง deployment version ใหม่เมื่อได้รับอนุมัติ Production deployment ตรวจ Browser UAT และ Production verification แยกกัน
