// Historique is the app's single account of the past. Ma semaine used to hold
// the real analysis behind a button on Mon miroir while this tab showed only a
// calendar; the analysis moved here and the fixed rolling week it was locked to
// became one preset among four. Two controls govern everything below them --
// which period, and every promise or just one -- and each of the four blocks
// (rate, tally, failures ledger, insights) must actually recompute when either
// control moves, not just re-render the same numbers.
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
  await page.fill('#auth-pseudo', 'hist' + Date.now());
  await page.fill('#auth-password', 'goodpass1');
  await page.click('#auth-submit');
  await page.waitForSelector('.tabbar');

  // --- Ma semaine is gone as a screen; its old route lands on Historique ---
  const weekGone = await page.evaluate(() => typeof screenWeek === 'undefined');
  step('screenWeek() no longer exists:', weekGone, '(expect true)');
  if (!weekGone) throw new Error('Ma semaine should have been folded into Historique, not left behind');

  await page.evaluate(() => { location.hash = '#/week'; });
  await page.waitForFunction(() => location.hash === '#/history', { timeout: 4000 });
  step('old /week route redirects to:', await page.evaluate(() => location.hash));

  const weekButton = await page.locator('.btn-week').count();
  step('"Voir ma semaine" button on Mon miroir:', weekButton, '(expect 0)');
  if (weekButton !== 0) throw new Error('the door from Mon miroir to Ma semaine should be gone');

  // --- Two promises with histories deep enough to tell the periods apart ---
  const mkHabit = async themeId => {
    await page.click('[data-nav="/new"]');
    await page.waitForSelector('.creator');
    await page.click(`[data-theme="${themeId}"]`);
    await page.waitForSelector('.suggestions');
    await page.locator('.suggestion').first().click();
    await page.click('#nh-next');
    await page.waitForSelector('.day-picker');
    await page.click('#nh-next');
    await page.waitForSelector('#nh-time');
    await page.click('#nh-next');
    await page.waitForFunction(() => location.hash === '#/home');
  };
  await mkHabit('sport');
  await mkHabit('lecture');

  // A failure inside the last 7 days for habit A only, and a much older one
  // for habit B — so period and scope each change the answer on their own.
  const seeded = await page.evaluate(() => {
    const day = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const [a, b] = store.habits;
    a.start_date = day(120);
    b.start_date = day(120);
    const add = (h, n, status, extra = {}) =>
      store.checks.push({ id: crypto.randomUUID(), habit_id: h.id, date: day(n), status, expired: false, ...extra });

    add(a, 2, 'failed', { reason: 'oubli' });   // recent, habit A
    add(a, 3, 'success');
    add(a, 40, 'success');                       // only inside 90j / tout
    add(b, 45, 'failed', { expired: true });     // old, habit B
    add(b, 50, 'success');
    return { aId: a.id, aTitle: a.title, bId: b.id, bTitle: b.title };
  });

  await page.evaluate(() => { location.hash = '#/history'; renderRoute(); });
  await page.waitForSelector('.hist-controls');

  // The tally cells count up from zero on every rebuild (last cell starts at
  // 370ms and runs 560ms), so anything sampled earlier reads a partial
  // figure -- or a legitimate 0, which is why waiting for the value to stop
  // changing doesn't work either. Wait out the animation instead.
  const read = async () => {
    await page.waitForTimeout(1200);
    return page.evaluate(() => ({
      period: document.querySelector('.seg-btn.is-on')?.textContent.trim(),
      kept: document.querySelectorAll('.week-cell .n')[0]?.textContent,
      broken: document.querySelectorAll('.week-cell .n')[1]?.textContent,
      missed: document.querySelectorAll('.week-cell .n')[3]?.textContent,
      failures: document.querySelectorAll('.failure-row').length,
      hasTimeline: !!document.querySelector('.hist-timeline'),
    }));
  };

  // --- The period control actually changes the window ---
  const p7 = await read();
  step('7 j ->', JSON.stringify(p7));
  if (p7.failures !== 1) throw new Error(`the 7-day window should hold exactly the one recent failure, got ${p7.failures}`);

  await page.click('.seg-btn[data-period="90"]');
  const p90 = await read();
  step('3 mois ->', JSON.stringify(p90));
  if (p90.failures !== 2) throw new Error(`the 90-day window should pick up the older failure too, got ${p90.failures}`);
  if (Number(p90.kept) <= Number(p7.kept)) throw new Error('a wider period must count at least as many kept days');

  await page.click('.seg-btn[data-period="all"]');
  const pAll = await read();
  step('Tout ->', JSON.stringify(pAll));
  if (pAll.failures !== 2) throw new Error('the whole record should hold both failures');

  // A declared "pas fait" and a silence are both failures for the rate but
  // are tallied apart, so neither hides inside the other's number.
  if (pAll.broken !== '1' || pAll.missed !== '1') {
    throw new Error(`declared failures and silences should be tallied separately, got broken=${pAll.broken} missed=${pAll.missed}`);
  }

  // --- The scope control narrows to a single promise, and only then does the
  // per-card timeline appear ---
  if (pAll.hasTimeline) throw new Error('the per-card timeline has no meaning while every card is in scope');

  await page.selectOption('#hist-scope', seeded.aId);
  const scopedA = await read();
  step('Tout + carte A ->', JSON.stringify(scopedA));
  if (scopedA.failures !== 1) throw new Error(`scoping to habit A should leave only its own failure, got ${scopedA.failures}`);
  if (!scopedA.hasTimeline) throw new Error('a single-card scope should show that card\'s own timeline');

  const timelineStates = await page.evaluate(() => {
    const marks = Array.from(document.querySelectorAll('.timeline-day'));
    const counts = {};
    marks.forEach(m => {
      const s = m.className.replace('timeline-day is-', '');
      counts[s] = (counts[s] || 0) + 1;
    });
    return { total: marks.length, counts };
  });
  step('timeline:', JSON.stringify(timelineStates));
  if (!timelineStates.total) throw new Error('the timeline rendered no days at all');
  if (!timelineStates.counts.kept || !timelineStates.counts.broken) {
    throw new Error('the timeline should carry this card\'s real kept and broken days');
  }

  await page.selectOption('#hist-scope', seeded.bId);
  const scopedB = await read();
  step('Tout + carte B ->', JSON.stringify(scopedB));
  if (scopedB.failures !== 1) throw new Error('scoping to habit B should leave only its own failure');
  if (scopedB.missed !== '1' || scopedB.broken !== '0') {
    throw new Error(`habit B's only failure was a silence, got broken=${scopedB.broken} missed=${scopedB.missed}`);
  }

  // Back to every card: the ledger returns to both.
  await page.selectOption('#hist-scope', '');
  const backToAll = await read();
  step('back to toutes les cartes ->', JSON.stringify(backToAll));
  if (backToAll.failures !== 2 || backToAll.hasTimeline) {
    throw new Error('clearing the scope should restore every card and drop the per-card timeline');
  }

  // --- The calendar is still there, still clickable, and now scoped too ---
  step('calendar present:', await page.locator('.cal-wrap').count(), '(expect 1)');
  if (await page.locator('.cal-wrap').count() !== 1) throw new Error('the calendar should still live on Historique');
  await page.locator('.cal-day[data-date]').first().click();
  await page.waitForSelector('.day-sheet, .modal-sheet', { timeout: 4000 });
  step('day sheet still opens from the calendar');
  await page.keyboard.press('Escape').catch(() => {});

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('TEST_FAILED', e.message); process.exit(1); });
