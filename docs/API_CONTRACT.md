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
| POST | `/auth/logout` | Authenticated | Revokes the session |
| GET | `/dashboard` | Authenticated/scoped | Counts |
| GET | `/patients` | `patients:read` | `{items, hasMore}`; CG receives assigned projection only |
| GET | `/visits` | `patients:read` | `{items, hasMore}`; CG sees own assignments |
| GET | `/alerts` | `patients:read` | `{items, hasMore}`; empty for CG |
| GET | `/reviews` | `encounter:review` | `{items, hasMore}` |
| POST | `/patients` | `patients:write` (CM, ADMIN) | CID transformed at Worker before GAS; an ADMIN must name `careManagerId` (`CARE_MANAGER_REQUIRED`) |
| POST | `/patients/get` | `patients:write` (CM, ADMIN) | `patientGetSchema`; CID decrypted at Worker and returned as `cidLast4` only |
| POST | `/patients/update` | `patients:write` (CM, ADMIN) | `patientUpdateSchema`; version-checked; empty `cid` keeps the stored one; leaving ACTIVE closes the episode, ends assignments and cancels upcoming visits; changing `caregiverId` needs `assignments:manage` |
| POST | `/patients/delete` | `patients:delete` (ADMIN) | `patientGetSchema`; for a patient registered by mistake: removes the patient with its episodes, assignments, upcoming visits, consents and contacts; refused with `PATIENT_HAS_HISTORY` (409) once any ADL, classification, care plan, visit record, alert, referral or budget line exists |
| POST | `/adl-assessments` | `adl:approve` | `adlCreateSchema`; episode resolved from `patientId` |
| POST | `/ltc-classifications` | `classification:confirm` | `classificationConfirmSchema`; uses latest approved ADL |
| POST | `/care-plans` | `carePlan:approve` | `carePlanCreateSchema`; creates plan + intervention |
| POST | `/care-plans/activate` | `carePlan:approve` | `carePlanActivateSchema` |
| POST | `/visit-encounters` | `patients:read` + assignment | `visitSubmitSchema`; idempotent on `submissionId`; `urgentFlag` raises a HIGH alert |
| POST | `/encounter-reviews` | `encounter:review` | `encounterReviewSchema` |
| POST | `/visit-files` | `patients:read` + own encounter | `fileUploadSchema`; ≤ 5 MB, quarantined |
| GET | `/admin/caregivers` | `users:manage` | CG accounts with active patient counts |
| POST | `/admin/caregivers` | `users:manage` | `caregiverCreateSchema` (account + profile: CID, birth date, phone, address, email, photo ≤ 512 KB, education, organization, trainings); CID encrypted at Worker; DEMO only (password sign-in); `USERNAME_TAKEN`, `DUPLICATE_STAFF_CID` |
| POST | `/admin/caregivers/get` | `users:manage` | `caregiverGetSchema`; profile for the edit form; CID decrypted at Worker and returned as `cidLast4` only |
| POST | `/admin/caregivers/update` | `users:manage` | `caregiverUpdateSchema`; version-checked (`VERSION_CONFLICT`); empty `cid`/`newPassword` keep the current value; replaced photos go to Drive trash |
| GET | `/admin/users` | `users:manage` | All accounts with role, sign-in name, status and CM credential expiry; no secrets |
| GET | `/admin/assignments` | `assignments:manage` | Every active patient with the current CG |
| POST | `/admin/assignments` | `assignments:manage` | `assignmentSetSchema`; ends the previous CG assignment, moves upcoming visits, opens an episode if none |
| POST | `/admin/patients/import` | `patients:import` | `patientImportSchema`, ≤ 200 rows, all registration columns; CIDs encrypted at Worker; duplicates skipped and reported; `caregiverUsername` assigns the CG (needs `assignments:manage`), unknown names are imported unassigned and returned in `warnings` |
| GET | `/budget-plans` | `budget:read` (CM, ADMIN) | Budget plans of every fiscal year and version |
| POST | `/budget-plans/get` | `budget:read` | `budgetGetSchema`; settings, lines and each line's current confirmed group |
| POST | `/budget-plans/create` | `budget:manage` (CM) | `budgetCreateSchema`; one plan per fiscal year (`BUDGET_PLAN_EXISTS`); copies last year's settings; pulls everyone in care during the year |
| POST | `/budget-plans/sync` | `budget:manage` | `budgetSyncSchema`; DRAFT only; refreshes group, months in care and CG, keeps the CM's figures, adds new people |
| POST | `/budget-plans/save` | `budget:manage` | `budgetSaveSchema`; DRAFT only (`BUDGET_PLAN_LOCKED`); version-checked; settings plus the edited lines |
| POST | `/budget-plans/approve` | `budget:manage` | `budgetApproveSchema`; refused over the ceiling (`BUDGET_OVER_CEILING`) or with no counted person; supersedes the previous approved version |
| POST | `/budget-plans/revise` | `budget:manage` | `budgetReviseSchema`; copies an APPROVED plan to a new DRAFT version (`BUDGET_DRAFT_EXISTS` if one is open) |
| POST | `/exports/patients.csv` | CM + `export:phi` | Auth within 5 minutes (sign in again) and `x-export-reason` required |

Request schemas live in `packages/shared/src/actions.ts`. The gateway validates them and forwards only the parsed fields; GAS validates again. There is no generic proxy to GAS actions, and `auth.*` actions are reachable only through the sign-in routes.

### Status codes

| Status | When |
|---|---|
| 400 | `INVALID_JSON`, `VALIDATION_FAILED`, business-rule input errors |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `MFA_INVALID`, `REAUTH_REQUIRED` |
| 403 | `FORBIDDEN`, `MFA_ENROLLMENT_REQUIRED`, `CSRF_CHECK_FAILED`, `ORIGIN_NOT_ALLOWED`, assignment/credential failures |
| 404 | `NOT_FOUND`, `PATIENT_NOT_FOUND` |
| 409 | `VERSION_CONFLICT`, duplicates, missing prerequisites (episode, ADL, ruleset, assignment) |
| 429 | `LOGIN_RATE_LIMITED` |
| 502 | `UPSTREAM_FAILED` — GAS failed for a reason the user cannot act on; details go to the Worker log only |

GAS receives only signed POST envelopes. Implemented actions:

- `auth.resolveIdentity` ในทุกโหมด; `auth.passwordVerify` เฉพาะ `DEMO` และถูกปฏิเสธใน `PILOT`
- `patient.create`, `patient.list`, `patient.export`
- `adl.create`, `classification.confirm`
- `carePlan.create`, `carePlan.activate`
- `visit.submit`, `encounter.review`
- `file.upload`

Errors from GAS still use HTTP-compatible JSON envelopes because Apps Script cannot reliably control every status/header. The Worker maps known GAS codes to the statuses above (`apps/gateway/src/errors.ts`); unknown codes become `502 UPSTREAM_FAILED`. After sign-in the assertion `subject` is the internal `userId`; the Google `sub` is used only by `auth.resolveIdentity`.

