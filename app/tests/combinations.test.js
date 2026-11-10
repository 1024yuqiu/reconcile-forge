import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTables, suggestFields, COMBINATION_LIMITS, exceptionSignature } from '../src/multi.js';
import { DEFAULT_RULES } from '../src/reconcile.js';
const file = (rows, name) => ({ name, headers: ['Order ID', 'Amount'], rows: rows.map(([key, amount]) => ({ 'Order ID': key, Amount: amount })) });
const configFor = files => ({ ...suggestFields(files), baseIndex: 0, keyRules: DEFAULT_RULES, aggregate: files.map(() => false), acceptedPairs: [], combinationMatch: true });
for (const reverse of [false, true]) test(`amount combination: ${reverse ? 'one invoice paid in parts' : 'one payment to multiple invoices'} preserves 5.01 and three-table evidence`, () => {
  const payment = file([['PAY-501', '305.01']], 'payment.csv'), invoices = file([['INV-300', '300'], ['FEE-501', '5.01']], 'invoices.csv');
  const files = reverse ? [invoices, payment, file([['INV-300', '300'], ['FEE-501', '5.01']], 'ledger.csv')] : [payment, invoices, file([['PAY-501', '305.01']], 'ledger.csv')];
  const config = configFor(files), run = reconcileTables(files, config);
  assert.equal(run.summary.matched, 1); assert.equal(run.results.length, 1);
  assert.deepEqual(run.results[0].counts, reverse ? [2, 1, 2] : [1, 2, 1]);
  assert.equal(run.results[0].entries[1].values['field-0'], 30501);
  assert.match(run.results[0].pass, /Amount combination/);
  assert.equal(run.results[0].combination.flat().length, reverse ? 5 : 4);
  for (let t = 0; t < files.length; t++) assert.equal(run.results.reduce((n, r) => n + (r.entries[t]?.components.length || 0), 0), files[t].rows.length);
  assert.equal(run.statements[0].residual, 0);
  const disabled = reconcileTables(files, { ...config, combinationMatch: false }); assert.equal(disabled.summary.matched, 0);
});
test('combination uses existing counterpart plus a tail row and respects inclusive cent tolerance', () => {
  const files = [file([['P', '305.02']], 'a.csv'), file([['P', '300'], ['tail', '5.01']], 'b.csv')], config = configFor(files);
  assert.equal(reconcileTables(files, config).summary.matched, 1);
  files[0].rows[0].Amount = '305.03'; assert.equal(reconcileTables(files, config).summary.matched, 0);
});
test('ambiguous combinations remain unresolved and rows are never reused in two groups', () => {
  const files = [file([['p', '100'], ['q', '100']], 'a.csv'), file([['a', '40'], ['b', '60'], ['c', '30'], ['d', '70']], 'b.csv')];
  const run = reconcileTables(files, configFor(files)); assert.equal(run.summary.matched, 0); assert.ok(run.combinationSearch.ambiguous);
  files[1].rows.splice(2); const unique = reconcileTables(files, configFor(files));
  assert.equal(unique.summary.matched, 1); assert.equal(unique.results.reduce((n, r) => n + (r.entries[1]?.components.length || 0), 0), 2);
});
test('combination search bounds large candidate pools and maximum component count', () => {
  const files = [file([['p', '13']], 'a.csv'), file(Array.from({ length: 13 }, (_, i) => [`i${i}`, '1']), 'b.csv')];
  const run = reconcileTables(files, configFor(files)); assert.equal(run.summary.matched, 0); assert.equal(run.combinationSearch.bounded, true); assert.ok(run.combinationSearch.checks <= COMBINATION_LIMITS.checks);
  files[1].rows.splice(5); files[0].rows[0].Amount = '5'; assert.equal(reconcileTables(files, configFor(files)).summary.matched, 0);
});
test('combination identity changes when component source keys change despite equal amounts', () => {
  const files = [file([['p', '100']], 'a.csv'), file([['a', '40'], ['b', '60']], 'b.csv')], config = configFor(files);
  const before = exceptionSignature(reconcileTables(files, config).results[0]);
  files[1].rows[1]['Order ID'] = 'new-component';
  assert.notEqual(exceptionSignature(reconcileTables(files, config).results[0]), before);
});
