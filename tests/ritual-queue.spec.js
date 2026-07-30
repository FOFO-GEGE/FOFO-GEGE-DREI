// The ritual queue: sorted by urgency (not creation order), windows that
// haven't opened yet excluded from the forced sequence, "Plus tard" to
// requeue without a verdict, and Aujourd'hui's preview list as an entry
// point. Regression coverage for the bug this fixes: the ritual used to take
// pendingToday() as-is, so it could block on a promise not due yet while
// another expired behind it.
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
  await page.fill('#auth-pseudo', 'rit' + Date.now());
  await page.fill('#auth-password', 'goodpass1');
  await page.click('#auth-submit');
  await page.waitForSelector('.tabbar');

  const createHabit = async (theme, minutesAgo) => {
    const t = new Date(Date.now() - minutesAgo * 60000);
    const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    await page.click('[data-nav="/new"]');
    await page.waitForSelector('.creator');
    await page.click(`[data-theme="${theme}"]`);
    await page.waitForSelector('.suggestions');
    await page.locator('.suggestion').first().click();
    await page.click('#nh-next');
    await page.waitForSelector('.day-picker');
    await page.click('#nh-next');
    await page.waitForSelector('#nh-time');
    await page.fill('#nh-time', hhmm);
    await page.click('#nh-next');
    await page.waitForFunction(() => location.hash === '#/home');
  };

  // Created in an order that is the OPPOSITE of urgency: the last one created
  // (sport) has the least time left, so a fix that sorted by anything but
  // urgency would present them in the wrong order.
  await createHabit('lecture', 5);   // opened 5 min ago -> 55 min left
  await createHabit('sommeil', 40);  // opened 40 min ago -> 20 min left
  await createHabit('sport', 55);   // opened 55 min ago -> 5 min left (most urgent)
  step('created 3 habits, least urgent first, most urgent last');

  // A 4th, not due today at all -> must never enter the forced sequence.
  await page.click('[data-nav="/new"]');
  await page.waitForSelector('.creator');
  await page.click('[data-theme="argent"]');
  await page.waitForSelector('.suggestions');
  await page.locator('.suggestion').first().click();
  await page.click('#nh-next');
  await page.waitForSelector('.day-picker');
  await page.click(`[data-day="${new Date().getDay()}"]`); // deselect today
  await page.click('#nh-next');
  await page.waitForSelector('#nh-time');
  await page.click('#nh-next');
  await page.waitForFunction(() => location.hash === '#/home');
  step('created a 4th habit not due today (must stay out of the deck entirely)');

  // A 5th, due today but its reminder hasn't opened yet -> visible on
  // Aujourd'hui, waiting, but excluded from the ritual's active queue.
  await page.click('[data-nav="/new"]');
  await page.waitForSelector('.creator');
  await page.click('[data-theme="travail"]');
  await page.waitForSelector('.suggestions');
  await page.locator('.suggestion').first().click();
  await page.click('#nh-next');
  await page.waitForSelector('.day-picker');
  await page.click('#nh-next');
  await page.waitForSelector('#nh-time');
  const future = new Date(Date.now() + 3 * 3600000);
  await page.fill('#nh-time', `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`);
  await page.click('#nh-next');
  await page.waitForFunction(() => location.hash === '#/home');
  step('created a 5th habit due today but not open for 3 more hours');

  // --- Aujourd'hui: sorted by urgency, the not-yet-open one shows as waiting ---
  await page.click('[data-nav="/today"]');
  await page.waitForSelector('.ritual-preview');
  const order = await page.locator('.ritual-preview .rp-title').allTextContents();
  step('preview order (most urgent first):', order.join(' | '));
  const clickable = await page.locator('.ritual-preview li.rp-clickable').count();
  step('clickable (open) entries:', clickable, '(expect 3 — the 4th habit is not due, the 5th is not open yet)');
  if (clickable !== 3) throw new Error(`expected 3 clickable preview entries, got ${clickable}`);

  const waitingCount = await page.locator('.ritual-preview .rp-left.is-waiting').count();
  step('waiting (not-yet-open) entries shown:', waitingCount, '(expect 1)');
  if (waitingCount !== 1) throw new Error(`expected exactly 1 waiting entry, got ${waitingCount}`);

  // --- Clicking a specific open entry starts the ritual there, not at the
  // most urgent one — an entry point, distinct from the generic start button ---
  const targetTitle = order[1]; // the middle one, deliberately not the most urgent
  await page.locator('.ritual-preview li.rp-clickable', { hasText: targetTitle }).click();
  await page.waitForSelector('.ritual-title');
  const enteredAt = (await page.locator('.ritual-title').textContent()).trim();
  step('entered the ritual via the preview list at:', enteredAt, '(expect:', targetTitle, ')');
  if (enteredAt !== targetTitle) throw new Error(`clicking a preview entry did not start the ritual there: got "${enteredAt}"`);
  await page.click('#ritual-quit');
  await page.waitForFunction(() => location.hash === '#/today');

  // --- The ritual itself only ever holds the 3 open promises, most urgent first ---
  await page.click('#start-ritual');
  await page.waitForSelector('.ritual-title');
  const firstTitle = (await page.locator('.ritual-title').textContent()).trim();
  step('first card in the ritual:', firstTitle, '(expect the sport habit — 5 min left, most urgent)');
  const dotsTotal = await page.locator('.ritual-progress span').count();
  step('progress dots:', dotsTotal, '(expect 3 — the not-yet-open and not-due habits are excluded)');
  if (dotsTotal !== 3) throw new Error(`ritual queue should only ever hold the 3 open promises, got ${dotsTotal} dots`);

  // --- "Plus tard": no verdict, goes to the back, no penalty ---
  await page.click('#ritual-later');
  await page.waitForTimeout(150);
  const secondTitle = (await page.locator('.ritual-title').textContent()).trim();
  step('after "Plus tard", now showing:', secondTitle, '(expect a different habit)');
  if (secondTitle === firstTitle) throw new Error('"Plus tard" did not move to a different promise');
  const stillCreated = await page.evaluate(t => store.checks.find(c => {
    const h = store.habits.find(x => x.id === c.habit_id);
    return h && h.title === t;
  })?.status, firstTitle);
  step('deferred promise still unanswered:', stillCreated, '(expect "created" — no verdict was recorded)');
  if (stillCreated !== 'created') throw new Error('"Plus tard" recorded a verdict, it should not have');

  // Answer the two remaining, then the deferred one must resurface last.
  await page.click('.ritual-btn.is-yes');
  await page.waitForTimeout(700);
  await page.click('.ritual-btn.is-yes');
  await page.waitForTimeout(700);
  const lastTitle = (await page.locator('.ritual-title').textContent()).trim();
  step('third and final card:', lastTitle, '(expect the deferred one, back at the front of the empty queue)');
  if (lastTitle !== firstTitle) throw new Error('the deferred promise did not resurface');

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('TEST_FAILED', e.message); process.exit(1); });
