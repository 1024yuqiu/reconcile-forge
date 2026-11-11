import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createService } from '../src/service.js';
import { suggestFields, reconcileTables, compactResult } from '../src/multi.js';
import { DEFAULT_RULES } from '../src/reconcile.js';
import { adfText, amountsOf, entryCents } from '../src/describe.js';
import { MANUAL_THREE, OPTIONS_RECHECK, manualHint, planStart, restoreSession, sessionRecord, blankSources } from '../src/defaults.js';

// 4.1.5 item 1: the panel saves a compact result (entries cut down); amounts in the issue description must still match the result table.
const fixture = () => {
  const state = new Map(), created = [];
  const files = [
    { name: 'ledger.csv', headers: ['Order ID', 'Amount'], rows: [{ 'Order ID': '1', Amount: '300' }, { 'Order ID': '2', Amount: '100' }] },
    { name: 'bank.xlsx', headers: ['Order ID', 'Amount'], rows: [{ 'Order ID': '1', Amount: '305' }] },
    { name: 'invoices.csv', headers: ['Order ID', 'Amount'], rows: [{ 'Order ID': '1', Amount: '300' }, { 'Order ID': '2', Amount: '100' }] }
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
  return { service, context, files, config, created, sources: files.map((f, i) => ({ id: String(i) })) };
};
// Same steps as the panel: worker result -> compactResult -> JSON over the bridge -> saveRun.
const panelRun = async () => {
  const f = fixture();
  const output = reconcileTables(f.files, f.config);
  const compact = JSON.parse(JSON.stringify(compactResult(output)));
  assert.ok(compact.results.every(r => r.entries.every(e => e === null || e.components)));
  const saved = await f.service.saveRun(f.context, { sources: f.sources, config: f.config, templateName: 'Monthly close', result: compact });
  const ids = compact.results.map(r => r.id);
  return { ...f, saved, ids, output };
};
const req = (saved, selectedIds, grouped) => ({ runId: saved.id, project: 'T', issueType: '10001', selectedIds, confirmed: true, grouped });

test('panel path, grouped issue: amounts show the result-table figures, no "none" placeholder for present sides', async () => {
  const { service, context, saved, ids, created } = await panelRun();
  await service.createIssues(context, req(saved, ids, true));
  const t = adfText(created[0].fields.description);
  assert.match(t, /A 300\.00 · B 305\.00 · C 300\.00/);
  assert.match(t, /A 100\.00 · B none · C 100\.00/);
  assert.equal((t.match(/none/g) || []).length, 1, t);
  assert.ok(!/A none/.test(t) && !/C none/.test(t), t);
});

test('panel path, separate issues: each description has the real amounts', async () => {
  const { service, context, saved, ids, created } = await panelRun();
  await service.createIssues(context, req(saved, ids, false));
  assert.equal(created.length, 2);
  const texts = created.map(c => adfText(c.fields.description));
  const mismatch = texts.find(t => t.includes('(key 1)')), missing = texts.find(t => t.includes('(key 2)'));
  assert.match(mismatch, /A 300\.00 · B 305\.00 · C 300\.00/); assert.ok(!/none/.test(mismatch), mismatch);
  assert.match(missing, /A 100\.00 · B none · C 100\.00/);
});

test('panel path and Rovo path give identical amounts', async () => {
  const panel = await panelRun();
  const rovo = fixture();
  const run = await rovo.service.run(rovo.context, { sources: rovo.sources, config: rovo.config, templateName: 'Monthly close' });
  const fromPanel = panel.output.results.filter(r => r.status !== 'matched').map(r => amountsOf(JSON.parse(JSON.stringify(compactResult({ results: [r] }).results[0])), panel.config));
  const fromRovo = panel.output.results.filter(r => r.status !== 'matched').map(r => amountsOf(r, rovo.config));
  assert.deepEqual(fromPanel, fromRovo);
  assert.ok(run.results.length);
});

test('entryCents: own values, aggregated components, legacy compact entries (components only) and missing side', () => {
  assert.equal(entryCents({ values: { f: 30000 }, components: [{ values: { f: 10000 } }] }, 'f'), 30000);
  assert.equal(entryCents({ components: [{ values: { f: 10000 } }, { values: { f: 5050 } }] }, 'f'), 15050);
  assert.equal(entryCents({ components: [{ values: { f: 30000 } }] }, 'f'), 30000);
  assert.equal(entryCents(null, 'f'), null);
  assert.equal(entryCents({ components: [] }, 'f'), null);
  assert.equal(entryCents({ components: [{ values: {} }] }, 'f'), null);
});

// 4.1.5 item 2: the two checkboxes and the confirmed mapping are stored with the session and restored.
const tables = () => fixture().files;
const freshConfig = files => ({ ...suggestFields(files), baseIndex: 0, keyRules: { ...DEFAULT_RULES, leadingZeros: false }, aggregate: files.map(() => false), acceptedPairs: [] });
const refresh = record => JSON.parse(JSON.stringify(record)); // sessionStorage round trip

test('session: leading zeros, Aggregate C and the confirmed mapping survive a refresh', () => {
  const files = tables(), config = freshConfig(files);
  const edited = { ...config, keyRules: { ...config.keyRules, leadingZeros: true }, aggregate: [false, false, true] };
  const record = refresh(sessionRecord({ sources: [{ id: '0' }, { id: '1' }, { id: '2' }], config: edited, mappingConfirmed: true, attachments: [] }));
  assert.deepEqual(record.options, { leadingZeros: true, aggregate: [false, false, true] }); assert.equal(record.mappingConfirmed, true);
  const back = restoreSession(record, files, freshConfig(files));
  assert.equal(back.config.keyRules.leadingZeros, true); assert.deepEqual(back.config.aggregate, [false, false, true]);
  assert.deepEqual(back.config.keys, edited.keys); assert.deepEqual(back.config.fields, edited.fields);
  assert.equal(back.mappingConfirmed, true); assert.equal(back.optionsReset, false); // Run is available without Confirm
});
test('session: an unconfirmed mapping stays unconfirmed, with the checkboxes kept', () => {
  const files = tables(), config = { ...freshConfig(files), aggregate: [true, false, false] };
  const back = restoreSession(refresh(sessionRecord({ sources: [], config, mappingConfirmed: false, attachments: [] })), files, freshConfig(files));
  assert.equal(back.mappingConfirmed, false); assert.deepEqual(back.config.aggregate, [true, false, false]);
});
test('session: an older record without options uses defaults, is never confirmed, and asks for a re-check', () => {
  const files = tables(), config = { ...freshConfig(files), keyRules: { ...DEFAULT_RULES, leadingZeros: true }, aggregate: [true, true, true] };
  const old = refresh({ sources: [], config, attachments: [] }); // 4.1.4 shape
  const back = restoreSession(old, files, freshConfig(files));
  assert.equal(back.config.keyRules.leadingZeros, false); assert.deepEqual(back.config.aggregate, [false, false, false]);
  assert.equal(back.mappingConfirmed, false); assert.equal(back.optionsReset, true);
  assert.match(OPTIONS_RECHECK, /re-check/);
});
test('session: a saved config that no longer fits the loaded tables is ignored', () => {
  const files = tables(), config = freshConfig(files);
  const record = refresh(sessionRecord({ sources: [], config, mappingConfirmed: true, attachments: [] }));
  assert.equal(restoreSession(record, files.slice(0, 2), freshConfig(files)).config, null);
  const renamed = files.map(f => ({ ...f, headers: f.headers.map(h => h + 'x') }));
  const back = restoreSession(record, renamed, freshConfig(renamed));
  assert.equal(back.config, null); assert.equal(back.mappingConfirmed, false);
  assert.equal(restoreSession(null, files, config).config, null);
  assert.deepEqual(sessionRecord({ sources: [], config: null, mappingConfirmed: true, attachments: [] }).options, null);
});

// 4.1.5 item 3: three unrecognised attachments get the file-name reason; other counts keep the general text.
test('manual hint: three attachments with unknown names -> file-name reason', () => {
  const three = ['data0.csv', 'data1.csv', 'data2.csv'].map((name, id) => ({ id: String(id), name }));
  const plan = planStart(three, null);
  assert.equal(plan.mode, 'manual'); assert.equal(plan.sources.length, 3);
  assert.equal(manualHint(three.length), "File names couldn't be identified as ledger / bank / invoices. Please choose sources A/B/C manually.");
  assert.equal(MANUAL_THREE, manualHint(3));
  assert.ok(!manualHint(3).includes('attachments, so'));
});
test('manual hint: four attachments keep the count text', () => {
  const four = ['a', 'b', 'c', 'd'].map((n, id) => ({ id: String(id), name: n + '.csv' }));
  assert.equal(planStart(four, null).mode, 'manual');
  assert.equal(manualHint(4), 'This issue has 4 attachments, so sources were not auto-selected. Choose A / B / C manually (for the three-table sample: ledger as A), then click Load selected sources.');
  assert.match(manualHint(6), /^This issue has 6 attachments, so sources were not auto-selected\./);
  assert.equal(blankSources(four).length, 3);
});
