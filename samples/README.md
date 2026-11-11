# Large synthetic fixtures (not the judge three-table sample)

For the judge workflow, use [examples/three-tables](../examples/three-tables/), not this folder. This is a separate, larger two-table dataset.

300 data rows per source; no real companies or transactions. Default rules: 270 matched keys, 18 value mismatches, 10 only A, 10 only B, one duplicate group with two source rows per side. Counts are keys, not rows.

Use phase3-ledger.csv and phase3-bank.xlsx for the historical large-fixture live test. Regenerate using `cd app` then `node scripts/phase4-samples.js`. XLSX ZIP timestamps can differ, but parsed cells and file size reproduce the live generator.

The original ap-ledger and bank-statement fixtures are also synthetic and have the same counts. Regenerate those with `npm run samples`. See the generators for this dataset’s mappings and tolerances.
