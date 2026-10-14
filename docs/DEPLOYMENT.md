# Deployment guide

## Local

1. Install Node.js 22 and pnpm 11 (see README for Windows).
2. Copy `.env.example` to local environment configuration; never commit values.
3. Run `pnpm install`, then `pnpm check`.
4. Copy `.dev.vars.example` to `.dev.vars` (repository root, next to `wrangler.toml`) and start the Worker with `pnpm --filter @smart-ltc/gateway dev`.
5. Start web with `pnpm --filter @smart-ltc/web dev`.

The web app proxies `/api` to `127.0.0.1:8787`. In this local setup the role switcher sends `x-demo-role` and the Worker answers from synthetic fixtures without calling GAS. A deployed DEMO ignores the header (see `SECURITY.md`).

## GAS demo project

1. Create a new spreadsheet and private quarantine Drive folder using synthetic data only.
2. Set Script Properties: `APP_MODE=DEMO`, `SPREADSHEET_ID`, `GATEWAY_ASSERTION_SECRET`, `PASSWORD_PEPPER`, `QUARANTINE_FOLDER_ID`.
   For the home-visit record form also set `OLDER_IMAGE_FOLDER_ID`, `SERVICE_IMAGE_FOLDER_ID` and `SIGNATURE_FOLDER_ID` (Drive folders for patient photos, care-activity photos and signatures), then run `initializeDemoWorkbook` once to add the `VisitImages` and `Visit_Records` sheets (kept as plain text so phone numbers keep their leading 0) and approve the Drive permission prompt. In DEMO the images are shared by link so the stored `https://lh3.googleusercontent.com/d/<id>` URLs open; in PILOT they stay private and an upload needs the patient's recorded consent.
3. Run `pnpm --filter @smart-ltc/gas build`.
4. Configure `.clasp.json` locally and run `pnpm --filter @smart-ltc/gas push`.
5. Execute `initializeDemoWorkbook` once, add demo rows to `Users` (and `StaffProfiles` for CM), then create sign-in accounts as described in `scripts/seed-demo/README.md`.
6. Deploy the Web App and set its URL as `GAS_EXEC_URL` in Worker.
7. Direct GAS access must still fail without a valid Worker assertion.

## Audit log archiving (DEMO and PILOT)

`AuditLogs` grows with every write. A nightly job moves rows from previous months into one spreadsheet per month, so the live sheet holds about one month of entries.

1. Create a private Drive folder for archives (no external sharing; same retention owner as the workbook) and set Script Property `AUDIT_ARCHIVE_FOLDER_ID`.
2. Run `installAuditArchiveTrigger` once from the editor. It schedules `archiveAuditLogs` daily between 02:00 and 03:00 and replaces any earlier trigger.
3. Each run moves up to 2,000 rows into `SmartLTC AuditLogs yyyy-MM`. It copies first, verifies by id and only then deletes, so a failed run is safe to repeat. Results are recorded in `JobRuns` (`AUDIT_ARCHIVE`). After a backlog, run it manually a few times or let the nightly runs catch up.
4. Archives are never deleted automatically. Retention and disposal follow the DPO's schedule.

## Cloudflare demo gateway

The Worker serves both the web app (static assets from `apps/web/dist`) and the API under `/api/*`, on one origin. This is required: the session cookie is `__Host-` and `SameSite=Strict`, and the API has no CORS.

1. Create D1 and KV resources and update their IDs in the root `wrangler.toml`.
2. Apply `apps/gateway/schema.sql`.
3. Add secrets using `wrangler secret put`; never write them to `wrangler.toml`.
4. Build and deploy: `pnpm -r build` (builds the web app before the Worker), then `pnpm --filter @smart-ltc/gateway run deploy` (`run` is required: plain `pnpm deploy` is a different, built-in pnpm command). Deploy only to an isolated DEMO account/domain.

Static responses get security headers (including the CSP) from `apps/web/public/_headers`.

For Cloudflare **Workers Builds** (deploy on git push), set in the Worker's Settings → Build:

| Setting | Value |
|---|---|
| Root directory | `/` (repository root, so the web app is built too) |
| Build command | `pnpm run build` |
| Deploy command | `npx wrangler deploy` (the default) or `pnpm --filter @smart-ltc/gateway run deploy` |

`wrangler.toml` lives at the repository root so the default deploy command finds it. The Worker name in it must match the Worker's name in Cloudflare (`ltc-care-team`).

## GitHub Pages preview

`.github/workflows/pages.yml` publishes a backend-free preview on every push to `main`: synthetic fixtures answered in the browser, validated with the same contracts as the Worker, nothing stored, and a "หน้าตัวอย่าง" banner. Turn it on once under **Settings → Pages → Build and deployment → Source: GitHub Actions**. It is for showing the screens and workflow; sign-in, GAS and real data are only available through the Cloudflare deployment.

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

