# SYY-Shop

ระบบบริหารร้านอะไหล่บน Google Apps Script V8, HTML/CSS/JavaScript และ Cloud Firestore REST API รองรับ Dashboard, Master Data, สินค้า/รูป/บาร์โค้ด, ตัดสต๊อก, PO/รับสินค้า, ใบเสนอราคา, ใบกำกับภาษี และบัญชีผู้ใช้

Source ผ่านการแก้ audit 1–40 และทดสอบในเครื่องแล้ว **Production URL เดิมอัปเดตเป็นรุ่น 97 เมื่อ 16 ตุลาคม 2569 เวลา 18:26** รวมการแก้ Pagination/ลดโหลดซ้ำและยกเลิก polling ตามเวลา ตรวจ published Source ครบ 24 ไฟล์และหน้า Login จริงผ่าน ดู [ผล Deployment](docs/DEPLOYMENT-2026-10-16-V97.md). ผล local/mock และการเปิดหน้า Login ยังไม่ยืนยันการใช้งานหลัง Login, OAuth/Mail, IAM/indexes, billing หรือข้อมูลจริงทุก workflow; งาน [Staging UAT](docs/STAGING-UAT-2026-10-12.md) และการตรวจรับที่ต้องใช้บัญชีจริงยังค้างอยู่

งานรองรับสินค้า 10,000 รายการเผยแพร่แล้ว: ตารางสินค้าปกติใช้ bounded cursor จาก server, metadata รูปเฉพาะรายการที่แสดง, compact catalog และ POS ครั้งละ 60 แถว ดู [ผลทดสอบและข้อจำกัด](docs/HYBRID-CACHE-2026-10-16.md) — การค้นหา substring/XLFilter และการเรียงซับซ้อนยังใช้ complete-catalog fallback เพื่อรักษาผลค้นหาเดิม

**Production ล่าสุดเป็น Version 98 เมื่อ 16 ตุลาคม 2569 เวลา 23:50** Runtime `cfafa3e`: รีเฟรชตรวจ Version ก่อนอ่านรายการ, ปิดการโหลดจาก notifications/dirty activation, Cache หน้าสินค้าใน IndexedDB, รักษาหน้าเอกสาร และแก้ POS หมวดหมู่หาย/เวลา Cache บน Dashboard ตรวจ published Source 24/24 และหน้า Login ผ่าน ดู [ผล Deployment](docs/DEPLOYMENT-2026-10-16-V98.md) และ [ขอบเขต ผลทดสอบ และข้อจำกัด](docs/VERSION-FIRST-CACHE-2026-10-16.md) โดยการค้นหา/กรองยังใช้ชุดเดิม

## โครงสร้าง

งานใหม่วันที่ 19 ตุลาคมบน `main` **ยังไม่ Sync/Deploy**: แสดงสถานะขณะเปิดเมนู มี timeout/ปุ่มลองใหม่ และยืนยัน child frame/origin ก่อนส่งข้อความ รองรับ Profile/Manage Users ด้วย ดู [ผลตรวจและข้อจำกัด](docs/MENU-FRAME-RECOVERY-2026-10-19.md)

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

- [Production รุ่น 99: Deploy ddf38ad พร้อม menu recovery ตรวจ Source 24 ไฟล์และข้อมูล/Pagination จริง](docs/DEPLOYMENT-2026-10-19-V99.md)
- [แก้โหลดข้อมูลค้าง/หน้าสินค้าว่าง, โหลด dropdown เมื่อต้องใช้ และ Dashboard skeleton/ตาราง 10,000 รายการ](docs/DATA-LOADING-DASHBOARD-2026-10-19.md)
- [ยกเลิก polling ตามเวลา คง Manual refresh และอัปเดตหลังข้อมูลเปลี่ยน](docs/MANUAL-REFRESH-2026-10-16.md)
- [Production รุ่น 97: Manual refresh, แก้หน้าเด้งและลดโหลดซ้ำ ตรวจ published Source ครบ 24 ไฟล์](docs/DEPLOYMENT-2026-10-16-V97.md)
- [แก้ Pagination เด้งหน้าแรก ลดโหลดซ้อนและคงแถวตารางระหว่างรีเฟรช](docs/PAGINATION-PERFORMANCE-2026-10-16.md)
- [Production รุ่น 96: Deploy main 3860e9d, checksum 24 ไฟล์ และ Login smoke](docs/DEPLOYMENT-2026-10-16.md)
- [Hybrid Cache: IndexedDB, product cursor, ผลจำลองลด product reads 99.49% และ Delta Sync ที่ยังเหลือ](docs/HYBRID-CACHE-2026-10-16.md)
- [Cache quality: รีเฟรช DB จริง แยกโหลดส่วนเปลี่ยน และผลจำลอง 10,000 สินค้า](docs/CACHE-QUALITY-2026-10-15.md)
- [Backup timeout: สาเหตุจาก Execution จริง การทำต่อด้วย checkpoint และ rollout ที่รออนุมัติ](docs/BACKUP-TIMEOUT-FIX-2026-10-15.md)
- [แก้รูปค้างและตรวจการแสดงผล/Reads ทั้งโปรเจกต์](docs/DISPLAY-READ-AUDIT-2026-10-15.md)
- [Browser cache และ XLFilter: การซิงก์ ขอบเขตแคช และผลทดสอบ](docs/CLIENT-CACHE-2026-10-15.md)
- [RPC Security 1–2](docs/SECURITY-RPC-2026-10-11.md)
- [Integrity/Performance 3–18](docs/INTEGRITY-PERFORMANCE-2026-10-11.md)
- [Audit 19–40](docs/AUDIT-19-40-2026-10-11.md)
- [Recovery และ readiness รอบล่าสุด](docs/CONTINUATION-2026-10-12.md)
- [UI/UX 15 รายการ: implementation, tests และ Firestore impact](docs/UI-UX-2026-10-12.md)
- [Staging UAT / measurement / rollout / rollback](docs/STAGING-UAT-2026-10-12.md)
- [Live result template](docs/STAGING-RESULTS.template.json)
- [Latest rollout readiness: verified Head/Version 92, login smoke and Backup follow-up](docs/ROLLOUT-READINESS-2026-10-13.md)
- [Production Version 93: published source, unchanged URL/access and live login smoke](docs/DEPLOYMENT-2026-10-13.md)
- [Viewer Products blank page: source inspection, corrected iframe regression and pending live session](docs/VIEWER-PRODUCTS-INVESTIGATION-2026-10-14.md)

งานค้างที่ต้องใช้บริการจริง: การตรวจรับหลัง Login ด้วยบัญชีจริง, Staging UAT, OAuth/Mail/IAM/index confirmation, ผล Backup รอบแรก และ Firestore/latency measurements. สถานะส่ง source รอบก่อนอยู่ใน [Main delivery](docs/MAIN-DELIVERY-2026-10-12.md); รายงานรอบก่อนบันทึกสถานะ ณ เวลาที่จัดทำ

สถานะล่าสุด 16 ตุลาคม 2569: Deployment URL เดิมอัปเดตเป็น **รุ่น 96** ด้วย runtime `3860e9d` แล้ว ยืนยัน Source ของรุ่นที่เผยแพร่ครบ 24/24 ไฟล์และหน้า Login จริงเปิดได้ คง URL/สิทธิ์เดิม Trigger `dailyBackupJob_` แสดงรุ่น 96; authenticated UAT และผล Backup รอบใหม่ยังรอตรวจจริง ดูรายงาน Deployment ด้านบน

## แนวทาง Git ปัจจุบัน

ตามคำสั่งผู้ใช้วันที่ 12 ตุลาคม 2569 ให้ทำงานบน `main` และอัปเดต `origin/main` ทุกครั้งหลังตรวจและ commit งานที่เสร็จ จนกว่าจะมีคำสั่งเปลี่ยนแปลง ดูคำสั่งถาวรใน [AGENTS.md](AGENTS.md) การ push source ไม่ใช่การ deploy Apps Script หรือการอนุมัติเปลี่ยนข้อมูล Production
