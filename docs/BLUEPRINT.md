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

The user selected an experimental password implementation in Sheets/GAS. This explicitly downgraded the target from Pilot-ready to an experimental synthetic-data prototype. The application enforces a permanent DEMO banner and both Worker/GAS reject a non-DEMO mode.

Historical G1–G4 frequencies and nine-month reassessment references remain inactive until an accountable facility/payer approves a versioned ruleset. The system never auto-confirms LTC classification or gives clinical treatment advice.
