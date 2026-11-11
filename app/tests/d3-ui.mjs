import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const hint = 'Restored from your last session. Please re-check sources and worksheets, or click Reset.';
const button = name => page.getByRole('button', { name, exact: true });
const autoHint = "Sources were auto-selected from this issue's attachments. Please re-check sources and worksheets, or click Reset.";
const settle = async () => {
  await button('Load selected sources').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Load selected sources' && !b.disabled));
};
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.route('**/mock-bridge.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('setTimeout(resolve, 80)', "setTimeout(resolve, 250)") });
  });
  await page.goto('http://127.0.0.1:4178/?three-tables'); await settle();
  await page.getByLabel('Worksheet B', { exact: true }).waitFor();
  await page.locator('.sources').getByText(autoHint, { exact: true }).waitFor();
  await button('Load selected sources').click();
  assert.equal(await page.getByText(autoHint, { exact: true }).count(), 0); await settle();
  // Clear only the test browser's saved session to exercise auto-selection again.
  await page.evaluate(() => sessionStorage.clear()); await page.reload(); await settle();
  await page.getByText(autoHint, { exact: true }).waitFor();
  // Reset is the same as a first open: sources are chosen again from the attachments and the auto-selection hint is shown again.
  await button('Reset').click(); await settle();
  await page.getByText(autoHint, { exact: true }).waitFor();
  for (const [letter, id] of [['A', '0'], ['B', '1'], ['C', '2']]) assert.equal(await page.getByLabel(`Source ${letter}`, { exact: true }).inputValue(), id);
  await page.evaluate(() => sessionStorage.clear()); await page.reload(); await settle();
  await page.getByText(autoHint, { exact: true }).waitFor();
  const meta = page.locator('.file-meta').nth(1).locator(':scope > span');
  for (let i = 0; i < 10; i++) {
    const sheet = i % 2 ? 'Transactions' : 'Read me';
    await page.evaluate(() => {
      window.d3Seen = [];
      const region = document.querySelectorAll('.file-meta')[1];
      window.d3Observer = new MutationObserver(() => window.d3Seen.push(region.querySelector(':scope > span').textContent));
      window.d3Observer.observe(region, { subtree: true, childList: true, characterData: true });
    });
    await page.getByLabel('Worksheet B', { exact: true }).selectOption(sheet);
    assert.equal(await meta.innerText(), 'Loading…');
    assert.equal(await button('Confirm column mapping').isDisabled(), true);
    assert.equal(await page.locator('.run-bar button').isDisabled(), true);
    await settle();
    const correct = new RegExp(`^${i % 2 ? 6 : 1} rows ·`);
    assert.match(await meta.innerText(), correct);
    const seen = await page.evaluate(() => { window.d3Observer.disconnect(); return window.d3Seen; });
    assert.ok(seen.includes('Loading…'));
    assert.ok(seen.every(value => value === 'Loading…' || correct.test(value)), JSON.stringify(seen));
    assert.equal(await page.getByLabel('Worksheet B', { exact: true }).inputValue(), sheet);
  }
  // Session from actual UI persistence, restored after deliberately delayed bootstrap/load.
  await page.reload(); await page.getByText(hint, { exact: true }).waitFor(); await settle();
  assert.equal(await page.locator('.sources').getByText(hint, { exact: true }).isVisible(), true);
  await button('Load selected sources').click();
  assert.equal(await page.getByText(hint, { exact: true }).count(), 0); await settle();
  await page.reload(); await page.getByText(hint, { exact: true }).waitFor(); await settle();
  await button('Reset').click(); await settle();
  assert.equal(await page.getByText(hint, { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Source B', { exact: true }).inputValue(), '1');
  assert.deepEqual(errors, []);
  console.log('D3 UI passed: auto-selection hint and both dismissals; 10 alternating worksheet switches, loading labels/actions, delayed session restore, reload dismissal, Reset returns to the first-open state.');
} finally { await browser.close(); }
