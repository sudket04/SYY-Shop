# รายงานตรวจสอบโค้ด SYY Shop Control

วันที่ตรวจสอบ: 25 กันยายน 2026  
ขอบเขต: `Code.gs`, `appsscript.json`, ไฟล์ HTML/JavaScript ทั้ง 18 ไฟล์ และเอกสารประกอบใน repository

## บทสรุปสำหรับผู้บริหาร

ระบบมีฟังก์ชันธุรกิจค่อนข้างครบ มีการปรับปรุงเรื่องเลขเอกสารและการตัดสต็อกพร้อมกัน (concurrency) ที่ดี และ UI ใช้ส่วนกลางร่วมกันมากขึ้น อย่างไรก็ตาม **ยังไม่ควรถือว่าพร้อมใช้งานกับข้อมูลจริงที่เข้าถึงจากอินเทอร์เน็ต** จนกว่าจะแก้ช่องทางข้ามสิทธิ์ของ Apps Script ก่อน เพราะฟังก์ชัน server ที่ไม่มี `_` ต่อท้ายสามารถถูกเรียกตรงจาก `google.script.run` ได้ แม้ UI ปกติจะเรียกผ่าน `apiGateway()` แล้วก็ตาม

ลำดับแนะนำคือ (1) ปิดช่องทางข้าม authorization (2) ย้าย token ออกจาก URL และจำกัด iframe (3) ปรับ password hashing/rate limiting (4) เพิ่ม automated tests และ CI แล้วจึงค่อยปรับโครงสร้าง/ประสิทธิภาพ

## วิธีตรวจสอบและข้อจำกัด

- อ่านโค้ดทั้งหมดเชิงสถิติจำนวนประมาณ 17,700 บรรทัด และค้นหา entry point, API call, DOM sink, authentication, Firestore/Drive access, logging และ error handling
- ตรวจ syntax ของ `Code.gs` ด้วย Node.js และตรวจความสอดคล้องระหว่าง `API_REGISTRY` กับ `API_FUNCTIONS`
- ไม่ได้ทดสอบ end-to-end กับ deployment จริง, Firestore, Drive, Gmail หรือบัญชี Google เพราะ repository ไม่มี test harness/emulator และไม่มี deployment credentials
- ข้อค้นพบด้าน security อิงพฤติกรรมของ HTML Service ที่เปิดให้ client เรียกฟังก์ชัน server แบบ global ซึ่งชื่อไม่ลงท้าย `_`; ควรยืนยันอีกครั้งบน staging deployment ก่อนปล่อย production

## จุดแข็ง

### 1. มี authorization matrix และ dispatch แบบ allowlist

`API_REGISTRY` แยกสิทธิ์ `viewer`, `staff`, `admin` ชัดเจน และ `API_FUNCTIONS` ใช้ map ของฟังก์ชันแทน `eval` จึงอ่านง่ายและลดความเสี่ยงจาก dynamic dispatch เมื่อคำขอผ่าน gateway ตามที่ออกแบบไว้

### 2. งานสต็อกออกแบบ concurrency ได้ดี

`issueStock()` รวมรายการสินค้าซ้ำ, ไม่เชื่อราคาจาก client, ตรวจยอดคงเหลือจาก server และใช้ Firestore commit พร้อม `updateTime` precondition/retry ช่วยป้องกัน overselling จากคำขอพร้อมกัน รวมทั้งเขียน stock movement ใน commit เดียวกัน

### 3. เลขเอกสารคำนึงถึงการแข่งขันพร้อมกัน

ใบกำกับภาษีและใบเสนอราคาใช้ counter/reservation แทนการ scan แล้วเลือกเลขถัดไปอย่างเดียว ลดทั้ง Firestore reads และโอกาสได้เลขซ้ำเมื่อมีผู้ใช้งานพร้อมกัน

### 4. มี defense-in-depth หลายส่วน

- ใช้ constant-time comparison สำหรับ password/OTP digest
- มี account lockout, session revocation, password expiry, TOTP และ recovery code
- response หลายหน้าผ่าน helper `esc()` ก่อนประกอบ `innerHTML`
- แยก shared CSS/JavaScript (`Styles.html`, `Shared.html`, `XLFilter.html`) ลดโค้ดซ้ำในหน้าจอ
- มี activity log, stock movement log และ backup ไป Drive

### 5. UX รองรับงานหลังร้านได้ค่อนข้างครบ

มี loading skeleton, empty state, toast/confirmation, keyboard flow สำหรับงานสต็อก, responsive layout, dashboard และหน้าจอ master data/เอกสารธุรกิจครบในแอปเดียว

## ประเด็นที่พบ เรียงตามความสำคัญ

### Critical — ฟังก์ชันเขียนข้อมูลสามารถข้าม `apiGateway()` ได้

ฟังก์ชันสำคัญจำนวนมากเป็น global และไม่มี `_` ต่อท้าย เช่น `saveMasterData`, `deleteFirestoreDocument`, `saveProduct`, `deleteProduct`, `backupNow`, `restoreFromBackup`, `createUserAccount`, `toggleUserStatus` และ `issueStock` ขณะที่การตรวจ token/role มีเฉพาะใน `apiGateway()` เท่านั้น ผู้โจมตีที่เปิดหน้า HTML Service ได้อาจเรียกฟังก์ชันเหล่านี้ตรงด้วย `google.script.run.<function>()` ทำให้ข้าม role check, collection allowlist, username injection และ activity logging ได้ทั้งหมด ยิ่ง deployment ตั้ง `ANYONE_ANONYMOUS` และ execute as owner ผลกระทบอาจเป็นการอ่าน/แก้/ลบข้อมูลด้วยสิทธิ์เจ้าของสคริปต์

**แนวทางแก้:** ให้เหลือ public RPC เพียงชุดเล็ก เช่น `authLogin`, password-reset endpoints และ `apiGateway`; เปลี่ยน implementation ทั้งหมดเป็นชื่อที่ลงท้าย `_` เช่น `saveProduct_()` แล้ว map ภายใน gateway ไปยังฟังก์ชัน private เหล่านั้น ห้ามแก้เพียงฝั่ง client เพราะไม่ใช่ security boundary จากนั้นทำ integration test ว่าการเรียก `google.script.run.saveProduct` และฟังก์ชันเดิมทั้งหมดล้มเหลวจริง

### High — session token อยู่ใน query string และอนุญาต iframe จากทุก origin

หลัง login ระบบส่ง token ผ่าน `?token=...`; token จึงอาจปรากฏใน browser history, URL ที่ผู้ใช้คัดลอก, screenshot, proxy/access log และ referrer บางกรณี ทุกหน้าตั้ง `XFrameOptionsMode.ALLOWALL` ทำให้เว็บภายนอก embed แอปได้และเพิ่มพื้นที่โจมตี clickjacking/token leakage แม้ session อายุไม่เกิน 6 ชั่วโมงก็ตาม

**แนวทางแก้:** หลีกเลี่ยง bearer token ใน URL (ใช้ short-lived one-time code แลก session หรือกลไกที่ไม่อยู่ใน query string), ล้าง URL ด้วย `history.replaceState` ทันทีหลัง bootstrap, ห้ามโหลด third-party asset ก่อนล้าง token และยกเลิก `ALLOWALL` หากไม่มี requirement ที่จำเป็นต้อง embed หากจำเป็นให้วาง reverse proxy/header policy ที่กำหนด `frame-ancestors` เฉพาะ origin

### High — password hashing เร็วเกินไป

รหัสผ่าน hash ด้วย SHA-256 เพียงรอบเดียวร่วมกับ salt แม้ป้องกัน rainbow table ได้ แต่ไม่ต้าน offline brute force เมื่อฐานข้อมูลรั่วได้ดีเท่า password KDF เช่น Argon2id, scrypt หรือ PBKDF2 ที่มี work factor สูง

**แนวทางแก้:** ใช้ identity provider ที่รองรับ MFA และ password storage มาตรฐานเป็นตัวเลือกแรก หากต้องเก็บเองให้ใช้ KDF ที่ผ่านการทบทวน, ใส่ version/parameters ใน record และทำ rehash-on-login เพื่อ migrate บัญชีเดิม อย่าออกแบบ primitive เพิ่มเองใน Apps Script

### High — rate limit และ session/revocation พึ่ง CacheService

failed-attempt update เป็น read-modify-write โดยไม่มี atomic increment หรือ lock คำขอ login พร้อมกันอาจทำให้จำนวนครั้งผิดสูญหาย ส่วน session และ revoked marker อยู่ใน CacheService ซึ่งเป็น cache แบบ best-effort ไม่ใช่ durable session store; eviction ก่อน TTL สามารถ logout ผู้ใช้โดยไม่คาดคิด และ revocation marker ที่หายก่อน session อาจทำให้ session ที่ตั้งใจเพิกถอนกลับมาใช้ได้

**แนวทางแก้:** เก็บ session digest และ revocation/version ใน durable store พร้อม TTL, ผูกทุก session กับ `user.sessionVersion`, เพิ่ม version เมื่อปิดบัญชี/เปลี่ยน role/reset password และใช้ atomic transaction สำหรับ failed attempts/rate limit ทั้งต่อ username และต่อ IP/device เท่าที่ platform รองรับ

### High — `innerHTML` และ inline handler มีพื้นที่ XSS สูง

UI ประกอบ HTML string จำนวนมากจากข้อมูล Firestore และบางส่วนสร้าง inline `onclick`. หลายจุดใช้ `esc()` ถูกต้อง แต่รูปแบบนี้ตรวจครบทุก field ได้ยาก และการพลาดเพียงจุดเดียวทำให้ stored XSS ทำงานใน origin ของแอปได้ โดยเฉพาะข้อมูลชื่อสินค้า ลูกค้า หมายเหตุ URL รูป และข้อความ error จาก server

**แนวทางแก้:** ใช้ `textContent`, `createElement`, property assignment และ `addEventListener` เป็นค่าเริ่มต้น; จำกัด helper ที่คืน trusted HTML; validate URL protocol (`https:` เท่านั้นหรือ allowlist Drive); เพิ่ม lint rule ห้าม `innerHTML` ยกเว้นจุดที่ annotate/review แล้ว และเพิ่ม CSP เท่าที่ Apps Script รองรับ

### Medium — ฟังก์ชัน generic data access เพิ่ม blast radius

`saveMasterData(collectionName, ...)`, `deleteFirestoreDocument(collectionName, ...)`, backup/restore และ raw collection helpers รับชื่อ collection จาก argument การเรียกผ่าน gateway มี allowlist บางส่วน แต่ตัว implementation ไม่มี policy ของตัวเอง และจากช่องโหว่ public RPC ข้างต้นจึงอันตรายมาก แม้ปิด RPC แล้วก็ยังเสี่ยงต่อ programmer error ในอนาคต

**แนวทางแก้:** ทำ repository/service ต่อ aggregate (`ProductRepository`, `InvoiceRepository`) หรืออย่างน้อย validate collection/doc ID ด้วย allowlist ที่ชั้นล่างสุดเสมอ ป้องกัน `/`, `..`, ชื่อ collection ระบบ และจำกัด restore เฉพาะ `BACKUP_COLLECTIONS`

### Medium — backup ไม่เข้ารหัสและ restore ไม่ได้ exposed ผ่าน gateway อย่างสอดคล้อง

backup เก็บ snapshot รวมข้อมูลผู้ใช้ไว้เป็น JSON plain text บน Drive ของผู้ deploy; ผู้ที่เข้าถึง Drive/ไฟล์จะได้ password hash, salt, TOTP encrypted blob และข้อมูลส่วนบุคคล ส่วน `restoreFromBackup` ไม่อยู่ใน `API_REGISTRY` แต่ยังเป็น global RPC ซึ่งสะท้อนว่าการควบคุมสิทธิ์กระจัดกระจาย

**แนวทางแก้:** แยก secrets ออกจาก operational backup, encrypt backup ด้วย key ที่อยู่นอก Drive, จำกัด sharing/audit access, ตรวจ project/schema/signature ก่อน restore และให้ restore ผ่าน admin-only gateway พร้อม confirmation/audit เท่านั้น

### Medium — dashboard โหลดข้อมูลการเคลื่อนไหวทั้งหมดไปคำนวณที่ client

`getDashboardBootstrap()` โหลดสินค้า, PO และ stock movements ทั้งหมด แล้วส่งให้ browser คำนวณ KPI กราฟ และ aging วิธีนี้ง่ายและตอบสนองดีเมื่อข้อมูลน้อย แต่ payload/read/CPU/หน่วยความจำจะโตตามประวัติทั้งหมด และเปิดเผยรายละเอียดมากเกินจำเป็นแก่ role `viewer`

**แนวทางแก้:** aggregate รายวัน/เดือนฝั่ง server, query เฉพาะช่วงเวลา, paginate รายการละเอียด, cache ผลรวม และกำหนด retention/archive ของ movement เก่า

### Medium — validation และ error contract ยังไม่สม่ำเสมอ

บางฟังก์ชันคืน array ว่างเมื่อ backend error ทำให้ UI แยกไม่ออกระหว่าง “ไม่มีข้อมูล” กับ “โหลดล้มเหลว”; หลายจุดคืน Firestore response ดิบแก่ client และบางจุด fallback ต่อหลังอ่านเอกสารเดิมไม่สำเร็จ ซึ่งอาจสร้างเลข/ข้อมูลใหม่แทนการ fail closed การตรวจวันที่, จำนวนเงินสูงสุด, ความยาว string และสถานะ transition ยังไม่รวมศูนย์

**แนวทางแก้:** ใช้ response schema เดียว `{success,data,error:{code,message,traceId}}`, log รายละเอียดเฉพาะ server, validate DTO ทุก endpoint, จำกัดขนาด/precision และทำ state machine ของ PO/quotation ฝั่ง server

### Medium — ไฟล์ใหญ่และ business/UI concerns รวมกันมาก

`Code.gs` เกิน 4,600 บรรทัด, `index.html` และหน้าจอเอกสารบางไฟล์เกิน 1,000 บรรทัด ทำให้ review, ownership, testing และ refactor ยาก ทั้ง Firestore REST mapping, auth, stock, invoicing, backup และ user management อยู่ไฟล์เดียวกัน

**แนวทางแก้:** แยกไฟล์ server เป็น config/firestore/auth/products/stock/documents/backup/audit และแยก component/controller ของแต่ละหน้าจอ โดยยัง deploy เป็น Apps Script project เดียวได้ เพิ่ม JSDoc typedef สำหรับ DTO สำคัญ

### Medium — ไม่มี automated test, lint หรือ CI

repository ไม่มี unit/integration/e2e tests, package configuration หรือ workflow จึงตรวจ regression ของยอดรวม VAT, เลขเอกสาร, role matrix, TOTP, stock concurrency, escaping และ backup restore ไม่ได้อย่างทำซ้ำได้

**แนวทางแก้:** แยก pure functions ให้รันใน Node test runner, mock Apps Script services/Firestore REST, เพิ่ม tests ของ API registry และ validation, ใช้ ESLint/Prettier แบบรองรับ ES ที่ Apps Script ใช้ และมี staging smoke test ผ่าน `clasp`

### Low — configuration/documentation มี drift

README ระบุว่า `StockIssue.html` ยังเรียก backend ตรง แต่โค้ดปัจจุบันไม่พบ `google.script.run` ในไฟล์นั้น ขณะที่ `PROJECT_ID`, ข้อมูลบริษัท และ timezone บางส่วน hard-code ใน source ทำให้ย้าย environment ยากและเสี่ยงแก้ไม่ครบ

**แนวทางแก้:** ย้าย environment config ไป Script Properties, มี config validation ตอน deploy, สร้าง deployment checklist และปรับ README ทุกครั้งที่ behavior/security architecture เปลี่ยน

### Low — accessibility และ maintainability ของ markup

UI ใช้ emoji/icon button และ modal แบบ custom จำนวนมาก ควรตรวจ accessible name, focus trap/restore, keyboard order, color contrast และ reduced motion อย่างเป็นระบบ Inline styles/handlers ที่มีมากทำให้ปรับ theme และ CSP ยาก

## แผนปรับปรุงที่แนะนำ

### ระยะเร่งด่วน (ก่อน production)

1. ทำ server implementation ทุกตัวเป็น private (`_`) และทดสอบว่าเรียกตรงจาก client ไม่ได้
2. ทำ threat-model/penetration smoke test สำหรับ anonymous deployment, RBAC bypass, IDOR, XSS และ backup access
3. เอา token ออกจาก URL, จำกัด framing และทบทวน third-party CDN
4. เปลี่ยน password storage/session/rate limit ให้ใช้มาตรฐานและ durable state
5. จำกัด generic collection APIs และ restore ด้วย allowlist ชั้นล่างสุด

### ระยะสั้น (1–2 sprint)

1. เพิ่ม unit tests สำหรับ totals, document number, role matrix, validation, TOTP และ stock merge
2. เพิ่ม integration tests ของ login → gateway → CRUD และ concurrent stock issue
3. ทำ response/error schema กลางและ server-side DTO validation
4. แก้ XSS sinks โดยเริ่มจากข้อมูลที่ผู้ใช้กรอกและ URL รูป
5. paginate/query dashboard และรายการเอกสารแทนการโหลดทั้งหมด

### ระยะกลาง

1. แยก `Code.gs` และหน้าจอขนาดใหญ่เป็นโมดูล
2. เพิ่ม CI: syntax, lint, unit tests, secret scan และ deployment smoke test
3. วาง retention, encrypted backup, restore drill และ monitoring/alerting
4. เพิ่ม accessibility audit และ performance budget

## เกณฑ์ก่อนอนุมัติขึ้น production

- การเรียก server function ตรงนอก allowlisted RPC ถูกปฏิเสธทั้งหมด
- role ทั้งสามผ่าน negative tests (ไม่ใช่ตรวจเฉพาะ happy path)
- ไม่มี bearer token ใน URL/history/log/referrer หลัง login
- stock issue พร้อมกันไม่ติดลบและไม่สร้าง movement ซ้ำ/หาย
- เลขใบกำกับภาษี/ใบเสนอราคาไม่ซ้ำภายใต้ concurrent requests
- stored XSS payload ในทุก text field แสดงเป็นข้อความ ไม่ execute
- backup ถูกเข้ารหัส, จำกัดสิทธิ์ และ restore บน staging สำเร็จ
- มี test/lint/CI ที่รันซ้ำได้และ deployment rollback procedure

## สรุปคะแนนเชิงคุณภาพ

| ด้าน | ระดับ | หมายเหตุ |
|---|---|---|
| ความครบของฟังก์ชันธุรกิจ | ดี | master data, stock, PO, quotation, tax invoice, users, backup ครบ |
| UX/UI consistency | ดี | shared styles/helpers และสถานะ loading/empty ค่อนข้างสม่ำเสมอ |
| Data consistency | ดีปานกลาง | stock/เลขเอกสารแข็งแรง แต่ validation/error semantics ยังไม่รวมศูนย์ |
| Security | ต้องแก้เร่งด่วน | public server functions ทำให้ gateway ไม่ใช่ security boundary ที่สมบูรณ์ |
| Performance/scalability | ปานกลาง | cache/batch มีแล้ว แต่ยัง fetch-all หลายเส้นทาง |
| Maintainability | ปานกลางถึงต่ำ | ไฟล์ใหญ่มาก, ไม่มี type/test/lint/CI |
| Operability | ปานกลาง | มี backup/log แต่ยังขาด monitoring, encrypted backup และ restore drill |

ภาพรวม: **ฐานระบบและความเข้าใจ workflow ธุรกิจดี แต่ security boundary และ engineering safety net ต้องได้รับการแก้ไขก่อนขยายการใช้งานหรือรับข้อมูลจริงในวงกว้าง**
