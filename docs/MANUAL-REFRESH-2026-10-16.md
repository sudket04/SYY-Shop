# Manual refresh และการลดโหลดซ้ำ — 16 ตุลาคม 2569

ผู้ใช้อนุมัติให้แก้และ Deploy รวมงาน `fc02367` ที่เคยรอเผยแพร่ โดยใช้ URL/สิทธิ์ Deployment เดิม

## สิ่งที่ปรับ

- `Shared.html`: ยกเลิก interval โหลดข้อมูลทุกนาทีและการโหลดจาก focus/visibility; เวลาผ่านไปหรือกลับเมนูเดิมจะไม่โหลดซ้ำเพียงเพราะข้อมูลมีอายุ
- ยังคงโหลดครั้งแรก, ปุ่มรีเฟรช, scoped Cache, ตรวจ version/expiry เมื่อมีคำขอจริง และอัปเดตเฉพาะส่วนหลัง write/delta/invalidation ที่ทราบว่าข้อมูลเปลี่ยน
- `index.html`: Dashboard ไม่ polling ตามเวลาและไม่อ่านใหม่เมื่อกลับหน้า Home ที่เคยโหลดแล้ว ยังคงรับเหตุการณ์เปลี่ยนข้อมูลและรีเฟรชเองได้
- ป้ายเวลาข้อมูล/“ควรรีเฟรช” อัปเดตในเครื่อง ไม่เรียก Firestore; Backup progress ที่เปิดดูยังติดตามจนเสร็จ ตาราง Backup และ Trigger เดิมไม่เปลี่ยน
- รวมการคงหน้าและ signed anchor, bounded browse, ป้องกัน refresh ซ้อน, รักษา DOM/focus และ Viewer ไม่โหลด dropdown แก้ไขจาก [งานแก้ Pagination](PAGINATION-PERFORMANCE-2026-10-16.md)

## สิ่งที่ผู้ใช้ควรทราบ

- การเปลี่ยนข้อมูลจากอีกเครื่องอาจไม่ปรากฏจนกดรีเฟรช ระบบไม่ได้เพิ่ม realtime listener
- การขาย/ตัดสต๊อก/รับสินค้า ยังคงตรวจสต๊อกจริงและเงื่อนไข write ฝั่ง server เดิม ไม่ใช้ Cache เป็นแหล่งอนุมัติธุรกรรม
- ไม่เพิ่ม DB writes, เปลี่ยน schema/index/Rules/IAM/สิทธิ์บัญชี หรือแก้ business transaction/Backup workers
- ลดคำขอจากการปล่อยหน้าไว้และการกลับโฟกัส ไม่อ้างเปอร์เซ็นต์ลด billed reads ทั้งระบบหรือ latency จริง; การค้นหา/XLFilter ซับซ้อนยังใช้ complete-catalog fallback

## Verification

- Backend/cache/security regression **209/209 ผ่าน**
- Browser regression **106/106 กลุ่มผ่าน**; ทดสอบเพิ่มเติมโดยติดตั้ง clock ก่อน navigation แล้วเดินเวลา 5 นาทีบนสินค้า, Brands, Zones, PO, ใบเสนอราคา, ใบกำกับภาษี, POS และ Dashboard พบ **0 คำขอเพิ่มเติมจากเวลา/focus/กลับ Home**; ปุ่มรีเฟรชยังเรียกข้อมูลได้
- Syntax **69 scripts/manifest ผ่าน**, diff check ผ่าน
- ก่อน Sync สำรอง Source จริง **24/24 ไฟล์** และ normalized SHA-256 ตรงกับ Production 96 ทุกไฟล์ ไม่มี Source ที่แก้นอก Git ค้างอยู่ใน server Head ณ เวลาตรวจ
- หลักฐาน local อยู่ใน ignored `test-results/deploy-manual-refresh-2026-10-16/` และ `test-results/manual-refresh-{unit,browser}.log`

## Files Changed

`Shared.html`, `index.html`, `tests/client-cache.test.cjs`, `tests/browser.cjs`, รายงานนี้ และ `README.md` (งานรอ Deploy จาก `fc02367` มีไฟล์เพิ่มเติมตามรายงาน Pagination)

สถานะ ณ commit implementation: เตรียม Source แล้ว ยังไม่ยืนยันการเผยแพร่จน Google แสดง success และตรวจ published version ครบ
