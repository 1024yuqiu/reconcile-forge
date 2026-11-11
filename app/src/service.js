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
  const linksKey = record => `links:${record.source.kind}:${record.source.id}:${digest(record.templateName)}`;
  const configIdentity = record => digest(stableStringify([record.rules, record.mappings]));
  async function appendAudit(record, event) {
    record.audit = [...(record.audit || []), { when: now(), ...event }].slice(-100);
    while (record.audit.length > 1 && new TextEncoder().encode(JSON.stringify(record)).byteLength > 180000) record.audit.shift();
    if (new TextEncoder().encode(JSON.stringify(record)).byteLength > 180000) throw new Error('Audit metadata exceeds the saved-run budget. Split the exports.');
    await store.set(`run:${record.id}`, record);
  }
  async function trackIssue(record, reference) {
    const key = linksKey(record), refs = await store.get(key) || [];
    if (refs.some(r => r.issue === reference.issue)) return;
    const next = [...refs, reference].slice(-100);
    while (new TextEncoder().encode(JSON.stringify(next)).byteLength > 170000) next.shift();
    await store.set(key, next);
  }
  async function reconcileLinked(s, record, verified) {
    const refs = await store.get(linksKey(record)) || [], identity = configIdentity(record);
    if (!record.config || !refs.some(r => r.configIdentity === identity)) return { readyToClose: [] };
    // A compact Worker summary cannot establish that a particular key now matches.
    // Re-read authorized attachments and recompute on Forge before posting any comment.
    const current = verified || reconcileTables(await Promise.all(record.sources.map(input => source(s, input))), record.config);
    const matched = new Set(current.results.filter(r => r.status === 'matched').map(r => r.key)), readyToClose = [];
    for (const ref of refs.filter(r => r.configIdentity === identity)) {
      if (!ref.keys.every(key => matched.has(key))) { delete ref.resolvedRunId; continue; }
      if (!ref.resolvedRunId) {
        await jira('comment', { key: ref.issue, text: `Reconcile: previously reported exceptions now balance. Ready for manual closure; no status was changed.\nVerified run: ${record.id}\nWhen: ${record.when}\nSources: ${record.files.join(' / ')}\nMatched keys: ${ref.keys.join(', ')}\nSummary: ${JSON.stringify(current.summary)}` });
        ref.resolvedRunId = record.id;
        // Persist each receipt so a later comment failure cannot replay successful ones.
        await store.set(linksKey(record), refs);
      }
      readyToClose.push({ issue: ref.issue, evidenceRunId: ref.resolvedRunId });
    }
    await store.set(linksKey(record), refs);
    return { readyToClose };
  }
  async function run(context, payload) {
    const s = await scope(context);
    if (!Array.isArray(payload.sources) || payload.sources.length < 2 || payload.sources.length > 5) throw new Error('Select 2–5 sources.');
    const files = await Promise.all(payload.sources.map(input => source(s, input)));
    const result = payload.config ? reconcileTables(files, payload.config) : reconcile(files[0], files[1], payload.mappings, payload.rules);
    return persist(s, payload, result, files, true);
  }
  async function persist(s, payload, result, files, serverVerified = false) {
    const templateName = payload.templateName || '';
    if (templateName.length > 80) throw new Error('Template name must be at most 80 characters.');
    const note = payload.note ?? '';
    if (typeof note !== 'string' || note.length > 500) throw new Error('Run annotation must be at most 500 characters.');
    const reviewNamespace = `reviews:${s.namespace}:${digest(templateName)}`;
    const reviews = templateName ? await store.get(reviewNamespace) || [] : [];
    if (result.version === 3) result.results = result.results.map(r => { const signature = digest(stableStringify([payload.config, exceptionSignature(r)])); return { ...r, signature, review: reviews.find(v => v.signature === signature) || null }; });
    const exceptions = result.results.filter(r => r.status !== 'matched');
    const record = { id: uuid(), when: now(), who: s.accountId, source: s, files: files.map(f => f.name), sources: payload.sources, rules: payload.rules || payload.config, mappings: payload.mappings || payload.config.keys, config: payload.config, templateName, reviewNamespace, summary: result.summary, inputRows: result.inputRows, exceptions: exceptions.slice(0, MAX_SAVED_EXCEPTIONS).map(r => ({ id: r.id, key: r.key, label: r.label.slice(0, 200), status: r.status, diffs: JSON.stringify(r.diffs).slice(0, 2000), counts: r.counts, ...(r.signature ? { signature: r.signature, review: r.review, pass: r.pass } : {}) })), exceptionCount: result.version === 3 ? Object.entries(result.summary).filter(([s]) => s !== 'matched').reduce((n, [, v]) => n + v, 0) : exceptions.length };
    record.templateVersion = digest(stableStringify([record.templateName, record.rules, record.mappings]));
    record.note = note;
    record.audit = [{ event: 'run', when: record.when, who: record.who, templateVersion: record.templateVersion, note }];
    if (new TextEncoder().encode(JSON.stringify(record)).byteLength > 180000) throw new Error('Run metadata is too large to save. Reduce mapped fields or split the source.');
    // Full rows remain transient. History contains counts and at most 200 compact exceptions.
    await store.set(`run:${record.id}`, record);
    const historyKey = `history:${s.kind}:${s.id}`;
    const history = await store.get(historyKey) || [];
    await store.set(historyKey, [{ id: record.id, when: record.when, who: record.who, templateVersion: record.templateVersion, files: record.files, summary: record.summary }, ...history].slice(0, 20));
    for (const old of history.slice(19)) await store.delete(`run:${old.id}`);
    let resolution;
    try { resolution = await reconcileLinked(s, record, serverVerified ? result : null); }
    catch { resolution = { readyToClose: [], resolutionWarning: 'Run saved, but the linked-issue resolution check failed. Rerun to retry; issue statuses were not changed.' }; }
    return { ...result, ...resolution, auditSummary: { who: record.who, templateVersion: record.templateVersion, note: record.note }, id: record.id, files: files.map(f => ({ name: f.name, headers: f.headers, sheet: f.sheet })), savedExceptions: record.exceptions.length };
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
    return { id: saved.id, savedExceptions: saved.savedExceptions, auditSummary: saved.auditSummary, readyToClose: saved.readyToClose, ...(saved.resolutionWarning ? { resolutionWarning: saved.resolutionWarning } : {}), reviews: saved.results.filter(r => r.status !== 'matched').slice(0, MAX_SAVED_EXCEPTIONS).map(r => ({ id: r.id, signature: r.signature, review: r.review })) };
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
    await appendAudit(record, { event: 'review', who: context.accountId, exceptionId: row.id, status: review.status, note: review.note });
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
    await appendAudit(record, { event: 'issue-confirmation', who: context.accountId, confirmed: payload.confirmed === true, project: payload.project, issueType: payload.issueType, grouped: Boolean(payload.grouped), selectedIds: selected.map(r => r.id) });
    const rows = payload.grouped ? [{ key: 'grouped', label: `${payload.selectedIds ? selected.length : record.exceptionCount} exceptions`, status: 'grouped', diffs: stableStringify((payload.selectedIds ? selected : record.exceptions).map(({ review, ...row }) => row)).slice(0, 12000) }] : selected;
    const created = [], reused = [];
    for (const row of rows) {
      // Stable across reruns, scoped to source, target, rule set and exception content.
      const { review, ...evidence } = row;
      const hash = digest(stableStringify([record.source.kind, record.source.id, payload.project, payload.issueType, payload.parent || '', record.rules, record.mappings, evidence]));
      const label = `reconcile-${hash}`;
      const cached = await store.get(`dedupe:${hash}`);
      if (cached) { await jira('issue', { key: cached.issue }); if (cached.tracking) await trackIssue(record, cached.tracking); reused.push(cached.issue); continue; }
      const existing = await jira('findException', { label, project: payload.project });
      if (existing) {
        const tracking = { issue: existing, keys: (payload.grouped ? selected : [row]).map(r => r.key), configIdentity: configIdentity(record), when: now() };
        await store.set(`dedupe:${hash}`, { issue: existing, runId: record.id, tracking });
        await trackIssue(record, tracking);
        reused.push(existing); continue;
      }
      const fields = { project: { key: payload.project }, issuetype: { id: payload.issueType }, summary: `Reconcile: ${row.status} — ${row.label}`.slice(0, 250), labels: ['reconcile', label], description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: `Run ${record.id}\nSources: ${record.files.join(' / ')}\nKey: ${row.label}\nStatus: ${row.status}\nDifferences: ${row.diffs || 'Review missing or duplicate source rows.'}` }] }] } };
      if (payload.parent) { if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(payload.parent)) throw new Error('Invalid parent issue key.'); fields.parent = { key: payload.parent }; }
      const issue = await jira('create', { fields });
      const tracking = { issue: issue.key, keys: (payload.grouped ? selected : [row]).map(r => r.key), configIdentity: configIdentity(record), when: now() };
      await store.set(`dedupe:${hash}`, { issue: issue.key, runId: record.id, tracking });
      await trackIssue(record, tracking);
      created.push(issue.key);
    }
    await appendAudit(record, { event: 'issue-result', who: context.accountId, created, reused });
    return { created, reused, nextOffset: payload.grouped ? record.exceptions.length : offset + rows.length, savedExceptions: record.exceptions.length, totalExceptions: record.exceptionCount };
  }
  async function auditRun(context, payload) {
    const record = await savedRun(context, payload.runId);
    return { id: record.id, who: record.who, templateVersion: record.templateVersion, note: record.note, events: record.audit || [] };
  }
  async function createReport(context, payload) {
    const record = await savedRun(context, payload.runId);
    const pageId = payload.pageId || (record.source.kind === 'confluence' ? record.source.id : '');
    if (!/^\d+$/.test(pageId)) throw new Error('Enter an existing Confluence page ID in the intended report space.');
    const page = await confluence('page', { id: pageId }), key = `report:${record.id}:${page.spaceId}`, cached = await store.get(key);
    const reportUrl = page => { const path = page._links?.webui || `/pages/${page.id}`; return path.startsWith('/wiki/') ? path : `/wiki${path}`; };
    if (cached) { const existing = await confluence('page', { id: cached.id }); return { ...cached, url: reportUrl(existing), reused: true }; }
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const html = `<h1>Reconciliation report</h1><p>Run: ${escape(record.id)}</p><p>When: ${escape(record.when)}</p><p>Actor accountId: ${escape(record.who)}</p><p>Template: ${escape(record.templateName)} / version ${escape(record.templateVersion)}</p><p>Annotation: ${escape(record.note)}</p><p>Sources: ${escape(record.files.join(' / '))}</p><h2>Counts</h2><table><tbody>${Object.entries(record.summary).map(([status, count]) => `<tr><th>${escape(status)}</th><td>${count}</td></tr>`).join('')}</tbody></table><h2>Compact exception evidence</h2><pre>${escape(JSON.stringify(record.exceptions, null, 2))}</pre><h2>Audit events</h2><pre>${escape(JSON.stringify(record.audit || [], null, 2))}</pre><p>Full source rows are not stored in this report. Retain the XLSX evidence. No issue status was changed.</p>`;
    const created = await confluence('createPage', { spaceId: page.spaceId, status: 'current', title: `Reconcile report ${record.when.slice(0, 19)} ${record.id.slice(0, 8)}`, body: { representation: 'storage', value: html } });
    const report = { id: created.id, spaceId: page.spaceId, runId: record.id, url: reportUrl(created) };
    await store.set(key, report);
    await appendAudit(record, { event: 'report-created', who: context.accountId, pageId: created.id, spaceId: page.spaceId });
    return { ...report, reused: false };
  }
  return {
    scope, source, run, saveRun, savedRun, createIssues, reviewException, auditRun, createReport,
    async issueTypes(context, payload) {
      await scope(context);
      if (!/^[A-Z][A-Z0-9_]*$/.test(payload.project)) throw new Error('Enter a valid target project key.');
      return jira('issueTypes', { project: payload.project });
    },
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
