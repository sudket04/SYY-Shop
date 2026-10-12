# SYY-Shop

ระบบบริหารร้านอะไหล่บน Google Apps Script V8, HTML/CSS/JavaScript และ Cloud Firestore REST API รองรับ Dashboard, Master Data, สินค้า/รูป/บาร์โค้ด, ตัดสต๊อก, PO/รับสินค้า, ใบเสนอราคา, ใบกำกับภาษี และบัญชีผู้ใช้

Source ผ่านการแก้ audit 1–40 และทดสอบในเครื่องแล้ว **ยังไม่ได้ deploy changes ชุดนี้ไป Production**. ผล local/mock ไม่ยืนยัน OAuth, Mail, IAM/indexes, billing, nested HtmlService หรือข้อมูลจริง ต้องผ่าน [Staging UAT](docs/STAGING-UAT-2026-10-12.md) และอนุมัติ target/rollout ก่อน

## โครงสร้าง

- `Code.gs`: routing, authenticated API gateway, Firestore, stock/documents, accounts, backup/restore และ maintenance workers
- `ProductImagesV2.gs`: gallery และ image gateway
- HTML 21 files: routed pages, shared styles/helpers, filters และ address data
- `appsscript.json`: manifest, Asia/Bangkok, V8 และ OAuth scopes
- `tests/`: local regression fixtures; ไม่มี Production credentials
- `scripts/prepare-release.cjs`: เตรียม/ตรวจ review หรือ staging package ในเครื่อง; ไม่ push/sync/deploy
- `docs/`: audit, ผลทดสอบ, ข้อจำกัดและขั้นตอนตรวจรับ

Apps Script ใช้ชื่อ HTML ตาม basename เช่น `Master_Products` และ `Shared`; source ใช้ `include_()` และ private workers ที่ลงท้าย `_`. Browser เรียก business operations ผ่าน `apiGateway`/`apiGatewayV2` ซึ่งตรวจ session/role. Maintenance entrypoints ใช้จาก editor ตาม scope ที่ได้รับอนุมัติ

## ทดสอบและเตรียมส่งต่อ

ต้องมี Node.js และ Playwright/Chrome สำหรับ browser tests (dependency ระบุใน package.json)

```text
npm test
npm run check
npm run test:browser
npm run test:reads
npm run release:prepare
```

Browser tests ใช้ HTTP server, RPC fixtures และ block external HTTPS. Read model เป็น synthetic scenario ไม่ใช่ billed reads หรือ latency ของระบบจริง

`release:prepare` สร้าง package ของ source 24 files พร้อม SHA-256/commit ใน ignored `test-results/releases/`. ค่าเริ่มต้นเป็น review package ที่ยังมี Source Project ID; ห้ามใช้ทดลอง write กับ Production. สำหรับ Staging ใช้ project แยกและกล่องอีเมลทดสอบตาม runbook ซึ่งแยก Drive folder/property และ redirect อีเมลใน generated source เท่านั้น

ก่อนใช้งานจริงต้องยืนยัน script/project/Drive IDs, deployment identity และ OAuth (`script.send_mail` สำหรับ MailApp), ทดสอบหลาย sessions/roles และ deploy client/backend revision เดียวกัน. Trigger handlers แบบ private ต้องตรวจและติดตั้งตามแผน rollout; ไม่มีคำสั่ง deploy หรือ migrate อัตโนมัติในขั้นตอน local นี้

## รายงานและงานค้าง

- [RPC Security 1–2](docs/SECURITY-RPC-2026-10-11.md)
- [Integrity/Performance 3–18](docs/INTEGRITY-PERFORMANCE-2026-10-11.md)
- [Audit 19–40](docs/AUDIT-19-40-2026-10-11.md)
- [Recovery และ readiness รอบล่าสุด](docs/CONTINUATION-2026-10-12.md)
- [UI/UX 15 รายการ: implementation, tests และ Firestore impact](docs/UI-UX-2026-10-12.md)
- [Staging UAT / measurement / rollout / rollback](docs/STAGING-UAT-2026-10-12.md)
- [Live result template](docs/STAGING-RESULTS.template.json)

งานค้างที่ต้องใช้บริการจริง: Staging UAT, OAuth/Mail/IAM/index/trigger confirmation, Firestore/latency measurements และ rollout ที่ได้รับอนุมัติ. Public PR #2 ของ daily backlog เป็นงานเดิม ไม่ได้รวม changes ทั้งหมดบน branch ปัจจุบัน
