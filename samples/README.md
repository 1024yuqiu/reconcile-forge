# Synthetic fixtures

300 rows per source; no real companies or transactions. Default rules: 270 matched keys, 18 value mismatches, 10 only A, 10 only B, one duplicate group with two source rows per side. Counts are keys, not rows.

Use phase3-ledger.csv and phase3-bank.xlsx for the exact live-test data and demo. Regenerate using `cd app` then `node scripts/phase4-samples.js`. XLSX ZIP timestamps can differ, but parsed cells and file size reproduce the live generator.

The original ap-ledger and bank-statement fixtures are also synthetic and have the same counts. Regenerate those with `npm run samples`. See ../JUDGE-INSTALL.md for mappings and tolerances.
