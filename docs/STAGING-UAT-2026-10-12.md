# SYY-Shop — Staging UAT และแผน rollout

สถานะ: **เตรียมในเครื่องแล้ว; ยังไม่ได้ deploy หรือทำ UAT กับบริการจริง**. Source baseline ก่อนงานรอบนี้คือ `a52172a05c1cd641a4879b3688eebb559cf92361`; main ที่ตรวจวันที่ 12 ตุลาคม 2569 ยังเป็น `6210f7418b6e69d21d876a9fd6a68b1d06fcb76b`.

เอกสารนี้ต่อจาก `AUDIT-19-40-2026-10-11.md` และ `INTEGRITY-PERFORMANCE-2026-10-11.md`. การทดสอบจำลองและการเตรียม package ไม่ถือว่า staging/live acceptance ผ่าน.

## 1. ข้อมูลที่ต้องมีเพื่อเริ่ม UAT จริง

- Apps Script ID และ URL ของ **สคริปต์ Staging แยกต่างหาก**; ยืนยันว่าไม่ใช่ Production script/deployment.
- Firestore Project ID ของ Staging, ผู้ deploy และหลักฐานว่าฐานทดสอบ/Drive ใช้ข้อมูลทดสอบตามขอบเขตที่ได้รับอนุมัติ.
- กล่องอีเมลทดสอบที่ควบคุมได้ เพื่อรับอีเมลทั้ง first-admin/create-user/reset/forgot.
- ขนาดข้อมูลจริงเฉพาะจำนวน/bytes, ปริมาณผู้ใช้พร้อมกัน และเกณฑ์ response time ที่ยอมรับได้. ไม่ต้องส่ง passwords, OAuth tokens, reset links, TOTP secrets หรือข้อมูลลูกค้าจริงลงรายงาน/Git.

Workspace ปัจจุบันไม่มี `.clasp.json`, CLI clasp/gcloud หรือ Staging ID. จึงยังยืนยัน IAM/indexes/quotas/การส่งเมล/HtmlService จริงไม่ได้.

## 2. เตรียม package ที่ตรวจย้อนกลับได้

รันคำสั่งใน repository นี้:

```text
npm test
npm run check
npm run test:browser
npm run test:reads
npm run release:prepare
```

คำสั่งสุดท้ายสร้าง **review package** ใน `test-results/releases/review-<sha>-<uuid>/`. เป็น source 24 files พร้อม checksum และ revision; ยังใช้ production Project ID ตาม Source จึงห้ามนำ review package ไปทดสอบการเขียนข้อมูล. ไม่มี `.clasp.json`, credentials, Properties, backups, fixtures หรือเอกสารธุรกิจใน package.

เมื่อได้รับ Staging ID และ mailbox ที่ยืนยันแล้ว ใช้:

```text
node scripts/prepare-release.cjs --staging-project <VERIFIED_STAGING_PROJECT_ID> --staging-mailbox <CONTROLLED_TEST_MAILBOX>
node scripts/prepare-release.cjs --verify <ABSOLUTE_RELEASE_DIRECTORY>
```

Script เตรียมเฉพาะไฟล์ในเครื่อง ไม่ login/push/sync/deploy. ปฏิเสธ project เดียวกับ Source, project/mailbox ไม่ครบหรือไม่ถูกต้อง และไม่เขียนทับ package เดิม. ตรวจ dependencies ของ include/routes, syntax และ manifest. `release.json` ระบุ commit, branch, sourceDirty, hashes ก่อน/หลัง transformation. ต้องสร้าง package ใหม่หลัง commit เพื่อให้ `sourceDirty:false`; hashes เป็นการตรวจการเปลี่ยนไฟล์ ไม่ใช่ลายเซ็นรับรองผู้สร้าง.

Generated Staging `Code.gs` เปลี่ยนเฉพาะ project, ชื่อโฟลเดอร์ Backup/Images, key ของ image folder, first-admin email และ route อีเมลทั้งหมดไป mailbox ทดสอบพร้อม `[STAGING]`. Source ของ Production ใน workspace ไม่ถูกเปลี่ยนค่าเหล่านี้. เหตุผล: เปลี่ยน Firestore ID อย่างเดียวแต่ใช้ Drive owner เดียวกันอาจเลือกโฟลเดอร์ Production เดิมและ retention อาจลบ Backup จริงได้.

นำ **client/backend ทั้งชุด** ไปยังสคริปต์ Staging ที่ตรวจ ID แล้วตามขั้นตอนที่ได้รับอนุมัติ. เก็บ package ต้นฉบับไว้ไม่แก้ไข; ใช้ workspace สำหรับ deployment แยกเมื่อผูก `.clasp.json`. ตรวจ hashes ก่อนผูก target. ไม่สร้าง/แก้ trigger, IAM, indexes หรือ Production deployment โดยอัตโนมัติ.

## 3. แยกข้อมูลและบริการทดสอบ

ใช้บัญชี admin/staff/viewer และข้อมูลธุรกิจที่สร้างเพื่อทดสอบ. ไม่ copy Script Properties, sessions, auth keys, recovery codes, Drive file IDs หรือ backup folder IDs ของ Production ไป Staging. สคริปต์ต้องแยกเพื่อแยก CacheService/Properties/Locks/Triggers. ใช้รูปที่สร้างใน Drive ทดสอบเท่านั้น.

การซ้อม restore ใช้ synthetic backup จาก **source project ทดสอบอีกตัว** และ target ที่ว่าง. Backup มีข้อมูล auth/key material จึงต้องอยู่ใน Drive ส่วนตัวและไม่แนบ Git/PR. การใช้ backup จริงต้องอนุมัติเรื่องข้อมูล/คีย์/Drive แยกก่อน. ห้ามใช้ production snapshot เพียงเพื่อให้ได้ปริมาณข้อมูล.

Generated mail sink พิสูจน์ Mail authorization และการรับจดหมายที่ mailbox ทดสอบ; ไม่พิสูจน์ delivery ไปทุกผู้รับ/domain. อย่าส่งข้อมูลจริงไป mailbox นี้. Deployment settings/OAuth/IAM/สิทธิ์ผู้ใช้ยังต้องตรวจตาม policy เดิม.

## 4. ลำดับตรวจรับและหลักฐาน

บันทึกผลในสำเนาของ `STAGING-RESULTS.template.json`; เก็บ log ที่ลบข้อมูลลับและ screenshots ของข้อมูลทดสอบ. ทุกข้อเริ่มเป็น pending.

| ขั้น | งานตรวจจริง | Acceptance / หลักฐาน |
|---|---|---|
| 1 | Target isolation และ OAuth | Script/project/Drive IDs ถูกต้อง; Mail scope authorize สำเร็จ; request ไป project ทดสอบเท่านั้น |
| 2 | First-admin และ account flows | create failure ไม่คืน success; ไม่มี password/token ใน logs; reset/forced token bound/expired/revoked; เมลเข้ากล่องทดสอบ |
| 3 | Role matrix และ direct RPC | ทุก V1/V2 operation ผ่าน policy เดิม; private helpers เรียกจาก browser ไม่ได้; Viewer ไม่มีสิทธิ์แก้ Master/Stock/Admin |
| 4 | Stock/receipts สอง browser | ตัดใกล้ stock limit พร้อมกัน, lost reply/retry, receipt/cancel race; stock+movement+PO/quote atomic; request เดิมไม่เขียนซ้ำ |
| 5 | Master/document/image version | stale save/delete ถูกปฏิเสธ; unknown fields, stock และ negotiated/historical price คงอยู่; image draft ไม่ลบไฟล์ที่ยังอ้างอิง |
| 6 | Paging/snapshot/indexes | เกิน 1,000 ใบ, วันเดียวกันหลายหน้า, insert/update/delete ระหว่างหน้า; ไม่ซ้ำ/ตกหล่นใน snapshot; expired cursor refresh ได้; actual date/name query ใช้ได้ |
| 7 | Cache/Properties/Locks | สอง sessions เห็น mutation หลัง refresh; failed refresh เก็บ draft; cold/warm/eviction; วัด rate bucket และ reference-lock contention/Properties quota |
| 8 | Nested HtmlService frames | trusted channel/source/origin handshake จริง, active/hidden lifecycle, cross-tab reconciliation และ spoofed message rejection |
| 9 | End-user UI/UX | desktop/mobile 320/390 px, keyboard/modal/select/Swal, scanner, latest-year replies, loading/count/error/retry; draft ไม่หาย |
| 10 | Print/PDF/export | Thai names/long values, zero/fraction price/qty, many lines, page breaks; export แสดง loaded subset ชัดเจนหรือโหลดครบก่อน |
| 11 | Recovery rehearsal | synthetic source → empty target: 17 collections/rows/fields/images/password/TOTP; guarded writes; partial/lost reply หยุดและไม่ overwrite |
| 12 | Read/write/latency measurement | matched dataset/scenarios, cold/warm และ concurrency; document/index-entry costs แยก; p50/p95/RPC/payload/error rate |
| 13 | Trigger rehearsal | ตรวจ legacy/private handlers ใน Staging, backup private/complete และ cleanup retention; ไม่มี unrelated trigger ถูกลบ |

Viewer เดิมมีสิทธิ์บันทึก invoice/quotation และ update quotation status ตาม registry; การทดสอบห้ามตีความว่าต้องลดหรือขยายสิทธิ์นี้. ใช้ `tests/security.test.cjs` เป็น inventory ของ role policy ที่ตรวจในเครื่องแล้ว.

## 5. การวัดประสิทธิภาพและ Firestore

เลือก Product initial/refresh/save, Dashboard initial/delta/year switch, Invoice/Quote initial/page/load-all/save, PO create/status/receive, login/reset และ backup/cleanup. ใช้ dataset/role/index/cache state เดียวกันสำหรับ baseline กับ candidate; ทดสอบอย่างน้อย 30 samples ต่อ latency scenario ที่ทำได้ โดยแยก cold/warm และเก็บขนาด payload ด้วย.

รวม background refresh, authenticated user GET, retry/lookahead, duplicate/reference checks และ Activity Log ลงค่าใช้จ่าย scenario. การนับ REST requests หรือ GAS RPC ไม่ใช่ billed document reads. Query projection ลด bytes; batch commit ลด requests; ทั้งสองไม่ได้ลด writes/reads ต่อ document โดยอัตโนมัติ. วัด index-entry reads ของ date/name cursors ด้วย Query Explain/metrics ตามบริการจริง.

คำนวณ savings ต่อ scenario จาก `(baseline - candidate) / baseline × 100` เมื่อ baseline > 0. ค่า baseline = 0 แสดง N/A. ผลรวมระบบใช้ยอด reads/writes ของช่วง workload ที่เทียบกันได้ ไม่เฉลี่ยเปอร์เซ็นต์ราย scenario. หากไม่มี baseline ที่ปลอดภัยและได้รับอนุมัติ ให้รายงาน candidate metrics และยังไม่สรุป savings จริง.

ติดตาม Properties read/write, UrlFetch, email quotas และ execution runtime ของ deployer. Local VM duration ไม่ใช่ GAS/network p95. แม้ batch restore จำกัด 450 writes และ 8 MiB JSON แล้ว transaction/runtime/index overhead และ document data types ยังต้องตรวจจริง. หาก backup เกิน runtime/snapshot lifetime ต้องออกแบบ recovery workload ใหม่และอนุมัติก่อนใช้กับข้อมูลจริง.

## 6. Recovery failure และการกลับไปใช้ Source ก่อนหน้า

Restore ใช้ create-only preconditions และหยุดทันทีเมื่อ batch ไม่ยืนยัน success. ถ้า response หาย จำนวน `restored` อาจน้อยกว่าที่ commit จริง; ต้องตรวจ target ก่อนทำสิ่งใดต่อ. ห้าม retry ลงฐานที่ไม่ว่างหรือ auto-delete เพื่อเริ่มใหม่. ไฟล์รูปที่สร้างก่อน failure อาจค้าง ต้องตรวจ references และ cleanup เฉพาะ Staging ภายใต้การอนุมัติ. การย้ายข้อมูลครบหลาย batches ไม่ใช่ atomic transaction ทั้งฐาน.

Rollback ต้องเลือก revision ที่รีวิวแล้ว, client/backend ตรงกัน, คงข้อมูลธุรกิจที่ถูกต้อง และตรวจ compatibility ของ fields/caches/session versions. สำหรับงาน recovery รอบนี้ baseline คือ `a52172a...`; ไม่ถือว่า old main ที่มีช่องโหว่ก่อน audit เป็น rollback ที่ผ่าน security review. การ rollback งาน 1–40 ต้องรีวิว baseline เพิ่มเติม.

ระหว่าง rollout/rollback ต้องวางแผน cache v2/v3 และ durable generations พร้อมผู้ดูแล; ห้าม restore snapshot Production หรือ reverse user permissions อัตโนมัติ. ก่อน production rollout ต้องมีผล UAT, release manifest ที่ sourceDirty:false, target/version/rollback revision และการอนุมัติ deployment. Trigger handlers ที่เปลี่ยนชื่อเป็น `_` ต้องติดตั้งด้วย editor entrypoints ที่รีวิวแล้วและตรวจว่าเหลือ schedule เดียว โดยแยกการอนุมัติจาก Source.

## 7. สถานะส่งต่อ

พร้อม: Source fixes 1–40, recovery hardening เพิ่มเติม, local regression, large synthetic rehearsal, review/staging package builder, UAT matrix, measurement และ rollout/rollback procedure.

ค้าง: Staging IDs/mailbox/สิทธิ์เข้าถึงและการอนุมัติ sync/deploy ตาม target, UAT/metrics จริง, OAuth/index/IAM/trigger confirmation, public push ของ branch ปัจจุบัน และ Production rollout. PR #2 เดิมไม่รวม fixes branch นี้. ไม่ถือว่างานเหล่านี้เสร็จจนมีหลักฐานจริง.

อ้างอิง: [Firestore limits](https://firebase.google.com/docs/firestore/quotas), [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas), [clasp](https://developers.google.com/apps-script/guides/clasp), [Firestore pricing](https://firebase.google.com/docs/firestore/pricing), [Query Explain](https://firebase.google.com/docs/firestore/query-explain).
