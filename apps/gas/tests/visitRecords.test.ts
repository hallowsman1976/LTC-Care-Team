import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeGas, installFakeGas, parseOutput, records, seed, signedEvent } from './fakeGas';
import { doPost } from '../src/main';
import { setDemoCredential } from '../src/admin/credentials';
import { DEMO_CM_USER_ID, seedDemoData } from '../src/admin/demoData';

const FOLDERS = { OLDER_IMAGE_FOLDER_ID: 'folder-older', SERVICE_IMAGE_FOLDER_ID: 'folder-service', SIGNATURE_FOLDER_ID: 'folder-sig' };
const CG = 'usr-cg-live';
const VISIT = 'vs-demo-002-p0';
const PNG = Buffer.from('fake image bytes').toString('base64');

beforeEach(() => {
  installFakeGas({ PASSWORD_ITERATIONS: '5', ...FOLDERS });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T03:00:00Z'));
  seed('Users', [{ userId: CG, role: 'CG', enabled: 'true', displayName: 'สมใจ ผู้ดูแล' }]);
  setDemoCredential(CG, 'cg.demo', 'correct horse battery');
  seedDemoData();
});
afterEach(() => { vi.useRealTimers(); });

const call = (action: string, subject: string, payload: Record<string, unknown> = {}) => parseOutput(doPost(signedEvent(action, subject, payload)));
const upload = (kind: string, subject = CG, visitId = VISIT) => call('visitImage.upload', subject, { visitId, kind, mimeType: 'image/jpeg', base64: PNG });

function uploadAll() {
  const ids = ['OLDER', 'SERVICE', 'SIGNATURE'].map((kind) => (upload(kind).data as { imageId: string }).imageId);
  return { olderImageId: ids[0], serviceImageId: ids[1], signatureImageId: ids[2] };
}

const record = (overrides: Record<string, unknown> = {}) => ({
  visitId: VISIT, submissionId: crypto.randomUUID(), visitDate: '2026-10-14', startTime: '10:00', endTime: '10:45',
  caregiverName: 'สมหญิง ใจดี', caregiverRelation: 'บุตร', caregiverPhone: '0812345678',
  weightKg: 55, heightCm: 160, vitals: { temperature: 36.8, pulse: 78, respiration: 18, systolic: 120, diastolic: 80 },
  adl: { feeding: 2, grooming: 1, transfer: 2, toiletUse: 1, mobility: 2, dressing: 1, stairs: 0, bathing: 0, bowels: 2, bladder: 2 },
  q2: [false, false], dailyCare: ['การพลิกตะแคงตัว'], basicHealth: [], otherCare: [], urgentFlag: false, notes: '',
  ...overrides
});

describe('visit context', () => {
  it('numbers the visit per patient and names the signed-in visitor', () => {
    expect(call('visit.context', CG, { visitId: VISIT })).toMatchObject({ ok: true, data: { patientName: 'นายบุญมา ทดลอง', visitNumber: 1, visitorName: 'สมใจ ผู้ดูแล' } });
    expect(call('visit.context', DEMO_CM_USER_ID, { visitId: VISIT })).toMatchObject({ ok: false, code: 'VISIT_NOT_ASSIGNED' });
  });
});

describe('visit images', () => {
  it('stores each kind in its own folder with a neutral name and an lh3 link', () => {
    const result = upload('SIGNATURE');
    expect(result).toMatchObject({ ok: true });
    const [file] = fakeGas.files;
    expect(file).toMatchObject({ folderId: 'folder-sig', sharing: 'ANYONE_WITH_LINK' });
    expect(file!.name).toMatch(/^SIGNATURE_pt-demo-002_\d{8}-\d{6}\.jpg$/);
    expect((result.data as { url: string }).url).toBe(`https://lh3.googleusercontent.com/d/${file!.id}`);
  });

  it('keeps PILOT files private and requires consent', () => {
    installFakeGas({ APP_MODE: 'PILOT', GATEWAY_ASSERTION_SECRET: 'p'.repeat(32), PASSWORD_ITERATIONS: '5', ...FOLDERS });
    seed('Users', [{ userId: CG, role: 'CG', enabled: 'true' }]);
    seed('CareEpisodes', [{ episodeId: 'ep-1', patientId: 'pt-1', status: 'ACTIVE' }]);
    seed('Patients', [{ patientId: 'pt-1', fullName: 'ผู้ป่วย' }]);
    seed('VisitSchedules', [{ visitId: 'vs-1', episodeId: 'ep-1', assignedStaffId: CG, status: 'ASSIGNED' }]);
    expect(upload('OLDER', CG, 'vs-1')).toMatchObject({ ok: false, code: 'ACTIVE_CONSENT_REQUIRED' });
    seed('PatientConsents', [{ consentId: 'c-1', patientId: 'pt-1', revokedAt: '' }]);
    expect(upload('OLDER', CG, 'vs-1')).toMatchObject({ ok: true });
    expect(fakeGas.files[0]!.sharing).toBe('PRIVATE');
  });

  it('refuses visits assigned to someone else', () => {
    expect(upload('OLDER', DEMO_CM_USER_ID)).toMatchObject({ ok: false, code: 'VISIT_NOT_ASSIGNED' });
  });
});

describe('visit record', () => {
  it('writes Visit_Records with computed scores and creates the encounter the CM reviews', () => {
    const result = call('visitRecord.submit', CG, record(uploadAll()));
    expect(result).toMatchObject({ ok: true, data: { visitNumber: 1, status: 'SUBMITTED' } });
    const [row] = records('Visit_Records');
    expect(row).toMatchObject({
      'ครั้งที่เยี่ยม': 1, 'ชื่อผู้รับบริการ': 'นายบุญมา ทดลอง', 'ผู้เยี่ยม': 'สมใจ ผู้ดูแล', 'เบอร์ติดต่อ': '0812345678',
      'ดัชนีมวลกาย': 21.5, 'แปลผลดัชนีมวลกาย': 'ปกติ', 'ความดันโลหิต (mmHg)': '120/80', 'คะแนน ADL รวม': 13, 'ผลคัดกรอง 2Q': 'ปกติ',
      'คะแนน 9Q': '', 'กิจกรรมด้านการช่วยเหลือประจำวัน': 'การพลิกตะแคงตัว'
    });
    expect(String(row!['URL ลายเซ็น'])).toMatch(/^https:\/\/lh3\.googleusercontent\.com\/d\/drive-/);
    expect(records('VisitImages').every((image) => image.recordId === row!['รหัสบันทึก'])).toBe(true);
    expect(records('VisitSchedules').find((visit) => visit.visitId === VISIT)).toMatchObject({ status: 'SUBMITTED' });
    const review = (call('review.list', DEMO_CM_USER_ID).data as { items: Array<Record<string, unknown>> }).items.find((item) => item.visitId === VISIT);
    expect(review).toMatchObject({ patientName: 'นายบุญมา ทดลอง', notes: expect.stringContaining('ADL: 13/20') });
  });

  it('raises a mental-health alert from 8Q and counts the next visit as number 2', () => {
    call('visitRecord.submit', CG, record({
      ...uploadAll(), q2: [true, true], q9: [2, 2, 1, 1, 1, 0, 0, 0, 1],
      q8: { answers: [true, false, true, true, false, false, false, false], canControl: false }
    }));
    const [row] = records('Visit_Records');
    expect(row).toMatchObject({ 'คะแนน 9Q': 8, 'ผล 9Q': 'มีภาวะซึมเศร้าระดับน้อย', 'คะแนน 8Q': 23, 'ผล 8Q': 'มีแนวโน้มจะฆ่าตัวตายในปัจจุบันระดับรุนแรง' });
    expect(records('Alerts')).toEqual(expect.arrayContaining([expect.objectContaining({ alertType: 'MENTAL_HEALTH_RISK', severity: 'HIGH', status: 'OPEN' })]));
    expect(call('visit.context', CG, { visitId: 'vs-demo-002-p3' })).toMatchObject({ data: { visitNumber: 2 } });
  });

  it('is idempotent per submission and refuses a second record for the same visit', () => {
    const images = uploadAll();
    const first = record(images);
    expect(call('visitRecord.submit', CG, first)).toMatchObject({ ok: true });
    expect(call('visitRecord.submit', CG, first)).toMatchObject({ ok: true, data: { duplicate: true } });
    expect(records('Visit_Records')).toHaveLength(1);
    expect(call('visitRecord.submit', CG, record(images))).toMatchObject({ ok: false, code: 'VISIT_NOT_OPEN' });
  });

  it('rejects images from another visit or of the wrong kind', () => {
    const images = uploadAll();
    expect(call('visitRecord.submit', CG, record({ ...images, olderImageId: images.serviceImageId }))).toMatchObject({ ok: false, code: 'IMAGE_NOT_USABLE' });
    const other = (call('visitImage.upload', CG, { visitId: 'vs-demo-002-p3', kind: 'OLDER', mimeType: 'image/jpeg', base64: PNG }).data as { imageId: string }).imageId;
    expect(call('visitRecord.submit', CG, record({ ...images, olderImageId: other }))).toMatchObject({ ok: false, code: 'IMAGE_NOT_USABLE' });
  });

  it('marks the visit verified when the CM verifies it', () => {
    call('visitRecord.submit', CG, record(uploadAll()));
    const encounter = records('VisitEncounters').find((row) => row.visitId === VISIT)!;
    expect(call('encounter.review', DEMO_CM_USER_ID, { encounterId: encounter.encounterId, decision: 'VERIFIED', reviewNotes: '', recordVersion: 1 })).toMatchObject({ ok: true });
    expect(records('VisitSchedules').find((visit) => visit.visitId === VISIT)).toMatchObject({ status: 'VERIFIED' });
  });
});
