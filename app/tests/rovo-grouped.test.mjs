import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const state = new Map(), writes = [];
mock.module(require.resolve('@forge/api'), { defaultExport: { asUser: () => ({ requestJira: async (path, options) => {
  if (path.includes('search/jql')) return { ok: true, json: async () => ({ issues: [] }) };
  if (options?.method === 'POST') { writes.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ key: `TEST-${writes.length}` }) }; }
  return { ok: true, json: async () => ({ key: 'TEST-1', fields: { project: { key: 'TEST' } } }) };
} }) }, namedExports: { route: (parts, ...values) => parts.reduce((s, p, i) => s + p + (values[i] ?? ''), ''), assumeTrustedRoute: p => p } });
mock.module(require.resolve('@forge/kvs'), { namedExports: { kvs: { get: async k => state.get(k), set: async (k, v) => state.set(k, v) } } });
mock.module(require.resolve('@forge/resolver'), { namedExports: { makeResolver: d => d } });
const { rovoCreate, rovoExplain } = await import('../src/index.js');
const record = { id: 'group-test', templateName: '', source: { kind: 'jira', id: 'TEST-1' }, config: {}, files: ['synthetic.csv'], rules: {}, mappings: {}, exceptionCount: 2, exceptions: [{ id: '0', label: 'A', key: 'A', status: 'mismatch', diffs: '5.01' }, { id: '1', label: 'B', key: 'B', status: 'only-a', diffs: '' }] };
state.set('run:group-test', record);
const payload = { context: { jira: { issueKey: 'TEST-1' } }, runId: record.id, project: 'TEST', issueType: '10001', exceptionIds: '0,1', confirmed: 'true' };
test('Rovo defaults to shared grouped creation and serial retry reuses exactly one issue', async () => {
  const first = await rovoCreate(payload, { accountId: 'synthetic' });
  assert.deepEqual(first.created, ['TEST-1']);
  assert.equal(first.mode, 'Grouped');
  assert.deepEqual(first.exceptions, ['Exception #0 (key A)', 'Exception #1 (key B)']);
  assert.equal(first.message, 'Mode: Grouped. Exceptions: Exception #0 (key A); Exception #1 (key B). Created Issue: TEST-1');
  assert.equal(writes.length, 1); assert.match(writes[0].fields.summary, /grouped/);
  const second = await rovoCreate({ ...payload, grouped: 'true' }, {});
  assert.deepEqual(second.reused, ['TEST-1']);
  assert.deepEqual(second.created, []);
  assert.match(second.message, /Reused Issue: TEST-1$/);
  assert.match(second.message, /key A/);
  assert.equal(writes.length, 1);
  const audit = state.get('run:group-test').audit.find(e => e.event === 'issue-confirmation');
  assert.deepEqual(audit.selected, [{ id: '0', key: 'A' }, { id: '1', key: 'B' }]);
});
test('Rovo rejects missing confirmation and invalid grouped values before writes', async () => {
  assert.throws(() => rovoCreate({ ...payload, confirmed: 'false' }, {}), /confirmation/);
  assert.throws(() => rovoCreate({ ...payload, grouped: 'maybe' }, {}), /Grouped mode/);
  assert.equal(writes.length, 1);
});
test('Rovo explain names exceptions by sequence number and key', async () => {
  const explained = await rovoExplain({ context: { jira: { issueKey: 'TEST-1' } }, runId: record.id }, {});
  assert.deepEqual(explained.examples.map(e => e.exception), ['Exception #0 (key A)', 'Exception #1 (key B)']);
  assert.match(explained.note, /zero-based/);
});
