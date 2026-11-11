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
