import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, DEFAULT_RULES, amountInCents, dateInDays, normalize, guessMapping } from '../src/reconcile.js';
import { parseCsv, readBytes, matrixToFile, exportWorkbook } from '../src/files.js';
import { makeDemo } from '../src/sample.js';
import ExcelJS from 'exceljs';
const mapping = { keys: ['Order ID'], amount: 'Amount', date: 'Date', compare: [] };
const row = (key = 'A1', amount = '100.00', date = '2026-10-01', extra = {}) => ({ 'Order ID': key, Amount: amount, Date: date, ...extra });
const file = rows => ({ name: 'test.csv', headers: ['Order ID', 'Amount', 'Date', 'Department'], rows });
const compare = (a, b, rules = {}, maps = [mapping, mapping]) => reconcile(file(a), file(b), maps, { ...DEFAULT_RULES, ...rules });

test('money port: exact cents, accounting negatives, grouping, full-width and invalid values', () => {
  assert.equal(amountInCents('$1,230.01'), 123001);
  assert.equal(amountInCents('(50.10)'), -5010);
  assert.equal(amountInCents('１２３．４５'), 12345);
  for (const value of ['', '1.234', '12,34.00', 'NaN', '99999999999999999']) assert.equal(amountInCents(value), null);
});
test('calendar dates, Excel serial, leap day and invalid dates', () => {
  assert.equal(dateInDays('2026-10-01'), dateInDays('2026年10月01日'));
  assert.equal(dateInDays(25569), 0);
  assert.equal(dateInDays('2024-02-29') + 1, dateInDays('2024-03-01'));
  assert.equal(dateInDays('2026-02-29'), null);
  assert.equal(dateInDays('10/01/26'), dateInDays('2026-10-01'));
});
test('absolute tolerance is inclusive and cents stay exact', () => {
  assert.equal(compare([row()], [row('A1', '100.01')]).summary.matched, 1);
  assert.equal(compare([row()], [row('A1', '100.02')]).summary.mismatch, 1);
  assert.equal(compare([row('A1', '0.30')], [row('A1', '0.29')]).summary.matched, 1);
});
test('percentage tolerance uses absolute A including zero and negative amounts', () => {
  assert.equal(compare([row()], [row('A1', '101.00')], { percentTolerance: 1 }).summary.matched, 1);
  assert.equal(compare([row('A1', '-100')], [row('A1', '-101')], { percentTolerance: 1 }).summary.matched, 1);
  assert.equal(compare([row('A1', '0')], [row('A1', '1')], { percentTolerance: 1 }).summary.mismatch, 1);
});
test('date outside tolerance is an explicit date mismatch, not missing', () => {
  assert.equal(compare([row()], [row('A1', '100', '2026-10-02')]).summary.matched, 1);
  const output = compare([row()], [row('A1', '100', '2026-10-03')]);
  assert.equal(output.summary.mismatch, 1); assert.equal(output.results[0].diffs[0].field, 'date');
});
test('normalization switches work independently', () => {
  assert.equal(normalize('　ＡｂＣ　'), 'abc');
  assert.equal(compare([row(' ＡｂＣ ')], [row('abc')]).summary.matched, 1);
  assert.equal(compare([row('A')], [row('a')], { caseFold: false }).summary['only-a'], 1);
  assert.equal(compare([row(' A')], [row('A')], { trim: false }).summary['only-b'], 1);
});
test('composite keys do not collide when values contain separators', () => {
  const m = { ...mapping, keys: ['Order ID', 'Department'] };
  const result = compare([row('a / b', '100', '2026-10-01', { Department: 'c' })], [row('a', '100', '2026-10-01', { Department: 'b / c' })], {}, [m, m]);
  assert.equal(result.summary['only-a'], 1); assert.equal(result.summary['only-b'], 1);
});
test('duplicates are isolated, all original duplicate rows are retained', () => {
  const result = compare([row(), row()], [row()]);
  assert.equal(result.summary.duplicate, 1); assert.equal(result.summary.matched, 0);
  assert.equal(result.results[0].duplicateRows.a.length, 2);
  assert.equal(result.results[0].counts.b, 1);
});
test('additional mapped text fields expose cell differences', () => {
  const m = { ...mapping, compare: ['Department'] };
  const result = compare([row('A1', '100', '2026-10-01', { Department: 'Ops' })], [row('A1', '100', '2026-10-01', { Department: 'Supply' })], {}, [m, m]);
  assert.equal(result.results[0].diffs[0].field, 'Department');
});
test('invalid rules, fields, values, key arity and row limit fail clearly', () => {
  for (const rules of [{ amountTolerance: '-1' }, { percentTolerance: 'NaN' }, { dateTolerance: '1.5' }]) assert.throws(() => compare([row()], [row()], rules));
  assert.throws(() => compare([row('')], [row()]), /row 2/);
  assert.throws(() => compare([row('A1', 'oops')], [row()]), /invalid amount/);
  assert.throws(() => compare([row()], [row()], {}, [{ ...mapping, keys: ['missing'] }, mapping]));
  assert.throws(() => compare([row()], [row()], {}, [{ ...mapping, keys: [] }, mapping]));
  assert.throws(() => compare(Array.from({ length: 50001 }, () => row()), [row()]), /50,000/);
});
test('UTF-8 BOM, quoted CSV values and GBK bytes decode correctly', () => {
  const utf8 = new TextEncoder().encode('\uFEFFOrder ID,Amount,Date\r\n"A,1",12.00,2026-10-01\r\n');
  assert.equal(parseCsv(utf8, 'utf.csv').rows[0]['Order ID'], 'A,1');
  // GBK literal bytes: 订单编号,金额 followed by an ASCII record.
  const gbk = new Uint8Array([0xb6,0xa9,0xb5,0xa5,0xb1,0xe0,0xba,0xc5,0x2c,0xbd,0xf0,0xb6,0xee,0x0a,0x41,0x31,0x2c,0x31,0x32,0x2e,0x30,0x30]);
  const result = parseCsv(gbk, 'gbk.csv');
  assert.equal(result.encoding, 'GBK/GB18030'); assert.equal(result.rows[0]['订单编号'], 'A1'); assert.equal(result.rows[0]['金额'], '12.00');
});
test('header detection skips title rows and retains actual source row numbers', () => {
  const result = matrixToFile([['Synthetic report'], [], ['Order ID', 'Amount'], ['A1', '12'], [], ['A2', '15']], 'preamble.csv');
  assert.equal(result.headerRow, 3); assert.deepEqual(result.rowNumbers, [4, 6]);
  assert.throws(() => matrixToFile([['Order ID', 'Order ID'], ['1', '2']], 'bad.csv', 'CSV', ['CSV'], 0), /duplicate/);
});
test('XLSX reading supports worksheets, dates, cached formulas and exports actual duplicate detail', async () => {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Data');
  sheet.addRows([['Order ID', 'Amount', 'Date'], ['A1', { formula: '1+1', result: 2 }, new Date('2026-10-01T00:00:00Z')]]);
  book.addWorksheet('Other').addRows([['Key', 'Amount'], ['X', 1]]);
  const parsed = await readBytes(await book.xlsx.writeBuffer(), 'book.xlsx');
  assert.equal(parsed.rows[0].Amount, 2); assert.equal(parsed.sheets.length, 2);
  const result = compare([row(), row()], [row()]);
  const output = new ExcelJS.Workbook(); await output.xlsx.load(await exportWorkbook(result, [file([row()]), file([row()])], DEFAULT_RULES));
  assert.equal(output.getWorksheet('Results').rowCount, 2); assert.equal(output.getWorksheet('Duplicate rows').rowCount, 4);
});
test('300-row synthetic fixture has deterministic planted categories', () => {
  const [a, b] = makeDemo(); const output = reconcile(a, b, [guessMapping(a.headers), guessMapping(b.headers)]);
  assert.deepEqual(output.summary, { matched: 270, mismatch: 18, 'only-a': 10, 'only-b': 10, duplicate: 1 });
  assert.deepEqual(output.inputRows, { a: 300, b: 300 });
});
test('50,000 unique rows compare without truncation', () => {
  const rows = Array.from({ length: 50000 }, (_, i) => row(`K${i}`));
  const output = compare(rows, rows);
  assert.equal(output.summary.matched, 50000); assert.equal(output.results.length, 50000);
});
