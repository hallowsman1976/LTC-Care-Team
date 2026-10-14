// Dates are stored as ISO yyyy-mm-dd (Christian era); people read and type them in the Thai
// Buddhist era (พ.ศ. = ค.ศ. + 543).

export const BE_OFFSET = 543;

export const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

const pad = (value: number) => String(value).padStart(2, '0');

export const toIsoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** A local calendar date (no time-zone shift), or null when `iso` is not a real date. */
export function fromIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return toIsoDate(date) === iso ? date : null;
}

/** "12 เมษายน 2528" */
export const formatThaiDate = (date: Date) => `${date.getDate()} ${THAI_MONTHS[date.getMonth()]} ${date.getFullYear() + BE_OFFSET}`;

/**
 * Reads what a person typed: d/m/yyyy (also with - or .) or "12 เมษายน 2528". Years after 2400 are
 * Buddhist era; a two-digit year is not accepted because the century would be a guess.
 */
export function parseThaiDate(text: string): Date | null {
  const value = text.trim();
  let day: number; let month: number; let year: number;
  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  const worded = /^(\d{1,2})\s+(\S+)\s+(\d{4})$/.exec(value);
  if (numeric) {
    [day, month, year] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
  } else if (worded) {
    const index = THAI_MONTHS.findIndex((name) => name === worded[2] || name.startsWith(worded[2]!.replace(/\.$/, '')));
    if (index < 0) return null;
    [day, month, year] = [Number(worded[1]), index + 1, Number(worded[3])];
  } else return null;
  if (year > 2400) year -= BE_OFFSET;
  return fromIsoDate(`${year}-${pad(month)}-${pad(day)}`);
}
