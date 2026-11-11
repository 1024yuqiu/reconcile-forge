# Domestic (Chinese) export examples

All rows and customer names are synthetic.

## Files

| File | Encoding | Purpose |
| --- | --- | --- |
| `domestic-clean.csv` | UTF-8 | Clean reference: `Order ID`, `Amount`, `Date` |
| `domestic-utf-8.csv` | UTF-8 | Chinese headers (单号 / 金额 / 日期 / 客户), full-width keys, yuan amounts, Chinese dates |
| `domestic-gbk.csv` | GBK | Same rows as `domestic-utf-8.csv` |
| `domestic-gb18030.csv` | GB18030 | Same rows, including real four-byte GB18030 characters |
| `utf-8.csv`, `gbk.csv`, `gb18030.csv` | as named | Older variant without the 元 suffix and with half-width Chinese dates |

The CSVs are intentionally not transcoded on disk; Reconcile detects UTF-8 and GBK/GB18030 automatically.

## Acceptance steps

1. Attach `domestic-clean.csv` as table A and `domestic-gbk.csv` (and optionally `domestic-gb18030.csv`) as the comparison tables.
2. Map the key: `Order ID` ↔ `单号`. Map the amount: `Amount` ↔ `金额` (numeric rule). Map the date: `Date` ↔ `日期`.
3. Enable **Normalize full-width keys** and **Ignore leading zeros in keys**, so `００１` matches `1`.
4. Run the reconciliation.

Expected result: all three synthetic rows match. The original evidence stays visible, for example `￥１，２３４．５０元`, `２０２６年１１月１０日`, the quoted `"¥2,000.00元"` and the accounting negative `(￥50.00元)`.

Keep CSV thousands separators quoted. An unquoted `2,000.00` is read as two columns, as with any CSV.
