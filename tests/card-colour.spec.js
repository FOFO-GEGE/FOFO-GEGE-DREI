// What a card's colour means, and where today went instead.
//
// The body used to be painted by today's answer — green/amber/red as the
// range ran down, gold once answered. That put the most short-lived fact in
// the app on the channel the eye reads first, and left the promise's own
// health with no voice at all. So the two swapped places:
//
//   body colour  -> the promise's life (the same three bands the VIE gauge
//                   fills with, plus grey for death), which moves over weeks
//   status glyph -> today, and today alone, top right of the card
//
// The consequence this file exists to protect: a card that leaves the deck
// keeps the colour it had at that moment. A promise abandoned in perfect
// health stays green — you are meant to see that you threw away something
// that was working — and one that starved is grey without any special rule,
// because its vitality really was zero when it went.
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
  await page.fill('#auth-pseudo', 'col' + Date.now());
  await page.fill('#auth-password', 'goodpass1');
  await page.click('#auth-submit');
  await page.waitForSelector('.tabbar');

  // --- The body class follows vitality and nothing else ---
  // Same promise, same day, opposite answers: the colour must not budge. And
  // a dying card that was just kept is still dying — one good day does not
  // repaint it green, which is exactly what the old system claimed.
  const bodyClass = await page.evaluate(() => {
    const habit = { id: 'c1', title: 'Test', theme: 'sport', start_date: '2024-01-01' };
    const stats = (vitality, vitalityState) => ({
      rate: 50, daysAlive: 10, streak: 0, best: 0, kept: 1, total: 2, vitality, vitalityState,
    });
    const bodyOf = html => (html.match(/class="pcard ([^"]*)"/) || [, ''])[1]
      .split(/\s+/).filter(c => c.startsWith('vit-'))[0];
    const today = todayStr();
    const put = status => {
      store.checks = [{ id: 'k', habit_id: 'c1', date: today, status, expired: false }];
    };
    const out = {};
    put('failed');
    out.healthyButFailedToday = bodyOf(habitCard(habit, stats(100, 'pleine'), { compact: true }));
    put('success');
    out.healthyAndKeptToday = bodyOf(habitCard(habit, stats(100, 'pleine'), { compact: true }));
    out.dyingButKeptToday = bodyOf(habitCard(habit, stats(20, 'mourante'), { compact: true }));
    out.slipping = bodyOf(habitCard(habit, stats(60, 'faiblit'), { compact: true }));
    out.sick = bodyOf(habitCard(habit, stats(40, 'malade'), { compact: true }));
    store.checks = [];
    return out;
  });
  step('body class by state:', JSON.stringify(bodyClass));
  if (bodyClass.healthyButFailedToday !== 'vit-pleine' || bodyClass.healthyAndKeptToday !== 'vit-pleine') {
    throw new Error('today\'s answer must not touch the body colour — a healthy promise reads vit-pleine either way');
  }
  if (bodyClass.dyingButKeptToday !== 'vit-mourante') {
    throw new Error('one kept day must not repaint a dying card — the body follows vitality, not today');
  }
  if (bodyClass.slipping !== 'vit-faiblit' || bodyClass.sick !== 'vit-malade') {
    throw new Error('faiblit and malade each keep their own class (they share one amber band in CSS, not one class)');
  }

  // --- Those classes actually resolve to the three bands, and to three
  // *different* colours: a class nothing paints would pass the check above
  // while leaving every card identical on screen. ---
  const painted = await page.evaluate(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:340px';
    document.body.appendChild(host);
    const read = cls => {
      host.innerHTML = `<article class="pcard ${cls}"></article>`;
      const cs = getComputedStyle(host.firstElementChild);
      return { bg: cs.backgroundColor, border: cs.borderTopColor };
    };
    const out = {
      pleine: read('vit-pleine'),
      faiblit: read('vit-faiblit'),
      malade: read('vit-malade'),
      mourante: read('vit-mourante'),
      morte: read('vit-morte'),
      plain: read('vit-none'),
    };
    host.remove();
    return out;
  });
  step('painted bands:', JSON.stringify(painted));
  const distinct = new Set([painted.pleine.bg, painted.mourante.bg, painted.morte.bg, painted.faiblit.bg]);
  if (distinct.size !== 4) throw new Error(`green / amber / red / grey must be four different backgrounds, got ${distinct.size}`);
  if (painted.faiblit.bg !== painted.malade.bg) throw new Error('faiblit and malade deliberately share one amber band');
  if (painted.pleine.bg === painted.plain.bg) throw new Error('vit-pleine must actually paint the body, not fall through to the plain surface');

  // --- Taux/Jours sit centred at the card's own bottom ---
  // Regression coverage: pcard-stats used to be a 3-column grid holding only
  // 2 stat boxes, so the pair sat left, with an empty third column's worth of
  // space to their right rather than in the middle of the card.
  const statsCentering = await page.evaluate(() => {
    const habit = { id: 'c3', title: 'Test', theme: 'sport', start_date: '2024-01-01' };
    const stats = { rate: 50, daysAlive: 10, streak: 0, best: 0, kept: 1, total: 2, vitality: 100, vitalityState: 'pleine' };
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:350px';
    host.innerHTML = habitCard(habit, stats, {});
    document.body.appendChild(host);
    const cardBox = host.querySelector('.pcard').getBoundingClientRect();
    const statsBox = host.querySelector('.pcard-stats').getBoundingClientRect();
    host.remove();
    return {
      leftGap: statsBox.left - cardBox.left,
      rightGap: cardBox.right - statsBox.right,
    };
  });
  step('Taux/Jours gaps (left, right):', JSON.stringify(statsCentering));
  if (Math.abs(statsCentering.leftGap - statsCentering.rightGap) > 2) {
    throw new Error(`Taux/Jours must be centred under the card, got left=${statsCentering.leftGap} right=${statsCentering.rightGap}`);
  }

  // --- Today moved to the glyph ---
  // The three counting-down glyphs are asserted against rangeElapsed rather
  // than against the wall clock: what belongs here is the band -> glyph
  // mapping, and answer-window.spec.js already owns elapsed -> band. Driving
  // it by real times would also make this file fail whenever the sandbox
  // clock happens to cross midnight mid-run.
  const glyphs = await page.evaluate(() => {
    const habit = { id: 'c2', title: 'Test', theme: 'sport', start_date: '2024-01-01' };
    const stats = { rate: 50, daysAlive: 10, streak: 0, best: 0, kept: 1, total: 2, vitality: 100, vitalityState: 'pleine' };
    const glyphOf = html => {
      const el = new DOMParser().parseFromString(html, 'text/html').querySelector('.pcard-status');
      return el ? { glyph: el.textContent.trim(), label: el.getAttribute('aria-label') } : null;
    };
    const today = todayStr();
    const put = status => { store.checks = [{ id: 'k', habit_id: 'c2', date: today, status, expired: false }]; };
    const realElapsed = rangeElapsed;
    const out = {};

    put('created');
    rangeElapsed = () => 0;
    out.plenty = glyphOf(habitCard(habit, stats, { compact: true }));
    rangeElapsed = () => 0.5;
    out.half = glyphOf(habitCard(habit, stats, { compact: true }));
    rangeElapsed = () => 0.9;
    out.urgent = glyphOf(habitCard(habit, stats, { compact: true }));
    rangeElapsed = realElapsed;

    put('success'); out.kept = glyphOf(habitCard(habit, stats, { compact: true }));
    put('failed');  out.broken = glyphOf(habitCard(habit, stats, { compact: true }));
    put('frozen');  out.frozen = glyphOf(habitCard(habit, stats, { compact: true }));
    store.checks = [];
    out.rest = glyphOf(habitCard(habit, stats, { compact: true }));

    out.finished = glyphOf(habitCard(habit, stats, { compact: true, finished: true, finishedDate: '01/01' }));
    out.dead = glyphOf(habitCard(habit, stats, { compact: true, dead: true, deathDate: '01/01' }));
    // A synthetic card belongs to no real promise and has no "today" to report.
    out.preview = glyphOf(habitCard({ title: 'Demo', theme: 'sport', start_date: '2024-01-01' }, stats, {}));
    // The ritual card on Aujourd'hui opts out (noStatus) — the same fact is
    // already the countdown chip or the status line sitting right below it.
    put('created');
    out.noStatus = glyphOf(habitCard(habit, stats, { habitId: habit.id, noStatus: true }));
    return out;
  });
  step('glyphs:', JSON.stringify(glyphs));
  const expectGlyph = (key, glyph) => {
    if (!glyphs[key]) throw new Error(`expected a status glyph for "${key}", got none`);
    if (glyphs[key].glyph !== glyph) throw new Error(`expected "${glyph}" for "${key}", got "${glyphs[key].glyph}"`);
    if (!glyphs[key].label) throw new Error(`the "${key}" glyph must carry a written label — an emoji is a picture, not a name`);
  };
  expectGlyph('plenty', '⏳');
  expectGlyph('half', '⏰');
  expectGlyph('urgent', '🚨');
  expectGlyph('kept', '✅');
  expectGlyph('broken', '❌');
  expectGlyph('frozen', '❄️');
  expectGlyph('rest', '🌙');
  expectGlyph('finished', '🏆');
  expectGlyph('dead', '🪦');
  if (glyphs.preview !== null) throw new Error('a synthetic preview card has no real "today" and must show no status glyph');
  if (glyphs.noStatus !== null) throw new Error('opts.noStatus must suppress the glyph even on a card that otherwise has one to show');

  // --- The headline case: a promise abandoned in good health keeps its
  // colour in the cemetery. It must not be repainted to a death colour it
  // never earned. ---
  await page.click('[data-nav="/new"]');
  await page.waitForSelector('.creator');
  await page.click('[data-theme="lecture"]');
  await page.waitForSelector('.suggestions');
  await page.locator('.suggestion').first().click();
  await page.click('#nh-next');
  await page.waitForSelector('.day-picker');
  await page.click('#nh-next');
  await page.waitForSelector('#nh-time');
  await page.click('#nh-next');
  await page.waitForFunction(() => location.hash === '#/home');

  const abandoned = await page.evaluate(async () => {
    const h = store.habits[0];
    await deleteHabit(h.id);
    const buried = store.cemetery.find(x => x.id === h.id);
    const stats = habitStats(buried);
    const html = habitCard(buried, stats, { compact: true, dead: true, deathDate: '01/01', deathCause: buried.death_cause });
    const cls = (html.match(/class="pcard ([^"]*)"/) || [, ''])[1];
    return { vitality: stats.vitality, cls };
  });
  step('abandoned while healthy ->', JSON.stringify(abandoned));
  if (abandoned.vitality !== 100) throw new Error(`this habit was abandoned at full health, expected vitality 100, got ${abandoned.vitality}`);
  if (!abandoned.cls.includes('vit-pleine')) {
    throw new Error(`a promise abandoned in good health must keep its green in the cemetery, got: ${abandoned.cls}`);
  }
  if (abandoned.cls.includes('vit-morte')) throw new Error('vit-morte is for a card that actually reached zero, never for one that was simply abandoned');
  if (!abandoned.cls.includes('is-retired')) throw new Error('a card that has left the deck must carry is-retired (what mutes it without repainting it)');
  if (!abandoned.cls.includes('is-dead')) throw new Error('an abandoned card is still a dead one — is-dead must survive');

  // --- And the other half of the same rule: a card that really did starve
  // is grey, with no special case anywhere — its vitality was zero. ---
  await page.click('[data-nav="/new"]');
  await page.waitForSelector('.creator');
  await page.click('[data-theme="travail"]');
  await page.waitForSelector('.suggestions');
  await page.locator('.suggestion').first().click();
  await page.click('#nh-next');
  await page.waitForSelector('.day-picker');
  await page.click('#nh-next');
  await page.waitForSelector('#nh-time');
  await page.click('#nh-next');
  await page.waitForFunction(() => location.hash === '#/home');

  const starved = await page.evaluate(async () => {
    // Backdated well clear of today, and start_date pushed back with them —
    // vitalityOf() bounds its fold at start_date, so checks older than it
    // would be invisible (see the resurrection migration).
    const h = store.habits[0];
    h.start_date = '2021-01-01';
    for (let i = 0; i < 12; i++) {
      store.checks.push({
        id: crypto.randomUUID(), habit_id: h.id,
        date: new Date(Date.UTC(2021, 5, 1 + i)).toISOString().slice(0, 10),
        status: 'failed', expired: true,
      });
    }
    await reconcileToday();
    const buried = store.cemetery.find(x => x.id === h.id);
    if (!buried) return { buried: false };
    const stats = habitStats(buried);
    const html = habitCard(buried, stats, { compact: true, dead: true, deathDate: '01/01', deathCause: buried.death_cause });
    return { buried: true, cause: buried.death_cause, vitality: stats.vitality, cls: (html.match(/class="pcard ([^"]*)"/) || [, ''])[1] };
  });
  step('starved to death ->', JSON.stringify(starved));
  if (!starved.buried) throw new Error('a habit starved of answers should have died on reconcile');
  if (starved.vitality !== 0) throw new Error(`a starved card reaches zero, got ${starved.vitality}`);
  if (!starved.cls.includes('vit-morte')) throw new Error(`a card that reached zero is grey, got: ${starved.cls}`);

  console.log('ERRORS:', JSON.stringify(errors));
  if (errors.length) process.exit(1);
  await browser.close();
})().catch(e => { console.error('TEST_FAILED', e.message); process.exit(1); });
