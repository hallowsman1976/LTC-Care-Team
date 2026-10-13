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

    expect(call('review.list', DEMO_CM_USER_ID)).toMatchObject({ ok: true, data: { items: [{ encounterId: 'enc-demo-001-m3' }] } });
    expect(records('ServiceRuleSets')[0]).toMatchObject({ status: 'APPROVED' });
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
