// Ported from the read-only B-工具 engine: integer cents, calendar days and key-indexed comparison.
export const STATUSES = ['matched', 'mismatch', 'only-a', 'only-b', 'duplicate'];
export const DEFAULT_RULES = { amountTolerance: '0.01', percentTolerance: 0, dateTolerance: 1, trim: true, caseFold: true, fullWidth: true };
export const MAX_ROWS = 50000;

export function normalize(value, rules = DEFAULT_RULES) {
  let text = String(value ?? '');
  if (rules.fullWidth) text = text.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/\u3000/g, ' ');
  if (rules.trim) text = text.trim();
  if (rules.caseFold) text = text.toLowerCase();
  if (rules.ignorePunctuation) text = text.replace(/[\p{P}\p{S}]/gu, '');
  if (rules.leadingZeros) text = text.replace(/^0+(?=\d)/, '');
  return text;
}

export function guessMapping(headers) {
  const find = pattern => headers.find(h => pattern.test(h)) || '';
  return { keys: [find(/order.?id|reference|invoice|订单|交易.*号|单据号|^单号$|编号|^id$/i) || headers[0]], amount: find(/amount|^amt$|total|金额|实收|实付/i), date: find(/date|日期|时间/i), compare: [] };
}

export function amountInCents(value) {
  const clean = normalize(value, { trim: true, fullWidth: true }).replace(/\s/g, '');
  const signed = /^\(.+\)$/.test(clean) ? '-' + clean.slice(1, -1) : clean;
  const text = signed.replace(/^([+-]?)[¥￥$€£]/, '$1');
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text.replace(/,/g, '')) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function dateInDays(value) {
  if (value instanceof Date) return Math.floor(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) / 86400000);
  if (typeof value === 'number' && value > 0 && value < 100000) return Math.floor(value) - 25569;
  const text = String(value ?? '').trim();
  if (/^\d{5}(\.\d+)?$/.test(text) && Number(text) < 100000) return Math.floor(Number(text)) - 25569;
  let match = text.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})(?:日|\b|T)/);
  if (!match) {
    const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (us) match = [us[0], us[3].length === 2 ? '20' + us[3] : us[3], us[1], us[2]];
  }
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.getTime() / 86400000 : null;
}

export function validateRules(input) {
  const rules = { ...DEFAULT_RULES, ...input };
  const cents = amountInCents(rules.amountTolerance);
  const percent = Number(rules.percentTolerance), days = Number(rules.dateTolerance);
  if (cents === null || cents < 0 || !Number.isFinite(percent) || percent < 0 || percent > 100 || !Number.isInteger(days) || days < 0 || days > 365) throw new Error('Use nonnegative amount tolerance, 0–100 percent and 0–365 whole days.');
  return { ...rules, cents, percent, days };
}

export function normalizeRows(file, mapping, rules) {
  if (!file.rows.length || file.rows.length > MAX_ROWS) throw new Error(`Each sheet must contain 1–${MAX_ROWS.toLocaleString('en-US')} rows. Split larger exports.`);
  if (!mapping.keys?.length || new Set(mapping.keys).size !== mapping.keys.length || [...mapping.keys, mapping.amount, mapping.date, ...(mapping.compare || [])].filter(Boolean).some(h => !file.headers.includes(h))) throw new Error('Select valid, distinct key columns and mapped fields.');
  return file.rows.map((raw, i) => {
    const row = file.rowNumbers?.[i] ?? i + 2;
    const parts = mapping.keys.map(h => normalize(raw[h], rules));
    const amount = mapping.amount ? amountInCents(raw[mapping.amount]) : null;
    const date = mapping.date ? dateInDays(raw[mapping.date]) : null;
    if (parts.some(p => !p) || (mapping.amount && amount === null) || (mapping.date && date === null)) throw new Error(`${file.name}, row ${row}: empty key, invalid amount or invalid date. Correct the data or mapping.`);
    return { key: JSON.stringify(parts), label: parts.join(' / '), amount, date, values: (mapping.compare || []).map(h => normalize(raw[h], rules)), raw, row };
  });
}

export function reconcile(fileA, fileB, mappings, inputRules = DEFAULT_RULES) {
  const rules = validateRules(inputRules);
  const [ma, mb] = mappings;
  if (ma.keys.length !== mb.keys.length || Boolean(ma.amount) !== Boolean(mb.amount) || Boolean(ma.date) !== Boolean(mb.date) || (ma.compare || []).length !== (mb.compare || []).length) throw new Error('Both tables need the same number and kinds of mapped fields.');
  const a = normalizeRows(fileA, ma, rules), b = normalizeRows(fileB, mb, rules);
  const groups = new Map();
  for (const [side, rows] of [['a', a], ['b', b]]) for (const row of rows) {
    if (!groups.has(row.key)) groups.set(row.key, { a: [], b: [] });
    groups.get(row.key)[side].push(row);
  }
  const results = [];
  for (const [key, group] of groups) {
    const left = group.a[0] || null, right = group.b[0] || null;
    const diffs = [];
    let status;
    if (group.a.length > 1 || group.b.length > 1) status = 'duplicate';
    else if (!left) status = 'only-b';
    else if (!right) status = 'only-a';
    else {
      if (ma.amount && Math.abs(left.amount - right.amount) > Math.max(rules.cents, Math.abs(left.amount) * rules.percent / 100) + 1e-7) diffs.push({ field: 'amount', a: left.amount / 100, b: right.amount / 100 });
      if (ma.date && Math.abs(left.date - right.date) > rules.days) diffs.push({ field: 'date', a: left.raw[ma.date], b: right.raw[mb.date] });
      left.values.forEach((v, i) => { if (v !== right.values[i]) diffs.push({ field: ma.compare[i], a: left.raw[ma.compare[i]], b: right.raw[mb.compare[i]] }); });
      status = diffs.length ? 'mismatch' : 'matched';
    }
    results.push({ id: String(results.length), key, label: (left || right).label, status, a: left, b: right, diffs, counts: { a: group.a.length, b: group.b.length }, duplicateRows: status === 'duplicate' ? group : undefined });
  }
  return { results, summary: Object.fromEntries(STATUSES.map(s => [s, results.filter(r => r.status === s).length])), inputRows: { a: a.length, b: b.length } };
}
