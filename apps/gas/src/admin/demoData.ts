import { getAppMode } from '../config';
import { appendUnique, getById, listAll, withScriptLock, type RowRecord } from '../repositories/sheets';
import { audit } from '../security/audit';

// A small, fixed sample so a fresh DEMO workbook shows something on every screen. Every row has a
// fixed id, so running it again only adds what is missing; dates are relative to the run day.

const TIME_ZONE = 'Asia/Bangkok';
export const DEMO_RULESET_ID = 'rs-demo-2569';
export const DEMO_CM_USER_ID = 'usr-demo-cm';

const PATIENTS = [
  { suffix: '001', fullName: 'นางสมศรี ตัวอย่าง', birthDate: '1942-03-15', sex: 'FEMALE', village: 'หมู่ 2' },
  { suffix: '002', fullName: 'นายบุญมา ทดลอง', birthDate: '1938-11-02', sex: 'MALE', village: 'หมู่ 5' },
  { suffix: '003', fullName: 'นางทองใบ สาธิต', birthDate: '1947-07-21', sex: 'FEMALE', village: 'หมู่ 7' }
];

function userIdFor(identifier: string): string | null {
  const normalized = identifier.trim().toLowerCase();
  const credential = listAll('AuthCredentials', (row) => String(row.status) === 'ACTIVE' && String(row.identifierNormalized).toLowerCase() === normalized)[0];
  return credential ? String(credential.userId) : null;
}

function bangkokDate(offsetDays: number): string {
  return Utilities.formatDate(new Date(Date.now() + offsetDays * 86_400_000), TIME_ZONE, 'yyyy-MM-dd');
}

/**
 * Run from the Apps Script editor after setDemoCredential for the caregiver. Assigns three sample
 * patients to the caregiver signed in as `cgIdentifier`, with visits yesterday (overdue), today and
 * in the coming days, one visit already submitted for CM review, an approved ruleset for care
 * plans, and a CM user (usr-demo-cm) with a valid clinical credential. Then give the CM a password
 * with setDemoCredential('usr-demo-cm', 'cm.demo', '...') and enrol TOTP.
 */
export function seedDemoData(cgIdentifier = 'cg.demo'): { caregiverUserId: string; added: Record<string, number> } {
  if (getAppMode() !== 'DEMO') throw new Error('DEMO_MODE_REQUIRED');
  const caregiverUserId = userIdFor(cgIdentifier);
  if (!caregiverUserId) throw new Error('RUN_setDemoCredential_FOR_CAREGIVER_FIRST');
  const caregiver = getById('Users', 'userId', caregiverUserId);
  if (!caregiver || String(caregiver.role) !== 'CG') throw new Error('CAREGIVER_USER_ROW_REQUIRED');

  const now = new Date().toISOString();
  const today = bangkokDate(0);
  const added: Record<string, number> = {};
  const add = (sheet: string, idColumn: string, record: RowRecord) => {
    if (getById(sheet, idColumn, String(record[idColumn]))) return;
    appendUnique(sheet, idColumn, record);
    added[sheet] = (added[sheet] ?? 0) + 1;
  };

  withScriptLock(() => {
    add('Users', 'userId', { userId: DEMO_CM_USER_ID, identitySubject: '', email: 'cm.demo@demo.invalid', usernameNormalized: 'cm.demo', displayName: 'CM ตัวอย่าง', role: 'CM', enabled: 'true', createdAt: now, updatedAt: now });
    add('StaffProfiles', 'staffId', { staffId: 'stf-demo-cm', userId: DEMO_CM_USER_ID, staffType: 'CM', credentialType: 'CM_CERTIFICATE_DEMO', credentialVerifiedAt: today, qualificationExpiry: bangkokDate(365) });
    add('ServiceRuleSets', 'rulesetId', { rulesetId: DEMO_RULESET_ID, fiscalYear: '2569', policyName: 'ชุดกฎบริการตัวอย่าง (DEMO)', sourceUrl: '', validFrom: `${today.slice(0, 4)}-01-01`, validTo: `${today.slice(0, 4)}-12-31`, status: 'APPROVED', approvedBy: DEMO_CM_USER_ID, approvedAt: now });

    PATIENTS.forEach((patient, index) => {
      const patientId = `pt-demo-${patient.suffix}`;
      const episodeId = `ep-demo-${patient.suffix}`;
      add('Patients', 'patientId', { patientId, localCode: `DEMO-${patient.suffix}`, hn: `HN-DEMO-${patient.suffix}`, cidCiphertext: '', cidLookupHash: '', fullName: patient.fullName, birthDate: patient.birthDate, sex: patient.sex, address: 'ข้อมูลสมมติ ไม่ใช่บุคคลจริง', village: patient.village, phone: '', status: 'ACTIVE', createdAt: now, updatedAt: now, createdBy: 'demo-seed', recordVersion: 1 });
      add('CareEpisodes', 'episodeId', { episodeId, patientId, startDate: bangkokDate(-30), endDate: '', eligibilityStatus: 'ELIGIBLE', status: 'ACTIVE', fundingType: 'LTC', legalBasis: 'PUBLIC_HEALTH' });
      add('StaffAssignments', 'assignmentId', { assignmentId: `as-demo-${patient.suffix}`, episodeId, staffId: caregiverUserId, role: 'CG', dateFrom: bangkokDate(-30), dateTo: '', status: 'ACTIVE', assignedBy: DEMO_CM_USER_ID });
      // Yesterday (overdue), today, and two upcoming visits, staggered by patient.
      [-1, 0, 2 + index, 7 + index].forEach((offset) => {
        const date = bangkokDate(offset);
        const hour = `${9 + index}`.padStart(2, '0');
        const visitId = `vs-demo-${patient.suffix}-${offset < 0 ? 'm' : 'p'}${Math.abs(offset)}`;
        add('VisitSchedules', 'visitId', { visitId, episodeId, carePlanId: '', interventionId: '', assignedStaffId: caregiverUserId, visitDateTime: `${date}T${hour}:00:00+07:00`, expectedEndTime: `${date}T${hour}:45:00+07:00`, visitType: 'เยี่ยมบ้าน (ตัวอย่าง)', status: 'ASSIGNED', generationKey: visitId, version: 1, rescheduleReason: '' });
      });
    });

    // One earlier visit already submitted, so the CM review queue is not empty.
    const reviewDate = bangkokDate(-3);
    add('VisitSchedules', 'visitId', { visitId: 'vs-demo-001-m3', episodeId: 'ep-demo-001', carePlanId: '', interventionId: '', assignedStaffId: caregiverUserId, visitDateTime: `${reviewDate}T09:00:00+07:00`, expectedEndTime: `${reviewDate}T09:45:00+07:00`, visitType: 'เยี่ยมบ้าน (ตัวอย่าง)', status: 'ASSIGNED', generationKey: 'vs-demo-001-m3', version: 1, rescheduleReason: '' });
    add('VisitEncounters', 'encounterId', { encounterId: 'enc-demo-001-m3', visitId: 'vs-demo-001-m3', episodeId: 'ep-demo-001', performerId: caregiverUserId, startedAt: '09:05', endedAt: '09:40', source: 'ONLINE', notes: 'วัดสัญญาณชีพ ช่วยทำกายภาพเบื้องต้น ผู้ป่วยรู้สึกตัวดี', vitalsJson: JSON.stringify({ temperature: 36.8, pulse: 78 }), submissionId: 'sub-demo-001-m3', status: 'SUBMITTED', reviewedBy: '', reviewedAt: '', reviewNotes: '', createdAt: now, updatedAt: now, createdBy: caregiverUserId, recordVersion: 1 });
  });

  audit('editor', 'demo.seed', 'Workbook', '*', 'SUCCESS', Object.entries(added).map(([sheet, count]) => `${sheet}:${count}`).join(';'));
  const result = { caregiverUserId, added };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
