import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSources, defaultIssueType, exceptionText } from '../src/defaults.js';
const att = (...names) => names.map((name, i) => ({ id: String(100 + i), name }));
const ids = result => result.sources.map(s => s.id);

for (const order of [
  ['ledger.csv', 'bank.xlsx', 'invoices.csv'], ['bank.xlsx', 'invoices.csv', 'ledger.csv'], ['invoices.csv', 'ledger.csv', 'bank.xlsx'],
  ['invoices.csv', 'bank.xlsx', 'ledger.csv'], ['bank.xlsx', 'ledger.csv', 'invoices.csv'], ['ledger.csv', 'invoices.csv', 'bank.xlsx']
]) test(`three-table sample is selected as A ledger, B bank, C invoices regardless of attachment order (${order.join(', ')})`, () => {
  const list = att(...order), picked = chooseSources(list);
  assert.deepEqual(picked.sources.map(s => list.find(a => a.id === s.id).name), ['ledger.csv', 'bank.xlsx', 'invoices.csv']);
});
test('the reported KAN-7 order (bank, invoices, ledger) no longer drops the ledger', () => {
  const list = att('bank.xlsx', 'invoices.csv', 'ledger.csv'), picked = chooseSources(list);
  assert.equal(picked.sources.length, 3);
  assert.equal(picked.sources[0].id, list[2].id);
  assert.equal(picked.reason, 'roles');
});
test('ambiguous attachment sets are not auto-selected', () => {
  for (const names of [
    ['ledger.csv', 'bank.xlsx', 'invoices.csv', 'notes.csv'],
    ['ledger.csv', 'ledger-v2.csv', 'bank.xlsx'],
    ['a.csv', 'b.csv', 'c.csv'],
    ['ledger.csv', 'bank.xlsx', 'misc.csv'],
    ['bank_invoice.csv', 'ledger.csv', 'invoices.csv'],
    ['ledger.csv', 'bank.xlsx', 'invoices.csv', 'a.csv', 'b.csv', 'c.csv']
  ]) assert.deepEqual(chooseSources(att(...names)), { sources: [], reason: 'ambiguous' }, names.join(', '));
});
test('two attachments are both selected; recognized roles put the ledger first, unknown names keep listed order', () => {
  const known = att('bank.xlsx', 'ledger.csv');
  assert.deepEqual(ids(chooseSources(known)), [known[1].id, known[0].id]);
  const unknown = att('one.csv', 'two.csv');
  assert.deepEqual(ids(chooseSources(unknown)), [unknown[0].id, unknown[1].id]);
  const same = att('ledger-a.csv', 'ledger-b.csv');
  assert.deepEqual(ids(chooseSources(same)), [same[0].id, same[1].id]);
});
test('fewer than two attachments select nothing', () => {
  assert.deepEqual(chooseSources(att('ledger.csv')).sources, []);
  assert.deepEqual(chooseSources([]).sources, []);
  assert.deepEqual(chooseSources(undefined).sources, []);
});

test('Task is the default issue type; without Task the default stays empty', () => {
  assert.equal(defaultIssueType([{ id: '10001', name: 'Epic' }, { id: '10003', name: 'Task' }, { id: '10004', name: 'Bug' }]), '10003');
  assert.equal(defaultIssueType([{ id: 10003, name: ' task ' }]), '10003');
  assert.equal(defaultIssueType([{ id: '10001', name: 'Story' }, { id: '10004', name: 'Subtask' }]), '');
  assert.equal(defaultIssueType([]), '');
  assert.equal(defaultIssueType(undefined), '');
});

test('exception text names the sequence number and the key', () => {
  assert.equal(exceptionText({ id: '0', label: 'close-501' }), 'Exception #0 (key close-501)');
});
