import Papa from 'papaparse';
import { MAX_ROWS } from './reconcile.js';
export const MAX_BYTES = 8 * 1024 * 1024;

export function matrixToFile(matrix, name, sheet = 'CSV', sheets = ['CSV'], headerIndex) {
  if (headerIndex === undefined) {
    // Prefer a plausible named header over a title/preamble row.
    let best = -1;
    matrix.slice(0, 20).forEach((row, i) => {
      const values = row.map(v => String(v ?? '').trim()).filter(Boolean);
      const named = values.filter(v => /order|reference|invoice|amount|^amt$|date|total|订单|单号|金额|日期|编号|客户/i.test(v)).length;
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
  if (run.version === 3) return exportMultiWorkbook(run, files, rules);
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

export async function exportMultiWorkbook(run, files, options = {}) {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook(), base = run.baseIndex;
  const highlight = cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE7A0' } }; };
  const summary = book.addWorksheet('Summary');
  summary.addRows([['Reconcile v3', 'All results, independent of screen filters'], ['Base table', files[base].name], ['Rules', JSON.stringify(run.config)], ...Object.entries(run.summary), ...Object.entries(run.reasonSummary).map(([k, v]) => [`Reason: ${k}`, v]), ['Rule passes', 'Exact key → Key + tolerance → Aggregated → Possible match (explicit acceptance only)']]);
  files.forEach((f, t) => summary.addRow([`Table ${t + 1}`, `${f.name} / ${f.sheet || 'CSV'} / header row ${f.headerRow || 1} / ${run.inputRows[t]} rows`]));
  for (const s of run.statements) summary.addRows([[`Statement: ${s.name}`, s.balances ? 'Balances' : 'Does not balance'], ['Base total', s.baseTotal], ['Less: in base, not other', s.baseOnly], ['Plus: in other, not base', s.otherOnly], ['Adjusted base', s.adjusted], ['Other total', s.otherTotal], ['Unresolved residual', s.residual]]);
  const fields = run.config.fields.filter(f => f.type !== 'ignore');
  const details = book.addWorksheet('Results');
  const headers = ['Status', 'Key', 'Pass', 'Present in', 'Differences', 'Review status', 'Review note', ...files.flatMap((f, t) => fields.map(field => `${t + 1}: ${field.name}`))];
  details.addRow(headers);
  for (const r of run.results) {
    const row = details.addRow([r.status, r.label, r.pass, r.presence.map((v, t) => v ? t + 1 : null).filter(Boolean).join(', '), JSON.stringify(r.diffs), r.review?.status || '', r.review?.note || '', ...files.flatMap((f, t) => fields.map(field => r.entries[t] ? field.type === 'number' ? r.entries[t].values[field.id] / 100 : r.entries[t].raw[field.columns[t]] : null))]);
    for (const d of r.diffs) for (const t of [base, d.table]) highlight(row.getCell(8 + t * fields.length + fields.findIndex(f => f.id === d.fieldId)));
  }
  for (let t = 0; t < files.length; t++) if (t !== base) {
    const sheet = book.addWorksheet(`Pair ${base + 1}-${t + 1}`);
    sheet.addRow(['Key', 'Status', 'Pass', 'Base rows', 'Other rows', 'Differences', 'Review status', 'Review note']);
    for (const r of run.results) { const p = r.pairs.find(p => p.table === t); if (p.status !== 'absent') { const row = sheet.addRow([r.label, p.status, p.pass, r.counts[base], r.counts[t], JSON.stringify(p.diffs), r.review?.status || '', r.review?.note || '']); if (p.diffs.length) highlight(row.getCell(6)); } }
  }
  const duplicates = book.addWorksheet('Duplicate groups'); duplicates.addRow(['Key', 'Table', 'Source row', 'Aggregated', 'Raw data']);
  const components = book.addWorksheet('Component rows'); components.addRow(['Key', 'Table', 'Source row', 'Raw data']);
  for (const r of run.results) r.entries.forEach((e, t) => { if (e && e.components.length > 1) for (const c of e.components) { components.addRow([r.label, files[t].name, c.row, JSON.stringify(c.raw)]); duplicates.addRow([r.label, files[t].name, c.row, Boolean(run.config.aggregate[t]), JSON.stringify(c.raw)]); } });
  const reviewed = book.addWorksheet('Reviewed exceptions'); reviewed.addRow(['Key', 'Status', 'Note', 'Reviewed by', 'When']);
  run.results.filter(r => r.review).forEach(r => reviewed.addRow([r.label, r.review.status, r.review.note, r.review.who, r.review.when]));
  if (options.originalLayout) files.forEach((file, t) => {
    const sheet = book.addWorksheet(`Original ${t + 1}`);
    sheet.addRow([...file.headers, 'Reconcile status', 'Matched key', 'Rule pass', 'Review note']);
    const byRow = new Map();
    for (const r of run.results) for (const c of r.entries[t]?.components || []) byRow.set(c.row, r);
    file.rows.forEach((raw, i) => {
      const sourceRow = file.rowNumbers?.[i] ?? i + (file.headerRow || 1) + 1, r = byRow.get(sourceRow);
      const row = sheet.addRow([...file.headers.map(h => raw[h]), r?.status || '', r?.label || '', r?.pass || '', r?.review?.note || '']);
      for (const d of r?.diffs || []) { const column = t === base ? d.baseColumn : t === d.table ? d.column : null; if (column) highlight(row.getCell(file.headers.indexOf(column) + 1)); }
    });
  });
  for (const sheet of book.worksheets) { sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.columns.forEach(c => { c.width = 24; }); }
  summary.getColumn(2).width = 100;
  return book.xlsx.writeBuffer();
}
