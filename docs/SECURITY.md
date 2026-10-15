# Security model

## Status

ค่าเริ่มต้นของระบบเป็น **experimental DEMO สำหรับข้อมูลสังเคราะห์เท่านั้น** ระบบรองรับ `APP_MODE=PILOT` แบบ fail-closed เพื่อเชื่อมข้อมูลจริงเมื่อการตั้งค่าครบ โดยโหมดนี้ไม่ใช่การรับรองทางกฎหมายหรือการอนุมัติ go-live

`PILOT` เลือกวิธีเข้าสู่ระบบได้หนึ่งแบบ (ตั้งค่าที่ Worker และ GAS ให้ตรงกัน):

- **รหัสผ่าน + TOTP** (`PASSWORD_AUTH_ENABLED=true` ทั้ง Worker var และ Script Property) สำหรับหน่วยงานที่ไม่มี Google Workspace — ใช้กับการติดตั้งปัจจุบัน ทุกบทบาทรวมถึง CG ต้องผ่าน TOTP; ผู้ใช้ที่ยังไม่มี TOTP จะผูกแอปเองหลังกรอกรหัสผ่านถูก (secret ใหม่อยู่ใน KV แบบเข้ารหัส 10 นาที บันทึกลง D1 เมื่อกรอกรหัสจากแอปถูกเท่านั้น ผิด 5 ครั้งต้องเริ่มใหม่ และจะไม่ทับ TOTP ที่มีอยู่) ผู้มีสิทธิ์ `users:manage` รีเซ็ต TOTP ของผู้อื่นได้ ซึ่งตัด session ของผู้นั้นทันที
- **Google OpenID Connect** ของโดเมน Workspace ที่กำหนด (`GOOGLE_CLIENT_ID` + `GOOGLE_HOSTED_DOMAIN`) โดยปิด password flow

ข้อจำกัดของแบบรหัสผ่าน: ผู้ที่รู้รหัสผ่านชั่วคราวก่อนเจ้าของบัญชีจะผูก TOTP ได้ก่อน จึงต้องแจ้งรหัสชั่วคราวต่อหน้าและให้ผูกทันที (`docs/pilot/ACCESS_POLICY.md`) และยังไม่มีหน้าให้ผู้ใช้เปลี่ยนรหัสผ่านเอง

## Trust boundaries

1. Browser เชื่อม same-origin Cloudflare Worker เท่านั้น
2. Worker ตรวจ Google OIDC หรือ local credential flow, MFA, session, browser floor และ rate limit
3. Worker ลงลายมือชื่อ assertion ที่ผูก `action`, actor, timestamp, nonce และ SHA-256 ของ payload
4. GAS ตรวจ assertion และ nonce ก่อนอ่านข้อมูล แล้วบังคับ RBAC/capability ซ้ำ
5. Sheets/Drive ไม่เป็น security boundary และต้องไม่แชร์แบบ public

## Session

- Cookie: `HttpOnly`, `Secure`, `SameSite=Strict`, `__Host-` prefix
- อายุสูงสุด 8 ชั่วโมง; inactivity 30 นาที
- Sensitive export ต้องมี authentication age ไม่เกิน 5 นาทีและระบุเหตุผล
- PILOT: ทุกบทบาทต้องผ่าน TOTP · DEMO: เฉพาะ Admin/CM; secret เข้ารหัส AES-GCM ก่อนเก็บใน D1 และรหัสที่ใช้แล้วใช้ซ้ำไม่ได้ (เก็บ time-step ล่าสุดใน KV)
- Rate limit การเข้าสู่ระบบ: 5 ครั้งต่อ IP+บัญชี และ 20 ครั้งต่อบัญชี ภายใน 15 นาที นับใหม่เมื่อเข้าสู่ระบบสำเร็จ

## Demo impersonation

Header `x-demo-role` ใช้ได้เฉพาะเมื่อครบทั้งสามเงื่อนไข: `APP_MODE=DEMO`, `DEMO_IMPERSONATION=true` (ตั้งใน `.dev.vars` ที่ root ของ repo เท่านั้น) และ request ส่งถึง `localhost`/`127.0.0.1` Worker ที่ deploy แล้วไม่มีวันถูกเรียกด้วย hostname เหล่านี้ จึงต้องเข้าสู่ระบบด้วยรหัสผ่านเสมอ แม้ตั้ง flag ผิด

## Personal data

- CID เข้ารหัส AES-256-GCM ที่ Worker; Sheets เห็น ciphertext และ keyed lookup hash
- ห้าม log request envelope, password, CID, notes หรือ vital signs
- Export ใส่ DEMO watermark, `Cache-Control: no-store` และ audit ทั้ง Worker/GAS
- CG ได้เฉพาะข้อมูลผู้รับบริการที่ได้รับมอบหมายและ field ที่จำเป็น

## Mandatory controls before any real pilot

- บัญชีเจ้าของระบบ (Google, Cloudflare) เป็นของหน่วยงาน เปิด 2-Step Verification และมีกระบวนการปิดบัญชีบุคลากร (`docs/pilot/ACCESS_POLICY.md`)
- independent penetration test และ direct-GAS-bypass test
- approved clinical rules, escalation protocol, legal basis, retention and incident response
- managed-device/offline threat model
- malware scanner integration; `PENDING_SCAN` download remains denied
- secret rotation and recovery runbook; verified backup/restore
- data processing register, privacy notice version, lawful basis per episode/purpose และช่องทางใช้สิทธิของเจ้าของข้อมูล
- ยืนยันว่า Drive/Sheets sharing, audit retention และ data location ของบัญชี Google ที่ใช้ สอดคล้องกับนโยบายองค์กร

ระบบจะไม่ทำให้รายการข้างต้นสำเร็จโดยอัตโนมัติ ดู `PILOT_RUNBOOK.md` สำหรับ gate ก่อนเปิดโหมดจริง

