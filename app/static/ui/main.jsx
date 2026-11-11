import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, view, router } from '@forge/bridge';
import { DEFAULT_RULES, STATUSES } from '../../src/reconcile.js';
import { mappingSuggestions, compactResult, PASSES } from '../../src/multi.js';
import { ATTACHMENTS_CHANGED, attachmentSnapshot, auditSelectionText, confirmCreateText, defaultIssueType, exceptionText, issueResultText, planStart } from '../../src/defaults.js';
import './style.css';
import { latestPreview } from './preview-state.js';
import { version } from '../../package.json';
const labels = { matched: 'Matched', mismatch: 'Value mismatch', 'only-a': 'Only in base', 'only-b': 'Missing from base', duplicate: 'Duplicate keys' };
const isMock = import.meta.env.MODE === 'mock';
const letter = i => String.fromCharCode(65 + i);
function workerTask(data) {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => { worker.terminate(); data.error ? reject(new Error(data.error)) : resolve(data.result); };
    worker.onerror = () => { worker.terminate(); reject(new Error('File worker failed. Split the export and retry.')); };
    worker.postMessage(data);
  });
}
function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const [boot, setBoot] = useState(null), [sources, setSources] = useState([{ id: '' }, { id: '' }]), [files, setFiles] = useState([null, null]);
  const [config, setConfig] = useState(null), [result, setResult] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('all'), [search, setSearch] = useState(''), [page, setPage] = useState(0), [tab, setTab] = useState('workspace'), [templateName, setTemplateName] = useState('Monthly AP vs bank');
  const [project, setProject] = useState(''), [issueType, setIssueType] = useState(''), [parent, setParent] = useState(''), [grouped, setGrouped] = useState(true), [confirm, setConfirm] = useState(false), [selected, setSelected] = useState([]);
  const [hideReviewed, setHideReviewed] = useState(false), [reviewId, setReviewId] = useState(''), [reviewStatus, setReviewStatus] = useState('Explained'), [reviewNote, setReviewNote] = useState('');
  const [originalLayout, setOriginalLayout] = useState(false), [statementView, setStatementView] = useState(false);
  const [mappingAdvice, setMappingAdvice] = useState([]), [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [issueTypes, setIssueTypes] = useState([]);
  const [runNote, setRunNote] = useState(''), [audit, setAudit] = useState(null), [reportPageId, setReportPageId] = useState(''), [report, setReport] = useState(null);
  const working = useRef(false), sessionKey = useRef(null);
  const [restored, setRestored] = useState(''), [attachmentsChanged, setAttachmentsChanged] = useState(false), [identifying, setIdentifying] = useState(true), [createResult, setCreateResult] = useState('');
  const snapshot = useRef([]);
  const [previewLoading, setPreviewLoading] = useState(false), [sessionReady, setSessionReady] = useState(false);
  const previewRequests = useRef(latestPreview());
  async function action(fn) { if (working.current) return; working.current = true; setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError(e.message); } finally { working.current = false; setBusy(false); } }
  function invalidate() { setResult(null); setSelected([]); setConfirm(false); setCreateResult(''); setReviewId(''); setAudit(null); setReport(null); }
  function initialConfig(next) { const suggestions = mappingSuggestions(next); setMappingAdvice(suggestions.advice); setMappingConfirmed(false); return { ...suggestions.proposed, baseIndex: 0, keyRules: { ...DEFAULT_RULES, leadingZeros: false }, aggregate: next.map(() => false), acceptedPairs: [] }; }
  async function load(nextSources) {
    const request = previewRequests.current.begin();
    setPreviewLoading(true); setMappingConfirmed(false); invalidate();
    try {
    const next = [];
    for (const s of nextSources) {
      const f = s.local ? await workerTask({ operation: 'parse', bytes: s.bytes, name: s.name, sheet: s.sheet }) : await invoke('loadSource', s);
      next.push(f.bytes64 ? await workerTask({ operation: 'parse', bytes: Uint8Array.from(atob(f.bytes64), c => c.charCodeAt(0)), name: f.name, sheet: s.sheet }) : f);
    }
    if (!request.current()) return;
    setFiles(next); setSources(nextSources.map((s, i) => ({ ...s, sheet: next[i].sheet }))); setConfig(initialConfig(next)); invalidate();
    } catch (error) { if (!request.current()) return; setConfig(null); setFiles(nextSources.map(() => null)); throw error; }
    finally { if (request.current()) setPreviewLoading(false); }
  }
  // Start from the attachments (or a saved session whose attachment list still matches), for first open and Reset alike.
  async function startFrom(plan, previous) {
    setAttachmentsChanged(plan.changed); setSources(plan.sources); setFiles(plan.sources.map(() => null));
    if (plan.mode === 'session' || plan.mode === 'attachments') {
      setIdentifying(false);
      await load(plan.sources);
      setRestored(plan.mode === 'session' ? 'session' : 'attachments');
      if (plan.mode === 'session' && previous.config?.keys?.length === plan.sources.length) setConfig(previous.config);
      setMappingConfirmed(false);
    } else setRestored(plan.mode === 'manual' ? 'manual' : '');
  }
  useEffect(() => { action(async () => {
    try {
      await view.theme.enable(); const data = await invoke('bootstrap'); setBoot(data);
      setProject(data.scope.namespace.startsWith('project:') ? data.scope.namespace.slice(8) : '');
      sessionKey.current = `reconcile-session:${data.scope.kind}:${data.scope.id}`; snapshot.current = attachmentSnapshot(data.attachments);
      let previous;
      try { previous = JSON.parse(sessionStorage.getItem(sessionKey.current)); } catch {}
      await startFrom(planStart(data.attachments, previous), previous);
      setSessionReady(true);
    } finally { setIdentifying(false); }
  }); }, []);
  useEffect(() => {
    if (!sessionReady || !sessionKey.current || busy) return;
    try {
      if (sources.some(s => s.local || (!s.id && s.kind !== 'jql'))) sessionStorage.removeItem(sessionKey.current);
      else sessionStorage.setItem(sessionKey.current, JSON.stringify({ sources, config, attachments: snapshot.current }));
    } catch {}
  }, [sources, config, busy, sessionReady]);
  // Reset returns to the state of a first open: attachments are read again and sources are chosen the same way.
  function reset() { action(async () => {
    previewRequests.current.begin(); setPreviewLoading(false);
    setConfig(null); setMappingAdvice([]); setMappingConfirmed(false);
    invalidate(); setRunNote(''); setRestored(''); setAttachmentsChanged(false); setError(''); setNotice(''); setFilter('all'); setSearch(''); setPage(0); setTab('workspace');
    setOriginalLayout(false); setStatementView(false); setHideReviewed(false); setReviewNote(''); setReportPageId('');
    try { sessionStorage.removeItem(sessionKey.current); } catch {}
    const data = await invoke('bootstrap'); setBoot(data); snapshot.current = attachmentSnapshot(data.attachments);
    await startFrom(planStart(data.attachments, null), null);
  }); }
  function changeSource(i, value) { setSources(s => s.map((v, j) => i === j ? value : v)); setFiles(f => f.map((v, j) => i === j ? null : v)); invalidate(); }
  function changeConfig(next) { setConfig(next); setMappingConfirmed(false); invalidate(); }
  function updateField(id, patch) { changeConfig({ ...config, fields: config.fields.map(f => f.id === id ? { ...f, ...patch } : f) }); }
  async function run(nextConfig = config) {
    if (!files.every(f => f?.rows.length) || !config) throw new Error('Reload the sources before running.');
    if (!mappingConfirmed) throw new Error('Review and confirm column mapping before running. Low-confidence columns need a manual choice.');
    const output = await workerTask({ operation: 'run', files, config: nextConfig });
    if (sources.every(s => !s.local)) {
      const compact = compactResult(output);
      const saved = await invoke('saveRun', { sources, config: nextConfig, templateName, note: runNote, result: compact });
      const byId = new Map(saved.reviews.map(r => [r.id, r]));
      output.results = output.results.map(r => ({ ...r, ...byId.get(r.id) }));
      output.id = saved.id; output.savedExceptions = saved.savedExceptions; output.auditSummary = saved.auditSummary; output.readyToClose = saved.readyToClose; output.resolutionWarning = saved.resolutionWarning; setBoot(await invoke('bootstrap'));
    }
    setResult(output); setAudit(null); setReport(null); setConfig(nextConfig); setSelected([]); setConfirm(false); setReviewId(''); setFilter('all'); setPage(0); setNotice(`Reconciliation complete. ${output.resolutionWarning || 'Review possible matches before accepting any pair.'}`);
  }
  async function applyTemplate(t) {
    if (t.sources && t.sources.length === sources.length) {
      const nextSources = sources.map((s, i) => ({ ...s, sheet: t.sources[i].sheet }));
      if (nextSources.some((s, i) => s.sheet !== sources[i].sheet)) { await load(nextSources); }
    }
    if (t.config) {
      if (t.config.keys.length !== sources.length) throw new Error(`This template needs ${t.config.keys.length} tables. Add or remove tables first.`);
      setConfig(t.config);
    } else {
      if (sources.length !== 2) throw new Error('This legacy template needs two tables.');
      const fields = [];
      for (const kind of ['amount', 'date']) if (t.mappings[0][kind]) fields.push({ id: kind, name: kind, type: kind === 'amount' ? 'number' : 'date', columns: t.mappings.map(m => m[kind]), abs: t.rules.amountTolerance, percent: t.rules.percentTolerance, days: t.rules.dateTolerance });
      (t.mappings[0].compare || []).forEach((h, i) => fields.push({ id: `text-${i}`, name: h, type: 'text', columns: t.mappings.map(m => m.compare[i]), ...t.rules }));
      setConfig({ ...initialConfig(files), keys: t.mappings.map(m => m.keys), fields, keyRules: t.rules });
    }
    setTemplateName(t.name); setMappingConfirmed(true); invalidate();
  }
  const filtered = result?.results.filter(r => (filter === 'all' || r.status === filter) && (!hideReviewed || !r.review) && (!statementView || r.pairs.some(p => ['only-a', 'only-b'].includes(p.status))) && JSON.stringify(r).toLowerCase().includes(search.toLowerCase())) || [];
  const savedIds = new Set(result?.results.filter(r => r.signature).map(r => r.id));
  return <main>
    <header className="topbar"><div className="brand"><img src="./icon.svg" alt=""/><strong>Reconcile</strong><span>for Jira & Confluence</span></div><span className="environment">{isMock ? `LOCAL PREVIEW · SYNTHETIC DATA · v${version}` : `ATLASSIAN FORGE · v${version}`}</span></header>
    <div className="heading"><div><p className="eyebrow">{boot ? `${boot.scope.kind === 'confluence' ? 'CONFLUENCE PAGE' : 'JIRA ISSUE'} / ${boot.scope.id}` : 'Reconcile / Loading'}</p><h1>Your exports. One clear answer.</h1><p>Match records, investigate differences and turn exceptions into action.</p></div><span className="privacy">No external data egress</span></div>
    <nav aria-label="Workspace"><button className={tab === 'workspace' ? 'active' : ''} onClick={() => setTab('workspace')}>Reconciliation</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Run history <span>{boot?.history.length || 0}</span></button></nav>
    {error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert" role="status">{notice}</div>}
    {tab === 'history' ? <section className="card"><h2>Recent runs on this {boot?.scope.kind === 'jira' ? 'issue' : 'page'}</h2><p>Last 20 summaries. Open the source files and rerun to review full results.</p>{boot?.history.map(h => <article className="history" key={h.id}><strong>{h.files.join(' ↔ ')}</strong><span>{new Date(h.when).toLocaleString()} · {h.who}</span><code>{h.id}</code><p>{Object.entries(h.summary).map(([s, n]) => `${labels[s]}: ${n}`).join(' · ')}</p></article>)}</section> : <>
    <section className="sources"><h2><span className="step">1</span> Choose your sources</h2>{identifying ? <div className="card identifying" role="status">Identifying attachments…</div> : <><div className="source-grid">{sources.map((source, i) => <div className="card source" key={i}>
      <div className="card-title"><b className={`letter ${i ? 'b' : ''}`}>{letter(i)}</b><div><h3>{i ? 'Comparison table' : 'Reference table'}</h3><p>{i ? 'Bank statement or issue export' : 'AP ledger or baseline export'}</p></div>{sources.length > 2 && <button disabled={busy} aria-label={`Remove table ${letter(i)}`} onClick={() => { setSources(s => s.filter((_, j) => j !== i)); setFiles(f => f.filter((_, j) => j !== i)); setConfig(null); invalidate(); }}>Remove</button>}</div>
      <label>Source<select disabled={busy} aria-label={`Source ${letter(i)}`} value={source.kind === 'jql' ? 'jql' : source.id} onChange={e => changeSource(i, e.target.value === 'jql' ? { kind: 'jql', jql: '' } : { id: e.target.value })}><option value="">Select attachment</option>{boot?.attachments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}{i > 0 && <option value="jql">JQL result</option>}</select></label>
      {source.kind === 'jql' && <label>JQL query<textarea value={source.jql} onChange={e => changeSource(i, { kind: 'jql', jql: e.target.value })}/></label>}
      {files[i] && <div className="file-meta"><strong>{files[i].name}</strong><span>{previewLoading ? 'Loading…' : `${files[i].rows.length.toLocaleString()} rows · ${files[i].headers.length} columns · header row ${files[i].headerRow || 1}`}</span>{files[i].sheets?.length > 1 && <label>Worksheet {letter(i)}<select aria-label={`Worksheet ${letter(i)}`} value={source.sheet || files[i].sheet} disabled={busy} onChange={e => { const sheet = e.target.value; action(async () => {
        const nextSources = sources.map((s, j) => j === i ? { ...s, sheet } : s);
        setSources(nextSources); await load(nextSources);
      }); }}>{files[i].sheets.map(s => <option key={s}>{s}</option>)}</select></label>}{!previewLoading && files[i].rows.length <= 1 && <p role="status">This sheet has almost no data rows — check the worksheet selection.</p>}</div>}
      {isMock && <label className="upload">Or use a local XLSX / CSV<input type="file" accept=".xlsx,.csv" disabled={busy} onChange={e => { const file = e.target.files[0]; if (file) action(async () => {
        const bytes = await file.arrayBuffer(), parsed = await workerTask({ operation: 'parse', bytes, name: file.name });
        const next = files.map((f, j) => i === j ? parsed : f); setFiles(next); setSources(s => s.map((v, j) => i === j ? { id: '', local: true, bytes, name: file.name } : v)); if (next.every(Boolean)) setConfig(initialConfig(next)); invalidate();
      }); }}/></label>}
    </div>)}</div>
    <div className="source-actions"><button disabled={busy} onClick={reset}>Reset</button><button disabled={busy || sources.some(s => !s.local && s.kind !== 'jql' && !s.id)} onClick={() => action(() => { setRestored(''); return load(sources); })}>Load selected sources</button><button disabled={busy || sources.length === 5} onClick={() => { setConfig(null); setMappingConfirmed(false); setSources(s => [...s, { id: '' }]); setFiles(f => [...f, null]); invalidate(); }}>Add table</button><span className="hint">2–5 CSV / XLSX tables · Attached file limit 2 MB</span></div>{restored && <div className="alert" role="status">{restored === 'session' ? 'Restored from your last session. Please re-check sources and worksheets, or click Reset.' : restored === 'manual' ? `This issue has ${boot?.attachments.length} attachments, so sources were not auto-selected. Choose A / B / C manually (for the three-table sample: ledger as A), then click Load selected sources.` : "Sources were auto-selected from this issue's attachments. Please re-check sources and worksheets, or click Reset."}</div>}{attachmentsChanged && <div className="alert" role="status">{ATTACHMENTS_CHANGED}</div>}</>}</section>
    {files.every(Boolean) && config && <section className="card mapping"><fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><h2><span className="step">2</span> Map columns & set rules</h2>
      <div className="template"><label>Project / space template<select aria-label="Saved template" disabled={busy} value="" onChange={e => { const t = boot.templates.find(t => t.name === e.target.value); if (t) action(() => applyTemplate(t)); }}><option value="">Select saved rules</option>{boot?.templates.map(t => <option key={t.name}>{t.name}</option>)}</select></label><label>Template name<input value={templateName} maxLength={80} onChange={e => { setTemplateName(e.target.value); }}/></label><button disabled={busy || !mappingConfirmed} onClick={() => action(async () => { const templates = await invoke('saveTemplate', { name: templateName, config, sources: sources.map(s => ({ sheet: s.sheet })) }); setBoot({ ...boot, templates }); setNotice('Template saved for this project or space.'); })}>Save template</button></div>
      <div className="card" aria-label="Column mapping suggestions"><h3>Column mapping suggestions</h3><p>{mappingConfirmed ? 'Column mapping confirmed. Selecting a saved template confirms its previously saved mapping.' : 'Proposals only: review columns and sample values, then confirm. Low-confidence proposals are left blank for a manual choice.'}</p>{!mappingConfirmed && <ul>{mappingAdvice.map((a, i) => <li key={i}>Table {letter(a.table)} · {a.target} → {a.source} · <b>{a.confidence}</b> · {a.reason}</li>)}</ul>}<button disabled={busy || mappingConfirmed || config.keys.some(keys => keys.some(key => !key)) || config.fields.some(f => f.type !== 'ignore' && f.columns.some(column => !column))} onClick={() => { setMappingConfirmed(true); setNotice('Column mapping confirmed. You can now save these rules or run reconciliation.'); }}>Confirm column mapping</button></div>
      <label className="base-picker">Base table<select aria-label="Base table" value={config.baseIndex} onChange={e => changeConfig({ ...config, baseIndex: Number(e.target.value), acceptedPairs: [] })}>{files.map((f, i) => <option key={i} value={i}>{letter(i)} · {f.name}</option>)}</select></label>
      <div className="mapping-grid">{files.map((f, i) => <div key={i}><h3>Table {letter(i)} mapping</h3><label>Key columns <small>Ctrl / ⌘ to select a composite key</small><select multiple aria-label={`Key columns ${letter(i)}`} value={config.keys[i] || []} onChange={e => changeConfig({ ...config, keys: config.keys.map((k, j) => j === i ? Array.from(e.target.selectedOptions, o => o.value) : k), acceptedPairs: [] })}>{f.headers.map(h => <option key={h}>{h}</option>)}</select></label><label className="check"><input type="checkbox" aria-label={`Aggregate ${letter(i)}`} checked={Boolean(config.aggregate[i])} onChange={e => changeConfig({ ...config, aggregate: config.aggregate.map((v, j) => j === i ? e.target.checked : v) })}/>Sum numeric fields by key; retain component rows</label></div>)}</div>
      <div className="rules">{[['trim', 'Trim keys'], ['caseFold', 'Ignore key case'], ['fullWidth', 'Normalize full-width keys'], ['leadingZeros', 'Ignore leading zeros in keys']].map(([key, title]) => <label className="check" key={key}><input type="checkbox" checked={Boolean(config.keyRules[key])} onChange={e => changeConfig({ ...config, keyRules: { ...config.keyRules, [key]: e.target.checked } })}/>{title}</label>)}</div>
      <label className="check"><input type="checkbox" checked={Boolean(config.combinationMatch)} onChange={e => changeConfig({ ...config, combinationMatch: e.target.checked })}/>Match unique amount combinations (one payment to multiple invoices, or split payments)</label><p className="hint">Opt in only when these exports belong together. Search is bounded to 12 candidate groups, 4 component groups and 20,000 checks. Ambiguous combinations stay unresolved; all original rows remain visible.</p>
      <div className="field-rules"><h3>Per-field comparison rules</h3>{config.fields.map(f => <div className="field-rule" key={f.id}>
        <div className="rules"><label>Field name<input aria-label={`Field name ${f.id}`} value={f.name} onChange={e => updateField(f.id, { name: e.target.value })}/></label><label>Rule<select aria-label={`Rule ${f.name}`} value={f.type} onChange={e => updateField(f.id, { type: e.target.value })}>{['exact', 'number', 'date', 'text', 'ignore'].map(t => <option key={t}>{t}</option>)}</select></label>{files.map((file, t) => <label key={t}>Column {letter(t)}<select aria-label={`${f.name} column ${letter(t)}`} disabled={f.type === 'ignore'} value={f.columns[t] ?? ''} onChange={e => updateField(f.id, { columns: f.columns.map((h, j) => j === t ? e.target.value : h) })}><option value="">Select column</option>{file.headers.map(h => <option key={h}>{h}</option>)}</select></label>)}<button onClick={() => changeConfig({ ...config, fields: config.fields.filter(v => v.id !== f.id) })}>Remove rule</button></div>
        {f.type === 'number' && <div className="rules">{[['abs', 'Absolute ±'], ['percent', 'Percent ± (of base)']].map(([key, title]) => <label key={key}>{title}<input aria-label={`${title} ${f.name}`} type="number" min="0" step="0.01" value={f[key] ?? 0} onChange={e => updateField(f.id, { [key]: e.target.value })}/></label>)}</div>}
        {f.type === 'date' && <div className="rules"><label>Date ± days<input aria-label={`Date ± days ${f.name}`} type="number" min="0" max="365" value={f.days ?? 0} onChange={e => updateField(f.id, { days: e.target.value })}/></label><label>Accepted formats<input aria-label={`Accepted formats ${f.name}`} value={f.formats || ''} placeholder="YYYY-MM-DD,DD/MM/YYYY" onChange={e => updateField(f.id, { formats: e.target.value })}/></label></div>}
        {f.type === 'text' && <div className="rules">{[['trim', 'Trim'], ['caseFold', 'Ignore case'], ['fullWidth', 'Normalize full-width'], ['ignorePunctuation', 'Ignore punctuation']].map(([key, title]) => <label className="check" key={key}><input type="checkbox" checked={Boolean(f[key])} onChange={e => updateField(f.id, { [key]: e.target.checked })}/>{title}</label>)}</div>}
      </div>)}<button disabled={config.fields.length >= 50} onClick={() => changeConfig({ ...config, fields: [...config.fields, { id: crypto.randomUUID(), name: 'New field', type: 'exact', columns: files.map(() => '') }] })}>Add field rule</button></div>
      <label>Run annotation<textarea disabled={busy} maxLength={500} value={runNote} onChange={e => setRunNote(e.target.value)} placeholder="Optional evidence or review context"/></label>{result?.id && <><button disabled={busy} onClick={() => action(async () => { const summary = await invoke('annotateRun', { runId: result.id, note: runNote }); setResult(r => ({ ...r, auditSummary: summary })); setAudit(null); setNotice('Annotation saved to this run. Existing reports keep their generated snapshot.'); })}>Save run annotation</button><p className="hint">Save changes to this run after completion. Existing Confluence reports keep their generated snapshot.</p></>}
      <div className="run-bar"><p>Duplicates need review unless aggregation is enabled. Numeric fields are summed; conflicting text/date fields stay flagged.</p><button className="primary" disabled={busy || !mappingConfirmed || files.some(f => !f?.rows.length)} onClick={() => action(() => run())}>{busy ? 'Working…' : 'Run reconciliation'}</button></div></fieldset></section>}
    {result && <section className="results"><div className="section-title"><div><p className="eyebrow">RECONCILIATION COMPLETE</p><h2>Every difference, accounted for.</h2><p>{result.inputRows.map((n, t) => `${n.toLocaleString()} rows in ${letter(t)}`).join(' · ')} · Counts below are unique keys</p></div><div><label className="check"><input type="checkbox" checked={originalLayout} onChange={e => setOriginalLayout(e.target.checked)}/>Include original table layouts</label><button disabled={busy} onClick={() => action(async () => download(await workerTask({ operation: 'export', run: result, files, options: { originalLayout } }), 'reconciliation.xlsx'))}>Export XLSX ↓</button></div></div>
      <div className="pass-strip">{PASSES.map((p, i) => <span key={p}>{i + 1}. {p}</span>)}</div>
      <div className="metrics">{STATUSES.map(s => <button key={s} className={`metric ${s} ${filter === s ? 'selected' : ''}`} onClick={() => { setFilter(s); setPage(0); }}><span>{labels[s]}</span><strong>{result.summary[s]}</strong></button>)}</div>
      <p>Reasons: {Object.entries(result.reasonSummary).map(([k, v]) => `${k}: ${v}`).join(' · ')}. Reasons can overlap.</p>
      {result.id && <div className="card" aria-label="Run audit and report"><h3>Run audit & Confluence report</h3><p>Actor accountId: <code>{result.auditSummary?.who}</code></p><p>Template version: <code>{result.auditSummary?.templateVersion}</code></p><p>Annotation: {result.auditSummary?.note || 'None'}</p><button disabled={busy} onClick={() => action(async () => setAudit(await invoke('auditRun', { runId: result.id })))}>Load audit trail</button>{audit && <div className="audit-events" aria-label="Audit events">{audit.events.map((event, i) => <article className="card" key={i}><h4>{event.event}</h4><p>When: {event.when}</p><p>Actor accountId: {event.who}</p>{event.templateVersion && <p>Template version: {event.templateVersion}</p>}{event.note && <p>Annotation: {event.note}</p>}{event.status && <p>Review: {event.status}</p>}{event.selectedIds && <p>{auditSelectionText(event)}</p>}{event.created && <p>{issueResultText(event.created, event.reused, ' · ')}</p>}{event.pageId && <p>Report page: {event.pageId}</p>}</article>)}</div>}<label>Existing Confluence page ID in the report space<input inputMode="numeric" value={reportPageId} onChange={e => { setReportPageId(e.target.value); setReport(null); }} placeholder={boot?.scope.kind === 'confluence' ? 'Use this source page’s space' : 'Select the intended test space via an existing page'}/></label><button disabled={busy || (boot?.scope.kind !== 'confluence' && !reportPageId)} onClick={() => action(async () => { const page = await invoke('createReport', { runId: result.id, pageId: reportPageId }); setReport(page); setNotice(`${page.reused ? 'Reused' : 'Created'} Confluence report page ${page.id}. Existing pages were not changed.`); })}>Generate Confluence report</button>{report && <p>{report.reused ? 'Reused' : 'Created'} page <b>{report.id}</b> <button onClick={() => Promise.resolve(router.open(report.url || `/wiki/pages/${report.id}`)).catch(e => setError(e.message))}>Open report</button></p>}</div>}
      {!!result.readyToClose?.length && <div className="card" aria-label="Ready to close"><h3>Ready to close</h3><p>Server-verified rerun evidence was added to the exception issues created by the app. Close them manually after review; statuses were not changed.</p>{result.readyToClose.map(r => <p key={r.issue}><b>{r.issue}</b> · Evidence run <code>{r.evidenceRunId}</code></p>)}</div>}
      {config.combinationMatch && <p>Amount combinations: {result.combinationSearch?.checks || 0} checks · {result.combinationSearch?.ambiguous || 0} ambiguous anchors left for review{result.combinationSearch?.bounded && ' · Search limit reached; remaining rows need review.'}</p>}
      {!!result.statements.length && <details className="card statement"><summary>Reconciliation statement & unreconciled items</summary>{result.statements.map(s => <article key={s.table}><h3>{files[result.baseIndex].name} ↔ {s.name} · {s.field}</h3><p>{s.baseTotal.toFixed(2)} base − {s.baseOnly.toFixed(2)} in base only + {s.otherOnly.toFixed(2)} in other only = {s.adjusted.toFixed(2)} adjusted; other total {s.otherTotal.toFixed(2)}. <b>{s.balances ? 'Balances' : `Does not balance · residual ${s.residual.toFixed(2)}`}</b></p><p>In base, not other: {s.onlyBase.join(', ') || 'None'}</p><p>In other, not base: {s.onlyOther.join(', ') || 'None'}</p></article>)}</details>}
      <div className="card"><div className="filters"><label>Show<select aria-label="Result category" value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}><option value="all">All categories</option>{STATUSES.map(s => <option key={s} value={s}>{labels[s]}</option>)}</select></label><label>Search<input type="search" placeholder="Search key or value…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}/></label><span>{filtered.length} results</span></div>
      <div className="rules"><label className="check"><input type="checkbox" checked={hideReviewed} onChange={e => { setHideReviewed(e.target.checked); setPage(0); }}/>Hide previously explained / ignored</label><label className="check"><input type="checkbox" checked={statementView} onChange={e => { setStatementView(e.target.checked); setPage(0); }}/>Unreconciled items only</label></div>
      <div className="table-scroll"><table><thead><tr><th>Select</th><th>Key</th><th>Status / pass</th>{files.map((f, t) => <th key={t}>{letter(t)} · {f.name}</th>)}<th>Cell differences / review notes</th></tr></thead><tbody>{filtered.slice(page * 25, (page + 1) * 25).map(r => <tr key={r.id}>
        <td>{savedIds.has(r.id) && <input type="checkbox" aria-label={`Select exception ${r.label}`} checked={selected.includes(r.id)} disabled={busy || (!selected.includes(r.id) && selected.length >= 20)} onChange={e => { setSelected(s => e.target.checked ? [...s, r.id] : s.filter(id => id !== r.id)); setConfirm(false); setCreateResult(''); }}/>}</td>
        <td className="key">{r.label}</td><td><span className={`badge ${r.status}`}>{labels[r.status]}</span><p>{r.pass}</p>{r.combination && <p>{r.combination.map((rows, t) => `${letter(t)}: ${rows.map(c => `${JSON.parse(c.key).join(' / ')} (row ${c.row})`).join(' + ') || 'missing'}`).join(' ↔ ')}</p>}{r.review && <b>{r.review.status} previously</b>}</td>
        {r.entries.map((entry, t) => <td key={t} className={r.diffs.some(d => d.table === t || result.baseIndex === t) ? 'diff-cell' : ''}>{entry ? <><b>Present</b><div>{config.fields.filter(f => f.type === 'number').map(f => <div key={f.id}>{f.name}: {(entry.values[f.id] / 100).toFixed(2)}</div>)}</div><details><summary>{entry.components.length} source row{entry.components.length === 1 ? '' : 's'}</summary>{entry.components.map(c => <p key={c.row}>Row {c.row}: {JSON.stringify(c.raw)}</p>)}</details></> : 'Missing'}</td>)}
        <td>{r.diffs.map((d, i) => <div className="diff" key={i}><b>{d.field} · table {letter(d.table)}</b>: <mark>{String(d.a)}</mark> → <mark>{String(d.b)}</mark>{d.delta !== null && ` · Δ ${d.delta}${d.type === 'date' ? ' days' : ''}`}</div>)}{r.pairs.filter(p => !['matched', 'mismatch', 'absent'].includes(p.status)).map(p => <p key={p.table}>{letter(p.table)}: {labels[p.status]}</p>)}{r.review && <p>{r.review.note}</p>}{savedIds.has(r.id) && <button disabled={busy} onClick={() => { setReviewId(r.id); setReviewNote(r.review?.note || ''); }}>Review exception</button>}</td>
      </tr>)}</tbody></table></div>{!filtered.length && <p className="empty">No rows match these filters.</p>}
      <div className="pagination"><span>Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 25))}</span><button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button disabled={(page + 1) * 25 >= filtered.length} onClick={() => setPage(page + 1)}>Next</button></div></div>
      {reviewId && <div className="card confirmation" role="region" aria-label="Review exception"><h3>Remember exception · {result.results.find(r => r.id === reviewId)?.label}</h3><label>Review status<select aria-label="Review status" value={reviewStatus} onChange={e => setReviewStatus(e.target.value)}><option>Explained</option><option>Ignored</option></select></label><label>Review note<textarea maxLength={500} value={reviewNote} onChange={e => setReviewNote(e.target.value)}/></label><button disabled={busy} onClick={() => action(async () => { const review = await invoke('reviewException', { runId: result.id, id: reviewId, status: reviewStatus, note: reviewNote }); setResult(r => ({ ...r, results: r.results.map(row => row.id === reviewId ? { ...row, review } : row) })); setReviewId(''); setNotice('Review remembered for this template and unchanged exception evidence.'); })}>Save review</button><button onClick={() => setReviewId('')}>Cancel</button></div>}
      {!!result.suggestions.pairs.length && <details className="card suggestions"><summary>Possible matches · {result.suggestions.pairs.length}{result.suggestions.bounded ? ' (bounded search)' : ''}</summary><p>Suggestions never change counts until you accept a pair. Acceptance reruns the comparison and is saved in the current template only if you save it.</p>{result.suggestions.pairs.map((s, i) => <article key={i}><span>{s.baseLabel} ↔ {s.otherLabel} · table {letter(s.table)} · {s.reason}</span><button disabled={busy} onClick={() => action(() => run({ ...config, acceptedPairs: [...config.acceptedPairs, { table: s.table, from: s.from, to: s.to }] }))}>Accept pair {i + 1}</button></article>)}</details>}
      {result.id && <div className="card exceptions"><h3>Create Jira issues for selected exceptions</h3><p>{selected.length} selected · at most 20 per request. First 200 exceptions retained. Repeated requests reuse existing references.</p><div className="rules"><label>Target project key<input disabled={busy} value={project} onChange={e => { setProject(e.target.value); setIssueTypes([]); setIssueType(''); setConfirm(false); setCreateResult(''); }}/></label><button disabled={busy || !project} onClick={() => action(async () => { const types = await invoke('issueTypes', { project }), preset = defaultIssueType(types); setIssueTypes(types); setIssueType(preset); setConfirm(false); if (!preset) setNotice('This project has no issue type named Task. Choose an issue type from the list.'); })}>Load project issue types</button>{issueTypes.length ? <label>Issue type<select value={issueType} onChange={e => { setIssueType(e.target.value); setConfirm(false); }}><option value="">Choose an issue type</option>{issueTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label> : <label>Issue type ID<input value={issueType} onChange={e => { setIssueType(e.target.value); setConfirm(false); }}/></label>}<label>Parent key (for sub-tasks)<input value={parent} onChange={e => { setParent(e.target.value); setConfirm(false); }}/></label><label className="check"><input type="checkbox" checked={grouped} onChange={e => { setGrouped(e.target.checked); setConfirm(false); }}/>Group selected exceptions</label></div><p>Load types for the target project; Task is selected by default when the project has it (usually keep Task), otherwise choose a type. If unavailable, open GET /rest/api/3/project/PROJECTKEY and use an issueTypes[].id number; a type name or project key will not work.</p><button disabled={busy || !issueType || !project || !selected.length} onClick={() => { setCreateResult(''); setConfirm(true); }}>Review issue creation</button>{createResult && <span className="alert inline-result" role="status" aria-label="Issue creation result">{createResult}</span>}{confirm && <div className="confirmation" role="region" aria-label="Confirm issue creation"><p>{confirmCreateText({ items: result.results.filter(r => selected.includes(r.id)), grouped, project, types: issueTypes, issueType, parent })}</p><button className="primary" disabled={busy} onClick={() => action(async () => { const response = await invoke('createIssues', { runId: result.id, project, issueType, parent, grouped, selectedIds: selected, confirmed: true }); const text = issueResultText(response.created, response.reused); setNotice(text); setCreateResult(text); setConfirm(false); })}>Confirm creation</button><button onClick={() => setConfirm(false)}>Cancel</button></div>}</div>}
    </section>}
    </>}<footer>Reconcile · Key-based comparison for Jira & Confluence{isMock && <span>Preview changes are stored only in this browser.</span>}</footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
