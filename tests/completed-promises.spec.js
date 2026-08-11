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

  // --- The "Jours" stat (and every "jour(s)" sentence built from the same
  // number) is a calendar day count, not the raw elapsed-time value tier
  // gating runs on -- a promise still alive the day after it was created has
  // existed on 2 calendar days, and must never read "Jours 1". daysCount()
  // is the single conversion point; tierFor()/ageTierFor()/nextTier() must
  // keep taking the raw, un-shifted value untouched. ---
  const dayCountCases = await page.evaluate(() => {
    const habit = { id: 'd', title: 'Day', theme: 'sport', start_date: '2024-01-01' };
    const created = habitCard(habit, { rate: null, daysAlive: 0, streak: 0, best: 0, kept: 0, total: 0, vitality: 100, vitalityState: 'pleine' }, { compact: true });
    const nextDay = habitCard(habit, { rate: 100, daysAlive: 1, streak: 1, best: 1, kept: 1, total: 1, vitality: 100, vitalityState: 'pleine' }, { compact: true });
    const dead = habitCard(habit, { rate: 0, daysAlive: 1, streak: 0, best: 0, kept: 0, total: 1, vitalityState: 'pleine' },
      { compact: true, dead: true, deathCause: 'neglect', deathDate: '02/01' });
    const jours = html => Number((html.match(/<span class="k">Jours<\/span><span class="v">(\d+)<\/span>/) || [])[1]);
    return {
      createdDayNumber: jours(created),
      nextDayNumber: jours(nextDay),
      deadBlurbHasTwo: dead.includes('après 2 jours'),
      rawDaysCount: daysCount(0),
      rawDaysCountNext: daysCount(1),
      tierIgnoresConversion: tierFor(7, 100).id, // must still flip at the raw threshold, not at 8
    };
  });
  step('day count display:', JSON.stringify(dayCountCases));
  if (dayCountCases.createdDayNumber !== 1) throw new Error(`a promise created today should read "Jours 1", got ${dayCountCases.createdDayNumber}`);
  if (dayCountCases.nextDayNumber !== 2) throw new Error(`a promise still alive the next day should read "Jours 2", got ${dayCountCases.nextDayNumber}`);
  if (!dayCountCases.deadBlurbHasTwo) throw new Error('a dead card\'s "après N jours" blurb should use the same +1 calendar count');
  if (dayCountCases.rawDaysCount !== 1 || dayCountCases.rawDaysCountNext !== 2) throw new Error('daysCount() should just add 1');
  if (dayCountCases.tierIgnoresConversion !== 'eclose') throw new Error('tier gating must keep comparing the raw elapsed-day value, unaffected by the display conversion');

  // --- A one-day promise's day count is always exactly 1 -- stating it adds
  // nothing "Terminée"/"Abandonnée" alone doesn't already say. A multi-day
  // promise (or one with no end date) is unaffected and keeps the count. ---
  const oneDayTextCases = await page.evaluate(() => {
    const oneDay = { id: 'o', title: 'One-day', theme: 'sport', start_date: '2024-01-01', end_date: '2024-01-01' };
    const multiDay = { id: 'm', title: 'Multi-day', theme: 'sport', start_date: '2024-01-01', end_date: '2024-02-01' };
    const stats = { rate: 0, daysAlive: 0, streak: 0, best: 0, kept: 0, total: 1, vitalityState: 'pleine' };
    const oneDayFinished = habitCard(oneDay, stats, { compact: true, finished: true, finishedDate: '01/01' });
    const oneDayDead = habitCard(oneDay, stats, { compact: true, dead: true, deathCause: 'abandoned', deathDate: '01/01' });
    const multiDayFinished = habitCard(multiDay, stats, { compact: true, finished: true, finishedDate: '01/01' });
    return {
      oneDayFinishedText: (oneDayFinished.match(/pcard-tier-blurb">([^<]*)</) || [])[1],
      oneDayDeadText: (oneDayDead.match(/pcard-tier-blurb">([^<]*)</) || [])[1],
      multiDayFinishedText: (multiDayFinished.match(/pcard-tier-blurb">([^<]*)</) || [])[1],
    };
  });
  step('one-day vs multi-day blurb text:', JSON.stringify(oneDayTextCases));
  if (oneDayTextCases.oneDayFinishedText !== 'Terminée.') throw new Error(`a one-day promise's finished blurb should just say "Terminée.", got "${oneDayTextCases.oneDayFinishedText}"`);
  if (oneDayTextCases.oneDayDeadText !== 'Abandonnée.') throw new Error(`a one-day promise's dead blurb should just say "Abandonnée.", got "${oneDayTextCases.oneDayDeadText}"`);
  if (!oneDayTextCases.multiDayFinishedText.includes('après 1 jour')) throw new Error(`a multi-day promise should keep its day count, got "${oneDayTextCases.multiDayFinishedText}"`);

  // --- No card, of any size or lifespan, announces the next tier any more.
  // The countdown used to turn the badge into a due date, and on a promise
  // whose own end date ruled that tier out it announced one the schedule
  // could never honour. The badge changing is the entire event. ---
  const noCountdown = await page.evaluate(() => {
    const stats = { rate: null, daysAlive: 0, streak: 0, best: 0, kept: 0, total: 0, vitality: 100, vitalityState: 'pleine' };
    const cards = {
      oneDay: habitCard({ id: 'y', title: 'One-day', theme: 'sport', start_date: '2024-01-01', end_date: '2024-01-01' }, stats, {}),
      longRun: habitCard({ id: 'z', title: 'Long', theme: 'sport', start_date: '2024-01-01', end_date: '2025-01-01' }, stats, {}),
      noEndDate: habitCard({ id: 'w', title: 'Ongoing', theme: 'sport', start_date: '2024-01-01' }, stats, {}),
      compact: habitCard({ id: 'c', title: 'Compact', theme: 'sport', start_date: '2024-01-01' }, stats, { compact: true }),
    };
    const offenders = Object.entries(cards).filter(([, html]) =>
      html.includes('pcard-xp-fill') || html.includes('j avant') || html.includes('Se termine avant'));
    return { offenders: offenders.map(([k]) => k) };
  });
  step('cards announcing a next tier:', JSON.stringify(noCountdown.offenders), '(expect none)');
  if (noCountdown.offenders.length) throw new Error(`no card should announce the next tier any more, but these do: ${noCountdown.offenders.join(', ')}`);

  // --- The seven-day strip: the card's own memory, and the reason today is
  // no longer a blank square. Present on any live card that was given one,
  // gone on a retired one, along with the vitality gauge. 'rest' (not
  // scheduled that day) and 'before' (the promise didn't exist yet) are
  // deliberately distinct from a miss -- conflating them used to make a
  // 2x/week habit, or one created mid-week, read as failing every day it
  // was never asked to run. ---
  const weekStrip = await page.evaluate(() => {
    // The last entry's date must be the real "today" for the is-today
    // marker on the day-initial row to have anything to match against --
    // habitCard() reads today off the clock, not off the synthetic stats.
    const today = todayStr();
    const week = [
      { date: '2024-01-01', dow: 1, state: 'before' }, { date: '2024-01-02', dow: 2, state: 'kept' },
      { date: '2024-01-03', dow: 3, state: 'broken' }, { date: '2024-01-04', dow: 4, state: 'rest' },
      { date: '2024-01-05', dow: 5, state: 'frozen' }, { date: '2024-01-06', dow: 6, state: 'kept' },
      { date: today, dow: 0, state: 'pending' },
    ];
    const stats = { rate: 80, daysAlive: 5, streak: 0, best: 0, kept: 4, total: 5, vitality: 88, vitalityState: 'pleine', week };
    const habit = { id: 'c', title: 'Compact', theme: 'sport', start_date: '2024-01-01' };
    const compact = habitCard(habit, stats, { compact: true });
    const finished = habitCard(habit, stats, { compact: true, finished: true, finishedDate: '01/01' });
    const noWeek = habitCard(habit, { ...stats, week: undefined }, { compact: true });
    // Below the two-scheduled-days floor: mostly 'before'/'rest' marks, but
    // the strip is still rendered (kept for card-height parity across a deck
    // row — an omitted strip used to make this card shorter than its
    // neighbours).
    const oneDueDay = habitCard(habit, { ...stats, week: [
      { date: '2024-01-01', dow: 1, state: 'before' }, { date: '2024-01-02', dow: 2, state: 'before' },
      { date: '2024-01-03', dow: 3, state: 'rest' }, { date: '2024-01-04', dow: 4, state: 'rest' },
      { date: '2024-01-05', dow: 5, state: 'rest' }, { date: '2024-01-06', dow: 6, state: 'rest' },
      { date: '2024-01-07', dow: 0, state: 'kept' },
    ] }, { compact: true });
    const count = (html, cls) => (html.match(new RegExp(`pcard-day is-${cls}( |")`, 'g')) || []).length;
    return {
      marks: (compact.match(/pcard-day/g) || []).length,
      kept: count(compact, 'kept'),
      broken: count(compact, 'broken'),
      frozen: count(compact, 'frozen'),
      rest: count(compact, 'rest'),
      before: count(compact, 'before'),
      pending: count(compact, 'pending'),
      dowLetters: (compact.match(/pcard-week-dow/g) || []).length > 0,
      todayMarked: compact.includes('is-today'),
      compactHasVitalityGauge: compact.includes('pcard-vitality'),
      finishedHasStrip: finished.includes('pcard-day'),
      finishedHasVitalityGauge: finished.includes('pcard-vitality'),
      noWeekHasStrip: noWeek.includes('pcard-day'),
      oneDueDayHasStrip: oneDueDay.includes('pcard-day'),
      hasStreak: compact.includes('SÉRIE'),
      hasRecord: compact.includes('Record'),
      hasThemeWord: compact.includes('>Sport<'),
    };
  });
  step('seven-day strip:', JSON.stringify(weekStrip));
  if (weekStrip.marks !== 7) throw new Error(`the strip should carry exactly 7 marks, got ${weekStrip.marks}`);
  if (weekStrip.kept !== 2 || weekStrip.broken !== 1 || weekStrip.frozen !== 1 || weekStrip.rest !== 1 || weekStrip.before !== 1 || weekStrip.pending !== 1) {
    throw new Error('each day should render the mark matching its own state');
  }
  if (!weekStrip.dowLetters) throw new Error('the strip should carry a day-initial row -- without it no mark can be located on the calendar');
  if (!weekStrip.todayMarked) throw new Error("today's initial should be marked distinct from the rest of the week");
  if (!weekStrip.compactHasVitalityGauge) throw new Error('a live compact card should still show the vitality gauge');
  if (weekStrip.finishedHasStrip || weekStrip.finishedHasVitalityGauge) throw new Error('a retired card shows neither the strip nor the gauge — its story is over');
  if (weekStrip.noWeekHasStrip) throw new Error('a card rendered without a week (a preview) should simply omit the strip');
  if (!weekStrip.oneDueDayHasStrip) throw new Error('a promise scheduled on only one day within the window should still get the strip, for height parity with the rest of the deck');
  if (weekStrip.hasStreak) throw new Error('SÉRIE is gone from the card — the strip already shows the current run, and a streak punished one miss twice');
  if (weekStrip.hasRecord) throw new Error('the Record stat is gone from the card');
  if (weekStrip.hasThemeWord) throw new Error('the theme word under the icon is gone — the icon already says it');

  // --- lastWeekOf() itself: a habit created mid-window shows 'before' for
  // the days preceding its start_date, and a habit scheduled only some days
  // of the week shows 'rest' (not a miss) for the others. ---
  const storeWeek = await page.evaluate(() => {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const midWeekHabit = { id: 'mw', start_date: day(3), target_days: [0, 1, 2, 3, 4, 5, 6], active: true };
    const midWeek = lastWeekOf(midWeekHabit);
    const twiceHabit = { id: 'tw', start_date: day(30), target_days: [dowOf(day(1)), dowOf(day(4))], active: true };
    const twice = lastWeekOf(twiceHabit);
    return {
      beforeCount: midWeek.filter(d => d.state === 'before').length,
      dueCount: midWeek.filter(d => d.state !== 'before').length,
      restCount: twice.filter(d => d.state === 'rest').length,
      scheduledCount: twice.filter(d => d.state !== 'rest').length,
    };
  });
  step('lastWeekOf() before/rest classification:', JSON.stringify(storeWeek));
  if (storeWeek.beforeCount !== 3 || storeWeek.dueCount !== 4) throw new Error('a habit created 3 days ago should show exactly 3 "before" days and 4 due days in a 7-day window');
  if (storeWeek.restCount !== 5 || storeWeek.scheduledCount !== 2) throw new Error('a promise due on 2 of 7 days should mark the other 5 as rest, not as missed');

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
    // A genuine one-day promise -- start_date and end_date the same single
    // day -- rather than just an end_date in the past (which would make it
    // a multi-day promise cut short, a different case with its own day
    // count worth stating).
    h.start_date = yesterday;
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
  step('trophy shelf panel present:', await page.locator('.shelf').count(), '(expect 1)');
  if (await page.locator('.shelf').count() !== 1) throw new Error('the finished toggle should reveal a .shelf trophy panel wrapping the finished grid');

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
  const detailLine = (await page.locator('.card .stat-line').last().textContent()).trim();
  step('detail stat line mentions the natural end:', detailLine);
  // This habit's own end_date === start_date (see the "one-day scenario"
  // setup above) -- its day count is always exactly 1, so the sentence
  // should read the plain outcome rather than a redundant "1 jour".
  if (detailLine !== "Elle est allée jusqu'à sa fin prévue.") {
    throw new Error(`a one-day promise's detail sentence should skip the redundant day count, got: "${detailLine}"`);
  }

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('TEST_FAILED', e.message); process.exit(1); });
