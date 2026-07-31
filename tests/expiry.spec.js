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
  await page.fill('#auth-pseudo', 'exp' + Date.now());
  await page.fill('#auth-password', 'goodpass1');
  await page.click('#auth-submit');
  await page.waitForSelector('.tabbar');

  // Reminder 20 min ago -> window open, ~40 min left
  const t = new Date(Date.now() - 20 * 60000);
  const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  await page.click('[data-nav="/new"]');
  await page.waitForSelector('.creator');
  await page.click('[data-theme="sommeil"]');
  await page.waitForSelector('.suggestions');
  await page.locator('.suggestion').first().click();
  await page.click('#nh-next');
  await page.waitForSelector('.day-picker');
  await page.click('#nh-next');
  await page.waitForSelector('#nh-time');
  await page.fill('#nh-time', hhmm);
  await page.click('#nh-next');
  await page.waitForFunction(() => location.hash === '#/home');
  step('created, reminder', hhmm);

  let s = await page.evaluate(() => ({
    status: store.checks[0].status,
    left: minutesLeft(store.checks[0]),
    expired: isExpired(store.checks[0]),
  }));
  step('before expiry ->', JSON.stringify(s));

  // Push the habit's reminder back 2h so the window is now closed, then
  // reconcile: silence must become a failure and break the streak.
  // reminder_time is a bare time-of-day, reinterpreted against *today's*
  // date — if "-2h" crosses midnight (a run starting between 00:00 and
  // 02:00), the stored time would read as later today, i.e. still open,
  // inverting the scenario. Clamp to just after midnight instead.
  await page.evaluate(async () => {
    const h = store.habits[0];
    h.current_streak = 5;
    const now = new Date();
    let d = new Date(now.getTime() - 2 * 3600000);
    if (d.getDate() !== now.getDate() || d.getMonth() !== now.getMonth()) {
      d = new Date(now); d.setHours(0, 1, 0, 0);
    }
    h.reminder_time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    await reconcileToday();
  });

  s = await page.evaluate(() => ({
    status: store.checks[0].status,
    expiredFlag: store.checks[0].expired === true,
    streak: store.habits[0].current_streak,
    queued: JSON.parse(localStorage.getItem('mirroir_write_queue') || '[]').length,
  }));
  step('after window closed ->', JSON.stringify(s));

  // No new check should be opened for an already-closed window
  const opened = await page.evaluate(async () => {
    store.checks.length = 0;
    await reconcileToday();
    return store.checks.length;
  });
  step('checks opened for an already-closed window:', opened, '(expect 0)');

  await page.evaluate(() => { location.hash = '#/today'; });
  await page.waitForTimeout(600);
  step('today screen:', (await page.locator('.empty-rich h3').first().textContent()).trim());

  await page.evaluate(() => { location.hash = '#/history'; });
  await page.waitForSelector('.cal-legend');
  step('failed cells in calendar:', await page.locator('.cal-day.failed').count());

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('TEST_FAILED', e.message); process.exit(1); });
