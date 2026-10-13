import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeGas, parseOutput, records, signedEvent } from './fakeGas';
import { doPost, runLoadProbe } from '../src/main';
import { seedLoadTestData } from '../src/admin/loadTest';

beforeEach(() => {
  installFakeGas({ LOAD_TEST_ALLOWED: 'true', PASSWORD_ITERATIONS: '5' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T03:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('seedLoadTestData', () => {
  it('generates consistent synthetic volume that the services can read', () => {
    const summary = seedLoadTestData({ patients: 6, caregivers: 2, months: 2, visitsPerWeek: 2, password: 'load test password 1' });
    const visits = records('VisitSchedules');
    expect(summary.rows.VisitSchedules).toBe(visits.length);
    // 6 patients x 2 visits/week over ~2 months back plus 30 days ahead.
    expect(visits.length).toBeGreaterThan(6 * 2 * 8);
    const past = visits.filter((row) => String(row.status) === 'VERIFIED');
    expect(records('VisitEncounters')).toHaveLength(past.length);
    expect(records('SyncReceipts')).toHaveLength(past.length);
    expect(records('AuditLogs').length).toBeGreaterThanOrEqual(past.length * 2);
    const timestamps = records('AuditLogs').map((row) => String(row.timestamp));
    expect([...timestamps].sort()).toEqual(timestamps);
    expect(records('Patients').every((row) => String(row.fullName).includes('ทดสอบโหลด'))).toBe(true);

    const cg = summary.caregiverUserIds[0]!;
    expect(parseOutput(doPost(signedEvent('dashboard.summary', cg, {})))).toMatchObject({ ok: true });
    expect(parseOutput(doPost(signedEvent('visit.list', cg, {})))).toMatchObject({ ok: true, data: { hasMore: true } });
    expect(parseOutput(doPost(signedEvent('auth.passwordVerify', 'anonymous', { identifier: 'load.cg.1', password: 'load test password 1' })))).toMatchObject({ ok: true, data: { userId: cg } });
  });

  it('refuses unless DEMO mode and LOAD_TEST_ALLOWED are both set', () => {
    installFakeGas();
    expect(() => seedLoadTestData({ patients: 1 })).toThrow('LOAD_TEST_NOT_ALLOWED');
    installFakeGas({ APP_MODE: 'PILOT', LOAD_TEST_ALLOWED: 'true', GATEWAY_ASSERTION_SECRET: 'p'.repeat(32) });
    expect(() => seedLoadTestData({ patients: 1 })).toThrow('DEMO_MODE_REQUIRED');
  });
});

describe('runLoadProbe', () => {
  it('times the main server paths', () => {
    seedLoadTestData({ patients: 4, caregivers: 2, months: 1 });
    const result = runLoadProbe(2);
    expect(Object.keys(result.medianMs)).toEqual(expect.arrayContaining(['doPost visit.list', 'doPost dashboard.summary', 'doPost visit.submit', 'getById VisitSchedules (last row)']));
    expect(Object.values(result.medianMs).every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.sheetRows.VisitSchedules).toBeGreaterThan(0);
  });
});
