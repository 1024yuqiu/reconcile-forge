import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createService } from '../src/service.js';
import { suggestFields } from '../src/multi.js';
import { DEFAULT_RULES } from '../src/reconcile.js';
import { adfText, issueDescription, categoryText, plural } from '../src/describe.js';

// Three sources: ledger and invoices agree on key 1; bank is missing key 1 and has different amounts for key 2.
const fixture = () => {
  const state = new Map(), created = [];
  const files = [
    { name: 'ledger.csv', headers: ['Order ID', 'Amount'], rows: [{ 'Order ID': '1', Amount: '100' }, { 'Order ID': '2', Amount: '50' }] },
    { name: 'bank.xlsx', headers: ['Order ID', 'Amount'], rows: [{ 'Order ID': '2', Amount: '55.5' }] },
    { name: 'invoices.csv', headers: ['Order ID', 'Amount'], rows: [{ 'Order ID': '1', Amount: '100' }, { 'Order ID': '2', Amount: '50' }] }
  ];
  const context = { accountId: 'reviewer', extension: { issue: { key: 'T-1' } } }; let id = 0;
  const service = createService({
    store: { get: async k => state.get(k), set: async (k, v) => state.set(k, structuredClone(v)), delete: async k => state.delete(k) },
    uuid: () => `run-${++id}`, now: () => '2026-11-11T00:00:00Z', digest: v => createHash('sha256').update(v).digest('hex').slice(0, 32), loadAttachment: async (_, a) => files[Number(a.id)],
    jira: async (op, p) => {
      if (op === 'issue') return { key: p.key, fields: { project: { key: 'T' } } };
      if (op === 'attachments') return files.map((f, i) => ({ name: f.name, id: String(i) }));
      if (op === 'findException') return undefined;
      if (op === 'create') { created.push(p); return { key: `T-${created.length + 1}` }; }
      if (op === 'comment') return { id: '1' };
    }, confluence: async () => { throw new Error('unused'); } });
  const config = { ...suggestFields(files), baseIndex: 0, keyRules: DEFAULT_RULES, aggregate: [false, false, false], acceptedPairs: [] };
  const payload = { sources: files.map((f, i) => ({ id: String(i) })), config, templateName: 'Monthly close' };
  return { service, context, payload, created };
};
const request = (run, selectedIds, grouped) => ({ runId: run.id, project: 'T', issueType: '10001', selectedIds, confirmed: true, grouped });
const readable = description => {
  const t = adfText(description);
  assert.ok(!t.includes('{"'), t); assert.ok(!t.includes('[\\"'), t); assert.ok(!/[\[\]{}]/.test(t), t); assert.ok(!t.includes('\\"'), t);
  assert.ok(t.includes('Exception #'), t);
  for (const m of t.matchAll(/(\d+) exceptions?\b/g)) assert.equal(/exceptions\b/.test(m[0]), m[1] !== '1', m[0]);
  return t;
};

test('single issue description is readable: run, template, sources, category, counts, amounts, field differences', async () => {
  const { service, context, payload, created } = fixture();
  const run = await service.run(context, payload);
  const ids = run.results.filter(r => r.status !== 'matched').map(r => r.id);
  await service.createIssues(context, request(run, ids, false));
  assert.equal(created.length, ids.length);
  const texts = created.map(c => readable(c.fields.description));
  assert.ok(created.every(c => c.fields.description.type === 'doc' && c.fields.description.version === 1));
  const missing = texts.find(t => t.includes('(key 1)')), mismatch = texts.find(t => t.includes('(key 2)'));
  assert.match(missing, /Reconciliation run run-1/); assert.match(missing, /Template: Monthly close/);
  assert.match(missing, /Source A: ledger\.csv/); assert.match(missing, /Source B: bank\.xlsx/); assert.match(missing, /Source C: invoices\.csv/);
  assert.match(missing, /Category: missing in B/); assert.match(missing, /Rows: A 1 · B 0 · C 1/);
  assert.match(missing, /Amount: A 100\.00 · B none · C 100\.00/i);
  assert.match(mismatch, /Category: amount mismatch/i); assert.match(mismatch, /Amount: 50\.00 → 55\.50 \(A vs B\)/i);
  assert.match(mismatch, /Amount: A 50\.00 · B 55\.50 · C 50\.00/i);
  assert.match(texts[0], /1 exception\b/); assert.ok(!/1 exceptions/.test(texts[0]));
  assert.ok(created.every(c => !/\{"|\[\\"|exceptions\b.*1 exceptions/.test(c.fields.summary)), created.map(c => c.fields.summary).join('|'));
});

test('grouped issue description lists every exception in its own section with correct plurals', async () => {
  const { service, context, payload, created } = fixture();
  const run = await service.run(context, payload);
  const ids = run.results.filter(r => r.status !== 'matched').map(r => r.id);
  assert.equal(ids.length, 2);
  await service.createIssues(context, request(run, ids, true));
  assert.equal(created.length, 1);
  const t = readable(created[0].fields.description);
  assert.match(t, /2 exceptions \(grouped in this issue\)/);
  assert.equal((t.match(/Exception #/g) || []).length, 2);
  assert.match(t, /Category: missing in B/); assert.match(t, /Category: amount mismatch/);
  assert.match(created[0].fields.summary, /2 exceptions/);
  // one exception grouped: singular
  created.length = 0;
  await service.createIssues(context, request(run, [ids[0]], true));
  const one = readable(created[0].fields.description);
  assert.match(one, /1 exception \(grouped in this issue\)/); assert.ok(!/1 exceptions/.test(one));
  assert.match(created[0].fields.summary, /1 exception \(grouped\)/);
});

test('dedupe still works across reruns after the description change', async () => {
  const { service, context, payload, created } = fixture();
  const run = await service.run(context, payload), ids = run.results.filter(r => r.status !== 'matched').map(r => r.id);
  await service.createIssues(context, request(run, ids, true));
  const again = await service.run(context, payload);
  const response = await service.createIssues(context, request(again, ids, true));
  assert.equal(response.reused.length, 1); assert.equal(created.length, 1);
});

test('description handles old two-table records, truncated diffs and long groups', () => {
  const record = { id: 'r9', files: ['a.csv', 'b.csv'], templateName: '' };
  const old = { id: '0', key: '4', label: '4', status: 'mismatch', counts: { a: 1, b: 1 }, diffs: JSON.stringify([{ field: 'amount', a: 10, b: 12 }, { field: 'memo', a: 'x', b: undefined }]) };
  const t = adfText(issueDescription({ record, rows: [old], grouped: false }));
  assert.match(t, /Template: \(unsaved\)/);
  assert.match(t, /amount: 10\.00 → 12\.00/); assert.match(t, /memo: x → \(empty\)/); assert.match(t, /Rows: A 1 · B 1/);
  const cut = adfText(issueDescription({ record, rows: [{ ...old, diffs: '[{"field":"amount","a":1' }], grouped: false }));
  assert.match(cut, /too long to show/); assert.ok(!cut.includes('{"'));
  const many = Array.from({ length: 200 }, (_, i) => ({ ...old, id: String(i), diffs: JSON.stringify(Array.from({ length: 5 }, (_, j) => ({ field: `field ${j}`, a: 'x'.repeat(100), b: 'y'.repeat(100) }))) }));
  const big = adfText(issueDescription({ record, rows: many, grouped: true }));
  assert.ok(big.length < 30000); assert.match(big, /more exceptions? not shown/);
  assert.equal(plural(1, 'exception'), '1 exception'); assert.equal(plural(2, 'exception'), '2 exceptions'); assert.equal(plural(0, 'exception'), '0 exceptions');
  assert.equal(categoryText({ status: 'duplicate', counts: [2, 1], diffs: '[]' }), 'duplicate key in A');
});
