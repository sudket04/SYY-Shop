# โหลดรูปสินค้า ตาราง 100 รายการ และ skeleton — 29 ตุลาคม 2569

**อัปเดตภายหลัง:** ผู้ใช้อนุมัติตรวจบัคและDeployแล้ว งานนี้พร้อมแพตช์auditรวมอยู่ใน **Version103 เวลา21:09 วันที่29ต.ค.2026** จาก runtimec3dc752 ดู [ผลเผยแพร่และหลักฐานล่าสุด](DEPLOYMENT-2026-10-29-V103.md) สถานะ “ยังไม่Deploy” ด้านล่างเป็นบันทึก ณรอบส่งSource3a82708

## สถานะส่งมอบ

- ผู้ใช้อนุมัติให้ปรับหลังงานบิลชุดก่อนเสร็จ ดำเนินการใน Source แล้ว
- Runtime commit: `3a82708895dce542966675205a5a18cbc97cf406` บน `main` ต่อจาก `a7296df`
- ยังไม่ Sync Apps Script หรือ Deploy รอบใหม่ ไม่ได้สั่งเขียน/แก้ไข/ลบ Production DB หรือเปลี่ยนสิทธิ์/schema/index/Trigger
- ชุดนี้รวม Source งานบิล `7155326` ที่ยังรอ Deploy อยู่ก่อนแล้ว ไม่ต้องทำงานบิลซ้ำ

## Root cause

1. `ensureProductImages()` เดิมหยุดการเปิดทั้งหน้ารายละเอียด/แก้ไขไว้จนได้ metadata รูป และการเปิดแก้ไขครั้งแรกยังต้องรอ dropdown ต่อจากรูป จึงเพิ่มเวลารอแบบต่อเนื่อง
2. หน้าตารางไม่เตรียม metadata รูปไว้ให้รายการที่ผู้ใช้กำลังดู การเปิดรายการใหม่จึงต้องเริ่มคำขอเมื่อคลิก
3. จำนวนต่อหน้ามีทั้งค่าเริ่มต้นและค่า preference เดิม 10/25/50/100 ผู้ใช้จึงเห็นผลต่างกันตามอุปกรณ์/บัญชี
4. หลายหน้ามี skeleton เฉพาะครั้งแรก บางหน้ามีเพียงข้อความโหลด การรีเฟรช/เปิดรายละเอียด/ตัวกรองจึงให้ feedback ไม่สม่ำเสมอ

## สิ่งที่เปลี่ยน

### รูปสินค้าและความปลอดภัยของร่าง

- หลัง render ตาราง เตรียม **metadata รูปเฉพาะไม่เกิน 100 รายการในหน้าปัจจุบัน** ด้วย `getProductImageBatch` ชุดเดียว ไม่ query แยกต่อแถวหรือโหลดรูปทุกสินค้า 10,000 รายการ
- คำขอของรายการเดียวกันใช้ร่วมกัน หากผู้ใช้คลิกระหว่าง prefetch จะรอคำขอเดิม ไม่ส่งซ้ำ
- เก็บ metadata ในหน่วยความจำต่อแท็บ สูงสุด 300 รายการ/อายุ 2 นาที ผูกบัญชีและ generation ของ Product_Images คง cache/authorization ของระบบเดิม
- รายละเอียดเปิดข้อมูลสินค้าได้ทันที รูปมี skeleton และปุ่มลองใหม่เมื่อโหลดผิดพลาด
- แบบฟอร์มยังตรวจ dropdown ให้พร้อมก่อนเปิด โดยมีกรอบ skeleton ระหว่างเตรียม หลังเปิดแล้วไม่รอรูปเพื่อให้แก้ข้อมูลข้อความได้
- ส่วนรูปยังไม่ให้เปลี่ยน/ลบ/จัดลำดับจน metadata พร้อม การบันทึกข้อมูลสินค้าระหว่างรอไม่สร้าง image draft และไม่ลบรูปเดิม
- คำตอบที่มาช้าปรับเฉพาะส่วนรูป ไม่เติมฟอร์มใหม่ทับข้อความที่พิมพ์ และไม่เปิด modal ที่ผู้ใช้ปิดแล้ว
- การเติมรูปเดิมไม่ทำให้ร่างกลายเป็น “แก้ไขแล้ว” ส่วนร่างที่ผู้ใช้แก้จริงยังคงสถานะและข้อความเดิม
- เมื่อกู้ร่างที่ไม่ได้แก้รูป ใช้ metadata ปัจจุบันที่ตรวจแล้ว; ถ้ามี image draft จริงยังเก็บ draft และ expected updateTime เดิมสำหรับ CAS
- Pixel ของรูปโหลดเมื่อเปิดแสดงจริง พร้อม placeholder ระหว่างรอและ fallback เมื่อโหลดภาพไม่สำเร็จ ตารางยังไม่มี thumbnail ตามพฤติกรรมเดิม

### ตารางสินค้า

- ใช้ **100 รายการ/หน้าคงที่** เอาตัวเลือกจำนวนต่อหน้าและ handler เปลี่ยนขนาดออก
- ไม่ใช้ pageSize จาก preference เก่า แต่รักษาคอลัมน์ที่ผู้ใช้เลือกไว้
- คง signed cursor, หน้าก่อน/ถัดไป, การค้นหา/XLFilter ทั่วขอบเขตเดิม, Export และสิทธิ์ Admin/Staff/Viewer
- Export ยังโหลดตามตัวกรองครบทุกหน้า การแสดง 100 แถวไม่ได้จำกัดผลค้นหาหรือไฟล์ Export เหลือ 100

### Skeleton ระหว่างโหลด

- เพิ่มตัวแสดงสถานะส่วนกลางสำหรับตาราง/การ์ด โดยเก็บ DOM ข้อมูลเดิม ตำแหน่งเลื่อน และ draft ไว้
- ครอบคลุม Products, StockIssue, History, Dashboard, PO, Quotation, Tax Invoice และ master ทั้ง 6 หน้า รวมรายละเอียดบิล, Backup overview และ Activity Log ในเชลล์
- Profile และ Manage Users ซึ่งใช้ API helper ของตัวเองมี skeleton ตามรูปแบบเดิมของแต่ละหน้า
- XLFilter มี skeleton ระหว่างรอ facets และเมนู iframe มี skeleton จนหน้าแจ้งพร้อม; timeout เปลี่ยนเป็นสถานะผิดพลาดพร้อม retry
- Quotation มี placeholder ตั้งแต่รอ cache ครั้งแรก ส่วนรูปสินค้ามี skeleton แยกจากข้อมูลข้อความ
- คำขอซ้อนใช้ตัวนับ จบคำขอเก่าจะไม่เอา skeleton ของคำขอใหม่ออก และ cleanup เมื่อสำเร็จ/ผิดพลาดตามเส้นทาง callback เดิม
- Skeleton ไม่สั่ง RPC/DB write และไม่แตะข้อมูลในฟอร์ม ปุ่มบันทึก/กระบวนการยืนยันตัวตนยังใช้สถานะดำเนินงานเดิม
- รองรับ prefers-reduced-motion; ตรวจหน้าจอและความกว้าง placeholder ส่วนรูปแล้ว

## Firestore impact และข้อแลกเปลี่ยน

การเตรียม metadata รูปล่วงหน้า **อาจเพิ่ม Reads ตอนเปิดหน้าครั้งแรก** เทียบกับรออ่านเฉพาะรายการที่กด แลกกับการเปิดรายละเอียด/แก้ไขโดยไม่รอคำขอรูปใหม่ จึงไม่อ้างว่า Reads ทั้งระบบลดลงจากงานนี้

ผล fixture 150 สินค้า มีเอกสารรูปทุกสินค้า:

| รายการ | ผลจำลอง |
|---|---:|
| แถวที่แสดง | 100 |
| Master_Products document results ครั้งแรก | 101 รวม lookahead |
| Product_Images document results ล่วงหน้า | 100 ใน 1 batch |
| เรียก image batch ซ้ำเมื่อ server cache อุ่น | เพิ่ม 0 image document results |

Browser เชื่อม gateway จำลองตรวจว่าผู้ใช้ Viewer 5 บัญชีใช้ snapshot/server cache เดียวกันได้ อ่านสินค้า 101 + รูป 100 ครั้งแรก และกลับหน้าก่อน/ถัดไปจาก cache โดยไม่มี product/image document results เพิ่มในกรณีที่ตรวจ

ตัวเลขนี้ไม่รวม auth, index, missing-document billing, network และเวลาแสดงผลจริงบน Google หนึ่ง batch/RPC ไม่เท่ากับหนึ่ง billable read ต้องประเมินจากเอกสารที่เข้าถึงและเงื่อนไข [Firestore billing](https://firebase.google.com/docs/firestore/pricing) ไม่มีการเพิ่ม polling/telemetry write เพื่อวัดผล

## ผลตรวจ

- Unit regression: **286/286 ผ่าน**
- Browser regression ทั้งระบบ: **144/144 กลุ่มผ่าน** รวม 4 กลุ่มใหม่เรื่อง batch/paging, nonblocking modals, failure/stale response และ skeleton ทุกหน้าข้อมูล
- Backend-integrated Browser: **10/10 กลุ่มผ่าน** ด้วย 10,000 สินค้าจำลอง พร้อมทดสอบ image cache ตอนกลับหน้า
- ตรวจกลุ่มที่เกี่ยวข้องซ้ำหลังเก็บ placeholder เริ่มต้นและภาพ/ระยะห่างรอบสุดท้าย ผ่าน
- Syntax: **70 scripts/manifest ผ่าน**; read model และ `git diff --check` ผ่าน
- ไม่มีการเชื่อม Production DB หรือส่งฟอร์ม Login/ธุรกรรมจริงระหว่างทดสอบ ไม่ได้วัดหรือรับรองเปอร์เซ็นต์ความเร็วจริง/ทุกหน้าไม่เกิน 10 วินาที

หลักฐาน local ใน `test-results/`: logs, `product-edit-images-loading.png`, `product-100-prefetched-detail.png` และ `backend-browser.json` ไม่รวม generated artifacts ใน Git

## Files changed และ release

- `Master_Products.html`: batch/cache รูป, nonblocking detail/editor, draft guard, image loading/fallback และ fixed 100 rows
- `Shared.html`, `Styles.html`: skeleton regions, callback lifecycle และ shared styles
- `Manage_Users.html`, `Profile.html`, `Quotation.html`, `XLFilter.html`, `index.html`: loading surfaces เฉพาะหน้า/ตัวกรอง/เชลล์
- `tests/browser.cjs`, `tests/browser-backend.cjs`, `tests/read-model.cjs`: regression และ read-cost model

Review bundle: `test-results/releases/review-3a82708895dc-23f674a4-53e2-496b-a3e3-db649833e4d9` ตรวจครบ 24 ไฟล์, sourceDirty=false, deployed=false

รออนุมัติ Sync/Deploy รอบใหม่ก่อนเปิดใช้จริง เมื่ออนุมัติให้เทียบ Source/สำรองของเดิมและตรวจ saved/published version กับ bundle ครบทุกไฟล์ คง URL/สิทธิ์/Trigger เดิม แล้วทดสอบ authenticated read-only ด้วย session ที่ผู้ใช้เปิดไว้ การ backfill เลขบิลและธุรกรรมเขียนจริงยังเป็นคนละขอบเขต

รักษา untracked เดิม `docs/SYSTEM-AUDIT-2026-10-11.md` ไว้นอก commit
