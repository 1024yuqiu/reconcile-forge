# Synthetic v3 acceptance set

Select ledger.csv as A/base, bank.xlsx as B (Transactions sheet), invoices.csv as C. Enable Ignore leading zeros in keys and Aggregate C. Save the template if testing reviewed carry-over. Every header is on source row 3. The bank has two sheets; its first is deliberately a readable instruction sheet, so Reconcile now selects Transactions automatically because it has more data rows. Check that selection, confirm the column mapping, then run.

Expected rows: 6 ledger, 6 bank, 7 invoices. Unique key union: 8. Counts: 3 matched (1,2,5), 1 mismatch (3), 2 only in base / incomplete across comparisons (4,6), 2 missing from base (7,8), 0 duplicates. Key 1 aggregates 40+60=100. Key 2 bank amount delta 0.01 and date delta 1 are within tolerance. Key 3 bank amount delta 5 fails. Key 4 is absent from bank; key 5 is absent from neither (matched); key 6 is absent from invoices. See expected.json for exact counts, presence flags, passes and statement totals.

No suggestion is accepted in the expected counts. Statement and pair sheets show missing keys per comparison, even when the overall category is mismatch or missing elsewhere. Use config.json for the exact template settings.

XLSX files default to the worksheet with the most parsed data rows; check the worksheet and row count before confirming the mapping. A selected sheet with at most one data row shows a warning. Mapping confirmation and reconciliation are disabled during loading; a worksheet change requires mapping confirmation again. **Reset** clears sources, worksheets, mappings and results. Restored session sources/mappings show a reminder to re-check A/B/C and worksheets, and require confirmation again. Session recovery is limited to this browser tab and excludes local uploads.

Keys are compared case-insensitively and shown in lowercase in the panel (e.g. PAY-501 appears as pay-501).

Add an optional **Run annotation** before running, or edit it after completion and click **Save run annotation** to save it to that run with an audit event. Annotation changes do not change comparison evidence signatures. Save before generating a report: existing Confluence reports keep their generated snapshot when reused.
