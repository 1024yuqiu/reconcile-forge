import { exceptionText } from './defaults.js';

// Human-readable Jira descriptions (Atlassian Document Format, version 1) for created issues.
// Pure functions: they read the saved run record and the exception rows, and never print raw JSON.

const MAX_TEXT = 24000;
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const letter = i => String.fromCharCode(65 + i);
const parse = value => { if (typeof value !== 'string') return Array.isArray(value) ? value : []; try { const v = JSON.parse(value); return Array.isArray(v) ? v : []; } catch { return null; } };
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const money = v => isNum(v) ? v.toFixed(2) : v === null || v === undefined || v === '' ? '(empty)' : String(v);
const shown = v => (v === null || v === undefined || v === '' ? '(empty)' : String(v));

// Counts per table as an array; old two-table records stored {a, b}.
const countList = counts => Array.isArray(counts) ? counts : counts && typeof counts === 'object' ? [counts.a, counts.b].filter(v => v !== undefined) : [];

export function categoryText(row, files = []) {
  const counts = countList(row.counts), name = i => letter(i);
  const missing = counts.map((c, i) => c === 0 ? name(i) : null).filter(Boolean);
  const dup = counts.map((c, i) => c > 1 ? name(i) : null).filter(Boolean);
  const diffs = parse(row.diffs) || [];
  const types = new Set(diffs.map(d => d.type || (d.field === 'amount' ? 'number' : d.field === 'date' ? 'date' : 'text')));
  const parts = [];
  if (row.status === 'duplicate') parts.push(`duplicate key in ${dup.join(', ') || 'a source'}`);
  if (missing.length && ['only-a', 'only-b'].includes(row.status)) parts.push(`missing in ${missing.join(', ')}`);
  if (types.has('number')) parts.push('amount mismatch');
  if (types.has('date')) parts.push('date mismatch');
  if ([...types].some(t => t !== 'number' && t !== 'date')) parts.push('field mismatch');
  if (!parts.length) parts.push(row.status === 'mismatch' ? 'mismatch' : String(row.status));
  return parts.join('; ');
}

// Lines for one exception: heading, category, counts, amounts and the differing fields.
export function exceptionLines(row, record = {}) {
  const files = record.files || [], base = Number.isInteger(record.baseIndex) ? record.baseIndex : 0;
  const counts = countList(row.counts), diffs = parse(row.diffs);
  const lines = [{ heading: exceptionText({ id: row.id, label: row.label }) }];
  lines.push(`Category: ${categoryText(row, files)}`);
  if (counts.length) lines.push(`Rows: ${counts.map((c, i) => `${letter(i)} ${c}`).join(' · ')}`);
  for (const a of Array.isArray(row.amounts) ? row.amounts : []) {
    if (Array.isArray(a.values) && a.values.length) lines.push(`${a.field || 'Amount'}: ${a.values.map((v, i) => `${letter(i)} ${isNum(v) ? money(v) : 'none'}`).join(' · ')}`);
  }
  if (diffs === null) lines.push('Differences: too long to show here; see the exported XLSX.');
  else if (diffs.length) {
    lines.push('Differences:');
    for (const d of diffs) {
      const from = Number.isInteger(d.table) ? base : 0, to = Number.isInteger(d.table) ? d.table : 1;
      const fmt = d.type === 'number' || d.field === 'amount' ? money : shown;
      lines.push({ bullet: `${d.field}: ${fmt(d.a)} → ${fmt(d.b)}${files.length > 2 ? ` (${letter(from)} vs ${letter(to)})` : ''}` });
    }
  }
  return lines;
}

const text = value => ({ type: 'text', text: value });
const paragraph = (...lines) => ({ type: 'paragraph', content: lines.flatMap((line, i) => i ? [{ type: 'hardBreak' }, text(line)] : [text(line)]) });

// description for one or many exceptions. rows: saved exception records. Returns an ADF document.
export function issueDescription({ record, rows, grouped }) {
  const files = record.files || [], header = [`Reconciliation run ${record.id}`];
  if (record.templateName) header.push(`Template: ${record.templateName}`);
  files.forEach((name, i) => header.push(`Source ${letter(i)}: ${name}`));
  header.push(grouped || rows.length > 1 ? `${plural(rows.length, 'exception')} (grouped in this issue)` : `${plural(rows.length, 'exception')}`);
  const content = [paragraph(...header)];
  let used = header.join('\n').length, omitted = 0;
  rows.forEach((row, n) => {
    const lines = exceptionLines(row, record);
    const size = lines.reduce((s, l) => s + (typeof l === 'string' ? l : l.heading || l.bullet).length, 0);
    if (used + size > MAX_TEXT) { omitted = rows.length - n; return; }
    used += size;
    const [title, ...rest] = lines;
    content.push({ type: 'heading', attrs: { level: 4 }, content: [text(title.heading)] });
    const plain = rest.filter(l => typeof l === 'string' || l.bullet === undefined), bullets = rest.filter(l => l.bullet !== undefined);
    // Keep the original line order: plain lines first (the "Differences:" label is last of them), then the bullets.
    content.push(paragraph(...plain));
    if (bullets.length) content.push({ type: 'bulletList', content: bullets.map(b => ({ type: 'listItem', content: [{ type: 'paragraph', content: [text(b.bullet)] }] })) });
  });
  if (omitted) content.push(paragraph(`… and ${plural(omitted, 'more exception')} not shown. Export the XLSX for the full list.`));
  return { type: 'doc', version: 1, content };
}

export function issueSummary({ rows, row, grouped, record }) {
  if (grouped) return `Reconcile: ${plural(rows.length, 'exception')} (grouped)`.slice(0, 250);
  return `Reconcile: ${exceptionText({ id: row.id, label: row.label })} — ${categoryText(row, record?.files)}`.slice(0, 250);
}

// Plain text of an ADF document, used by tests and previews.
export function adfText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text;
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content || []).map(adfText);
  return ['paragraph', 'heading', 'listItem'].includes(node.type) ? inner.join('') + '\n' : inner.join('');
}
