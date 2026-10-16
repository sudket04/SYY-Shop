# การโหลดข้อมูลและ Pagination — 16 ตุลาคม 2569

Baseline: `45ccfd6` (`main`); runtime ที่เผยแพร่อยู่ก่อนงานนี้คือ `3860e9d`, Deployment 96

## สาเหตุและการแก้ไข

| จุดที่พบ | สิ่งที่แก้ใน Source |
|---|---|
| `Master_Products.loadTable()` ตั้งหน้าเป็น 1 ทุกครั้ง รวมการรีเฟรชเบื้องหลัง | รักษาหน้าและ signed cursor เดิม รีเซ็ตเฉพาะเปลี่ยนคำค้น/ตัวกรอง/การเรียง/ขนาดหน้า |
| Browse cursor ยกเลิกทันทีเมื่อ generation เปลี่ยนหรือครบ 2 นาที และ client โหลดหน้าแรกอัตโนมัติ | ตรวจลายเซ็น/บัญชี/บทบาท/query/ขนาดหน้า/เลขหน้าตามเดิม แล้วต่อจาก document anchor เดิมด้วย snapshot ใหม่เมื่อจำเป็น; ไม่ใช้ offset หรืออ่านย้อนหลังทุกหน้า |
| คำขอล้มเหลว/ตัวแบ่งหน้าไม่ถูกต้องทำให้เปลี่ยนหน้าเอง | เก็บหน้าที่โหลดสำเร็จล่าสุดและแจ้งข้อผิดพลาด ไม่มี retry วนหรือย้อนหน้าแรกอัตโนมัติ |
| งานโหลดปกติไม่ได้ตั้ง busy/startRevision ทำให้ freshness ซ้อนหรือ dirty ค้างหลังโหลดสำเร็จ | ใช้ `syyDataStarted()` ใน loaders สินค้า, Master ทั้ง 6, POS, PO, ใบเสนอราคา และใบกำกับภาษี |
| นับเวลา revalidation จากอายุ Source แม้เพิ่งตรวจ version สำเร็จ | แยก `lastChecked` สำหรับตารางเวลาและ `lastLoaded` สำหรับอายุข้อมูล; คง hard expiry ของ cache เดิม |
| เปลี่ยนหน้าขณะ request ค้าง และ auto refresh ล้างรายการเอกสารที่โหลดเพิ่มแล้ว | ล็อกปุ่ม pagination ขณะโหลด; พัก auto refresh เมื่อดูเอกสารหน้าถัดไปหรือโหลดมากกว่า 50 รายการ การกดรีเฟรชเองยังโหลดชุดล่าสุดตามเดิม |
| สร้าง skeleton/DOM ตารางใหม่ทุกครั้ง แม้มีข้อมูลเดิม | Master ทั้ง 6 และสินค้ารักษาแถวระหว่างโหลด ใช้ `syyPatchRows` เก็บ DOM/focus ของแถวที่ไม่เปลี่ยน |
| Stock delta เรียกโหลดหน้าสินค้าทั้งที่มี stock ใหม่ในข้อความอยู่แล้ว | อัปเดตแถวในเครื่องทันที; การแก้/เพิ่ม/ลบสินค้ารวมการรีเฟรชในช่วง 200 ms เพื่อให้ผลกรองและรายการใหม่ถูกต้อง |
| Viewer รอ dropdown สำหรับแก้ไขสินค้าที่ใช้ไม่ได้ | ไม่ขอ dropdown ชุดแก้ไขสำหรับ Viewer; ยังคงแสดงข้อมูลอ้างอิงของสินค้าที่เห็นและตรวจสิทธิ์ server |
| PO ตอบกลับต่างลำดับ/โหลดล้มเหลวแทนที่ตารางเดิมด้วย error | ใช้ request sequence และเก็บข้อมูลเดิมเมื่อรีเฟรชไม่สำเร็จ |

## พฤติกรรมและขอบเขตความถูกต้อง

- Browse snapshot เดิมใช้ได้ไม่เกิน 2 นาที เมื่อหมดอายุ/มี write/สั่งรีเฟรช จะเริ่ม snapshot ล่าสุดจาก anchor ที่เซ็นไว้ ไม่เพิ่มอายุ snapshot เก่า
- Signed anchor ใช้ต่อได้สูงสุด 24 ชั่วโมง และไม่ให้สิทธิ์เข้าถึงเอง: ทุก RPC ยังตรวจ session และ role; token ที่ถูกแก้ บัญชี/บทบาท/query/page size/เลขหน้าต่างกันยังถูกปฏิเสธ
- หากมีการเพิ่ม/ลบสินค้าก่อนตำแหน่งปัจจุบัน การคงตำแหน่งไม่ได้รับประกันลำดับแถวเทียบทั้ง collection ณ snapshot เดียวกัน ผู้ใช้กลับหน้าแรก/รีเฟรชได้; Export ยังคงตรวจ snapshot เข้มงวดตามเดิม
- รายการเอกสารที่โหลดเพิ่มหรืออยู่หน้าถัดไปจะไม่ถูกรีเฟรชเบื้องหลังจนทิ้งตำแหน่ง ผู้ใช้กดรีเฟรชเองเพื่อเริ่มรายการล่าสุดได้ ป้ายอายุข้อมูลยังใช้เวลาข้อมูลเดิม
- ค้นหา substring, XLFilter และเรียงคอลัมน์ที่ซับซ้อนยังใช้ complete-catalog fallback เพื่อไม่ให้ผลลัพธ์ตกหล่น; cold load เส้นทางนี้ยังอาจอ่านสินค้าครบ collection

## ผลทดสอบและ Firestore Impact

- `npm test`: **209/209 ผ่าน** รวม signed cursor, security, expiry, stock writes, export, Backup และ freshness
- `npm run test:browser`: **105/105 กลุ่มผ่าน** รวมทุก 15 routed pages, Viewer, desktop/mobile, การเปลี่ยนหน้า, refresh ค้าง/ล้มเหลว, cache, drafts และ focus
- `npm run check`: **69 scripts/manifest ผ่าน**; `git diff --check` ผ่าน
- Fixture 10,000 สินค้า: ต่อหน้าจาก cursor หมดอายุ/stock generation เปลี่ยน/anchor ถูกลบ ได้ทั้งขึ้นและลง; หน้า 50 รายการอ่าน product documents **51 รายการ** ไม่มี offset/full scan; **0 DB writes**
- Browser: เปิดหน้าที่เคยโหลดภายใน cache window ไม่เพิ่ม RPC; stock delta ที่มีข้อมูลอยู่แล้วไม่เพิ่ม RPC ทันที; edit delta หลายรายการในช่วงเดียวกันรวมเหลือหนึ่งคำขอ
- Master ทั้ง 6 แสดงแถวเดิมขณะ request ค้าง และเก็บ DOM node เดิมเมื่อข้อมูลไม่เปลี่ยน; document pager ปลดล็อกหลัง error โดยคงข้อมูล
- ตัวเลขเป็นการทดสอบ local/mock ไม่ใช่ billed reads หรือ latency Production จึงยังไม่ระบุเปอร์เซ็นต์ลด Reads ทั้งระบบหรือเวลาตอบสนองจริง
- ไม่มีการอ่าน/เขียนข้อมูล Production, เปลี่ยน schema/index/IAM, Firestore Rules, user permissions หรือ Trigger ในงานนี้

## Files Changed และ Deployment

- Runtime: `Code.gs`, `Shared.html`, `Master_Products.html`, `StockIssue.html`, `Purchase_Orders.html`, `Quotation.html`, `Master_Tax_Invoice.html` และ `Master_Brands/Categories/Cars/Customers/Vendors/Zones.html`
- Tests: `tests/hybrid-cache.test.cjs`, `tests/client-cache.test.cjs`, `tests/browser.cjs`
- Documentation: รายงานนี้และลิงก์ใน `README.md`
- **ยังไม่ Sync/Deploy งานรอบนี้**; Production ยังคง Version 96 ต้องเผยแพร่ client/backend ชุดเดียวกันและทดสอบด้วยบัญชีจริงหลังอนุมัติ Deployment
- หลักฐาน local อยู่ใน ignored `test-results/`: `pagination-unit.log`, `browser-pagination.log`, `browser-result.json`, `pagination-stable-page-2.png`
