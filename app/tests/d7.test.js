import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTACHMENTS_CHANGED, attachmentSnapshot, auditSelectionText, blankSources, confirmCreateText, exceptionListText, issueResultText, issueTypeText, planStart } from '../src/defaults.js';
const three = [{ id: '10', name: 'bank.xlsx' }, { id: '11', name: 'invoices.csv' }, { id: '12', name: 'ledger.csv' }];
const saved = (attachments, sources) => ({ sources, config: null, attachments: attachmentSnapshot(attachments) });
const ids = plan => plan.sources.map(s => s.id);

// 1. Saved session versus current attachments.
test('unchanged attachments restore the saved session as before', () => {
  const sources = [{ id: '12' }, { id: '10' }];
  const plan = planStart(three, saved([...three].reverse(), sources));
  assert.equal(plan.mode, 'session'); assert.equal(plan.changed, false); assert.deepEqual(plan.sources, sources);
});
for (const [label, current] of [
  ['an attachment added', [...three, { id: '13', name: 'ledger-v2.csv' }]],
  ['an attachment removed', three.slice(0, 2)],
  ['an attachment replaced (new id, same name)', [three[0], three[1], { id: '99', name: 'ledger.csv' }]],
  ['an attachment renamed (same id)', [three[0], three[1], { id: '12', name: 'general-ledger.csv' }]]
]) test(`${label}: the old sources are not applied silently, attachments are re-checked`, () => {
  const old = saved(three, [{ id: '10' }, { id: '11' }, { id: '12' }]);
  const plan = planStart(current, old);
  assert.equal(plan.changed, true); assert.notEqual(plan.mode, 'session');
  if (plan.mode === 'attachments') assert.ok(plan.sources.every(s => current.some(a => a.id === s.id)));
});
test('changed attachments that can be recognized are re-selected as A ledger, B bank, C invoices', () => {
  const current = [{ id: '20', name: 'invoices.csv' }, { id: '21', name: 'ledger.csv' }, { id: '22', name: 'bank.xlsx' }];
  const plan = planStart(current, saved(three, [{ id: '10' }, { id: '11' }, { id: '12' }]));
  assert.equal(plan.mode, 'attachments'); assert.equal(plan.changed, true); assert.deepEqual(ids(plan), ['21', '22', '20']);
});
test('changed attachments that cannot be told apart show the manual choice with three cards', () => {
  const current = [{ id: '1', name: 'a.csv' }, { id: '2', name: 'b.csv' }, { id: '3', name: 'c.csv' }, { id: '4', name: 'd.csv' }];
  const plan = planStart(current, saved(three, [{ id: '10' }, { id: '11' }]));
  assert.equal(plan.mode, 'manual'); assert.equal(plan.changed, true); assert.deepEqual(plan.sources, [{ id: '' }, { id: '' }, { id: '' }]);
});
test('a saved session without an attachment snapshot cannot be verified and is re-checked', () => {
  const plan = planStart(three, { sources: [{ id: '10' }, { id: '11' }] });
  assert.equal(plan.changed, true); assert.equal(plan.mode, 'attachments');
});
test('a first open and Reset (no saved session) never report changed attachments', () => {
  assert.equal(planStart(three, null).changed, false);
  assert.equal(planStart([], null).changed, false);
  assert.match(ATTACHMENTS_CHANGED, /^Attachments changed since your last session, so sources were re-checked\.$/);
});
test('a saved JQL source survives when attachments are unchanged', () => {
  const sources = [{ id: '12' }, { kind: 'jql', jql: 'project = A' }];
  assert.equal(planStart(three, saved(three, sources)).mode, 'session');
});

// 3. Reset is the same as a first open.
test('Reset (planStart with no session) restores A / B / C for three recognizable attachments in any order', () => {
  const plan = planStart(three, null);
  assert.equal(plan.mode, 'attachments'); assert.deepEqual(ids(plan), ['12', '10', '11']);
});
test('Reset keeps three selectable cards when three attachments cannot be recognized', () => {
  const plan = planStart([{ id: '1', name: 'data0.csv' }, { id: '2', name: 'data1.csv' }, { id: '3', name: 'data2.csv' }], null);
  assert.equal(plan.mode, 'manual'); assert.equal(plan.sources.length, 3);
  assert.equal(blankSources([{}, {}, {}, {}, {}]).length, 3);
});
test('fewer than two attachments leave two empty cards and no manual hint', () => {
  for (const list of [[], [{ id: '1', name: 'only.csv' }]]) { const plan = planStart(list, null); assert.equal(plan.mode, 'none'); assert.equal(plan.sources.length, 2); }
});

// 2. Creation confirmation wording.
const types = [{ id: '10001', name: 'Story' }, { id: '10003', name: 'Task' }];
const ex = (id, label) => ({ id, label });
test('single grouped exception uses the exact confirmation sentence', () => {
  assert.equal(confirmCreateText({ items: [ex(2, '3')], grouped: true, project: 'KAN', types, issueType: '10003', parent: '' }), 'Create one grouped issue for Exception #2 (key 3) in KAN, type Task (10003)?');
});
test('several exceptions are listed with #id (key) and long lists are shortened', () => {
  assert.equal(exceptionListText([ex(0, 'a'), ex(2, 'b')]), '2 exceptions: #0 (key a), #2 (key b)');
  assert.equal(exceptionListText([ex(0, 'a'), ex(1, 'b'), ex(2, 'c'), ex(3, 'd')]), '4 exceptions: #0 (key a), #1 (key b), #2 (key c) …');
  assert.equal(confirmCreateText({ items: [ex(0, 'a'), ex(2, 'b')], grouped: true, project: 'KAN', types, issueType: '10003' }), 'Create one grouped issue for 2 exceptions: #0 (key a), #2 (key b) in KAN, type Task (10003)?');
});
test('ungrouped creation, parent and unknown type names', () => {
  assert.equal(confirmCreateText({ items: [ex(0, 'a'), ex(1, 'b')], grouped: false, project: 'KAN', types, issueType: '10001', parent: 'KAN-1' }), 'Create 2 separate issues for 2 exceptions: #0 (key a), #1 (key b) in KAN, type Story (10001), parent KAN-1?');
  assert.equal(confirmCreateText({ items: [ex(0, 'a')], grouped: false, project: 'KAN', types: [], issueType: '10009' }), 'Create one issue for Exception #0 (key a) in KAN, type 10009?');
  assert.equal(issueTypeText(types, 10003), 'Task (10003)');
});

// 5. Result wording, same as the Rovo action.
test('creation results read Created Issue / Reused Issue and never "Created: none"', () => {
  assert.equal(issueResultText(['KAN-5'], []), 'Created Issue: KAN-5');
  assert.equal(issueResultText([], ['KAN-5']), 'Reused Issue: KAN-5');
  assert.equal(issueResultText(['KAN-5'], ['KAN-4'], ' · '), 'Created Issue: KAN-5 · Reused Issue: KAN-4');
  assert.doesNotMatch(issueResultText([], []), /Created:|Reused:/);
});

// 8. Old audit records.
test('an audit record with only selectedIds renders "Exception IDs: #0"', () => {
  const old = { event: 'issue-confirmation', selectedIds: [0], confirmed: true, grouped: true, project: 'KAN', issueType: '10003', created: ['KAN-9'], reused: [] };
  assert.equal(auditSelectionText(old), 'Selected exceptions: 1 · Exception IDs: #0 · Confirmed: true · Grouped: true · Project: KAN · Type: 10003');
  assert.match(auditSelectionText({ ...old, selectedIds: [0, 3] }), /Exception IDs: #0, #3/);
  assert.match(auditSelectionText({ ...old, selected: [{ id: 0, key: 'close-501' }] }), /Exception #0 \(key close-501\)/);
});
