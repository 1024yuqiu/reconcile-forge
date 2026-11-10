export function makeDemo() {
  const rows = Array.from({ length: 300 }, (_, i) => ({ 'Order ID': `AP-${String(i + 1).padStart(4, '0')}`, Amount: ((12500 + i * 137) / 100).toFixed(2), Date: `2026-10-${String(i % 28 + 1).padStart(2, '0')}`, Department: ['Operations', 'Supply', 'Services'][i % 3] }));
  const bank = rows.map((r, i) => ({ ...r, Amount: i < 18 ? (Number(r.Amount) + 12.5).toFixed(2) : r.Amount, 'Order ID': i >= 280 && i < 290 ? `BANK-${i}` : r['Order ID'] }));
  rows[299] = { ...rows[298] }; bank[299] = { ...bank[298] };
  const file = (name, data) => ({ name, headers: Object.keys(data[0]), rows: data, sheet: 'Transactions', sheets: ['Transactions'], rowNumbers: data.map((_, i) => i + 2) });
  return [file('ap-ledger.xlsx', rows), file('bank-statement.xlsx', bank)];
}
