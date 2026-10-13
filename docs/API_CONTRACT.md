# API contract

External API อยู่ใต้ `/api/v1`. ทุก response JSON ใช้ envelope:

```json
{"ok":true,"code":"OK","message":"","data":{},"requestId":"uuid"}
```

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/health` | Public | Returns DEMO mode only |
| GET | `/browser-support` | Public | Browser floor check |
| POST | `/auth/password/login` | Public/rate limited | Password + TOTP for Admin/CM |
| POST | `/auth/google` | Public/rate limited | Verified Google ID token |
| GET | `/auth/me` | Authenticated | Server-resolved actor only |
| GET | `/dashboard` | Authenticated/scoped | Demo adapter in local mode |
| GET | `/patients` | Scoped | CG receives assigned projection only |
| POST | `/patients` | CM | CID transformed at Worker before GAS |
| POST | `/exports/patients.csv` | CM + `export:phi` | Recent auth and `x-export-reason` required |
| POST | `/internal/gas/:action` | Authenticated | Development bridge; remove from public production route map |

GAS receives only signed POST envelopes. Implemented actions:

- `auth.resolveIdentity` ในทุกโหมด; `auth.passwordVerify` เฉพาะ `DEMO` และถูกปฏิเสธใน `PILOT`
- `patient.create`, `patient.list`, `patient.export`
- `adl.create`, `classification.confirm`
- `carePlan.create`, `carePlan.activate`
- `visit.submit`, `encounter.review`
- `file.upload`

Errors from GAS still use HTTP-compatible JSON envelopes because Apps Script cannot reliably control every status/header. Worker maps external status codes.

