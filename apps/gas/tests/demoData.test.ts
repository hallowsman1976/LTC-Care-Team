import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeGas, parseOutput, records, seed, signedEvent } from './fakeGas';
import { doPost } from '../src/main';
import { setDemoCredential } from '../src/admin/credentials';
import { DEMO_CM_USER_ID, seedDemoData } from '../src/admin/demoData';

beforeEach(() => {
  installFakeGas({ PASSWORD_ITERATIONS: '5' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T03:00:00Z'));
  seed('Users', [{ userId: 'usr-cg-live', role: 'CG', enabled: 'true' }]);
});
afterEach(() => { vi.useRealTimers(); });

const call = (action: string, subject: string, payload: Record<string, unknown> = {}) =>
  parseOutput(doPost(signedEvent(action, subject, payload)));

describe('seedDemoData', () => {
  it('gives the signed-in caregiver and the CM something on every screen', () => {
    setDemoCredential('usr-cg-live', 'cg.demo', 'correct horse battery');
    const result = seedDemoData();
    expect(result.caregiverUserId).toBe('usr-cg-live');

    expect(call('patient.list', 'usr-cg-live', { limit: 25 })).toMatchObject({ ok: true, data: { items: { length: 3 } } });
    expect(call('dashboard.summary', 'usr-cg-live')).toMatchObject({ ok: true, data: { dueToday: 3, overdue: 4 } });
    expect(call('visit.list', 'usr-cg-live')).toMatchObject({ ok: true, data: { items: { length: 13 } } });
    const listed = call('visit.list', 'usr-cg-live').data as { items: Array<{ patientName: string }> };
    expect(new Set(listed.items.map((item) => item.patientName))).toEqual(new Set(['นางสมศรี ตัวอย่าง', 'นายบุญมา ทดลอง', 'นางทองใบ สาธิต']));

    expect(call('review.list', DEMO_CM_USER_ID)).toMatchObject({ ok: true, data: { items: [{
      encounterId: 'enc-demo-001-m3', patientName: 'นางสมศรี ตัวอย่าง', visitType: 'เยี่ยมบ้าน (ตัวอย่าง)', urgentFlag: false,
      vitalsJson: JSON.stringify({ temperature: 36.8, pulse: 78 }), notes: expect.stringContaining('สัญญาณชีพ')
    }] } });
    expect(records('ServiceRuleSets')[0]).toMatchObject({ status: 'APPROVED' });
  });

  it('shows the CM a caregiver submission with its notes, vitals and urgent flag', () => {
    setDemoCredential('usr-cg-live', 'cg.demo', 'correct horse battery');
    seedDemoData();
    expect(call('visit.submit', 'usr-cg-live', {
      visitId: 'vs-demo-002-p0', submissionId: '6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b', source: 'ONLINE', startedAt: '2026-10-14T10:00', endedAt: '2026-10-14T10:40',
      activityCompleted: false, urgentFlag: true, notes: 'การกินอาหารและน้ำ: กินได้น้อยลง', vitals: { temperature: 38.1 }
    })).toMatchObject({ ok: true });
    const reviews = (call('review.list', DEMO_CM_USER_ID).data as { items: Array<Record<string, unknown>> }).items;
    expect(reviews.find((item) => item.visitId === 'vs-demo-002-p0')).toMatchObject({
      patientName: 'นายบุญมา ทดลอง', urgentFlag: true, notes: 'การกินอาหารและน้ำ: กินได้น้อยลง', vitalsJson: JSON.stringify({ temperature: 38.1 })
    });
  });

  it('only adds what is missing when run again', () => {
    setDemoCredential('usr-cg-live', 'cg.demo', 'correct horse battery');
    seedDemoData();
    const visits = records('VisitSchedules').length;
    expect(seedDemoData().added).toEqual({});
    expect(records('VisitSchedules')).toHaveLength(visits);
  });

  it('needs the caregiver credential first and refuses outside DEMO', () => {
    expect(() => seedDemoData()).toThrow('RUN_setDemoCredential_FOR_CAREGIVER_FIRST');
    installFakeGas({ APP_MODE: 'PILOT', GATEWAY_ASSERTION_SECRET: 'p'.repeat(32) });
    expect(() => seedDemoData()).toThrow('DEMO_MODE_REQUIRED');
  });
});
