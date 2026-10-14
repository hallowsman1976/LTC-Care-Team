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

  it('still asks before registering a likely duplicate', () => {
    post('patient.create', 'usr-cm', patient());
    expect(post('patient.create', 'usr-cm', patient({ hn: 'HN-101', cidLookupHash: 'hash-2' }))).toMatchObject({ ok: true, data: { status: 'POTENTIAL_DUPLICATE' } });
    expect(post('patient.create', 'usr-cm', patient({ hn: 'HN-101', cidLookupHash: 'hash-2', duplicateOverrideReason: 'คนละคน ตรวจบัตรแล้ว' }))).toMatchObject({ ok: true, data: { status: 'CREATED' } });
  });
});
