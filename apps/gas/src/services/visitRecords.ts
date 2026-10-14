import type { Actor, AdlItems, ImageKind, VisitContext } from '@smart-ltc/shared';
import {
  calculateAdlTotal, calculateBmi, interpretBmi, interpretQ8, interpretQ9, mentalHealthAlert, Q8_QUESTIONS, Q9_FREQUENCIES, scoreQ8, sum,
  visitContextSchema, visitImageUploadSchema, visitRecordSubmitSchema
} from '@smart-ltc/shared';
import { getAppMode, getRequiredProperty } from '../config';
import { appendUnique, getById, listAll, listPage, updateWhere, withScriptLock, type RowRecord } from '../repositories/sheets';
import { audit } from '../security/audit';
import { requireCapability } from '../security/rbac';

// The full home-visit form. Images are uploaded first (one request each, so the browser can show
// progress), then the record is submitted with their ids. The record also creates the
// VisitEncounter that the CM reviews, so the existing review workflow applies unchanged.

const TIME_ZONE = 'Asia/Bangkok';

const ADL_COLUMNS: Array<[keyof AdlItems, string]> = [
  ['feeding', 'ADL 1 รับประทานอาหาร'], ['grooming', 'ADL 2 ล้างหน้า หวีผม แปรงฟัน'], ['transfer', 'ADL 3 ลุกนั่ง'],
  ['toiletUse', 'ADL 4 ใช้ห้องน้ำ'], ['mobility', 'ADL 5 เคลื่อนที่'], ['dressing', 'ADL 6 สวมใส่เสื้อผ้า'],
  ['stairs', 'ADL 7 ขึ้นลงบันได'], ['bathing', 'ADL 8 อาบน้ำ'], ['bowels', 'ADL 9 กลั้นอุจจาระ'], ['bladder', 'ADL 10 กลั้นปัสสาวะ']
];

export const VISIT_RECORD_COLUMNS = [
  'รหัสบันทึก', 'วันเวลาที่บันทึก', 'รหัสนัดเยี่ยม', 'รหัสผู้รับบริการ', 'ชื่อผู้รับบริการ', 'ครั้งที่เยี่ยม', 'วันที่เยี่ยม', 'เวลาเยี่ยม', 'เวลาสิ้นสุด',
  'รหัสผู้เยี่ยม', 'ผู้เยี่ยม', 'ชื่อผู้ดูแล', 'ความสัมพันธ์', 'เบอร์ติดต่อ',
  'น้ำหนัก (กก.)', 'ส่วนสูง (ซม.)', 'ดัชนีมวลกาย', 'แปลผลดัชนีมวลกาย',
  'อุณหภูมิ (°C)', 'ชีพจร (ครั้ง/นาที)', 'การหายใจ (ครั้ง/นาที)', 'ความดันโลหิต (mmHg)',
  ...ADL_COLUMNS.map(([, column]) => column), 'คะแนน ADL รวม',
  '2Q ข้อ 1', '2Q ข้อ 2', 'ผลคัดกรอง 2Q', '9Q คำตอบ', 'คะแนน 9Q', 'ผล 9Q', '8Q คำตอบ', 'คะแนน 8Q', 'ผล 8Q',
  'กิจกรรมด้านการช่วยเหลือประจำวัน', 'กิจกรรมด้านสุขภาพพื้นฐาน', 'กิจกรรมด้านอื่นๆ',
  'URL รูปผู้สูงอายุ', 'URL รูปกิจกรรม', 'URL ลายเซ็น', 'เรื่องเร่งด่วน', 'บันทึกเพิ่มเติม', 'รหัสการส่ง'
];

export const VISIT_IMAGE_COLUMNS = ['imageId', 'visitId', 'kind', 'driveFileId', 'url', 'fileName', 'fileSize', 'uploadedBy', 'uploadedAt', 'recordId'];

const FOLDER_PROPERTY: Record<ImageKind, string> = {
  OLDER: 'OLDER_IMAGE_FOLDER_ID', SERVICE: 'SERVICE_IMAGE_FOLDER_ID', SIGNATURE: 'SIGNATURE_FOLDER_ID'
};

const imageUrl = (driveFileId: string) => `https://lh3.googleusercontent.com/d/${driveFileId}`;

interface AssignedVisit { visit: RowRecord; patient: RowRecord }

/** The visit must be the caregiver's own; the patient comes from its episode, never from the client. */
function assignedVisit(actor: Actor, visitId: string): AssignedVisit {
  const visit = getById('VisitSchedules', 'visitId', visitId);
  if (!visit || String(visit.assignedStaffId) !== actor.userId) throw new Error('VISIT_NOT_ASSIGNED');
  const episode = getById('CareEpisodes', 'episodeId', String(visit.episodeId));
  const patient = episode ? getById('Patients', 'patientId', String(episode.patientId)) : null;
  if (!patient) throw new Error('PATIENT_NOT_FOUND');
  return { visit, patient };
}

function visitCountFor(patientId: string): number {
  return listAll('Visit_Records', (row) => String(row['รหัสผู้รับบริการ']) === patientId).length;
}

function displayNameOf(userId: string): string {
  return String(getById('Users', 'userId', userId)?.displayName ?? '') || userId;
}

export function visitContext(actor: Actor, payload: Record<string, unknown>): VisitContext {
  requireCapability(actor, 'patients:read');
  const { visitId } = visitContextSchema.parse(payload);
  const { visit, patient } = assignedVisit(actor, visitId);
  return {
    visitId, patientName: String(patient.fullName), visitType: String(visit.visitType ?? ''), visitDateTime: String(visit.visitDateTime ?? ''),
    visitNumber: visitCountFor(String(patient.patientId)) + 1, visitorName: displayNameOf(actor.userId)
  };
}

export function uploadVisitImage(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'patients:read');
  const input = visitImageUploadSchema.parse(payload);
  const { visit, patient } = assignedVisit(actor, input.visitId);
  if (String(visit.status) !== 'ASSIGNED') throw new Error('VISIT_NOT_OPEN');
  const demo = getAppMode() === 'DEMO';
  if (!demo) {
    // Real photos and signatures need the patient's recorded consent.
    const consent = listPage('PatientConsents', (row) => String(row.patientId) === String(patient.patientId) && !String(row.revokedAt), 1)[0];
    if (!consent) throw new Error('ACTIVE_CONSENT_REQUIRED');
  }
  const bytes = Utilities.base64Decode(input.base64);
  if (bytes.length < 1 || bytes.length > 3 * 1024 * 1024) throw new Error('FILE_SIZE_NOT_ALLOWED');
  // No patient name in the file name: Drive shows it in listings and search.
  const stamp = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyyMMdd-HHmmss');
  const fileName = `${input.kind}_${String(patient.patientId)}_${stamp}.${input.mimeType === 'image/png' ? 'png' : 'jpg'}`;
  const file = DriveApp.getFolderById(getRequiredProperty(FOLDER_PROPERTY[input.kind])).createFile(Utilities.newBlob(bytes, input.mimeType, fileName));
  // lh3 links only open for files shared by link. Synthetic DEMO data only; PILOT files stay private.
  if (demo) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const imageId = Utilities.getUuid();
  const record = appendUnique('VisitImages', 'imageId', {
    imageId, visitId: input.visitId, kind: input.kind, driveFileId: file.getId(), url: imageUrl(file.getId()), fileName,
    fileSize: bytes.length, uploadedBy: actor.userId, uploadedAt: new Date().toISOString(), recordId: ''
  });
  audit(actor.userId, 'visitImage.upload', 'VisitImage', imageId, 'SUCCESS', input.kind);
  return { imageId, url: record.url };
}

function claimImage(actor: Actor, imageId: string, visitId: string, kind: ImageKind): RowRecord {
  const image = getById('VisitImages', 'imageId', imageId);
  if (!image || String(image.uploadedBy) !== actor.userId || String(image.visitId) !== visitId || String(image.kind) !== kind || String(image.recordId)) {
    throw new Error('IMAGE_NOT_USABLE');
  }
  return image;
}

const joinList = (values: readonly string[]) => values.join(', ');

export function submitVisitRecord(actor: Actor, payload: Record<string, unknown>): Record<string, unknown> {
  requireCapability(actor, 'patients:read');
  const input = visitRecordSubmitSchema.parse(payload);
  return withScriptLock(() => {
    if (getById('SyncReceipts', 'submissionId', input.submissionId)) {
      const existing = getById('VisitEncounters', 'submissionId', input.submissionId);
      if (!existing) throw new Error('PARTIAL_COMMIT_REQUIRES_RECONCILIATION');
      return { encounterId: existing.encounterId, status: existing.status, duplicate: true };
    }
    const { visit, patient } = assignedVisit(actor, input.visitId);
    if (String(visit.status) !== 'ASSIGNED') throw new Error('VISIT_NOT_OPEN');
    if (listPage('Visit_Records', (row) => String(row['รหัสนัดเยี่ยม']) === input.visitId, 1).length) throw new Error('VISIT_ALREADY_RECORDED');
    const older = claimImage(actor, input.olderImageId, input.visitId, 'OLDER');
    const service = claimImage(actor, input.serviceImageId, input.visitId, 'SERVICE');
    const signature = claimImage(actor, input.signatureImageId, input.visitId, 'SIGNATURE');

    const patientId = String(patient.patientId);
    const visitNumber = visitCountFor(patientId) + 1;
    const bmi = calculateBmi(input.weightKg, input.heightCm);
    const adlTotal = calculateAdlTotal(input.adl);
    const screenPositive = input.q2.some(Boolean);
    const q9Score = input.q9 ? sum(input.q9) : null;
    const q8Score = input.q8 ? scoreQ8(input.q8.answers, input.q8.canControl) : null;
    const bloodPressure = `${input.vitals.systolic}/${input.vitals.diastolic}`;
    const encounterId = Utilities.getUuid();
    const now = new Date().toISOString();
    const yes = (value: boolean) => (value ? 'มี' : 'ไม่มี');

    // A readable summary for the CM review page; the full record is in Visit_Records.
    const summary = [
      `ครั้งที่เยี่ยม: ${visitNumber}`,
      `ผู้ดูแล: ${input.caregiverName} (${input.caregiverRelation}) โทร ${input.caregiverPhone}`,
      `ดัชนีมวลกาย: ${bmi} (${interpretBmi(bmi)}) · น้ำหนัก ${input.weightKg} กก. ส่วนสูง ${input.heightCm} ซม.`,
      `ความดันโลหิต ${bloodPressure} mmHg · หายใจ ${input.vitals.respiration} ครั้ง/นาที`,
      `ADL: ${adlTotal}/20`,
      `2Q: ${screenPositive ? 'ผลคัดกรองผิดปกติ' : 'ปกติ'}`,
      ...(q9Score === null ? [] : [`9Q: ${q9Score} คะแนน (${interpretQ9(q9Score)})`]),
      ...(q8Score === null ? [] : [`8Q: ${q8Score} คะแนน (${interpretQ8(q8Score)})`]),
      ...([['ช่วยเหลือประจำวัน', input.dailyCare], ['สุขภาพพื้นฐาน', input.basicHealth], ['ด้านอื่น ๆ', input.otherCare]] as const)
        .filter(([, items]) => items.length).map(([label, items]) => `กิจกรรม${label}: ${joinList(items)}`),
      ...(input.notes.trim() ? [`บันทึกเพิ่มเติม: ${input.notes.trim()}`] : [])
    ].join('\n');

    appendUnique('VisitEncounters', 'encounterId', {
      encounterId, visitId: input.visitId, episodeId: visit.episodeId, performerId: actor.userId,
      startedAt: `${input.visitDate}T${input.startTime}`, endedAt: `${input.visitDate}T${input.endTime}`, source: 'ONLINE', notes: summary,
      vitalsJson: JSON.stringify(input.vitals), submissionId: input.submissionId, status: 'SUBMITTED',
      reviewedBy: '', reviewedAt: '', reviewNotes: '', createdAt: now, updatedAt: now, createdBy: actor.userId, recordVersion: 1
    });
    appendUnique('Visit_Records', 'รหัสบันทึก', {
      'รหัสบันทึก': encounterId, 'วันเวลาที่บันทึก': now, 'รหัสนัดเยี่ยม': input.visitId, 'รหัสผู้รับบริการ': patientId,
      'ชื่อผู้รับบริการ': patient.fullName, 'ครั้งที่เยี่ยม': visitNumber, 'วันที่เยี่ยม': input.visitDate, 'เวลาเยี่ยม': input.startTime,
      'เวลาสิ้นสุด': input.endTime, 'รหัสผู้เยี่ยม': actor.userId, 'ผู้เยี่ยม': displayNameOf(actor.userId), 'ชื่อผู้ดูแล': input.caregiverName,
      'ความสัมพันธ์': input.caregiverRelation, 'เบอร์ติดต่อ': input.caregiverPhone,
      'น้ำหนัก (กก.)': input.weightKg, 'ส่วนสูง (ซม.)': input.heightCm, 'ดัชนีมวลกาย': bmi, 'แปลผลดัชนีมวลกาย': interpretBmi(bmi),
      'อุณหภูมิ (°C)': input.vitals.temperature, 'ชีพจร (ครั้ง/นาที)': input.vitals.pulse, 'การหายใจ (ครั้ง/นาที)': input.vitals.respiration,
      'ความดันโลหิต (mmHg)': bloodPressure,
      ...Object.fromEntries(ADL_COLUMNS.map(([key, column]) => [column, input.adl[key]])), 'คะแนน ADL รวม': adlTotal,
      '2Q ข้อ 1': yes(input.q2[0]), '2Q ข้อ 2': yes(input.q2[1]), 'ผลคัดกรอง 2Q': screenPositive ? 'ผิดปกติ (ประเมิน 9Q ต่อ)' : 'ปกติ',
      '9Q คำตอบ': input.q9 ? input.q9.map((score, index) => `${index + 1}:${Q9_FREQUENCIES[score]}`).join(', ') : '',
      'คะแนน 9Q': q9Score ?? '', 'ผล 9Q': q9Score === null ? '' : interpretQ9(q9Score),
      '8Q คำตอบ': input.q8 ? Q8_QUESTIONS.map((_, index) => `${index + 1}:${yes(input.q8!.answers[index]!)}`).join(', ')
        + (input.q8.answers[2] ? `, ควบคุมได้:${input.q8.canControl ? 'ได้' : 'ไม่ได้'}` : '') : '',
      'คะแนน 8Q': q8Score ?? '', 'ผล 8Q': q8Score === null ? '' : interpretQ8(q8Score),
      'กิจกรรมด้านการช่วยเหลือประจำวัน': joinList(input.dailyCare), 'กิจกรรมด้านสุขภาพพื้นฐาน': joinList(input.basicHealth),
      'กิจกรรมด้านอื่นๆ': joinList(input.otherCare),
      'URL รูปผู้สูงอายุ': older.url, 'URL รูปกิจกรรม': service.url, 'URL ลายเซ็น': signature.url,
      'เรื่องเร่งด่วน': input.urgentFlag ? 'มี' : 'ไม่มี', 'บันทึกเพิ่มเติม': input.notes.trim(), 'รหัสการส่ง': input.submissionId
    });
    appendUnique('SyncReceipts', 'submissionId', {
      submissionId: input.submissionId, actorId: actor.userId, entityType: 'VisitEncounter', entityId: encounterId,
      receivedAt: now, result: 'COMMITTED', checksum: ''
    });
    const imageIds = new Set([input.olderImageId, input.serviceImageId, input.signatureImageId]);
    updateWhere('VisitImages', (row) => imageIds.has(String(row.imageId)), { recordId: encounterId });
    updateWhere('VisitSchedules', (row) => String(row.visitId) === input.visitId, { status: 'SUBMITTED' });

    const alert = (alertType: string, severity: 'HIGH' | 'MEDIUM') => appendUnique('Alerts', 'alertId', {
      alertId: Utilities.getUuid(), episodeId: visit.episodeId, encounterId, severity, alertType, eventAt: now, status: 'OPEN', assignedTo: '', closedAt: ''
    });
    if (input.urgentFlag) alert('CG_URGENT_FLAG', 'HIGH');
    const mental = mentalHealthAlert(input);
    if (mental) alert('MENTAL_HEALTH_RISK', mental.severity);

    audit(actor.userId, 'visitRecord.submit', 'VisitEncounter', encounterId, 'SUCCESS', [input.urgentFlag ? 'URGENT_FLAG' : '', mental ? `MENTAL_HEALTH_${mental.severity}` : ''].filter(Boolean).join(';'));
    return { encounterId, visitNumber, status: 'SUBMITTED' };
  });
}
