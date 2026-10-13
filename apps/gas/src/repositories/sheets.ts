import { getSpreadsheet } from '../config';

export type RowRecord = Record<string, unknown>;

export function getSheet(name: string): GoogleAppsScript.Spreadsheet.Sheet {
  const sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(`SHEET_MISSING:${name}`);
  return sheet;
}

function rowsToRecords(values: unknown[][]): RowRecord[] {
  const headers = values[0]?.map(String) ?? [];
  return values.slice(1).filter((row) => row.some((cell) => cell !== '')).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index]]))
  );
}

export function listPage(name: string, predicate: (row: RowRecord) => boolean, limit = 25): RowRecord[] {
  const capped = Math.max(1, Math.min(limit, 50));
  return rowsToRecords(getSheet(name).getDataRange().getValues()).filter(predicate).slice(0, capped);
}

export function listAll(name: string, predicate: (row: RowRecord) => boolean, maximumRows = 5_000): RowRecord[] {
  const sheet = getSheet(name);
  if (sheet.getLastRow() > maximumRows + 1) throw new Error(`SCAN_BOUND_EXCEEDED:${name}`);
  return rowsToRecords(sheet.getDataRange().getValues()).filter(predicate);
}

export function getById(name: string, idColumn: string, id: string): RowRecord | null {
  const sheet = getSheet(name);
  if (sheet.getLastRow() > 5_001) throw new Error('LOOKUP_BOUND_EXCEEDED');
  return rowsToRecords(sheet.getDataRange().getValues()).find((row) => String(row[idColumn]) === id) ?? null;
}

export function appendUnique(name: string, idColumn: string, record: RowRecord): RowRecord {
  const lock = LockService.getScriptLock();
  lock.waitLock(10_000);
  try {
    if (getById(name, idColumn, String(record[idColumn]))) throw new Error('DUPLICATE_ID');
    const sheet = getSheet(name);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]?.map(String) ?? [];
    sheet.appendRow(headers.map((header) => record[header] ?? ''));
    return record;
  } finally {
    lock.releaseLock();
  }
}

export function versionedUpdate(name: string, idColumn: string, id: string, expectedVersion: number, changes: RowRecord): RowRecord {
  const lock = LockService.getScriptLock();
  lock.waitLock(10_000);
  try {
    const sheet = getSheet(name);
    const values = sheet.getDataRange().getValues();
    const headers = values[0]?.map(String) ?? [];
    const idIndex = headers.indexOf(idColumn);
    const versionIndex = headers.indexOf('recordVersion');
    const rowIndex = values.findIndex((row, index) => index > 0 && String(row[idIndex]) === id);
    if (rowIndex < 1) throw new Error('NOT_FOUND');
    if (Number(values[rowIndex]?.[versionIndex]) !== expectedVersion) throw new Error('VERSION_CONFLICT');
    const updated = Object.fromEntries(headers.map((header, index) => [header, changes[header] ?? values[rowIndex]?.[index] ?? '']));
    updated.recordVersion = expectedVersion + 1;
    updated.updatedAt = new Date().toISOString();
    sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([headers.map((header) => updated[header] ?? '')]);
    return updated;
  } finally {
    lock.releaseLock();
  }
}

