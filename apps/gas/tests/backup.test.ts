import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeGas, records } from './fakeGas';
import { backupWorkbook } from '../src/jobs/backup';

interface DriveFile { id: string; name: string; trashed: boolean }
let files: DriveFile[];
let copiedFrom: string[];

function installDrive(): void {
  files = [];
  copiedFrom = [];
  const iterator = <T>(items: T[]) => { const queue = [...items]; return { hasNext: () => queue.length > 0, next: () => queue.shift()! }; };
  const handle = (file: DriveFile) => ({ getId: () => file.id, getName: () => file.name, setTrashed: (value: boolean) => { file.trashed = value; } });
  const folder = {
    getFilesByName: (name: string) => iterator(files.filter((file) => file.name === name && !file.trashed).map(handle)),
    getFiles: () => iterator(files.filter((file) => !file.trashed).map(handle))
  };
  (globalThis as Record<string, unknown>).DriveApp = {
    getFolderById: () => folder,
    getFileById: (id: string) => ({
      makeCopy: (name: string) => { copiedFrom.push(id); const file = { id: `copy-${files.length}`, name, trashed: false }; files.push(file); return handle(file); }
    })
  };
}

beforeEach(() => {
  installFakeGas({ BACKUP_FOLDER_ID: 'folder-backup', BACKUP_RETENTION_DAYS: '30' });
  installDrive();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T18:30:00Z')); // 01:30 on 16 Oct in Bangkok
});
afterEach(() => { vi.useRealTimers(); });

describe('backupWorkbook', () => {
  it('copies the workbook once a day under a dated Bangkok name', () => {
    expect(backupWorkbook().created).toBe('copy-0');
    expect(backupWorkbook().created).toBeNull();
    expect(copiedFrom).toEqual(['sheet']);
    expect(files.map((file) => file.name)).toEqual(['SmartLTC Backup 2026-10-16']);
    expect(records('JobRuns').map((run) => [run.jobType, run.status, run.processedCount])).toEqual([['WORKBOOK_BACKUP', 'SUCCESS', 1], ['WORKBOOK_BACKUP', 'SUCCESS', 0]]);
  });

  it('trashes only dated backups older than the retention period', () => {
    files.push({ id: 'old', name: 'SmartLTC Backup 2026-09-15', trashed: false });
    files.push({ id: 'kept', name: 'SmartLTC Backup 2026-09-16', trashed: false });
    files.push({ id: 'other', name: 'notes 2020-01-01', trashed: false });
    expect(backupWorkbook().trashed).toBe(1);
    expect(files.filter((file) => file.trashed).map((file) => file.id)).toEqual(['old']);
  });

  it('records a failed run when the folder is not configured', () => {
    installFakeGas({});
    installDrive();
    expect(() => backupWorkbook()).toThrow('MISSING_CONFIG:BACKUP_FOLDER_ID');
    expect(records('JobRuns')[0]).toMatchObject({ status: 'FAILED', errorSummary: 'MISSING_CONFIG:BACKUP_FOLDER_ID' });
  });
});
