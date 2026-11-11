// Default source selection, default issue type and readable exception names.
// Roles are recognized only from the file name. Anything ambiguous is left for the user.
export const SOURCE_ROLES = [
  { role: 'ledger', test: /ledger|general[\s_-]*ledger|\bgl\b/i },
  { role: 'bank', test: /bank|statement/i },
  { role: 'invoices', test: /invoice/i }
];
// A = ledger (base), B = bank, C = invoices. This is the order the three-table guide uses.
const roleOf = name => {
  const hits = SOURCE_ROLES.filter(r => r.test.test(String(name ?? '').replace(/\.[^.]+$/, '')));
  return hits.length === 1 ? hits[0].role : null;
};

// Returns { sources: [{ id }], reason } where sources is empty when the choice is not reliable.
export function chooseSources(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length < 2) return { sources: [], reason: 'few' };
  if (list.length === 2) {
    const ranked = list.map((a, i) => ({ a, i, rank: SOURCE_ROLES.findIndex(r => r.role === roleOf(a.name)) }));
    const known = ranked.every(r => r.rank >= 0) && ranked[0].rank !== ranked[1].rank;
    if (known) ranked.sort((x, y) => x.rank - y.rank);
    return { sources: ranked.map(r => ({ id: r.a.id })), reason: 'pair' };
  }
  if (list.length > 5) return { sources: [], reason: 'ambiguous' };
  const roles = list.map(a => roleOf(a.name));
  if (roles.some(r => !r) || new Set(roles).size !== roles.length) return { sources: [], reason: 'ambiguous' };
  const order = SOURCE_ROLES.map(r => r.role);
  const sorted = list.map((a, i) => ({ a, rank: order.indexOf(roles[i]) })).sort((x, y) => x.rank - y.rank);
  return { sources: sorted.map(s => ({ id: s.a.id })), reason: 'roles' };
}

// The issue type whose name is Task (case-insensitive); empty when the project has none.
export function defaultIssueType(types) {
  const task = (Array.isArray(types) ? types : []).find(t => String(t?.name ?? '').trim().toLowerCase() === 'task');
  return task ? String(task.id) : '';
}

// Readable names for exceptions in audit cards and Rovo text: ids are zero-based positions in the run's result list.
export const exceptionText = ({ id, label }) => `Exception #${id} (key ${label})`;

// Attachment list identity: file name + id, order independent. Used to decide whether a saved session still matches the issue.
export const attachmentSignature = list => (Array.isArray(list) ? list : []).map(a => `${String(a?.id)}\u0000${String(a?.name ?? '')}`).sort().join('\u0001');
export const attachmentSnapshot = list => (Array.isArray(list) ? list : []).map(a => ({ id: String(a.id), name: String(a.name ?? '') }));

// Number of empty source cards to offer when nothing could be chosen automatically: three attachments keep A / B / C available.
const blankCards = list => Math.min(3, Math.max(2, Array.isArray(list) ? list.length : 0));
export const blankSources = list => Array.from({ length: blankCards(list) }, () => ({ id: '' }));

// Decides how the panel starts, for a first open, a reload with a saved session, and Reset (previous = null).
// mode: 'session' (saved sources are still valid), 'attachments' (chosen from file names), 'manual' (user chooses), 'none' (fewer than two attachments).
// A saved session is used only when its attachment snapshot (name + id) equals the current attachment list.
export function planStart(attachments, previous) {
  const list = Array.isArray(attachments) ? attachments : [];
  const saved = previous?.sources;
  const same = Array.isArray(previous?.attachments) && attachmentSignature(previous.attachments) === attachmentSignature(list);
  const usable = Array.isArray(saved) && saved.length >= 2 && saved.length <= 5 && saved.every(s => s && !s.local && (s.kind === 'jql' || list.some(a => a.id === s.id)));
  if (usable && same) return { mode: 'session', sources: saved, changed: false };
  const changed = Boolean(previous) && Array.isArray(saved) && saved.length > 0 && !same;
  if (list.length >= 2) {
    const { sources } = chooseSources(list);
    if (sources.length) return { mode: 'attachments', sources, changed };
    return { mode: 'manual', sources: blankSources(list), changed };
  }
  return { mode: 'none', sources: blankSources(list), changed };
}

export const ATTACHMENTS_CHANGED = 'Attachments changed since your last session, so sources were re-checked.';

// Readable list of exceptions for confirmations: one exception in full, several as "N exceptions: #0 (key a), #2 (key b) …".
export function exceptionListText(items, max = 3) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 1) return exceptionText(list[0]);
  const shown = list.slice(0, max).map(e => `#${e.id} (key ${e.label})`).join(', ');
  return `${list.length} exceptions: ${shown}${list.length > max ? ' …' : ''}`;
}

// "Task (10001)" using the loaded issue type list; just the id when the name is unknown (manually typed id).
export function issueTypeText(types, id) {
  const type = (Array.isArray(types) ? types : []).find(t => String(t?.id) === String(id));
  return type?.name ? `${type.name} (${id})` : String(id);
}

// Confirmation sentence shown before creating Jira issues.
export function confirmCreateText({ items, grouped, project, types, issueType, parent }) {
  const count = items.length;
  const what = grouped ? 'one grouped issue' : count === 1 ? 'one issue' : `${count} separate issues`;
  return `Create ${what} for ${exceptionListText(items)} in ${project}, type ${issueTypeText(types, issueType)}${parent ? `, parent ${parent}` : ''}?`;
}

// Creation result sentence, same wording as the Rovo action: "Created Issue: X" / "Reused Issue: X".
export function issueResultText(created, reused, separator = '. ') {
  const parts = [...(created || []).map(key => `Created Issue: ${key}`), ...(reused || []).map(key => `Reused Issue: ${key}`)];
  return parts.length ? parts.join(separator) : 'No issue was created or reused';
}

// Audit card line for an issue-confirmation event. Older records only have selectedIds (no selected/key): they read "Exception IDs: #0".
export function auditSelectionText(event) {
  const ids = Array.isArray(event?.selectedIds) ? event.selectedIds : [];
  const list = Array.isArray(event?.selected) ? event.selected.map(e => exceptionText({ id: e.id, label: e.key })).join('; ') : `Exception IDs: ${ids.map(id => `#${id}`).join(', ')}`;
  return `Selected exceptions: ${ids.length} · ${list} · Confirmed: ${String(event.confirmed)} · Grouped: ${String(event.grouped)} · Project: ${event.project} · Type: ${event.issueType}`;
}

// Hint for the 'manual' start. Three attachments whose names are not ledger / bank / invoices get a specific reason;
// any other count keeps the general text.
export const MANUAL_THREE = "File names couldn't be identified as ledger / bank / invoices. Please choose sources A/B/C manually.";
export const manualHint = count => count === 3
  ? MANUAL_THREE
  : `This issue has ${count} attachments, so sources were not auto-selected. Choose A / B / C manually (for the three-table sample: ledger as A), then click Load selected sources.`;

// Session record saved in sessionStorage: sources, the mapping config, the two option checkboxes that are easy to lose
// (Ignore leading zeros in keys, Aggregate per table) and whether the column mapping was confirmed.
export const sessionOptions = config => ({ leadingZeros: Boolean(config?.keyRules?.leadingZeros), aggregate: (config?.aggregate || []).map(Boolean) });
export function sessionRecord({ sources, config, mappingConfirmed, attachments }) {
  return { sources, config, options: config ? sessionOptions(config) : null, mappingConfirmed: Boolean(config && mappingConfirmed), attachments };
}
export const OPTIONS_RECHECK = 'This older session did not store the checkboxes, so "Ignore leading zeros in keys" and "Aggregate" were reset. Please re-check them.';

// A saved config is reused only when it still fits the loaded tables: same table count, and every mapped column exists.
function fits(config, files) {
  if (!config || !Array.isArray(files) || files.some(f => !f)) return false;
  const n = files.length, has = (i, c) => c === '' || files[i].headers.includes(c);
  return Array.isArray(config.keys) && config.keys.length === n && config.keys.every((keys, i) => Array.isArray(keys) && keys.every(k => has(i, k)))
    && Array.isArray(config.fields) && config.fields.every(f => Array.isArray(f.columns) && f.columns.length === n && f.columns.every((c, i) => has(i, c)))
    && Array.isArray(config.aggregate) && config.aggregate.length === n && config.keyRules && typeof config.keyRules === 'object';
}
// Returns { config, mappingConfirmed, optionsReset } for restoring a session after loading files. config is null when the
// saved one does not fit (the caller keeps its fresh proposal). Sessions saved before 4.1.5 have no options: defaults are used.
export function restoreSession(previous, files, fresh) {
  if (!fits(previous?.config, files)) return { config: null, mappingConfirmed: false, optionsReset: false };
  const stored = previous.options && typeof previous.options === 'object' ? previous.options : null;
  const n = files.length;
  const options = stored
    ? { leadingZeros: Boolean(stored.leadingZeros), aggregate: Array.from({ length: n }, (_, i) => Boolean(stored.aggregate?.[i])) }
    : { leadingZeros: Boolean(fresh?.keyRules?.leadingZeros), aggregate: Array.from({ length: n }, (_, i) => Boolean(fresh?.aggregate?.[i])) };
  const config = { ...previous.config, keyRules: { ...previous.config.keyRules, leadingZeros: options.leadingZeros }, aggregate: options.aggregate };
  return { config, mappingConfirmed: Boolean(stored) && previous.mappingConfirmed === true, optionsReset: !stored };
}
