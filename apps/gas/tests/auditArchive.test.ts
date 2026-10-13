import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeGas, installFakeGas, records, seed } from './fakeGas';
import { archiveAuditLogs } from '../src/jobs/auditArchive';
import { SHEETS } from '../src/initializer';

const audit = (auditId: string, timestamp: string) => ({ auditId, actorId: 'usr-cm', action: 'visit.submit', entityType: 'VisitEncounter', entityId: 'enc', timestamp, outcome: 'SUCCESS' });
const archiveRows = (month: string) => {
  const archive = [...fakeGas.archives.values()].find((entry) => entry.name === `SmartLTC AuditLogs ${month}`);
  if (!archive) return null;
  const [headers = [], ...rows] = archive.sheet.rows;
  return { folderId: archive.folderId, headers: headers.map(String), ids: rows.map((row) => String(row[0])) };
};

beforeEach(() => {
  installFakeGas({ AUDIT_ARCHIVE_FOLDER_ID: 'folder-audit' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T03:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('archiveAuditLogs', () => {
  it('moves previous months into one archive spreadsheet per Bangkok month and keeps the current month', () => {
    seed('AuditLogs', [
      audit('a1', '2026-08-31T10:00:00.000Z'),
      audit('a2', '2026-09-30T16:59:59.000Z'), // 23:59 on 30 Sep in Bangkok
      audit('a3', '2026-09-30T17:00:00.000Z'), // 00:00 on 1 Oct in Bangkok: current month
      audit('a4', '2026-10-12T01:00:00.000Z')
    ]);
    expect(archiveAuditLogs()).toMatchObject({ archived: 2, remaining: 2, months: ['2026-08', '2026-09'] });
    expect(records('AuditLogs').map((row) => row.auditId)).toEqual(['a3', 'a4']);
    expect(archiveRows('2026-08')).toEqual({ folderId: 'folder-audit', headers: SHEETS.AuditLogs, ids: ['a1'] });
    expect(archiveRows('2026-09')?.ids).toEqual(['a2']);
    expect(records('JobRuns')).toEqual([expect.objectContaining({ jobType: 'AUDIT_ARCHIVE', status: 'SUCCESS', processedCount: 2 })]);
  });

  it('does not duplicate rows when a previous run copied them but crashed before deleting', () => {
    seed('AuditLogs', [audit('a1', '2026-09-01T00:00:00.000Z'), audit('a2', '2026-09-02T00:00:00.000Z')]);
    archiveAuditLogs();
    seed('AuditLogs', [audit('a1', '2026-09-01T00:00:00.000Z'), audit('a2', '2026-09-02T00:00:00.000Z')]); // simulate the undeleted copy
    expect(archiveAuditLogs()).toMatchObject({ archived: 2 });
    expect(archiveRows('2026-09')?.ids).toEqual(['a1', 'a2']);
    expect(records('AuditLogs')).toHaveLength(0);
  });

  it('processes a bounded chunk per run and reads only that chunk', () => {
    seed('AuditLogs', Array.from({ length: 25 }, (_, index) => audit(`a${index}`, '2026-09-15T00:00:00.000Z')));
    fakeGas.fullReads.clear();
    expect(archiveAuditLogs(10)).toMatchObject({ archived: 10, remaining: 15 });
    expect(fakeGas.fullReads.get('AuditLogs') ?? 0).toBe(0);
    archiveAuditLogs(10);
    archiveAuditLogs(10);
    expect(records('AuditLogs')).toHaveLength(0);
    expect(archiveRows('2026-09')?.ids).toHaveLength(25);
  });

  it('stops at the first current-month or unreadable row so it never deletes out of order', () => {
    seed('AuditLogs', [audit('a1', '2026-09-01T00:00:00.000Z'), audit('bad', 'not-a-date'), audit('a2', '2026-09-02T00:00:00.000Z')]);
    expect(archiveAuditLogs()).toMatchObject({ archived: 1 });
    expect(records('AuditLogs').map((row) => row.auditId)).toEqual(['bad', 'a2']);
  });

  it('requires an archive folder and records the failure', () => {
    installFakeGas();
    seed('AuditLogs', [audit('a1', '2026-09-01T00:00:00.000Z')]);
    expect(() => archiveAuditLogs()).toThrow('MISSING_CONFIG:AUDIT_ARCHIVE_FOLDER_ID');
    expect(records('AuditLogs')).toHaveLength(1);
  });
});
