import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const requests = [];
mock.module(require.resolve('@forge/api'), { defaultExport: { asUser: () => ({ requestJira: async path => {
  requests.push(path);
  if (path === '/rest/api/3/issue/T-1?fields=project,attachment') return { ok: true, json: async () => ({ key: 'T-1', fields: { project: { key: 'T' } } }) };
  assert.equal(path, '/rest/api/3/project/T');
  return { ok: true, json: async () => ({ issueTypes: [{ id: '10001', name: 'Task', subtask: false }, { id: '10002', name: 'Sub-task', subtask: true }] }) };
} }) }, namedExports: { route: (parts, ...values) => parts.reduce((s, p, i) => s + p + (values[i] ?? ''), ''), assumeTrustedRoute: p => p } });
mock.module(require.resolve('@forge/kvs'), { namedExports: { kvs: {} } });
mock.module(require.resolve('@forge/resolver'), { namedExports: { makeResolver: definitions => definitions } });
const { handler } = await import('../src/index.js');
test('issue type resolver uses caller-authorized project metadata and rejects invalid keys', async () => {
  const context = { accountId: 'synthetic', extension: { issue: { key: 'T-1' } } };
  assert.deepEqual(await handler.issueTypes({ context, payload: { project: 'T' } }), [{ id: '10001', name: 'Task' }, { id: '10002', name: 'Sub-task' }]);
  assert.deepEqual(requests, ['/rest/api/3/issue/T-1?fields=project,attachment', '/rest/api/3/project/T']);
  await assert.rejects(handler.issueTypes({ context, payload: { project: '../bad' } }), /project key/);
  assert.equal(requests.filter(path => path === '/rest/api/3/project/T').length, 1);
});
