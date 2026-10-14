import { beforeEach, describe, expect, it } from 'vitest';
import { fakeGas, installFakeGas, parseOutput, records, seed, signedEvent } from './fakeGas';
import { doPost } from '../src/main';

const post = (action: string, subject: string, payload: Record<string, unknown>) => parseOutput(doPost(signedEvent(action, subject, payload)));

beforeEach(() => {
  installFakeGas();
  seed('Users', [
    { userId: 'usr-admin', role: 'ADMIN', enabled: 'true' },
    { userId: 'usr-cg', role: 'CG', enabled: 'true', displayName: 'CG หนึ่ง', usernameNormalized: 'cg.one' },
    { userId: 'usr-cg2', role: 'CG', enabled: 'true', displayName: 'CG สอง', usernameNormalized: 'cg.two' }
  ]);
});

// What the gateway forwards: the CID already replaced by its ciphertext and lookup hash.
const caregiver = (overrides: Record<string, unknown> = {}) => ({
  displayName: 'CG ใหม่', username: 'cg.new', password: 'long enough password',
  birthDate: '1980-05-01', phone: '081-234-5678', address: '12 ม.2 ต.ทดสอบ', email: 'CG@Example.org', education: 'UPPER_SECONDARY',
  organization: { name: 'รพ.สต. ทดสอบ', type: 'HEALTH_PROMOTING_HOSPITAL', serviceArea: 'หมู่ 2' },
  trainings: [{ course: 'หลักสูตรผู้ดูแลผู้สูงอายุ (Caregiver) 70 ชั่วโมง', provider: 'สสจ.', completedOn: '2024-06-30', hours: 70 }],
  cidCiphertext: 'enc-cid', cidLookupHash: 'hash-cid', ...overrides
});

describe('caregiver accounts', () => {
  beforeEach(() => { installFakeGas({ STAFF_PHOTO_FOLDER_ID: 'staff-photos' }); seed('Users', [{ userId: 'usr-admin', role: 'ADMIN', enabled: 'true' }, { userId: 'usr-cg', role: 'CG', enabled: 'true', displayName: 'CG หนึ่ง', usernameNormalized: 'cg.one' }, { userId: 'usr-cg2', role: 'CG', enabled: 'true', displayName: 'CG สอง', usernameNormalized: 'cg.two' }]); });

  it('creates a caregiver with a profile who can then sign in with the password', () => {
    const created = post('caregiver.create', 'usr-admin', caregiver({ username: 'CG.New', photo: { mimeType: 'image/jpeg', base64: Buffer.from('jpeg bytes').toString('base64') } }));
    expect(created).toMatchObject({ ok: true, data: { username: 'cg.new' } });
    expect(post('auth.passwordVerify', 'anonymous', { identifier: 'cg.new', password: 'long enough password' })).toMatchObject({ ok: true, data: { role: 'CG' } });
    const userId = (created as { data: { userId: string } }).data.userId;
    expect(records('CaregiverProfiles')).toEqual([expect.objectContaining({
      userId, cidCiphertext: 'enc-cid', phone: '0812345678', email: 'cg@example.org', education: 'UPPER_SECONDARY', organizationName: 'รพ.สต. ทดสอบ', photoUrl: expect.stringContaining('lh3.googleusercontent.com')
    })]);
    expect(fakeGas.files).toEqual([expect.objectContaining({ folderId: 'staff-photos', name: `staff_${userId}.jpg`, sharing: 'ANYONE_WITH_LINK' })]);
    expect(post('caregiver.list', 'usr-admin', {})).toMatchObject({ ok: true, data: { items: expect.arrayContaining([expect.objectContaining({
      username: 'cg.new', activePatients: 0, phone: '0812345678', trainingCount: 1, latestTraining: 'หลักสูตรผู้ดูแลผู้สูงอายุ (Caregiver) 70 ชั่วโมง'
    })]) } });
  });

  it('creates the photo folder on first use', () => {
    installFakeGas();
    seed('Users', [{ userId: 'usr-admin', role: 'ADMIN', enabled: 'true' }]);
    expect(post('caregiver.create', 'usr-admin', caregiver({ photo: { mimeType: 'image/jpeg', base64: Buffer.from('jpeg').toString('base64') } }))).toMatchObject({ ok: true });
    expect(fakeGas.properties.STAFF_PHOTO_FOLDER_ID).toBeTruthy();
  });

  it('lists every account without exposing credentials', () => {
    post('caregiver.create', 'usr-admin', caregiver());
    const result = post('user.list', 'usr-admin', {}) as { ok: boolean; data: { items: Array<Record<string, unknown>> } };
    expect(result.data.items.map((user) => user.role)).toEqual(['ADMIN', 'CG', 'CG', 'CG']);
    expect(result.data.items.find((user) => user.username === 'cg.new')).toMatchObject({ enabled: true });
    expect(JSON.stringify(result)).not.toMatch(/derivedHash|salt|cidCiphertext/i);
    expect(post('user.list', 'usr-cg', {})).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('refuses a username or a CID that is already registered', () => {
    expect(post('caregiver.create', 'usr-admin', caregiver({ username: 'cg.one' }))).toMatchObject({ ok: false, code: 'USERNAME_TAKEN' });
    expect(post('caregiver.create', 'usr-admin', caregiver())).toMatchObject({ ok: true });
    expect(post('caregiver.create', 'usr-admin', caregiver({ username: 'cg.other' }))).toMatchObject({ ok: false, code: 'DUPLICATE_STAFF_CID' });
  });

  it('rejects a clear-text CID and is not available to caregivers', () => {
    const { cidCiphertext: _ciphertext, cidLookupHash: _hash, ...plain } = caregiver();
    expect(post('caregiver.create', 'usr-admin', { ...plain, cid: '1100000000001' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(post('caregiver.create', 'usr-cg', caregiver({ username: 'cg.x' }))).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});

describe('caregiver assignment', () => {
  beforeEach(() => {
    seed('Patients', [{ patientId: 'pt-1', hn: 'HN-1', fullName: 'ผู้ป่วยหนึ่ง', status: 'ACTIVE' }, { patientId: 'pt-2', hn: 'HN-2', fullName: 'ผู้ป่วยสอง', status: 'ACTIVE' }]);
    seed('CareEpisodes', [{ episodeId: 'ep-1', patientId: 'pt-1', status: 'ACTIVE', legalBasis: 'PUBLIC_HEALTH' }]);
    seed('StaffAssignments', [{ assignmentId: 'as-1', episodeId: 'ep-1', staffId: 'usr-cg', role: 'CG', status: 'ACTIVE' }]);
    seed('VisitSchedules', [
      { visitId: 'vs-past', episodeId: 'ep-1', assignedStaffId: 'usr-cg', visitDateTime: '2000-01-01T09:00:00+07:00', status: 'ASSIGNED' },
      { visitId: 'vs-next', episodeId: 'ep-1', assignedStaffId: 'usr-cg', visitDateTime: '2099-01-01T09:00:00+07:00', status: 'ASSIGNED' }
    ]);
  });

  it('moves the patient and their upcoming visits to the new caregiver', () => {
    expect(post('assignment.set', 'usr-admin', { patientId: 'pt-1', caregiverUserId: 'usr-cg2' })).toMatchObject({ ok: true, data: { status: 'ASSIGNED', reassignedVisits: 1 } });
    expect(records('StaffAssignments').filter((row) => row.status === 'ACTIVE').map((row) => row.staffId)).toEqual(['usr-cg2']);
    expect(Object.fromEntries(records('VisitSchedules').map((row) => [row.visitId, row.assignedStaffId]))).toEqual({ 'vs-past': 'usr-cg', 'vs-next': 'usr-cg2' });
    expect(post('patient.list', 'usr-cg2', {})).toMatchObject({ ok: true, data: { items: [expect.objectContaining({ patientId: 'pt-1' })] } });
  });

  it('opens a care episode for a patient who has none', () => {
    expect(post('assignment.set', 'usr-admin', { patientId: 'pt-2', caregiverUserId: 'usr-cg' })).toMatchObject({ ok: true, data: { status: 'ASSIGNED' } });
    expect(records('CareEpisodes').filter((row) => row.patientId === 'pt-2')).toEqual([expect.objectContaining({ status: 'ACTIVE', eligibilityStatus: 'PENDING_ASSESSMENT' })]);
    expect(post('assignment.list', 'usr-admin', {})).toMatchObject({ ok: true, data: { items: [
      expect.objectContaining({ patientId: 'pt-1', caregiverName: 'CG หนึ่ง' }), expect.objectContaining({ patientId: 'pt-2', caregiverName: 'CG หนึ่ง' })
    ] } });
  });

  it('only assigns enabled caregivers', () => {
    expect(post('assignment.set', 'usr-admin', { patientId: 'pt-1', caregiverUserId: 'usr-admin' })).toMatchObject({ ok: false, code: 'CAREGIVER_NOT_FOUND' });
  });
});

describe('patient import', () => {
  const row = (line: number, hn: string, cid: string, fullName = `ผู้ป่วย ${hn}`) => ({
    line, localCode: `L-${hn}`, hn, fullName, birthDate: '1942-03-15', sex: 'FEMALE', address: 'บ้าน', village: 'หมู่ 1', phone: '',
    cidCiphertext: `enc-${cid}`, cidLookupHash: `hash-${cid}`
  });

  it('registers new patients with an open episode and reports duplicates instead of merging them', () => {
    seed('Patients', [{ patientId: 'pt-old', hn: 'HN-OLD', cidLookupHash: 'hash-9', fullName: 'คนเดิม', birthDate: '1942-03-15', status: 'ACTIVE' }]);
    const result = post('patient.import', 'usr-admin', { legalBasis: 'PUBLIC_HEALTH', rows: [row(2, 'HN-1', '1'), row(3, 'hn-old', '2'), row(4, 'HN-3', '9'), row(5, 'HN-4', '4', 'คนเดิม')] });
    expect(result).toMatchObject({ ok: true, data: { created: 1, skipped: [
      { line: 3, reason: 'DUPLICATE_HN' }, { line: 4, reason: 'DUPLICATE_CID' }, { line: 5, reason: 'POTENTIAL_DUPLICATE' }
    ] } });
    const created = records('Patients').find((patient) => patient.hn === 'HN-1')!;
    expect(created).toMatchObject({ cidCiphertext: 'enc-1', status: 'ACTIVE', createdBy: 'usr-admin' });
    expect(records('CareEpisodes')).toEqual([expect.objectContaining({ patientId: created.patientId, status: 'ACTIVE', legalBasis: 'PUBLIC_HEALTH' })]);
    expect(records('PatientConsents')).toHaveLength(1);
  });

  it('rejects rows that still carry a clear-text CID', () => {
    const { cidCiphertext: _ciphertext, cidLookupHash: _hash, ...plain } = row(2, 'HN-1', '1');
    expect(post('patient.import', 'usr-admin', { rows: [{ ...plain, cid: '1100000000001' }] })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });
});
