import { getSpreadsheet, requireDemoMode } from './config';
import { VISIT_IMAGE_COLUMNS, VISIT_RECORD_COLUMNS } from './services/visitRecords';

export const SHEETS: Record<string, string[]> = {
  Settings: ['key', 'value', 'environment', 'updatedAt'],
  Users: ['userId', 'identitySubject', 'email', 'usernameNormalized', 'displayName', 'role', 'enabled', 'createdAt', 'updatedAt'],
  AuthCredentials: ['credentialId', 'userId', 'identifierNormalized', 'saltBase64', 'derivedHashBase64', 'algorithm', 'iterations', 'passwordChangedAt', 'status'],
  StaffProfiles: ['staffId', 'userId', 'staffType', 'credentialType', 'credentialVerifiedAt', 'qualificationExpiry'],
  Patients: ['patientId', 'localCode', 'hn', 'cidCiphertext', 'cidLookupHash', 'fullName', 'birthDate', 'sex', 'address', 'village', 'phone', 'status', 'createdAt', 'updatedAt', 'createdBy', 'recordVersion',
    'villageNo', 'villageName', 'subdistrict', 'district', 'province', 'latitude', 'longitude', 'mainCaregiverName', 'mainCaregiverPhone', 'relationship',
    'rightType', 'diseases', 'dependencyStatus', 'adlScore', 'taiGroup', 'ppsScore', 'mentalHealthStatus', 'careManagerId', 'caregiverId', 'registerDate', 'statusNote', 'statusChangedAt'],
  PatientContacts: ['contactId', 'patientId', 'contactName', 'relation', 'phone', 'emergencyFlag', 'authorizationBasis'],
  CareEpisodes: ['episodeId', 'patientId', 'startDate', 'endDate', 'eligibilityStatus', 'status', 'fundingType', 'legalBasis'],
  ADLAssessments: ['assessmentId', 'episodeId', 'assessorId', 'assessmentDate', 'feeding', 'grooming', 'transfer', 'toiletUse', 'mobility', 'dressing', 'stairs', 'bathing', 'bowels', 'bladder', 'totalScore', 'scoringVersion', 'approvedBy', 'status', 'createdAt', 'updatedAt', 'createdBy', 'recordVersion'],
  LTCClassifications: ['classId', 'episodeId', 'assessmentId', 'adlTotal', 'mobilityStatus', 'cognitiveStatus', 'terminalStatus', 'groupNumber', 'suggestedGroup', 'decisionStatus', 'rationale', 'confirmedBy', 'effectiveAt', 'createdAt', 'updatedAt', 'createdBy', 'recordVersion'],
  RiskAssessments: ['riskId', 'episodeId', 'riskType', 'instrumentVersion', 'resultJson', 'severity', 'assessedAt', 'assessorId'],
  CarePlans: ['carePlanId', 'episodeId', 'version', 'rulesetId', 'cmId', 'effectiveFrom', 'effectiveTo', 'status', 'approvedBy', 'approvedAt', 'approvalRationale', 'goalsSummary', 'createdAt', 'updatedAt', 'createdBy', 'recordVersion'],
  CarePlanProblems: ['problemId', 'carePlanId', 'problemCode', 'description', 'priority', 'goal', 'outcomeMetric', 'baseline', 'target', 'reviewDue'],
  CarePlanInterventions: ['interventionId', 'carePlanId', 'problemId', 'serviceType', 'instructions', 'count', 'unit', 'durationMinutes', 'dateFrom', 'dateTo', 'requiredQualification', 'schedulePatternJson'],
  StaffAssignments: ['assignmentId', 'episodeId', 'staffId', 'role', 'dateFrom', 'dateTo', 'status', 'assignedBy'],
  VisitSchedules: ['visitId', 'episodeId', 'carePlanId', 'interventionId', 'assignedStaffId', 'visitDateTime', 'expectedEndTime', 'visitType', 'status', 'generationKey', 'version', 'rescheduleReason'],
  VisitEncounters: ['encounterId', 'visitId', 'episodeId', 'performerId', 'startedAt', 'endedAt', 'source', 'notes', 'vitalsJson', 'submissionId', 'status', 'reviewedBy', 'reviewedAt', 'reviewNotes', 'createdAt', 'updatedAt', 'createdBy', 'recordVersion'],
  VisitActivities: ['visitActivityId', 'encounterId', 'interventionId', 'activityCode', 'completed', 'notes', 'varianceReason'],
  VisitFiles: ['fileRecordId', 'encounterId', 'driveFileId', 'fileName', 'mimeType', 'fileSize', 'uploadedBy', 'consentRef', 'scanStatus'],
  Alerts: ['alertId', 'episodeId', 'encounterId', 'severity', 'alertType', 'eventAt', 'status', 'assignedTo', 'closedAt'],
  Referrals: ['referralId', 'episodeId', 'reason', 'priority', 'destination', 'createdBy', 'createdAt', 'status', 'closedAt'],
  ServiceRuleSets: ['rulesetId', 'fiscalYear', 'policyName', 'sourceUrl', 'validFrom', 'validTo', 'status', 'approvedBy', 'approvedAt'],
  ServiceFrequencyRules: ['ruleId', 'rulesetId', 'groupNumber', 'serviceType', 'count', 'unit', 'enabled', 'notes'],
  PatientConsents: ['consentId', 'patientId', 'purpose', 'legalBasis', 'givenBy', 'evidenceFileId', 'givenAt', 'revokedAt'],
  NotificationOutbox: ['notificationId', 'userId', 'templateCode', 'safePayloadJson', 'channel', 'status', 'attemptCount', 'notBefore', 'sentAt', 'idempotencyKey'],
  AuditLogs: ['auditId', 'actorId', 'action', 'entityType', 'entityId', 'timestamp', 'outcome', 'reason', 'changeSummaryRedacted'],
  SyncReceipts: ['submissionId', 'actorId', 'entityType', 'entityId', 'receivedAt', 'result', 'checksum'],
  JobRuns: ['jobRunId', 'jobType', 'startedAt', 'finishedAt', 'status', 'processedCount', 'errorSummary'],
  IndexRegistry: ['keyType', 'keyValue', 'entityId', 'sourceSheet', 'rowHint', 'updatedAt'],
  GatewayNonces: ['nonce', 'expiresAtEpoch', 'receivedAt'],
  Holidays: ['holidayId', 'localDate', 'name', 'active'],
  VisitImages: VISIT_IMAGE_COLUMNS,
  Visit_Records: VISIT_RECORD_COLUMNS,
  CaregiverProfiles: ['userId', 'cidCiphertext', 'cidLookupHash', 'birthDate', 'phone', 'address', 'email', 'photoFileId', 'photoUrl', 'education', 'organizationName', 'organizationType', 'serviceArea', 'trainingsJson', 'createdAt', 'updatedAt', 'createdBy', 'recordVersion']
};

/** Sheets that store typed-in text such as phone numbers and times: keep them as text (leading 0s). */
const TEXT_SHEETS = ['VisitImages', 'Visit_Records', 'CaregiverProfiles'];

/** Adds a sheet introduced after the workbook was initialized, so a deploy needs no manual step. */
export function ensureSheet(name: string): void {
  const headers = SHEETS[name];
  if (!headers) throw new Error(`UNKNOWN_SHEET:${name}`);
  const spreadsheet = getSpreadsheet();
  if (spreadsheet.getSheetByName(name)) return;
  const sheet = spreadsheet.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  if (TEXT_SHEETS.includes(name)) sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
}

/** Columns that hold typed-in codes or phone numbers in sheets that otherwise hold mixed data. */
const TEXT_COLUMNS: Record<string, string[]> = { Patients: ['localCode', 'hn', 'phone', 'mainCaregiverPhone', 'villageNo'] };

/**
 * Appends columns added to SHEETS after the sheet was created, so a deploy needs no manual step.
 * Existing columns are never moved: rows are read and written by header name.
 */
export function ensureColumns(name: string): void {
  const headers = SHEETS[name];
  if (!headers) throw new Error(`UNKNOWN_SHEET:${name}`);
  const sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(`SHEET_MISSING:${name}`);
  const lastColumn = sheet.getLastColumn();
  const existing = lastColumn ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0]!.map(String) : [];
  const missing = headers.filter((header) => !existing.includes(header));
  if (missing.length) sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  const all = [...existing, ...missing];
  for (const column of TEXT_COLUMNS[name] ?? []) {
    const index = all.indexOf(column);
    if (index >= 0 && missing.includes(column)) sheet.getRange(1, index + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
  }
}

export function initializeDemoWorkbook(requireDemo = true): { created: string[] } {
  if (requireDemo) requireDemoMode();
  const spreadsheet = getSpreadsheet();
  const created: string[] = [];
  for (const [name, headers] of Object.entries(SHEETS)) {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(name);
      created.push(name);
    }
    if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    if (TEXT_SHEETS.includes(name)) sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
  }
  return { created };
}

