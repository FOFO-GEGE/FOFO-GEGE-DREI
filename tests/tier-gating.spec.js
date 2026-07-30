// Tiers used to be pure age — reached once, never at risk. Now each tier
// also needs a minimum vitality, so age raises the ceiling but doesn't
// guarantee the climb, and a tier already reached can be lost if vitality
// drops below its threshold — bidirectional, unlike the age-only ceiling.
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
  await page.fill('#auth-pseudo', 'tier' + Date.now());
  await page.fill('#auth-password', 'goodpass1');
  await page.click('#auth-submit');
  await page.waitForSelector('.tabbar');

  // Pure function checks against the same table used in vitality.spec.js —
  // no UI needed, just the tier/vitality contract itself.
  const table = await page.evaluate(() => [
    ['age 0, vitality 100', tierFor(0, 100).id, 'oeuf'],
    ['age 96 (would be gravee), vitality 100', tierFor(96, 100).id, 'gravee'],
    // Age qualifies for gravee (90j) but vitality (60) only clears enracinee's
    // bar (55), not gravee's (70) — the ceiling doesn't guarantee the climb.
    ['age 96, vitality 60 (gated below gravee)', tierFor(96, 60).id, 'enracinee'],
    // Age would allow legendaire (180j) but vitality is critical.
    ['age 200, vitality 10 (gated to oeuf)', tierFor(200, 10).id, 'oeuf'],
    ['ageTierFor ignores vitality entirely', ageTierFor(200).id, 'legendaire'],
  ]);
  let failed = 0;
  for (const [label, got, expected] of table) {
    const ok = got === expected;
    if (!ok) failed++;
    step(`${ok ? 'ok  ' : 'FAIL'} ${label}: got "${got}", expected "${expected}"`);
  }
  if (failed) throw new Error(`${failed} tier-gating case(s) failed`);

  // --- End to end: a card gated below its age ceiling shows the missed-
  // evolution message instead of a progress bar toward a tier further out ---
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

  // start_date computed relative to "now" rather than a hardcoded calendar
  // date — 120 days old lands the age ceiling at gravee (90j) without
  // reaching legendaire (180j), regardless of what day this actually runs.
  const rendered = await page.evaluate(() => {
    const h = store.habits[0];
    const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    h.start_date = daysAgo(120);
    // 4 silent failures: vitality settles at 100 - 4*12 = 52 — below both
    // gravee's bar (70) and enracinee's (55), so this gates down to eclose.
    for (let i = 0; i < 4; i++) {
      store.checks.push({
        id: crypto.randomUUID(), habit_id: h.id,
        date: daysAgo(110 - i), status: 'failed', expired: true,
      });
    }
    const stats = habitStats(h);
    return {
      vitality: stats.vitality,
      daysAlive: stats.daysAlive,
      effectiveTier: tierFor(stats.daysAlive, stats.vitality).id,
      ageTier: ageTierFor(stats.daysAlive).id,
      ageTierLabel: ageTierFor(stats.daysAlive).label,
      html: habitCard(h, stats, { compact: true, habitId: h.id }),
    };
  });
  step('vitality:', rendered.vitality, '| effective tier:', rendered.effectiveTier, '| age would allow:', rendered.ageTier);
  if (rendered.ageTier !== 'gravee' || rendered.effectiveTier !== 'eclose') {
    throw new Error('scenario did not land where expected — test setup is wrong: ' + JSON.stringify(rendered));
  }
  if (!rendered.html.includes('pcard-xp-missed') || !rendered.html.includes(rendered.ageTierLabel)) {
    throw new Error('gated card did not render the missed-evolution message');
  }
  step('missed-evolution message renders in place of the progress bar: OK');

  await page.evaluate(() => { location.hash = '#/home'; renderRoute(); });
  await page.waitForSelector('.deck-grid .pcard');
  const cardClass = await page.evaluate(() => document.querySelector('.deck-grid .pcard').className);
  step('card class reflects the gated (lower) tier, not the age ceiling:', cardClass);
  if (!cardClass.includes('tier-eclose') || cardClass.includes('tier-gravee')) {
    throw new Error(`card should visually show tier-eclose, got: ${cardClass}`);
  }

  // --- Recovery: enough successes to clear the gate again ---
  const recovered = await page.evaluate(() => {
    const h = store.habits[0];
    const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < 5; i++) {
      store.checks.push({
        id: crypto.randomUUID(), habit_id: h.id,
        date: daysAgo(50 - i), status: 'success', expired: false,
      });
    }
    const stats = habitStats(h);
    return { vitality: stats.vitality, tier: tierFor(stats.daysAlive, stats.vitality).id };
  });
  step('after recovery -> vitality:', recovered.vitality, '| tier:', recovered.tier, '(expect back at gravee)');
  if (recovered.tier !== 'gravee') throw new Error(`tier did not recover once vitality cleared the bar again: ${recovered.tier}`);

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('TEST_FAILED', e.message); process.exit(1); });
