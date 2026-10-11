# SYY-Shop — ปิดช่องทางเรียก backend ข้ามสิทธิ์ (S01/S02)

วันที่ 11 ตุลาคม 2569 — ขอบเขตที่ผู้ใช้อนุมัติ: ลำดับ 1–2 ของ System Audit เท่านั้น

## 1. สรุปผลการตรวจสอบ

แก้ Source ให้ browser เรียกได้เฉพาะ routing, gateways และ endpoints ที่จำเป็นก่อน Login รวม 8 ฟังก์ชัน จากเดิม 120 ฟังก์ชันสาธารณะในสองไฟล์ backend ทำ 112 ฟังก์ชันเป็น private โดยลงท้าย `_` ตามกฎ HtmlService ไม่เปิด alias ชื่อเดิมที่ข้ามการตรวจสิทธิ์กลับมา

Baseline ที่ตรวจและ Fetch ล่าสุด: `484c1548e464f6c3fa2e5dd17d4310dd7a165bfb`; `origin/main` ยังเป็น `6210f7418b6e69d21d876a9fd6a68b1d06fcb76b`

## 2. Root Cause

`getAuthHeader()` เป็น top-level public function ที่คืน OAuth header และ workers หลายตัวเข้าถึง Firestore/Drive โดยไม่ตรวจ session เอง แม้หน้าเว็บปกติเรียกผ่าน gateway ผู้เปิด HtmlService ก็มีช่องทางเรียกฟังก์ชันสาธารณะโดยตรง การซ่อนปุ่มหรือ whitelist ที่ frontend จึงไม่ปิดช่องทางนี้

[Google ระบุว่าฟังก์ชันลงท้าย `_` เรียกผ่าน google.script.run ไม่ได้](https://developers.google.com/apps-script/guides/html/communication#private_functions) การตรวจ export surface ใน local อ้างอิงกฎนี้; ยังไม่ใช่ผลทดสอบ RPC ของ Web App ที่ Deploy จริง

## 3. ผลกระทบ

- Business API operation names, response shapes, role policy และ workflows เดิมยังคงอยู่ ผ่านการจับคู่ registry/dispatch และ Regression
- Viewer ยังคงสร้าง/แก้ใบเสนอราคาและใบกำกับภาษีได้ตาม policy เดิม; master mutations ต้อง Staff และ admin operations ต้อง Admin เช่นเดิม
- Helpers, workers, provisioning, migration และ Restore ใช้ภายใน Server หรือโดยผู้มีสิทธิ์เข้าถึง Script Editor เท่านั้น ไม่เพิ่มสิทธิ์ให้บัญชีในแอป
- Template helper เปลี่ยนเป็น `include_()` จึงต้อง Sync backend และ HTML ที่เกี่ยวข้องพร้อมกัน
- Scheduled handlers เปลี่ยนชื่อ จึงต้องย้าย existing triggers เมื่อ Sync Source ก่อนเปิดใช้งานเวอร์ชันใหม่ ห้ามถือว่า commit นี้ปรับ triggers จริงแล้ว

## 4. แนวทางแก้ไข

คง public functions ดังนี้เท่านั้น:

| ฟังก์ชัน | เหตุผลที่เปิด |
|---|---|
| `doGet` | Routing และตรวจ session ของหน้าเว็บ |
| `apiGateway` | Registry, session, role และ Activity Log เดิม |
| `apiGatewayV2` | Registry/session/role ของ Product Images V2 |
| `authLogin` | Login/OTP ก่อนมี session |
| `authForgotPassword` | ขอ reset link ก่อนมี session |
| `authVerifyResetToken` | ตรวจ reset link |
| `authResetPassword` | ตั้งรหัสผ่านด้วย reset token |
| `authChangePasswordForced` | บังคับเปลี่ยนรหัสผ่านด้วย temporary token ก่อน Login |

API registry keys คงชื่อเดิม เช่น `saveProduct`, `saveMasterData`, `issueStock`; dispatch map เปลี่ยนไปเรียก private workers เช่น `saveProduct_`, `saveMasterData_`, `issueStock_` การบันทึก Brands/Categories ผ่าน `saveMasterData` ยังจำกัดสอง collections เดิม

Gateways ตรวจเฉพาะ own registry keys และ reject ชื่อ operation ที่ไม่ใช่ string, roles ที่ไม่รองรับ และ arguments ที่ไม่ใช่ array ไม่แก้กฎธุรกรรมหรือ credential/session algorithms ในงานนี้ Profile ที่ไม่มี token เปลี่ยนไปหน้า Login แทน direct RPC fallback

## 5. ความเสี่ยงและแผน Rollout

ยังไม่ได้ Sync/Deploy และยังไม่ได้เปลี่ยน trigger/Production configuration ใด ๆ ไม่มี migration, restore หรือการแก้ข้อมูลย้อนหลัง

ก่อน rollout ที่ได้รับอนุมัติ:

1. ทดสอบ Source ทั้งชุดใน staging รวมการ render template, browser RPC จริง, Login/Reset/OTP, Stock, เอกสาร, รูปสินค้า และ role restrictions
2. บันทึก handler, schedule และเจ้าของ existing triggers แล้ววางช่วง Sync ที่ไม่ชนเวลางานตามกำหนด
3. Sync backend และ HTML ทั้งชุด เปลี่ยน handler ของ triggers ที่ใช้อยู่:

| เดิม | ใหม่ | Schedule เดิมใน Source |
|---|---|---|
| `weeklyBackupJob` | `weeklyBackupJob_` | วันอาทิตย์ ช่วงชั่วโมง 02 |
| `cleanupOldActivityLogs` | `cleanupOldActivityLogs_` | ทุกวัน ช่วงชั่วโมง 03 |

4. ใช้ Triggers UI เพื่อคง schedule จริง หรือใช้ `setupWeeklyBackupTrigger_()` / `setupActivityLogCleanupTrigger_()` สำหรับ schedule เดิมใน Source หลังยืนยัน authorization ใน staging Helpers ลบทั้งชื่อเก่า/ใหม่ของงานเดียวกันเพื่อไม่สร้าง duplicate schedules และไม่ลบงานอื่น `getProjectTriggers()` เห็นเฉพาะ triggers ของผู้ใช้ที่รัน จึงต้องตรวจเจ้าของจริงด้วย อย่ารัน job bodies บน Production เพียงเพื่อทดสอบ
5. อัปเดต Web App version โดยคง URL และ permission configuration เดิม แล้วทำ live UAT และตรวจ trigger executions
6. หาก rollback ต้องคืน HTML/backend/handler ให้ตรงชุดเดียวกัน และประเมินการจำกัดบริการ เพราะ baseline เดิมเปิดช่องทาง S01/S02 กลับมา

ไม่เปลี่ยน `appsscript.json`, OAuth scopes, executeAs/access, Firestore rules/indexes หรือ application roles ไม่อ้างว่าปิดหรือทดสอบ API-executable deployment แยกต่างหากซึ่งยังไม่ได้ตรวจสถานะจริง

## 6. รายการที่แก้ไขแล้ว / Files Changed

- `Code.gs`: 112 private renames และจุดอ้างอิง; dispatch ไป private workers; gateway checks; trigger registration และการล้างชื่อ handler เดิม
- `ProductImagesV2.gs`: ใช้ private shared helpers; gateway checks; delete worker เรียก `deleteProduct_`
- HTML 19 ไฟล์: `Manage_Users.html`, `Master_Brands.html`, `Master_Cars.html`, `Master_Categories.html`, `Master_Customers.html`, `Master_Products.html`, `Master_Tax_Invoice.html`, `Master_Vendors.html`, `Master_Zones.html`, `Profile.html`, `Purchase_Orders.html`, `Quotation.html`, `Shared.html`, `StockIssue.html`, `Styles.html`, `UiSystem.html`, `XLFilter.html`, `index.html`, `login.html`: เปลี่ยน template includes; Profile ปิด fallback
- `README.md`, `README-redesign.md`: ตัวอย่างใช้ `include_`
- `tests/backend.test.cjs`: เรียก private workers ตามชื่อใหม่ โดยคง assertions ของ Regression เดิม
- `tests/security.test.cjs`: เพิ่ม 16 Security/compatibility test groups
- `tests/browser.cjs`: Renderer รองรับ `include_`; เพิ่ม smoke 15 หน้าและ Brands/Categories gateway save
- `package.json`: `npm test` รัน Backend และ Security tests
- รายงานนี้; รวม 28 ไฟล์ งาน System Audit เดิมที่ยังไม่ commit ไม่รวมใน commit นี้

## 7. ผลการทดสอบ

| Check | ผล |
|---|---|
| `npm test` | Passed 41/41: Backend เดิม 25 + Security 16 |
| `node tests/syntax.cjs` | Passed 43 scripts + manifest |
| `node tests/browser.cjs` | Passed 18 groups รวม 15-page load smoke และ Brands/Categories save |
| Private/export contract | Passed public functions 8 ตัว; workers/helpers ที่ปิดเรียกตรงไม่ได้ตาม local model |
| Permissions | Passed role matrix ทุก V1 operation 62 รายการ และ V2 operations 5 รายการ; invalid/expired sessions ถูกปฏิเสธ |
| Pre-login auth | Passed mocked Login/OTP, Forgot/Verify/Reset และ forced-password flow |
| Trigger compatibility | Passed mock เปลี่ยน old/new handlers โดยไม่สร้างซ้ำ ไม่ลบงานอื่น และคง schedule/worker behavior |
| Semantic comparison | Passed 239 top-level declarations หลังย้อนชื่อ private มี AST เหมือน baseline; gateway/trigger changes 4 functions review แยก |
| `git diff --check` | Passed |
| Manifest/configuration diff | ไม่มีการเปลี่ยน |
| Real Apps Script RPC/OAuth/Mail/Drive/trigger execution/Production | Not Tested |

ครั้งแรก `npm test` ใน sandbox ไม่สามารถ spawn Node test subprocess (`EPERM`) ได้ รันซ้ำด้วยสิทธิ์สำหรับ local process แล้วผ่าน Browser ใช้ local Chrome, mocked gateway และ block external services ไม่มี credentials จริงหรือ Production requests

## 8. ผลกระทบต่อ Firestore

ไม่เปลี่ยน schema/collections/fields/doc IDs หรือ stock/document write payloads ไม่มีการอ่าน/เขียน Production ในการทดสอบ

การทำ helper/workers เป็น private และใช้ dispatch เดิมไม่เพิ่ม Firestore operations ให้ successful business flows การตรวจ own keys/type/role เป็น JavaScript checks ไม่อ่านฐานข้อมูลเพิ่ม Unauthorized/unsupported calls หยุดก่อน workers และไม่มี network calls ใน negative tests งานนี้ไม่อ้างเปอร์เซ็นต์ลด Read/Write หรือค่าใช้จ่าย Production

## 9. Git Commit และ Deployment

Branch: `codex/security-rpc-boundary-20261011` สร้างจาก baseline ที่ระบุข้างต้น SHA ของงานที่บันทึกสำเร็จรายงานในข้อความส่งมอบและตรวจได้จากประวัติ branch

สถานะ: Implemented in Source; Static/Automated/Local Browser Tests Passed; ต้องทำ staging/live UAT และ trigger rollout ก่อนรับรอง Production ยังไม่มี Push, Merge, Apps Script Sync หรือ Deployment ใหม่จากงานนี้

## 10. งานคงเหลือ

S01/S02 แก้ใน Source แล้ว รอ staging/live verification และ rollout ที่อนุมัติ งาน Audit อีก 38 ประเด็นยังคงอยู่ รวม username argument spoofing (S03), durable session revocation (S04), stock idempotency (D01/D02), Mail scope (S11) และข้อมูล/UX/Read optimization อื่น ๆ ไม่ได้ขยาย scope ไปแก้ใน commit นี้
