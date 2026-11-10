import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { mkdir, writeFile } from 'node:fs/promises';
import { makeDemo } from '../src/sample.js';
await mkdir('../samples', { recursive: true });
for (const file of makeDemo()) {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet(file.sheet);
  sheet.columns = file.headers.map(h => ({ header: h, key: h, width: 22 })); sheet.addRows(file.rows);
  await book.xlsx.writeFile(`../samples/${file.name}`);
  await writeFile(`../samples/${file.name.replace('.xlsx', '.csv')}`, '\uFEFF' + Papa.unparse(file.rows), 'utf8');
}
await writeFile('../samples/README.md', '# Synthetic fixtures\n\n300 rows per source. No real companies or transactions. Expected counts (default rules): 270 matched keys, 18 value mismatches, 10 only in A, 10 only in B, 1 duplicate key (two rows on each side). Counts are keys, not input rows.\n\nGenerated deterministically by `npm run samples` in app/.\n');
console.log('Generated two XLSX and two UTF-8 BOM CSV fixtures (300 rows each).');
