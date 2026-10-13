import { beforeEach, describe, expect, it } from 'vitest';
import { fakeGas, installFakeGas, parseOutput, records, seed, signedEvent } from './fakeGas';
import { doPost } from '../src/main';

// A pilot accumulates thousands of audit, schedule and receipt rows within months. Growth of
// these sheets must not stop the system from accepting work.

const post = (action: string, subject: string, payload: Record<string, unknown>) => parseOutput(doPost(signedEvent(action, subject, payload)));

/** Appends `count` filler rows directly, bypassing the services for speed. */
function fill(sheetName: string, count: number, make: (index: number) => Record<string, unknown>) {
  const sheet = fakeGas.sheets.get(sheetName)!;
  const headers = sheet.rows[0]!.map(String);
  for (let index = 0; index < count; index += 1) {
    const record = make(index);
    sheet.rows.push(headers.map((header) => record[header] ?? ''));
  }
}

const submission = {
  visitId: 'vs-target', submissionId: '7d1b8d4e-6f0a-4a43-9c55-1f0b0f6b9a11', source: 'ONLINE', startedAt: '2026-10-13T09:00', endedAt: '2026-10-13T10:00',
  activityCompleted: true, urgentFlag: false, notes: '', vitals: {}
};

beforeEach(() => {
  installFakeGas();
  seed('Users', [{ userId: 'usr-cg', role: 'CG', enabled: 'true' }, { userId: 'usr-cm', role: 'CM', enabled: 'true' }]);
  seed('StaffProfiles', [{ staffId: 'st-cm', userId: 'usr-cm', credentialVerifiedAt: '2026-01-01', qualificationExpiry: '2099-01-01T00:00:00.000Z' }]);
});

describe('growing sheets', () => {
  it('keeps auditing writes after AuditLogs passes 5,000 rows', () => {
    fill('AuditLogs', 6_000, (index) => ({ auditId: `audit-${index}`, action: 'filler' }));
    fill('VisitSchedules', 6_000, (index) => ({ visitId: `vs-${index}`, assignedStaffId: 'usr-other' }));
    fill('SyncReceipts', 6_000, (index) => ({ submissionId: `old-${index}` }));
    seed('VisitSchedules', [{ visitId: 'vs-target', episodeId: 'ep-1', assignedStaffId: 'usr-cg', status: 'ASSIGNED' }]);
    expect(post('visit.submit', 'usr-cg', submission)).toMatchObject({ ok: true });
    expect(records('AuditLogs')).toHaveLength(6_001);
  });

  it('still finds an existing receipt when the receipts sheet is large', () => {
    fill('SyncReceipts', 6_000, (index) => ({ submissionId: `old-${index}` }));
    seed('VisitSchedules', [{ visitId: 'vs-target', episodeId: 'ep-1', assignedStaffId: 'usr-cg', status: 'ASSIGNED' }]);
    expect(post('visit.submit', 'usr-cg', submission)).toMatchObject({ ok: true });
    expect(post('visit.submit', 'usr-cg', submission)).toMatchObject({ ok: true });
    expect(records('VisitEncounters')).toHaveLength(1);
  });

  it('looks rows up by id without reading whole sheets', () => {
    fill('VisitSchedules', 6_000, (index) => ({ visitId: `vs-${index}`, assignedStaffId: 'usr-other' }));
    seed('VisitSchedules', [{ visitId: 'vs-target', episodeId: 'ep-1', assignedStaffId: 'usr-cg', status: 'ASSIGNED' }]);
    fakeGas.fullReads.clear();
    expect(post('visit.submit', 'usr-cg', submission)).toMatchObject({ ok: true });
    for (const sheet of ['VisitSchedules', 'SyncReceipts', 'VisitEncounters', 'AuditLogs']) expect(fakeGas.fullReads.get(sheet) ?? 0, sheet).toBe(0);
  });

  it('serves the dashboard with more than 5,000 scheduled visits', () => {
    fill('VisitSchedules', 6_000, (index) => ({ visitId: `vs-${index}`, assignedStaffId: 'usr-cg', visitDateTime: '2026-01-01T09:00:00+07:00', status: 'VERIFIED' }));
    expect(post('dashboard.summary', 'usr-cm', {})).toMatchObject({ ok: true });
  });
});
