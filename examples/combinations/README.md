# Split the 5.01 difference

Use combo-payment.csv as A, combo-invoices.csv as B, and combo-ledger.csv as C: one mismatch, amount 305.01 versus 300.00, delta -5.01. Switch B to combo-invoices-split.csv and explicitly enable unique amount combinations: 300.00 + 5.01 = 305.01. One matched combination preserves all four source rows. Set B as base to demonstrate several invoice components against one payment. The algorithm also supports an invoice against multiple payment rows with the tables reversed.

Only unique bounded combinations are merged. Keep the option off for unrelated exports. The full amount, component keys and row numbers are shown in results and XLSX evidence.
