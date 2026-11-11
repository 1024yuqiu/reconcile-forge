import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createService } from '../src/service.js';
import { suggestFields } from '../src/multi.js';
import { DEFAULT_RULES } from '../src/reconcile.js';
import { adfText, issueDescription, UNSAVED_TEMPLATE } from '../src/describe.js';
import { recordedTemplateName, sessionRecord, restoreSession, planStart, shouldAutoRun, RESTORED_RESULT_NOTICE } from '../src/defaults.js';
import { reconcileTables } from '../src/multi.js';

// 4.1.6 item 1: the template name box defaults to "Monthly AP vs bank"; only a saved or loaded template is recorded.
const DEFAULT_BOX = 'Monthly AP vs bank';
const fixture = () => {
  const state = new Map(), created = [], pages = [];
  const files = ['100', '105', '100'].map((Amount, i) => ({ name: `${i}.csv`, headers: ['Order ID', 'Amount'], rows: [{ 'Order ID': '1', Amount }] }));
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
    },
    confluence: async (op, p) => {
      if (op === 'page') return { id: p.id, spaceId: '9', _links: { webui: `/spaces/TEST/pages/${p.id}` } };
      if (op === 'createPage') { pages.push(p); return { id: `page-${pages.length}`, spaceId: p.spaceId, _links: { webui: `/spaces/TEST/pages/page-${pages.length}` } }; }
      throw new Error('unexpected');
    } });
  const config = { ...suggestFields(files), baseIndex: 0, keyRules: DEFAULT_RULES, aggregate: [false, false, false], acceptedPairs: [] };
  return { service, context, created, pages, payload: { sources: files.map((f, i) => ({ id: String(i) })), config } };
};
const describe = async (templateName, grouped) => {
  const f = fixture(), run = await f.service.run(f.context, { ...f.payload, templateName });
  await f.service.createIssues(f.context, { runId: run.id, project: 'T', issueType: '10001', selectedIds: ['0'], confirmed: true, grouped });
  return { f, run, text: adfText(f.created[0].fields.description) };
};

test('no saved or loaded template: panel sends an empty name, description says (unsaved) and never the default box text', async () => {
  // What the panel sends when the user never saved or loaded a template: the box still holds the default text.
  const sent = recordedTemplateName('');
  assert.equal(sent, '');
  for (const grouped of [true, false]) {
    const { text } = await describe(sent, grouped);
    assert.match(text, /Template: \(unsaved\)/); assert.ok(!text.includes(DEFAULT_BOX), text);
  }
});

test('saved or loaded template: description shows its name', async () => {
  for (const grouped of [true, false]) {
    const { text } = await describe(recordedTemplateName('Q4 close'), grouped);
    assert.match(text, /Template: Q4 close/); assert.ok(!text.includes('(unsaved)'), text);
  }
});

test('Confluence report shows (unsaved) without a template and the name with one', async () => {
  const a = fixture(), runA = await a.service.run(a.context, { ...a.payload, templateName: '' });
  await a.service.createReport(a.context, { runId: runA.id, pageId: '42' });
  assert.match(a.pages[0].body.value, /<p>Template: \(unsaved\) \/ version /); assert.ok(!a.pages[0].body.value.includes(DEFAULT_BOX));
  const b = fixture(), runB = await b.service.run(b.context, { ...b.payload, templateName: 'Q4 close' });
  await b.service.createReport(b.context, { runId: runB.id, pageId: '42' });
  assert.match(b.pages[0].body.value, /<p>Template: Q4 close \/ version /);
});

test('describe helper: empty, missing or whitespace names are unsaved; old records without the field too', () => {
  for (const templateName of ['', undefined, null]) {
    const t = adfText(issueDescription({ record: { id: 'r', files: ['a', 'b'], templateName }, rows: [{ id: '0', key: '1', label: '1', status: 'mismatch', counts: {}, diffs: '[]' }], grouped: false }));
    assert.ok(t.includes(`Template: ${UNSAVED_TEMPLATE}`), t);
  }
  assert.equal(recordedTemplateName('  '), ''); assert.equal(recordedTemplateName(undefined), ''); assert.equal(recordedTemplateName(' Q4 '), 'Q4');
});

test('session record keeps the saved/loaded template name, and defaults to none', () => {
  assert.equal(sessionRecord({ sources: [], config: null, mappingConfirmed: false, attachments: [], namedTemplate: 'Q4 close' }).namedTemplate, 'Q4 close');
  assert.equal(sessionRecord({ sources: [], config: null, mappingConfirmed: false, attachments: [] }).namedTemplate, '');
});

// 4.1.6 item 2: after a refresh the result is recalculated by itself, but only for a confirmed, unchanged, fully restored session.
const att = [['ledger.csv', 0], ['bank.csv', 1], ['invoices.csv', 2]].map(([name, id]) => ({ id: String(id), name }));
const tables = () => ['300', '305', '300'].map((Amount, i) => ({ name: att[i].name, headers: ['Order ID', 'Amount'], rows: [{ 'Order ID': '1', Amount }, { 'Order ID': '2', Amount: '100' }] }));
const base = files => ({ ...suggestFields(files), baseIndex: 0, keyRules: { ...DEFAULT_RULES, leadingZeros: false }, aggregate: files.map(() => false), acceptedPairs: [] });
const stored = (config, mappingConfirmed, attachments = att) => JSON.parse(JSON.stringify(sessionRecord({ sources: att.map(a => ({ id: a.id })), config, mappingConfirmed, attachments })));
const decide = (previous, files, attachments = att) => {
  const plan = planStart(attachments, previous), back = restoreSession(previous, files, base(files));
  return { plan, back, auto: shouldAutoRun(plan, back, files) };
};

test('auto-run: confirmed mapping + unchanged attachments -> run, and counts equal those before the refresh', () => {
  const files = tables(), config = { ...base(files), keyRules: { ...DEFAULT_RULES, leadingZeros: true }, aggregate: [false, false, true] };
  const before = reconcileTables(files, config).summary;
  const { plan, back, auto } = decide(stored(config, true), files);
  assert.equal(plan.mode, 'session'); assert.equal(auto, true);
  assert.deepEqual(reconcileTables(files, back.config).summary, before);
});
test('auto-run: unconfirmed mapping, older session, changed attachments, other sessions and missing data do not auto-run', () => {
  const files = tables(), config = base(files);
  assert.equal(decide(stored(config, false), files).auto, false); // not confirmed
  const old = stored(config, true); delete old.options; delete old.mappingConfirmed;
  assert.equal(decide(old, files).auto, false); // 4.1.4 shape: checkboxes reset, never confirmed
  const added = [...att, { id: '9', name: 'extra.csv' }];
  const changed = decide(stored(config, true), files, added);
  assert.equal(changed.plan.mode === 'session', false); assert.equal(changed.auto, false); // attachments changed
  assert.equal(decide(null, files).auto, false); // no saved session
  const noRows = files.map((f, i) => i === 1 ? { ...f, rows: [] } : f);
  assert.equal(decide(stored(config, true), noRows).auto, false); // a table has no data rows
  const renamed = files.map(f => ({ ...f, headers: f.headers.map(h => h + 'x') }));
  assert.equal(decide(stored(config, true), renamed).auto, false); // saved mapping no longer fits
  assert.equal(shouldAutoRun(undefined, undefined, files), false);
});
test('auto-run notice tells the user the result was not saved and how to save a run', () => {
  assert.match(RESTORED_RESULT_NOTICE, /No new run was saved/); assert.match(RESTORED_RESULT_NOTICE, /Click Run reconciliation/);
});
