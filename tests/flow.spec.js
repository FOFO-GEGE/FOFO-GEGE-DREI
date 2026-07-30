const { chromium } = require('playwright');
const BASE = process.env.MIRROIR_TEST_BASE || 'http://localhost:8811';

(async () => {
  const browser = await chromium.launch(process.env.MIRROIR_CHROME ? { executablePath: process.env.MIRROIR_CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const step = (...a) => console.log('  ', ...a);

  await page.goto(BASE);
  await page.evaluate(() => localStorage.setItem('mirroir_onboarded', '1'));
  await page.reload();
  await page.waitForSelector('.auth-wrap');

  await page.click('button[data-mode="signup"]');
  await page.fill('#auth-pseudo', 'win' + Date.now());
  await page.fill('#auth-password', 'goodpass1');
  await page.click('#auth-submit');
  await page.waitForSelector('.tabbar');
  step('signed in');

  // Create a habit whose window is open right now (reminder = a few min ago)
  const past = new Date(Date.now() - 10 * 60000);
  const hhmm = `${String(past.getHours()).padStart(2, '0')}:${String(past.getMinutes()).padStart(2, '0')}`;
  await page.click('[data-nav="/new"]');
  await page.waitForSelector('.creator');
  await page.click('[data-theme="sport"]');
  await page.waitForSelector('.suggestions');
  await page.locator('.suggestion').first().click();
  await page.click('#nh-next');
  await page.waitForSelector('.day-picker');
  await page.click('#nh-next');
  await page.waitForSelector('#nh-time');
  await page.fill('#nh-time', hhmm);
  await page.click('#nh-next');
  await page.waitForFunction(() => location.hash === '#/home');
  step('habit created with reminder', hhmm, '(window open, ~50 min left)');

  // --- Countdown on Today ---
  await page.click('[data-nav="/today"]');
  await page.waitForSelector('.ritual-intro');
  step('heading:', (await page.locator('.ritual-intro h3').textContent()).trim());
  step('deadline banner:', (await page.locator('.deadline-banner').textContent()).trim().replace(/\s+/g, ' '));
  step('per-item countdown:', await page.locator('.rp-left').first().textContent());

  // --- Calendar shows "pas encore fait" ---
  await page.click('[data-nav="/history"]');
  await page.waitForSelector('.cal-legend');
  step('legend entries:', (await page.locator('.cal-legend-item').allTextContents()).join(' | '));
  step('created cells:', await page.locator('.cal-day.created').count());

  // --- Ritual: countdown chip, then failure -> reason picker ---
  await page.click('[data-nav="/today"]');
  await page.waitForSelector('.ritual-intro');
  await page.click('#start-ritual');
  await page.waitForSelector('.ritual-title');
  step('ritual countdown chip:', (await page.locator('.countdown').textContent()).trim().replace(/\s+/g, ' '));

  await page.click('.ritual-btn.is-no');
  await page.waitForSelector('.reason-grid', { timeout: 4000 });
  step('reason step reached, options:', (await page.locator('.reason-chip').allTextContents()).join(', '));
  await page.locator('.reason-chip').first().click();

  await page.waitForSelector('.summary-tallies', { timeout: 5000 });
  await page.waitForTimeout(1100); // let the count-up settle
  step('summary broken:', await page.locator('.tally.is-broken .n').textContent());

  // reason recorded?
  const reason = await page.evaluate(() => store.checks.find(c => c.status === 'failed')?.reason);
  step('reason persisted on check:', reason);

  await page.click('#ritual-done');
  await page.waitForSelector('.mirror-ring');
  step('score after failure:', await page.locator('.mirror-num').textContent());

  // --- Sync queue drained ---
  const sync = await page.evaluate(() => ({ state: store.sync, queued: JSON.parse(localStorage.getItem('mirroir_write_queue') || '[]').length }));
  step('sync state:', sync.state, '| queued ops left:', sync.queued);

  // --- Card focus: tap brings it forward, tap again repositions it ---
  await page.click('.deck-grid .pcard');
  await page.waitForSelector('.card-focus-backdrop.show', { timeout: 4000 });
  step('card focus opened:', await page.locator('.card-focus-stage .pcard').count());
  await page.click('.card-focus-backdrop');
  await page.waitForSelector('.card-focus-backdrop', { state: 'detached', timeout: 4000 });
  step('card focus closed after re-click (repositioned)');

  // --- Reopen and go to the detail screen from inside the focused view ---
  await page.click('.deck-grid .pcard');
  await page.waitForSelector('.card-focus-backdrop.show');
  await page.click('#card-focus-open');
  await page.waitForSelector('.detail-card');
  step('detail reason line:', await page.locator('.card .stat-line').nth(1).textContent());
  step('no edit button present:', await page.locator('[data-nav^="/edit/"]').count(), '(expect 0)');

  // --- Abandon it: card must survive, greyed, in the cemetery ---
  await page.click('#delete-habit');
  await page.waitForSelector('.modal-sheet');
  await page.click('#sheet-delete');
  await page.waitForFunction(() => location.hash === '#/home');
  await page.waitForTimeout(300);
  step('deck size after abandon:', await page.locator('section.deck .pcard').count(), '(expect 0 — an empty-state renders instead)');
  await page.click('#cemetery-toggle');
  await page.waitForSelector('#cemetery-grid:not([hidden])');
  step('cemetery cards:', await page.locator('.cemetery-grid .pcard.is-dead').count());
  step('death stamp:', await page.locator('.cemetery-grid .pcard-xp-dead').textContent());

  // --- Calendar day now shows the stamped, still-visible failure ---
  await page.click('[data-nav="/history"]');
  await page.waitForSelector('.cal-legend');
  await page.click('.cal-day.failed');
  await page.waitForSelector('.day-sheet');
  step('day sheet status:', await page.locator('.day-row-status').first().textContent());
  step('day sheet reason:', await page.locator('.day-row-reason').textContent());
  await page.click('#day-close');

  // --- "Ce que tu n'as pas tenu" survives the abandon ---
  await page.click('[data-nav="/home"]');
  await page.waitForSelector('.failures', { timeout: 4000 });
  step('failure row present after abandon:', await page.locator('.failure-row.is-buried').count());

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('TEST_FAILED', e.message); process.exit(1); });
