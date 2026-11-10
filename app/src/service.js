import { reconcile } from './reconcile.js';
import { reconcileTables, exceptionSignature, stableStringify } from './multi.js';
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
    return loadAttachment(s, attachment, input.sheet, input.rawBytes);
  }
  async function savedRun(context, id) {
    const s = await scope(context);
    const run = await store.get(`run:${id}`);
    if (!run || run.source.kind !== s.kind || run.source.id !== s.id) throw new Error('Run not found on this issue or page.');
    return run;
  }
  async function run(context, payload) {
    const s = await scope(context);
    if (!Array.isArray(payload.sources) || payload.sources.length < 2 || payload.sources.length > 5) throw new Error('Select 2–5 sources.');
    const files = await Promise.all(payload.sources.map(input => source(s, input)));
    const result = payload.config ? reconcileTables(files, payload.config) : reconcile(files[0], files[1], payload.mappings, payload.rules);
    return persist(s, payload, result, files);
  }
  async function persist(s, payload, result, files) {
    const templateName = payload.templateName || '';
    if (templateName.length > 80) throw new Error('Template name must be at most 80 characters.');
    const reviewNamespace = `reviews:${s.namespace}:${digest(templateName)}`;
    const reviews = templateName ? await store.get(reviewNamespace) || [] : [];
    if (result.version === 3) result.results = result.results.map(r => { const signature = digest(stableStringify([payload.config, exceptionSignature(r)])); return { ...r, signature, review: reviews.find(v => v.signature === signature) || null }; });
    const exceptions = result.results.filter(r => r.status !== 'matched');
    const record = { id: uuid(), when: now(), who: s.accountId, source: s, files: files.map(f => f.name), sources: payload.sources, rules: payload.rules || payload.config, mappings: payload.mappings || payload.config.keys, config: payload.config, templateName, reviewNamespace, summary: result.summary, inputRows: result.inputRows, exceptions: exceptions.slice(0, MAX_SAVED_EXCEPTIONS).map(r => ({ id: r.id, key: r.key, label: r.label.slice(0, 200), status: r.status, diffs: JSON.stringify(r.diffs).slice(0, 2000), counts: r.counts, ...(r.signature ? { signature: r.signature, review: r.review, pass: r.pass } : {}) })), exceptionCount: result.version === 3 ? Object.entries(result.summary).filter(([s]) => s !== 'matched').reduce((n, [, v]) => n + v, 0) : exceptions.length };
    if (new TextEncoder().encode(JSON.stringify(record)).byteLength > 180000) throw new Error('Run metadata is too large to save. Reduce mapped fields or split the source.');
    // Full rows remain transient. History contains counts and at most 200 compact exceptions.
    await store.set(`run:${record.id}`, record);
    const historyKey = `history:${s.kind}:${s.id}`;
    const history = await store.get(historyKey) || [];
    await store.set(historyKey, [{ id: record.id, when: record.when, who: record.who, files: record.files, summary: record.summary }, ...history].slice(0, 20));
    for (const old of history.slice(19)) await store.delete(`run:${old.id}`);
    return { ...result, id: record.id, files: files.map(f => ({ name: f.name, headers: f.headers, sheet: f.sheet })), savedExceptions: record.exceptions.length };
  }
  async function saveRun(context, payload) {
    const s = await scope(context);
    if (!Array.isArray(payload.sources) || payload.sources.length < 2 || payload.sources.length > 5) throw new Error('Select 2–5 sources.');
    const list = await attachments(s);
    if (payload.sources.some(p => p.kind === 'jql' ? false : !list.some(a => a.id === String(p.id)))) throw new Error('Attachment is not on this issue or page.');
    const result = payload.result;
    if (result?.version !== 3 || !Array.isArray(result.results) || result.results.length > 200 || JSON.stringify(payload).length > 2500000) throw new Error('Result metadata is too large. Split the exports.');
    if (!Array.isArray(result.inputRows) || result.inputRows.length !== payload.sources.length || result.inputRows.some(n => !Number.isInteger(n) || n < 1 || n > 50000) || !result.summary || ['matched', 'mismatch', 'only-a', 'only-b', 'duplicate'].some(s => !Number.isInteger(result.summary[s]) || result.summary[s] < 0)) throw new Error('Invalid worker summary. Reload the sources and rerun.');
    if (result.results.some(r => typeof r.id !== 'string' || typeof r.key !== 'string' || typeof r.label !== 'string' || !Array.isArray(r.entries) || r.entries.length !== payload.sources.length || !Array.isArray(r.diffs) || !Array.isArray(r.counts))) throw new Error('Invalid worker exception evidence.');
    // Client results are explicitly user-supplied evidence; persist only the compact exception subset.
    const saved = await persist(s, payload, result, payload.sources.map(p => ({ name: list.find(a => a.id === String(p.id))?.name || 'JQL' })));
    return { id: saved.id, savedExceptions: saved.savedExceptions, reviews: saved.results.filter(r => r.status !== 'matched').slice(0, MAX_SAVED_EXCEPTIONS).map(r => ({ id: r.id, signature: r.signature, review: r.review })) };
  }
  async function reviewException(context, payload) {
    const record = await savedRun(context, payload.runId);
    const templates = await store.get(`templates:${record.source.namespace}`) || [];
    if (!templates.some(t => t.name === record.templateName)) throw new Error('Save and run a named template before remembering exceptions.');
    const row = record.exceptions.find(r => r.id === payload.id);
    if (!row?.signature || !['Explained', 'Ignored'].includes(payload.status) || typeof payload.note !== 'string' || payload.note.length > 500) throw new Error('Select a saved exception, review status and a note up to 500 characters.');
    const review = { signature: row.signature, status: payload.status, note: payload.note, who: context.accountId, when: now() };
    const reviews = await store.get(record.reviewNamespace) || [];
    const next = [...reviews.filter(r => r.signature !== row.signature), review].slice(-200);
    while (new TextEncoder().encode(JSON.stringify(next)).byteLength > 170000) next.shift();
    row.review = review;
    if (new TextEncoder().encode(JSON.stringify(record)).byteLength > 180000) throw new Error('Saved-run notes exceed the storage budget. Split the source and rerun.');
    await store.set(record.reviewNamespace, next);
    await store.set(`run:${record.id}`, record);
    return review;
  }
  async function createIssues(context, payload) {
    const record = await savedRun(context, payload.runId);
    if (record.config && payload.selectedIds === undefined) throw new Error('Select specific exceptions and confirm before creating issues.');
    if (!/^[A-Z][A-Z0-9_]*$/.test(payload.project) || !/^\d+$/.test(payload.issueType)) throw new Error('Select a valid project key and issue type ID.');
    const offset = Number(payload.offset || 0);
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid exception offset.');
    let selected = record.exceptions.slice(offset, offset + 20);
    if (payload.selectedIds !== undefined) {
      if (!Array.isArray(payload.selectedIds) || !payload.selectedIds.length || payload.selectedIds.length > 20 || new Set(payload.selectedIds).size !== payload.selectedIds.length) throw new Error('Select 1–20 distinct saved exceptions.');
      selected = payload.selectedIds.map(id => record.exceptions.find(r => r.id === id));
      if (selected.some(r => !r)) throw new Error('Selected exception is not in this run.');
      if (payload.confirmed !== true) throw new Error('Explicit confirmation is required for selected exceptions.');
    }
    const rows = payload.grouped ? [{ key: 'grouped', label: `${payload.selectedIds ? selected.length : record.exceptionCount} exceptions`, status: 'grouped', diffs: stableStringify((payload.selectedIds ? selected : record.exceptions).map(({ review, ...row }) => row)).slice(0, 12000) }] : selected;
    const created = [], reused = [];
    for (const row of rows) {
      // Stable across reruns, scoped to source, target, rule set and exception content.
      const { review, ...evidence } = row;
      const hash = digest(stableStringify([record.source.kind, record.source.id, payload.project, payload.issueType, payload.parent || '', record.rules, record.mappings, evidence]));
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
    scope, source, run, saveRun, savedRun, createIssues, reviewException,
    async bootstrap(context) {
      const s = await scope(context);
      return { scope: s, attachments: await attachments(s), templates: await store.get(`templates:${s.namespace}`) || [], history: await store.get(`history:${s.kind}:${s.id}`) || [] };
    },
    async saveTemplate(context, payload) {
      const s = await scope(context);
      if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 80 || JSON.stringify(payload).length > 16000) throw new Error('Use a template name of 1–80 characters and a small rule set.');
      const templates = await store.get(`templates:${s.namespace}`) || [];
      const next = [...templates.filter(t => t.name !== payload.name), { name: payload.name, rules: payload.rules, mappings: payload.mappings, config: payload.config, sources: payload.sources }].slice(-20);
      if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 180000) throw new Error('Template collection is full. Use fewer mapped fields or replace an existing template.');
      await store.set(`templates:${s.namespace}`, next);
      for (const old of templates.filter(t => !next.some(n => n.name === t.name))) await store.delete(`reviews:${s.namespace}:${digest(old.name)}`);
      return next;
    }
  };
}
