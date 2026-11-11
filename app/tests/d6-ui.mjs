import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
const errors = [];
const typeHint = 'This project has no issue type named Task. Choose an issue type from the list.';
async function open(patch) {
  const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.route('**/mock-bridge.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: patch(await response.text()) }); });
  await page.goto('http://127.0.0.1:4178/?three-tables');
  return page;
}
const settle = async page => {
  await page.getByRole('button', { name: 'Load selected sources', exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Load selected sources' && !b.disabled));
};
const sources = (page, letters = ['A', 'B', 'C']) => Promise.all(letters.map(l => page.getByLabel(`Source ${l}`, { exact: true }).inputValue()));
try {
  // 1. Attachments listed in the reverse of the sample order are still selected as A ledger, B bank, C invoices.
  const reversed = await open(text => text.replace('size: 18000 }))', 'size: 18000 })).reverse()'));
  await settle(reversed);
  assert.deepEqual(await sources(reversed), ['0', '1', '2']);
  await reversed.close();

  // 2. Names that cannot be told apart are not auto-selected; the panel asks for manual A/B/C choices.
  const manual = await open(text => text.replace('name: f.name, size: 18000', "name: 'data' + i + '.csv', size: 18000"));
  const hint = 'This issue has 3 attachments, so sources were not auto-selected. Choose A / B / C manually (for the three-table sample: ledger as A), then click Load selected sources.';
  await manual.getByText(hint, { exact: true }).waitFor();
  assert.deepEqual(await sources(manual), ['', '', '']);
  await manual.getByRole('button', { name: 'Reset', exact: true }).click();
  await manual.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Reset' && !b.disabled));
  await manual.getByText(hint, { exact: true }).waitFor();
  assert.deepEqual(await sources(manual), ['', '', '']);
  await manual.getByLabel('Source A', { exact: true }).selectOption('0');
  await manual.getByLabel('Source B', { exact: true }).selectOption('1');
  await manual.getByRole('button', { name: 'Load selected sources', exact: true }).click(); await settle(manual);
  assert.equal(await manual.getByText(hint, { exact: true }).count(), 0);
  await manual.close();

  // 3. A project without a type named Task keeps the issue type empty and says so.
  const noTask = await open(text => text.replace("[{ id: '10001', name: 'Task' }]", "[{ id: '10001', name: 'Story' }, { id: '10002', name: 'Bug' }]"));
  await settle(noTask);
  await noTask.getByLabel('Ignore leading zeros in keys', { exact: true }).check();
  await noTask.getByLabel('Aggregate C', { exact: true }).check();
  await noTask.getByRole('button', { name: 'Confirm column mapping', exact: true }).click();
  await noTask.getByRole('button', { name: 'Run reconciliation', exact: true }).click();
  await noTask.locator('.metrics').waitFor();
  await noTask.getByRole('button', { name: 'Load project issue types', exact: true }).click(); await settle(noTask);
  const select = noTask.locator('select', { has: noTask.locator('option', { hasText: 'Choose an issue type' }) });
  assert.equal(await select.inputValue(), '');
  await noTask.getByText(typeHint, { exact: true }).waitFor();
  assert.equal(await noTask.getByRole('button', { name: 'Review issue creation', exact: true }).isDisabled(), true);
  await select.selectOption('10002');
  assert.equal(await select.inputValue(), '10002');
  await noTask.close();
  assert.deepEqual(errors, []);
  console.log('D6 UI passed: ledger/bank/invoices selection independent of attachment order; ambiguous names ask for manual A/B/C; missing Task leaves the issue type empty with a notice.');
} finally { await browser.close(); }
