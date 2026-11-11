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

Keys are compared case-insensitively and shown in lowercase in the panel (e.g. PAY-501 appears as pay-501).

The report page is created in the same space as the target page, at the same level (not as a child page); generating again reuses the same report page.

XLSX files default to the worksheet with the most parsed data rows; check the worksheet and row count before confirming the mapping. A selected sheet with at most one data row shows a warning. Mapping confirmation and reconciliation are disabled during loading; a worksheet change requires mapping confirmation again. **Reset** clears sources, worksheets, mappings and results. Restored session sources/mappings show a reminder to re-check A/B/C and worksheets, and require confirmation again. Session recovery is limited to this browser tab and excludes local uploads.

Add an optional **Run annotation** before running, or edit it after completion and click **Save run annotation** to save it to that run with an audit event. Annotation changes do not change comparison evidence signatures. Save before generating a report: existing Confluence reports keep their generated snapshot when reused.
