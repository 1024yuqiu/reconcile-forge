// 4.1.4 UI checks. Needs the mock preview server: npm run preview (http://127.0.0.1:4178), then node tests/d7-ui.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ ...(process.env.RECONCILE_BROWSER === 'edge' ? { channel: 'msedge' } : {}), headless: true });
const problems = [];
const HEADING = 'Your exports. One clear answer.';
const CHANGED = 'Attachments changed since your last session, so sources were re-checked.';
const AUTO = "Sources were auto-selected from this issue's attachments. Please re-check sources and worksheets, or click Reset.";
const SESSION = 'Restored from your last session. Please re-check sources and worksheets, or click Reset.';
const MANUAL = 'This issue has 3 attachments, so sources were not auto-selected. Choose A / B / C manually (for the three-table sample: ledger as A), then click Load selected sources.';
const ATTACH = "files.map((f, i) => ({ id: String(i), name: f.name, size: 18000 }))";
async function open(patch = text => text, url = 'http://127.0.0.1:4178/?three-tables') {
  const page = await browser.newPage(); page.setDefaultTimeout(20000);
  // Any uncaught error, console error or console warning (React key / controlled-input warnings) fails the run.
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.route('**/mock-bridge.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: patch(await response.text()) }); });
  await page.goto(url);
  return page;
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
const settle = page => page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Load selected sources' && !b.disabled));
const idle = page => page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Reset' && !b.disabled));
const values = (page, letters = ['A', 'B', 'C']) => Promise.all(letters.map(l => page.getByLabel(`Source ${l}`, { exact: true }).inputValue()));
const cards = page => page.locator('.card.source').count();
async function runAndSelect(page) {
  await settle(page);
  await page.getByLabel('Ignore leading zeros in keys', { exact: true }).check();
  await page.getByLabel('Aggregate C', { exact: true }).check();
  await button(page, 'Confirm column mapping').click(); await button(page, 'Run reconciliation').click();
  await page.locator('.metrics').waitFor();
  await button(page, 'Load project issue types').click(); await settle(page);
}
try {
  // 6 + 4. Loading state first; no default A/B cards before identification finishes; same heading before and after.
  const slow = await open(text => text.replace('setTimeout(resolve, 80)', "setTimeout(resolve, operation === 'bootstrap' ? 1200 : 80)"));
  await slow.getByText('Identifying attachments…', { exact: true }).waitFor();
  assert.equal(await slow.getByLabel('Source A', { exact: true }).count(), 0);
  assert.equal(await slow.getByLabel('Source B', { exact: true }).count(), 0);
  assert.equal(await slow.locator('h1').innerText(), HEADING);
  await settle(slow);
  assert.equal(await slow.getByText('Identifying attachments…').count(), 0);
  assert.equal(await slow.locator('h1').innerText(), HEADING);
  assert.deepEqual(await values(slow), ['0', '1', '2']);
  // 3. Reset returns to the first-open state: three cards, A/B/C selected, same heading.
  await button(slow, 'Remove table C').click(); assert.equal(await cards(slow), 2);
  await button(slow, 'Reset').click(); await settle(slow);
  assert.equal(await cards(slow), 3); assert.deepEqual(await values(slow), ['0', '1', '2']);
  await slow.getByText(AUTO, { exact: true }).waitFor();
  assert.equal(await slow.locator('h1').innerText(), HEADING);
  await slow.close();

  // 3. Unrecognizable names: manual hint and three empty cards, also after Reset (card C is not lost).
  const manual = await open(text => text.replace('name: f.name, size: 18000', "name: 'data' + i + '.csv', size: 18000"));
  await manual.getByText(MANUAL, { exact: true }).waitFor();
  assert.equal(await cards(manual), 3); assert.deepEqual(await values(manual), ['', '', '']);
  assert.equal(await manual.locator('h1').innerText(), HEADING);
  await manual.getByLabel('Source A', { exact: true }).selectOption('0'); await manual.getByLabel('Source B', { exact: true }).selectOption('1'); await manual.getByLabel('Source C', { exact: true }).selectOption('2');
  await button(manual, 'Reset').click(); await idle(manual);
  await manual.getByText(MANUAL, { exact: true }).waitFor();
  assert.equal(await cards(manual), 3); assert.deepEqual(await values(manual), ['', '', '']);
  assert.equal(await manual.locator('h1').innerText(), HEADING);
  await manual.close();

  // 1. Saved session versus attachments: unchanged restores; added / removed attachments re-check and say so.
  const flags = text => text.replace(ATTACH, "(() => { const list = " + ATTACH + "; if (localStorage.getItem('d7-extra')) list.push({ id: '9', name: 'extra.csv', size: 1 }); if (localStorage.getItem('d7-drop')) list.pop(); return list; })()");
  const page = await open(flags);
  await settle(page); await page.getByText(AUTO, { exact: true }).waitFor();
  await page.reload(); await settle(page);
  await page.getByText(SESSION, { exact: true }).waitFor();
  assert.equal(await page.getByText(CHANGED, { exact: true }).count(), 0);
  assert.deepEqual(await values(page), ['0', '1', '2']);
  // an attachment is added: four attachments cannot be told apart, so the manual hint appears with the changed line
  await page.evaluate(() => localStorage.setItem('d7-extra', '1')); await page.reload();
  await page.getByText(CHANGED, { exact: true }).waitFor();
  await page.getByText(MANUAL.replace('3 attachments', '4 attachments'), { exact: true }).waitFor();
  assert.equal(await page.getByText(SESSION, { exact: true }).count(), 0);
  assert.deepEqual(await values(page), ['', '', '']);
  // back to the three files, then one attachment removed: two remain, re-selected from the current attachments with the changed line
  await page.evaluate(() => { localStorage.removeItem('d7-extra'); sessionStorage.clear(); }); await page.reload(); await settle(page);
  await page.reload(); await page.getByText(SESSION, { exact: true }).waitFor();
  await page.evaluate(() => localStorage.setItem('d7-drop', '1')); await page.reload(); await settle(page);
  await page.getByText(CHANGED, { exact: true }).waitFor();
  assert.deepEqual(await values(page, ['A', 'B']), ['0', '1']);
  assert.equal(await page.getByText(SESSION, { exact: true }).count(), 0);
  await button(page, 'Reset').click(); await settle(page);
  assert.equal(await page.getByText(CHANGED, { exact: true }).count(), 0);
  await page.close();

  // 2 + 5. Confirmation wording, result next to the button and at the top, audit wording.
  const create = await open();
  await runAndSelect(create);
  const typeSelect = create.locator('select', { has: create.locator('option', { hasText: 'Choose an issue type' }) });
  assert.equal(await typeSelect.inputValue(), '10001');
  const boxes = create.getByRole('checkbox', { name: /^Select exception / });
  await create.getByRole('checkbox', { name: 'Select exception 3', exact: true }).check();
  const region = create.getByRole('region', { name: 'Confirm issue creation' });
  await button(create, 'Review issue creation').click();
  assert.match(await region.locator('p').innerText(), /^Create one grouped issue for Exception #2 \(key 3\) in \S+, type Task \(10001\)\?$/);
  let other = null;
  for (const box of await boxes.all()) if (!(await box.isChecked())) { other = box; break; }
  await other.check();
  await button(create, 'Review issue creation').click();
  assert.match(await region.locator('p').innerText(), /^Create one grouped issue for 2 exceptions: #\d+ \(key [^)]+\), #\d+ \(key [^)]+\) in \S+, type Task \(10001\)\?$/);
  await create.getByLabel('Group selected exceptions', { exact: true }).uncheck();
  await button(create, 'Review issue creation').click();
  assert.match(await region.locator('p').innerText(), /^Create 2 separate issues for 2 exceptions: .* type Task \(10001\)\?$/);
  await create.getByLabel('Group selected exceptions', { exact: true }).check();
  await other.uncheck();
  await button(create, 'Review issue creation').click(); await button(create, 'Confirm creation').click(); await idle(create);
  const inline = create.getByRole('status', { name: 'Issue creation result' });
  const text = await inline.innerText();
  assert.match(text, /^(Created|Reused) Issue: \S+$/);
  assert.equal(await create.getByText(text, { exact: true }).count(), 2); // top banner + beside the button
  assert.equal(await create.locator('.exceptions').getByText(text, { exact: true }).count(), 1);
  assert.doesNotMatch(await create.locator('main').innerText(), /Created: none|Reused: none/);
  await button(create, 'Load audit trail').click(); await idle(create);
  const confirmation = create.locator('.audit-events article').filter({ has: create.getByRole('heading', { name: 'issue-confirmation', exact: true }) }).last();
  assert.match(await confirmation.innerText(), /Selected exceptions: 1 · Exception #2 \(key 3\) · Confirmed: true · Grouped: true/);
  // Confirmation records the selection; the separate result event records the created/reused issue keys.
  const event = create.locator('.audit-events article').filter({ has: create.getByRole('heading', { name: 'issue-result', exact: true }) }).last();
  assert.ok((await event.innerText()).includes(text));
  assert.doesNotMatch(await event.innerText(), /Created:|Reused:/);
  await create.close();

  // 8. Old audit record (selectedIds only) renders "Exception IDs: #0".
  const old = await open(text => text.replace('return service[operation](context, payload);', "if (operation === 'auditRun') return { events: [{ event: 'issue-confirmation', when: '2026-01-01T00:00:00Z', who: 'old', selectedIds: [0], confirmed: true, grouped: true, project: 'KAN', issueType: '10003', created: ['KAN-9'], reused: [] }] };\n  return service[operation](context, payload);"));
  await runAndSelect(old);
  await button(old, 'Load audit trail').click(); await idle(old);
  assert.match(await old.locator('.audit-events').innerText(), /Selected exceptions: 1 · Exception IDs: #0 · Confirmed: true/);
  assert.match(await old.locator('.audit-events').innerText(), /Created Issue: KAN-9/);
  await old.close();

  assert.deepEqual(problems, []);
  console.log('D7 UI passed: Identifying attachments… first; one heading everywhere; Reset keeps three cards (recognized and manual); session restore vs added/removed attachments; confirmation wording; result beside the button; old audit "Exception IDs: #0"; no console errors, warnings or HTTP errors.');
} finally { await browser.close(); }
