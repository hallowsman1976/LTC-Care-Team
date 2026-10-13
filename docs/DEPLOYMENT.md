# Deployment guide

## Local

1. Install Node.js 22 and pnpm 11.
2. Copy `.env.example` to local environment configuration; never commit values.
3. Run `pnpm install`, then `pnpm check`.
4. Start Worker with `pnpm --filter @smart-ltc/gateway dev` after creating local D1/KV bindings.
5. Start web with `pnpm --filter @smart-ltc/web dev`.

The web app proxies `/api` to `127.0.0.1:8787`. The Demo role switch sends `x-demo-role` and only works because Worker requires `APP_MODE=DEMO`.

## GAS demo project

1. Create a new spreadsheet and private quarantine Drive folder using synthetic data only.
2. Set Script Properties: `APP_MODE=DEMO`, `SPREADSHEET_ID`, `GATEWAY_ASSERTION_SECRET`, `PASSWORD_PEPPER`, `QUARANTINE_FOLDER_ID`.
3. Run `pnpm --filter @smart-ltc/gas build`.
4. Configure `.clasp.json` locally and run `pnpm --filter @smart-ltc/gas push`.
5. Execute `initializeDemoWorkbook` once.
6. Deploy the Web App and set its URL as `GAS_EXEC_URL` in Worker.
7. Direct GAS access must still fail without a valid Worker assertion.

## Cloudflare demo gateway

1. Create D1 and KV resources and update IDs in `apps/gateway/wrangler.toml` locally.
2. Apply `apps/gateway/schema.sql`.
3. Add secrets using `wrangler secret put`; never write them to `wrangler.toml`.
4. Deploy only to an isolated DEMO account/domain.

## Real-data pilot

โค้ดรองรับ deployment แบบ `PILOT` แต่ต้องดำเนินการตาม `PILOT_RUNBOOK.md` ก่อนทุกครั้ง ห้ามแก้เฉพาะป้าย DEMO หรือส่ง header `x-demo-role` เพื่อใช้งานจริง เพราะ gateway จะไม่ยอมรับ header นี้เมื่อ `APP_MODE=PILOT`

หลักการตั้งค่า:

1. ใช้ Cloudflare account/domain และ Google Workspace domain ขององค์กร ไม่ใช้บัญชีส่วนบุคคล
2. ตั้ง `APP_MODE=PILOT`, `APP_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_HOSTED_DOMAIN` และ secrets ผ่าน secret manager
3. ตั้ง GAS Script Properties เป็น `APP_MODE=PILOT`, `SPREADSHEET_ID`, `GATEWAY_ASSERTION_SECRET`, `QUARANTINE_FOLDER_ID` และคง `SCHEDULER_ENABLED=false` จนกว่า ruleset/ตารางจะผ่าน UAT
4. Deploy GAS แล้วรัน `initializePilotWorkbook` หนึ่งครั้งบน workbook ใหม่ที่จำกัดสิทธิ์
5. เพิ่มผู้ใช้ใน `Users` ด้วย Google subject และเพิ่ม CM ใน `StaffProfiles` พร้อมข้อมูล credential ที่ตรวจสอบแล้วและวันหมดอายุ
6. ปิด external/public sharing ของ workbook และ Drive folder พร้อมเปิด Drive audit logs
7. คง `PHI_EXPORT_ENABLED=false` จนกว่าจะมี export policy, re-authentication test และผู้อนุมัติ
8. Build web ด้วย `VITE_APP_MODE=PILOT`, `VITE_GOOGLE_CLIENT_ID`, `VITE_FACILITY_NAME` และ `VITE_PRIVACY_NOTICE_VERSION`
9. ทดสอบ direct-GAS bypass, RBAC ของ CG, logout/session revocation, backup restore และ incident drill ก่อน go-live

`PILOT` เป็นเพียง technical gate ไม่ใช่ production certification

