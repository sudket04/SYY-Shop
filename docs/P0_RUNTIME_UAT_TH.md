# SYY-Shop — P0 Runtime UAT & Merge Gate

เอกสารนี้เป็นเกณฑ์ทดสอบก่อน Merge `feature/ui-reference-parity` เข้า `main`

> หลักการ: P0 ต้องพิสูจน์ Data Integrity, Transaction Safety, Permission, Read/Write Efficiency และ UI Regression บน Apps Script deployment จริงก่อน Merge

## 1. Environment / Test Data

ใช้ deployment สำหรับ UAT ที่เชื่อม Firestore/Drive ชุดทดสอบ หรือสำรองข้อมูลก่อนทดสอบ Production data

เตรียมบัญชีอย่างน้อย 3 Role:
- Viewer
- Staff
- Admin

เตรียมสินค้าอย่างน้อย:
- P-A: Stock 10 / Min 3
- P-B: Stock 2 / Min 2
- P-C: Stock 0 / Min 1
- สินค้าที่มี Part Number และ Barcode สำหรับ duplicate test

เตรียม PO:
- PO-A: 2–3 SKU, ยังไม่รับสินค้า
- PO-B: SKU เดียวกันซ้ำ 2 บรรทัด เพื่อทดสอบ allocation protection

เตรียม Quotation:
- Q-A: Status `ปิดงาน-ขายสำเร็จ`, ยังไม่ตัด Stock

## 2. Authentication / Permission

### UAT-AUTH-01 Viewer
1. Login ด้วย Viewer
2. เปิด Dashboard / Product / Document
3. ทดลอง action ที่ Viewer ไม่ควรแก้ Master/Stock

Expected:
- อ่านข้อมูลได้ตามสิทธิ์
- action ที่ต้อง Staff/Admin ถูกปฏิเสธจาก server ไม่ใช่แค่ซ่อนปุ่ม

### UAT-AUTH-02 Staff
Expected:
- Add/Edit Master และทำ Stock Transaction ได้
- User administration ที่ต้อง Admin ถูกปฏิเสธ

### UAT-AUTH-03 Admin
Expected:
- ทำ administrative actions ได้
- UI Manage Users แสดง Role / 2FA / Last Login / Status ถูกต้อง

## 3. Product Master Integrity

### UAT-PROD-01 Add Product
1. เพิ่มสินค้าใหม่
2. ตรวจ ID
3. เพิ่มสินค้ารายการถัดไป

Expected:
- ID ไม่ซ้ำ
- Counter เดินต่อเนื่อง
- หลัง Counter ถูก seed แล้ว ไม่ scan Product ทั้ง collection เพื่อหา ID ใหม่ทุกครั้ง

### UAT-PROD-02 Duplicate
ทดสอบ Part Number และ Barcode ซ้ำ

Expected:
- Server reject
- ไม่มี document ใหม่ถูกสร้าง

### UAT-PROD-03 Stock Protection
1. เปิด Edit Product P-A
2. ระหว่างยังเปิด form ให้ session อื่นทำ Stock Issue/Receive ต่อ P-A
3. กลับมาแก้เฉพาะชื่อ/ราคา แล้ว Save Product

Expected:
- Stock ล่าสุดต้องไม่ถูกย้อนกลับเป็นค่าตอนเปิด form
- Edit Product update ต้องไม่เขียน `Current_Stock` ของสินค้าเดิม

### UAT-PROD-04 Numeric Validation
ทดลองราคาทุน/ราคาขาย/Min Stock ติดลบหรือค่าที่ไม่ใช่ตัวเลข

Expected:
- Server reject
- ไม่มี NaN/negative value เข้า Firestore

## 4. Stock Adjustment

### UAT-ADJ-01 Normal
ปรับ P-A จาก 10 → 8 พร้อม Reason

Expected:
- Product = 8
- Stock_Movements มี Before=10 / After=8 / Qty=2
- มี User / Timestamp / Reason
- Activity/Audit ถูกบันทึก

### UAT-ADJ-02 Concurrent
เปิด Adjustment P-A สอง session แล้ว Save ใกล้กัน

Expected:
- updateTime precondition ป้องกัน lost update
- ไม่มี silent overwrite

## 5. Stock Issue / POS

### UAT-ISSUE-01 Normal
ตัด P-A จำนวน 2

Expected:
- Stock 10 → 8
- Movement OUT 1 รายการ
- UI update จาก delta โดยไม่โหลด Product collection ทั้งชุดซ้ำ

### UAT-ISSUE-02 Insufficient Stock
ตัดมากกว่าสต๊อก

Expected:
- Server reject
- Product และ Movement ไม่เปลี่ยน

### UAT-ISSUE-03 Client Tampering
แก้ request ให้มี `allowNegative=true`

Expected:
- Server ยังปฏิเสธ negative stock

### UAT-ISSUE-04 Double Click / Retry
1. ทำรายการ 1 ครั้ง
2. จำลอง response timeout หรือ retry request เดิมด้วย `clientRequestId` เดิม

Expected:
- Stock ลดครั้งเดียว
- Movement ถูกสร้างครั้งเดียว
- response รอบ retry มี `idempotent=true`
- UI refresh current state เพื่อไม่ใช้ historical delta เก่า

### UAT-ISSUE-05 Firestore Write Limit
ทดลอง/ตรวจ logic รายการเกิน 249 unique SKU

Expected:
- Reject ก่อน commit พร้อมข้อความให้แบ่ง transaction
- ไม่เกิด partial write

## 6. Quotation → Stock Issue

### UAT-QUOTE-01 Atomic Issue
ใช้ Q-A ส่งเข้า Stock Issue แล้ว Confirm

Expected:
- Product stock ลด
- Stock Movement ถูกสร้าง
- Quotation `Stock_Issued=true`
- `Stock_Issue_Doc` ตรงกับ movement
- ทุกอย่างอยู่ใน commit เดียว

### UAT-QUOTE-02 Repeat
ลองตัด Q-A ซ้ำ

Expected:
- Reject
- Stock ไม่ลดรอบสอง

## 7. Purchase Order / Receive Goods

### UAT-RECV-01 Full Receive
Expected:
- Product stock เพิ่ม
- Movement IN ถูกสร้าง
- PO = Received
- Product + Movement + PO เปลี่ยน atomic

### UAT-RECV-02 Partial Receive
Expected:
- PO = PartiallyReceived
- ReceivedQty ถูกต้อง
- บังคับ Delivery Note ตาม business rule

### UAT-RECV-03 Retry
ส่ง request เดิมด้วย `clientRequestId` เดิม

Expected:
- Stock เพิ่มครั้งเดียว
- Receipt ไม่ซ้ำ
- response ระบุ idempotent
- UI reload live state ใน retry path

### UAT-RECV-04 Duplicate Product Lines
ใช้ PO-B ที่มี Product code เดียวกัน 2 บรรทัด และรับรวม 5 ชิ้น

Expected:
- จำนวนรวมที่เพิ่ม Stock = 5 เท่านั้น
- ไม่ apply 5 ให้ทุกบรรทัดซ้ำ
- Inventory write ต่อ Product code มีครั้งเดียวใน commit

### UAT-RECV-05 Concurrent Sessions
รับ PO เดียวกันสอง session พร้อมกัน

Expected:
- PO updateTime/Product updateTime ป้องกัน lost update
- retry อ่าน state ใหม่
- Stock ไม่เพิ่มเกินยอดที่สั่ง

## 8. Product Gallery

### UAT-IMG-01 Upload
อัปโหลด 1–6 รูป

Expected:
- แสดงครบ
- Primary Image ถูกต้อง
- Thumbnail ใช้ contain ไม่ crop
- Lightbox เปิดรูปใหญ่ได้

### UAT-IMG-02 Limit
อัปโหลดรูปที่ 7

Expected: reject

### UAT-IMG-03 Set Primary
Expected:
- Gallery order เปลี่ยน
- Product_Images compatibility record sync
- Product table/dashboard ใช้รูปหลักใหม่

### UAT-IMG-04 Delete
Expected:
- Metadata update ก่อน trash file
- ไม่มี broken URL

### UAT-IMG-05 Concurrent Mutation
สอง session upload/set-primary/delete สินค้าเดียวกันพร้อมกัน

Expected:
- Lock ป้องกัน lost update
- ไม่มี image metadata หาย
- ไม่มี orphan file จาก upload ที่ save ไม่สำเร็จ

## 9. Tax Invoice

### UAT-TAX-01 Create / Edit
Expected:
- Running number ถูกต้อง
- Save แล้ว update local list ไม่ reload Product/Customer/Invoice ทั้งชุดโดยไม่จำเป็น

### UAT-TAX-02 Quick Add Customer
Expected:
- Customer ถูกสร้าง
- auto-select ลูกค้าใหม่
- immediate `getCustomersFull` ใช้ local cache ไม่ read collection ซ้ำ

### UAT-TAX-03 Print/PDF
ตรวจ Print Preview, PDF, A4 และข้อมูลผู้ซื้อ/ผู้ขาย/VAT

Expected: layout และข้อมูลไม่ regression

### UAT-TAX-04 Responsive Workspace
ตรวจ 1920, 1366, tablet, 430, 390, 360 px

Expected:
- Desktop 3-column workspace
- Tablet 2-column + summary
- Mobile 1-column
- ไม่มี field/button หลุด viewport

## 10. Dashboard

### UAT-DASH-01 KPI
ตรวจ:
- มูลค่าสต๊อก
- ยอดขาย
- กำไรขั้นต้น
- สินค้าหมด
- ใกล้หมด
- PO รอรับ

Expected: ตัวเลขตรงกับ source data ในช่วงเวลาที่เลือก

### UAT-DASH-02 Delta
ทำ Stock Issue / Receive / Adjustment

Expected:
- Dashboard stock state update จาก delta
- normal success path ไม่ full reload Product ทั้ง collection

### UAT-DASH-03 Bounded History
Expected:
- Dashboard ใช้ bounded query/cache
- ถ้าถึง limit ต้องแสดง warning ว่าข้อมูลประวัติถูกจำกัด ไม่แสดงเหมือนข้อมูลครบ

## 11. Manage Users

ทดสอบ Create / Edit / Enable / Disable / Reset Password / 2FA display / Last Login

Expected:
- UI ใช้ design system เดียวกับระบบ
- Admin actions ตรวจสิทธิ์ server-side
- ไม่เกิด duplicated table/filter implementation regression

## 12. Firestore Read/Write Measurement

วัดก่อน/หลัง flow อย่างน้อย:
- Open Dashboard
- Save Product
- Stock Issue
- Receive Goods
- Tax Invoice Save
- Quick Add Customer
- Gallery upload/set primary

Merge gate:
- Normal write success ต้องไม่ตามด้วย full collection reload ที่ไม่จำเป็น
- Auto-ID หลัง seed ต้องไม่ scan collection ต่อครั้ง
- Retry path ยอม full refresh ได้เพื่อ correctness

## 13. Drive Verification

ตรวจ folder รูปสินค้า:
- ไม่มี orphan file จาก failed upload
- deleted gallery file ถูก trash หลัง metadata save สำเร็จ
- Primary image URL ใช้งานจริง

## 14. Merge Gate

ห้าม Merge หากพบข้อใดข้อหนึ่ง:
- Stock ซ้ำ/หาย/ติดลบจาก normal transaction
- Retry ทำ transaction ซ้ำ
- Product Edit ย้อน stock
- PO และ Product ไม่ตรงกันหลัง Receive
- Quote ถูกตัด stock ซ้ำ
- Gallery lost update/broken image
- Permission bypass ผ่าน flow ที่ระบบใช้งาน
- Tax Invoice save/print regression
- Dashboard แสดงตัวเลข truncated โดยไม่เตือน

Merge ได้เมื่อ P0 Critical/High ผ่านทั้งหมด และ Medium issue มี owner/แผนแก้ชัดเจน

## 15. Residual Security — P1 (ต้องทำหลัง P0 Runtime UAT)

P0 UI ใช้ `p0GatewayV2` และตรวจ session/role แต่โครงการเดิมยังมี public top-level Apps Script implementation functions/legacy gateway บางส่วนที่ควร harden ต่อใน P1 โดยลด public callable surface ให้เหลือ gateway ที่ตั้งใจเปิดเท่านั้น

P1 ต้องรวมอย่างน้อย:
- ปิด/rename implementation functions ที่ไม่ควรถูก `google.script.run` เรียกตรง
- ตรวจ legacy `apiGateway` / `p0Gateway` alternate path
- session persistence/revocation
- password/reset session revocation
- token-in-URL architecture
- TOTP/crypto hardening
- OAuth scope/manifest review
