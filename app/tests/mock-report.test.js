import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestFields } from '../src/multi.js';
globalThis.location = { search: '' };
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
const { invoke } = await import('../static/ui/mock-bridge.js');

test('local preview lists project issue types and rejects invalid project keys', async () => {
  assert.deepEqual(await invoke('issueTypes', { project: 'DEMO' }), [{ id: '10001', name: 'Task' }]);
  await assert.rejects(invoke('issueTypes', { project: '../invalid' }), /project key/);
});

test('local preview creates and serially reuses a Confluence report with a modern URL', async () => {
  const files = await Promise.all(['0', '1'].map(id => invoke('loadSource', { id })));
  const run = await invoke('run', { sources: [{ id: '0' }, { id: '1' }], config: suggestFields(files) });
  const request = { runId: run.id, pageId: '42' };
  const report = await invoke('createReport', request);
  assert.equal(report.reused, false);
  assert.match(report.url, /^\/wiki\/spaces\/DEMO\/pages\/\d+$/);
  const repeated = await invoke('createReport', request);
  assert.equal(repeated.id, report.id);
  assert.equal(repeated.reused, true);
  assert.equal(repeated.url, report.url);
});
