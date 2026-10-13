# Real-data pilot runbook

เอกสารนี้เป็น gate สำหรับนำ Smart LTC Care ไปใช้กับข้อมูลจริง ห้ามเปลี่ยน `APP_MODE=PILOT` จนกว่ารายการ Mandatory จะมีหลักฐานและผู้รับผิดชอบลงนาม

## Mandatory approval record

| Gate | หลักฐานขั้นต่ำ | Owner | สถานะ |
|---|---|---|---|
| ผู้ควบคุมข้อมูลและฐานกฎหมาย | ชื่อผู้ควบคุม, วัตถุประสงค์, ฐานกฎหมายของข้อมูลสุขภาพ, privacy notice และ retention schedule | DPO/กฎหมาย | BLOCKED |
| Clinical governance | ruleset ที่อนุมัติ, escalation protocol, CM credential policy | ผู้อำนวยการ/CM lead | BLOCKED |
| Identity | Workspace domain, enforced 2SV, joiner/mover/leaver และ break-glass accounts | IT admin | BLOCKED |
| Device | managed device, encryption, screen lock, remote wipe, browser floor | IT/security | BLOCKED |
| Storage | ปิด public/external sharing, จำกัด editor, Drive audit retention, approved data location | IT/DPO | BLOCKED |
| Security | threat model, penetration test, direct-GAS bypass, dependency/SAST review | Security | BLOCKED |
| Files | malware scanner จริงและ workflow quarantine/clean/reject | Security | BLOCKED |
| Backup/DR | encrypted backup, restore test, RPO/RTO และ owner | IT | BLOCKED |
| Incident | contact tree, containment, evidence preservation, notification decision process | DPO/Security | BLOCKED |
| UAT | role-based UAT ด้วยข้อมูลสังเคราะห์ก่อน แล้ว controlled migration rehearsal | Product/Users | BLOCKED |

## Technical behavior in PILOT

- ยอมรับ Google OIDC เฉพาะ `GOOGLE_HOSTED_DOMAIN`; password authentication ใน Sheets ถูกปิด
- ตรวจ `APP_ORIGIN`, GAS URL และ secret placeholders แบบ fail-closed
- ไม่ยอมรับ `x-demo-role` และไม่คืน demo fixtures
- dashboard, patients, visits, alerts และ review queue อ่านจาก GAS จริงตาม actor
- CG เห็นผู้รับบริการและงานเยี่ยมเฉพาะ assignment ของตน
- CM ต้องมี `StaffProfiles.credentialVerifiedAt` และ `qualificationExpiry` ที่ยังไม่หมดอายุ
- การสร้างผู้รับบริการต้องมี `legalBasis` และ `privacyNoticeVersion`
- CID เข้ารหัส AES-GCM ที่ gateway; Sheets เก็บ ciphertext และ lookup hash
- export ข้อมูลถูกปิดโดยค่าเริ่มต้นด้วย `PHI_EXPORT_ENABLED=false`
- API ใช้ strict session cookie, origin/custom-header CSRF gate, no-store และ security headers

## Workspace controls

1. บังคับ 2-Step Verification สำหรับผู้ใช้ที่เข้าถึงระบบ โดยให้ security key/passkey เป็นตัวเลือกหลัก
2. เก็บ workbook และ quarantine folder ใน Shared Drive ขององค์กร ไม่ให้บุคคลใดเป็นเจ้าของส่วนตัว
3. ปิด external/public sharing และจำกัดสิทธิ์ Manager/Content manager เท่าที่จำเป็น
4. ตรวจ Drive log events และตั้ง alert สำหรับ sharing, download, permission change และ unusual access
5. ประเมิน data region/processing location ตามนโยบายองค์กรและข้อจำกัดของ Workspace edition

เอกสารอ้างอิงผู้ให้บริการ:

- Google Workspace 2-Step Verification: https://support.google.com/a/answer/175197
- Drive log events: https://support.google.com/a/answer/4579696
- Shared Drive access restrictions: https://support.google.com/a/users/answer/12380484
- Google Workspace data regions: https://support.google.com/a/answer/14310028

## Go-live sequence

1. Clone environment ใหม่สำหรับ PILOT; ห้ามเปลี่ยน DEMO environment เดิม
2. สร้าง keys/secrets ใหม่ทุกค่าและบันทึก owner/rotation date โดยไม่ใส่ใน repository
3. สร้าง workbook ใหม่และรัน `initializePilotWorkbook`
4. เพิ่มผู้ใช้เริ่มต้นด้วย Google subject; ห้ามสร้าง `AuthCredentials`
5. ทดสอบด้วย synthetic records ใน PILOT environment
6. ทำ penetration test, restore drill และ role matrix UAT
7. ลงนาม gates ในตารางด้านบน
8. นำเข้าข้อมูลจริงจำนวนน้อยแบบควบคุม ตรวจ audit แล้วจึงเพิ่มขอบเขต

## Stop conditions

ปิดการเข้าถึงและเริ่ม incident process ทันทีเมื่อพบ public/external sharing ที่ไม่ได้รับอนุญาต, secret รั่ว, account takeover, direct GAS bypass, audit gap, backup กู้คืนไม่ได้ หรือ CG เข้าถึงผู้รับบริการที่ไม่ได้รับมอบหมาย
