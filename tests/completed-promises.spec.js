// A promise with a fixed end date (a one-day commitment, or any finite run)
// retires on its own once that date has passed — a natural completion, not
// a death. It must never go through the vitality fold, never trigger the
// death-notice dialog, and never land in the cemetery's abandoned/neglect
// framing — it gets its own "Terminées" section, coloured by whether it was,
// on the whole, kept.
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
  await page.fill('#auth-pseudo', 'fin' + Date.now());
  await page.fill('#auth-password', 'goodpass1');
  await page.click('#auth-submit');
  await page.waitForSelector('.tabbar');

  // --- habitCard() as a pure function: finished/kept vs finished/broken,
  // and neither ever picks up the dead card's greyscale or fissures ---
  const pureCases = await page.evaluate(() => {
    const habit = { id: 'x', title: 'Test', theme: 'sport', start_date: '2024-01-01' };
    const kept = habitCard(habit, { rate: 100, daysAlive: 1, streak: 0, best: 0, kept: 1, total: 1, vitalityState: 'pleine' },
      { compact: true, finished: true, finishedDate: '01/01' });
    const broken = habitCard(habit, { rate: 0, daysAlive: 1, streak: 0, best: 0, kept: 0, total: 1, vitalityState: 'pleine' },
      { compact: true, finished: true, finishedDate: '01/01' });
    return {
      keptHasTimeDone: kept.includes('time-done'),
      keptHasKeptLabel: kept.includes('pcard-xp-kept'),
      keptHasDeadClass: kept.includes('is-dead'),
      brokenHasTimeBroken: broken.includes('time-broken'),
      brokenHasBrokenLabel: broken.includes('pcard-xp-broken'),
      brokenHasDeadClass: broken.includes('is-dead'),
    };
  });
  step('pure habitCard() finished cases:', JSON.stringify(pureCases));
  if (!pureCases.keptHasTimeDone || !pureCases.keptHasKeptLabel) throw new Error('a mostly-kept finished card should read time-done / pcard-xp-kept');
  if (pureCases.keptHasDeadClass || pureCases.brokenHasDeadClass) throw new Error('a finished card must never carry the dead card\'s is-dead class');
  if (!pureCases.brokenHasTimeBroken || !pureCases.brokenHasBrokenLabel) throw new Error('a mostly-broken finished card should read time-broken / pcard-xp-broken');

  // --- End to end: a habit whose end_date has already passed retires on the
  // next reconcile, kept out of the vitality fold and the death notice ---
  await page.click('[data-nav="/new"]');
  await page.waitForSelector('.creator');
  await page.click('[data-theme="sport"]');
  await page.waitForSelector('.suggestions');
  await page.locator('.suggestion').first().click();
  await page.click('#nh-next');
  await page.waitForSelector('.day-picker');
  await page.click('#nh-next');
  await page.waitForSelector('#nh-time');
  await page.click('#nh-next');
  await page.waitForFunction(() => location.hash === '#/home');
  step('created a habit for the one-day scenario');

  const outcome = await page.evaluate(async () => {
    const h = store.habits[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    h.end_date = yesterday;
    // A kept day in its past, so the finished card reads gold, not red.
    store.checks.push({ id: crypto.randomUUID(), habit_id: h.id, date: yesterday, status: 'success', expired: false });
    await reconcileToday();
    const retired = store.cemetery.find(x => x.id === h.id);
    return {
      stillInDeck: store.habits.some(x => x.id === h.id),
      retiredActive: retired ? retired.active : null,
      deathCause: retired ? retired.death_cause : null,
      deathAnnounced: retired ? retired.death_announced : null,
      unannounced: unannouncedDeaths().some(x => x.id === h.id),
    };
  });
  step('after end_date passed and reconcileToday():', JSON.stringify(outcome));
  if (outcome.stillInDeck) throw new Error('a habit whose end date has passed must leave the active deck');
  if (outcome.deathCause !== 'completed') throw new Error(`expected death_cause "completed", got ${outcome.deathCause}`);
  if (outcome.retiredActive !== false) throw new Error('a completed habit must be active:false');
  if (!outcome.deathAnnounced) throw new Error('a completed habit should not need a death notice — death_announced must already be true');
  if (outcome.unannounced) throw new Error('a natural completion must never surface through the death-notice path (unannouncedDeaths only looks at neglect)');

  // --- Mon miroir: "Terminées", not "Cimetière" ---
  await page.evaluate(() => { location.hash = '#/home'; renderRoute(); });
  await page.waitForSelector('.finished-toggle', { timeout: 4000 });
  step('cemetery section absent for a purely-completed run:', await page.locator('.cemetery').count(), '(expect 0)');
  if (await page.locator('.cemetery').count() !== 0) throw new Error('a naturally completed promise must not appear under Cimetière');

  await page.click('#finished-toggle');
  await page.waitForSelector('#finished-grid:not([hidden])');
  const finishedCardClass = await page.evaluate(() => document.querySelector('.finished-grid .pcard').className);
  step('finished card class:', finishedCardClass);
  if (!finishedCardClass.includes('time-done')) throw new Error(`expected the kept finished card to be time-done, got: ${finishedCardClass}`);
  if (finishedCardClass.includes('is-dead')) throw new Error('a finished card must not look like a dead one');

  // --- Detail screen: "Terminée" framing, no abandon/reminder/resurrect ---
  const habitId = await page.evaluate(() => store.cemetery[0].id);
  await page.evaluate(id => { location.hash = '#/habit/' + id; }, habitId);
  await page.waitForSelector('.detail-card');
  step('no reminder-time row on a finished promise:', await page.locator('#edit-reminder-time').count(), '(expect 0)');
  step('no abandon button on a finished promise:', await page.locator('#delete-habit').count(), '(expect 0)');
  step('no resurrect button on a finished promise:', await page.locator('#resurrect-habit').count(), '(expect 0)');
  if (await page.locator('#edit-reminder-time, #delete-habit, #resurrect-habit').count() !== 0) {
    throw new Error('a finished promise should offer none of the live/dead-specific actions');
  }
  step('detail stat line mentions the natural end:', (await page.locator('.card .stat-line').last().textContent()).trim());

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('TEST_FAILED', e.message); process.exit(1); });
