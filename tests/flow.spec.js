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

  // --- Edit a habit, keeping the card ---
  await page.click('.deck-grid .pcard');
  await page.waitForSelector('.detail-card');
  step('detail reason line:', await page.locator('.card .stat-line').nth(1).textContent());
  await page.click('[data-nav^="/edit/"]');
  await page.waitForSelector('#ed-title');
  await page.fill('#ed-title', 'Sport renommé');
  await page.click('[data-theme="lecture"]');
  await page.waitForSelector('#ed-title');
  await page.click('#ed-save');
  await page.waitForFunction(() => location.hash.startsWith('#/habit/'), { timeout: 6000 });
  await page.waitForTimeout(400);
  step('after edit, title:', await page.locator('#topbar-title').textContent());
  step('history preserved (card still present):', await page.locator('.detail-card .pcard').count());

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('TEST_FAILED', e.message); process.exit(1); });
