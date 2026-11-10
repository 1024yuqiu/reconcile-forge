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
const { rovoCreate } = await import('../src/index.js');
const record = { id: 'group-test', templateName: '', source: { kind: 'jira', id: 'TEST-1' }, config: {}, files: ['synthetic.csv'], rules: {}, mappings: {}, exceptionCount: 2, exceptions: [{ id: '0', label: 'A', key: 'A', status: 'mismatch', diffs: '5.01' }, { id: '1', label: 'B', key: 'B', status: 'only-a', diffs: '' }] };
state.set('run:group-test', record);
const payload = { context: { jira: { issueKey: 'TEST-1' } }, runId: record.id, project: 'TEST', issueType: '10001', exceptionIds: '0,1', confirmed: 'true' };
test('Rovo defaults to shared grouped creation and serial retry reuses exactly one issue', async () => {
  assert.deepEqual((await rovoCreate(payload, { accountId: 'synthetic' })).created, ['TEST-1']);
  assert.equal(writes.length, 1); assert.match(writes[0].fields.summary, /grouped/);
  assert.deepEqual((await rovoCreate({ ...payload, grouped: 'true' }, {})).reused, ['TEST-1']);
  assert.equal(writes.length, 1);
});
test('Rovo rejects missing confirmation and invalid grouped values before writes', async () => {
  assert.throws(() => rovoCreate({ ...payload, confirmed: 'false' }, {}), /confirmation/);
  assert.throws(() => rovoCreate({ ...payload, grouped: 'maybe' }, {}), /Grouped mode/);
  assert.equal(writes.length, 1);
});
