// Icons, themes, and the collectible habit card. Presentation layer only —
// no data access, no network.

const ICONS = {
  today: '<path d="M12 3a9 9 0 1 0 9 9" /><path d="M8 12l3 3 6-6" />',
  mirror: '<ellipse cx="12" cy="8.5" rx="6" ry="5.5" /><path d="M8 15.5c1 1.2 2.4 1.9 4 1.9s3-.7 4-1.9" opacity=".55" /><path d="M9.5 19.5h5" opacity=".35" />',
  plus: '<path d="M12 5v14M5 12h14" />',
  history: '<rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" />',
  flame: '<path d="M12 3c.6 3-1.4 4.2-2.6 5.6A5.6 5.6 0 0 0 8 12.4a4 4 0 0 0 8 .3c0-1.3-.5-2.3-1.2-3.2.3 1-.4 1.8-1 1.8.6-2.6-.7-6.6-1.8-8.3z" />',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" /><path d="M9.4 4.6L12 7l2.6-2.4M9.4 19.4L12 17l2.6 2.4" opacity=".7" />',
  check: '<path d="M4 12.5l5 5L20 6.5" />',
  cross: '<path d="M6 6l12 12M18 6L6 18" />',
  left: '<path d="M15 5l-7 7 7 7" />',
  right: '<path d="M9 5l7 7-7 7" />',
  spark: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" />',
  // theme icons
  sommeil: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8.2 8.2 0 1 0 20 14.5z" />',
  sport: '<path d="M5 9v6M19 9v6M3 10.5v3M21 10.5v3M8 8v8M16 8v8M8 12h8" />',
  ecrans: '<rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18.5h3" />',
  argent: '<rect x="2.5" y="6" width="19" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.6" />',
  alimentation: '<path d="M12 20c-3.5 0-5.5-3.4-5.5-7C6.5 9.6 8.6 7.5 11 8.4c.7.3 1.3.3 2 0 2.4-.9 4.5 1.2 4.5 4.6 0 3.6-2 7-5.5 7z" /><path d="M12 8.4c0-2 1-3.4 2.8-3.9" />',
  travail: '<rect x="2.5" y="7" width="19" height="13" rx="2.5" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />',
  lecture: '<path d="M12 6.5C10.5 5 8.4 4.5 4 4.8v13c4.4-.3 6.5.2 8 1.7 1.5-1.5 3.6-2 8-1.7v-13c-4.4-.3-6.5.2-8 1.7z" /><path d="M12 6.5v13" opacity=".5" />',
  social: '<circle cx="9" cy="9" r="3.2" /><path d="M3.5 19.5c.6-3 2.9-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><path d="M16 6.4a3.2 3.2 0 0 1 0 6.2M17.5 15.4c2 .5 3.4 2 3.9 4.1" opacity=".6" />',
  autre: '<circle cx="12" cy="12" r="8.5" /><path d="M12 8v4l2.5 2.5" />',
};

function icon(name, size = 24, cls = '') {
  const body = ICONS[name] || ICONS.autre;
  return `<svg class="icn ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${body}</svg>`;
}

const THEMES = [
  { id: 'sommeil', label: 'Sommeil', hue: 250, suggestions: ['Je dors avant 23h', 'Pas d’écran une heure avant de dormir', 'Je me lève à la première sonnerie'] },
  { id: 'sport', label: 'Sport', hue: 12, suggestions: ['Je bouge 30 minutes', 'Je vais à la salle', 'Je prends les escaliers'] },
  { id: 'ecrans', label: 'Écrans', hue: 200, suggestions: ['Moins de 2h de téléphone', 'Pas de réseaux le matin', 'Téléphone hors de la chambre'] },
  { id: 'argent', label: 'Argent', hue: 150, suggestions: ['Aucun achat impulsif', 'Je note mes dépenses', 'Je mets 10€ de côté'] },
  { id: 'alimentation', label: 'Alimentation', hue: 95, suggestions: ['Je cuisine au lieu de commander', 'Cinq fruits et légumes', 'Pas de grignotage le soir'] },
  { id: 'travail', label: 'Travail', hue: 35, suggestions: ['Deux heures sans distraction', 'Je termine ma tâche prioritaire', 'Inbox vide'] },
  { id: 'lecture', label: 'Lecture', hue: 280, suggestions: ['Je lis 20 pages', 'Je lis 15 minutes', 'Un chapitre par jour'] },
  { id: 'social', label: 'Social', hue: 330, suggestions: ['J’appelle un proche', 'Je vois quelqu’un en vrai', 'Je réponds à mes messages'] },
];

function themeById(id) {
  return THEMES.find(t => t.id === id) || { id: 'autre', label: 'Autre', hue: 40, suggestions: [] };
}

// ---------- Collectible card ----------

// minVitality gates the tier as much as minDays does — age alone used to be
// both necessary and sufficient, which meant a tier, once reached, was never
// at risk. Thresholds increase with the tier so satisfying a higher one
// always satisfies every lower one too.
const TIERS = [
  // Never "vient d'éclore" — the tier *after* this one is called Éclose, so
  // an egg claiming to have hatched contradicted the ladder it sits on.
  { id: 'oeuf',       label: 'Œuf',        emoji: '🥚', minDays: 0,   minVitality: 0,  blurb: 'Moins d’une semaine.' },
  { id: 'eclose',     label: 'Éclose',     emoji: '🐣', minDays: 7,   minVitality: 30, blurb: 'A tenu une semaine.' },
  { id: 'enracinee',  label: 'Enracinée',  emoji: '🌿', minDays: 30,  minVitality: 55, blurb: 'Un mois de survie.' },
  { id: 'gravee',     label: 'Gravée',     emoji: '🪨', minDays: 90,  minVitality: 70, blurb: 'Trois mois. Ça compte.' },
  { id: 'legendaire', label: 'Légendaire', emoji: '✨', minDays: 180, minVitality: 85, blurb: 'Six mois. Rare.' },
];

// The card's day-state channel: what today is, in one glyph. Three of them
// count today's range down, four state how it was settled, and the last two
// mark a card that has left the deck for good. Every one carries a written
// label too — an emoji is a picture, not a name, and the glyph alone would
// be unreadable to a screen reader and ambiguous to everyone else.
const CARD_STATUS = {
  plenty:   { glyph: '⏳', label: 'Il te reste du temps aujourd’hui' },
  half:     { glyph: '⏰', label: 'La fenêtre se referme' },
  urgent:   { glyph: '🚨', label: 'Dernières minutes pour répondre' },
  kept:     { glyph: '✅', label: 'Tenue aujourd’hui' },
  broken:   { glyph: '❌', label: 'Pas tenue aujourd’hui' },
  frozen:   { glyph: '❄️', label: 'Gelée aujourd’hui' },
  rest:     { glyph: '🌙', label: 'Rien à faire aujourd’hui' },
  finished: { glyph: '🏆', label: 'Promesse terminée' },
  dead:     { glyph: '🪦', label: 'Promesse enterrée' },
};

// The ceiling age alone allows — used only to detect a missed evolution
// (see tierFor below), never as the displayed tier by itself.
function ageTierFor(days) {
  let out = TIERS[0];
  for (const t of TIERS) if (days >= t.minDays) out = t;
  return out;
}

// The tier actually earned: age raises the ceiling, vitality decides whether
// the card has actually climbed up to it. Bidirectional — a card whose
// vitality drops below a tier's threshold loses that tier immediately, and
// won't reclaim it until vitality clears the bar again, independent of how
// much further its age has advanced in the meantime.
function tierFor(days, vitality = 100) {
  let out = TIERS[0];
  for (const t of TIERS) {
    if (days < t.minDays) break;
    if (vitality >= t.minVitality) out = t;
  }
  return out;
}

function nextTier(days) {
  return TIERS.find(t => days < t.minDays) || null;
}

function tierIndex(id) {
  const i = TIERS.findIndex(t => t.id === id);
  return i === -1 ? 0 : i;
}

// A deterministic hash of the habit's id, turned into a 0-359 seed. Used
// only to vary the fracture angle so two cards side by side don't crack
// along the same line — never as a colour. Hue used to do this job before
// hue was reserved for the time-remaining channel.
function hashSeed(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

// stats: { rate, daysAlive, streak, best, kept, total }
// opts.dead: the habit was abandoned or starved — greyed out, fissured,
// frozen at its tier of death instead of showing progress toward a next one
// that will never come.
// opts.finished: the habit reached its own end date on schedule — a natural
// completion, not a death. No fissures, no greyscale, no "morte"/"abandonnée"
// framing: the one honest signal left is whether it was, on the whole, kept.
function habitCard(habit, stats, opts = {}) {
  const theme = themeById(habit.theme);
  const tier = tierFor(stats.daysAlive, stats.vitality);
  const retired = opts.dead || opts.finished;
  // What age alone would allow — when it's ahead of the earned tier, the
  // card has missed an evolution it should already have had, and the
  // footer says so instead of showing progress toward a tier further still.
  const ageTier = retired ? tier : ageTierFor(stats.daysAlive);
  const missedEvolution = !retired && ageTier.id !== tier.id;
  // No countdown toward the next tier, and no progress bar either. A tier is
  // found when it arrives; announcing it in advance turned the badge into a
  // due date, and on a promise with a near end date it announced one the
  // schedule could never honour. The badge changing is the whole event.
  const atMaxTier = !retired && !nextTier(stats.daysAlive);

  const rateText = stats.rate === null ? '—' : `${stats.rate}%`;
  const keptOverall = stats.rate !== null && stats.rate >= 50;

  // Today's state, and today's alone. It used to be the body's colour, which
  // put a fact that turns over within the hour on the one channel the eye
  // reads first — so a promise you'd kept for three months looked identical
  // to one created this morning, and the card said nothing at all about the
  // promise's own health. Colour now belongs to that health (see below), and
  // today gets this: one glyph, top right. It also states the day plainly
  // rather than by comparison — an emptying hourglass is legible on a single
  // card, whereas "green" only meant "earlier than amber" if an amber card
  // happened to be next to it.
  //
  // The bands behind the three pending glyphs are read off the original
  // schedule only (see rangeElapsed) — a snooze buys real time to act but
  // never walks a card back a band, it only postpones the deadline.
  let timeState = 'none';
  let timeBand = '';
  let status = null;
  if (opts.finished) {
    timeState = keptOverall ? 'done' : 'broken';
    status = CARD_STATUS.finished;
  } else if (opts.dead) {
    status = CARD_STATUS.dead;
  } else {
    const todayCheck = todaysCheck(habit);
    timeState = todayCheck?.status === 'created' ? 'pending'
      : todayCheck?.status === 'success' ? 'done'
      : 'none';
    if (timeState === 'pending') {
      const elapsed = rangeElapsed(habit, todayCheck.date);
      timeBand = elapsed < 1 / 3 ? 'green' : elapsed < 2 / 3 ? 'amber' : 'red';
      status = timeBand === 'green' ? CARD_STATUS.plenty
        : timeBand === 'amber' ? CARD_STATUS.half
        : CARD_STATUS.urgent;
    } else {
      status = todayCheck?.status === 'success' ? CARD_STATUS.kept
        : todayCheck?.status === 'failed' ? CARD_STATUS.broken
        : todayCheck?.status === 'frozen' ? CARD_STATUS.frozen
        : CARD_STATUS.rest;
    }
  }
  // A synthetic card (the onboarding demo, a preview) belongs to no real
  // promise, so it has no "today" to report — better silent than inventing a
  // rest day for a habit that doesn't exist.
  if (!habit.id) status = null;
  const fracSeed = habit.id ? hashSeed(habit.id) : 40;

  // A real gauge, not just a filter — the vitality ladder used to only show
  // through desaturation, which reads as nothing at all once theme colour is
  // gone (a greyscale card stays grey). This is what actually drops the
  // moment yesterday goes unanswered.
  const vitalityBand = stats.vitalityState === 'mourante' ? 'critical'
    : (stats.vitalityState === 'malade' || stats.vitalityState === 'faiblit') ? 'low'
    : 'ok';

  // A sliding seven-day window, oldest first, today last — the card's
  // memory, and what stops today from being a blank square that says
  // nothing about yesterday. It carries the good history too, not only the
  // damage: a row of kept days is the reward the vitality gauge alone never
  // showed. Absent when the caller didn't compute it (a preview, a
  // synthetic card), and also withheld below two actually-scheduled days in
  // the window — a one-day promise, or one just created, has nothing here
  // for the strip to say that the rest of the card doesn't already.
  const rawWeek = Array.isArray(stats.week) ? stats.week : [];
  const dueInWeek = rawWeek.filter(d => d.state !== 'before' && d.state !== 'rest').length;
  const week = dueInWeek >= 2 ? rawWeek : [];
  const WEEK_WORDS = { kept: 'tenu', broken: 'pas tenu', frozen: 'gelé', pending: 'en cours', rest: 'repos', before: '' };
  const weekLabel = `Sept derniers jours : ${week.filter(d => d.state !== 'before').map(d => WEEK_WORDS[d.state] || d.state).join(', ')}.`;
  // D L M M J V S — single-letter initials indexed the same way getDay()
  // does (0 = dimanche). Without these the strip was unreadable: nothing
  // told you which mark was which day, so a gap could not be located on the
  // calendar at all, only counted.
  const DOW_LETTER = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  const todayIso = todayStr();

  const footerContent = opts.dead
    ? `<span class="pcard-xp-label pcard-xp-dead">${icon('cross', 12)} ${opts.deathCause === 'neglect' ? 'Morte de négligence' : 'Abandonnée'} le ${opts.deathDate || ''}</span>`
    : opts.finished
    // A finished promise isn't a failure of the system — the colour
    // already said whether it was kept, this just spells it out.
    ? `<span class="pcard-xp-label ${keptOverall ? 'pcard-xp-kept' : 'pcard-xp-broken'}">${icon(keptOverall ? 'check' : 'cross', 12)} Terminée le ${opts.finishedDate || ''} — ${keptOverall ? 'tenue' : 'non tenue'}</span>`
    : stats.vitalityState === 'mourante'
    // A dying card has more urgent news than its progress toward a tier it
    // will not reach. Stated as what you stand to lose, not as a scolding —
    // and counted at the cost of silence, so answering honestly always buys
    // more days than the warning promised.
    ? `<span class="pcard-xp-label pcard-xp-dying">Encore ${stats.rupturesLeft} rupture${stats.rupturesLeft > 1 ? 's' : ''} et elle meurt</span>`
    : missedEvolution
    // Age alone no longer promotes a card — it has to be earned. Stated as a
    // fact already true, not a countdown: the day has passed, it just
    // didn't happen.
    ? `<span class="pcard-xp-label pcard-xp-missed">${icon('cross', 12)} Aurait dû devenir « ${ageTier.label} ». Ce n'est pas encore fait.</span>`
    : atMaxTier
    ? `<span class="pcard-xp-label pcard-xp-max">Palier maximum atteint</span>`
    // The ordinary case, and the common one: nothing to report. The footer
    // element isn't rendered at all rather than left empty, so it doesn't
    // keep claiming a gap in the card's flex column.
    : '';

  return `
    <article class="pcard tier-${tier.id} vit-${stats.vitalityState || 'pleine'} time-${timeState} ${timeBand ? 'band-' + timeBand : ''} ${opts.compact ? 'is-compact' : ''} ${retired ? 'is-retired' : ''} ${opts.dead ? 'is-dead' : ''}"
      style="--frac-seed:${fracSeed}; --vitality:${stats.vitality ?? 100}"
      ${opts.habitId ? `data-habit="${opts.habitId}"` : ''}>
      <div class="pcard-sheen" aria-hidden="true"></div>
      <header class="pcard-head">
        <h3 class="pcard-name">${esc(habit.title || 'Ta promesse')}</h3>
        ${status && !opts.noStatus ? `<span class="pcard-status" role="img" title="${esc(status.label)}" aria-label="${esc(status.label)}">${status.glyph}</span>` : ''}
      </header>

      ${!retired ? `
      <div class="pcard-vitality">
        <span class="pcard-vitality-label">VIE</span>
        <div class="pcard-vitality-bar"><div class="pcard-vitality-fill is-${vitalityBand}" style="width:${Math.max(2, Math.min(100, stats.vitality ?? 100))}%"></div></div>
      </div>` : ''}

      ${!retired && week.length ? `
      <div class="pcard-week" role="img" aria-label="${esc(weekLabel)}">
        <div class="pcard-week-days">${week.map(d => `<span class="pcard-day is-${d.state}"></span>`).join('')}</div>
        <div class="pcard-week-dow">${week.map(d => `<span class="${d.date === todayIso ? 'is-today' : ''}">${DOW_LETTER[d.dow]}</span>`).join('')}</div>
      </div>` : ''}

      <div class="pcard-art">
        <div class="pcard-art-glow" aria-hidden="true"></div>
        ${icon(theme.id, opts.compact ? 40 : 56, 'pcard-art-icon')}
      </div>

      <div class="pcard-tier">
        <span class="pcard-tier-name">${tier.emoji} ${tier.label}</span>
        <span class="pcard-tier-blurb">${opts.dead
          // A one-day promise's day count is always exactly 1 -- stating it
          // says nothing "Abandonnée"/"Terminée" alone doesn't already say.
          ? (isOneDayHabit(habit)
            ? `${opts.deathCause === 'neglect' ? 'Laissée mourir' : 'Abandonnée'}.`
            : `${opts.deathCause === 'neglect' ? 'Laissée mourir' : 'Abandonnée'} après ${daysCount(stats.daysAlive)} jour${daysCount(stats.daysAlive) > 1 ? 's' : ''}.`)
          : opts.finished
          ? (isOneDayHabit(habit) ? 'Terminée.' : `Terminée après ${daysCount(stats.daysAlive)} jour${daysCount(stats.daysAlive) > 1 ? 's' : ''}.`)
          : tier.blurb}</span>
      </div>
      ${!retired && habit.resurrected
        // Permanent and never removed — a revived card must never be able to
        // look like one that was never buried.
        ? `<span class="pcard-scar">${icon('cross', 10)} Revenue après ${daysCount(habit.pre_death_days)} jour${daysCount(habit.pre_death_days) > 1 ? 's' : ''} d'abandon</span>`
        : ''}

      <div class="pcard-stats">
        <div class="pcard-stat"><span class="k">Taux</span><span class="v">${rateText}</span></div>
        <div class="pcard-stat"><span class="k">Jours</span><span class="v">${daysCount(stats.daysAlive)}</span></div>
      </div>

      ${footerContent ? `<footer class="pcard-foot">${footerContent}</footer>` : ''}
    </article>
  `;
}

// ---------- Skeletons ----------

function skeletonList(rows = 3) {
  return `<div class="skel-wrap">${Array.from({ length: rows }, () =>
    `<div class="skel-card"><div class="skel-line w60"></div><div class="skel-line w35"></div></div>`
  ).join('')}</div>`;
}

function skeletonHero() {
  return `<div class="skel-wrap"><div class="skel-ring"></div><div class="skel-line w50 center"></div>${skeletonList(2)}</div>`;
}
