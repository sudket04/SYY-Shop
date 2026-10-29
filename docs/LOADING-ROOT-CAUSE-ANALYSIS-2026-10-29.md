# วิเคราะห์หน้าเปิดไม่สำเร็จและความเร็ว — 29 ตุลาคม 2569

## ขอบเขตและสถานะ

ตรวจตามภาพ “ยังเปิดหน้าไม่สำเร็จ” และคำขอวิเคราะห์แนวทางแก้ให้ถูกต้อง พร้อมกลยุทธ์ Cache ที่ผู้ใช้เพิ่มเติม ใช้ Source `30019679741bb66cc9e665fd0cf91460f3e016d6` บน main; fetch origin/main แล้วตรงกัน Runtime ที่รายงานว่าเผยแพร่คือ `c3dc752` / Version103 ตามรายงาน Deployment ก่อนหน้า ไม่ได้อ่าน immutable source ซ้ำในรอบนี้

**รอบนี้วิเคราะห์เท่านั้น ไม่แก้ runtime ไม่ Sync/Deploy ไม่ส่ง Login ไม่เขียน/แก้/ลบ Production DB ไม่รัน Backup/Restore ไม่เปลี่ยน Trigger/สิทธิ์/index/schema** เปิด Editor/Executions และหน้า Login จริงแบบไม่มี token เท่านั้น ไม่มี authenticated session ให้ตรวจเมนูที่เกิดเหตุ จึงยังระบุสาเหตุสุดท้ายของเครื่องผู้ใช้ไม่ได้

## 1. ข้อสรุปที่มีหลักฐาน

### A. ภาพเป็น timeout ของตัวเปิดหน้า ไม่ใช่ข้อความผิดพลาดจาก query

`index.html:754` ฟังก์ชัน `syyOpenFrame()` ทำให้ iframe มี class `syy-frame-pending` ซึ่ง CSS บรรทัด51 กำหนด `visibility:hidden` แล้วรอสัญญาณ PAGE_READY หรือ readiness ของหน้านั้น หากรอ30วินาทียังไม่ได้ จะขึ้นข้อความตรงกับภาพ หรือขึ้นข้อความเดียวกันเมื่อเกิด iframe error ก่อนครบเวลา

`UiSystem.html` ประกาศว่า readiness หมายถึง UI ไม่ใช่ผล authentication/data read; `Shared.html:57` ตรวจ channel/origin/source ก่อนรับ ส่วน data RPC มี deadline45วินาทีใน `syyCallApiRaw()` ซึ่งแยกจาก30วินาทีของ shell

ดังนั้นอาการในภาพระบุว่า **shell ยังไม่ได้ยอมรับ readiness** อาจเกิดจาก route/redirect/session, script/dependency ติดขัด, สัญญาณไม่ถึงหรือถูกปฏิเสธ หรือหน้าไม่โหลดจริง แม้ backend บางคำขอทำงานเสร็จแล้วก็ยังเห็นหน้าถูกซ่อนอยู่ได้ ต้องพิสูจน์ chain นี้ก่อนสรุปว่า Firestore เป็นต้นเหตุ การเพิ่ม cache หรือเพิ่ม timeout อย่างเดียวไม่แก้เหตุที่ readiness ไม่ถึง

### B. Backend มีคำขอช้าจริง

อ่านแถวที่แสดงใน Apps Script Executions และเก็บหลักฐานเวลา **29ต.ค.2026 22:07:16 Asia/Bangkok** เลือกเฉพาะรายการสถานะเสร็จสมบูรณ์:

| ฟังก์ชัน | จำนวน | ต่ำสุด | p50 | p95 | สูงสุด | เกิน10วินาที |
|---|---:|---:|---:|---:|---:|---:|
| doGet | 32 | 0.902s | 1.550s | 3.594s | 17.346s | 1 |
| apiGateway | 14 | 1.053s | 3.301s | 23.800s | 23.800s | 3 |
| authLogin | 3 | 4.755s | 5.409s | 5.488s | 5.488s | 0 |

apiGateway ที่ช้า3ครั้งคือ13.580s,15.733s,23.800s นี่เป็นตัวอย่างแถวล่าสุดที่ UI แสดง ไม่ใช่การสุ่มวัดทุกหน้า ไม่รู้ operation ภายในแต่ละ apiGateway และไม่ใช่ click-to-usable-data รวม network/Google wrapper/CDN/การ render มีรายการจากการตรวจ Login ก่อนหน้าและรายการของผู้ใช้อยู่ร่วมกัน จึงห้ามใช้ p95 ชุดนี้รับรอง SLA หรือหักลบเวลาเพื่ออ้างเปอร์เซ็นต์ที่ดีขึ้น

สถานะ Executions “เสร็จสมบูรณ์” ไม่เท่ากับ UI ได้ข้อมูล เพราะ `apiGateway` จับ exception แล้วคืน `{success:false}` และคืน `__authError` ได้โดย execution ไม่ล้ม ขยายตัวอย่างAPIเวลา21:54:40แล้ว UI แจ้งว่าไม่มี Cloud logs ที่พร้อมใช้งาน จึงยังแยกauth/query/cache/payloadของคำขอนั้นไม่ได้

### C. จำลองจาก Source พบจุดเสี่ยง3กรณี

ใช้ VM และ services ในหน่วยความจำทั้งหมด ไม่มี Production network/DB writes:

1. **Transient auth backend error ถูกแปลเป็น session หมดอายุ** — สร้าง session จำลองที่ใช้ได้ แล้วให้การอ่าน Master_Users ตอบHTTP503; `getSession_()` ที่ `Code.gs:3732` จับ exception แล้วคืนnull และ gatewayคืน `__authError:true` เหมือนtokenใช้ไม่ได้ ต้องแยก invalid/revoked/expired ออกจากระบบตรวจบัญชีไม่พร้อม โดยยังปิดสิทธิ์เข้าถึงข้อมูลระหว่างตรวจไม่ได้
2. **Global lock contention ถูกแปลเป็นเรียกข้อมูลถี่เกินไป** — ให้ScriptLockไม่ว่าง แล้วเรียก `allowReadRequest_('getProductCatalogPage',...)` เป็นครั้งแรก; ถูกปฏิเสธทั้งที่ยังไม่มีrate counterเลย (`Code.gs:4286`) read limiterและcache leaseใช้ScriptLockเดียวกับบางwrite path จึงมีความเสี่ยง read ถูกปฏิเสธเมื่อมีงานบันทึกยาว ต้องแยกเหตุbusy/rate-limitและรักษาcost protection ไม่ปล่อยผ่านแบบไม่จำกัดหรือปลดlockของธุรกรรมสต๊อก
3. **Readiness ข้ามGoogle wrappersพึ่งข้อมูลancestor origins** — จำลองcross-origin wrapperระหว่างchildกับshell แล้วเอา `location.ancestorOrigins` ออก: UiSystemส่งPAGE_READYถึงwrapperชั้นแรกผ่านreferrer แต่ไม่ถึงshell; เมื่อมีancestor originsจึงส่งถึง เป็นเงื่อนไขที่จำลองได้ ไม่ใช่ข้อยืนยันว่าChromeของผู้ใช้ไม่มีpropertyนี้หรือเป็นเหตุของภาพล่าสุด Sharedใช้แนวทางส่งoriginคล้ายกัน

สามกรณีเป็นข้อบกพร่อง/ข้อจำกัดที่พิสูจน์จากSourceได้ แต่ยังไม่ผูกกับเหตุการณ์ผู้ใช้โดยตรง และไม่ได้พบข้อมูลDBเสียหายจากการตรวจนี้

## 2. คอขวดที่ยังมีในSource

| ส่วน | สภาพปัจจุบัน | ผลและแนวทาง |
|---|---|---|
| การเปิดเมนู | shellเปิด `/exec` อีกครั้งในiframe; Googleเพิ่มwrapperและauth/renderก่อนchildเริ่มRPC | แยกเวลาเปิดroute/UI-ready/data-ready; แก้handshakeก่อน ไม่ใช้iframe load eventอ้างว่าauth/dataผ่าน |
| External dependencies | หลายหน้าโหลดSweetAlertแบบparser-blockingในhead และStylesมีfont @import | มีโอกาสชะลอUI-ready แม้DBตอบเร็ว; ให้bootstrap/skeletonเริ่มโดยไม่รอCDN และโหลดส่วนเสริมแบบมีfallback โดยรักษาdialogsเดิม ยังไม่มีหลักฐานว่าCDNล้มบนเครื่องผู้ใช้ |
| สินค้าแบบไม่กรอง | ใช้cursor browse, projection และ100แถวแล้ว | คงfast pathนี้ ไม่ย้อนกลับไปโหลด10,000รายการ และไม่เสนอเป็นงานใหม่ที่ยังไม่มี |
| ค้นหา/XLFilter/sortที่ซับซ้อน | `getProductCatalogRows_()` ยังต้องมีcatalogครบเพื่อคงsubstringและglobal semantics | Cold cacheยังอ่านcatalogครบได้; cacheช่วยwarm แต่ไม่ทำให้coldอ่านครบหายไป ห้ามเปลี่ยนเป็นค้นเฉพาะ100แถวเพื่อให้ดูเร็ว |
| Dashboard | `queryDashboardMovementsRange_()` ดึงmovementsครบช่วงโดยไม่มีlimit แล้วประกอบcatalogและPOข้อมูลที่เกี่ยวข้อง | ข้อมูลมากทำcold load/payloadหนัก; ควรแยกKPI/รายการสำคัญจากกราฟและdrilldown และพิจารณาsummaryแบบมีwatermarkเมื่อวัดแล้วจำเป็น |
| รูปสินค้า | หลังวาด100แถวเตรียมmetadataรูป100รายการเป็นbatch | ไม่ใช่สาเหตุของshell30sโดยตรง แต่แย่งงานหลังตารางและเพิ่มReadsหากไม่เปิดรูป; จัดpriorityหลังdata-ready และประเมินprefetchตามความจำเป็น คงเปิดรายละเอียดโดยไม่รอรูป |
| Auth | ทุกdoGet/RPCที่มีtokenอ่านuserเพื่อตรวจสิทธิ์จริง และ sessionอยู่ในCacheService | ห้ามตัดการตรวจrevocationเพื่อแลกความเร็ว; ลดRPCซ้ำ/รวมsectionก่อน เพิ่มการแยกinfra error และวัดauthMs CacheServiceไม่ใช่ที่เก็บsessionถาวร |
| Cache lease | มีsingle producerและbounded waitแล้ว | ห้ามเพิ่มfull scan producerทุกครั้งที่รอไม่สำเร็จ; ดูbusy/lease/backoffและexpiryตามหลักฐาน |
| Metrics | มีRPC timing20samples/APIและproduct view timingแล้ว | ยังไม่ครอบคลุมคลิกเมนู→route→UI-ready→first data→renderครบทุกหน้า และerrorบางทางไม่มีรายละเอียดphase |

## 3. ลำดับแก้ที่แนะนำ

### ระยะ1 — แก้การเปิดหน้าและทำให้วัดสาเหตุได้

1. เก็บtraceแบบไม่เปิดเผยข้อมูลต่อการเปิดเมนู: release/route/request generation, navigation start, UI-ready, first data-ready, final/error; แยกorigin/source/channel validationเป็นสถานะboolean ไม่เก็บtoken, URL query, credentials,ข้อมูลลูกค้าหรือรายการขาย
2. ทำready/ack protocolที่รองรับGoogle wrapperจริง เริ่มจากbootstrapที่ไม่รอlibraryภายนอก มีbounded handshake retryที่ไม่ยิงbusiness queryซ้ำ รับเฉพาะorigin/channel/windowที่ตรวจแล้ว; ห้ามใช้`postMessage('*')`/ข้ามpermission หรือเอาload eventปลดหน้าที่ตรวจไม่ได้
3. แสดงสถานะเฉพาะเหตุ: เปิดหน้าไม่ได้,ตรวจบัญชีไม่สำเร็จชั่วคราว,sessionใช้ไม่ได้,rate-limited,busy,queryล้มเหลว พร้อมretryเฉพาะส่วน ไม่reloadทุกเมนูและไม่ทำให้ร่าง/filter/pageหาย การกลับLoginระดับบนใช้ลิงก์/ปุ่มจากuser gestureตามข้อจำกัดGoogle
4. ย้ายdependencyที่ไม่จำเป็นต่อการวาดตารางออกจากเส้นทางแรก พร้อมfallbackและทดสอบCDNช้า/ล่ม คงfontสำรองอ่านได้ ไม่ติดตั้งframeworkใหม่
5. แยกauth failureประเภทที่กล่าวข้างต้น; ยังต้องตรวจสิทธิ์สำเร็จก่อนคืนbusiness data ไม่แสดงIndexedDB dataของsessionที่ยังไม่ตรวจเมื่อเปิดใหม่
6. แยกglobal-lock busyออกจากrate-limitจริง รักษาanti-abuse; ถ้าจะretryใช้เฉพาะreadแบบจำกัดจำนวนและตามretryAfter ไม่มีpolling/background reloadหรือautomatic write retry

### ระยะ2 — ลดงานที่ต้องรอก่อนผู้ใช้เริ่มทำงาน

1. หน้าlistใช้RPCหลักเท่าที่จำเป็น มีfield projection/cursor; master dropdowns/modal/image metadataโหลดเมื่อใช้หรือเป็นงานpriorityต่ำ คง100สินค้า/หน้า
2. แยกDashboardแสดงส่วนที่พร้อมทีละส่วน พร้อมas-of/watermarkที่บอกความครบและป้องกันสรุปยอดจากข้อมูลบางส่วนเป็นยอดจริง กราฟ/drilldownไม่ควรขวางรายการหลัก
3. รวมคำขอที่เหมือนกันผ่านin-flight coalescingที่มีอยู่ ลดการตรวจเวอร์ชันหลายครั้งสำหรับresponseเดียว และใช้execution-local memoกับข้อมูลอ้างอิงที่versionเดียวกัน ต้องวัดก่อนเพิ่มcache layerใหม่
4. คุมbackgroundreadให้อยู่ต่ำกว่าเพดานRPC และให้หน้าที่ผู้ใช้กำลังเปิดได้priorityก่อน เช่นเริ่มทดสอบqueue2–4งาน ไม่เปิดprefetchทุกเมนู ไม่cancelwriteที่อาจcommitแล้ว และไม่ถือว่าbrowserยกเลิกcallbackเท่ากับserverหยุดทำงาน
5. ค้นหา/XLFilterยังค้นครบชุดแบบเดิม: warmใช้catalog/facetcache; coldแยกสถานะเตรียมcatalogจากbrowseทั่วไป ไม่ลักลดผลค้นหาหรือผลรวม

### ระยะ3 — ใช้เมื่อวัดแล้วcold pathยังไม่ผ่านเป้า

Review durable read snapshot/summary แบบversioned generation,manifest,watermark,checksumและrebuild single producer แยกตามcatalog/period ครอบคลุมstock correction,price/master changes,restoreและcache failure ไม่full rebuildทุกmutation และไม่ย้ายไปDirect Firebase SDKเพียงเพื่อหลบปัญหาiframe

ระยะนี้อาจเพิ่มstorage/job/triggerหรือsummary writes และต้องมีdesign review/ขอบเขตอนุมัติแยกก่อนทำของจริง ไม่รวมอยู่ในแพตช์อ่านอย่างเดียว และยังไม่สร้างindexใหม่โดยไม่มีquery evidence

## 4. กลยุทธ์Cacheที่เหมาะกับระบบนี้

ระบบมีCacheService,client memory,IndexedDB,generation invalidation,request coalescingและconditional validationอยู่แล้ว ต้องปรับเฉพาะช่องว่าง ไม่สร้างระบบซ้อนอีกชุด

| ข้อมูล | วิธีเก็บ/เรียก | การอัปเดตและข้อจำกัด |
|---|---|---|
| แบรนด์/รุ่นรถ/หมวด/โซน | Server cache+memory/IndexedDBที่allowlistเฉพาะfield | เวอร์ชันตามscope;คืนcacheที่ยังผ่านการตรวจตามpolicyเดิม มีmax-ageเผื่อการแก้นอกapp ไม่ดึงDBใหม่ทุกเปิดdropdown |
| หน้าสินค้า/ค้นหา/facets | Keyรวมaccount/role/app,criteria,sort,page/cursor,generation;เก็บเฉพาะส่วนที่เคยใช้และboundedcatalogที่อนุญาต | คงsearchครบทั้งชุด;cacheที่page2ไม่กลายเป็นpage1;ไม่ทำให้stock/statusข้ามgeneration |
| ราคา/จำนวนคงเหลือ | ใช้cacheเร่งการแสดงผลตามpolicyอายุสั้นและยืนยันversion | หลังcommitใช้เฉพาะdeltaจากserverและinvalidateส่วนที่เกี่ยวข้อง;ก่อนขาย/แก้/ยกเลิกยังอ่านstock/revisionจริงและใช้atomic preconditions/idempotencyเดิม |
| Dashboard/ธุรกรรม | memoryหรือserver cacheตามscope/ช่วงข้อมูล ไม่persistธุรกรรม/ข้อมูลลูกค้าโดยเพิ่มallowlistเอง | invalidateหลังcommit;แสดงas-of/ข้อมูลเปลี่ยนอย่างตรงไปตรงมา ไม่อ้างcacheเก่าว่าเป็นยอดสด |
| รูป | metadata cacheแบบboundedแยกจากpixel;รูปจริงให้browser HTTP cacheทำงาน | หลังแก้รูปinvalidateProduct_Images+IDที่เกี่ยวข้อง;ไม่ดึงรูป10,000รายการมารอพร้อมตาราง |
| สิทธิ์/session | แยกจากbusiness cache ไม่เก็บcredential/tokenเพิ่มในIndexedDB/localStorage | เปิดหน้าใหม่หรืออ่านpersistedcacheต้องตรวจsession/roleกับserverก่อน คงrevocationทันที ไม่ขยายเวลาเพื่อซ่อนปัญหา |

เมื่อบันทึกสำเร็จ ให้commitฐานข้อมูลก่อน จากนั้นpatchข้อมูลที่serverยืนยันและเลื่อนgenerationเฉพาะscope/SKUที่กระทบ แจ้งloaded frames/แท็บให้invalidateหรือmark dirtyตามpolicyเดิม หน้าที่ซ่อนอยู่ไม่ต้องqueryทันทีและไม่refreshจนเสียร่าง เมื่อผู้ใช้กลับมาใช้หรือกดrefreshค่อยvalidate/fetchส่วนที่จำเป็น การเขียนจากเครื่องมืออื่นยังต้องมีmax-ageหรือinvalidationที่ผูกกับผู้เขียนนั้น จึงไม่สามารถพึ่ง“เมื่อข้อมูลใหม่ค่อยล้าง”อย่างเดียวได้

## 5. ผลที่คาดหวังและสิ่งที่ยังรับรองไม่ได้

- Handshake/error classificationแก้ความล้มเหลวและทำให้กู้คืนได้;ไม่ได้ลดdocument readsของqueryเอง
- Warm cache/coalescingลดคำขอbusinessdataซ้ำได้ แต่RPCที่ต้องตรวจสิทธิ์ยังอาจมีuser read;cache1ครั้งไม่เท่ากับ1billable read
- Deferredmetadata/dropdownsลดReadsของส่วนที่ไม่เปิดใช้;ถ้าเปิดครบภายหลังReadsอาจเท่าเดิม การprefetch100รูปมีต้นทุนตั้งแต่แรกอยู่แล้ว
- Cursor/projectionช่วยpayloadและbounded reads;projectionเพียงอย่างเดียวไม่ลดจำนวนdocument reads SearchครบชุดและcoldDashboardยังต้องดูcostแยก
- Snapshot/summaryอาจลดcoldReadsและเวลาได้มาก แต่เพิ่มความซับซ้อนและอาจเพิ่มwrites/rebuildcost ต้องวัดขนาด/ความถี่ก่อน
- **ยังไม่มีหลักฐานรองรับเปอร์เซ็นต์ลดReads/เวลาโหลดทั้งProduction** และไม่รับรองทุกหน้าสำเร็จไม่เกิน10วินาทีจากunit testsหรือExecutionsชุดนี้

เป้าหมายที่เสนอ: แสดงshell/skeletonทันทีที่HTMLพร้อม;เมนูที่เปิดแล้วและcacheผ่านpolicyแสดงผลใกล้ทันที;first usable dataของหน้ารายการตั้งเป้าp95ไม่เกิน10วินาที โดยนับตั้งแต่คลิก ไม่ใช่เริ่มนับตอนRPCเริ่ม กราฟ/drilldownระบุbudgetแยก ห้ามอ้างtimeout/errorเป็นsuccessเพื่อให้ผ่านเป้า GAS/networkมีtail latencyจึงต้องมีerror recoveryแม้ได้p95ตามเป้าแล้ว

## 6. การตรวจรับก่อนสรุปว่าปัญหาจบ

- ทดสอบเมนูจริงด้วยsessionที่Loginแล้วบนURL/Versionที่ยืนยัน:Admin/Staff/Viewer,cold/warm,กลับเมนูเดิม,หลายเมนูต่อกัน,2แท็บและcacheหมดอายุ
- วัดอย่างน้อย20รอบต่อcritical scenarioเมื่อทำได้ รายงานจำนวนตัวอย่าง,p50,p95,max,success/error rateและcache source;หลีกเลี่ยงload testProductionหลายผู้ใช้โดยไม่มีขอบเขตอนุมัติ
- จำลองCDNช้า/ล่ม,readinessช้า/หาย,wrapperหลายชั้น,origin/channelปลอม,infra503,lockbusy,revokedsessionและIndexedDBblockedในเครื่อง
- 10,000สินค้า:100แถวแรก,next/previousไม่เด้ง,ค้นสินค้าท้ายชุด,XLFilterครบ,Exportไม่ตกหล่น,modal/draft/รูปปิดได้และไม่รอbackgroundที่ไม่จำเป็น
- คงatomicstock/CAS/revision/requestID/unknown-result recoveryเดิม ทดสอบwritepathเฉพาะfixtureหรือenvironmentที่อนุมัติ ไม่สร้างบิลจริงเพื่อทดสอบรอบนี้
- ตรวจSavedHeadและimmutableversionหลังDeployทุกครั้ง แล้วทดสอบauthenticatedread-onlyแยกจากLogin smoke;การเปิดLoginสำเร็จอย่างเดียวไม่พอรับรองเมนู

## 7. สิ่งที่ทำแล้วในรอบวิเคราะห์

- Fetchแล้วmainตรงorigin/main;ไม่แตะuntrackedเดิม `docs/SYSTEM-AUDIT-2026-10-11.md`
- อ่านSourceและExecutionsจริง;หน้าLoginเปิดได้ ไม่มีconsole errorที่ตรวจพบ แต่ยังไม่มีauthenticatedmenuUAT
- Targetedregression: **53/53ผ่าน** — frame lifecycle,clientcache,catalog-scale;ทดสอบในเครื่องไม่ได้พิสูจน์Googlewrapperจริงทุกแบบ
- Diagnosticreproductions3กรณีข้างต้นผ่านassertion โดยไม่มีProductioncalls/writesในตัวจำลอง
- เก็บหลักฐานใน `test-results/loading-analysis-2026-10-29/`:executions.json,timing-summary.json,local-tests.log,diagnostics.cjs,diagnostics.json (ignoredไม่commit)
- Files Changedรอบนี้:เอกสารฉบับนี้เท่านั้น ไม่มีruntimecodechanges;Deploymentยังเป็นVersion103ตามสถานะก่อนตรวจ

## เอกสารทางการที่ตรวจประกอบ

- [HTML Service best practices](https://developers.google.com/apps-script/guides/html/best-practices):แนะนำแยกโหลดข้อมูลasyncและให้HTMLแสดงก่อนJavaScriptที่ไม่จำเป็น
- [IFRAME restrictions](https://developers.google.com/apps-script/guides/html/restrictions):topnavigationมีข้อจำกัดและควรให้userกดlink/button
- [google.script.run communication](https://developers.google.com/apps-script/guides/html/communication):asyncและเพดาน10concurrentcalls เกินแล้วรอคิว
- [CacheService Cache](https://developers.google.com/apps-script/reference/cache/cache):expirationเป็นเพดานที่ร้องขอและอาจถูกevictก่อน;ต่อkey100KBและมีitemcap จึงไม่ควรเพิ่มcacheไม่จำกัดหรือถือว่าTTLรับประกันข้อมูลยังอยู่
- [Firestore query cursors](https://firebase.google.com/docs/firestore/query-data/query-cursors):แบ่งหน้าด้วยcursor ใช้กับbrowsefastpathที่มีอยู่และตรวจความหมายค้นหาแยก
