import { z } from 'zod';
import { DEPENDENCY_OPTIONS, dependencyFromAdl, MENTAL_HEALTH_OPTIONS, RELATIONSHIP_OPTIONS, RIGHT_TYPE_OPTIONS, TAI_GROUP_OPTIONS } from './patient';
import { patientCreateSchema } from './schemas';

// Admin contracts: caregiver accounts, caregiver-to-patient assignment and bulk import of
// dependent persons from the unit's existing register (a CSV made from the template below).

const entityId = z.string().trim().min(1).max(80);

export const EDUCATION_LEVELS = [
  ['PRIMARY', 'ประถมศึกษา'],
  ['LOWER_SECONDARY', 'มัธยมศึกษาตอนต้น'],
  ['UPPER_SECONDARY', 'มัธยมศึกษาตอนปลาย / ปวช.'],
  ['DIPLOMA', 'อนุปริญญา / ปวส.'],
  ['BACHELOR', 'ปริญญาตรี'],
  ['POSTGRADUATE', 'สูงกว่าปริญญาตรี']
] as const;

export const ORGANIZATION_TYPES = [
  ['HEALTH_PROMOTING_HOSPITAL', 'โรงพยาบาลส่งเสริมสุขภาพตำบล (รพ.สต.)'],
  ['LOCAL_GOVERNMENT', 'องค์กรปกครองส่วนท้องถิ่น (อบต./เทศบาล)'],
  ['HOSPITAL', 'โรงพยาบาล'],
  ['ELDERLY_CENTER', 'ศูนย์พัฒนาคุณภาพชีวิตผู้สูงอายุ'],
  ['OTHER', 'อื่น ๆ']
] as const;

/** Courses offered as one-tap choices; any other course can be typed in. */
export const COMMON_CG_COURSES = [
  'หลักสูตรผู้ดูแลผู้สูงอายุ (Caregiver) 70 ชั่วโมง',
  'หลักสูตรผู้ช่วยเหลือดูแลผู้สูงอายุ 420 ชั่วโมง',
  'หลักสูตรฟื้นฟูศักยภาพผู้ดูแลผู้สูงอายุ (Refresher)',
  'การปฐมพยาบาลและช่วยฟื้นคืนชีพขั้นพื้นฐาน (CPR)'
] as const;

const enumOf = <T extends readonly (readonly [string, string])[]>(pairs: T) => z.enum(pairs.map(([value]) => value) as [T[number][0], ...T[number][0][]], { errorMap: () => ({ message: 'กรุณาเลือก' }) });
const pastDate = z.string().date('เลือกวันที่').refine((value) => value <= new Date().toISOString().slice(0, 10), 'วันที่ต้องไม่เกินวันนี้');

export const MAX_PROFILE_PHOTO_BASE64 = 700_000;

export const caregiverTrainingSchema = z.object({
  course: z.string().trim().min(2, 'ระบุชื่อหลักสูตร').max(160),
  provider: z.string().trim().max(160),
  completedOn: pastDate,
  hours: z.number({ invalid_type_error: 'ระบุเป็นตัวเลข' }).int().min(1).max(2000).optional()
});

const cidSchema = z.string().trim().regex(/^\d{13}$/, 'กรุณากรอกเลข 13 หลัก');
const passwordSchema = z.string().min(12, 'รหัสผ่านอย่างน้อย 12 ตัวอักษร').max(200);

/** Profile fields shared by the add and edit forms. */
const caregiverProfileShape = {
  displayName: z.string().trim().min(2, 'กรอกชื่อ–สกุลอย่างน้อย 2 ตัวอักษร').max(120),
  birthDate: pastDate,
  phone: z.string().transform((value) => value.replace(/[\s-]/g, '')).pipe(z.string().regex(/^0\d{8,9}$/, 'เบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0')),
  address: z.string().trim().min(5, 'กรอกที่อยู่').max(500),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('รูปแบบอีเมลไม่ถูกต้อง').max(160)]),
  photo: z.object({ mimeType: z.literal('image/jpeg'), base64: z.string().min(4).max(MAX_PROFILE_PHOTO_BASE64) }).optional(),
  education: enumOf(EDUCATION_LEVELS),
  organization: z.object({
    name: z.string().trim().min(2, 'กรอกชื่อหน่วยงาน').max(160),
    type: enumOf(ORGANIZATION_TYPES),
    serviceArea: z.string().trim().max(200)
  }),
  trainings: z.array(caregiverTrainingSchema).max(10)
};

export const caregiverCreateSchema = z.object({
  ...caregiverProfileShape,
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'ใช้ a–z ตัวเลข จุด ขีด 3–40 ตัว'),
  password: passwordSchema,
  cid: cidSchema
});

export const caregiverGetSchema = z.object({ userId: entityId });

/** An edit. Empty `cid` or `newPassword` keeps the current one; `recordVersion` 0 means no profile row yet. */
export const caregiverUpdateSchema = z.object({
  ...caregiverProfileShape,
  userId: entityId,
  recordVersion: z.number().int().min(0),
  enabled: z.boolean(),
  cid: z.union([z.literal(''), cidSchema]),
  newPassword: z.union([z.literal(''), passwordSchema]),
  removePhoto: z.boolean()
});

/** A caregiver as the edit form loads it. The CID is never sent back, only its last four digits. */
export interface CaregiverDetail {
  userId: string; displayName: string; username: string; enabled: boolean; activePatients: number;
  cidLast4: string; birthDate: string; phone: string; address: string; email: string; photoUrl: string;
  education: string; organization: { name: string; type: string; serviceArea: string };
  trainings: CaregiverTraining[]; recordVersion: number;
}

export const assignmentSetSchema = z.object({
  patientId: entityId,
  caregiverUserId: entityId
});

/** One register row as the browser sends it; `line` is the CSV line, for reporting back. */
export const patientImportRowSchema = patientCreateSchema
  .pick({
    localCode: true, hn: true, cid: true, fullName: true, birthDate: true, sex: true, address: true, village: true, phone: true,
    villageNo: true, villageName: true, subdistrict: true, district: true, province: true, latitude: true, longitude: true,
    mainCaregiverName: true, mainCaregiverPhone: true, relationship: true, rightType: true, diseases: true,
    dependencyStatus: true, adlScore: true, taiGroup: true, ppsScore: true, mentalHealthStatus: true, registerDate: true
  })
  .extend({
    line: z.number().int().min(1),
    /** The CG's sign-in name; the server assigns the patient to that caregiver. */
    caregiverUsername: z.string().trim().toLowerCase().max(40).optional()
  });

export const MAX_IMPORT_ROWS_PER_REQUEST = 200;

export const patientImportSchema = z.object({
  rows: z.array(patientImportRowSchema).min(1).max(MAX_IMPORT_ROWS_PER_REQUEST),
  legalBasis: patientCreateSchema.shape.legalBasis,
  privacyNoticeVersion: patientCreateSchema.shape.privacyNoticeVersion
});

export type CaregiverCreateInput = z.infer<typeof caregiverCreateSchema>;
export type CaregiverTraining = z.infer<typeof caregiverTrainingSchema>;
export type CaregiverUpdateInput = z.infer<typeof caregiverUpdateSchema>;
export type AssignmentSetInput = z.infer<typeof assignmentSetSchema>;
export type PatientImportRow = z.infer<typeof patientImportRowSchema>;
export type PatientImportInput = z.infer<typeof patientImportSchema>;

type ImportKey = Exclude<keyof PatientImportRow, 'line'>;
type Choices = ReadonlyArray<readonly [string, string]>;

interface ImportColumn {
  key: ImportKey;
  /** The header the template writes. */
  header: string;
  /** Other headers accepted, including those of the earlier, shorter template. */
  aliases: string[];
  example: string;
  required: boolean;
  /** What may be typed, shown on the import page. */
  hint?: string;
  /** For choice columns: the codes and Thai labels, plus extra words people commonly write. */
  choices?: Choices;
  words?: Record<string, string[]>;
  /** Read from older files only; not written to the template. */
  legacy?: boolean;
}

/** Template columns, in the order of the registration form. */
export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: 'localCode', header: 'รหัสท้องถิ่น', aliases: ['localcode', 'รหัส'], example: '#ตัวอย่าง-001', required: false, hint: 'ไม่บังคับ' },
  { key: 'hn', header: 'HN', aliases: ['hn'], example: 'HN-000123', required: true },
  { key: 'cid', header: 'เลขประจำตัวประชาชน', aliases: ['cid', 'เลขบัตรประชาชน', 'เลขประจำตัวประชาชน 13 หลัก'], example: '1100000000001', required: true, hint: '13 หลัก ตั้งคอลัมน์เป็นข้อความ' },
  { key: 'fullName', header: 'ชื่อ-สกุล', aliases: ['fullname', 'ชื่อ–สกุล', 'ชื่อ - สกุล', 'ชื่อสกุล'], example: 'นางสมใจ ตัวอย่าง', required: true },
  { key: 'sex', header: 'เพศ', aliases: ['sex'], example: 'หญิง', required: false, hint: 'ชาย / หญิง / อื่น ๆ' },
  { key: 'birthDate', header: 'วันเกิด', aliases: ['birthdate', 'วันเดือนปีเกิด'], example: '15/03/2485', required: true, hint: 'วว/ดด/ปปปป พ.ศ. หรือ ค.ศ.' },
  { key: 'phone', header: 'เบอร์โทร', aliases: ['phone', 'โทรศัพท์', 'เบอร์โทรศัพท์'], example: '0812345678', required: false },
  { key: 'address', header: 'บ้านเลขที่/ที่อยู่', aliases: ['address', 'ที่อยู่', 'บ้านเลขที่'], example: '12/3', required: true },
  { key: 'villageNo', header: 'หมู่ที่', aliases: ['villageno', 'หมู่'], example: '2', required: false, hint: 'ตัวเลข' },
  { key: 'villageName', header: 'ชื่อหมู่บ้าน', aliases: ['villagename'], example: 'บ้านหนองบัว', required: false },
  { key: 'subdistrict', header: 'ตำบล', aliases: ['subdistrict'], example: 'ตัวอย่าง', required: false },
  { key: 'district', header: 'อำเภอ', aliases: ['district'], example: 'เมือง', required: false },
  { key: 'province', header: 'จังหวัด', aliases: ['province'], example: 'ขอนแก่น', required: false },
  { key: 'latitude', header: 'ละติจูด', aliases: ['latitude', 'lat'], example: '16.432100', required: false, hint: 'ทศนิยม เช่น 16.4321' },
  { key: 'longitude', header: 'ลองจิจูด', aliases: ['longitude', 'lng', 'long'], example: '102.823600', required: false, hint: 'ทศนิยม เช่น 102.8236' },
  { key: 'mainCaregiverName', header: 'ชื่อผู้ดูแลหลัก', aliases: ['maincaregivername', 'ผู้ดูแลหลัก', 'ชื่อญาติ'], example: 'นายสมชาย ตัวอย่าง', required: false },
  { key: 'mainCaregiverPhone', header: 'เบอร์โทรผู้ดูแลหลัก', aliases: ['maincaregiverphone', 'เบอร์ญาติ'], example: '0898765432', required: false },
  { key: 'relationship', header: 'ความสัมพันธ์', aliases: ['relationship'], example: 'บุตร', required: false, choices: RELATIONSHIP_OPTIONS,
    words: { SPOUSE: ['สามี', 'ภรรยา'], CHILD: ['ลูก', 'บุตรชาย', 'บุตรสาว', 'ลูกชาย', 'ลูกสาว'], CHILD_IN_LAW: ['ลูกเขย', 'ลูกสะใภ้', 'บุตรเขย', 'บุตรสะใภ้'], SIBLING: ['พี่', 'น้อง'], RELATIVE: ['ญาติ'], HIRED: ['ผู้ดูแลจ้าง', 'จ้าง'] } },
  { key: 'rightType', header: 'สิทธิการรักษา', aliases: ['righttype', 'สิทธิ'], example: 'บัตรทอง', required: false, choices: RIGHT_TYPE_OPTIONS, hint: 'บัตรทอง / ข้าราชการ / ประกันสังคม / อปท. / ชำระเอง / อื่น ๆ',
    words: { UC: ['บัตรทอง', '30 บาท', 'ucs', 'บัตรประกันสุขภาพ'], CSMBS: ['ข้าราชการ', 'รัฐวิสาหกิจ', 'เบิกได้'], SSS: ['ประกันสังคม'], LGO: ['อปท', 'อปท.', 'ท้องถิ่น'], SELF_PAY: ['จ่ายเอง'] } },
  { key: 'diseases', header: 'โรคประจำตัว', aliases: ['diseases', 'disease', 'โรค'], example: 'ความดันโลหิตสูง; เบาหวาน', required: false, hint: 'หลายโรคคั่นด้วย ; หรือ ,' },
  { key: 'adlScore', header: 'คะแนน ADL', aliases: ['adlscore', 'adl'], example: '8', required: false, hint: '0–20' },
  { key: 'dependencyStatus', header: 'ภาวะพึ่งพิง', aliases: ['dependencystatus'], example: 'ติดบ้าน', required: false, choices: DEPENDENCY_OPTIONS, hint: 'ติดสังคม / ติดบ้าน / ติดเตียง (เว้นว่างได้ ระบบคิดจากคะแนน ADL)' },
  { key: 'taiGroup', header: 'กลุ่ม TAI', aliases: ['taigroup', 'tai'], example: 'C3', required: false, choices: TAI_GROUP_OPTIONS, hint: 'I1–I3, C2–C4, B3–B5' },
  { key: 'ppsScore', header: 'คะแนน PPS', aliases: ['ppsscore', 'pps'], example: '50', required: false, hint: '10–100 ทีละ 10' },
  { key: 'mentalHealthStatus', header: 'สุขภาพจิต', aliases: ['mentalhealthstatus'], example: 'ปกติ', required: false, choices: MENTAL_HEALTH_OPTIONS,
    words: { STRESS: ['เครียด', 'วิตกกังวล'], COGNITIVE_IMPAIRMENT: ['สมองเสื่อม'], NOT_ASSESSED: ['ยังไม่ประเมิน'] } },
  { key: 'registerDate', header: 'วันที่ลงทะเบียน', aliases: ['registerdate'], example: '01/10/2569', required: false, hint: 'เว้นว่าง = วันที่นำเข้า' },
  { key: 'caregiverUsername', header: 'ชื่อผู้ใช้ CG', aliases: ['caregiverusername', 'caregiverid', 'cg'], example: 'cg.somjai', required: false, hint: 'มอบหมาย CG ทันที เว้นว่างได้' },
  { key: 'village', header: 'หมู่บ้าน', aliases: ['village'], example: '', required: false, legacy: true }
];

/** Rows whose first cell starts with # are notes or the template's example, and are skipped. */
export const IMPORT_COMMENT_PREFIX = '#';

/** The template as CSV text (prepend a BOM when saving so Excel reads the Thai correctly). */
export function importTemplateCsv(): string {
  const line = (cells: string[]) => cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',');
  const columns = IMPORT_COLUMNS.filter((column) => !column.legacy);
  return [line(columns.map((column) => column.header)), line(columns.map((column) => column.example))].join('\r\n') + '\r\n';
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

const squash = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '');

/** A choice cell as its code: the code itself, the Thai label (with or without its bracketed note) or a common word. */
function choiceCode(column: ImportColumn, value: string): string | null {
  const typed = squash(value);
  for (const [code, label] of column.choices ?? []) {
    const names = [code, label, label.split(' (')[0]!, ...label.split('/'), ...(column.words?.[code] ?? [])];
    if (names.some((name) => squash(name) === typed)) return code;
  }
  return null;
}

/** Excel drops the leading 0 of a phone number stored as a number: put it back on 9-digit mobiles. */
const phoneOf = (value: string) => {
  const digits = value.replace(/[\s-]/g, '');
  return /^[1-9]\d{8}$/.test(digits) ? `0${digits}` : digits;
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
    const birthDate = normalizeBirthDate(values.birthDate);
    if (values.birthDate && !birthDate) errors.push('วันเกิดไม่ถูกต้อง ใช้ วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ.) หรือ ปปปป-ดด-วว');
    const registerDate = values.registerDate ? normalizeBirthDate(values.registerDate) : undefined;
    if (registerDate === null) errors.push('วันที่ลงทะเบียนไม่ถูกต้อง ใช้ วว/ดด/ปปปป และต้องไม่เกินวันนี้');
    const sex = SEX_WORDS[values.sex.toLowerCase()];
    if (!sex) errors.push('เพศต้องเป็น ชาย หญิง อื่น ๆ หรือเว้นว่าง');
    const choices: Record<string, string | undefined> = {};
    for (const column of IMPORT_COLUMNS.filter((item) => item.choices)) {
      const value = values[column.key];
      if (!value) continue;
      const code = choiceCode(column, value);
      if (code) choices[column.key] = code;
      else errors.push(`${column.header}: “${value}” ไม่ตรงกับตัวเลือก (${column.hint ?? column.choices!.map(([, label]) => label.split(' (')[0]).join(' / ')})`);
    }
    // Leave the dependency group to follow the ADL score when the file gives only the score.
    const adl = values.adlScore === '' ? undefined : Number(values.adlScore);
    if (!choices.dependencyStatus && adl !== undefined && Number.isInteger(adl) && adl >= 0 && adl <= 20) choices.dependencyStatus = dependencyFromAdl(adl);
    const candidate = {
      line, localCode: values.localCode, hn: values.hn, cid: values.cid.replace(/[\s-]/g, ''), fullName: values.fullName,
      birthDate: birthDate ?? '', sex: sex ?? 'UNKNOWN', address: values.address, village: values.village, phone: phoneOf(values.phone),
      villageNo: values.villageNo.replace(/^หมู่\s*(ที่)?\s*/, ''), villageName: values.villageName, subdistrict: values.subdistrict.replace(/^ต(ำบล|\.)\s*/, ''),
      district: values.district.replace(/^อ(ำเภอ|\.)\s*/, ''), province: values.province.replace(/^จ(ังหวัด|\.)\s*/, ''),
      latitude: values.latitude, longitude: values.longitude, mainCaregiverName: values.mainCaregiverName, mainCaregiverPhone: phoneOf(values.mainCaregiverPhone),
      relationship: choices.relationship, rightType: choices.rightType, diseases: values.diseases.split(/[,;|]/).map((item) => item.trim()).filter(Boolean).join(', '),
      dependencyStatus: choices.dependencyStatus, adlScore: values.adlScore, taiGroup: choices.taiGroup, ppsScore: values.ppsScore,
      mentalHealthStatus: choices.mentalHealthStatus, registerDate: registerDate ?? undefined, caregiverUsername: values.caregiverUsername || undefined
    };
    const parsed = patientImportRowSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const column = IMPORT_COLUMNS.find((item) => item.key === issue.path[0]);
        if (column?.key === 'birthDate' && values.birthDate) continue;
        if (column?.key === 'cid' && /e\+/i.test(values.cid)) continue;
        const reason = issue.code === 'too_small' && !values[column?.key ?? 'hn'] ? 'ต้องกรอก' : issue.message.startsWith('กรุณา') || issue.message.startsWith('เบอร์') ? issue.message : column?.hint ? `รูปแบบไม่ถูกต้อง (${column.hint})` : 'รูปแบบไม่ถูกต้อง';
        errors.push(column ? `${column.header}: ${reason}` : issue.message);
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
