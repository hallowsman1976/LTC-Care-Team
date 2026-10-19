// A small .xlsx writer: inline strings, numbers, formulas with their computed values, a few cell
// styles, merged cells and landscape A4 page setup, packed in an uncompressed zip. Enough for
// the budget export, without shipping a spreadsheet library to every visitor.

export type CellStyle = 'title' | 'head' | 'cell' | 'bold' | 'money' | 'total' | 'number';
export type XlsxCell = string | number | null | { v: string | number | null; f?: string; s?: CellStyle };
export interface XlsxSheet { name: string; rows: XlsxCell[][]; widths?: number[]; merges?: string[] }

const STYLE_INDEX: Record<CellStyle, number> = { title: 1, head: 2, cell: 3, bold: 6, money: 4, total: 5, number: 7 };

const escapeXml = (text: string) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!)
  // Control characters other than tab and newline are not allowed in XML 1.0.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function columnName(index: number): string {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
}

function cellXml(cell: XlsxCell, ref: string): string {
  if (cell === null || cell === undefined) return '';
  const { v, f, s } = typeof cell === 'object' ? cell : { v: cell, f: undefined, s: undefined };
  const style = s ? ` s="${STYLE_INDEX[s]}"` : '';
  const formula = f ? `<f>${escapeXml(f)}</f>` : '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}>${formula}<v>${v}</v></c>`;
  if (v === null || v === undefined || v === '') return formula || style ? `<c r="${ref}"${style}>${formula}</c>` : '';
  if (formula) return `<c r="${ref}"${style} t="str">${formula}<v>${escapeXml(String(v))}</v></c>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(v))}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const cols = sheet.widths?.length ? `<cols>${sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>` : '';
  const rows = sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, column) => cellXml(cell, `${columnName(column)}${rowIndex + 1}`)).join('')}</row>`).join('');
  const merges = sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${cols}<sheetData>${rows}</sheetData>${merges}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

const thin = '<left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/>';
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="3"><font><sz val="12"/><name val="TH SarabunPSK"/></font><font><b/><sz val="12"/><name val="TH SarabunPSK"/></font><font><b/><sz val="14"/><name val="TH SarabunPSK"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${thin}</border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const safeSheetName = (name: string) => name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet';

// ── Zip (stored, no compression) ────────────────────────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF]! ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new DataView(new ArrayBuffer(30));
    // Signature, version 2.0, UTF-8 names, stored, 1 Jan 1980, CRC, sizes, name length.
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, file.data.length, 4], [22, file.data.length, 4], [26, name.length, 2], [28, 0, 2]]
      .forEach(([at, value, size]) => (size === 4 ? local.setUint32(at!, value!, true) : local.setUint16(at!, value!, true)));
    const central = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, file.data.length, 4], [24, file.data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
      .forEach(([at, value, size]) => (size === 4 ? central.setUint32(at!, value!, true) : central.setUint16(at!, value!, true)));
    locals.push(new Uint8Array(local.buffer), name, file.data);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + file.data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { output.set(part, at); at += part.length; }
  return output;
}

export function buildXlsx(sheets: XlsxSheet[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const sheetEntries = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const files: Array<[string, string]> = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetEntries}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(safeSheetName(sheet.name))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
    ...sheets.map((sheet, index): [string, string] => [`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet)])
  ];
  return zip(files.map(([name, text]) => ({ name, data: encoder.encode(text) })));
}

/** Saves the workbook through the browser's download. */
export function downloadXlsx(fileName: string, sheets: XlsxSheet[]): void {
  const blob = new Blob([buildXlsx(sheets)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
