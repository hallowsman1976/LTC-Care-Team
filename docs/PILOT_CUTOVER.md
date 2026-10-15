# ขั้นตอนเปลี่ยนระบบ DEMO เป็นระบบใช้งานจริง (PILOT)

เอกสารนี้ใช้กับการตัดสินใจเมื่อ 15 ต.ค. 2569: **แปลงระบบ DEMO เดิมเป็นระบบจริง** โดยใช้ Worker, D1, KV, โครงการ Apps Script และ URL เดิม แต่ใช้ไฟล์ Sheets, โฟลเดอร์ Drive และกุญแจเข้ารหัสชุดใหม่ทั้งหมด หน่วยงานไม่มี Google Workspace ระบบจึงเข้าสู่ระบบด้วย **ชื่อผู้ใช้ + รหัสผ่าน + รหัส 6 หลักจากแอป Authenticator สำหรับทุกบทบาท**

> ห้ามนำข้อมูลผู้ป่วยจริงเข้าระบบจนกว่าขั้นที่ 9 จะเสร็จและ gate ใน `PILOT_RUNBOOK.md` ได้รับการลงนาม ขั้นที่ 1–8 ทำได้ด้วยข้อมูลสมมติ

ระหว่างขั้นที่ 3–6 ระบบ DEMO จะใช้งานไม่ได้ ให้แจ้งผู้ใช้ล่วงหน้าและทำให้เสร็จในรอบเดียว (ประมาณ 1–2 ชั่วโมง)

## 0. เตรียมก่อน

- [ ] บัญชีเจ้าของระบบเป็นบัญชีของ **หน่วยงาน** ไม่ใช่ของบุคคล: บัญชี Google (เช่น `ltc.<ชื่อ รพ.สต.>@gmail.com`) และบัญชี Cloudflare ที่ผู้อำนวยการถือรหัสกู้คืน เปิด 2-Step Verification ทั้งสองบัญชี ดู `docs/pilot/ACCESS_POLICY.md`
  - ถ้ายังใช้บัญชีส่วนตัว (`hallowsman…`) อยู่ ให้ย้ายก่อนนำข้อมูลจริงเข้า: ย้ายเจ้าของไฟล์ Sheets/โฟลเดอร์ไปบัญชีหน่วยงาน และย้าย Worker ไปบัญชี Cloudflare ของหน่วยงาน
- [ ] ที่เก็บกุญแจ: password manager หรือไฟล์เข้ารหัสที่ผู้อำนวยการและผู้ดูแลระบบอีกหนึ่งคนเปิดได้
- [ ] ติดตั้งเครื่องมือในเครื่อง: Node 22, `corepack pnpm install`, `npx wrangler login`, `clasp login`

## 1. สำรองข้อมูล DEMO (ถ้าต้องการเก็บไว้)

1. ใน Google Drive ทำสำเนาไฟล์ Sheets DEMO ไว้ในโฟลเดอร์ `Archive DEMO` (ข้อมูลสมมติ ไม่ต้องเข้ารหัส)
2. ลบไฟล์ `cm-totp-qr.png` ที่ root ของโปรเจกต์ (เป็น QR ของ TOTP เดิม หลังขั้นที่ 5 จะใช้ไม่ได้อยู่แล้ว)

## 2. สร้างไฟล์และโฟลเดอร์ใหม่ใน Google Drive (บัญชีหน่วยงาน)

สร้างในโฟลเดอร์ `Smart LTC – PILOT` ที่ **ไม่แชร์กับใคร** (ยกเว้นผู้ดูแลระบบสำรองหนึ่งคน):

| รายการ | ใช้กับ Script Property |
|---|---|
| Google Sheets เปล่า ชื่อ `Smart LTC PILOT` | `SPREADSHEET_ID` (ส่วนกลางของ URL ระหว่าง `/d/` กับ `/edit`) |
| โฟลเดอร์ `quarantine` | `QUARANTINE_FOLDER_ID` |
| โฟลเดอร์ `older-images` | `OLDER_IMAGE_FOLDER_ID` |
| โฟลเดอร์ `service-images` | `SERVICE_IMAGE_FOLDER_ID` |
| โฟลเดอร์ `signatures` | `SIGNATURE_FOLDER_ID` |
| โฟลเดอร์ `staff-photos` | `STAFF_PHOTO_FOLDER_ID` (ต้องเปลี่ยน ถ้าคงค่าเดิมจะเก็บรูปปนกับโฟลเดอร์ DEMO) |
| โฟลเดอร์ `audit-archive` | `AUDIT_ARCHIVE_FOLDER_ID` |
| โฟลเดอร์ `backups` | `BACKUP_FOLDER_ID` |

ห้ามใช้โฟลเดอร์รูปภาพเดิมของ DEMO เพราะไฟล์ในนั้นแชร์แบบ "ทุกคนที่มีลิงก์"

## 3. สร้างกุญแจใหม่และตั้งค่า Cloudflare

ทำที่ root ของโปรเจกต์:

```bash
node scripts/pilot/generate-secrets.mjs
```

1. คัดลอก `pilot.secrets.local.json` เข้า password manager/ที่เก็บเข้ารหัส **ก่อน** ทำขั้นต่อไป (ถ้ากุญแจ `CID_ENCRYPTION_KEY_BASE64` หาย เลขบัตรประชาชนที่เข้ารหัสไว้จะอ่านไม่ได้อีก)
2. ส่งกุญแจให้ Worker:

```bash
node scripts/pilot/push-worker-secrets.mjs pilot.secrets.local.json
```

3. ล้าง session และ TOTP ของ DEMO ใน D1:

```bash
npx wrangler d1 execute smart-ltc-security-demo --remote --file apps/gateway/pilot-reset.sql
```

## 4. ตั้งค่า Apps Script

Apps Script editor → Project Settings → Script Properties ตั้งค่าดังนี้ (แทนค่าเดิม):

| Property | ค่า |
|---|---|
| `APP_MODE` | `PILOT` |
| `PASSWORD_AUTH_ENABLED` | `true` |
| `SPREADSHEET_ID` และ `*_FOLDER_ID` ทั้งหมด | ID ใหม่จากขั้นที่ 2 |
| `GATEWAY_ASSERTION_SECRET` | จาก `gasScriptProperties` ในไฟล์กุญแจ |
| `PASSWORD_PEPPER` | จาก `gasScriptProperties` ในไฟล์กุญแจ |
| `SCHEDULER_ENABLED` | `false` (เปิดหลัง ruleset และตารางเยี่ยมผ่าน UAT) |
| `BACKUP_RETENTION_DAYS` | `35` |
| `PASSWORD_ITERATIONS` | คงค่าเดิมที่ทดสอบแล้วว่าเข้าสู่ระบบไม่เกิน ~5 วินาที |

ลบ property ที่ใช้เฉพาะ DEMO ออก เช่น `LOAD_TEST_ALLOWED`

จากนั้น push โค้ดและอัปเดต deployment เดิม (URL `/exec` คงเดิม):

```bash
corepack pnpm --filter @smart-ltc/gas build
```

```bash
cd apps/gas && npx clasp push --force && npx clasp update-deployment AKfycbyy88DJ-eKDt9mYt2R5Y4y57TC-q73k81tYlFQ23SfWtkz8EyRkozC0ap-2xAEAk4d_
```

รีเฟรชหน้า Apps Script editor แล้วรันจาก editor ตามลำดับ (เมนู Run เลือกฟังก์ชัน):

1. `initializePilotWorkbook` สร้างทุกชีตในไฟล์ใหม่ (อนุมัติสิทธิ์ที่ถาม)
2. สร้างไฟล์ชั่วคราวใน editor ชื่อ `setup-once` (ห้ามแก้ `bundle.js`) แล้ววางโค้ด เปลี่ยนค่าให้ตรงความจริง แล้วรัน `setupOnce`:

```js
function setupOnce() {
  const cm = createPilotCaseManager({
    username: 'cm.somchai',               // a-z 0-9 . _ - อย่างน้อย 3 ตัว
    displayName: 'นางสาว... (CM)',
    password: 'รหัสผ่านชั่วคราวอย่างน้อย 12 ตัว',
    credentialType: 'ประกาศนียบัตร Care Manager เลขที่ ...',
    qualificationExpiry: '2027-09-30'     // วันหมดอายุตามเอกสารที่ตรวจแล้ว
  });
  const ruleset = addApprovedRuleset({
    rulesetId: 'rs-2570',
    fiscalYear: '2570',
    policyName: 'ชุดสิทธิประโยชน์ LTC ปีงบประมาณ 2570',
    sourceUrl: 'https://...',             // ประกาศ สปสช. ที่ใช้อ้างอิง
    validFrom: '2026-10-01',
    validTo: '2027-09-30',
    approvedBy: 'ผู้อำนวยการ รพ.สต. ...'
  });
  console.log(JSON.stringify({ cm, ruleset }));
}
```

3. **ลบไฟล์ `setup-once` ทันที** (มีรหัสผ่านอยู่) และแจ้งรหัสผ่านชั่วคราวให้ CM ทางช่องทางที่ปลอดภัย (บอกต่อหน้า ไม่ส่งทาง LINE กลุ่ม)
4. รัน `installBackupTrigger` และ `installAuditArchiveTrigger` อย่างละครั้ง

## 5. Deploy เว็บและ Worker เป็น PILOT

`wrangler.toml` และ `apps/web/.env.production` ใน commit นี้ตั้งเป็น PILOT แล้ว การ push ขึ้น `main` จะให้ Cloudflare Workers Builds deploy เอง:

```bash
git push origin main
```

ก่อน push ให้แก้ `VITE_FACILITY_NAME` ใน `apps/web/.env.production` เป็นชื่อหน่วยบริการ

## 6. ตรวจหลัง deploy

- [ ] เปิด `https://ltc-care-team.hallowsman.workers.dev/api/v1/health` ต้องได้ `"mode":"PILOT","passwordAuth":true`
  - ถ้าได้ `INTERNAL_ERROR` ให้ดู Workers → ltc-care-team → Logs จะมีข้อความ `INVALID_CONFIG:<ชื่อ>` หรือ `MISSING_SECRET:<ชื่อ>` บอกว่าค่าใดขาด
- [ ] หน้าเว็บมีแถบ "PILOT — ข้อมูลจริงที่ได้รับอนุญาต" ไม่มีคำว่า DEMO
- [ ] CM เข้าสู่ระบบครั้งแรกด้วยรหัสผ่านชั่วคราว ระบบแสดง QR ให้ผูกแอป Authenticator แล้วเข้าสู่ระบบได้
- [ ] ออกจากระบบแล้วเข้าใหม่ด้วยรหัส 6 หลัก ได้; ใช้รหัสเดิมซ้ำ ไม่ได้
- [ ] เรียก GAS `/exec` ตรงจากเบราว์เซอร์ ต้องได้ `REQUEST_REJECTED`
- [ ] Apps Script → Executions ไม่มี error ใหม่; ชีต `JobRuns` มี `WORKBOOK_BACKUP` หลังตี 1 คืนแรก

## 7. เพิ่มผู้ใช้

- CG: CM เพิ่มจากเมนู "เพิ่มผู้ดูแล" ตั้งรหัสผ่านชั่วคราว แจ้ง CG ต่อหน้า CG ผูกแอป Authenticator ตอนเข้าสู่ระบบครั้งแรก
- CM เพิ่มเติม: รัน `createPilotCaseManager` จาก editor แบบขั้นที่ 4
- ลืมรหัสผ่าน: CG ให้ CM ตั้งใหม่ในหน้าแก้ไขผู้ดูแล; CM ใช้ `resetUserPassword('username', 'รหัสใหม่')` จาก editor
- เปลี่ยน/หายโทรศัพท์: CM กด "รีเซ็ตแอปยืนยันตัวตน" ในหน้า "ข้อมูลผู้ใช้งาน" ผู้ใช้จะถูกออกจากระบบและผูกแอปใหม่ตอนเข้าสู่ระบบครั้งถัดไป
- ใบประกาศนียบัตร CM ต่ออายุ: `renewCaseManagerCredential('username', 'เอกสารใหม่', 'yyyy-MM-dd')` (CM ที่เอกสารหมดอายุจะเข้าระบบไม่ได้)
- บุคลากรลาออก: ปิดใช้งานบัญชีในวันเดียวกัน (ดู `docs/pilot/ACCESS_POLICY.md`)

## 8. ทดสอบด้วยข้อมูลสมมติ

ทำ UAT ตาม `docs/UAT_CHECKLIST.md` หมวด PILOT ด้วยผู้รับบริการสมมติ แล้วเปลี่ยนสถานะเป็น "ยุติบริการ" ก่อนเริ่มข้อมูลจริง

## 9. ก่อนนำข้อมูลจริงเข้า

- [ ] ลงนาม gate ใน `PILOT_RUNBOOK.md`
- [ ] ประกาศความเป็นส่วนตัว (`docs/pilot/PRIVACY_NOTICE.md`) ผ่าน DPO และเผยแพร่แล้ว เวอร์ชันตรงกับ `VITE_PRIVACY_NOTICE_VERSION`
- [ ] ทดลองกู้คืนจาก backup หนึ่งครั้ง (`docs/pilot/BACKUP_DR.md`)
- [ ] นำเข้าผู้รับบริการชุดแรกไม่เกิน 10 ราย ตรวจ `AuditLogs` แล้วจึงเพิ่ม

## ย้อนกลับ (rollback)

ถ้าขั้นที่ 5–6 ไม่ผ่านและยังไม่มีข้อมูลจริง: revert commit ของ `wrangler.toml` แล้ว push, คืน Script Properties `APP_MODE=DEMO` และ `SPREADSHEET_ID` เดิม, `clasp update-deployment` ใหม่ ผู้ใช้ DEMO ต้องผูก TOTP ใหม่ (กุญแจ MFA เปลี่ยนแล้ว)
