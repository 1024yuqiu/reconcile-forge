import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createService } from '../src/service.js';
import { suggestFields, reconcileTables } from '../src/multi.js';
import { DEFAULT_RULES } from '../src/reconcile.js';
const fixture = (persistedOrder = false, existingIssue) => {
  const state = new Map(), created = [], comments = [], pages = [], files = ['100', '105', '100'].map((Amount, i) => ({ name: `${i}.csv`, headers: ['Order ID', 'Amount'], rows: [{ 'Order ID': '1', Amount }] }));
  const context = { accountId: 'reviewer', extension: { issue: { key: 'T-1' } } }; let id = 0;
  const service = createService({ store: { get: async k => state.get(k), set: async (k, v) => state.set(k, persistedOrder ? JSON.parse(JSON.stringify(v, (_, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)) : structuredClone(v)), delete: async k => state.delete(k) },
    uuid: () => String(++id), now: () => '2026-11-10T00:00:00Z', digest: v => createHash('sha256').update(v).digest('hex').slice(0, 32), loadAttachment: async (_, a) => files[Number(a.id)],
    jira: async (op, p) => {
      if (op === 'issue') return { key: p.key, fields: { project: { key: p.key.split('-')[0] } } };
      if (op === 'attachments') return files.map((f, i) => ({ name: f.name, id: String(i) }));
      if (op === 'findException') return existingIssue;
      if (op === 'create') { created.push(p); return { key: `T-${created.length + 1}` }; }
      if (op === 'comment') { comments.push(p); return { id: String(comments.length) }; }
    }, confluence: async (op,p) => { if(op==='page')return {id:p.id,spaceId:'9',_links:{webui:`/spaces/TEST/pages/${p.id}`}};if(op==='createPage'){pages.push(p);return {id:`page-${pages.length}`,spaceId:p.spaceId,_links:{webui:`/spaces/TEST/pages/page-${pages.length}`}};}throw new Error('Unexpected Confluence mutation');} });
  const config = { ...suggestFields(files), baseIndex: 0, keyRules: DEFAULT_RULES, aggregate: [false, false, false], acceptedPairs: [] };
  state.set('templates:project:T', [{ name: 'Monthly', config }]);
  const payload = { sources: files.map((f, i) => ({ id: String(i) })), config, templateName: 'Monthly' };
  return { state, created, comments, pages, files, service, context, payload };
};
for (const grouped of [false, true]) test(`JQL-only reuse enrolls closure links and restores cached tracking (grouped=${grouped})`, async () => {
  const f = fixture(false, 'T-99');
  const run = await f.service.run(f.context, f.payload);
  const request = { runId: run.id, project: 'T', issueType: '10001', selectedIds: ['0'], confirmed: true, grouped };
  assert.deepEqual((await f.service.createIssues(f.context, request)).reused, ['T-99']);
  assert.equal(f.created.length, 0);
  const linkKey = [...f.state.keys()].find(key => key.startsWith('links:'));
  assert.deepEqual(f.state.get(linkKey)[0].keys, [run.results[0].key]);
  f.state.delete(linkKey);
  await f.service.createIssues(f.context, request);
  assert.equal(f.state.get(linkKey)[0].issue, 'T-99');
  f.files[1].rows[0].Amount = '100';
  const balanced = await f.service.run(f.context, f.payload);
  assert.deepEqual(balanced.readyToClose, [{ issue: 'T-99', evidenceRunId: balanced.id }]);
  assert.equal(f.comments.length, 1);
  assert.equal(f.comments[0].key, 'T-99');
  await f.service.run(f.context, f.payload);
  assert.equal(f.comments.length, 1);
});

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
  assert.deepEqual(response, { created: [], reused: ['T-2'], nextOffset: 1, savedExceptions: 1, totalExceptions: 1, selectedExceptions: [{ id: '0', key: '1', text: 'Exception #0 (key 1)' }] });
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

test('resolved exceptions add one evidence comment, repeated balanced runs reuse the receipt without transitions', async () => {
  const f=fixture(), first=await f.service.run(f.context,f.payload);
  await f.service.createIssues(f.context,{runId:first.id,project:'T',issueType:'10001',selectedIds:['0'],confirmed:true,grouped:true});
  f.files[1].rows[0].Amount='100';
  const balanced=await f.service.run(f.context,f.payload);
  assert.equal(f.comments.length,1);assert.match(f.comments[0].text,new RegExp(balanced.id));assert.match(f.comments[0].text,/no status was changed/);
  assert.deepEqual(balanced.readyToClose,[{issue:'T-2',evidenceRunId:balanced.id}]);
  await f.service.run(f.context,f.payload);assert.equal(f.comments.length,1);
  f.files[1].rows[0].Amount='106';assert.equal((await f.service.run(f.context,f.payload)).readyToClose.length,0);
  f.files[1].rows[0].Amount='100';await f.service.run(f.context,f.payload);assert.equal(f.comments.length,2);
});
test('compact Worker claims cannot mark an unresolved source as balanced', async () => {
  const f=fixture(), first=await f.service.run(f.context,f.payload);
  await f.service.createIssues(f.context,{runId:first.id,project:'T',issueType:'10001',selectedIds:['0'],confirmed:true,grouped:true});
  f.files[1].rows[0].Amount='100';const result=reconcileTables(f.files,f.payload.config);f.files[1].rows[0].Amount='105';
  const saved=await f.service.saveRun(f.context,{...f.payload,result:{...result,results:[]}});
  assert.equal(saved.readyToClose.length,0);assert.equal(f.comments.length,0);
});
test('a missing previous key and changed rules do not constitute resolution evidence', async () => {
  const f=fixture(), first=await f.service.run(f.context,f.payload);
  await f.service.createIssues(f.context,{runId:first.id,project:'T',issueType:'10001',selectedIds:['0'],confirmed:true,grouped:true});
  f.files[1].rows[0].Amount='100';const changed=structuredClone(f.payload);changed.config.fields[0].abs='0.02';
  assert.equal((await f.service.run(f.context,changed)).readyToClose.length,0);
  f.files.forEach(file=>file.rows[0]['Order ID']='different-key');
  assert.equal((await f.service.run(f.context,f.payload)).readyToClose.length,0);assert.equal(f.comments.length,0);
});
test('grouped issue receives a resolution comment only when all selected exception keys balance', async () => {
  const f=fixture();f.files.forEach((file,i)=>file.rows.push({'Order ID':'2',Amount:i===1?'207':'200'}));
  const first=await f.service.run(f.context,f.payload);
  await f.service.createIssues(f.context,{runId:first.id,project:'T',issueType:'10001',selectedIds:['0','1'],confirmed:true,grouped:true});
  f.files[1].rows[0].Amount='100';assert.equal((await f.service.run(f.context,f.payload)).readyToClose.length,0);assert.equal(f.comments.length,0);
  f.files[1].rows[1].Amount='200';assert.equal((await f.service.run(f.context,f.payload)).readyToClose.length,1);assert.equal(f.comments.length,1);
});

test('run audit records actor, content-version, annotation, review and explicit issue confirmation',async()=>{
  const f=fixture(true),first=await f.service.run(f.context,{...f.payload,note:'Synthetic annotation'});
  await f.service.reviewException(f.context,{runId:first.id,id:'0',status:'Explained',note:'Synthetic review'});
  await f.service.createIssues(f.context,{runId:first.id,project:'T',issueType:'10001',selectedIds:['0'],confirmed:true,grouped:true});
  const audit=await f.service.auditRun(f.context,{runId:first.id});
  assert.equal(audit.who,'reviewer');assert.equal(audit.note,'Synthetic annotation');assert.ok(audit.templateVersion);
  assert.deepEqual(audit.events.map(e=>e.event),['run','review','issue-confirmation','issue-result']);
  assert.equal(audit.events[2].confirmed,true);assert.equal(audit.events[2].grouped,true);
  const next=await f.service.run(f.context,await reload(f));assert.equal(next.auditSummary.templateVersion,first.auditSummary.templateVersion);
  const changed=structuredClone(f.payload);changed.config.fields[0].abs='0.02';assert.notEqual((await f.service.run(f.context,changed)).auditSummary.templateVersion,first.auditSummary.templateVersion);
  await assert.rejects(f.service.run(f.context,{...f.payload,note:'x'.repeat(501)}),/annotation/);
});
test('Confluence report creates one new page with escaped evidence and serial retries reuse without editing',async()=>{
  const f=fixture(),run=await f.service.run(f.context,{...f.payload,note:'<script>synthetic</script>'});
  const request={runId:run.id,pageId:'42'};
  const report=await f.service.createReport(f.context,request);
  assert.equal(report.reused,false);assert.equal(report.url,'/wiki/spaces/TEST/pages/page-1');
  assert.equal((await f.service.createReport(f.context,request)).reused,true);
  assert.equal(f.pages.length,1);assert.equal(f.pages[0].spaceId,'9');
  assert.match(f.pages[0].body.value,/&lt;script&gt;/);assert.ok(!f.pages[0].body.value.includes('<script>'));
  assert.ok(f.pages[0].body.value.includes(run.id));assert.match(f.pages[0].body.value,/Actor accountId: reviewer/);
  assert.equal((await f.service.auditRun(f.context,request)).events.at(-1).event,'report-created');
});
test('audit/report reads are source-authorized and report target must be an existing page ID',async()=>{
  const f=fixture(),run=await f.service.run(f.context,f.payload),other={...f.context,extension:{issue:{key:'T-2'}}};
  await assert.rejects(f.service.auditRun(other,{runId:run.id}),/not found/);
  await assert.rejects(f.service.createReport(other,{runId:run.id,pageId:'42'}),/not found/);
  await assert.rejects(f.service.createReport(f.context,{runId:run.id,pageId:'not-a-page'}),/page ID/);assert.equal(f.pages.length,0);
});
test('per-run audit retains at most 100 events while preserving actor and template version',async()=>{
  const f=fixture(),run=await f.service.run(f.context,f.payload);
  for(let i=0;i<51;i++)await f.service.createIssues(f.context,{runId:run.id,project:'T',issueType:'10001',selectedIds:['0'],confirmed:true,grouped:true});
  const audit=await f.service.auditRun(f.context,{runId:run.id});assert.equal(audit.events.length,100);assert.equal(audit.who,'reviewer');assert.equal(audit.templateVersion,run.auditSummary.templateVersion);assert.equal(f.created.length,1);
});

test('post-run annotation is authorized, audited and leaves comparison/issue identities unchanged', async () => {
  const f = fixture(true), run = await f.service.run(f.context, f.payload);
  const before = structuredClone(f.state.get(`run:${run.id}`));
  const request = { runId: run.id, project: 'T', issueType: '10001', selectedIds: ['0'], confirmed: true, grouped: true };
  await f.service.createIssues(f.context, request);
  await f.service.annotateRun(f.context, { runId: run.id, note: 'Added after completion' });
  const after = f.state.get(`run:${run.id}`);
  assert.equal(after.note, 'Added after completion');
  assert.equal(after.templateVersion, before.templateVersion);
  assert.deepEqual(after.exceptions, before.exceptions);
  assert.equal(after.audit.at(-1).event, 'annotation');
  assert.equal(after.audit.at(-1).who, 'reviewer');
  assert.deepEqual((await f.service.createIssues(f.context, request)).reused, ['T-2']);
  await f.service.createReport(f.context, { runId: run.id, pageId: '42' });
  assert.match(f.pages[0].body.value, /Added after completion/);
  await f.service.annotateRun(f.context, { runId: run.id, note: '' });
  assert.equal((await f.service.auditRun(f.context, { runId: run.id })).note, '');
  await assert.rejects(f.service.annotateRun(f.context, { runId: run.id, note: 'x'.repeat(501) }), /annotation/);
  await assert.rejects(f.service.annotateRun({ ...f.context, extension: { issue: { key: 'T-9' } } }, { runId: run.id, note: 'denied' }), /not found/);
});

for (const grouped of [false, true]) for (const count of [1, 3]) test(`audit stores exactly ${count} selected exceptions (grouped=${grouped})`, async () => {
  const f = fixture();
  for (const file of f.files) file.rows = ['1', '2', '3'].map(key => ({ ...file.rows[0], 'Order ID': key }));
  const run = await f.service.run(f.context, f.payload);
  const selectedIds = run.results.filter(r => r.status !== 'matched').slice(-count).map(r => r.id);
  assert.equal(selectedIds.length, count);
  await f.service.createIssues(f.context, { runId: run.id, project: 'T', issueType: '10001', selectedIds, grouped, confirmed: true });
  const event = (await f.service.auditRun(f.context, { runId: run.id })).events.find(e => e.event === 'issue-confirmation');
  assert.deepEqual(event.selectedIds, selectedIds);
  assert.equal(event.selectedIds.length, count);
  assert.equal(f.created.length, grouped ? 1 : count);
});

test('audit and result name each selected exception by sequence number and key; old audit events without keys stay readable', async () => {
  const f = fixture(), run = await f.service.run(f.context, f.payload);
  const row = run.results[0];
  assert.equal(row.id, '0');
  assert.equal(row.label, '1');
  const response = await f.service.createIssues(f.context, { runId: run.id, project: 'T', issueType: '10001', selectedIds: [row.id], grouped: true, confirmed: true });
  assert.deepEqual(response.selectedExceptions, [{ id: '0', key: row.label, text: `Exception #0 (key ${row.label})` }]);
  const event = (await f.service.auditRun(f.context, { runId: run.id })).events.find(e => e.event === 'issue-confirmation');
  assert.deepEqual(event.selectedIds, ['0']);
  assert.deepEqual(event.selected, [{ id: '0', key: row.label }]);
  assert.match(JSON.stringify(event.selected), new RegExp(`"key":"${row.label}"`));
});
test('exception ID is the position in the full result list, so a later exception has a nonzero ID next to its key', async () => {
  const f = fixture();
  for (const file of f.files) file.rows = [{ ...file.rows[0], 'Order ID': 'close-500', Amount: '100' }, { ...file.rows[0], 'Order ID': 'close-501' }];
  f.files[1].rows[0].Amount = '100'; f.files[2].rows[0].Amount = '100';
  const run = await f.service.run(f.context, f.payload);
  const target = run.results.find(r => r.label === 'close-501');
  assert.notEqual(target.status, 'matched');
  assert.equal(target.id, String(run.results.indexOf(target)));
  const response = await f.service.createIssues(f.context, { runId: run.id, project: 'T', issueType: '10001', selectedIds: [target.id], grouped: true, confirmed: true });
  assert.equal(response.selectedExceptions[0].text, `Exception #${target.id} (key close-501)`);
});
