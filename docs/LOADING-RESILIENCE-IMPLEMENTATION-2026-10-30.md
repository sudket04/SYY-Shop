# แก้การเปิดหน้าและจัดลำดับโหลดข้อมูล — 30 ตุลาคม 2569

**อัปเดตหลังimplementation:** ผู้ใช้สั่งDeployแล้ว เผยแพร่ **Version104 เวลา06:30 วันที่30ต.ค.2026 Asia/Bangkok** จากruntimea0973cc ตรวจSaved Head/immutable sourceตรง25/25ทั้งคู่ ดู [รายงานDeploy104](DEPLOYMENT-2026-10-30-V104.md) ขอบเขตการทดสอบจำลองและข้อความ“ยังไม่Deploy”ในประวัติimplementationเดิมให้แยกจากสถานะเผยแพร่ล่าสุดนี้

ต่อจาก [ผลวิเคราะห์29ตุลาคม](LOADING-ROOT-CAUSE-ANALYSIS-2026-10-29.md) ผู้ใช้อนุมัติให้แก้ไขและกำชับห้ามกระทบข้อมูล DB จริง Baseline Source `c7a01ae` การเปลี่ยนแปลงรอบนี้อยู่ใน Source/การทดสอบจำลองเท่านั้น **ไม่ได้ Sync/Deploy, ส่ง Login, เรียกธุรกรรมบนระบบจริง, รัน Backup/Restore หรือเปลี่ยนข้อมูล/สิทธิ์/Trigger/index/schema**

## ผลที่แก้

| ปัญหา | การเปลี่ยนแปลง | ผลและข้อจำกัด |
|---|---|---|
| Shell รอ readiness แล้วซ่อน iframe จนแสดง timeout | เพิ่ม `UiBootstrap.html` ก่อน dependency ภายนอกครบ15หน้า; ready/ACK ตรวจ channel/origin/ancestor/descendant เดิม และ parent-origin hint ที่ server ตรวจรูปแบบ | รองรับ wrapper หลายชั้นและกรณีไม่มี ancestorOrigins; ส่ง readiness สูงสุด4ครั้งและหยุดเมื่อ ACK ไม่มี business RPC จากการส่งซ้ำ ไม่ใช้ `postMessage('*')` หรือปลดหน้าจาก load event อย่างเดียว |
| CDN ช้าขวาง parser และ initialization | ถอน remote scripts และ font imports จากเส้นทางแรก โหลด fonts หลัง DOM พร้อม PDF/Excel/QR/Barcode เมื่อใช้งาน | ตาราง/หน้า Login ไม่ต้องรอเครื่องมือเสริม; ใช้ fonts สำรองได้ รูปยังโหลด metadata/cache แบบเดิม ไม่มีการย้ายหรือแก้รูปใน Drive |
| เครื่องมือยืนยันใช้งานไม่ได้เมื่อ SweetAlert CDN ล่ม | มีกล่องยืนยันในเครื่องทันที โหลด library แบบไม่ขวางกล่องปัจจุบัน; รองรับ cancel, focus trap, กลับโฟกัส และปิดแบบไม่ยืนยันเมื่อ session หมดอายุ | ไม่ auto-confirm ไม่ใช้ CDN failure เป็นเหตุให้ทำรายการ ไม่มี dropdown แปลกปลอม; PDF ที่โหลดไม่สำเร็จปลด busy และแนะนำสั่งพิมพ์ ส่วน QR ยังคงมีทางใช้ secret text เดิม |
| การอ่านบัญชี HTTP429/500/503 ถูกตีความว่า session หมดอายุ | Gateway ใช้ strict session validation แยก `AUTH_UNAVAILABLE`; doGet คืนหน้าสถานะการเชื่อมต่อที่ไม่มี business data แทน Login ปกติ | เก็บ session เดิมไว้และให้ลองใหม่ได้ แต่ไม่คืน business data เมื่อยังตรวจสิทธิ์ไม่ได้ บัญชีถูกลบ/ปิด/เปลี่ยนสิทธิ์ยังถูกปฏิเสธทันที |
| Global lock ไม่ว่างถูกแจ้งว่าใช้โควตาเกิน | แยก `READ_BUSY` จาก `READ_LIMITED` พร้อม retryAfter | คง read limits และการตรวจสิทธิ์เดิม ไม่ bypass lock หรือปรับธุรกรรมสต๊อก และไม่มี automatic retry ของข้อมูล |
| Background reads แย่งข้อมูลหลัก/คำขอเก่ายังค้าง | จำกัดคิวอ่านพร้อมกัน3งานต่อหน้า ให้ foreground มาก่อน image prefetch; ตรวจ sequence/revision ก่อนส่งคำขอสินค้าที่รอคิว | คำขอที่ถูกแทนที่หรือหมดอายุไม่ส่ง RPC; timeout คืน capacity และไม่รับผลเก่ามาทับ explicit retry Writes ใช้เส้นทางเดิม ไม่เข้า queue ไม่ยกเลิกและไม่ retry อัตโนมัติ |
| มองไม่เห็นจุดที่การเปิดหน้าติด | เก็บ trace เปิดเมนู/UI-ready/first successful read callback/error ในหน่วยความจำสูงสุด20รายการ; log ข้อผิดพลาด gateway เฉพาะ operation ที่อนุญาต/code/เวลา | ไม่ส่ง telemetry RPC ไม่เขียน Firestore ไม่เก็บ URL query/token/ข้อมูลลูกค้าหรือบิล Trace ของ read callback ไม่ใช่หลักฐานว่าองค์ประกอบทุกส่วนของหน้าวาดเสร็จ; product/Dashboard ยังคงมี view/render timings เดิม |

การรอ read45วินาทีเป็น deadline ของ Browser รวมเวลารอคิว ไม่ใช่การสั่งหยุด GAS execution ที่ส่งแล้ว Server อาจทำงานเสร็จภายหลังและ Browser จะทิ้ง late callback ตามเดิม คิวจึงจำกัดงานที่กำลังรอผลฝั่ง client ไม่ได้รับรองว่าคำขอ server ที่ timeout ไปแล้วถูกยกเลิก

## Cache และความถูกต้องที่รักษาไว้

- ต่อยอด CacheService + memory/IndexedDB, conditional version validation, scope/generation invalidation และ in-flight coalescing เดิม ไม่สร้าง cache ซ้อนหรือขยายอายุเพื่อข้ามการตรวจสิทธิ์
- ไม่เก็บ token/credentials/ข้อมูลธุรกรรมเพิ่มใน persistent cache ไม่ใช้ข้อมูล persisted ก่อน server ตรวจสิทธิ์/เวอร์ชันตาม policy เดิม
- หน้า Products คง100รายการ, cursor, search/XLFilter/sort ครบชุด, Export, draft และการไม่เด้งกลับหน้าแรก
- รูปหน้าปัจจุบันยัง prefetch metadata ไม่เกิน100รายการตามคำสั่งก่อนหน้า แต่ทำเป็น background priority และข้าม batch ที่ไม่เกี่ยวกับหน้า/intentแล้วเมื่อยังไม่ได้ส่ง ไม่ดึงรูปทั้ง catalog และไม่ทำ N+1 ต่อแถว
- Stock commit/CAS/revision/idempotency/receipt/เลขบิล/ledger/correction/สิทธิ์ Admin-Staff-Viewer ใช้กลไกเดิม ไม่ปรับข้อมูลย้อนหลัง ไม่สร้าง summary documents หรือ migration
- อัปเดต Profile และ Manage Users ให้ส่งสถานะอ่าน/ผิดพลาดตาม helper เฉพาะหน้าของตัวเอง จึงไม่สมมติว่าทั้งสองหน้าใช้ `callApi` รูปแบบเดียวกับหน้ารายการทั่วไป

## การทดสอบ

ทดสอบด้วย in-memory Firestore/GAS mocks และ Chromium local เท่านั้น Browser tests บล็อก external network; script tools ที่ทดสอบสำเร็จตอบจาก route fixture ไม่ได้โหลดจากบริการจริง

| การตรวจ | ผลสุดท้าย |
|---|---|
| Unit/security/integrity/regression | **296/296ผ่าน**, fail0 |
| Browser ทั้งระบบ | **155/155กลุ่มผ่าน** |
| HTML → real gateway/workers → mock Firestore,10,000สินค้า | **10/10กลุ่มผ่าน**, ตรวจว่าไม่มี commit/patch/delete REST ในเส้นทางอ่าน |
| Syntax/manifest, read model, diff check | **52scripts + manifest parseผ่าน**, read modelและdiff checkผ่าน |

กรณีใหม่ครอบคลุม: readiness ครั้งแรกหาย/ACK/หมดอายุ, origin/channel/source ปลอม, wrapper ไม่มี ancestorOrigins, auth outage เทียบกับ revoked/deleted user, busy เทียบกับ quota, standalone connection-status template, foreground/background queue, queued timeout/late response/explicit retry, obsolete criteria, CDN ไม่พร้อม, กล่องยืนยันเหนือ modal และ keyboard/session recovery, deferred Excel/PDF/QR โดยไม่ส่งคำสั่งเขียน

Fixtureไม่ตัดremote script tagsออกจากHTMLอีกต่อไป เพื่อไม่ซ่อนปัญหาdependencyในอนาคต ตรวจแล้วว่าHTMLปัจจุบันครบ15routesให้ผลเหมือนกันก่อน/หลังถอดขั้นตอนตัดscript และไม่มีremote parser scriptsเหลือในSource เส้นทางที่ต้องใช้เครื่องมือเสริมยังทดสอบlazy loaderและfailure recoveryแยก

ยังคงตรวจ unknown write/double submit/replay, บิลแทนที่/ยกเลิก, stock race, preview invalidation, search/XLFilter/Export10,000สินค้า, image retry/draft/close, หน้าเปลี่ยน/scroll และ IndexedDB expiry/invalidation ตาม regression เดิม

รอบตรวจพบ test รอ25msเพื่ออ่านสถานะ write failure แล้วตรวจเร็วเกินไปบนเครื่องที่ทำงานพร้อมกัน เปลี่ยนให้รอ busy state จบก่อนกดซ้ำ โดยยังตรวจว่ามี save เพียงครั้งเดียวและ unknown-result guard ทำงาน ไม่ลด assertion หรือเปลี่ยนกฎบันทึกธุรกรรมเพื่อให้ test ผ่าน

## Firestore impact

**การทดสอบรอบนี้ไม่อ่านหรือเขียน Production DB** ไม่มีการส่งธุรกรรมจริงหรือกด Login และไม่รัน Backup/Restore

Source ที่แก้ไม่เพิ่ม query endpoint, Firestore write, snapshot collection, counter หรือ telemetry write ในเส้นทางอ่าน ยังอ่านบัญชีจริงเพื่อตรวจ revocation ตามเดิม และคงค่า limiter ใน Script Properties ที่มีอยู่แล้ว

ผลที่ลดได้โดยโครงสร้างคือคำขอสินค้าที่รอคิวและถูกแทนที่ก่อนส่ง รวมถึงงานรูปที่ยังไม่ได้ส่งและไม่เกี่ยวกับหน้าปัจจุบันแล้ว Readiness retry/fonts/skeleton/dialog/diagnostics ไม่อ่าน Firestore ส่วน coalescing และ cache hit ยังช่วยข้ามการอ่าน business data ตาม policy เดิม

ไม่อ้างเปอร์เซ็นต์ลด Reads/เวลาโหลดทั้งระบบ เพราะยังไม่ได้วัด production billed usage หรือ authenticated timing metadata รูป100รายการที่ยัง prefetch มีต้นทุนเดิม การเปลี่ยน priority ไม่ได้ทำให้100document readsกลายเป็น0

## Files Changed

- Bootstrap/handshake: **ใหม่ `UiBootstrap.html`**, `UiSystem.html`, `index.html`
- Gateway/session/read failure classification: `Code.gs`, `ProductImagesV2.gs`, `login.html`
- Read queue/cache callback/optional dialogs/library loader: `Shared.html`, `Styles.html`
- Products priority/generation guards: `Master_Products.html`
- Deferred toolsและhelperเฉพาะหน้า: `Master_Tax_Invoice.html`, `Purchase_Orders.html`, `Profile.html`, `Manage_Users.html`
- เพิ่ม early bootstrap/ถอน parser dependency: `Master_Brands.html`, `Master_Categories.html`, `Master_Vendors.html`, `Master_Customers.html`, `Master_Zones.html`, `Master_Cars.html`, `Quotation.html`, `StockIssue.html` รวมกับหน้าข้างต้นครบ15routes
- Regression/release: `package.json`, `tests/frame-loading.test.cjs`, **ใหม่ `tests/loading-resilience.test.cjs`**, `tests/browser.cjs`, `tests/browser-backend.cjs`, `tests/release.test.cjs`
- รายงาน/ส่งต่อ: เอกสารนี้และ `docs/CODEX-HANDOFF-BILLS-UX-2026-10-29.md`

ไม่รวม untrackedเดิม `docs/SYSTEM-AUDIT-2026-10-11.md`, credentials/clasp, dependencies, generated test results หรือ review bundles

## Deployment และงานที่ยังต้องพิสูจน์

**Deploy104สำเร็จตามคำสั่ง“deploy เลย”ครั้งถัดมา** แทนVersion103/runtimec3dc752 โดยใช้URL/สิทธิ์เดิม คงข้อห้ามแก้ข้อมูลDBและแยกการอนุมัติเผยแพร่จากwriteUAT/การเปลี่ยนข้อมูลย้อนหลัง

Runtime package รอบใหม่มี **25ไฟล์** เพราะเพิ่ม UiBootstrap ต้องใช้ชุดที่ครบและตรวจ dependency/checksum ไม่ส่งเพียงไฟล์เดียวที่ include bootstrap ขึ้นไปโดยไม่มีไฟล์ใหม่

ยังต้องตรวจ Google wrappers/authenticated menu จริงและวัด cold/warm click-to-usable-data หลังอนุมัติ release/sessionที่พร้อม การผ่าน local mocks หรือหน้าLoginไม่ยืนยันว่าทุกหน้าภายใน10วินาที

Cold search/XLFilterที่คง substring ครบชุดและ cold Dashboard ที่ต้องอ่าน movements ครบช่วงยังมีต้นทุนเดิม ไม่สร้าง durable summaries/index/storage/triggerเพิ่มเติมโดยอาศัยคำสั่งนี้ งานนั้นต้องทบทวน design/cost และขอบเขตข้อมูลแยกก่อน ไม่มีการรับรองว่า patch นี้ระบุสาเหตุเดียวของภาพบนเครื่องผู้ใช้ได้แล้ว

หลักฐาน local: `test-results/loading-fix-unit.log`, `loading-fix-browser-final.log`, `loading-fix-backend-browser.log`, `loading-fix-reads.log` และ review bundle ที่สร้างหลัง commit
