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

