import { getRequiredProperty } from '../config';
import { appendLog } from '../repositories/sheets';

const TIME_ZONE = 'Asia/Bangkok';
const PREFIX = 'SmartLTC Backup ';
const DEFAULT_RETENTION_DAYS = 35;

/**
 * Copies the whole workbook to BACKUP_FOLDER_ID as `SmartLTC Backup yyyy-MM-dd`, at most once a
 * day, then moves copies older than BACKUP_RETENTION_DAYS (default 35) to the Drive trash, where
 * they stay restorable for another 30 days. Run nightly from a time-driven trigger.
 *
 * This guards against deleted rows, a broken import or a bad deploy. It is not an offsite copy:
 * the copies live in the same Google account, so the runbook adds a monthly encrypted export.
 * CIDs stay encrypted in the copies; restoring them needs the same CID_ENCRYPTION_KEY_BASE64.
 */
export function backupWorkbook(): { created: string | null; trashed: number } {
  const startedAt = new Date().toISOString();
  try {
    const folder = DriveApp.getFolderById(getRequiredProperty('BACKUP_FOLDER_ID'));
    const retentionDays = Number(PropertiesService.getScriptProperties().getProperty('BACKUP_RETENTION_DAYS') ?? DEFAULT_RETENTION_DAYS);
    if (!Number.isInteger(retentionDays) || retentionDays < 7) throw new Error('INVALID_CONFIG:BACKUP_RETENTION_DAYS');
    const today = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
    const name = `${PREFIX}${today}`;
    let created: string | null = null;
    if (!folder.getFilesByName(name).hasNext()) {
      created = DriveApp.getFileById(getRequiredProperty('SPREADSHEET_ID')).makeCopy(name, folder).getId();
    }
    // Names carry the date, so pruning never depends on Drive's own timestamps.
    const cutoff = Utilities.formatDate(new Date(Date.now() - retentionDays * 86_400_000), TIME_ZONE, 'yyyy-MM-dd');
    let trashed = 0;
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const date = file.getName().startsWith(PREFIX) ? file.getName().slice(PREFIX.length) : '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < cutoff) {
        file.setTrashed(true);
        trashed += 1;
      }
    }
    recordRun(startedAt, 'SUCCESS', created ? 1 : 0, '');
    return { created, trashed };
  } catch (error) {
    recordRun(startedAt, 'FAILED', 0, error instanceof Error ? error.message : 'UNKNOWN');
    throw error;
  }
}

function recordRun(startedAt: string, status: string, processedCount: number, errorSummary: string): void {
  appendLog('JobRuns', {
    jobRunId: Utilities.getUuid(), jobType: 'WORKBOOK_BACKUP', startedAt, finishedAt: new Date().toISOString(),
    status, processedCount, errorSummary
  });
}

/** Run once from the editor: backs up nightly between 01:00 and 02:00 script time. */
export function installBackupTrigger(): string {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'backupWorkbook') ScriptApp.deleteTrigger(trigger);
  }
  return ScriptApp.newTrigger('backupWorkbook').timeBased().everyDays(1).atHour(1).create().getUniqueId();
}
