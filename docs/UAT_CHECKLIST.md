# UAT checklist — synthetic data only

## Access control

- Forged, expired and replayed gateway assertions are rejected.
- Direct GAS calls without the assertion are rejected before data access.
- CG changing a patient ID cannot read an unassigned patient.
- Disabled users and expired credentials are denied.
- Admin/CM login requires valid TOTP.

## Clinical records

- ADL accepts only item-specific score choices and server total remains 0–20.
- LTC suggestion never confirms itself; CM rationale is required.
- Approved assessments cannot be edited.
- Care Plan activation fails without active episode, legal basis, classification, assignment, intervention and approved ruleset.
- Self-approval records rationale and audit.

## Visits

- Multiple scheduler runs do not duplicate a `generationKey`.
- Holiday is flagged/left for CM action and never shifted automatically.
- Duplicate `submissionId` returns the committed encounter.
- Submitted encounter cannot be edited until CM returns it; prior revision remains.
- Stale `recordVersion` returns `VERSION_CONFLICT`.

## Privacy and files

- Sheets never contains plaintext CID.
- CSV export requires recent authentication, reason and audit.
- LINE is not contacted in Phase A–D.
- Files over 5 MB or outside JPG/PNG/PDF are rejected.
- File stays private and unavailable while `PENDING_SCAN`.
- Logout purges offline drafts when the feature is enabled.

## Mobile/accessibility

- Core workflows operate at 320 px width and 200% text zoom.
- Keyboard focus is visible and errors are associated with fields.
- Screen-reader names exist for icon controls.
- Unsupported browser is blocked before patient data loads.

