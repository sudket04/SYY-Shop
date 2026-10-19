# ตรวจและแก้หน้าว่างหลังคลิกเมนู — 19 ตุลาคม 2569

## ขอบเขตและหลักฐาน

Source เริ่มต้น `f591482` / Runtime Production ล่าสุดที่ยืนยัน Version 98 (`cfafa3e`) ผู้ใช้รายงานซ้ำว่าคลิกเมนูแล้วไม่มีข้อมูลแสดง

จุดบกพร่องที่ตรวจพบใน Source และจำลองได้:

- `switchPage` เปลี่ยนเมนูแล้วเปิด iframe โดยไม่มีสถานะรอ ไม่มี timeout และไม่มีทางลองเปิดใหม่ เมื่อหน้า /exec หรือ HtmlService wrapper ค้าง ผู้ใช้จึงเห็นพื้นที่ว่าง
- Shell ส่ง `PAGE_ACTIVATED` ก่อนทราบหน้าต่าง/Origin ของ child จริง โดยถือ URL `/exec` เป็นปลายทาง ทั้งที่หน้ารับข้อความอยู่ใน Googleusercontent ภายใน wrapper ของ Google
- Child ส่งข้อความไปทุก ancestor ด้วยหลาย Origin ที่เดาไว้ ทำให้เกิด target-origin mismatch ในโครงสร้างกรอบซ้อน
- Profile ไม่มี frame channel และ Manage Users ไม่ใช้ Shared/freshness registration จึงต้องรองรับ readiness แยกจาก business-data freshness ก่อนใช้สถานะโหลดร่วมทุกเมนู

วันที่ 17 ตุลาคมเคยตรวจหลัง Login จริงพบ Stock Issue, Products และ Brands แสดงข้อมูลได้ และผู้ใช้แจ้งภายหลังว่าใช้ URL ผิด จึงนำแพตช์ทดลองวันนั้นออก วันที่ 19 ตุลาคมหลังผู้ใช้ Login ใน Browser ของ Codex ตรวจ Production Version 98 ด้วยบัญชี Admin พบ Products แสดงหน้าแรก 50 รายการ; เปิด Stock Issue ใหม่ ตรวจที่ประมาณ 3.2 วินาทียังไม่มี UI ของ child และตรวจอีกครั้งที่ประมาณ 9.2 วินาทีพบ 943 รายการแล้ว เป็นหลักฐานของช่วงหน้าว่างระหว่างโหลด ไม่ใช่การวัดเวลาเสร็จครั้งแรกอย่างแม่นยำ และ **ยังไม่ยืนยันสาเหตุของการโหลดล้มเหลวถาวรในทุกบัญชี/Browser**

## การแก้ไข

1. แสดงสถานะกำลังเปิดหน้าแทนกรอบว่าง จน child ส่ง readiness ที่ผ่านการตรวจ channel, source, origin และ allowed action
2. หากยังไม่พร้อมหลัง 30 วินาที หรือ iframe แจ้ง load error แสดงปุ่ม “ลองเปิดหน้านี้อีกครั้ง” ไม่มี auto-retry, polling หรือ business-data RPC จาก timer
3. การลองใหม่สร้าง channel ใหม่ ล้าง receiver เดิม และ reset ready flags เฉพาะหน้านั้น ป้องกันข้อความที่มาจากโหลดครั้งก่อนและรักษา pending handoff เดิม
4. ส่งข้อความจาก shell เฉพาะ receiver/origin ที่ตรวจรับแล้ว; ส่งจาก child ไปยัง ancestor ตาม Origin จริงผ่าน same-origin access, ancestorOrigins หรือ direct referrer ที่ตรวจ allowlist ไม่ใช้ wildcard
5. ย้าย PAGE_READY ไปยัง UiSystem ซึ่งทุกหน้ามีอยู่แล้ว ให้หน้า Profile มี channel และให้ Manage Users ส่ง readiness ได้โดยไม่ต้องนำ business cache/RPC helpers เข้าไป
6. เมื่อหน้าเปิดสำเร็จแล้ว การสลับกลับใช้ iframe เดิม ไม่โหลดข้อมูลซ้ำ

## Files Changed

- `index.html`: สถานะเปิดหน้า timeout ปุ่มลองใหม่ และ completion จาก trusted child
- `Shared.html`: สื่อสารกับกรอบที่ยืนยันแล้วและใช้ Origin จริง
- `UiSystem.html`: readiness สำหรับทุกหน้ารวมหน้าไม่ใช้ Shared
- `Profile.html`: frame-channel meta เท่านั้น
- `tests/client-cache.test.cjs`, `tests/browser.cjs`: regression ของ origin routing, loading/timeout/retry/stale channel และ Profile/Manage Users

## Firestore / Security / UX

ไม่เปลี่ยน Code.gs, business query, cache TTL, role policy, ข้อมูล Production, schema/index/Rules/IAM หรือ Trigger ไม่มี timer ที่อ่าน DB เพิ่ม การกดลองใหม่โดยผู้ใช้อาจทำให้หน้าโหลดข้อมูลอีกครั้งตามเส้นทางปกติซึ่งยังตรวจ session และ authorization บน server

คำว่า “หน้าเปิดสำเร็จ” หมายถึง UI โหลดพร้อมแล้ว ไม่ใช่การรับรองว่า business-data RPC ทุกคำขอสำเร็จ; errors และป้าย freshness ภายในหน้ายังทำงานตามเดิม สถานะนี้ไม่แก้สิทธิ์ Google, network outage หรือการใช้ Deployment URL อื่นแทนผู้ใช้

## สถานะส่งมอบ

ผลทดสอบ local: **221/221 tests**, **114/114 Browser regression groups**, syntax **70 scripts/manifest** และ `git diff --check` ผ่าน รวมการส่งต่อ Quote → Stock/Product/Invoice, ข้อความปลอม, Viewer desktop/mobile, Cache และการสลับหน้าซ้ำ หลักฐาน: `test-results/menu-blank-2026-10-19-{unit,full-browser}.log`; ภาพตรวจ Production ก่อนแก้ใน `test-results/menu-blank-2026-10-19/`

ยังไม่ Sync Apps Script หรือ Deploy ในงานนี้ ต้องอนุมัติ Production แยกตาม Master Instructions §10 Step 5 และตรวจ authenticated UAT ของแพตช์หลัง Deploy; Runtime ปัจจุบันยังเป็น Version 98
