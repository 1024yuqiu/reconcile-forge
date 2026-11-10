import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createService } from '../src/service.js';
import { suggestFields, reconcileTables } from '../src/multi.js';
import { DEFAULT_RULES } from '../src/reconcile.js';
const fixture = (persistedOrder = false) => {
  const state = new Map(), created = [], files = ['100', '105', '100'].map((Amount, i) => ({ name: `${i}.csv`, headers: ['Order ID', 'Amount'], rows: [{ 'Order ID': '1', Amount }] }));
  const context = { accountId: 'reviewer', extension: { issue: { key: 'T-1' } } }; let id = 0;
  const service = createService({ store: { get: async k => state.get(k), set: async (k, v) => state.set(k, persistedOrder ? JSON.parse(JSON.stringify(v, (_, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)) : structuredClone(v)), delete: async k => state.delete(k) },
    uuid: () => String(++id), now: () => '2026-11-10T00:00:00Z', digest: v => createHash('sha256').update(v).digest('hex').slice(0, 32), loadAttachment: async (_, a) => files[Number(a.id)],
    jira: async (op, p) => {
      if (op === 'issue') return { key: p.key, fields: { project: { key: p.key.split('-')[0] } } };
      if (op === 'attachments') return files.map((f, i) => ({ name: f.name, id: String(i) }));
      if (op === 'findException') return undefined;
      if (op === 'create') { created.push(p); return { key: `T-${created.length + 1}` }; }
    }, confluence: async () => {} });
  const config = { ...suggestFields(files), baseIndex: 0, keyRules: DEFAULT_RULES, aggregate: [false, false, false], acceptedPairs: [] };
  state.set('templates:project:T', [{ name: 'Monthly', config }]);
  const payload = { sources: files.map((f, i) => ({ id: String(i) })), config, templateName: 'Monthly' };
  return { state, created, files, service, context, payload };
};
test('saved N-table template, reviewed exceptions survive rerun and changed evidence does not', async () => {
  const { service, context, payload, files } = fixture();
  await service.saveTemplate(context, { name: 'Monthly', ...payload });
  assert.equal((await service.bootstrap(context)).templates[0].config.keys.length, 3);
  const first = await service.run(context, payload);
  const reviewed = await service.reviewException({ ...context, accountId: 'second-reviewer' }, { runId: first.id, id: '0', status: 'Explained', note: 'Monthly fee' });
  assert.equal(reviewed.who, 'second-reviewer');
  const next = await service.run(context, payload); assert.equal(next.results[0].review.note, 'Monthly fee');
  files[1].rows[0].Amount = '106'; assert.equal((await service.run(context, payload)).results[0].review, null);
  assert.equal((await service.savedRun(context, next.id)).exceptions[0].review.status, 'Explained');
});
test('worker compact save retains total counts and signs identical evidence to server runs', async () => {
  const { service, context, payload, files } = fixture();
  const server = await service.run(context, payload), run = reconcileTables(files, payload.config);
  const compact = { ...run, results: run.results.map(r => ({ ...r, entries: r.entries.map(e => e ? { components: e.components.map(c => ({ values: c.values })) } : null) })) };
  const saved = await service.saveRun(context, { ...payload, result: compact });
  assert.equal(saved.reviews[0].signature, server.results[0].signature);
  await service.reviewException(context, { runId: saved.id, id: '0', status: 'Ignored', note: 'Synthetic' });
  assert.equal((await service.run(context, payload)).results[0].review.status, 'Ignored');
});
test('selected issues require confirmation, preserve selection, serial retries reuse despite review changes', async () => {
  const { service, context, payload, created } = fixture();
  const run = await service.run(context, payload), p = { runId: run.id, project: 'T', issueType: '10001', selectedIds: ['0'] };
  await assert.rejects(service.createIssues(context, { runId: run.id, project: 'T', issueType: '10001' }), /specific exceptions/);
  await assert.rejects(service.createIssues(context, p), /confirmation/);
  await assert.rejects(service.createIssues(context, { ...p, selectedIds: ['invalid'], confirmed: true }), /not in this run/);
  await service.createIssues(context, { ...p, confirmed: true }); assert.equal(created.length, 1);
  await service.reviewException(context, { runId: run.id, id: '0', status: 'Explained', note: 'Fee' });
  const response = await service.createIssues(context, { ...p, confirmed: true }); assert.equal(response.reused.length, 1); assert.equal(created.length, 1);
});
test('worker save enforces membership and review rejects cross-source access and oversized notes', async () => {
  const { service, context, payload, files } = fixture(), result = reconcileTables(files, payload.config);
  await assert.rejects(service.saveRun(context, { ...payload, sources: [{ id: '999' }, { id: '1' }], result }), /not on/);
  const run = await service.run(context, payload);
  await assert.rejects(service.reviewException({ ...context, extension: { issue: { key: 'T-2' } } }, { runId: run.id }), /not found/);
  await assert.rejects(service.reviewException(context, { runId: run.id, id: '0', status: 'Explained', note: 'x'.repeat(501) }), /500/);
});
test('evicting a saved template also evicts its reviews and prevents new orphan review records', async () => {
  const { service, context, payload, state } = fixture();
  const run = await service.run(context, payload);
  await service.reviewException(context, { runId: run.id, id: '0', status: 'Explained', note: 'Fee' });
  const record = await service.savedRun(context, run.id);
  assert.equal(state.has(record.reviewNamespace), true);
  for (let i = 0; i < 20; i++) await service.saveTemplate(context, { name: `Template ${i}`, config: payload.config });
  assert.equal((await service.bootstrap(context)).templates.length, 20);
  assert.equal(state.has(record.reviewNamespace), false);
  await assert.rejects(service.reviewException(context, { runId: run.id, id: '0', status: 'Explained', note: 'Fee' }), /Save and run/);
});

// Forge KVS can return object properties in a different order after persistence.
async function reload(f) {
  await f.service.saveTemplate(f.context, { name: 'Monthly', ...f.payload });
  return { ...f.payload, config: (await f.service.bootstrap(f.context)).templates[0].config };
}
async function workerSave(f, payload) {
  const result = reconcileTables(f.files, payload.config);
  const saved = await f.service.saveRun(f.context, { ...payload, result: { ...result, results: result.results.map(r => ({ ...r, entries: r.entries.map(e => e ? { components: e.components.map(c => ({ values: c.values })) } : null) })) } });
  return { id: saved.id, results: saved.reviews };
}
for (const status of ['Explained', 'Ignored']) test(`template reload restores ${status} evidence review through worker save`, async () => {
  const f = fixture(true), first = await workerSave(f, f.payload);
  await f.service.reviewException(f.context, { runId: first.id, id: '0', status, note: 'Remember after reload' });
  const payload = await reload(f), next = await workerSave(f, payload);
  assert.equal(next.results[0].signature, first.results[0].signature);
  assert.equal(next.results[0].review.status, status);
  assert.equal(next.results[0].review.note, 'Remember after reload');
  assert.equal((await f.service.run(f.context, payload)).results[0].review.status, status);
});
for (const grouped of [true, false]) test(`template reload reuses unchanged ${grouped ? 'grouped' : 'selected'} issue after reordered storage`, async () => {
  const f = fixture(true), first = await workerSave(f, f.payload);
  const request = { project: 'T', issueType: '10001', selectedIds: ['0'], confirmed: true, grouped };
  assert.deepEqual((await f.service.createIssues(f.context, { ...request, runId: first.id })).created, ['T-2']);
  const next = await workerSave(f, await reload(f));
  const response = await f.service.createIssues(f.context, { ...request, runId: next.id });
  assert.deepEqual(response, { created: [], reused: ['T-2'], nextOffset: 1, savedExceptions: 1, totalExceptions: 1 });
  assert.equal(f.created.length, 1);
});
for (const change of ['amount', 'row', 'rule']) test(`template reload rejects old issue and review when ${change} evidence changes`, async () => {
  const f = fixture(true), first = await workerSave(f, f.payload);
  const request = { project: 'T', issueType: '10001', selectedIds: ['0'], confirmed: true, grouped: true };
  await f.service.reviewException(f.context, { runId: first.id, id: '0', status: 'Ignored', note: 'Old evidence' });
  await f.service.createIssues(f.context, { ...request, runId: first.id });
  const payload = await reload(f);
  if (change === 'amount') f.files[1].rows[0].Amount = '106';
  if (change === 'row') f.files[1].rows.push({ 'Order ID': '1', Amount: '105' });
  if (change === 'rule') payload.config.fields[0].abs = '0.02';
  const next = await workerSave(f, payload);
  assert.notEqual(next.results[0].signature, first.results[0].signature);
  assert.equal(next.results[0].review, null);
  assert.deepEqual((await f.service.createIssues(f.context, { ...request, runId: next.id })).created, ['T-3']);
  assert.equal(f.created.length, 2);
});
