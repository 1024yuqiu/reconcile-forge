import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createService } from '../src/service.js';
import { DEFAULT_RULES, guessMapping } from '../src/reconcile.js';
import { makeDemo } from '../src/sample.js';
function fixture() {
  const state = new Map(), created = [], files = makeDemo(); let counter = 0;
  const context = { accountId: 'reviewer', extension: { issue: { key: 'DEMO-24' } } };
  const service = createService({ store: { get: async k => state.get(k), set: async (k, v) => state.set(k, v), delete: async k => state.delete(k) }, uuid: () => `run-${++counter}`, now: () => '2026-11-10T00:00:00Z', digest: s => createHash('sha256').update(s).digest('hex').slice(0, 32), jira: async (op, p) => {
    if (op === 'issue') return { key: p.key, fields: { project: { key: 'DEMO' } } };
    if (op === 'attachments') return files.map((f, i) => ({ id: String(i), name: f.name }));
    if (op === 'findException') return created.find(c => c.fields.labels.includes(p.label))?.key;
    if (op === 'create') { const result = { key: `DEMO-${created.length + 100}`, ...p }; created.push(result); return result; }
  }, confluence: async op => op === 'page' ? { id: '42', spaceId: '9' } : files.map((f, i) => ({ id: String(i), name: f.name })), loadAttachment: async (_, a) => files[Number(a.id)] });
  const payload = { sources: [{ id: '0' }, { id: '1' }], mappings: files.map(f => guessMapping(f.headers)), rules: DEFAULT_RULES };
  return { service, context, payload, state, created };
}
test('bootstrap and template saving are project scoped', async () => {
  const { service, context, payload } = fixture();
  assert.equal((await service.bootstrap(context)).attachments.length, 2);
  await service.saveTemplate(context, { name: 'Monthly', ...payload });
  assert.equal((await service.bootstrap(context)).templates[0].name, 'Monthly');
  await assert.rejects(service.saveTemplate(context, { name: '' }), /template name/);
});
test('run stores attributable summaries and bounded exceptions, reruns deduplicate issues', async () => {
  const { service, context, payload, created, state } = fixture();
  const first = await service.run(context, payload);
  assert.equal(first.summary.mismatch, 18); assert.equal(state.get(`run:${first.id}`).who, 'reviewer');
  const p = { runId: first.id, project: 'DEMO', issueType: '10001' };
  assert.equal((await service.createIssues(context, p)).created.length, 20);
  const second = await service.run(context, payload);
  assert.equal((await service.createIssues(context, { ...p, runId: second.id })).reused.length, 20);
  assert.equal(created.length, 20); assert.equal(created[0].fields.labels[0], 'reconcile');
});
test('grouping and parent issue fields are supported, invalid targets rejected', async () => {
  const { service, context, payload, created } = fixture(); const run = await service.run(context, payload);
  await service.createIssues(context, { runId: run.id, project: 'DEMO', issueType: '10002', grouped: true, parent: 'DEMO-24' });
  assert.equal(created.length, 1); assert.deepEqual(created[0].fields.parent, { key: 'DEMO-24' });
  await assert.rejects(service.createIssues(context, { runId: run.id, project: 'bad query', issueType: '1' }), /valid project/);
});
test('attachment membership and run source authorization cannot be supplied by client', async () => {
  const { service, context, payload } = fixture();
  await assert.rejects(service.run(context, { ...payload, sources: [{ id: '999' }, { id: '1' }] }), /not on/);
  const run = await service.run(context, payload);
  await assert.rejects(service.savedRun({ ...context, extension: { issue: { key: 'OTHER-1' } } }, run.id), /not found/);
});
test('Confluence page template and history isolation', async () => {
  const { service, payload } = fixture(); const ctx = { accountId: 'r', extension: { content: { id: '42' } } };
  const run = await service.run(ctx, payload);
  assert.equal((await service.bootstrap(ctx)).scope.namespace, 'space:9');
  assert.equal((await service.savedRun(ctx, run.id)).source.id, '42');
});
test('history retention evicts older run records', async () => {
  const { service, context, payload, state } = fixture();
  for (let i = 0; i < 22; i++) await service.run(context, payload);
  assert.equal((await service.bootstrap(context)).history.length, 20); assert.equal(state.has('run:run-1'), false);
});
