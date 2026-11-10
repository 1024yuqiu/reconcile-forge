import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTables, suggestFields } from '../src/multi.js';
import { DEFAULT_RULES } from '../src/reconcile.js';
const file = (rows, name) => ({ name, headers: ['Order ID', 'Amount'], rows: rows.map(([key, amount]) => ({ 'Order ID': key, Amount: amount })) });
const configFor = files => ({ ...suggestFields(files), baseIndex: 0, keyRules: DEFAULT_RULES, aggregate: files.map(() => false), acceptedPairs: [] });
test('multi-table category totals and actual source-row evidence survive row reordering', () => {
  for (let n = 2; n <= 5; n++) {
    const files = Array.from({ length: n }, (_, i) => file([['a', '10.00'], ['b', i === 1 ? '20.02' : '20.00'], [i ? 'extra' : 'missing', '3.00']], `${i}.csv`));
    const config = configFor(files), before = reconcileTables(files, config);
    const after = reconcileTables(files.map(f => ({ ...f, rows: [...f.rows].reverse() })), config);
    assert.deepEqual(after.summary, before.summary);
    assert.equal(Object.values(before.summary).reduce((a, b) => a + b), before.results.length);
    for (const r of after.results) assert.deepEqual(r.diffs, before.results.find(v => v.key === r.key).diffs);
    for (let t = 0; t < n; t++) assert.equal(after.results.reduce((sum, r) => sum + (r.entries[t]?.components.length || 0), 0), files[t].rows.length);
  }
});
test('multi-table numeric tolerance chooses max of absolute and percent at the inclusive boundary', () => {
  const files = [file([['a', '-100.00'], ['b', '0.00']], 'a.csv'), file([['a', '-101.00'], ['b', '0.02']], 'b.csv')];
  const config = configFor(files); Object.assign(config.fields[0], { abs: '0.02', percent: 1 });
  assert.equal(reconcileTables(files, config).summary.matched, 2);
  files[1].rows[0].Amount = '-101.01'; files[1].rows[1].Amount = '0.03';
  assert.equal(reconcileTables(files, config).summary.mismatch, 2);
});
test('statement conserves negative amounts and all aggregated component rows', () => {
  const files = [file([['a', '-40'], ['a', '-60'], ['base-only', '-5']], 'a.csv'), file([['a', '-100'], ['other-only', '-2']], 'b.csv')];
  const config = configFor(files); config.aggregate[0] = true;
  const run = reconcileTables(files, config), statement = run.statements[0];
  assert.equal(statement.baseTotal, -105); assert.equal(statement.otherTotal, -102);
  assert.equal(statement.adjusted, -102); assert.equal(statement.residual, 0); assert.equal(statement.balances, true);
  assert.equal(run.results[0].entries[0].components.length, 2);
});
