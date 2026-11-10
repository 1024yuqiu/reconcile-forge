import { amountInCents, dateInDays, normalize, DEFAULT_RULES, MAX_ROWS } from './reconcile.js';

export const PASSES = ['Exact key', 'Key + tolerance', 'Aggregated', 'Possible match'];
export const SYNONYMS = {
  key: ['orderid', 'order', 'reference', 'invoice', 'invoiceid', '订单号', '订单编号', '订单', '单号', '单据号', '交易号', '编号', 'id'],
  amount: ['amount', 'amt', 'total', '金额', '实收', '实付', '收款金额', '支付金额'],
  date: ['date', 'paymentdate', '日期', '时间', '交易日期'],
  customer: ['customer', 'client', '客户', '客户名称', '客户名'],
  description: ['description', 'memo', '备注', '摘要']
};
const columnName = value => normalize(value).replace(/[\s_\-]/g, '');
export function semantic(header) { return Object.keys(SYNONYMS).find(k => SYNONYMS[k].includes(columnName(header))) || columnName(header); }
export function suggestFields(files, baseIndex = 0) {
  const keys = files.map(f => [f.headers.find(h => semantic(h) === 'key') || f.headers[0]]);
  const fields = files[baseIndex].headers.filter(h => !keys[baseIndex].includes(h)).map((h, i) => {
    const kind = semantic(h);
    return { id: `field-${i}`, name: kind === 'amount' || kind === 'date' || kind === 'customer' ? kind : h,
      type: kind === 'amount' ? 'number' : kind === 'date' ? 'date' : 'text', columns: files.map(f => f.headers.find(v => semantic(v) === kind) || ''),
      abs: '0.01', percent: 0, days: 1, formats: 'YYYY-MM-DD,YYYY/MM/DD,YYYY年MM月DD日,MM/DD/YYYY', trim: true, caseFold: true, fullWidth: true, ignorePunctuation: false };
  });
  return { keys, fields };
}

export function configuredDate(value, formats) {
  if (value instanceof Date || typeof value === 'number') return dateInDays(value);
  if (!formats?.trim()) return dateInDays(value);
  for (const format of formats.split(',').map(v => v.trim())) {
    const tokens = [];
    const pattern = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/YYYY|MM|DD/g, token => { tokens.push(token); return token === 'YYYY' ? '(\\d{4})' : '(\\d{1,2})'; });
    const match = String(value ?? '').trim().match(new RegExp(`^${pattern}$`));
    if (match && tokens.includes('YYYY') && tokens.includes('MM') && tokens.includes('DD')) {
      const parts = Object.fromEntries(tokens.map((t, i) => [t, match[i + 1]]));
      return dateInDays(`${parts.YYYY}-${parts.MM}-${parts.DD}`);
    }
  }
  return null;
}

export function validateConfig(files, input) {
  if (!Array.isArray(files) || files.length < 2 || files.length > 5) throw new Error('Select 2–5 tables.');
  const config = { baseIndex: 0, keyRules: { ...DEFAULT_RULES, leadingZeros: false }, aggregate: files.map(() => false), acceptedPairs: [], ...input };
  if (!Number.isInteger(config.baseIndex) || config.baseIndex < 0 || config.baseIndex >= files.length || config.keys?.length !== files.length || !Array.isArray(config.fields) || config.fields.length > 50) throw new Error('Select a base table, keys and up to 50 fields.');
  const ids = new Set();
  config.fields = config.fields.map(field => {
    if (!field.id || ids.has(field.id) || !['exact', 'number', 'date', 'text', 'ignore'].includes(field.type) || field.columns?.length !== files.length) throw new Error('Each rule needs a unique ID, type and column per table.');
    ids.add(field.id);
    const f = { ...field, cents: amountInCents(field.abs ?? '0'), percent: Number(field.percent ?? 0), days: Number(field.days ?? 0) };
    if (f.type === 'number' && (f.cents === null || f.cents < 0 || !Number.isFinite(f.percent) || f.percent < 0 || f.percent > 100)) throw new Error('Number rules need a nonnegative absolute tolerance and 0–100 percent.');
    if (f.type === 'date' && (!Number.isInteger(f.days) || f.days < 0 || f.days > 365)) throw new Error('Date tolerance must be 0–365 whole days.');
    if (f.type === 'date' && f.formats && f.formats.split(',').some(v => !/^(?=.*YYYY)(?=.*MM)(?=.*DD)[YMD\s/年日月.\-]+$/.test(v.trim()))) throw new Error('Use comma-separated date formats with YYYY, MM and DD.');
    return f;
  });
  files.forEach((file, t) => {
    if (!file.rows.length || file.rows.length > MAX_ROWS) throw new Error(`Each table needs 1–${MAX_ROWS.toLocaleString('en-US')} rows.`);
    if (!config.keys[t]?.length || config.keys[t].length !== config.keys[0].length || new Set(config.keys[t]).size !== config.keys[t].length || config.keys[t].some(h => !file.headers.includes(h))) throw new Error('Map the same number of distinct key columns in every table.');
    for (const f of config.fields.filter(f => f.type !== 'ignore')) if (!file.headers.includes(f.columns[t])) throw new Error(`Map ${f.name} in table ${t + 1}, or ignore that field.`);
  });
  if (config.acceptedPairs.length > 100) throw new Error('Accept at most 100 possible matches per run.');
  return config;
}

function fieldValue(raw, f, t, location) {
  const value = raw[f.columns[t]];
  const parsed = f.type === 'number' ? amountInCents(value) : f.type === 'date' ? configuredDate(value, f.formats) : f.type === 'text' ? normalize(value, f) : String(value ?? '');
  if (parsed === null) throw new Error(`${location}: invalid ${f.type} in ${f.columns[t]}. Correct the value or rule.`);
  return parsed;
}
// Object property order is not evidence; arrays retain table, field and row order.
export function stableStringify(value) {
  return JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
export function exceptionSignature(row) {
  return stableStringify([row.key, row.status, row.counts, row.diffs, row.entries.map(e => e ? e.components.map(c => c.values) : null)]);
}
export function applyReviewed(run, reviews = []) {
  const bySignature = new Map(reviews.map(r => [r.signature, r]));
  return { ...run, results: run.results.map(row => ({ ...row, review: bySignature.get(exceptionSignature(row)) || null })) };
}

export function reconcileTables(files, input) {
  const config = validateConfig(files, input), base = config.baseIndex;
  const fields = config.fields.filter(f => f.type !== 'ignore');
  const tables = files.map((file, t) => {
    const groups = new Map();
    file.rows.forEach((raw, i) => {
      const parts = config.keys[t].map(h => normalize(raw[h], config.keyRules));
      const row = file.rowNumbers?.[i] ?? i + (file.headerRow || 1) + 1;
      if (parts.some(p => !p)) throw new Error(`${file.name}, row ${row}: empty key.`);
      let key = JSON.stringify(parts);
      const accepted = config.acceptedPairs.find(p => p.table === t && p.from === key);
      if (accepted) key = accepted.to;
      const entry = { key, label: parts.join(' / '), raw, row, values: Object.fromEntries(fields.map(f => [f.id, fieldValue(raw, f, t, `${file.name}, row ${row}`)])), accepted: Boolean(accepted) };
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
    return groups;
  });
  for (const p of config.acceptedPairs) {
    if (p.table === base || !tables[base].has(p.to) || tables[p.table]?.get(p.to)?.filter(e => e.accepted).length !== 1 || tables[p.table].get(p.to).length !== 1) throw new Error('Possible match conflicts with an existing key. Reload and review the pair.');
  }
  const results = [], keys = new Set(tables.flatMap(g => [...g.keys()]));
  for (const key of keys) {
    const groups = tables.map(g => g.get(key) || []);
    const entries = groups.map((rows, t) => {
      if (!rows.length) return null;
      const values = { ...rows[0].values }, conflicts = [];
      if (config.aggregate[t] && rows.length > 1) for (const f of fields) {
        if (f.type === 'number') { values[f.id] = rows.reduce((s, r) => s + r.values[f.id], 0); if (!Number.isSafeInteger(values[f.id])) throw new Error('Aggregated amount exceeds safe integer cents.'); }
        else if (rows.some(r => r.values[f.id] !== values[f.id])) conflicts.push(f.name);
      }
      return { ...rows[0], values, components: rows, conflicts };
    });
    const diffs = [], pairs = [];
    for (let t = 0; t < files.length; t++) if (t !== base) {
      const a = entries[base], b = entries[t], changes = [];
      let status, tolerant = false;
      if ([base, t].some(n => groups[n].length > 1 && (!config.aggregate[n] || entries[n].conflicts.length))) status = 'duplicate';
      else if (!a && !b) status = 'absent';
      else if (!a) status = 'only-b';
      else if (!b) status = 'only-a';
      else {
        for (const f of fields) {
          const av = a.values[f.id], bv = b.values[f.id], delta = f.type === 'number' ? (bv - av) / 100 : f.type === 'date' ? bv - av : null;
          const same = av === bv, within = f.type === 'number' ? Math.abs(bv - av) <= Math.max(f.cents, Math.abs(av) * f.percent / 100) + 1e-7 : f.type === 'date' ? Math.abs(bv - av) <= f.days : same;
          if (!within) changes.push({ field: f.name, fieldId: f.id, type: f.type, table: t, a: f.type === 'number' ? av / 100 : a.raw[f.columns[base]], b: f.type === 'number' ? bv / 100 : b.raw[f.columns[t]], delta, column: f.columns[t], baseColumn: f.columns[base] });
          if (!same && within) tolerant = true;
        }
        status = changes.length ? 'mismatch' : 'matched';
      }
      const aggregated = [base, t].some(n => config.aggregate[n] && groups[n].length > 1);
      const pass = entries[t]?.accepted ? 'Possible match (accepted)' : status === 'matched' ? aggregated ? PASSES[2] : tolerant ? PASSES[1] : PASSES[0] : aggregated ? 'Aggregated — review' : 'Unmatched';
      pairs.push({ table: t, status, diffs: changes, pass }); diffs.push(...changes);
    }
    const statuses = pairs.map(p => p.status);
    const status = statuses.includes('duplicate') ? 'duplicate' : statuses.includes('mismatch') ? 'mismatch' : statuses.some(s => s === 'only-a' || s === 'only-b') ? entries[base] ? 'only-a' : 'only-b' : 'matched';
    const pass = pairs.map(p => p.pass).filter((p, i, all) => all.indexOf(p) === i).join(' / ');
    results.push({ id: String(results.length), key, label: (entries[base] || entries.find(Boolean)).label, status, entries, pairs, diffs, pass, counts: groups.map(g => g.length), presence: entries.map(Boolean) });
  }
  const summary = Object.fromEntries(['matched', 'mismatch', 'only-a', 'only-b', 'duplicate'].map(s => [s, results.filter(r => r.status === s).length]));
  const reasonSummary = { missing: results.filter(r => r.pairs.some(p => ['only-a', 'only-b'].includes(p.status))).length, amount: results.filter(r => r.diffs.some(d => d.type === 'number')).length, date: results.filter(r => r.diffs.some(d => d.type === 'date')).length, text: results.filter(r => r.diffs.some(d => ['text', 'exact'].includes(d.type))).length, duplicate: summary.duplicate };
  const run = { version: 3, results, summary, reasonSummary, inputRows: files.map(f => f.rows.length), baseIndex: base, config: input, tableNames: files.map(f => f.name) };
  run.statements = reconciliationStatements(run, fields.find(f => f.type === 'number'));
  run.suggestions = suggestNearMisses(run, fields);
  return run;
}

function reconciliationStatements(run, amount) {
  if (!amount) return [];
  const base = run.baseIndex;
  return run.tableNames.flatMap((name, t) => {
    if (t === base) return [];
    const total = n => run.results.reduce((s, r) => s + (r.entries[n]?.components.reduce((v, c) => v + c.values[amount.id], 0) || 0), 0);
    const onlyBase = run.results.filter(r => r.entries[base] && !r.entries[t]);
    const onlyOther = run.results.filter(r => !r.entries[base] && r.entries[t]);
    const sum = (rows, n) => rows.reduce((s, r) => s + r.entries[n].components.reduce((v, c) => v + c.values[amount.id], 0), 0);
    const baseTotal = total(base), otherTotal = total(t), baseOnly = sum(onlyBase, base), otherOnly = sum(onlyOther, t), adjusted = baseTotal - baseOnly + otherOnly;
    return [{ table: t, name, field: amount.name, baseTotal: baseTotal / 100, otherTotal: otherTotal / 100, baseOnly: baseOnly / 100, otherOnly: otherOnly / 100, adjusted: adjusted / 100, residual: (otherTotal - adjusted) / 100, balances: adjusted === otherTotal, onlyBase: onlyBase.map(r => r.label), onlyOther: onlyOther.map(r => r.label) }];
  });
}

export function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...next) > 2) return 3;
    previous = next;
  }
  return previous[b.length];
}
export function suggestNearMisses(run, fields) {
  const suggestions = [], base = run.baseIndex, amount = fields.find(f => f.type === 'number'), date = fields.find(f => f.type === 'date');
  let checks = 0;
  for (let t = 0; t < run.tableNames.length; t++) if (t !== base) {
    const left = run.results.filter(r => r.entries[base] && !r.entries[t] && r.counts[base] === 1);
    const right = run.results.filter(r => !r.entries[base] && r.entries[t] && r.counts[t] === 1);
    for (const a of left) for (const b of right) {
      if (++checks > 20000 || suggestions.length >= 100) return { pairs: suggestions, bounded: true, checks: checks - 1 };
      const av = a.entries[base].values, bv = b.entries[t].values;
      const sameValue = amount && date && Math.abs(av[amount.id] - bv[amount.id]) <= Math.max(amount.cents, Math.abs(av[amount.id]) * amount.percent / 100) && Math.abs(av[date.id] - bv[date.id]) <= date.days;
      const distance = a.label.length <= 100 && b.label.length <= 100 ? editDistance(a.label, b.label) : 3;
      if (distance <= 2 || sameValue) suggestions.push({ table: t, from: b.key, to: a.key, baseLabel: a.label, otherLabel: b.label, reason: distance <= 2 ? `Key edit distance ${distance}` : 'Same amount + date within tolerance' });
    }
  }
  return { pairs: suggestions, bounded: false, checks };
}
