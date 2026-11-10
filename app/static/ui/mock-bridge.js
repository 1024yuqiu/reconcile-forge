import { makeDemo } from '../../src/sample.js';
import { createService } from '../../src/service.js';
import { readBytes } from '../../src/files.js';
const phase4 = new URLSearchParams(location.search).has('phase4');
const files = phase4 ? await Promise.all([
  ['phase3-ledger.csv', new URL('./mock-data/phase3-ledger.csv', import.meta.url)],
  ['phase3-bank.xlsx', new URL('./mock-data/phase3-bank.xlsx', import.meta.url)]
].map(async ([name, url]) => {
  const response = await fetch(url);
  return readBytes(await response.arrayBuffer(), name);
})) : makeDemo();
const data = JSON.parse(localStorage.getItem('reconcile-preview') || '{}');
const store = { get: async key => data[key], set: async (key, value) => { data[key] = value; localStorage.setItem('reconcile-preview', JSON.stringify(data)); }, delete: async key => { delete data[key]; localStorage.setItem('reconcile-preview', JSON.stringify(data)); } };
const context = { accountId: 'synthetic-reviewer', extension: { issue: { key: 'DEMO-24' } } };
const issues = new Map(); let sequence = 100;
const service = createService({ store, uuid: () => crypto.randomUUID(), now: () => new Date().toISOString(), digest: value => { let hash = 2166136261; for (const c of value) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619); return (hash >>> 0).toString(16); }, jira: async (op, p) => {
  if (op === 'issue') return { key: 'DEMO-24', fields: { project: { key: 'DEMO' } } };
  if (op === 'attachments') return files.map((f, i) => ({ id: String(i), name: f.name, size: 18000 }));
  if (op === 'jql') return { name: 'JQL results', headers: ['Issue key', 'Summary', 'Status'], rows: [{ 'Issue key': 'AP-0001', Summary: 'Synthetic item', Status: 'Open' }] };
  if (op === 'findException') return issues.get(p.label);
  if (op === 'create') { const key = `DEMO-${++sequence}`; issues.set(p.fields.labels[1], key); return { key }; }
}, confluence: async () => {}, loadAttachment: async (_, a) => files[Number(a.id)] });
export const view = { getContext: async () => context, theme: { enable: async () => {} } };
export async function invoke(operation, payload) {
  await new Promise(resolve => setTimeout(resolve, 80));
  if (operation === 'loadSource') {
    const f = await service.source(await service.scope(context), payload);
    return { name: f.name, headers: f.headers, sheets: f.sheets || ['JQL'], sheet: f.sheet || 'JQL', rowCount: f.rows.length, headerRow: 1 };
  }
  return service[operation](context, payload);
}
