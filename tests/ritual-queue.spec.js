// Aujourd'hui is no longer a screen that leads into a separate ritual behind
// a button — it IS the ritual: tapping the tab drops straight into a full-
// screen, one-card-at-a-time story. This covers: promises sorted by urgency
// (regression coverage for a real bug — it used to take pendingToday() as-is,
// so it could block on a promise not due yet while another expired behind
// it), a promise not due today excluded entirely, "Décaler" pushing a card's
// real deadline later today without ever making its colour band look less
// urgent, decided cards trailing behind the still-pending ones and staying
// browsable (prev/next) once everything pending is resolved, and no numeric
// "X restantes" counter anywhere on screen. Also covers "Décaler" reopening
// an already-failed day (declared "pas fait" or silently ignored) in place —
// same-day only, reminder_time untouched — while a kept or frozen day offers
// no such button at all.
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

  // Navigate to the story (Aujourd'hui is no longer a tab, use hash directly).
  const freshVisitToday = async () => {
    await page.evaluate(() => { todayCursorHabitId = null; location.hash = '#/today'; renderRoute(); });
    await page.waitForSelector('.rs-story');
  };

  // Tap left/right zones to move between story cards.
  // Use locator-based clicks (force:true) so they work on decided cards too
  // (no .ritual-actions overlay, different layout — coordinate clicks miss).
  const tapNext = async () => {
    await page.locator('.rs-story-tap-next').click({ force: true });
    await page.waitForTimeout(150);
  };
  const tapPrev = async () => {
    await page.locator('.rs-story-tap-prev').click({ force: true });
    await page.waitForTimeout(150);
  };

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
  await createHabit('lecture', 5);   // 55 min left
  await createHabit('sommeil', 40);  // 20 min left
  await createHabit('sport', 55);   // 5 min left (most urgent)
  step('created 3 habits, least urgent first, most urgent last');

  // A 4th, not due today at all -> must never enter the story.
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
  step('created a 4th habit not due today (must stay out of the story entirely)');

  // --- Opening the story: sorted by urgency, tabbar hidden ---
  await freshVisitToday();
  step('tabbar hidden while in the story:', await page.locator('.tabbar').isHidden(), '(expect true)');
  step('no numeric counter anywhere:', await page.locator('.ritual-count').count(), '(expect 0 — the class shouldn\'t even exist)');

  const dotsTotal = await page.locator('.ritual-progress span').count();
  step('progress dots:', dotsTotal, '(expect 3 — the not-due 4th habit is excluded)');
  if (dotsTotal !== 3) throw new Error(`expected 3 progress dots, got ${dotsTotal}`);

  const firstTitle = (await page.locator('.rs-story-name').textContent()).trim();
  step('first card:', firstTitle, '(expect the sport habit — 5 min left, most urgent)');

  // --- Free navigation: moving to the next card never forces a verdict on
  // this one, pending or not ---
  const firstHabitId = await page.evaluate(() => document.querySelector('.rs-story').dataset.habit);
  await tapNext();
  const secondTitle = (await page.locator('.rs-story-name').textContent()).trim();
  step('tap-right moved on without deciding:', firstTitle, '->', secondTitle);
  if (secondTitle === firstTitle) throw new Error('tap-right did not move to a different card');
  const stillPending = await page.evaluate(id => store.checks.find(c => c.habit_id === id).status, firstHabitId);
  step('the card skipped past is still undecided:', stillPending, '(expect "created")');
  if (stillPending !== 'created') throw new Error('moving to the next card must not record a verdict on the one left behind');

  await tapPrev();
  const backToFirstPending = (await page.locator('.rs-story-name').textContent()).trim();
  step('tap-left returned to it:', backToFirstPending === firstTitle ? 'OK' : 'FAIL');
  if (backToFirstPending !== firstTitle) throw new Error('tap-left did not return to the previous card');

  // --- "Décaler" on a pending card: goes via Pas fait → Pourquoi? → Décaler
  // (Décaler is no longer a standalone button on the main card for pending
  // habits — it lives after the reason chips on the Pourquoi? page) ---
  const storyEl = await page.locator('.rs-story');
  const bandBefore = await storyEl.evaluate(el => el.className);
  step('band before snoozing (expect band-red, 5 min left of a 60-min range):', bandBefore);
  if (!bandBefore.includes('band-red')) throw new Error(`expected the most urgent card to already be band-red, got: ${bandBefore}`);

  const snoozedHabitId = await page.evaluate(() => document.querySelector('.rs-story').dataset.habit);
  await page.click('[data-verdict="failed"]');      // Pas fait
  await page.waitForSelector('.reason-grid');
  await page.click('#reason-snooze');               // Décaler on the reason page
  await page.waitForSelector('.modal-sheet');
  await page.click('[data-snooze="30"]');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });

  const snoozed = await page.evaluate(id => {
    const c = store.checks.find(x => x.habit_id === id);
    return { minutesLeft: minutesLeft(c), snoozeCount: c.snooze_count, status: c.status };
  }, snoozedHabitId);
  step('after a +30min snooze:', JSON.stringify(snoozed), '(expect minutesLeft near 30, snoozeCount 1, still "created")');
  if (snoozed.snoozeCount !== 1) throw new Error(`expected snooze_count 1, got ${snoozed.snoozeCount}`);
  if (snoozed.status !== 'created') throw new Error('snoozing must not record a verdict');
  if (!(snoozed.minutesLeft >= 25)) throw new Error(`expected the snooze to buy real time, got ${snoozed.minutesLeft} min left`);

  step('advanced to the next card after snoozing:', (await page.locator('.rs-story-name').textContent()).trim());

  // --- Answer the two remaining pending cards ---
  await page.click('.ritual-btn.is-yes');
  await page.waitForTimeout(700);
  await page.click('.ritual-btn.is-yes');
  await page.waitForTimeout(700);

  // The snoozed one never resurfaces in THIS pass — a snooze buys time
  // outside the current session, not a spot back in the same queue — so the
  // story ends here even though one promise is still technically undecided.
  await page.waitForSelector('.summary-tallies', { timeout: 4000 });
  step('story ends on the summary once every card in this pass is behind us: OK');
  await page.click('#ritual-done');
  await page.waitForFunction(() => location.hash === '#/home');

  // --- Re-opening Aujourd'hui: the still-pending (snoozed) card leads again,
  // decided ones trail behind it ---
  await freshVisitToday();
  const reopenedFirst = await page.evaluate(() => document.querySelector('.rs-story').dataset.habit);
  step('re-opening the story leads with the still-pending card again:', reopenedFirst === snoozedHabitId ? 'OK' : 'FAIL');
  if (reopenedFirst !== snoozedHabitId) throw new Error('a still-pending (snoozed) promise must lead a fresh visit to the story, not trail behind decided ones');
  const bandAfterStory = await page.evaluate(() => document.querySelector('.rs-story').className);
  step('band still red after the snooze — a snooze never re-greens a card:', bandAfterStory);
  if (!bandAfterStory.includes('band-red')) throw new Error(`snoozing must not improve the colour band, got: ${bandAfterStory}`);

  // Resolve it too, so every promise created in this run is now decided.
  await page.click('.ritual-btn.is-yes');
  await page.waitForTimeout(700);
  step('last pending card resolved too');
  await page.click('#ritual-quit');
  await page.waitForFunction(() => location.hash === '#/home');

  // --- Everything decided: a fresh visit is pure recap, freely browsable ---
  await freshVisitToday();
  const noVerdictBtns = await page.locator('[data-verdict]').count();
  step('no Fait/Pas fait actions on a fully-decided day:', noVerdictBtns, '(expect 0)');
  if (noVerdictBtns !== 0) throw new Error('a fully decided day should show no verdict buttons, only recap navigation');

  // Tap-left on the first recap card is a no-op (stays on the same card).
  const firstRecapTitle = (await page.locator('.rs-story-name').textContent()).trim();
  await tapPrev(); // no-op: already at index 0
  const afterNoop = (await page.locator('.rs-story-name').textContent()).trim();
  step('tap-left on first recap card is a no-op:', afterNoop === firstRecapTitle ? 'OK' : 'FAIL');
  if (afterNoop !== firstRecapTitle) throw new Error('tap-left on the first recap card should do nothing');

  await tapNext();
  const secondRecapTitle = (await page.locator('.rs-story-name').textContent()).trim();
  step('free tap-right navigation moved to a different card:', firstRecapTitle, '->', secondRecapTitle);
  if (firstRecapTitle === secondRecapTitle) throw new Error('tap-right on a decided card did not move to a different one');

  await tapPrev();
  const backToFirst = (await page.locator('.rs-story-name').textContent()).trim();
  step('tap-left returned to the first card:', backToFirst === firstRecapTitle ? 'OK' : 'FAIL');
  if (backToFirst !== firstRecapTitle) throw new Error('tap-left did not return to the previous card');

  // --- "Décaler" also reopens an already-failed day, same-day only ---
  const scenario = await page.evaluate(async () => {
    const day = new Date().toISOString().slice(0, 10);
    const mk = async title => (await createHabit({
      title, theme: 'ecrans', frequency: 'daily',
      target_days: [0, 1, 2, 3, 4, 5, 6], reminder_time: '20:00', window_minutes: 60,
    })).habit;

    const declared = await mk('Reopen declared');
    store.checks.push({ id: crypto.randomUUID(), habit_id: declared.id, date: day, status: 'failed', expired: false, reason: 'oubli' });

    const kept = await mk('Reopen kept');
    store.checks.push({ id: crypto.randomUUID(), habit_id: kept.id, date: day, status: 'success', expired: false });

    return { declaredId: declared.id, keptId: kept.id, declaredReminder: declared.reminder_time };
  });

  const findCard = async title => {
    for (let i = 0; i < 20; i++) {
      const nameEl = page.locator('.rs-story-name');
      if (await nameEl.count() === 0) return false; // ran past the last card, into the summary
      const current = (await nameEl.textContent()).trim();
      if (current === title) return true;
      await tapNext();
    }
    return false;
  };

  await freshVisitToday();

  step('locating the declared-failure card:', await findCard('Reopen declared') ? 'found' : 'NOT FOUND');
  const decalerVisibleOnFailed = await page.locator('#ritual-snooze').count();
  step('"Décaler" visible on an already-failed card:', decalerVisibleOnFailed, '(expect 1)');
  if (decalerVisibleOnFailed !== 1) throw new Error('a declared/silent failure should still offer "Décaler"');
  // No Fait/Pas fait buttons on a decided (but decalable) card.
  if (await page.locator('[data-verdict]').count() !== 0) throw new Error('a decided card must show no Fait/Pas fait buttons, even if decalable');

  await page.click('#ritual-snooze');
  await page.waitForSelector('.modal-sheet');
  await page.click('[data-snooze="30"]');
  await page.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 3000 });

  const reopened = await page.evaluate(async id => {
    const today = new Date().toISOString().slice(0, 10);
    const h = store.habits.find(x => x.id === id);
    const check = store.checks.find(c => c.habit_id === id && c.date === today);
    return { check, reminder_time: h?.reminder_time };
  }, scenario.declaredId);
  step('after Décaler on a declared failure:', JSON.stringify(reopened));
  if (reopened.check.status !== 'created' || reopened.check.expired !== false || reopened.check.reason) {
    throw new Error(`reopening via Décaler should reset status/expired/reason, got: ${JSON.stringify(reopened.check)}`);
  }
  if (!reopened.check.snoozed_until) throw new Error('reopening via Décaler should also push the deadline, same as an ordinary snooze');
  if (reopened.reminder_time !== scenario.declaredReminder) {
    throw new Error(`Décaler must never touch the habit's own reminder_time, got ${reopened.reminder_time}, expected ${scenario.declaredReminder}`);
  }
  if (reopened.check.reopened !== true) throw new Error('a reopened check should be marked so, or it could be reopened again forever');

  // --- One do-over only: if the reopened check fails again, the verdict
  // stands and "Décaler" is gone for good on that day's own row ---
  await page.evaluate(async id => {
    const today = new Date().toISOString().slice(0, 10);
    const check = store.checks.find(c => c.habit_id === id && c.date === today);
    check.status = 'failed';
    check.expired = true; // a silent second miss this time, doesn't matter which
  }, scenario.declaredId);
  await freshVisitToday();
  step('locating the twice-failed card:', await findCard('Reopen declared') ? 'found' : 'NOT FOUND');
  const decalerAfterSecondFailure = await page.locator('#ritual-snooze').count();
  step('"Décaler" after a second failure:', decalerAfterSecondFailure, '(expect 0)');
  if (decalerAfterSecondFailure !== 0) throw new Error('a check that already had its one reopen must not offer "Décaler" again after failing a second time');
  const attempt = await page.evaluate(async id => {
    const today = new Date().toISOString().slice(0, 10);
    const check = store.checks.find(c => c.habit_id === id && c.date === today);
    return snoozeCheck(check.id, 30);
  }, scenario.declaredId);
  step('snoozeCheck() itself refuses a second reopen:', JSON.stringify(attempt));
  if (attempt.ok) throw new Error('snoozeCheck() must refuse to reopen an already-reopened, twice-failed check even called directly');

  // A kept (or frozen) day is a real decision, not a mistake — no "Décaler".
  await freshVisitToday();
  step('locating the kept card:', await findCard('Reopen kept') ? 'found' : 'NOT FOUND');
  const decalerVisibleOnKept = await page.locator('#ritual-snooze').count();
  step('"Décaler" visible on a kept day:', decalerVisibleOnKept, '(expect 0)');
  if (decalerVisibleOnKept !== 0) throw new Error('a kept day should never offer "Décaler" — nothing to walk back');

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('TEST_FAILED', e.message); process.exit(1); });
