# SYY-Shop — งานลำดับ 3–18: Data Integrity, Security และ Performance

วันที่ 11 ตุลาคม 2569 · Branch `codex/integrity-security-20261011`

## 1. สรุปผลการตรวจสอบ

ดำเนินการตามคำสั่ง “ทำ 3–18 ต่อเลย” ต่อจากข้อ 1–2 ใน commit `80cfbaefbcb2680d044e50925cb197cc3388a0cc` ตรวจ Source และ fetch remote ก่อนเริ่มงาน; `origin/main` ที่ตรวจเป็น `6210f7418b6e69d21d876a9fd6a68b1d06fcb76b` รายงานนี้แยกผลตรวจ Source/การทดสอบจำลองออกจากงาน rollout จริงอย่างชัดเจน

แก้ครบ 16 รายการใน Source และทดสอบในเครื่อง ไม่มีการเรียก Firestore, Drive, Mail หรือ Apps Script Production เพื่อทดสอบ ไม่มีการ push branch นี้, merge, sync, deploy, เปลี่ยน trigger, backfill หรือกู้คืนข้อมูลจริง

## 2. Root Cause และสิ่งที่แก้ไข

| ลำดับ / Finding | สาเหตุ | พฤติกรรมหลังแก้ไข |
|---|---|---|
| 3 / D01 | Stock Issue สร้างรหัสใหม่ทุก RPC; F4/confirmation เปิดซ้ำได้; quote marker เขียนแยกจากสต๊อก | Client ล็อกทั้งช่วง confirmation และ request, ส่ง `requestId` เดิมเมื่อ retry; movement IDs อ้างอิง request และใช้ `exists:false` ใน atomic commit; เก็บ fingerprint/result บน movement แรก; stock + movements + quote marker commit ร่วมกัน |
| 4 / D02 | เปลี่ยน delivery note เป็นค่าว่างเมื่อ receipt กลายเป็น final ทำให้ replay หลุดการตรวจซ้ำ | เก็บ/check delivery note ต้นฉบับตลอด; มี request replay และ PO/version guards; ไม่รับจำนวนเกินคงค้างหรือสินค้าอื่น |
| 5 / D03 | PO Status รับ arbitrary string และ PATCH ไม่ผูกเวอร์ชัน | Allowlist Pending/Ordered/Cancelled; ไม่เปลี่ยน Received/PartiallyReceived/Cancelled กลับ; PATCH ใช้ `currentDocument.updateTime` กัน receive/cancel แข่งกัน |
| 6 / S03 | Gateway append username ต่อท้าย args ทำให้ extra positional args ชนะค่าจาก session | ระบุตำแหน่ง identity แน่นอนและ reject extra identity args; account APIs bind token ให้เป็น gateway token |
| 7 / S04 | Revocation อยู่ใน CacheService ซึ่งถูก evict ได้ และ session ถือ role เก่า | Optional `Master_Users.Session_Version`; หมุน version ใน write เดียวกับ password/role/status; session ตรวจ user document สด, Active, role และ version; forced-password token ผูก credential/version ก่อนเปลี่ยนและก่อนออก session |
| 8 / S05 | Recovery code ใช้ cached list และไม่ตรวจผล write | อ่าน user สด; consume ด้วย version precondition; สำเร็จเฉพาะ write สำเร็จ; concurrent consume สำเร็จได้ครั้งเดียว |
| 9 / S06 | Product names ต่อเข้า Swal HTML โดยตรง | Escape confirmation, stock warnings และ summary strings |
| 10 / S07 | postMessage รับทุก source/origin/schema | ช่องทางสุ่มแยกต่อ iframe, ตรวจ source กับ frame/ancestor ที่ลงทะเบียน, origin ที่อนุญาต, action ตามหน้า และรูปแบบ payload; ส่งไปยัง origin ที่อนุญาต; รองรับ descendant frame handshake |
| 11 / D04 | Product/PO coercion รับชื่อว่าง, NaN/ราคาลบ, status หรือ refs ไม่ถูกต้อง | ตรวจชนิด/ช่วงตัวเลข, ชื่อ, วันที่จริง, document ID, refs, PO items/status/totals; ใช้ชื่อสินค้าจาก Master ใน PO; คงต้นทุน PO ที่เลือกไว้ รวมต้นทุน 0 ที่ถูกต้อง |
| 12 / P02 | Read errors กลายเป็น []/0 และถูกตีความว่า refresh สำเร็จ | Fail closed เมื่ออ่านไม่สำเร็จ/ไม่ครบ; ไม่ cache empty ที่เกิดจาก error; read RPC failure ไป failure callback; Dashboard/เอกสารเก็บข้อมูลสำเร็จเดิมไว้; successful mutation ที่ readback/metadata ล้มเหลวมี warning แทนการสั่ง write ใหม่ |
| 13 / P01 | Delta ใช้ business Timestamp/เวลาจาก Apps Script จึงพลาด delayed commit | Movement ใหม่มี server `Committed_At`; delta query ฟิลด์นี้โดยใช้ Firestore `readTime`, overlap 60 วินาทีและ dedupe ID; full reconciliation ทุกประมาณ 5 นาทีเมื่อเปิด Dashboard; failure ไม่เลื่อน cursor; automatic full-read failures มี cooldown |
| 14 / D06 | Image read errors กลายเป็น empty gallery; delete ไม่ตรวจ HTTP; stale drafts ไม่มี version guard | 404 เท่านั้นเป็น empty; shared script lock + metadata version/existence precondition; stale draft ถูก reject; metadata สำเร็จก่อน trash; response ไม่แน่นอนเก็บไฟล์ไว้จนอ่านยืนยันว่าไม่ถูกอ้างอิง; legacy/V2 gallery อ่านเขียนร่วมกันได้ |
| 15 / D07 | ปีเอกสารอ่าน-แก้-เขียนทั้ง array; read failure เสี่ยงทับปีเก่า | `appendMissingElements` แบบ atomic, guarded creation เมื่อ 404, ไม่ write เมื่ออ่านผิดพลาด; skip ปีที่มีแล้ว; seeding ต้องอ่านครบและ append แบบเดียวกัน |
| 16 / D09 | Backup มีเพียง 9 collections, ไม่มี common snapshot/images/properties/auth material | Backup v2 ครบ 17 collections ใน read-only transaction เดียว, สำเนารูปจริง, Script Properties และ checksum; ตรวจ folder/file เป็น owner-only และ abort partial backup; มี dry-run validation และ restore rehearsal เฉพาะฐานข้อมูล staging ที่ว่าง |
| 17 / D11 | KPI ไม่รวม `ขาย Online`; IN value ใช้ราคาทุน Master ปัจจุบัน | รวมหน้าร้าน/Online ใน sales, last-sale และ drilldown; movement IN ใหม่เก็บ cost จาก PO line; historical IN ใช้ cost snapshot หรือ PO snapshot เดิม; ไม่มีหลักฐานต้นทุนแสดงว่าไม่ครบ |
| 18 / S11 | ใช้ MailApp แต่ manifest ขอ gmail.send | เปลี่ยนเป็น `https://www.googleapis.com/auth/script.send_mail`; ต้อง authorize scope ใน staging ก่อน rollout |

## 3. ผลกระทบต่อ Module และ UX

Role policy, public RPC surface 8 endpoints, V1 operation names 62 รายการ และ V2 image operations 5 รายการคงเดิม ไม่มีการเพิ่ม collection หรือขยายสิทธิ์บัญชีในแอป

Stock Issue ใช้รหัส SI ที่ผูกกับ request; receipt movement ใช้ SR ที่ผูกกับ request รูปแบบเลขรายการจึงเปลี่ยนจาก timestamp/random suffix เดิม การกดเพื่อทำธุรกรรมใหม่หลังรายการก่อนหน้าสำเร็จได้ request ใหม่; retry ของรายการเดิมคืนผลเดิมแทนตัด/รับซ้ำ การตัดเพิ่มเติมจาก quote เดิมยังเป็นธุรกรรมใหม่ที่ผู้ใช้ตั้งใจทำได้

รายการ Stock Issue ที่ยังไม่ทราบผลเก็บ request/basket ใน `sessionStorage` ของแท็บ แยกตาม username เพื่อกลับมาตรวจรายการเดิมหลัง reload โดยไม่เก็บ session token เพิ่ม ล็อกการแก้ตะกร้า/ข้อมูลอ้างอิงระหว่างตรวจผล; ล้าง pending เมื่อสำเร็จหรือ server ยืนยัน failure ที่ไม่คลุมเครือ การเปิดแท็บใหม่เป็น workflow ใหม่ ไม่ได้ dedupe ข้ามแท็บด้วยข้อมูลตะกร้าที่บังเอิญเหมือนกัน

เปลี่ยนรหัสผ่านสำเร็จแล้ว Profile นำกลับ Login เพราะ session เดิมถูกเพิกถอน Role/status/password writes ที่ล้มเหลวไม่หมุน version การขัดข้องของ user document ทำให้ authentication fail closed จึงอาจใช้งานชั่วคราวไม่ได้แม้มี cached session ซึ่งเป็น tradeoff ที่ตั้งใจเพื่อปิด stale permissions

Draft รูปที่ค้างก่อนอัปเดต Source/metadata จะต้องเปิดฟอร์มจากข้อมูลใหม่ เมื่อเกิด conflict draft ไม่ทับ gallery ของอีกคน และ successful product write ไม่ถูกตีความว่าล้มเหลวเพียงเพราะรูป/refresh ไม่สำเร็จ Cache namespace เป็น `docs_v2_` เพื่อไม่ใช้ cached image metadata รุ่นเดิมที่ไม่มี version; หลัง rollout จะมี cold reads ช่วงแรก

## 4. แนวทาง Data Integrity และ Backup

Optional fields เพิ่มบนเอกสารเดิมเท่านั้น:

- Master_Users: `Session_Version`
- Stock_Movements: `Committed_At`, `Request_Fingerprint`, `Request_Result_JSON`, `Quote_Id`; IN ใหม่เก็บ `Cost_Price` ที่มีอยู่ใน OUT แล้ว
- Receipt JSON: request ID และ delivery note ต้นฉบับ
- Gallery: legacy arrays และ Images_JSON ถูก sync ให้ตรงกัน; ใช้ updateTime ของ Firestore เป็น concurrency guard

ไม่แก้ records ย้อนหลัง ไม่เดาต้นทุนเก่าจาก Master ปัจจุบัน ไม่ปรับราคาสินค้าเมื่อออก quote/รับของ ต้นทุน 0 เป็นข้อมูลจริง ส่วนต้นทุนที่ขาดเป็น unknown และรวมมูลค่าเฉพาะส่วนที่พิสูจน์ได้

Backup ครอบคลุม Master_Brands, Master_Categories, Master_Vendors, Master_Customers, Master_Zones, Master_Cars, Master_Products, Master_Tax_Invoice, Purchase_Orders, Quotations, Stock_Movements, Product_Images, Master_Users, Doc_Running_Numbers, Doc_No_Reservations, Meta_Counters และ Activity_Log

Backup เก็บ hashed passwords, encrypted TOTP secrets และ AUTH_MASTER_KEY/Script Properties เพื่อกู้คืน authentication ได้ใน Drive ส่วนตัวของเจ้าของสคริปต์เท่านั้น ไม่เปลี่ยน permissions ของ backup folder เดิม: หากแชร์อยู่จะปฏิเสธงานแทน ไม่คืนข้อมูลลับผ่าน RPC และไม่ใส่ข้อมูลจริงใน tests/reports/repository ไฟล์นี้ไม่ใช่ portable passphrase-encrypted export; ความลับอาศัย owner-only Drive ACL และการเข้ารหัสของ Drive จึงห้ามแชร์หรือย้าย bundle ไปพื้นที่สาธารณะ

Firestore collections มี common transaction snapshot; Drive เป็นอีกบริการและไม่มี atomic snapshot ร่วมกับ Firestore จึงใช้ file IDs ที่ snapshot อ้างอิง, ตรวจ lastUpdated/checksum ตอนคัดลอก และ abort เมื่อไฟล์หาย/เปลี่ยนระหว่างคัดลอก Script Properties ต้องคงเดิมระหว่างงาน หากไม่ครบจะไม่มี completed manifest ขนาดข้อมูลมากหรือ execution/transaction timeout อาจทำให้ backup ไม่สำเร็จ; ไม่ลด coverage เพื่อรายงาน success

Retention คง 8 completed manifests และเก็บกวาด associated asset folders โดยตรวจ parent/name ของ backup ที่ตรงกัน ไม่แตะ image folders ที่ใช้งานจริง Weekly schedule เดิมมี nominal RPO สูงสุดประมาณ 7 วันเมื่อทุก run สำเร็จ; run ล้มเหลวทำให้ RPO ยาวกว่านั้น ต้องติดตาม execution จริงหลัง rollout

`restoreFromBackup_()` เป็น editor-only helper ค่าเริ่มต้น dry-run ไม่มี writes ต้องเป็น v2 ที่ครบและ checksum ตรงจึงผ่าน Legacy v1 backup ไม่ถูกอ้างว่ากู้คืนครบได้ Real restore helper ป้องกันการเขียนกลับ source/Production และ require target ตรงกับ PROJECT_ID ของสคริปต์ staging, sourceProjectId แยกต่างหาก และ target ว่างทั้งหมด จะสร้าง image copies/remap IDs และหมุน session versions ไม่ใช้ image folder ของ source การกู้คืนหลาย batch ไม่ atomic ทั้งฐานข้อมูล; failure หยุดและรายงาน partial staging state ต้องจัดการ staging ที่ค้างก่อน retry

## 5. ความเสี่ยงและแผน Rollout / Rollback

ยังไม่มีการ rollout จริง ก่อนนำไปใช้งานต้องทดสอบบน staging ที่แยกจาก Production:

1. Sync backend + templates + Shared + manifest เป็นชุดเดียวกัน และ authorize MailApp scope ใหม่
2. ทดสอบ HtmlService จริงทั้งตรงและ nested iframe, trusted handoff ทุก workflow, Login/OTP/Reset/forced change และ logout เมื่อ role/status/password เปลี่ยน
3. ทดสอบ Firestore REST preconditions, IN/OUT atomic/replay, PO cancellation race, รูปและ Drive ACL ตามบัญชีเจ้าของจริง ตรวจ single-field index ของ Committed_At (ไม่ได้แก้ indexes/rules ในงานนี้)
4. ตรวจ backup folder เป็น owner-only ก่อนรันงานใหม่ ทดสอบ common transaction, Drive copies และ staging recovery กับขนาดข้อมูลที่เป็นตัวแทนของร้าน รวม OTP และ counters
5. ใช้ clone staging script ที่ตั้ง PROJECT_ID เป็นโปรเจกต์ staging ว่าง แล้วเรียก restore พร้อม `sourceProjectId:'syy-shop'`, targetProjectId ที่ตรง staging, confirmRestore/restoreProperties/confirmStagingScript เป็น true หลังผ่าน dry-run ห้ามใช้ Production เป็นที่ซ้อม
6. คงแผนย้าย legacy trigger handlers จากงานข้อ 1–2; ยังไม่ได้เปลี่ยน triggers จริง และตรวจ scope/schedule/เจ้าของใน staging
7. เมื่อได้รับอนุมัติ rollout จึงอัปเดต Web App version และตรวจ live UAT/metrics ไม่มีงาน backfill หรือ repair Production แฝงในขั้นตอนนี้

Rollback ต้องคืน Source/templates/manifest เป็นชุดตรงกัน Optional fields ที่เขียนจากเวอร์ชันใหม่ไม่ต้องลบทิ้ง แต่ rollback code เก่าจะไม่บังคับ durable session version/stock request replay จึงมี security และ duplicate-write risks การคืน Source อย่างเดียวไม่ย้อนธุรกรรมสต๊อกที่สำเร็จแล้ว ต้องประเมินและอนุมัติแผนก่อน rollback จริง

## 6. Files Changed

Backend: Code.gs, ProductImagesV2.gs, appsscript.json

UI: index.html, Shared.html, StockIssue.html, Purchase_Orders.html, Master_Products.html, Profile.html, Master_Tax_Invoice.html, Quotation.html; template channel metadata ใน Manage_Users.html, Master_Brands.html, Master_Categories.html, Master_Cars.html, Master_Customers.html, Master_Vendors.html และ Master_Zones.html

Tests/config/report: tests/backend.test.cjs, tests/security.test.cjs, tests/integrity.test.cjs, tests/browser.cjs, package.json และรายงานนี้ รวม 24 files ไม่รวม SYSTEM-AUDIT-2026-10-11.md ที่เป็น untracked report อยู่ก่อนเริ่มงานและไม่ได้ stage

## 7. ผลการทดสอบ

| Check | ผล |
|---|---|
| npm test | 67/67: backend 25 + security 16 + integrity 26 |
| npm run check | 43 browser scripts + Apps Script manifest parse ผ่าน |
| npm run test:browser | 25/25 browser regression groups ผ่าน; รวม 15-page smoke และ existing desktop/mobile cases |
| git diff --check | ผ่าน |

Integrity tests ใช้ in-memory Firestore ที่ตรวจ preconditions/atomic commits, cache, Drive, properties และ Mail จำลอง มี lost-response, simultaneous duplicate, stock contention, receive/cancel interleaving, failed/concurrent recovery consume, stale image versions, uncertain image writes, HTTP failures และ metadata concurrency

ทดสอบ backup dry-run และ real helper path บน **mock staging**: checksums, 17 collections, image ID remapping, empty-target/no-overwrite guards, rotated sessions, password Login และ TOTP key/OTP หลัง restore ไม่มีการกู้คืนฐานข้อมูลหรือ Drive จริง

Browser tests ตรวจ F4/double confirmation, request persistence ข้าม reload, escaped product names, receipt retries, failed refresh cache/cursor preservation, Online/history KPI และ source/origin/channel/schema guards มี positive handoff ระหว่าง local iframes จริง ผลนี้ยังไม่ใช่ HtmlService-origin/Drive/OAuth/live Firestore UAT

## 8. Firestore Read/Write Impact

ไม่มีผลลด read/write รวมเป็นเปอร์เซ็นต์ที่วัดจาก Production ในงานนี้ รายการ 3–18 เน้นปิดความเสียหายและ correctness; บางจุดเพิ่ม reads ที่จำเป็น:

| Operation | ผลจาก Source |
|---|---|
| Authenticated gateway/doGet | targeted user GET หนึ่งครั้งต่อ validation เพื่อ durable revocation; auth workers บางตัวอ่าน user เพิ่มเพื่อ credential precondition; worker getSession ซ้ำภายใน V1 gateway reuse validation เดิม |
| Stock Issue ปกติ K codes | ตรวจ replay 1 GET เพิ่ม; business writes คง 2K; ถ้ามี quote เพิ่ม marker write ใน commit เดียว ซึ่งแทน RPC/marker write แยกเดิม |
| Receipt ปกติ K codes | ตรวจ replay 1 GET เพิ่ม; business writes คง 2K+1; request/cost/commit-time fields อยู่ใน writes เดิม |
| Replay ที่ยืนยันแล้ว | ไม่มี stock/movement/PO/quote business writes ซ้ำ; อ่าน result และ current stock/PO สำหรับ UI; Activity Log ของ gateway ยังทำตาม policy เดิม |
| User password/role/status | Session version รวมใน account write เดิม; admin reset-link revocation มี masked account write ที่จำเป็นและใช้ target read เดิม |
| Recovery code | targeted fresh read + write เดิมที่มี version guard; failure ไม่ถูกนับเป็น success |
| Year metadata | 1 GET; ไม่มี write เมื่อมีปีแล้ว; missing year ใช้ 1 atomic transform (creation conflict อาจ retry); ไม่เขียนทั้ง array ทับของคนอื่น |
| Images | version reads/cleanup-confirmation เพิ่มตาม mutation; old/new files ถูก trash เฉพาะเมื่อพิสูจน์ว่าไม่ถูกอ้างอิง; cache ช่วยการอ่านหน้าจอเหมือนเดิม |
| Dashboard | deltas อ่าน commit-time overlap 60 วินาที; full bounded reconciliation เพิ่มทุกประมาณ 5 นาทีที่หน้า Dashboard เปิดอยู่; cold reads/legacy cost PO lookups อาจเพิ่มเพื่อความถูกต้อง |
| Backup | อ่านครบทั้ง 17 collections ทุก document ใน snapshot ไม่มี Firestore document writes; empty-collection/request billing ต้องวัดตาม Firestore จริง |

REST request count ใน mock ไม่ใช่ invoice/metrics จาก Firestore การลด duplicate business writes ที่พิสูจน์ได้ไม่ใช่การลด writes ทั้งระบบ 100% ต้องเก็บ baseline หลัง staging/rollout ก่อนสรุปเปอร์เซ็นต์จริง

## 9. Commit / Deployment Status

Implementation commit: commit ที่เพิ่มรายงานนี้ (ดู `git log -1` ของไฟล์ หรือ Commit SHA ในข้อความส่งมอบ)

Branch: `codex/integrity-security-20261011` · Local commit only · ไม่มี push/PR ใหม่/merge/sync/deployment · Production data, rules, indexes, existing user permissions และ triggers ไม่ถูกเปลี่ยนใน session นี้

Draft PR #2 ของ daily backlog เป็นงานก่อนหน้านี้และยังไม่ได้อัปเดตด้วย branch นี้

## 10. งานค้างและหลักฐานอ้างอิง

ค้าง staging/live UAT, OAuth reauthorization, trigger rollout, production-sized backup/restore rehearsal และการวัด Firestore metrics ต้องได้รับอนุมัติก่อนกระทบบริการจริง งาน audit นอกลำดับ 3–18 ยังคงเป็น backlog และไม่ได้ถูกรวมเข้ามาโดยปริยาย

Primary references ที่ตรวจเพื่อใช้ REST/Drive/Mail API:

- [Firestore listDocuments consistency selector](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/list)
- [Firestore read-only beginTransaction](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/beginTransaction)
- [Firestore Write/preconditions/updateTransforms](https://firebase.google.com/docs/firestore/reference/rest/v1/Write)
- [MailApp authorization](https://developers.google.com/apps-script/reference/mail/mail-app)
- [Drive Folder sharing access/editors/viewers](https://developers.google.com/apps-script/reference/drive/folder)
