import { reconcile } from './reconcile.js';
export const MAX_SAVED_EXCEPTIONS = 200;

export function createService({ store, jira, confluence, loadAttachment, uuid, digest, now }) {
  async function scope(context) {
    if (context.extension?.issue?.key) {
      const issue = await jira('issue', { key: context.extension.issue.key });
      return { kind: 'jira', id: issue.key, namespace: `project:${issue.fields.project.key}`, accountId: context.accountId };
    }
    if (context.extension?.content?.id) {
      const page = await confluence('page', { id: context.extension.content.id });
      return { kind: 'confluence', id: page.id, namespace: `space:${page.spaceId}`, accountId: context.accountId };
    }
    throw new Error('Open Reconcile on a Jira issue or a saved Confluence page.');
  }
  async function attachments(s) { return s.kind === 'jira' ? jira('attachments', { key: s.id }) : confluence('attachments', { id: s.id }); }
  async function source(s, input) {
    if (input.kind === 'jql') {
      if (typeof input.jql !== 'string' || !input.jql.trim() || input.jql.length > 2000) throw new Error('Enter a JQL query up to 2,000 characters.');
      return jira('jql', input);
    }
    const list = await attachments(s);
    const attachment = list.find(a => a.id === String(input.id));
    if (!attachment) throw new Error('Attachment is not on this issue or page. Refresh and select again.');
    return loadAttachment(s, attachment, input.sheet);
  }
  async function savedRun(context, id) {
    const s = await scope(context);
    const run = await store.get(`run:${id}`);
    if (!run || run.source.kind !== s.kind || run.source.id !== s.id) throw new Error('Run not found on this issue or page.');
    return run;
  }
  async function run(context, payload) {
    const s = await scope(context);
    const a = await source(s, payload.sources[0]), b = await source(s, payload.sources[1]);
    const result = reconcile(a, b, payload.mappings, payload.rules);
    const exceptions = result.results.filter(r => r.status !== 'matched');
    const record = { id: uuid(), when: now(), who: s.accountId, source: s, files: [a.name, b.name], sources: payload.sources, rules: payload.rules, mappings: payload.mappings, summary: result.summary, inputRows: result.inputRows, exceptions: exceptions.slice(0, MAX_SAVED_EXCEPTIONS).map(r => ({ key: r.key, label: r.label.slice(0, 200), status: r.status, diffs: JSON.stringify(r.diffs).slice(0, 2000), counts: r.counts })), exceptionCount: exceptions.length };
    if (new TextEncoder().encode(JSON.stringify(record)).byteLength > 180000) throw new Error('Run metadata is too large to save. Reduce mapped fields or split the source.');
    // Full rows remain transient. History contains counts and at most 200 compact exceptions.
    await store.set(`run:${record.id}`, record);
    const historyKey = `history:${s.kind}:${s.id}`;
    const history = await store.get(historyKey) || [];
    await store.set(historyKey, [{ id: record.id, when: record.when, who: record.who, files: record.files, summary: record.summary }, ...history].slice(0, 20));
    for (const old of history.slice(19)) await store.delete(`run:${old.id}`);
    return { ...result, id: record.id, files: [a, b].map(f => ({ name: f.name, headers: f.headers, sheet: f.sheet })), savedExceptions: record.exceptions.length };
  }
  async function createIssues(context, payload) {
    const record = await savedRun(context, payload.runId);
    if (!/^[A-Z][A-Z0-9_]*$/.test(payload.project) || !/^\d+$/.test(payload.issueType)) throw new Error('Select a valid project key and issue type ID.');
    const offset = Number(payload.offset || 0);
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid exception offset.');
    const rows = payload.grouped ? [{ key: 'grouped', label: `${record.exceptionCount} exceptions`, status: 'grouped', diffs: JSON.stringify(record.exceptions).slice(0, 12000) }] : record.exceptions.slice(offset, offset + 20);
    const created = [], reused = [];
    for (const row of rows) {
      // Stable across reruns, scoped to source, target, rule set and exception content.
      const hash = digest(JSON.stringify([record.source.kind, record.source.id, payload.project, payload.issueType, payload.parent || '', record.rules, record.mappings, row]));
      const label = `reconcile-${hash}`;
      const cached = await store.get(`dedupe:${hash}`);
      if (cached) { await jira('issue', { key: cached.issue }); reused.push(cached.issue); continue; }
      const existing = await jira('findException', { label, project: payload.project });
      if (existing) { reused.push(existing); continue; }
      const fields = { project: { key: payload.project }, issuetype: { id: payload.issueType }, summary: `Reconcile: ${row.status} — ${row.label}`.slice(0, 250), labels: ['reconcile', label], description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: `Run ${record.id}\nSources: ${record.files.join(' / ')}\nKey: ${row.label}\nStatus: ${row.status}\nDifferences: ${row.diffs || 'Review missing or duplicate source rows.'}` }] }] } };
      if (payload.parent) { if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(payload.parent)) throw new Error('Invalid parent issue key.'); fields.parent = { key: payload.parent }; }
      const issue = await jira('create', { fields });
      await store.set(`dedupe:${hash}`, { issue: issue.key, runId: record.id });
      created.push(issue.key);
    }
    return { created, reused, nextOffset: payload.grouped ? record.exceptions.length : offset + rows.length, savedExceptions: record.exceptions.length, totalExceptions: record.exceptionCount };
  }
  return {
    scope, source, run, savedRun, createIssues,
    async bootstrap(context) {
      const s = await scope(context);
      return { scope: s, attachments: await attachments(s), templates: await store.get(`templates:${s.namespace}`) || [], history: await store.get(`history:${s.kind}:${s.id}`) || [] };
    },
    async saveTemplate(context, payload) {
      const s = await scope(context);
      if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 80 || JSON.stringify(payload).length > 16000) throw new Error('Use a template name of 1–80 characters and a small rule set.');
      const templates = await store.get(`templates:${s.namespace}`) || [];
      const next = [...templates.filter(t => t.name !== payload.name), { name: payload.name, rules: payload.rules, mappings: payload.mappings }].slice(-20);
      await store.set(`templates:${s.namespace}`, next);
      return next;
    }
  };
}
