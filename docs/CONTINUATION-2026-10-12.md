# SYY-Shop — งานค้าง: Recovery และความพร้อมสำหรับ Staging

## 1. ขอบเขตและ Source ล่าสุด

ดำเนินการตามคำสั่ง “ดำเนินงานค้างต่อเลย” ต่อจาก audit 1–40. ตรวจ master instructions, Source, reports, tests และสถานะ Git ก่อนแก้ไข. Branch `codex/integrity-security-20261011`, baseline `a52172a05c1cd641a4879b3688eebb559cf92361`. ตรวจ remote main แบบอ่านอย่างเดียวด้วย `git ls-remote` วันที่ 12 ตุลาคม 2569: `6210f7418b6e69d21d876a9fd6a68b1d06fcb76b` ตรงกับฐานเดิม.

งาน source 1–40 ทำไว้แล้ว; งานค้างหลักต้องใช้ Staging/บริการจริง. รอบนี้เพิ่ม large recovery rehearsal, แก้บั๊กที่พิสูจน์ได้ใน recovery path และเตรียม release/UAT/measurement/rollback ที่ตรวจรับได้. ไม่มี Staging ID หรือ `.clasp.json` ใน workspace จึงไม่ได้ sync/deploy หรืออ้างว่า live UAT ผ่าน. มีคำถามขอข้อมูล Staging ส่งไว้แล้ว.

## 2. Root Cause และการแก้ไข

| ปัญหาที่จำลองได้ | Root cause | ผลหลังแก้ |
|---|---|---|
| Recovery รูปสูญเสีย metadata เพิ่มเติม | Restore สร้าง `fields` ใหม่ทั้งหมดจาก gallery fields | Merge เฉพาะ URL/Drive ID/gallery/primary fields ที่ต้อง remap โดยคง unknown fields จาก backup |
| Backup ปฏิเสธ ID `constructor`, `toString`, `hasOwnProperty` | Duplicate tracker เป็น `{}` และอ่าน inherited properties เป็น record ซ้ำ | ใช้ dictionary `Object.create(null)`; IDs ที่ถูกต้องไม่ชน prototype; duplicate guard ยังทำงาน |
| Restore เอกสารภาษาไทยขนาดใหญ่ถูกปฏิเสธ | จำกัด 450 writes แต่ไม่จำกัด payload bytes | แบ่ง commit ทั้งจำนวน ≤450 และ JSON UTF-8 ≤8 MiB; หยุดเมื่อ error เหมือนเดิมและไม่ overwrite |
| ขนาด Backup ที่แจ้งคลาดเคลื่อนเมื่อมีภาษาไทย | ใช้ `text.length` ซึ่งเป็นจำนวน UTF-16 units | ใช้ขนาดไฟล์จริงจาก Drive manifest เป็น KB |

นอกจากนี้ README เดิมอธิบาย Source ก่อน audit และชวนวางทับ/deploy โดยไม่มี rollout context; ปรับเป็นภาพรวมปัจจุบันและเชื่อม runbook/ผลตรวจจริง.

## 3. Module Impact และ Data Integrity

Production source เปลี่ยนเฉพาะ backup validation/size reporting และ staging restore worker. ไม่เปลี่ยน architecture, collections, business stock/document schemas, APIs, role policy, auth/session behavior หรือ default Project ID.

Restore ยังใช้ private editor worker, dry-run default, complete v2 checksum validation, explicit source/target, staging-script confirmation, empty selected collections และ `currentDocument.exists:false`. Account session versions ถูก rotate และ image IDs ถูก remap ตามเดิม. Multi-batch restore ไม่ atomic ทั้งฐาน; เมื่อ response หาย count ที่ยืนยันอาจต่ำกว่า writes ที่เกิดจริง. Target ต้องตรวจด้วยผู้ดูแลก่อน retry; ห้ามลบ/reset target อัตโนมัติ. ไฟล์รูปที่สร้างก่อน failure อาจค้างตามข้อจำกัดเดิม.

Staging package generator แยก Firestore target, Drive folder names/property และอีเมลใน **สำเนาที่สร้าง** เพื่อป้องกันการใช้ shared owner แล้วชน Production resources. ไม่เปลี่ยนค่าของ Source หลัก. ต้องยืนยัน Apps Script ID และใช้ synthetic users/images/Properties; package ไม่สามารถรับรอง target IAM หรือข้อมูลจริงแทนผู้ดูแลได้.

## 4. Files Changed

9 files ที่ตั้งใจเปลี่ยนในรอบนี้:

- `Code.gs`: fixes recovery 4 จุด
- `README.md`: current project/test/deployment status
- `package.json`: รวม recovery/release tests และเพิ่ม `release:prepare`
- `scripts/prepare-release.cjs`: local release generator/verifier, checksums, dependency/syntax validation, isolated staging overrides; ไม่มี push/sync/deploy
- `tests/recovery.test.cjs`: 8 recovery/paging/failure/large-payload tests
- `tests/release.test.cjs`: 5 release completeness/isolation/tamper/invalid-target/output tests
- `docs/STAGING-UAT-2026-10-12.md`: target isolation, UAT matrix, measurement, rollout/rollback procedure
- `docs/STAGING-RESULTS.template.json`: pending live results/evidence template
- `docs/CONTINUATION-2026-10-12.md`: รายงานนี้

`docs/SYSTEM-AUDIT-2026-10-11.md` เป็น untracked report ที่มีมาก่อนและไม่ได้แก้ไข/stage. `test-results/` เป็น ignored fixture/artifact output; ไม่แนบ credentials หรือ backups จริง.

## 5. Security และ UX

Public RPC/role inventory ยังคงเดิมและ regression ผ่าน. Package แยกเฉพาะ source whitelist 24 files ไม่รวม credentials, local `.clasp.json`, tests, Properties, backup data หรือ reports. Staging build ต้องมี project ID แยกและ controlled mailbox; malformed/injected/partial options ถูกปฏิเสธ. Outbound mail 4 paths ถูก redirect ไปกล่องทดสอบใน generated source และ private helper ไม่เปิด browser RPC ใหม่.

Package ตรวจ source hash, includes/routes/manifest/syntax และ unexpected files; ไม่เขียนทับ package เดิมหรือ write output นอก test-results/releases. Hashes ไม่ใช่ signature และยังต้องตรวจ target/version ก่อน deploy. UI business pages ไม่เปลี่ยน; รายงานขนาด Backup ถูกต้องขึ้น. Browser regression เดิมยังผ่าน.

## 6. ผลการทดสอบ

| Verification | ผลล่าสุด |
|---|---|
| `npm test` | **102/102**: Backend25, Security16, Integrity26, Audit22, Recovery8, Release5 |
| `npm run test:browser` | **39/39 กลุ่ม**; 15 routed pages smoke, local Chrome/RPC fixtures, external HTTPS blocked |
| `npm run check` | **56 scripts + Apps Script manifest** parse ผ่าน |
| `npm run test:reads` | synthetic read model assertions ผ่าน |
| Node syntax / UAT JSON | release script และ results template parse ผ่าน |
| `git diff --check` | ผ่าน |

Recovery tests พิสูจน์ common transaction snapshot เมื่อข้อมูลเปลี่ยนหลังเริ่ม backup, pagination เกิน guard เก่า 50 หน้า, checksum/private assets, unknown metadata, valid prototype-name IDs, UTF-8 sizing, secret changes เทียบ transient property changes, late page failure/repeated tokens, expired/wrong-project cursor, non-empty staging refusal และ stop-after-partial/lost second commit.

Release tests ตรวจครบ client/backend/dependencies/hash, input rejection, generated Drive isolation แม้มี Production folder/property อยู่ใน fixture, mail sink, tampering/extra files และ bounded output/no overwrite. ทุกบริการเป็น mock; ไม่มี network Firestore/Drive/Mail จริง.

## 7. Large Rehearsal Evidence

ผล fixture ล่าสุดใน `test-results/recovery-result.json`:

| รายการ | ผล |
|---|---|
| Collections | 17 |
| Products | 15,307 |
| Documents ทั้งหมด | 15,323 |
| Backup list-page requests | 68 (Products52) |
| Manifest bytes | 3,818,415 |
| Restore commit requests | 35 |
| จำนวน writes มากสุดต่อ commit | 450 |
| Source documents ถูก restore เปลี่ยนหรือไม่ | ไม่เปลี่ยน |

Separate large UTF-8 fixture 72 documents มี JSON รวมเกิน 10 MiB; old count-only restore ถูกจำลองปฏิเสธ. หลังแก้ทุก request ≤8 MiB และคืนเนื้อหาภาษาไทยครบ. Local duration/bytes/requests ไม่เท่ากับ GAS execution time, network latency, index overhead หรือ Production workload size.

## 8. Firestore Read/Write Impact

รอบนี้ **ไม่มีการอ่าน/เขียน/ลบ Firestore จริง**. สำหรับ backup/read validation จำนวนเอกสารไม่เปลี่ยน. Restore successful path เขียน document แต่ละรายการครั้งเดียวเหมือนเดิม; จำนวน HTTP commits อาจเพิ่มเมื่อ fields ใหญ่ เพื่อไม่ส่ง oversized request. ไม่เพิ่ม business writes ใน source paths อื่นและไม่เปลี่ยน indexes/rules.

ตัวเลข synthetic read model ของรอบก่อนยังผ่าน: Dashboard 60%, Invoice initial94.9%, Cleanup97% ของเอกสารใน fixture และ Product bootstrap ลด GAS RPC50%. ไม่ใช่เปอร์เซ็นต์รวมระบบหรือ savings ที่วัดจาก billing จริง. แผน UAT แยก document reads/index-entry reads/writes/deletes/RPC/bytes/p50/p95 พร้อม baseline ที่จับคู่ workload. หากไม่มี baseline ที่ยืนยันได้ จะไม่คำนวณ savings จริง.

## 9. Commit / Deployment Status

Implementation SHA คือ commit ที่เพิ่มรายงานนี้: ตรวจด้วย `git log -1 --format=%H -- docs/CONTINUATION-2026-10-12.md` และ SHA ในข้อความส่งมอบ. Baseline `a52172a05c1cd641a4879b3688eebb559cf92361`.

**Local commit only** บน `codex/integrity-security-20261011`. ไม่มี public push/PR ใหม่/merge, Apps Script sync/deployment, OAuth authorization, trigger/index/IAM changes หรือ Production data/permissions mutation. Public Draft PR #2 เดิมยังไม่รวม branch นี้. จะสร้าง review package จาก committed revision ที่ `sourceDirty:false`; เป็น artifact เตรียม review ไม่ใช่ deployment.

## 10. งานค้างที่ต้องดำเนินกับบริการจริง

ยังค้าง Staging ID/URL/Firestore project/mailbox และ target authorization, staged deploy+OAuth, multi-session UAT, actual index/IAM/quota/mail/frame/PDF/export checks, production-sized rehearsal ตามขนาดที่ยืนยัน, billed read/write/index-entry และ latency measurements, trigger rollout, review/public delivery/Production deployment ตามการอนุมัติ.

Runbook และผล template พร้อมใช้แล้ว. Pending checks ต้องมีหลักฐานจริงก่อนเปลี่ยน status เป็น passed; ไม่ถือว่าการเพิ่ม test/doc ปิด live backlog. Source client/backend ต้อง rollout พร้อมกัน และ rollback/cache/session compatibility ต้องรีวิวโดยคงข้อมูลธุรกิจเดิม.

หลักฐานทางการ: [Firestore document IDs / API limits](https://firebase.google.com/docs/firestore/quotas), [Apps Script runtime / Properties quotas](https://developers.google.com/apps-script/guides/services/quotas), [clasp](https://developers.google.com/apps-script/guides/clasp), [Firestore Query Explain](https://firebase.google.com/docs/firestore/query-explain). Limits ยืนยันการใช้ byte bound และข้อจำกัดของ local rehearsal; ไม่ใช่หลักฐานว่า Production เคยชน quota.
