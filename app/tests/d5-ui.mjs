import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const button = name => page.getByRole('button', { name, exact: true });
const settle = async () => {
  await button('Load selected sources').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Load selected sources' && !b.disabled));
};
try {
  await page.goto('http://127.0.0.1:4178/?three-tables'); await settle();
  await button('Add table').click();
  await page.getByLabel('Source C', { exact: true }).selectOption('2');
  await button('Load selected sources').click(); await settle();
  await page.getByLabel('Ignore leading zeros in keys', { exact: true }).check();
  await page.getByLabel('Aggregate C', { exact: true }).check();
  await button('Confirm column mapping').click(); await button('Run reconciliation').click();
  await page.locator('.metrics').waitFor();
  assert.deepEqual(await page.locator('.metric strong').allTextContents(), ['3', '1', '2', '2', '0']);
  const before = await page.locator('.results').innerText();
  const name = page.getByLabel('Template name', { exact: true });
  await name.fill('D5 preserved run');
  assert.equal(await page.locator('.results').innerText(), before);
  await button('Save template').click();
  await page.getByText('Template saved for this project or space.', { exact: true }).waitFor(); await settle();
  assert.equal(await page.locator('.results').innerText(), before);
  await page.getByLabel('Saved template', { exact: true }).selectOption('D5 preserved run'); await settle();
  assert.equal(await page.locator('.results').count(), 0);
  await button('Run reconciliation').click(); await page.locator('.metrics').waitFor();
  await page.getByLabel('Issue type ID', { exact: true }).fill('10001');
  const boxes = page.getByRole('checkbox', { name: /^Select exception / });
  const single = page.getByRole('checkbox', { name: 'Select exception 3', exact: true });
  for (const grouped of [true, false]) {
    if (grouped) await page.getByLabel('Group selected exceptions', { exact: true }).check();
    else await page.getByLabel('Group selected exceptions', { exact: true }).uncheck();
    for (const count of [1, 3]) {
      for (const box of await boxes.all()) await box.uncheck();
      await single.check();
      if (count === 3) for (const box of await boxes.all()) {
        if (await box.isChecked()) continue;
        await box.check();
        if ((await page.locator('.exceptions p').first().innerText()).startsWith('3 selected')) break;
      }
      await button('Review issue creation').click(); await button('Confirm creation').click(); await settle();
      await button('Load audit trail').click(); await settle();
      const event = page.locator('.audit-events article').filter({ has: page.getByRole('heading', { name: 'issue-confirmation', exact: true }) }).last();
      assert.match(await event.innerText(), new RegExp(`Selected exceptions: ${count} · Exception IDs:`));
      assert.match(await event.innerText(), new RegExp(`Grouped: ${grouped}`));
    }
  }
  assert.deepEqual(errors, []);
  console.log('D5 UI passed: real three-table counts; result preserved through rename/save; saved template selectable; grouped and individual audit counts 1/3, including key 3 (internal ID 2).');
} finally { await browser.close(); }
