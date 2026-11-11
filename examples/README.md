# Synthetic acceptance examples

All rows and customer labels are invented.

## Three attached tables

`three-tables/ledger.csv`, `bank.xlsx` (Transactions sheet), and `invoices.csv` use `config.json`. Expected counts: 3 matched, 1 mismatch, 2 only in base, 2 missing from base, 0 duplicates. Key 3's row shows **Δ 5**; the **5.01** residual (5 plus Key 2's tolerated 0.01) is shown in the collapsible Reconciliation statement section. Components remain visible; no FX conversion is performed.

## Domestic exports

`domestic/utf-8.csv`, `gbk.csv`, and `gb18030.csv` contain identical synthetic rows: full-width keys and currency, quoted thousands separators, Chinese and slash-separated dates. Select matching key/amount/date columns and enable leading-zero normalization if comparing to unpadded keys. These CSVs are intentionally not transcoded on disk.

## Additional workflows

- `combinations/`: 305.01 versus 300.00, then unique 300.00 + 5.01 matching with component evidence.
- `mapping/`: High / Medium / Low mapping proposals requiring human confirmation.
- `closure/`: corrected data, server-verified evidence comment and manual Ready to close.
