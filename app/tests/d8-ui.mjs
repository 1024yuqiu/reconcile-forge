// 4.1.5 / 4.1.6 UI checks: session restore keeps the two checkboxes and the confirmed mapping, and (4.1.6) shows the result again by itself. Needs the mock preview server:
// npm run preview (http://127.0.0.1:4178), then RECONCILE_BROWSER=edge node tests/d8-ui.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ ...(process.env.RECONCILE_BROWSER === 'edge' ? { channel: 'msedge' } : {}), headless: true });
const problems = [];
const SESSION = 'Restored from your last session. Please re-check sources and worksheets, or click Reset.';
const AUTO_NOTICE = /shown for review only\. No new run was saved/;
const RECHECK = 'This older session did not store the checkboxes, so "Ignore leading zeros in keys" and "Aggregate" were reset. Please re-check them.';
const button = (page, name) => page.getByRole('button', { name, exact: true });
const settle = page => page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Load selected sources' && !b.disabled));
const zeros = page => page.getByLabel('Ignore leading zeros in keys', { exact: true });
const aggC = page => page.getByLabel('Aggregate C', { exact: true });
const page = await browser.newPage(); page.setDefaultTimeout(20000);
page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !(m.text().startsWith('Failed to load resource') && (m.location().url || '').endsWith('/favicon.ico'))) problems.push(`console.${m.type()}: ${m.text()}`); });
page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
try {
  await page.goto('http://127.0.0.1:4178/?three-tables'); await settle(page);
  await zeros(page).check(); await aggC(page).check();
  await button(page, 'Confirm column mapping').click(); await button(page, 'Run reconciliation').click();
  await page.locator('.metrics').waitFor();
  const before = await page.locator('.metrics').innerText();

  // Refresh: restored, checkboxes still on, mapping still confirmed, Run available without Confirm.
  await page.reload(); await settle(page);
  await page.getByText(SESSION, { exact: true }).waitFor();
  assert.equal(await zeros(page).isChecked(), true);
  assert.equal(await aggC(page).isChecked(), true);
  assert.equal(await page.getByLabel('Aggregate A', { exact: true }).isChecked(), false);
  assert.equal(await button(page, 'Confirm column mapping').isDisabled(), true); // already confirmed
  assert.equal(await button(page, 'Run reconciliation').isEnabled(), true);
  assert.equal(await page.getByText(RECHECK, { exact: true }).count(), 0);
  // 4.1.6: no click on Run -> the counts appear by themselves, identical to before the refresh, and no run record is created.
  await page.locator('.metrics').waitFor();
  assert.equal(await page.locator('.metrics').innerText(), before);
  await page.getByText(AUTO_NOTICE).waitFor();
  assert.equal(await page.getByLabel('Run audit and report').count(), 0); // display only: not saved as a run
  // A manual Run still works and gives the same counts (and saves a run record: the audit card appears).
  await button(page, 'Run reconciliation').click();
  await page.getByLabel('Run audit and report').waitFor();
  assert.equal(await page.locator('.metrics').innerText(), before);

  // Changing a checkbox after restore needs a new confirmation (as always), and that state is restored too.
  await zeros(page).uncheck();
  assert.equal(await button(page, 'Run reconciliation').isDisabled(), true);
  await page.reload(); await settle(page);
  assert.equal(await zeros(page).isChecked(), false); assert.equal(await aggC(page).isChecked(), true);
  assert.equal(await button(page, 'Run reconciliation').isDisabled(), true); // unconfirmed stays unconfirmed
  assert.equal(await page.locator('.metrics').count(), 0); // and no automatic result

  // An older session record (no options / confirmed fields): defaults, a re-check line, confirmation required.
  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('reconcile-session:'));
    const record = JSON.parse(sessionStorage.getItem(key)); delete record.options; delete record.mappingConfirmed;
    record.config.keyRules.leadingZeros = true; record.config.aggregate = record.config.aggregate.map(() => true);
    sessionStorage.setItem(key, JSON.stringify(record));
  });
  await page.reload(); await settle(page);
  await page.getByText(SESSION, { exact: true }).waitFor();
  await page.getByText(RECHECK, { exact: true }).waitFor();
  assert.equal(await zeros(page).isChecked(), false); assert.equal(await aggC(page).isChecked(), false);
  assert.equal(await button(page, 'Run reconciliation').isDisabled(), true);
  assert.equal(await page.locator('.metrics').count(), 0); // older session: no automatic result

  // Reset clears both the line and the stored options.
  await button(page, 'Reset').click(); await settle(page);
  assert.equal(await page.getByText(RECHECK, { exact: true }).count(), 0);
  assert.equal(await zeros(page).isChecked(), false);
  assert.deepEqual(problems, []);
  console.log('D8 UI passed: checkboxes and confirmed mapping survive a refresh; Run works without re-confirming; counts match; older sessions use defaults with a re-check line.');
} finally { await browser.close(); }
