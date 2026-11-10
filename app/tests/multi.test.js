import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { suggestFields, reconcileTables, configuredDate, applyReviewed, exceptionSignature, editDistance } from '../src/multi.js';
import { readBytes, matrixToFile, exportMultiWorkbook } from '../src/files.js';
import { DEFAULT_RULES, reconcile, guessMapping } from '../src/reconcile.js';
import { makeDemo } from '../src/sample.js';
import { readFile } from 'node:fs/promises';
const file = (rows, name = 'a.csv') => ({ name, headers: Object.keys(rows[0]), rows });
const row = (id = '1', amount = '100', date = '2026-10-01', customer = 'Acme') => ({ 'Order ID': id, Amount: amount, Date: date, Customer: customer });
const configFor = files => ({ ...suggestFields(files), baseIndex: 0, keyRules: DEFAULT_RULES, aggregate: files.map(() => false), acceptedPairs: [] });

test('N tables: 2 through 5, arbitrary base, per-table missing and deltas', () => {
  for (let n = 2; n <= 5; n++) {
    const files = Array.from({ length: n }, (_, i) => file([row(), row('2', i === 1 ? '105' : '100')], `${i}.csv`));
    const config = configFor(files); config.baseIndex = n - 1;
    const run = reconcileTables(files, config);
    assert.equal(run.summary.matched, 1); assert.equal(run.summary.mismatch, 1); assert.equal(run.results[1].diffs[0].delta, n === 2 ? -5 : 5);
  }
  const files = [file([row('1')]), file([row('2')]), file([row('3')])];
  const run = reconcileTables(files, configFor(files));
  assert.deepEqual(run.results.map(r => r.presence), [[true, false, false], [false, true, false], [false, false, true]]);
  assert.equal(run.results[1].pairs.find(p => p.table === 2).status, 'absent');
});
test('N-table two-source regression agrees with every original fixture key', () => {
  const files = makeDemo(), old = reconcile(...files, files.map(f => guessMapping(f.headers)));
  const next = reconcileTables(files, configFor(files));
  assert.deepEqual(next.summary, old.summary);
  assert.deepEqual(next.results.map(r => [r.key, r.status]), old.results.map(r => [r.key, r.status]));
});
test('number abs and percent boundaries, negatives, invalid precision', () => {
  const files = [file([row('1', '-100'), row('2', '0')]), file([row('1', '-101'), row('2', '.01')])];
  files[1].rows[1].Amount = '0.01';
  const config = configFor(files); config.fields[0].percent = 1;
  assert.equal(reconcileTables(files, config).summary.matched, 2);
  config.fields[0].abs = '0'; assert.equal(reconcileTables(files, config).summary.mismatch, 1);
  files[1].rows[0].Amount = '1.234'; assert.throws(() => reconcileTables(files, config), /invalid number/);
});
test('date formats DD/MM, strict calendar validation and inclusive tolerance', () => {
  assert.equal(configuredDate('31/10/2026', 'DD/MM/YYYY'), configuredDate('2026-10-31', 'YYYY-MM-DD'));
  assert.equal(configuredDate('31/02/2026', 'DD/MM/YYYY'), null);
  assert.equal(configuredDate('2026-10-31', 'DD/MM/YYYY'), null);
  const files = [file([row()]), file([row('1', '100', '02/10/2026')])], config = configFor(files);
  config.fields.find(f => f.type === 'date').formats = 'YYYY-MM-DD,DD/MM/YYYY';
  assert.equal(reconcileTables(files, config).summary.matched, 1);
  config.fields.find(f => f.type === 'date').days = 0; assert.equal(reconcileTables(files, config).results[0].diffs[0].delta, 1);
});
test('text options, literal exact and ignored fields are independent', () => {
  const files = [file([row('1', '100', '2026-10-01', ' ＡＣＭＥ！ ')]), file([row()])], config = configFor(files), f = config.fields.find(f => f.type === 'text');
  f.ignorePunctuation = true; assert.equal(reconcileTables(files, config).summary.matched, 1);
  for (const option of ['trim', 'caseFold', 'fullWidth', 'ignorePunctuation']) { const next = structuredClone(config); next.fields.find(v => v.id === f.id)[option] = false; assert.equal(reconcileTables(files, next).summary.mismatch, 1); }
  f.type = 'exact'; assert.equal(reconcileTables(files, config).summary.mismatch, 1);
  f.type = 'ignore'; f.columns = ['', '']; assert.equal(reconcileTables(files, config).summary.matched, 1);
});
test('Chinese synonyms and messy title rows map Amount/Amt/金额 and customer', () => {
  const a = matrixToFile([['合成数据'], [], ['单号', '金额', '日期', '客户'], ['001', '100', '2026-10-01', 'Acme']], 'cn.csv');
  const b = file([row()]); const config = configFor([a, b]); config.keyRules = { ...DEFAULT_RULES, leadingZeros: true };
  assert.equal(a.headerRow, 3); assert.deepEqual(a.rowNumbers, [4]);
  assert.deepEqual(config.keys, [['单号'], ['Order ID']]);
  assert.equal(config.fields[0].columns[1], 'Amount'); assert.equal(reconcileTables([a, b], config).summary.matched, 1);
});
test('composite keys and independent key normalization avoid collisions', () => {
  const files = [file([row(' A / B ', '100', '2026-10-01', 'c')]), file([row('a', '100', '2026-10-01', 'b / c')])];
  const config = configFor(files); config.keys = files.map(() => ['Order ID', 'Customer']); config.fields = config.fields.filter(f => f.name !== 'customer');
  assert.equal(reconcileTables(files, config).summary.matched, 0);
});
test('aggregation sums exact cents, preserves components, exposes conflicting nonnumeric rows', () => {
  const files = [file([row()]), file([row('1', '40'), row('1', '60')])], config = configFor(files);
  assert.equal(reconcileTables(files, config).summary.duplicate, 1);
  config.aggregate[1] = true; const run = reconcileTables(files, config);
  assert.equal(run.summary.matched, 1); assert.equal(run.results[0].entries[1].components.length, 2); assert.equal(run.results[0].pass, 'Aggregated');
  files[1].rows[1].Customer = 'Different'; assert.equal(reconcileTables(files, config).summary.duplicate, 1);
});
test('review carry-over requires identical key and evidence; changed deltas become new', () => {
  const files = [file([row()]), file([row('1', '105')])], config = configFor(files), run = reconcileTables(files, config);
  const reviews = [{ signature: exceptionSignature(run.results[0]), status: 'Explained', note: 'Fee' }];
  assert.equal(applyReviewed(reconcileTables(files, config), reviews).results[0].review.note, 'Fee');
  files[1].rows[0].Amount = '106'; assert.equal(applyReviewed(reconcileTables(files, config), reviews).results[0].review, null);
});
test('near misses are bounded suggestions only; explicit acceptance reruns and rejects conflicts', () => {
  assert.equal(editDistance('order-1', 'order-2'), 1); assert.equal(editDistance('abc', 'xyz'), 3);
  const files = [file([row('A1')]), file([row('A2')])], config = configFor(files), run = reconcileTables(files, config);
  assert.equal(run.summary.matched, 0); assert.equal(run.suggestions.pairs.length, 1);
  const pair = run.suggestions.pairs[0]; config.acceptedPairs = [pair];
  const accepted = reconcileTables(files, config); assert.equal(accepted.summary.matched, 1); assert.match(accepted.results[0].pass, /accepted/);
  files[1].rows.push(row('A1')); assert.throws(() => reconcileTables(files, config), /conflicts/);
});
test('v3 samples, multi-sheet parsing, statement arithmetic and workbook highlights/original columns', async () => {
  const files = await Promise.all(['ledger.csv', 'bank.xlsx', 'invoices.csv'].map(async name => readBytes(await readFile(`samples/${name}`), name, name === 'bank.xlsx' ? 'Transactions' : undefined)));
  const config = JSON.parse(await readFile('samples/config.json')), expected = JSON.parse(await readFile('samples/expected.json'));
  const run = reconcileTables(files, config); assert.deepEqual(run.summary, expected.summary); assert.deepEqual(run.summary, { matched: 3, mismatch: 1, 'only-a': 2, 'only-b': 2, duplicate: 0 });
  assert.equal(files[1].sheets.length, 2); assert.equal(files[1].headerRow, 3); assert.deepEqual(run.inputRows, [6, 6, 7]);
  const bank = run.statements[0]; assert.equal(bank.baseTotal, 2100); assert.equal(bank.baseOnly, 400); assert.equal(bank.otherOnly, 700); assert.equal(bank.adjusted, 2400); assert.equal(bank.otherTotal, 2405.01); assert.equal(bank.residual, 5.01); assert.equal(bank.balances, false);
  run.results[2].review = { status: 'Explained', note: 'Synthetic fee' };
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await exportMultiWorkbook(run, files, { originalLayout: true }));
  assert.deepEqual(book.worksheets.map(s => s.name), ['Summary', 'Results', 'Pair 1-2', 'Pair 1-3', 'Duplicate groups', 'Component rows', 'Reviewed exceptions', 'Original 1', 'Original 2', 'Original 3']);
  assert.equal(book.getWorksheet('Results').rowCount, 9); assert.equal(book.getWorksheet('Component rows').rowCount, 3);
  assert.equal(book.getWorksheet('Reviewed exceptions').getCell('C2').value, 'Synthetic fee');
  assert.equal(book.getWorksheet('Original 3').getCell('A1').value, '单号');
  assert.equal(book.getWorksheet('Original 2').getCell('B4').fill.fgColor.argb, 'FFFFE7A0');
  assert.equal(book.getWorksheet('Results').getCell('K4').fill.fgColor.argb, 'FFFFE7A0');
});
