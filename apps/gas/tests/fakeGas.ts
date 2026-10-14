import { createHash, createHmac, randomUUID } from 'node:crypto';
import { SHEETS } from '../src/initializer';

// In-memory stand-in for the Apps Script services the server code uses. Bytes follow the GAS
// convention of signed Java bytes (-128..127).

type Cell = unknown;
const toSigned = (buffer: Buffer): number[] => [...buffer].map((value) => (value > 127 ? value - 256 : value));
/**
 * Mimics how Sheets parses values written through appendRow/setValues, as if typed by a user:
 * a leading apostrophe forces text (and is not stored), and text that looks like a formula is
 * evaluated, which for our data means a broken cell.
 */
const asTyped = (cell: Cell): Cell => {
  if (typeof cell !== 'string') return cell;
  if (cell.startsWith("'")) return cell.slice(1);
  return /^(=|\+|-\D)/.test(cell) ? '#ERROR!' : cell;
};
const toBuffer = (value: string | number[]): Buffer => typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value.map((byte) => (byte + 256) % 256));

export class FakeSheet {
  constructor(public name: string, public rows: Cell[][]) {}
  getDataRange() {
    fakeGas.fullReads.set(this.name, (fakeGas.fullReads.get(this.name) ?? 0) + 1);
    return { getValues: () => this.rows.map((row) => [...row]) };
  }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows[0]?.length ?? 0; }
  getMaxRows() { return Math.max(1000, this.rows.length); }
  getRange(row: number, column: number, rowCount = 1, columnCount = 1) {
    const sheet = this;
    return {
      getRow: () => row,
      setNumberFormat: () => undefined,
      getValues: () => this.rows.slice(row - 1, row - 1 + rowCount).map((cells) => cells.slice(column - 1, column - 1 + columnCount)),
      setValues: (values: Cell[][]) => {
        values.forEach((cells, offset) => {
          const target = this.rows[row - 1 + offset] ?? (this.rows[row - 1 + offset] = []);
          cells.forEach((cell, index) => { target[column - 1 + index] = asTyped(cell); });
        });
      },
      // Supports the exact-match lookup the repository uses: matchEntireCell(true).matchCase(true).
      createTextFinder: (text: string) => {
        const options = { entireCell: false, caseSensitive: false };
        const finder = {
          matchEntireCell: (value: boolean) => { options.entireCell = value; return finder; },
          matchCase: (value: boolean) => { options.caseSensitive = value; return finder; },
          findNext: () => {
            const norm = (value: string) => (options.caseSensitive ? value : value.toLowerCase());
            for (let index = row - 1; index < row - 1 + rowCount; index += 1) {
              for (let offset = 0; offset < columnCount; offset += 1) {
                const cell = norm(String(sheet.rows[index]?.[column - 1 + offset] ?? ''));
                if (options.entireCell ? cell === norm(text) : cell.includes(norm(text))) return sheet.getRange(index + 1, column + offset);
              }
            }
            return null;
          }
        };
        return finder;
      }
    };
  }
  appendRow(row: Cell[]) { fakeGas.onWrite?.(this.name); this.rows.push(row.map(asTyped)); }
  deleteRow(row: number) { this.rows.splice(row - 1, 1); }
  deleteRows(row: number, count: number) { this.rows.splice(row - 1, count); }
  setFrozenRows() {}
}

export interface FakeGasState {
  sheets: Map<string, FakeSheet>;
  properties: Record<string, string>;
  cache: Map<string, string>;
  lockDepth: number;
  lockAcquisitions: number;
  /** Spreadsheets created through SpreadsheetApp.create (the audit archives). */
  archives: Map<string, { name: string; folderId: string | null; sheet: FakeSheet }>;
  folders: Map<string, unknown>;
  /** getDataRange() calls per sheet, to catch whole-sheet scans. */
  fullReads: Map<string, number>;
  now: Date;
  /** Files created in Drive folders. */
  files: Array<{ id: string; folderId: string; name: string; sharing: string }>;
  /** Hook for tests that need to observe writes. */
  onWrite?: (sheetName: string) => void;
}

export const fakeGas: FakeGasState = {
  sheets: new Map(), properties: {}, cache: new Map(), lockDepth: 0, lockAcquisitions: 0, fullReads: new Map(), archives: new Map(), folders: new Map(), files: [], now: new Date()
};

/** Installs the fake services with every workbook sheet created and headed. */
export function installFakeGas(properties: Record<string, string> = {}): FakeGasState {
  fakeGas.sheets = new Map(Object.entries(SHEETS).map(([name, headers]) => [name, new FakeSheet(name, [[...headers]])]));
  fakeGas.properties = { APP_MODE: 'DEMO', SPREADSHEET_ID: 'sheet', GATEWAY_ASSERTION_SECRET: 'g'.repeat(32), PASSWORD_PEPPER: 'pepper', QUARANTINE_FOLDER_ID: 'folder', ...properties };
  fakeGas.cache = new Map();
  fakeGas.lockDepth = 0;
  fakeGas.lockAcquisitions = 0;
  fakeGas.fullReads = new Map();
  delete fakeGas.onWrite;

  const spreadsheet = {
    getSheetByName: (name: string) => fakeGas.sheets.get(name) ?? null,
    insertSheet: (name: string) => { const sheet = new FakeSheet(name, []); fakeGas.sheets.set(name, sheet); return sheet; }
  };
  fakeGas.archives = new Map();
  fakeGas.folders = new Map();
  fakeGas.files = [];
  const archiveSpreadsheet = (id: string) => {
    const archive = fakeGas.archives.get(id);
    if (!archive) throw new Error(`fake: no spreadsheet ${id}`);
    return { getId: () => id, getSheets: () => [archive.sheet] };
  };
  const globals = globalThis as Record<string, unknown>;
  globals.SpreadsheetApp = {
    openById: (id: string) => (id === fakeGas.properties.SPREADSHEET_ID ? spreadsheet : archiveSpreadsheet(id)),
    create: (name: string) => {
      const id = `ss-${randomUUID()}`;
      fakeGas.archives.set(id, { name, folderId: null, sheet: new FakeSheet(`${name}/Sheet1`, []) });
      return archiveSpreadsheet(id);
    }
  };
  globals.PropertiesService = { getScriptProperties: () => ({ getProperty: (name: string) => fakeGas.properties[name] ?? null }) };
  globals.CacheService = { getScriptCache: () => ({ get: (key: string) => fakeGas.cache.get(key) ?? null, put: (key: string, value: string) => { fakeGas.cache.set(key, value); } }) };
  globals.LockService = {
    getScriptLock: () => ({
      waitLock: () => {
        // Apps Script locks are not re-entrant across separate acquisitions; flag accidental nesting.
        if (fakeGas.lockDepth > 0) throw new Error('FAKE_LOCK_ALREADY_HELD');
        fakeGas.lockDepth += 1; fakeGas.lockAcquisitions += 1;
      },
      releaseLock: () => { fakeGas.lockDepth = Math.max(0, fakeGas.lockDepth - 1); }
    })
  };
  const folder = (folderId: string) => ({
    getId: () => folderId,
    createFile: (blob: { name?: string }) => {
      const file = { id: `drive-${randomUUID()}`, folderId, name: blob?.name ?? '', sharing: 'PRIVATE' };
      fakeGas.files.push(file);
      return { getId: () => file.id, setSharing: (access: string) => { file.sharing = access; } };
    },
    getFilesByName: (name: string) => {
      const matches = [...fakeGas.archives.entries()].filter(([, archive]) => archive.name === name && archive.folderId === folderId).map(([id]) => id);
      return { hasNext: () => matches.length > 0, next: () => ({ getId: () => matches.shift()! }) };
    }
  });
  globals.DriveApp = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
    Permission: { VIEW: 'VIEW' },
    getFolderById: (folderId: string) => folder(folderId),
    getFileById: (id: string) => ({ moveTo: (target: { getId(): string }) => { fakeGas.archives.get(id)!.folderId = target.getId(); } })
  };
  globals.ContentService = {
    MimeType: { JSON: 'JSON' },
    createTextOutput: (text: string) => ({ text, setMimeType() { return this; }, getContent() { return text; } })
  };
  globals.Utilities = {
    Charset: { UTF_8: 'UTF_8' },
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    getUuid: () => randomUUID(),
    computeDigest: (_algorithm: string, value: string) => toSigned(createHash('sha256').update(toBuffer(value)).digest()),
    computeHmacSha256Signature: (value: string | number[], key: string | number[]) => toSigned(createHmac('sha256', toBuffer(key)).update(toBuffer(value)).digest()),
    base64Encode: (value: string | number[]) => toBuffer(value).toString('base64'),
    base64Decode: (value: string) => toSigned(Buffer.from(value, 'base64')),
    newBlob: (value: string | number[], _mimeType?: string, name?: string) => ({ name, getBytes: () => toSigned(toBuffer(value)) }),
    formatDate: (date: Date, timeZone: string, format: string) => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
        .formatToParts(date).map((part) => [part.type, part.value]));
      if (format === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
      if (format === 'yyyy-MM') return `${parts.year}-${parts.month}`;
      if (format === 'yyyyMMdd-HHmmss') return `${parts.year}${parts.month}${parts.day}-000000`;
      if (format === 'd') return String(Number(parts.day));
      if (format === 'u') return String(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(String(parts.weekday)) + 1);
      throw new Error(`fake formatDate: unsupported ${format}`);
    }
  };
  globals.console = console;
  return fakeGas;
}

/** Appends a record to a sheet using its header row. */
export function seed(sheetName: string, records: Record<string, unknown>[]): void {
  const sheet = fakeGas.sheets.get(sheetName);
  if (!sheet) throw new Error(`no sheet ${sheetName}`);
  const headers = sheet.rows[0]!.map(String);
  for (const record of records) sheet.rows.push(headers.map((header) => record[header] ?? ''));
}

export function records(sheetName: string): Record<string, unknown>[] {
  const [headers = [], ...rows] = fakeGas.sheets.get(sheetName)!.rows;
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [String(header), row[index]])));
}

/** Builds a gateway-signed doPost event the same way apps/gateway/src/gasProxy.ts does. */
export function signedEvent(action: string, subject: string, payload: Record<string, unknown>) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 60;
  const nonce = randomUUID();
  const bodyHash = createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
  const canonical = [action, subject, String(iat), String(exp), nonce, bodyHash].join('\n');
  const signature = createHmac('sha256', fakeGas.properties.GATEWAY_ASSERTION_SECRET!).update(canonical).digest('base64');
  const contents = JSON.stringify({ apiVersion: 'v1', action, requestId: randomUUID(), auth: { subject, iat, exp, nonce, bodyHash, signature }, payload });
  return { postData: { contents } } as unknown as GoogleAppsScript.Events.DoPost;
}

export function parseOutput(output: GoogleAppsScript.Content.TextOutput): { ok: boolean; code: string; data: unknown } {
  return JSON.parse((output as unknown as { text: string }).text);
}
