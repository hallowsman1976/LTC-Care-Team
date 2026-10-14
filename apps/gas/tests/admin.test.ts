import { beforeEach, describe, expect, it } from 'vitest';
import { installFakeGas, parseOutput, records, seed, signedEvent } from './fakeGas';
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

describe('caregiver accounts', () => {
  it('creates a caregiver who can then sign in with the password', () => {
    const created = post('caregiver.create', 'usr-admin', { displayName: 'CG ใหม่', username: 'CG.New', password: 'long enough password' });
    expect(created).toMatchObject({ ok: true, data: { username: 'cg.new' } });
    expect(post('auth.passwordVerify', 'anonymous', { identifier: 'cg.new', password: 'long enough password' })).toMatchObject({ ok: true, data: { role: 'CG' } });
    expect(post('caregiver.list', 'usr-admin', {})).toMatchObject({ ok: true, data: { items: expect.arrayContaining([expect.objectContaining({ username: 'cg.new', activePatients: 0 })]) } });
  });

  it('refuses a username that is already taken', () => {
    expect(post('caregiver.create', 'usr-admin', { displayName: 'ซ้ำ', username: 'cg.one', password: 'long enough password' })).toMatchObject({ ok: false, code: 'USERNAME_TAKEN' });
  });

  it('is for admins only', () => {
    expect(post('caregiver.create', 'usr-cg', { displayName: 'CG ใหม่', username: 'cg.x', password: 'long enough password' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
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
