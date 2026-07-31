// Configurable answer window: a duration chosen at creation drives the
// deadline and the card's green->red body colour, replacing the old fixed
// one-hour window. Answering is allowed at any time before that deadline —
// no longer gated by the reminder time itself, which now only sets where the
// range (and the countdown colour) starts.
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

  // --- rangeElapsed() as a pure function: the fraction that drives the
  // hue, independent of any UI. Reminder times are expressed relative to
  // "now" the same way the rest of the suite does. ---
  const table = await page.evaluate(() => {
    const today = todayStr();
    const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const justOpened = { reminder_time: hhmm(new Date()), window_minutes: 60 };
    const almostOver = { reminder_time: hhmm(new Date(Date.now() - 55 * 60000)), window_minutes: 60 };
    const notOpenYet = { reminder_time: hhmm(new Date(Date.now() + 30 * 60000)), window_minutes: 60 };
    const pastDeadline = { reminder_time: hhmm(new Date(Date.now() - 90 * 60000)), window_minutes: 60 };
    return {
      justOpened: rangeElapsed(justOpened, today),
      almostOver: rangeElapsed(almostOver, today),
      notOpenYet: rangeElapsed(notOpenYet, today),
      pastDeadline: rangeElapsed(pastDeadline, today),
    };
  });
  step('rangeElapsed:', JSON.stringify(table));
  if (!(table.justOpened <= 0.05)) throw new Error(`expected ~0 just after opening, got ${table.justOpened}`);
  if (!(table.almostOver >= 0.85)) throw new Error(`expected close to 1 near the deadline, got ${table.almostOver}`);
  // Answering early must never read as urgent — clamped to 0, not negative.
  if (table.notOpenYet !== 0) throw new Error(`expected exactly 0 before the range opens, got ${table.notOpenYet}`);
  if (table.pastDeadline !== 1) throw new Error(`expected exactly 1 past the deadline, got ${table.pastDeadline}`);
  step('green->red fraction is 0 before the range opens and clamps at 1 past the deadline: OK');

  // --- End to end: a habit due today but not open for another 2h (would
  // have been "waiting" and unanswerable before this chantier), created with
  // a 30-minute range instead of the 60-minute default ---
  const future = new Date(Date.now() + 2 * 3600000);
  const hhmm = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
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
  await page.click('[data-window="30"]');
  await page.click('#nh-next');
  await page.waitForFunction(() => location.hash === '#/home');
  step('created with reminder', hhmm, '(2h out) and a 30-min range');

  const stored = await page.evaluate(() => store.habits[0].window_minutes);
  step('window_minutes stored:', stored, '(expect 30)');
  if (stored !== 30) throw new Error(`expected window_minutes 30, got ${stored}`);

  // Answerable right now even though the reminder is 2h out — tapping the
  // tab drops straight into the story on this card, no button needed.
  await page.click('[data-nav="/today"]');
  await page.waitForSelector('.ritual-card .pcard', { timeout: 4000 });
  step('story opened the promise even though its reminder time is 2h out: OK');
  await page.click('.ritual-btn.is-yes');
  await page.waitForTimeout(700);
  step('answered "Fait" ahead of the reminder time with no error');

  // Only one promise was pending, so the ritual moves straight to its
  // summary screen (chrome-less, like the rest of the ritual) — leave it via
  // its own button rather than the tabbar, which isn't rendered there.
  await page.waitForSelector('.summary-tallies');
  await page.click('#ritual-done');
  await page.waitForFunction(() => location.hash === '#/home');

  // The card settles gold ("fait") for the rest of the day, not the
  // green->red pending colour.
  await page.waitForSelector('.deck-grid .pcard');
  const doneCount = await page.locator('.deck-grid .pcard.time-done').count();
  const pendingCount = await page.locator('.deck-grid .pcard.time-pending').count();
  step('gold "done" cards:', doneCount, '| still-pending cards:', pendingCount, '(expect 1 / 0)');
  if (doneCount !== 1 || pendingCount !== 0) throw new Error('card did not settle to the gold "done" state after being answered "fait"');

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('TEST_FAILED', e.message); process.exit(1); });
