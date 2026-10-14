import { beforeEach, describe, expect, it } from 'vitest';
import { FakeSheet, fakeGas, installFakeGas, parseOutput, records, seed, signedEvent } from './fakeGas';
import { doPost } from '../src/main';

const post = (action: string, subject: string, payload: Record<string, unknown>) => parseOutput(doPost(signedEvent(action, subject, payload)));
const future = '2099-01-01T00:00:00.000Z';

// What the gateway forwards: the CID already replaced by its ciphertext and lookup hash.
const patient = (overrides: Record<string, unknown> = {}) => ({
  hn: 'HN-100', fullName: 'นางสมมติ ทดสอบ', sex: 'FEMALE', birthDate: '1945-03-15', phone: '0812345678', registerDate: '2026-10-01',
  address: '12/3', villageNo: '2', villageName: 'หนองบัว', subdistrict: 'ตัวอย่าง', district: 'เมือง', province: 'ขอนแก่น',
  latitude: 16.4321, longitude: 102.8236, mainCaregiverName: 'นายลูก ทดสอบ', mainCaregiverPhone: '0899999999', relationship: 'CHILD',
  rightType: 'UC', diseases: 'ความดันโลหิตสูง, เบาหวาน', adlScore: 8, dependencyStatus: 'HOMEBOUND', taiGroup: 'C3', ppsScore: 50,
  mentalHealthStatus: 'NORMAL', legalBasis: 'PUBLIC_HEALTH', cidCiphertext: 'enc-cid', cidLookupHash: 'hash-cid', ...overrides
});

beforeEach(() => {
  installFakeGas();
  seed('Users', [
    { userId: 'usr-cm', role: 'CM', enabled: 'true', displayName: 'CM หนึ่ง' },
    { userId: 'usr-cm2', role: 'CM', enabled: 'true', displayName: 'CM สอง' },
    { userId: 'usr-cg', role: 'CG', enabled: 'true', displayName: 'CG หนึ่ง' }
  ]);
  seed('StaffProfiles', [
    { staffId: 'st-cm', userId: 'usr-cm', credentialVerifiedAt: '2026-01-01', qualificationExpiry: future },
    { staffId: 'st-cm2', userId: 'usr-cm2', credentialVerifiedAt: '2026-01-01', qualificationExpiry: future }
  ]);
});

describe('patient registration', () => {
  it('stores every field, opens a care episode and names the registering CM', () => {
    const result = post('patient.create', 'usr-cm', patient()) as { ok: boolean; data: { status: string; patient: Record<string, unknown> } };
    expect(result).toMatchObject({ ok: true, data: { status: 'CREATED' } });
    expect(result.data.patient).not.toHaveProperty('cidCiphertext');
    const saved = records('Patients')[0]!;
    expect(saved).toMatchObject({
      hn: 'HN-100', cidCiphertext: 'enc-cid', village: 'หมู่ 2 บ้านหนองบัว', subdistrict: 'ตัวอย่าง', province: 'ขอนแก่น', latitude: 16.4321,
      mainCaregiverPhone: '0899999999', relationship: 'CHILD', rightType: 'UC', adlScore: 8, taiGroup: 'C3', ppsScore: 50,
      careManagerId: 'usr-cm', caregiverId: '', registerDate: '2026-10-01', status: 'ACTIVE', createdBy: 'usr-cm'
    });
    expect(records('CareEpisodes')).toEqual([expect.objectContaining({ patientId: saved.patientId, status: 'ACTIVE', legalBasis: 'PUBLIC_HEALTH' })]);
  });

  it('assigns the chosen caregiver, who then sees the patient with visit details but no CID or rights', () => {
    expect(post('patient.create', 'usr-cm', patient({ caregiverId: 'usr-cg', careManagerId: 'usr-cm2' }))).toMatchObject({ ok: true, data: { patient: { caregiverId: 'usr-cg', careManagerId: 'usr-cm2' } } });
    expect(records('StaffAssignments')).toEqual([expect.objectContaining({ staffId: 'usr-cg', role: 'CG', status: 'ACTIVE' })]);
    const seen = post('patient.list', 'usr-cg', {}) as { data: { items: Array<Record<string, unknown>> } };
    expect(seen.data.items[0]).toMatchObject({ fullName: 'นางสมมติ ทดสอบ', latitude: 16.4321, mainCaregiverPhone: '0899999999', diseases: 'ความดันโลหิตสูง, เบาหวาน' });
    expect(seen.data.items[0]).not.toHaveProperty('rightType');
    expect(seen.data.items[0]).not.toHaveProperty('cidCiphertext');
  });

  it('refuses an unknown or disabled caregiver or care manager', () => {
    expect(post('patient.create', 'usr-cm', patient({ caregiverId: 'usr-cm2' }))).toMatchObject({ ok: false, code: 'CAREGIVER_NOT_FOUND' });
    expect(post('patient.create', 'usr-cm', patient({ careManagerId: 'usr-cg' }))).toMatchObject({ ok: false, code: 'CARE_MANAGER_NOT_FOUND' });
    expect(records('Patients')).toHaveLength(0);
  });

  it('adds the new columns to a Patients sheet created before they existed', () => {
    const old = ['patientId', 'localCode', 'hn', 'cidCiphertext', 'cidLookupHash', 'fullName', 'birthDate', 'sex', 'address', 'village', 'phone', 'status', 'createdAt', 'updatedAt', 'createdBy', 'recordVersion'];
    fakeGas.sheets.set('Patients', new FakeSheet('Patients', [old, ['pt-old', 'L-1', 'HN-OLD', '', '', 'คนเดิม', '1940-01-01', 'MALE', 'บ้าน', 'หมู่ 1', '', 'ACTIVE', '', '', '', 1]]));
    expect(post('patient.create', 'usr-cm', patient())).toMatchObject({ ok: true });
    const headers = fakeGas.sheets.get('Patients')!.rows[0]!;
    expect(headers.slice(0, old.length)).toEqual(old);
    expect(headers).toEqual(expect.arrayContaining(['subdistrict', 'latitude', 'taiGroup', 'registerDate']));
    expect(records('Patients').map((row) => [row.hn, row.province ?? ''])).toEqual([['HN-OLD', ''], ['HN-100', 'ขอนแก่น']]);
  });

  it('loads a patient for editing without the CID lookup hash', () => {
    const created = post('patient.create', 'usr-cm', patient()) as { data: { patient: { patientId: string } } };
    const loaded = post('patient.get', 'usr-cm', { patientId: created.data.patient.patientId }) as { ok: boolean; data: Record<string, unknown> };
    expect(loaded).toMatchObject({ ok: true, data: { hn: 'HN-100', cidCiphertext: 'enc-cid', recordVersion: 1, status: 'ACTIVE' } });
    expect(loaded.data).not.toHaveProperty('cidLookupHash');
    expect(post('patient.get', 'usr-cg', { patientId: created.data.patient.patientId })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  describe('editing', () => {
    let patientId = '';
    const edit = (overrides: Record<string, unknown> = {}) => {
      const { cidCiphertext: _ciphertext, cidLookupHash: _hash, legalBasis: _basis, ...fields } = patient();
      return { ...fields, patientId, recordVersion: 1, status: 'ACTIVE', caregiverId: 'usr-cg', cidCiphertext: '', cidLookupHash: '', ...overrides };
    };
    beforeEach(() => {
      patientId = (post('patient.create', 'usr-cm', patient({ caregiverId: 'usr-cg' })) as { data: { patient: { patientId: string } } }).data.patient.patientId;
      const episodeId = records('CareEpisodes')[0]!.episodeId;
      seed('VisitSchedules', [
        { visitId: 'vs-past', episodeId, assignedStaffId: 'usr-cg', visitDateTime: '2000-01-01T09:00:00+07:00', status: 'VERIFIED' },
        { visitId: 'vs-next', episodeId, assignedStaffId: 'usr-cg', visitDateTime: '2099-01-01T09:00:00+07:00', status: 'ASSIGNED' }
      ]);
    });

    it('saves changes with a version check and keeps the CID unless a new one is given', () => {
      expect(post('patient.update', 'usr-cm', edit({ phone: '0811111111', adlScore: 15, dependencyStatus: 'SOCIAL' }))).toMatchObject({ ok: true, data: { recordVersion: 2 } });
      expect(records('Patients')[0]).toMatchObject({ phone: '0811111111', adlScore: 15, cidCiphertext: 'enc-cid', recordVersion: 2 });
      expect(post('patient.update', 'usr-cm', edit())).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
      expect(post('patient.update', 'usr-cm', edit({ recordVersion: 2, cidCiphertext: 'enc-new', cidLookupHash: 'hash-new' }))).toMatchObject({ ok: true });
      expect(records('Patients')[0]).toMatchObject({ cidCiphertext: 'enc-new', cidLookupHash: 'hash-new' });
    });

    it('keeps HN and CID unique across patients', () => {
      post('patient.create', 'usr-cm', patient({ hn: 'HN-200', fullName: 'คนอื่น', cidLookupHash: 'hash-other' }));
      expect(post('patient.update', 'usr-cm', edit({ hn: 'hn-200' }))).toMatchObject({ ok: false, code: 'DUPLICATE_HN' });
      expect(post('patient.update', 'usr-cm', edit({ cidCiphertext: 'enc-x', cidLookupHash: 'hash-other' }))).toMatchObject({ ok: false, code: 'DUPLICATE_CID' });
    });

    it('closes care when the patient leaves the service and reopens it on return', () => {
      expect(post('patient.update', 'usr-cm', edit({ status: 'DECEASED', statusNote: 'ข้อมูลสมมติ' }))).toMatchObject({ ok: true, data: { status: 'DECEASED', cancelledVisits: 1 } });
      expect(records('Patients')[0]).toMatchObject({ status: 'DECEASED', caregiverId: '', statusNote: 'ข้อมูลสมมติ' });
      expect(records('CareEpisodes')[0]).toMatchObject({ status: 'CLOSED' });
      expect(records('StaffAssignments')[0]).toMatchObject({ status: 'ENDED' });
      expect(Object.fromEntries(records('VisitSchedules').map((row) => [row.visitId, row.status]))).toEqual({ 'vs-past': 'VERIFIED', 'vs-next': 'CANCELLED' });
      expect((post('patient.list', 'usr-cg', {}) as { data: { items: unknown[] } }).data.items).toHaveLength(0);
      expect(post('patient.update', 'usr-cm', edit({ recordVersion: 2, status: 'ACTIVE', caregiverId: '' }))).toMatchObject({ ok: true });
      expect(records('CareEpisodes').map((row) => row.status)).toEqual(['CLOSED', 'ACTIVE']);
    });

    it('moves or removes the caregiver', () => {
      seed('Users', [{ userId: 'usr-cg2', role: 'CG', enabled: 'true', displayName: 'CG สอง' }]);
      expect(post('patient.update', 'usr-cm', edit({ caregiverId: 'usr-cg2' }))).toMatchObject({ ok: true });
      expect(records('VisitSchedules').find((row) => row.visitId === 'vs-next')).toMatchObject({ assignedStaffId: 'usr-cg2' });
      expect(post('patient.update', 'usr-cm', edit({ recordVersion: 2, caregiverId: '' }))).toMatchObject({ ok: true });
      expect(records('StaffAssignments').filter((row) => row.status === 'ACTIVE')).toHaveLength(0);
      expect(records('VisitSchedules').find((row) => row.visitId === 'vs-next')).toMatchObject({ status: 'PLANNED', assignedStaffId: '' });
      expect(records('Patients')[0]).toMatchObject({ caregiverId: '' });
    });
  });

  it('still asks before registering a likely duplicate', () => {
    post('patient.create', 'usr-cm', patient());
    expect(post('patient.create', 'usr-cm', patient({ hn: 'HN-101', cidLookupHash: 'hash-2' }))).toMatchObject({ ok: true, data: { status: 'POTENTIAL_DUPLICATE' } });
    expect(post('patient.create', 'usr-cm', patient({ hn: 'HN-101', cidLookupHash: 'hash-2', duplicateOverrideReason: 'คนละคน ตรวจบัตรแล้ว' }))).toMatchObject({ ok: true, data: { status: 'CREATED' } });
  });
});
