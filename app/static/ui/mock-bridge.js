import { makeDemo } from '../../src/sample.js';
import { createService } from '../../src/service.js';
import { readBytes } from '../../src/files.js';
const phase4 = new URLSearchParams(location.search).has('phase4');
const v3 = new URLSearchParams(location.search).has('three-tables');
const v3Bytes = v3 ? await Promise.all(['ledger.csv', 'bank.xlsx', 'invoices.csv'].map(async name => ({ name, bytes: await (await fetch(new URL(`./mock-data/v3/${name}`, import.meta.url))).arrayBuffer() }))) : [];
const files = v3 ? await Promise.all(v3Bytes.map(f => readBytes(f.bytes, f.name))) : phase4 ? await Promise.all([
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
  if (op === 'issueTypes') return [{ id: '10001', name: 'Task' }];
  if (op === 'jql') return { name: 'JQL results', headers: ['Issue key', 'Summary', 'Status'], rows: [{ 'Issue key': 'AP-0001', Summary: 'Synthetic item', Status: 'Open' }] };
  if (op === 'findException') return issues.get(p.label);
  if (op === 'create') { const key = `DEMO-${++sequence}`; issues.set(p.fields.labels[1], key); return { key }; }
}, confluence: async (op, p) => {
  if (op === 'page') return { id: p.id, spaceId: '9', _links: { webui: '/spaces/DEMO/pages/' + p.id } };
  if (op === 'createPage') return { id: String(++sequence), spaceId: p.spaceId, _links: { webui: '/wiki/spaces/DEMO/pages/' + sequence } };
  throw new Error('Unsupported local Confluence operation.');
}, loadAttachment: async (_, a, sheet, rawBytes) => {
  if (!v3) return files[Number(a.id)];
  const f = v3Bytes[Number(a.id)];
  return rawBytes ? { name: f.name, bytes64: btoa(String.fromCharCode(...new Uint8Array(f.bytes))) } : readBytes(f.bytes, f.name, sheet);
} });
export const view = { getContext: async () => context, theme: { enable: async () => {} } };
export const router = { open: async () => {} };
export async function invoke(operation, payload) {
  await new Promise(resolve => setTimeout(resolve, 80));
  if (operation === 'loadSource') {
    const f = await service.source(await service.scope(context), { ...payload, rawBytes: true });
    return f;
  }
  return service[operation](context, payload);
}
