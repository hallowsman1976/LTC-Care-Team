import { getAppMode, getRequiredProperty } from '../config';
import { SHEETS } from '../initializer';
import { bulkAppend, getById, getSheet, listAll, type RowRecord } from '../repositories/sheets';
import { bytesToHex } from '../utils/encoding';
import { setDemoCredential } from './credentials';

// Synthetic volume and in-process timing for capacity testing on a DEMO workbook. Both functions
// refuse to run unless APP_MODE=DEMO and the LOAD_TEST_ALLOWED Script Property is "true".

const TIME_ZONE = 'Asia/Bangkok';
const CHUNK_ROWS = 5_000;

function requireLoadTestWorkbook(): void {
  if (getAppMode() !== 'DEMO') throw new Error('DEMO_MODE_REQUIRED');
  if (PropertiesService.getScriptProperties().getProperty('LOAD_TEST_ALLOWED') !== 'true') throw new Error('LOAD_TEST_NOT_ALLOWED');
}

export interface LoadTestOptions {
  patients?: number;
  caregivers?: number;
  /** History to generate, in months back from today; 30 days ahead are always added. */
  months?: number;
  visitsPerWeek?: number;
  /** When set, every load caregiver gets this password with identifier `load.cg.<n>`. */
  password?: string;
}

function write(sheetName: string, records: RowRecord[]): number {
  const sheet = getSheet(sheetName);
  const headers = SHEETS[sheetName]!;
  for (let start = 0; start < records.length; start += CHUNK_ROWS) bulkAppend(sheet, headers, records.slice(start, start + CHUNK_ROWS));
  return records.length;
}

/**
 * Appends synthetic patients, assignments, a visit history with encounters, receipts and audit
 * rows, at the volume a pilot would reach after `months`. Start small (months: 3) and grow: one
 * Apps Script run is limited to 6 minutes.
 */
export function seedLoadTestData(options: LoadTestOptions = {}): { rows: Record<string, number>; caregiverUserIds: string[]; elapsedMs: number } {
  requireLoadTestWorkbook();
  const started = Date.now();
  const patients = options.patients ?? 100;
  const caregivers = Math.max(1, options.caregivers ?? 10);
  const months = options.months ?? 12;
  const perWeek = Math.min(7, Math.max(1, options.visitsPerWeek ?? 2));
  const weekdays = Array.from({ length: perWeek }, (_, index) => 1 + Math.floor((index * 7) / perWeek));
  const now = new Date().toISOString();
  const today = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');

  const caregiverUserIds = Array.from({ length: caregivers }, (_, index) => `usr-load-cg-${index + 1}`);
  const newUsers = caregiverUserIds.filter((userId) => !getById('Users', 'userId', userId))
    .map((userId) => ({ userId, identitySubject: '', email: `${userId}@demo.invalid`, usernameNormalized: userId, displayName: `CG ทดสอบโหลด ${userId.slice(12)}`, role: 'CG', enabled: 'true', createdAt: now, updatedAt: now }));

  const patientRows: RowRecord[] = [];
  const episodes: RowRecord[] = [];
  const assignments: RowRecord[] = [];
  for (let index = 1; index <= patients; index += 1) {
    const suffix = `${index}`.padStart(5, '0');
    patientRows.push({ patientId: `pt-load-${suffix}`, localCode: `LOAD-${suffix}`, hn: `HN-LOAD-${suffix}`, fullName: `ผู้ป่วยทดสอบโหลด ${suffix}`, birthDate: '1950-01-01', sex: 'UNKNOWN', address: 'ที่อยู่จำลอง', village: `หมู่ ${1 + (index % 9)}`, status: 'ACTIVE', createdAt: now, updatedAt: now, createdBy: 'load-test', recordVersion: 1 });
    episodes.push({ episodeId: `ep-load-${suffix}`, patientId: `pt-load-${suffix}`, startDate: today, status: 'ACTIVE', eligibilityStatus: 'ELIGIBLE', fundingType: 'LTC', legalBasis: 'PUBLIC_HEALTH' });
    assignments.push({ assignmentId: `as-load-${suffix}`, episodeId: `ep-load-${suffix}`, staffId: caregiverUserIds[index % caregivers], role: 'CG', dateFrom: today, status: 'ACTIVE', assignedBy: 'load-test' });
  }

  const visits: RowRecord[] = [];
  const encounters: RowRecord[] = [];
  const receipts: RowRecord[] = [];
  const audits: RowRecord[] = [];
  const alerts: RowRecord[] = [];
  const firstDay = Date.now() - months * 30 * 86_400_000;
  const lastDay = Date.now() + 30 * 86_400_000;
  for (let instant = firstDay; instant <= lastDay; instant += 86_400_000) {
    const day = new Date(instant);
    if (!weekdays.includes(Number(Utilities.formatDate(day, TIME_ZONE, 'u')))) continue;
    const date = Utilities.formatDate(day, TIME_ZONE, 'yyyy-MM-dd');
    const past = date < today;
    episodes.forEach((episode, index) => {
      const staffId = String(assignments[index]!.staffId);
      const visitId = `vs-load-${date}-${index + 1}`;
      visits.push({ visitId, episodeId: episode.episodeId, carePlanId: '', interventionId: '', assignedStaffId: staffId, visitDateTime: `${date}T09:00:00+07:00`, expectedEndTime: `${date}T10:00:00+07:00`, visitType: 'เยี่ยมบ้าน (ทดสอบโหลด)', status: past ? 'VERIFIED' : 'ASSIGNED', generationKey: visitId, version: 1, rescheduleReason: '' });
      if (!past) return;
      const encounterId = `enc-${visitId}`;
      const submissionId = Utilities.getUuid();
      const submittedAt = `${date}T03:00:00.000Z`;
      const reviewedAt = `${date}T09:00:00.000Z`;
      encounters.push({ encounterId, visitId, episodeId: episode.episodeId, performerId: staffId, startedAt: `${date}T09:00`, endedAt: `${date}T10:00`, source: 'ONLINE', notes: '', vitalsJson: '{}', submissionId, status: 'VERIFIED', reviewedBy: 'usr-load-cm', reviewedAt, reviewNotes: '', createdAt: submittedAt, updatedAt: reviewedAt, createdBy: staffId, recordVersion: 2 });
      receipts.push({ submissionId, actorId: staffId, entityType: 'VisitEncounter', entityId: encounterId, receivedAt: submittedAt, result: 'COMMITTED', checksum: '' });
      audits.push({ auditId: Utilities.getUuid(), actorId: staffId, action: 'visit.submit', entityType: 'VisitEncounter', entityId: encounterId, timestamp: submittedAt, outcome: 'SUCCESS', reason: '', changeSummaryRedacted: '' });
      audits.push({ auditId: Utilities.getUuid(), actorId: 'usr-load-cm', action: 'encounter.review', entityType: 'VisitEncounter', entityId: encounterId, timestamp: reviewedAt, outcome: 'SUCCESS', reason: 'VERIFIED', changeSummaryRedacted: '' });
      if (encounters.length % 50 === 0) alerts.push({ alertId: `al-${encounterId}`, episodeId: episode.episodeId, encounterId, severity: 'HIGH', alertType: 'CG_URGENT_FLAG', eventAt: submittedAt, status: 'CLOSED', assignedTo: '', closedAt: reviewedAt });
    });
  }
  // AuditLogs must stay in time order for archiveAuditLogs.
  audits.sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)));

  const rows: Record<string, number> = {
    Users: write('Users', newUsers), Patients: write('Patients', patientRows), CareEpisodes: write('CareEpisodes', episodes),
    StaffAssignments: write('StaffAssignments', assignments), VisitSchedules: write('VisitSchedules', visits),
    VisitEncounters: write('VisitEncounters', encounters), SyncReceipts: write('SyncReceipts', receipts),
    AuditLogs: write('AuditLogs', audits), Alerts: write('Alerts', alerts)
  };
  if (options.password) caregiverUserIds.forEach((userId, index) => setDemoCredential(userId, `load.cg.${index + 1}`, options.password!));
  return { rows, caregiverUserIds, elapsedMs: Date.now() - started };
}

type DoPost = (event: GoogleAppsScript.Events.DoPost) => GoogleAppsScript.Content.TextOutput;

/** Builds a request signed exactly as apps/gateway/src/gasProxy.ts does. */
function signedEvent(action: string, subject: string, payload: Record<string, unknown>): GoogleAppsScript.Events.DoPost {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 60;
  const nonce = Utilities.getUuid();
  const bodyHash = bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(payload), Utilities.Charset.UTF_8));
  const canonical = [action, subject, String(iat), String(exp), nonce, bodyHash].join('\n');
  const signature = Utilities.base64Encode(Utilities.computeHmacSha256Signature(canonical, getRequiredProperty('GATEWAY_ASSERTION_SECRET')));
  const contents = JSON.stringify({ apiVersion: 'v1', action, requestId: Utilities.getUuid(), auth: { subject, iat, exp, nonce, bodyHash, signature }, payload });
  return { postData: { contents } } as unknown as GoogleAppsScript.Events.DoPost;
}

const median = (values: number[]) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0;

/**
 * Times the main server paths in-process (signature check, nonce, actor lookup and the action),
 * which excludes network and gateway time. visit.submit writes real rows to the DEMO workbook.
 */
export function runLoadProbe(handle: DoPost, repeats = 3): { medianMs: Record<string, number>; errors: Record<string, string>; sheetRows: Record<string, number> } {
  requireLoadTestWorkbook();
  const caregiver = listAll('Users', (row) => String(row.userId).startsWith('usr-load-cg-'))[0];
  if (!caregiver) throw new Error('RUN_seedLoadTestData_FIRST');
  const userId = String(caregiver.userId);
  const schedule = getSheet('VisitSchedules');
  const visitIdColumn = SHEETS.VisitSchedules!.indexOf('visitId') + 1;
  const lastVisitId = String(schedule.getRange(schedule.getLastRow(), visitIdColumn).getValues()[0]?.[0] ?? '');
  const openVisit = listAll('VisitSchedules', (row) => String(row.assignedStaffId) === userId && String(row.status) === 'ASSIGNED')[0];

  const errors: Record<string, string> = {};
  const call = (label: string, action: string, payload: () => Record<string, unknown>) => () => {
    const output = JSON.parse(handle(signedEvent(action, userId, payload())).getContent()) as { ok: boolean; code: string };
    if (!output.ok) errors[label] = output.code;
  };
  const operations: Array<[string, () => void]> = [
    ['doPost visit.list', call('doPost visit.list', 'visit.list', () => ({}))],
    ['doPost dashboard.summary', call('doPost dashboard.summary', 'dashboard.summary', () => ({}))],
    ['doPost patient.list', call('doPost patient.list', 'patient.list', () => ({ limit: 50 }))],
    ['doPost visit.submit', call('doPost visit.submit', 'visit.submit', () => ({
      visitId: String(openVisit?.visitId ?? ''), submissionId: Utilities.getUuid(), source: 'ONLINE', startedAt: '09:00', endedAt: '10:00',
      activityCompleted: true, urgentFlag: false, notes: 'load probe', vitals: {}
    }))],
    ['getById VisitSchedules (last row)', () => { getById('VisitSchedules', 'visitId', lastVisitId); }],
    ['listAll VisitSchedules', () => { listAll('VisitSchedules', () => true); }]
  ];
  const medianMs: Record<string, number> = {};
  for (const [label, operation] of operations) {
    const timings: number[] = [];
    for (let attempt = 0; attempt < repeats; attempt += 1) {
      const started = Date.now();
      operation();
      timings.push(Date.now() - started);
    }
    medianMs[label] = median(timings);
  }
  const sheetRows = Object.fromEntries(['Patients', 'VisitSchedules', 'VisitEncounters', 'SyncReceipts', 'AuditLogs', 'GatewayNonces']
    .map((name) => [name, Math.max(0, getSheet(name).getLastRow() - 1)]));
  console.log(JSON.stringify({ medianMs, errors, sheetRows }));
  return { medianMs, errors, sheetRows };
}
