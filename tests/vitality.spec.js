// Vitality: the value that makes a card change while the app is closed, and
// the one piece of logic written twice — once in JS (docs/store.js) and once
// in PL/pgSQL (mirroir_vitality). The table below is the contract between
// them: the identical cases were run against the real database when the
// migration was applied, and any change here that is not mirrored in SQL will
// make the client show a card the cron has already buried, or vice versa.
const { chromium } = require('playwright');
const BASE = process.env.MIRROIR_TEST_BASE || 'http://localhost:8811';

// [label, sequence, expected]
const CASES = [
  ['12 declared failures',            Array(12).fill(['failed', false]), 4],
  ['13 declared failures -> death',   Array(13).fill(['failed', false]), 0],
  ['8 silent failures',               Array(8).fill(['failed', true]),   4],
  ['9 silent failures -> death',      Array(9).fill(['failed', true]),   0],
  ['20 successes (saturates at 100)', Array(20).fill(['success', false]), 100],
  ['30 freezes cost nothing',         Array(30).fill(['frozen', false]), 100],
  ['3 silent + 1 success',            [...Array(3).fill(['failed', true]), ['success', false]], 76],
  ['death is terminal',               [...Array(9).fill(['failed', true]), ['success', false]], 0],
  ['undecided days never move it',    Array(10).fill(['created', false]), 100],
];

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
  await page.fill('#auth-pseudo', 'vit' + Date.now());
  await page.fill('#auth-password', 'goodpass1');
  await page.click('#auth-submit');
  await page.waitForSelector('.tabbar');

  // Drive vitalityOf() directly against a synthetic history.
  const results = await page.evaluate(cases => {
    const habit = { id: 'synthetic', active: true, start_date: '2020-01-01' };
    return cases.map(([label, seq, expected]) => {
      store.checks = seq.map(([status, expired], i) => ({
        habit_id: 'synthetic',
        // dates ascending, well in the past so none is "today"
        date: new Date(Date.UTC(2021, 0, 1 + i)).toISOString().slice(0, 10),
        status, expired,
      }));
      return { label, expected, got: vitalityOf(habit) };
    });
  }, CASES);

  let failed = 0;
  for (const r of results) {
    const ok = r.got === r.expected;
    if (!ok) failed++;
    step(`${ok ? 'ok  ' : 'FAIL'} ${r.label}: got ${r.got}, expected ${r.expected}`);
  }
  if (failed) throw new Error(`${failed} vitality case(s) disagree with the SQL contract`);

  // The state ladder the visuals hang off.
  const ladder = await page.evaluate(() =>
    [100, 80, 79, 55, 54, 30, 29, 1, 0].map(v => [v, vitalityState(v)]));
  step('state ladder:', ladder.map(([v, s]) => `${v}=${s}`).join(' '));

  const expectLadder = '100=pleine 80=pleine 79=faiblit 55=faiblit 54=malade 30=malade 29=mourante 1=mourante 0=morte';
  const gotLadder = ladder.map(([v, s]) => `${v}=${s}`).join(' ');
  if (gotLadder !== expectLadder) throw new Error(`ladder mismatch:\n got ${gotLadder}\n exp ${expectLadder}`);

  // The warning is counted at the cost of silence, so it can never promise
  // more days than the worst case actually delivers.
  const warn = await page.evaluate(() => [29, 24, 12, 1].map(v => [v, rupturesBeforeDeath(v)]));
  step('ruptures before death:', warn.map(([v, n]) => `${v}->${n}`).join(' '));
  for (const [v, n] of warn) {
    if (n * 12 < v) throw new Error(`warning is optimistic at vitality ${v}: promises ${n} ruptures`);
  }

  // --- Autonomous death, end to end ---
  // The keystone: a card must be able to leave the deck with no tap from the
  // user, survive a reload, and be reported exactly once on the way back in.
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
  step('habit created for the starvation run');

  // Nine days of silence, backdated so none of them is today. start_date is
  // pushed back too, since vitalityOf() now bounds its fold there (see the
  // resurrection migration) — the real habit's start_date is today, which
  // would otherwise make these synthetic 2021 checks invisible to the fold.
  const dead = await page.evaluate(async () => {
    const h = store.habits[0];
    h.start_date = '2021-01-01';
    for (let i = 0; i < 9; i++) {
      store.checks.push({
        id: crypto.randomUUID(), habit_id: h.id,
        date: new Date(Date.UTC(2021, 5, 1 + i)).toISOString().slice(0, 10),
        status: 'failed', expired: true,
      });
    }
    const before = vitalityOf(h);
    await reconcileToday();
    return {
      vitalityBefore: before,
      stillInDeck: store.habits.some(x => x.id === h.id),
      inCemetery: store.cemetery.some(x => x.id === h.id),
      cause: store.cemetery.find(x => x.id === h.id)?.death_cause,
      unannounced: unannouncedDeaths().length,
    };
  });
  step('vitality before reconcile:', dead.vitalityBefore, '(expect 0)');
  step('still in deck:', dead.stillInDeck, '(expect false — it died unattended)');
  step('in cemetery:', dead.inCemetery, '| cause:', dead.cause);
  step('unannounced deaths:', dead.unannounced, '(expect 1)');
  if (dead.stillInDeck || !dead.inCemetery || dead.cause !== 'neglect' || dead.unannounced !== 1) {
    throw new Error('a starved card did not die and bury itself: ' + JSON.stringify(dead));
  }

  // The death must reach the database, not just the in-memory store —
  // otherwise the next real session would resurrect the card by accident.
  // (Checked by querying rather than by reloading: the Supabase mock lives in
  // the page, so a reload would wipe the very database we are inspecting.)
  await page.waitForFunction(() => store.sync === 'idle', { timeout: 5000 });
  const persisted = await page.evaluate(async () => {
    const { data } = await sb.from('habits').select('*').eq('id', store.cemetery[0].id);
    const row = data[0];
    return { active: row.active, cause: row.death_cause, announced: row.death_announced };
  });
  step('persisted row ->', JSON.stringify(persisted));
  if (persisted.active !== false || persisted.cause !== 'neglect') {
    throw new Error('the death never reached the database: ' + JSON.stringify(persisted));
  }

  // Announced on the way back in, showing the card that died.
  await page.evaluate(() => openDeathNotice(unannouncedDeaths()));
  await page.waitForSelector('.death-notice', { timeout: 4000 });
  step('death notice:', (await page.locator('.death-notice > h3').textContent()).trim());
  step('notice shows the dead card:', await page.locator('.death-notice .pcard.is-dead').count());
  await page.click('#death-ack');
  await page.waitForSelector('.death-notice', { state: 'detached', timeout: 4000 });

  // ...and exactly once, in memory and in the database alike.
  await page.waitForFunction(() => store.sync === 'idle', { timeout: 5000 });
  const after = await page.evaluate(async () => {
    const { data } = await sb.from('habits').select('*').eq('id', store.cemetery[0].id);
    return { pending: unannouncedDeaths().length, announcedInDb: data[0].death_announced };
  });
  step('still unannounced after ack:', after.pending, '(expect 0) | flagged in db:', after.announcedInDb);
  if (after.pending !== 0 || after.announcedInDb !== true) {
    throw new Error('the same death would be announced again: ' + JSON.stringify(after));
  }
  await page.evaluate(() => openDeathNotice(unannouncedDeaths()));
  await page.waitForTimeout(300);
  const repeated = await page.locator('.death-notice').count();
  step('notice re-opened on a later visit:', repeated, '(expect 0)');
  if (repeated) throw new Error('the same death was announced twice');

  // --- Resurrection: once, ever, at Œuf, with a permanent scar ---
  const revived = await page.evaluate(async () => {
    const deadHabit = store.cemetery[0];
    const preDeathDays = habitStats(deadHabit).daysAlive;
    await resurrectHabit(deadHabit.id);
    const h = store.habits.find(x => x.id === deadHabit.id);
    return {
      preDeathDays,
      backInDeck: !!h,
      stillInCemetery: store.cemetery.some(x => x.id === deadHabit.id),
      active: h?.active,
      resurrected: h?.resurrected,
      preDeathDaysStored: h?.pre_death_days,
      streak: h?.current_streak,
      vitalityNow: h ? vitalityOf(h) : null,
      startedToday: h?.start_date === new Date().toISOString().slice(0, 10),
    };
  });
  step('resurrection ->', JSON.stringify(revived));
  if (!revived.backInDeck || revived.stillInCemetery || !revived.active || !revived.resurrected
      || revived.preDeathDaysStored !== revived.preDeathDays || revived.streak !== 0
      || revived.vitalityNow !== 100 || !revived.startedToday) {
    throw new Error('resurrection did not reset the card correctly: ' + JSON.stringify(revived));
  }

  await page.waitForFunction(() => store.sync === 'idle', { timeout: 5000 });
  const revivedPersisted = await page.evaluate(async id => {
    const { data } = await sb.from('habits').select('*').eq('id', id);
    return data[0];
  }, (await page.evaluate(() => store.habits.find(h => h.resurrected).id)));
  step('persisted after revival -> active:', revivedPersisted.active, '| resurrected:', revivedPersisted.resurrected,
    '| pre_death_days:', revivedPersisted.pre_death_days, '| deleted_at:', revivedPersisted.deleted_at);
  if (revivedPersisted.active !== true || revivedPersisted.resurrected !== true || revivedPersisted.deleted_at !== null) {
    throw new Error('the revival never reached the database: ' + JSON.stringify(revivedPersisted));
  }

  // The permanent scar shows on the card even back in the live deck.
  await page.evaluate(() => { location.hash = '#/home'; renderRoute(); });
  await page.waitForSelector('.deck-grid .pcard');
  const scarCount = await page.locator('.deck-grid .pcard-scar').count();
  step('scar visible on the revived card in the deck:', scarCount, '(expect 1)');
  if (scarCount !== 1) throw new Error('the resurrection scar is not shown on the card');

  // Starve it again — vitalityOf only ever folds checks between start_date
  // and today for an active habit, and start_date was just reset to today,
  // so there is no calendar date left to backdate into; every check has to
  // land on today itself to count (the fold doesn't care about ordering
  // within a single day, only about how many of each type there are). Then
  // confirm the one-resurrection-ever ceiling: a second one must be refused.
  const second = await page.evaluate(async () => {
    const h = store.habits.find(x => x.resurrected);
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < 9; i++) {
      store.checks.push({
        id: crypto.randomUUID(), habit_id: h.id,
        date: today, status: 'failed', expired: true,
      });
    }
    await reconcileToday();
    const res = await resurrectHabit(h.id);
    return {
      diedAgain: !store.habits.some(x => x.id === h.id) && store.cemetery.some(x => x.id === h.id),
      secondAttempt: res,
    };
  });
  step('died a second time:', second.diedAgain, '| second resurrection attempt ->', JSON.stringify(second.secondAttempt));
  if (!second.diedAgain || second.secondAttempt.ok) {
    throw new Error('a card was resurrected more than once: ' + JSON.stringify(second));
  }

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('TEST_FAILED', e.message); process.exit(1); });
