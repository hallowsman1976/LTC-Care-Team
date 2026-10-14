import { z } from 'zod';
import { patientCreateSchema } from './schemas';

// Admin contracts: caregiver accounts, caregiver-to-patient assignment and bulk import of
// dependent persons from the unit's existing register (a CSV made from the template below).

const entityId = z.string().trim().min(1).max(80);

export const caregiverCreateSchema = z.object({
  displayName: z.string().trim().min(2, 'กรอกชื่อ–สกุลอย่างน้อย 2 ตัวอักษร').max(120),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'ใช้ a–z ตัวเลข จุด ขีด 3–40 ตัว'),
  password: z.string().min(12, 'รหัสผ่านอย่างน้อย 12 ตัวอักษร').max(200)
});

export const assignmentSetSchema = z.object({
  patientId: entityId,
  caregiverUserId: entityId
});

/** One register row as the browser sends it; `line` is the CSV line, for reporting back. */
export const patientImportRowSchema = patientCreateSchema
  .pick({ localCode: true, hn: true, cid: true, fullName: true, birthDate: true, sex: true, address: true, village: true, phone: true })
  .extend({ line: z.number().int().min(1) });

export const MAX_IMPORT_ROWS_PER_REQUEST = 200;

export const patientImportSchema = z.object({
  rows: z.array(patientImportRowSchema).min(1).max(MAX_IMPORT_ROWS_PER_REQUEST),
  legalBasis: patientCreateSchema.shape.legalBasis,
  privacyNoticeVersion: patientCreateSchema.shape.privacyNoticeVersion
});

export type CaregiverCreateInput = z.infer<typeof caregiverCreateSchema>;
export type AssignmentSetInput = z.infer<typeof assignmentSetSchema>;
export type PatientImportRow = z.infer<typeof patientImportRowSchema>;
export type PatientImportInput = z.infer<typeof patientImportSchema>;

type ImportKey = Exclude<keyof PatientImportRow, 'line'>;

/** Template columns: the header the template writes, other headers accepted, and an example. */
export const IMPORT_COLUMNS: ReadonlyArray<{ key: ImportKey; header: string; aliases: string[]; example: string; required: boolean }> = [
  { key: 'localCode', header: 'รหัสท้องถิ่น', aliases: ['localcode', 'รหัส'], example: '#ตัวอย่าง-001', required: true },
  { key: 'hn', header: 'HN', aliases: ['hn'], example: 'HN-000123', required: true },
  { key: 'cid', header: 'เลขประจำตัวประชาชน', aliases: ['cid', 'เลขบัตรประชาชน', 'เลขประจำตัวประชาชน 13 หลัก'], example: '1100000000001', required: true },
  { key: 'fullName', header: 'ชื่อ-สกุล', aliases: ['fullname', 'ชื่อ–สกุล', 'ชื่อ - สกุล', 'ชื่อสกุล'], example: 'นางสมใจ ตัวอย่าง', required: true },
  { key: 'birthDate', header: 'วันเกิด', aliases: ['birthdate', 'วันเดือนปีเกิด'], example: '15/03/2485', required: true },
  { key: 'sex', header: 'เพศ', aliases: ['sex'], example: 'หญิง', required: false },
  { key: 'address', header: 'ที่อยู่', aliases: ['address'], example: '12 ม.2 ต.ตัวอย่าง', required: true },
  { key: 'village', header: 'หมู่บ้าน', aliases: ['village', 'หมู่'], example: 'หมู่ 2', required: false },
  { key: 'phone', header: 'โทรศัพท์', aliases: ['phone', 'เบอร์โทร', 'เบอร์โทรศัพท์'], example: '0812345678', required: false }
];

/** Rows whose first cell starts with # are notes or the template's example, and are skipped. */
export const IMPORT_COMMENT_PREFIX = '#';

/** The template as CSV text (prepend a BOM when saving so Excel reads the Thai correctly). */
export function importTemplateCsv(): string {
  const line = (cells: string[]) => cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',');
  return [line(IMPORT_COLUMNS.map((column) => column.header)), line(IMPORT_COLUMNS.map((column) => column.example))].join('\r\n') + '\r\n';
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** Accepts yyyy-mm-dd and d/m/yyyy, in CE or BE (years after 2400 are Buddhist Era). */
export function normalizeBirthDate(value: string): string | null {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const thai = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const parts = iso ? [iso[1], iso[2], iso[3]] : thai ? [thai[3], thai[2], thai[1]] : null;
  if (!parts) return null;
  let year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (year > 2400) year -= 543;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (year < 1880 || date.valueOf() > Date.now()) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const SEX_WORDS: Record<string, PatientImportRow['sex']> = {
  หญิง: 'FEMALE', ญ: 'FEMALE', f: 'FEMALE', female: 'FEMALE', นาง: 'FEMALE', 'นางสาว': 'FEMALE',
  ชาย: 'MALE', ช: 'MALE', m: 'MALE', male: 'MALE', นาย: 'MALE',
  อื่นๆ: 'OTHER', 'อื่น ๆ': 'OTHER', other: 'OTHER', '': 'UNKNOWN', 'ไม่ระบุ': 'UNKNOWN', unknown: 'UNKNOWN'
};

export interface ImportPreviewRow { line: number; row: PatientImportRow | null; values: Record<string, string>; errors: string[] }
export interface ImportPreview { rows: ImportPreviewRow[]; missingColumns: string[] }

/** Reads a filled-in template and checks each row against the same contract the server enforces. */
export function readImportCsv(text: string): ImportPreview {
  const table = parseCsv(text);
  const headerIndex = table.findIndex((cells) => cells.some((cell) => cell.trim() !== ''));
  if (headerIndex < 0) return { rows: [], missingColumns: IMPORT_COLUMNS.filter((column) => column.required).map((column) => column.header) };
  const headers = table[headerIndex]!.map(normalizeHeader);
  const columnOf = new Map<ImportKey, number>();
  for (const column of IMPORT_COLUMNS) {
    const names = [column.header, column.key, ...column.aliases].map(normalizeHeader);
    const index = headers.findIndex((header) => names.includes(header));
    if (index >= 0) columnOf.set(column.key, index);
  }
  const missingColumns = IMPORT_COLUMNS.filter((column) => column.required && !columnOf.has(column.key)).map((column) => column.header);
  const rows: ImportPreviewRow[] = [];
  table.slice(headerIndex + 1).forEach((cells, offset) => {
    const line = headerIndex + offset + 2;
    if (cells.every((cell) => cell.trim() === '') || (cells[0] ?? '').trim().startsWith(IMPORT_COMMENT_PREFIX)) return;
    const values = Object.fromEntries(IMPORT_COLUMNS.map((column) => [column.key, (cells[columnOf.get(column.key) ?? -1] ?? '').trim()])) as Record<ImportKey, string>;
    const errors: string[] = [];
    if (/e\+/i.test(values.cid)) errors.push('เลขประจำตัวประชาชนถูก Excel แปลงเป็นเลขวิทยาศาสตร์ ให้ตั้งคอลัมน์เป็น “ข้อความ” แล้วพิมพ์ใหม่');
    const cid = values.cid.replace(/[\s-]/g, '');
    const birthDate = normalizeBirthDate(values.birthDate);
    if (values.birthDate && !birthDate) errors.push('วันเกิดไม่ถูกต้อง ใช้ วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ.) หรือ ปปปป-ดด-วว');
    const sex = SEX_WORDS[values.sex.toLowerCase()];
    if (!sex) errors.push('เพศต้องเป็น ชาย หญิง อื่น ๆ หรือเว้นว่าง');
    const candidate = { line, localCode: values.localCode, hn: values.hn, cid, fullName: values.fullName, birthDate: birthDate ?? '', sex: sex ?? 'UNKNOWN', address: values.address, village: values.village, phone: values.phone.replace(/\s/g, '') };
    const parsed = patientImportRowSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const column = IMPORT_COLUMNS.find((item) => item.key === issue.path[0]);
        if (column?.key === 'birthDate' && values.birthDate) continue;
        if (column?.key === 'cid' && errors.length && /e\+/i.test(values.cid)) continue;
        errors.push(column ? `${column.header}: ${issue.code === 'too_small' ? 'ต้องกรอก' : issue.message.startsWith('กรุณา') ? issue.message : 'รูปแบบไม่ถูกต้อง'}` : issue.message);
      }
    }
    rows.push({ line, values, row: errors.length === 0 && parsed.success ? parsed.data : null, errors });
  });
  // The register must not list one person twice: the server would skip the second as a duplicate.
  const seen = new Map<string, number>();
  for (const preview of rows) {
    if (!preview.row) continue;
    for (const key of [`hn:${preview.row.hn.toLowerCase()}`, `cid:${preview.row.cid}`]) {
      const first = seen.get(key);
      if (first !== undefined) { preview.errors.push(`${key.startsWith('hn') ? 'HN' : 'เลขประจำตัวประชาชน'} ซ้ำกับบรรทัด ${first}`); preview.row = null; break; }
      seen.set(key, preview.line);
    }
  }
  return { rows, missingColumns };
}
