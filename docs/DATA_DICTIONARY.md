# Data dictionary

The complete header source of truth is `apps/gas/src/initializer.ts`.

Key rules:

- IDs are opaque UUID strings; never use sheet row numbers as identity.
- Timestamps are ISO 8601 UTC. UI formats Asia/Bangkok and may display Buddhist Era.
- Mutable clinical/operational records use `recordVersion` for optimistic concurrency.
- Approved ADL and LTC classifications are immutable; corrections create new records.
- Care Plan changes create new versions. Only `ACTIVE` plans with an approved ruleset generate visits.
- `generationKey` prevents duplicate schedule creation.
- `submissionId` and `SyncReceipts` prevent duplicate encounter submission.
- CID plaintext never enters Sheets. `cidCiphertext` and `cidLookupHash` are stored instead.
- `AuthCredentials` is separate from `Users` and must never be returned by list APIs.
- Historical G1–G4 frequency examples are DRAFT/disabled. Test fixtures are isolated from runtime seed.

Primary tables: Users, AuthCredentials, StaffProfiles, Patients, PatientContacts, CareEpisodes, ADLAssessments, LTCClassifications, RiskAssessments, CarePlans, CarePlanProblems, CarePlanInterventions, StaffAssignments, VisitSchedules, VisitEncounters, VisitActivities, VisitFiles, Alerts, Referrals, ServiceRuleSets, ServiceFrequencyRules, PatientConsents, NotificationOutbox, AuditLogs, SyncReceipts, JobRuns, IndexRegistry and Holidays.


## LTC budget plans

`BudgetPlans` holds one row per fiscal year (พ.ศ., 1 Oct – 30 Sep) and version; `status` is `DRAFT`, `APPROVED` or `SUPERSEDED`, and the rates, defaults and the fund's approved amount are in `settingsJson` (`budgetSettingsSchema`), so an approved version keeps the rates it was approved with. `BudgetLines` holds one row per person: fields pulled from the register (name, age, address, ADL, confirmed `groupNumber`, `serviceDays`/`serviceMonths` in the year, current caregiver) and the CM's figures. A blank fee or `diaperCount` means "use the plan's default". Both sheets are created on first use and stored as text. The calculation lives in `packages/shared/src/budget.ts`: a month counts once 15 of its days were in care; the group rate is pro-rated by months and rounded to whole baht; the ceiling is the sum of counted people's pro-rated rates, or the approved amount when set.

## Patients registration fields

New columns are appended to an existing `Patients` sheet on the next registration (`ensureColumns`); existing columns never move, because rows are read by header name. Choice fields store the codes in `packages/shared/src/patient.ts`.

| Requested field | Column | Notes |
|---|---|---|
| PatientID | `patientId` | UUID, set by the server |
| CID | `cidCiphertext`, `cidLookupHash` | Encrypted at the Worker; plaintext never stored |
| HN, FullName, Sex, BirthDate, Phone | `hn`, `fullName`, `sex`, `birthDate`, `phone` | Birth date ISO (CE); the form shows พ.ศ. |
| Age | — | Computed from `birthDate` when shown, never stored |
| Address, VillageNo, VillageName | `address`, `villageNo`, `villageName` | `village` keeps the combined label for lists, e.g. "หมู่ 2 บ้านหนองบัว" |
| Subdistrict, District, Province | `subdistrict`, `district`, `province` | |
| Latitude, Longitude | `latitude`, `longitude` | Decimal degrees |
| MainCaregiverName, MainCaregiverPhone, Relationship | `mainCaregiverName`, `mainCaregiverPhone`, `relationship` | Family caregiver, not the CG |
| RightType, Disease | `rightType`, `diseases` | `diseases` is a comma-separated list |
| DependencyStatus, ADLScore, TAIGroup, PPSScore, MentalHealthStatus | `dependencyStatus`, `adlScore`, `taiGroup`, `ppsScore`, `mentalHealthStatus` | Intake values; formal ADL stays in `ADLAssessments` |
| CareManagerID | `careManagerId` | Defaults to the registering CM |
| CaregiverID | `caregiverId` | Mirror of the active CG in `StaffAssignments`, kept in step by assignment |
| RegisterDate | `registerDate` | Defaults to today (Bangkok) |
| Status | `status`, `statusNote`, `statusChangedAt` | ACTIVE, INACTIVE, MOVED or DECEASED; leaving ACTIVE closes the care episode |
| CreatedBy, CreatedAt, UpdatedAt | `createdBy`, `createdAt`, `updatedAt` | Set by the server |
