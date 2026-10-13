# Apps Script source sync — 2026-10-13

## ผลการดำเนินการ

ซิงก์ runtime Source ของ SYY-Shop ให้ตรงกับ `main` ที่ `9300cdf7d0f3a6a888d905d5149b0fd4218e4161` ครบ 24 ไฟล์ ตามคำสั่งผู้ใช้ให้ปรับปรุงโค้ดทั้งหมดใน Apps Script

โปรเจกต์จริง: [SYY-Shop Editor](https://script.google.com/home/projects/16P76qalO_UL1fqbI6mjSDPz0MwUI82f0ZlEXrGkvOsGdCRINM05CuORP/edit)

- อ่าน Source เดิมครบทุกไฟล์ผ่าน Editor และเก็บสำเนาเฉพาะใน `test-results/apps-script-all-pre-sync-9300cdf7d0f3` ที่ถูก ignore
- 23 ไฟล์ตรงกับ main อยู่แล้ว จึงไม่เขียนทับซ้ำ
- อัปเดต `UiSystem.html` ไฟล์เดียวที่ยังเป็นรุ่นเก่า โดย Source เดิมตรงกับ Git `af618478ef6c3d9b00b72eb1331d08901fac9f59` หลังเทียบ line endings ไม่พบการแก้เองเพิ่มเติมในไฟล์นี้
- ความต่างที่แก้คือกรอบหน้ารายการและ font/spacing ตามประเภทข้อมูล รวมถึงปุ่มดูรหัสผ่านที่แสดงเมื่อเริ่มพิมพ์และเปิดให้เห็นเฉพาะระหว่างกดค้าง
- รักษาชื่อ Backend `รหัส.gs` ซึ่งตรงกับ `Code.gs` ใน repository ไม่มีการสร้าง/ลบ/เปลี่ยนชื่อไฟล์
- หลังบันทึก เปิด Editor ใหม่ อ่านกลับจากเซิร์ฟเวอร์ครบ 24 ไฟล์ และยืนยัน SHA-256 ตรงกับ main ทุกไฟล์ ไม่ใช้เพียงค่าใน buffer ที่เพิ่ง paste
- สำเนาหลังบันทึกและรายละเอียด checksum อยู่ใน `test-results/apps-script-all-post-sync-9300cdf7d0f3` และ `test-results/apps-script-all-sync-9300cdf7d0f3.json` ที่ถูก ignore

## การตรวจสอบ

- `npm run check` รันใหม่ผ่าน: 68 scripts และ Apps Script manifest parse
- `npm run release:prepare` ผ่าน ชุด review ผูกกับ commit ข้างต้น 24 runtime files และ sourceDirty=false ไม่มี deployment
- Runtime Source ใน repository ไม่เปลี่ยนจาก baseline ที่ทดสอบแล้ว: `npm test` 152 tests และ `npm run test:browser` 78 regression groups ผ่านในงานก่อนหน้า ไม่ได้รัน regression ซ้ำในรอบ sync นี้
- ตรวจ Source จริงก่อน/หลังและ inventory: 24/24 ไฟล์ตรง ไม่มีไฟล์ชั่วคราวเพิ่ม
- หลักฐานหน้า Editor ที่เปิดใหม่: `test-results/apps-script-all-source-synced.jpg`

## Firestore และ Deployment

งาน sync นี้ไม่เรียกฟังก์ชันธุรกิจ ไม่ query/write Firestore ไม่สำรอง/กู้คืนข้อมูลจริง ไม่มีการแก้ schema/index/IAM หรือสิทธิ์ผู้ใช้

Backend, manifest และ index ตรงกับ Source ที่ติดตั้ง Backup Trigger ไว้แล้ว ไม่มีการติดตั้งหรือแก้ Trigger ซ้ำ ไม่แก้ Script Properties หรือโฟลเดอร์/สิทธิ์ Backup

Source ใน Editor/Head เป็นรุ่นล่าสุดแล้ว **ยังไม่ได้สร้าง version หรือ Deploy Web App** ดังนั้น URL `/exec` ยังใช้ deployment เดิม หน้าจอและพฤติกรรมใหม่ของ Web App จะมีผลเมื่ออัปเดต deployment ตามขั้นตอนที่ได้รับอนุมัติแยกต่างหาก

## SHA-256 ที่อ่านกลับจริง

Normalize CRLF เป็น LF และ newline ท้ายไฟล์ก่อน hash

| Repository file | Apps Script file | SHA-256 |
| --- | --- | --- |
| `appsscript.json` | `appsscript.json` | `c9440eb605d911bc523225f9e27c77f71d71de3c5228d26cc3f0d8677230d3c8` |
| `Code.gs` | `รหัส.gs` | `26a0c77e4922263f9a9821811c421f2e7c0e0c25332aaa5cb3284f0cc9ebe45e` |
| `Master_Brands.html` | `Master_Brands.html` | `cfefbd362f9cd6a93f32c20300a47f08b710bac775f2689e6479a3bc585ab5e1` |
| `Master_Categories.html` | `Master_Categories.html` | `d8c35e5d3495867a1135edcbdfe137645befb29330f846aaa8aedc88bdbaa387` |
| `index.html` | `index.html` | `17b2423eeddfb2afe27ae9e5f910f3d89878e1636797a7b885fda0c50ef158d1` |
| `Master_Vendors.html` | `Master_Vendors.html` | `597a82851aab0bc4bec5fdbe854588cb06b0794691b760c981f978bf1423a70a` |
| `Master_Zones.html` | `Master_Zones.html` | `81a38b29eb2930d8826861d62dc49542509b7ec4c35291246e3f9c97a5c76fd6` |
| `Master_Products.html` | `Master_Products.html` | `0415393a1ec654194a1ed9bcf8eb3e7c7813951b177afe24a8e315ddbe294687` |
| `Master_Cars.html` | `Master_Cars.html` | `7a7f85310d91ed6a0dc9d5733ab3d1be83781662338e0d69130034ac40790eea` |
| `Purchase_Orders.html` | `Purchase_Orders.html` | `1acf7ce28a84733e4fca89492c6e8b9fa3021fb062b692ca227e454434aa8c1b` |
| `Master_Tax_Invoice.html` | `Master_Tax_Invoice.html` | `b9c9b87e486f4de4abbeaed42fe2eec557a30d678a6499262a61783cb57b7850` |
| `Master_Customers.html` | `Master_Customers.html` | `808e76d10abdbd99b000b38179c5071ffe3ef52018160f8c405cd1b706c10a2b` |
| `ThaiAddressData.html` | `ThaiAddressData.html` | `d897a6f60937abc4f9c0618a53effe8034ffd54ca2093dc5b756c25d442a040a` |
| `Profile.html` | `Profile.html` | `ff81dabacf79fc532ad63f44caa0e73d7bd260d72dd80d46fadde8391a1237e3` |
| `login.html` | `login.html` | `a2ee2dda1b8b12910ea6867c63bbc98d05b501dd9993e0350bfa0f7c5ac40d48` |
| `Manage_Users.html` | `Manage_Users.html` | `b605f1ab531bc5d0cf7378334e6ca561355b7c39ba6f1f62c4b2deea702529f6` |
| `Shared.html` | `Shared.html` | `ab541016a0733f9122212b44a5fa6e2927b1535d640ee2e3c23c2f5d4c2dde6c` |
| `Styles.html` | `Styles.html` | `f04b882a3916c68a08ff6e24046db11797c1b2eb9e1ac1f60a6992f011ab959c` |
| `XLFilter.html` | `XLFilter.html` | `8123d92181ba0d10115203eaac68a9a63937c5112402aa03200357b54d66b758` |
| `StockIssue.html` | `StockIssue.html` | `d5cb4b5e703a9feef8d0db7e1ee604d53762f593f984e851a4bc1b03bab06239` |
| `Quotation.html` | `Quotation.html` | `8c0774c6271c92f3aa13a5aeb5221d084249169d2fd40d69320771ad098c7cb9` |
| `UiSystem.html` | `UiSystem.html` | `f18a8f68b2ed1f10f7ebe381506151f465c7cd5b2d6fec5f5b3184cafce4c753` |
| `ProductImagesV2.gs` | `ProductImagesV2.gs` | `25e2689b5678c62b26858a9a49727ad10263a0d5231f33514e83d9a29495c7c4` |
| `UiEnhancements.html` | `UiEnhancements.html` | `b32d644a858aa05e3e36e10a112adc68155181e317f4155120df2f0490d82553` |
