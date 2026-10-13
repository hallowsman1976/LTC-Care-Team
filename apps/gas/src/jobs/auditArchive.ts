import { getRequiredProperty } from '../config';
import { SHEETS } from '../initializer';
import { appendLog, bulkAppend, getSheet, headersOf, withScriptLock } from '../repositories/sheets';

const TIME_ZONE = 'Asia/Bangkok';
const DEFAULT_CHUNK_ROWS = 2_000;

function bangkokMonth(timestamp: unknown): string | null {
  const instant = new Date(String(timestamp));
  return Number.isNaN(instant.valueOf()) ? null : Utilities.formatDate(instant, TIME_ZONE, 'yyyy-MM');
}

/** The month's archive sheet in the archive folder, created with AuditLogs headers if missing. */
function archiveSheetFor(month: string, folderId: string): GoogleAppsScript.Spreadsheet.Sheet {
  const name = `SmartLTC AuditLogs ${month}`;
  const folder = DriveApp.getFolderById(folderId);
  const existing = folder.getFilesByName(name);
  if (existing.hasNext()) return SpreadsheetApp.openById(existing.next().getId()).getSheets()[0]!;
  const created = SpreadsheetApp.create(name);
  // Created in My Drive first; moving it puts it under the folder's (restricted) sharing.
  DriveApp.getFileById(created.getId()).moveTo(folder);
  const sheet = created.getSheets()[0]!;
  sheet.getRange(1, 1, 1, SHEETS.AuditLogs!.length).setValues([SHEETS.AuditLogs!]);
  return sheet;
}

function archivedIds(sheet: GoogleAppsScript.Spreadsheet.Sheet): Set<string> {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Set();
  return new Set(sheet.getRange(2, 1, lastRow - 1, 1).getValues().map((row) => String(row[0])));
}

/**
 * Moves audit rows from months before the current Bangkok month into one archive spreadsheet per
 * month (`SmartLTC AuditLogs yyyy-MM` in AUDIT_ARCHIVE_FOLDER_ID). Run nightly from a time-driven
 * trigger. Each run handles at most `chunkRows` rows from the top of the sheet:
 *
 * - AuditLogs is append-only, so old rows are at the top; the run stops at the first row from the
 *   current month (or with an unreadable timestamp) and never deletes past it.
 * - Rows are copied, the copy is verified by id, and only then deleted. A run that dies between
 *   copy and delete is safe to repeat: ids already in the archive are not written twice.
 * - The script lock is held for the run, which pauses other writes; keep chunks small and run at night.
 *
 * Archived rows are never deleted here; retention is a DPO decision.
 */
export function archiveAuditLogs(chunkRows = DEFAULT_CHUNK_ROWS): { archived: number; remaining: number; months: string[] } {
  const startedAt = new Date().toISOString();
  try {
    const folderId = getRequiredProperty('AUDIT_ARCHIVE_FOLDER_ID');
    const result = withScriptLock(() => {
      const sheet = getSheet('AuditLogs');
      const headers = headersOf(sheet);
      const timestampColumn = headers.indexOf('timestamp');
      const idColumn = headers.indexOf('auditId');
      if (timestampColumn < 0 || idColumn !== 0) throw new Error('AUDIT_SCHEMA_UNEXPECTED');
      const available = sheet.getLastRow() - 1;
      const rows = available > 0 ? sheet.getRange(2, 1, Math.min(chunkRows, available), headers.length).getValues() : [];
      const currentMonth = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM');

      const byMonth = new Map<string, unknown[][]>();
      let movable = 0;
      for (const row of rows) {
        const month = bangkokMonth(row[timestampColumn]);
        if (!month || month >= currentMonth) break;
        byMonth.set(month, [...(byMonth.get(month) ?? []), row]);
        movable += 1;
      }

      for (const [month, monthRows] of byMonth) {
        const archive = archiveSheetFor(month, folderId);
        const already = archivedIds(archive);
        const records = monthRows.filter((row) => !already.has(String(row[idColumn])))
          .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
        bulkAppend(archive, headers, records);
        const stored = archivedIds(archive);
        if (monthRows.some((row) => !stored.has(String(row[idColumn])))) throw new Error(`AUDIT_ARCHIVE_VERIFY_FAILED:${month}`);
      }
      if (movable > 0) sheet.deleteRows(2, movable);
      return { archived: movable, remaining: Math.max(0, sheet.getLastRow() - 1), months: [...byMonth.keys()] };
    });
    recordRun(startedAt, 'SUCCESS', result.archived, '');
    return result;
  } catch (error) {
    recordRun(startedAt, 'FAILED', 0, error instanceof Error ? error.message : 'UNKNOWN');
    throw error;
  }
}

function recordRun(startedAt: string, status: string, processedCount: number, errorSummary: string): void {
  appendLog('JobRuns', {
    jobRunId: Utilities.getUuid(), jobType: 'AUDIT_ARCHIVE', startedAt, finishedAt: new Date().toISOString(),
    status, processedCount, errorSummary
  });
}

/** Run once from the editor: archives nightly between 02:00 and 03:00 script time. */
export function installAuditArchiveTrigger(): string {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'archiveAuditLogs') ScriptApp.deleteTrigger(trigger);
  }
  return ScriptApp.newTrigger('archiveAuditLogs').timeBased().everyDays(1).atHour(2).create().getUniqueId();
}
