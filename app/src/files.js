import Papa from 'papaparse';
import { MAX_ROWS } from './reconcile.js';
export const MAX_BYTES = 8 * 1024 * 1024;

export function matrixToFile(matrix, name, sheet = 'CSV', sheets = ['CSV'], headerIndex) {
  if (headerIndex === undefined) {
    // Prefer a plausible named header over a title/preamble row.
    let best = -1;
    matrix.slice(0, 20).forEach((row, i) => {
      const values = row.map(v => String(v ?? '').trim()).filter(Boolean);
      const named = values.filter(v => /order|reference|invoice|amount|date|total|订单|金额|日期|编号/i.test(v)).length;
      const score = values.length >= 2 && new Set(values).size === values.length ? named * 10 + values.filter(v => isNaN(Number(v))).length : -1;
      if (score > best) { best = score; headerIndex = i; }
    });
  }
  if (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex >= matrix.length - 1) throw new Error('Cannot detect a header with data below it.');
  const headers = matrix[headerIndex].map(v => String(v ?? '').trim());
  while (headers.at(-1) === '') headers.pop();
  if (!headers.length || headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('Header contains blank or duplicate column names.');
  const rows = [], rowNumbers = [];
  matrix.slice(headerIndex + 1).forEach((line, i) => {
    if (!line.some(v => String(v ?? '').trim())) return;
    if (line.slice(headers.length).some(v => String(v ?? '').trim())) throw new Error(`Row ${headerIndex + i + 2} has unnamed extra columns.`);
    rows.push(Object.fromEntries(headers.map((h, c) => [h, line[c] ?? ''])));
    rowNumbers.push(headerIndex + i + 2);
  });
  if (!rows.length || rows.length > MAX_ROWS) throw new Error(`Use 1–${MAX_ROWS.toLocaleString('en-US')} data rows per sheet; split larger exports.`);
  return { name, headers, rows, rowNumbers, sheet, sheets, headerRow: headerIndex + 1 };
}

export function parseCsv(bytes, name) {
  let text, encoding = 'UTF-8';
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { text = new TextDecoder('gb18030', { fatal: true }).decode(bytes); encoding = 'GBK/GB18030'; }
  const parsed = Papa.parse(text.replace(/^\uFEFF/, ''), { skipEmptyLines: false });
  if (parsed.errors.some(e => e.code !== 'UndetectableDelimiter')) throw new Error(`Invalid CSV: ${parsed.errors[0].message}`);
  return { ...matrixToFile(parsed.data, name), encoding };
}

export async function readBytes(bytes, name, sheetName, headerRow) {
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new Error('Use a nonempty file up to 8 MB. Split larger exports.');
  if (/\.csv$/i.test(name)) return parseCsv(bytes, name);
  if (!/\.xlsx$/i.test(name)) throw new Error('Only .xlsx and .csv are supported.');
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = sheetName ? book.getWorksheet(sheetName) : book.worksheets[0];
  if (!sheet) throw new Error('Worksheet not found.');
  if (sheet.rowCount > MAX_ROWS + 20 || sheet.columnCount > 100) throw new Error('Worksheet exceeds 50,000 rows plus header area or 100 columns. Split the workbook.');
  const matrix = [];
  sheet.eachRow({ includeEmpty: true }, row => {
    const values = Array.from({ length: sheet.columnCount }, (_, i) => {
      const value = row.getCell(i + 1).value;
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('formula' in value || 'sharedFormula' in value) return value.result ?? '';
        if ('richText' in value) return value.richText.map(v => v.text).join('');
        return value.text ?? '';
      }
      return value ?? '';
    });
    matrix.push(values);
  });
  return matrixToFile(matrix, name, sheet.name, book.worksheets.map(s => s.name), headerRow === undefined ? undefined : headerRow - 1);
}

export async function exportWorkbook(run, files, rules) {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  const summary = book.addWorksheet('Summary');
  summary.addRows([['Reconcile', 'Complete result, independent of screen filters'], ['Source A', files[0].name], ['Source B', files[1].name], ['Rules', JSON.stringify(rules)], ...Object.entries(run.summary)]);
  summary.columns = [{ width: 24 }, { width: 100 }];
  const details = book.addWorksheet('Results');
  details.addRow(['Status', 'Key', 'A row', 'B row', 'A amount', 'B amount', 'Differences', 'A count', 'B count']);
  for (const r of run.results) details.addRow([r.status, r.label, r.a?.row, r.b?.row, r.a?.amount === null ? null : r.a?.amount / 100, r.b?.amount === null ? null : r.b?.amount / 100, JSON.stringify(r.diffs), r.counts.a, r.counts.b]);
  details.columns.forEach(c => { c.width = 24; });
  const duplicates = book.addWorksheet('Duplicate rows');
  duplicates.addRow(['Key', 'Side', 'Source row', 'Raw data']);
  for (const r of run.results.filter(r => r.status === 'duplicate')) for (const side of ['a', 'b']) for (const row of r.duplicateRows[side]) duplicates.addRow([r.label, side.toUpperCase(), row.row, JSON.stringify(row.raw)]);
  for (const sheet of book.worksheets) { sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }]; }
  return book.xlsx.writeBuffer();
}
