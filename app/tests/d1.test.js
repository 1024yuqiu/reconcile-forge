import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { readBytes, exportMultiWorkbook } from '../src/files.js';
import { reconcileTables, suggestFields } from '../src/multi.js';
import { DEFAULT_RULES } from '../src/reconcile.js';

test('XLSX defaults to most parsed data rows, keeps sheet order for ties and supports sparse selections', async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Read me').addRows([['Instructions'], ['Choose Transactions']]);
  book.addWorksheet('Transactions').addRows([['Synthetic export'], [], ['Order ID', 'Amount'], ['A', 1], ['B', 2], [], ['C', 3]]);
  book.addWorksheet('Tie').addRows([['Order ID', 'Amount'], ['D', 4], ['E', 5], ['F', 6]]);
  book.addWorksheet('Header only').addRow(['Order ID', 'Amount']);
  book.addWorksheet('Empty');
  const bytes = await book.xlsx.writeBuffer();
  const parsed = await readBytes(bytes, 'multi.xlsx');
  assert.equal(parsed.sheet, 'Transactions'); assert.equal(parsed.rows.length, 3); assert.equal(parsed.headerRow, 3);
  assert.equal((await readBytes(bytes, 'multi.xlsx', 'Read me')).rows.length, 1);
  assert.equal((await readBytes(bytes, 'multi.xlsx', 'Header only')).rows.length, 0);
  assert.equal((await readBytes(bytes, 'multi.xlsx', 'Empty')).rows.length, 0);
  await assert.rejects(readBytes(bytes, 'multi.xlsx', 'Missing'), /not found/);
});

test('examples domestic XLSX original layouts preserve every raw cell and all five counts', async () => {
  const names = ['domestic-clean.csv', 'domestic-gbk.csv', 'domestic-gb18030.csv'];
  const files = await Promise.all(names.map(async name => readBytes(await readFile(`../examples/domestic/${name}`), name)));
  const config = { ...suggestFields(files), baseIndex: 0, keyRules: { ...DEFAULT_RULES, leadingZeros: true }, aggregate: files.map(() => false), acceptedPairs: [] };
  const run = reconcileTables(files, config);
  assert.deepEqual(run.summary, { matched: 3, mismatch: 0, 'only-a': 0, 'only-b': 0, duplicate: 0 });
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await exportMultiWorkbook(run, files, { originalLayout: true }));
  files.forEach((file, t) => file.rows.forEach((row, i) => file.headers.forEach((h, j) => assert.deepEqual(book.getWorksheet(`Original ${t + 1}`).getCell(i + 2, j + 1).value, row[h]))));
  assert.equal(book.getWorksheet('Original 2').getCell('B2').value, '￥１，２３４．５０元');
  const summaryRows = book.getWorksheet('Summary').getSheetValues().flat(2);
  for (const [key, count] of Object.entries(run.summary)) {
    const row = book.getWorksheet('Summary').getSheetValues().find(row => row?.[1] === key);
    assert.equal(row?.[2], count, `${key} exported count; summary: ${summaryRows}`);
  }
});
