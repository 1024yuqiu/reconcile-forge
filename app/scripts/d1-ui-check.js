import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
const browser = await chromium.launch({ ...(process.env.RECONCILE_BROWSER === 'edge' ? { channel: 'msedge' } : {}), headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage(); page.setDefaultTimeout(20000);
const errors = []; page.on('pageerror', e => errors.push(e.message));
const button = name => page.getByRole('button', { name, exact: true });
const settle = () => button('Load selected sources').isEnabled().then(async enabled => { if (!enabled) await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Load selected sources').disabled); });
try {
  // Hold bootstrap so the initial product label is observable before context resolves.
  await page.route('**/mock-bridge.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('setTimeout(resolve, 80)', 'setTimeout(resolve, operation === \'bootstrap\' ? 800 : 80)') }); });
  await page.route('**/mock-data/v3/*', async route => { await new Promise(r => setTimeout(r, 200)); await route.continue(); });
  await page.goto('http://127.0.0.1:4178/?three-tables');
  await page.getByText('Reconcile / Loading', { exact: true }).waitFor();
  assert.match(await page.locator('.environment').innerText(), /v4\.1\.5/);
  await button('Confirm column mapping').waitFor(); await settle();
  assert.equal(await page.getByLabel('Worksheet B', { exact: true }).inputValue(), 'Transactions');
  await button('Confirm column mapping').click();
  await page.getByLabel('Worksheet B', { exact: true }).selectOption('Read me');
  assert.equal(await button('Confirm column mapping').isDisabled(), true);
  assert.equal(await page.locator('.run-bar button').isDisabled(), true);
  await page.getByText('This sheet has almost no data rows — check the worksheet selection.', { exact: true }).waitFor();
  await settle();
  assert.equal(await button('Run reconciliation').isDisabled(), true);
  await page.getByLabel('Worksheet B', { exact: true }).selectOption('Transactions'); await settle();
  await button('Confirm column mapping').click();
  await button('Load selected sources').click();
  assert.equal(await button('Confirm column mapping').isDisabled(), true);
  assert.equal(await page.locator('.run-bar button').isDisabled(), true);
  await settle(); assert.equal(await button('Run reconciliation').isDisabled(), true);
  await button('Confirm column mapping').click();
  await button('Run reconciliation').click(); await page.locator('.metrics').waitFor();
  await page.getByLabel('Run annotation', { exact: true }).fill('Post-run annotation from component check');
  await button('Save run annotation').click();
  await page.getByText('Annotation: Post-run annotation from component check', { exact: true }).waitFor();
  await button('Load audit trail').click();
  await page.getByRole('heading', { name: 'annotation', exact: true }).waitFor();
  await page.reload(); await button('Confirm column mapping').waitFor(); await settle();
  await page.getByText('Restored from your last session. Please re-check sources and worksheets, or click Reset.', { exact: true }).waitFor();
  assert.equal(await button('Run reconciliation').isDisabled(), true);
  // Reset behaves like a first open: attachments are identified again, so the three sample files give A / B / C and three cards.
  await button('Reset').click(); await settle();
  for (const [letter, id] of [['A', '0'], ['B', '1'], ['C', '2']]) assert.equal(await page.getByLabel(`Source ${letter}`, { exact: true }).inputValue(), id);
  assert.equal(await page.locator('.card.source').count(), 3);
  await page.getByText("Sources were auto-selected from this issue's attachments. Please re-check sources and worksheets, or click Reset.", { exact: true }).waitFor();
  await button('Remove table C').click();
  assert.equal(await page.locator('.card.source').count(), 2);
  // Real Worker + checkbox + download + ExcelJS read-back using supplied domestic examples.
  await page.locator('input[type=file]').nth(0).setInputFiles('../examples/domestic/domestic-clean.csv');
  // Reset already loaded attachment metadata; wait for each local parse, not the old file-name element.
  await page.locator('.card.source').nth(0).getByText('domestic-clean.csv', { exact: true }).waitFor(); await settle();
  await page.locator('input[type=file]').nth(1).setInputFiles('../examples/domestic/domestic-gbk.csv');
  await page.locator('.card.source').nth(1).getByText('domestic-gbk.csv', { exact: true }).waitFor(); await settle();
  await button('Confirm column mapping').waitFor(); await settle();
  await page.getByLabel('Ignore leading zeros in keys', { exact: true }).check();
  await button('Confirm column mapping').click(); await button('Run reconciliation').click();
  await page.locator('.metrics').waitFor();
  assert.deepEqual(await page.locator('.metric strong').allTextContents(), ['3', '0', '0', '0', '0']);
  await page.getByLabel('Include original table layouts', { exact: true }).check();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export XLSX' }).click();
  const download = await pending; const book = new ExcelJS.Workbook(); await book.xlsx.readFile(await download.path());
  assert.equal(book.getWorksheet('Original 2').getCell('B2').value, '￥１，２３４．５０元');
  assert.equal(book.getWorksheet('Original 2').getCell('C2').value, '２０２６年１１月１０日');
  assert.deepEqual(['matched', 'mismatch', 'only-a', 'only-b', 'duplicate'].map(key => book.getWorksheet('Summary').getSheetValues().find(r => r?.[1] === key)?.[2]), [3, 0, 0, 0, 0]);
  assert.deepEqual(errors, []);
  console.log('D1 component checks passed: worksheet default/warning/loading guards, reload, annotation/audit, session restore, Reset, domestic checkbox XLSX round-trip (3/0/0/0/0).');
} finally { await browser.close(); }
