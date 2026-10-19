# Production Version 99 — 19 October 2026

ผู้ใช้อนุมัติ “deploy เลย” หลังตรวจงานแก้โหลดข้อมูลและ Dashboard จึง Sync และเผยแพร่ชุดที่ทดสอบแล้ว รวมแพตช์เมนูที่ยังค้างจาก `bfe26f1`

## ผลการเผยแพร่

- **Version 98 → 99 สำเร็จ** เมื่อ **19 ตุลาคม 2569 เวลา 18:35 Asia/Bangkok** ตามที่ Google แสดง
- Runtime commit: `ddf38ada3c16ac7b010373c59dde55844d3abed4`
- [Production URL เดิม](https://script.google.com/macros/s/AKfycbydnft6V1Fxlm6fm09ySlRwb0-cODawOWGhfMmOLyTsl-7Gyki-qwT_I97CEROTwqHS/exec)
- [Apps Script project เดิม](https://script.google.com/home/projects/16P76qalO_UL1fqbI6mjSDPz0MwUI82f0ZlEXrGkvOsGdCRINM05CuORP/edit)
- Execution/access คงเดิม: `shopsyy01@gmail.com` / ทุกคน ไม่มีการขยายสิทธิ์หรือเปลี่ยน OAuth scopes
- Description: `main ddf38ad: reliable product loading, read recovery, dashboard skeleton and bounded table; includes bfe26f1 menu recovery`

## การตรวจ Source และการตั้งค่า

1. สำรอง Source จริงจาก Editor **24 ไฟล์** ก่อนแก้ ทุกไฟล์ตรงกับ immutable Version 98 ไม่มีงานแก้ด้วยมือที่ถูกทับ
2. Sync เฉพาะ **5 ไฟล์ที่เปลี่ยน**: `index.html`, `Master_Products.html`, `Profile.html`, `Shared.html`, `UiSystem.html` ไม่มีการแก้ backend workers หรือ manifest
3. ตรวจเนื้อหาหลัง paste ก่อนบันทึกทุกไฟล์ จากนั้นบันทึกและโหลด Editor ใหม่จาก server
4. อ่าน saved Head **24/24 ตรงกับ runtime commit**
5. Google ยืนยัน deployment success เป็น Version 99 โดยใช้ Deployment ID/URL เดิม
6. เปิด Project History เลือก immutable **Version 99** อ่าน Source **24/24 ตรงกับ runtime commit** ด้วย SHA-256 หลัง normalize CRLF → LF และละเฉพาะ newline ท้ายไฟล์
7. ตรวจ Trigger แบบอ่านอย่างเดียว: ยังมี time-driven trigger **1 รายการ `dailyBackupJob_`** ไม่ติดตั้ง ลบ หรือแก้ Trigger; หน้า Google แสดง Version 99, เรียกใช้ล่าสุด 18 ต.ค. 22:02:30 และ historical error rate 66.67% ไม่ได้รัน Backup ใหม่ จึงไม่อ้างว่า Backup ผ่านจาก Deploy ครั้งนี้

## Production smoke แบบอ่านอย่างเดียว

- เปิด URL โดยไม่มี token: หน้า Login แสดงตามปกติ ไม่มี ReferenceError ที่หน้าเริ่มต้น
- ใช้ Session Admin ที่เปิดอยู่ในแท็บทดสอบใหม่ ไม่ reload หรือแก้ร่างในแท็บเดิม
- Dashboard โหลดสำเร็จ: KPI 4 การ์ด, Stock Health 10 คอลัมน์, skeleton ถูกแทนด้วยข้อมูลจริง
- Dashboard เปลี่ยนจากหน้า 1 เป็น **2 / 8** ได้ แสดง **51–100 จาก 392 รายการ** ในเกณฑ์ที่เลือก ยอดรวมยังเป็นของผลลัพธ์ครบชุด
- Products เปิดสำเร็จและกรอบเปิดเมนูหายไป แสดง **50 แถว**; เปลี่ยนเป็น **หน้า 2** แล้วข้อมูลแถวแรกเปลี่ยนตามหน้า
- สลับกลับ Dashboard แล้วกลับ Products: ยังคง **หน้า 2**, 50 แถว และสถานะไม่ค้างโหลด
- ไม่พบ error logs ในแท็บทดสอบ ณ การตรวจ ไม่ได้ยืนยันทุก Browser/role หรือวัด latency แบบตัวแทนผู้ใช้จริง
- ปิดเฉพาะแท็บที่สร้างเพื่อ Deploy/ทดสอบ คงแท็บและร่างเดิมของผู้ใช้

ก่อน Deploy ผ่าน **222/222 tests**, **121/121 browser groups**, syntax **70 scripts/manifest**, read model และ diff check การตรวจหลัง Deploy มี normal application reads; ไม่สร้าง/แก้/ลบ business data, ไม่ขาย/ตัดสต๊อก/รับสินค้า/บันทึกฟอร์ม/Restore/รัน Backup และไม่เปลี่ยน schema/index/Rules/IAM

## สิ่งที่เปิดใช้และข้อจำกัด

- [โหลดสินค้าแยกจาก edit dropdowns, read deadline/retry, sequence fences, draft recovery และ Dashboard skeleton/pagination](DATA-LOADING-DASHBOARD-2026-10-19.md)
- [สถานะเปิดเมนู/ลองใหม่และ iframe readiness ที่ตรวจ source/origin/channel](MENU-FRAME-RECOVERY-2026-10-19.md)

Read deadline 45 วินาทีเป็นขอบเขตรอของ browser ไม่ได้ยกเลิก GAS execution และไม่ retry อัตโนมัติ ไม่ใช้ deadline นี้กับ writes การค้นหา/XLFilter/Export และสูตรธุรกิจใช้ชุดเดิม Cold Dashboard/POS และการกรองซับซ้อนยังมีต้นทุนโหลด catalog; ไม่มีเปอร์เซ็นต์ลด billed Reads หรือความเร็วทั้งระบบที่วัดจริงจาก Deploy นี้

ผู้ใช้ที่เปิดเว็บค้างควร Reload หนึ่งครั้งเพื่อรับ client รุ่นใหม่ โดยจัดการร่างที่ยังไม่บันทึกก่อน Rollback ใช้ Version 98 หลังได้รับอนุมัติ โดยไม่ต้องย้อนข้อมูล DB

หลักฐาน local (ไม่ commit): `test-results/deploy-ddf38ad-2026-10-19/` มี Source ก่อนแก้/saved Head/Version 99, checksum reports, deployment success, Login และผลตรวจ Dashboard/Products/pagination โดยไม่เก็บ URL ที่มี session token ในรายงานนี้
