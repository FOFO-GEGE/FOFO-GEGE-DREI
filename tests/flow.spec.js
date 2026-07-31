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

  // --- Time-remaining colour: the card reads as "pending" while unanswered ---
  await page.waitForSelector('.deck-grid .pcard');
  step('card shows the pending time colour while unanswered:', await page.locator('.deck-grid .pcard.time-pending').count(), '(expect 1)');

  // --- Aujourd'hui is the story directly now: no intro screen, no button —
  // tapping the tab drops straight onto the pending card, full screen ---
  await page.click('[data-nav="/today"]');
  await page.waitForSelector('.ritual-card .pcard');
  step('story opens directly on the real card:', (await page.locator('.ritual-card .pcard-name').textContent()).trim());
  step('countdown chip:', (await page.locator('.countdown').textContent()).trim().replace(/\s+/g, ' '));
  step('no chrome (tabbar) while in the story:', await page.locator('.tabbar').count(), '(expect 0)');

  // --- Calendar shows "pas encore fait" --- (no tabbar while in the story —
  // jump the hash directly, same as leaving via the X would)
  await page.evaluate(() => { location.hash = '#/history'; });
  await page.waitForSelector('.cal-legend');
  step('legend entries:', (await page.locator('.cal-legend-item').allTextContents()).join(' | '));
  step('created cells:', await page.locator('.cal-day.created').count());

  // --- Reminder time cannot be edited while today's check is still live ---
  const habitId = await page.evaluate(() => store.habits[0].id);
  await page.evaluate(id => { location.hash = '#/habit/' + id; }, habitId);
  await page.waitForSelector('#edit-reminder-time');
  await page.click('#edit-reminder-time');
  await page.waitForSelector('.modal-sheet');
  await page.fill('#rt-time', '06:30');
  await page.click('#rt-save');
  await page.waitForSelector('#rt-error:not([hidden])', { timeout: 3000 });
  step('reminder-time edit blocked while promise is live: OK');
  await page.click('#rt-cancel');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  step('reminder_time unchanged:', await page.evaluate(() => store.habits[0].reminder_time));

  // --- Ritual: countdown chip, then failure -> reason picker --- (tapping
  // the tab drops straight into the story — no button to start it)
  await page.click('[data-nav="/today"]');
  await page.waitForSelector('.ritual-card .pcard');
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

  // --- Time-remaining colour: settles once answered (this was "Pas fait",
  // so it settles to neutral, not gold) ---
  step('card no longer pending once answered:', await page.locator('.deck-grid .pcard.time-pending').count(), '(expect 0)');
  step('card not gold either — this was "Pas fait":', await page.locator('.deck-grid .pcard.time-done').count(), '(expect 0)');

  // --- Card focus: the card only pivots in place — it never translates.
  // One finger tilts it around X/Y far enough to carry it past a full
  // quarter-turn (into a flip), two fingers would spin it around Z; both
  // spring back to flat the moment every pointer lifts. A real turn must not
  // also count as the tap that closes the overlay, but a plain tap (or
  // tapping the backdrop) still does ---
  await page.click('.deck-grid .pcard');
  await page.waitForSelector('.card-focus-backdrop.show', { timeout: 4000 });
  step('card focus opened:', await page.locator('.card-focus-stage .pcard').count());

  const boxBefore = await page.locator('.card-focus-stage .pcard').boundingBox();
  const centerBefore = { x: boxBefore.x + boxBefore.width / 2, y: boxBefore.y + boxBefore.height / 2 };
  await page.mouse.move(centerBefore.x, centerBefore.y);
  await page.mouse.down();
  await page.mouse.move(centerBefore.x + 250, centerBefore.y, { steps: 10 });

  const mid = await page.evaluate(() => document.querySelector('.card-focus-stage .pcard').style.transform);
  const rotY = Number((mid.match(/rotateY\(([-\d.]+)deg\)/) || [])[1]);
  step('mid-drag rotateY:', rotY, '(expect > 90 — a 250px drag should carry it past a quarter-turn, into a flip)');
  if (!(rotY > 90)) throw new Error(`card does not turn far enough: got transform "${mid}"`);
  // The precise check: the transform the app writes never contains a
  // translate() at all — no ambiguity from perspective foreshortening.
  if (/translate\(/.test(mid)) throw new Error(`card should only ever rotate, but transform includes a translate: "${mid}"`);

  // A perspective-rotated rectangle's axis-aligned bounding box legitimately
  // shifts a little (the near edge projects larger than the far edge) even
  // with zero translation — this is a loose sanity bound, not the real check.
  const boxDuring = await page.locator('.card-focus-stage .pcard').boundingBox();
  const centerDuring = { x: boxDuring.x + boxDuring.width / 2, y: boxDuring.y + boxDuring.height / 2 };
  const centerShift = Math.hypot(centerDuring.x - centerBefore.x, centerDuring.y - centerBefore.y);
  step('center shift while turning (px, perspective foreshortening expected):', centerShift.toFixed(1));
  if (centerShift > 40) throw new Error(`card center moved implausibly far for a pure rotation: ${centerShift.toFixed(1)}px`);

  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('.card-focus-stage .pcard').style.transform === 'perspective(900px) rotateX(0deg) rotateY(0deg) rotateZ(0deg)',
    { timeout: 3000 }
  );
  step('card springs back flat on release');
  step('overlay still open after a real turn (not treated as a closing tap):',
    await page.locator('.card-focus-backdrop').count(), '(expect 1)');

  await page.locator('.card-focus-stage .pcard').click();
  await page.waitForSelector('.card-focus-backdrop', { state: 'detached', timeout: 4000 });
  step('a plain tap on the card (no turn) still closes the overlay');

  await page.click('.deck-grid .pcard');
  await page.waitForSelector('.card-focus-backdrop.show', { timeout: 4000 });
  await page.locator('.card-focus-backdrop').click({ position: { x: 6, y: 6 } });
  await page.waitForSelector('.card-focus-backdrop', { state: 'detached', timeout: 4000 });
  step('tapping the backdrop outside the card still closes it');

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

  // Regression check for the toggle bug: the [hidden] attribute alone did not
  // catch it (an author .deck-grid{display:grid} rule was silently beating
  // the UA [hidden] rule), so assert the *computed* style instead.
  await page.click('#cemetery-toggle');
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#cemetery-grid')).display === 'none',
    { timeout: 3000 }
  );
  step('cemetery panel is actually display:none after a second toggle click');

  // --- Calendar day now shows the stamped, still-visible failure ---
  await page.click('[data-nav="/history"]');
  await page.waitForSelector('.cal-legend');
  await page.click('.cal-day.failed');
  await page.waitForSelector('.day-sheet');
  step('day sheet status:', await page.locator('.day-row-status').first().textContent());
  step('day sheet reason:', await page.locator('.day-row-reason').textContent());
  await page.click('#day-close');

  // --- "Ce que tu n'as pas tenu" lives on Historique now (Ma semaine was
  // folded into it) and survives the abandon ---
  await page.click('[data-nav="/history"]');
  await page.waitForSelector('.failures', { timeout: 4000 });
  step('failure row present after abandon:', await page.locator('.failure-row.is-buried').count());

  // --- Reminder time edit succeeds once there is no live check to game ---
  // (a habit not due today never gets a 'created' check, so nothing blocks it)
  // All days are selected by default; deselecting today is enough to keep
  // the other six and still exclude today from target_days.
  await page.click('[data-nav="/new"]');
  await page.waitForSelector('.creator');
  await page.click('[data-theme="lecture"]');
  await page.waitForSelector('.suggestions');
  await page.locator('.suggestion').first().click();
  await page.click('#nh-next');
  await page.waitForSelector('.day-picker');
  await page.click(`[data-day="${new Date().getDay()}"]`); // deselect today
  await page.click('#nh-next');
  await page.waitForSelector('#nh-time');
  await page.fill('#nh-time', '07:00');
  await page.click('#nh-next');
  await page.waitForFunction(() => location.hash === '#/home');
  const restHabitId = await page.evaluate(() => store.habits[0].id);
  step('created a rest-day habit not due today');

  await page.evaluate(id => { location.hash = '#/habit/' + id; }, restHabitId);
  await page.waitForSelector('#edit-reminder-time');
  step('no live check for it today:', await page.evaluate(
    id => !store.checks.some(c => c.habit_id === id && c.date === new Date().toISOString().slice(0, 10) && c.status === 'created'),
    restHabitId
  ), '(expect true)');
  await page.click('#edit-reminder-time');
  await page.waitForSelector('.modal-sheet');
  await page.fill('#rt-time', '07:45');
  await page.click('#rt-save');
  await page.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 3000 });
  step('reminder time after edit:', await page.evaluate(id => store.habits.find(h => h.id === id).reminder_time, restHabitId));
  step('reminder row now shows:', (await page.locator('.reminder-row').textContent()).trim().replace(/\s+/g, ' '));

  // --- Pushing the reminder time later, past a deadline that had already
  // gone by with no check for today, should immediately open one -- "Aujourd'hui"
  // must not wait for the next unrelated reconcile to notice the new schedule ---
  await page.click('[data-nav="/new"]');
  await page.waitForSelector('.creator');
  await page.click('[data-theme="argent"]');
  await page.waitForSelector('.suggestions');
  await page.locator('.suggestion').first().click();
  await page.click('#nh-next');
  await page.waitForSelector('.day-picker');
  await page.click('#nh-next'); // every day selected, including today
  await page.waitForSelector('#nh-time');
  await page.click('#nh-next');
  await page.waitForFunction(() => location.hash === '#/home');
  const missedTodayId = await page.evaluate(() => store.habits[store.habits.length - 1].id);

  const before = await page.evaluate(async id => {
    const h = store.habits.find(x => x.id === id);
    // Simulate a reminder time whose window already closed earlier today,
    // before the app was ever opened -- reconcileToday()'s own check-opening
    // pass requires now <= deadline, so no check row exists for today at all.
    h.reminder_time = '00:01';
    h.window_minutes = 1;
    store.checks = store.checks.filter(c => c.habit_id !== id);
    await reconcileToday();
    const today = new Date().toISOString().slice(0, 10);
    return { hasCheckToday: store.checks.some(c => c.habit_id === id && c.date === today) };
  }, missedTodayId);
  step('before editing the time, no check exists for today:', before.hasCheckToday, '(expect false)');
  if (before.hasCheckToday) throw new Error('setup invalid: a check already exists for today');

  await page.evaluate(id => { location.hash = '#/habit/' + id; }, missedTodayId);
  await page.waitForSelector('#edit-reminder-time');
  await page.click('#edit-reminder-time');
  await page.waitForSelector('.modal-sheet');
  // Any time still ahead of the clock -- window_minutes is generous enough
  // (default on creation) that this deadline is comfortably in the future.
  const future = new Date(Date.now() + 5 * 60000);
  await page.fill('#rt-time', `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`);
  await page.click('#rt-save');
  await page.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 3000 });

  const after = await page.evaluate(id => {
    const today = new Date().toISOString().slice(0, 10);
    const check = store.checks.find(c => c.habit_id === id && c.date === today);
    return { status: check?.status };
  }, missedTodayId);
  step('after pushing the reminder later, a check now exists for today:', JSON.stringify(after), '(expect status "created")');
  if (after.status !== 'created') throw new Error(`editing the reminder time to later should immediately open today's check, got: ${JSON.stringify(after)}`);

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('TEST_FAILED', e.message); process.exit(1); });
