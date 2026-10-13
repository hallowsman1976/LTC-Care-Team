# Smart LTC Care implementation blueprint

This repository implements the approved Phase A–D subset of `SMART_LTC_CARE_BLUEPRINT_GAS.md` dated 13 October 2026.

## Included

- Security-first React/Vite PWA scaffold and role-scoped Thai mobile UI
- Cloudflare Worker identity/session boundary, signed GAS transport, replay/rate-limit hooks and encrypted CID handling
- GAS workbook initializer, RBAC, audit, ADL, LTC confirmation, Care Plan activation, recurring visit generation, idempotent encounters, review and private quarantine uploads
- Synthetic local adapters and fixtures
- Shared validation/domain contracts, unit/contract/e2e tests
- Security, API, data, deployment, clinical-reference and UAT documentation

## Excluded from Phase A–D

- LINE sending/webhook (Phase E)
- Full analytical reporting, approved export governance, backup automation and production UAT (Phase F)
- Real malware scanner, managed-device offline mode and real clinical escalation thresholds
- Any real patient data or production deployment

## Governing decisions

The codebase supports two modes, and both Worker and GAS reject anything else:

- `DEMO` (default) — synthetic data only. Sign-in is a password stored as a salted PBKDF2 hash in Sheets plus TOTP for CM/ADMIN. The banner is permanent. Role impersonation through `x-demo-role` exists only for `wrangler dev` on localhost with `DEMO_IMPERSONATION=true`.
- `PILOT` — fail-closed technical gate for real data. It accepts only Google OIDC from `GOOGLE_HOSTED_DOMAIN` and disables password sign-in. It must not be enabled until every gate in `PILOT_RUNBOOK.md` is signed off.

An earlier version of this document said both tiers reject non-DEMO modes. That was not true of the code and has been corrected (review of 13 October 2026).

Historical G1–G4 frequencies and nine-month reassessment references remain inactive until an accountable facility/payer approves a versioned ruleset. The system never auto-confirms LTC classification or gives clinical treatment advice.

## Open items

Deferred engineering work:

- **Step-up re-authentication before export (Phase F).** Export requires authentication within the last 5 minutes, but there is no step-up endpoint yet; the only way to satisfy it is to sign out and sign in again. Export stays disabled (`PHI_EXPORT_ENABLED=false`) until this exists.
- **Full pagination.** List endpoints return the first 50 rows with `hasMore`; there is no cursor yet.
- **Sheet growth.** Id lookups use a TextFinder and audit rows are append-only, so growth no longer blocks writes. Whole-sheet scans (dashboard, lists, scheduler) still slow down as sheets grow and stop at 50,000 rows (`SCAN_BOUND_EXCEEDED`), and a Google spreadsheet holds at most 10 million cells. `AuditLogs` is rotated monthly by `archiveAuditLogs` (see DEPLOYMENT). Before a pilot, run the load test in `scripts/load-test/README.md` on real Apps Script with one to two years of synthetic volume and record the results.

Clinical decisions that need an accountable clinical owner (not changed in code):

- **ADL self-approval.** `adl.create` records the assessor as the approver and stores the assessment as `APPROVED` immediately. Decide whether a second CM must approve, or whether assessor = approver is acceptable.
- **LTC eligibility threshold.** `suggestLtcGroup` does not check ADL ≤ 11 (the usual eligibility cut-off for the LTC programme); a score of 12–20 can still receive a group suggestion. Decide whether the suggestion should require CM review above 11.
