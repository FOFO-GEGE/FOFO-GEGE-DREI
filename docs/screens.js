// Screens. Each returns { title, html, tab, chrome, wire } and renders
// synchronously from the store — no awaiting inside a navigation.

const DOW_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function formatDay(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
const MONTH_LABELS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const SURPRISE_MESSAGES = ['Jour parfait.', 'Tu tiens le rythme.', 'Plus régulier que la moyenne cette semaine.'];

// Shared chip describing where a pending check sits in its hour.
function countdownChip(check) {
  const habit = store.habits.find(h => h.id === check.habit_id);
  if (!habit) return '';
  if (isExpired(check)) {
    return `<p class="countdown is-urgent">${icon('spark', 14)} Le temps est écoulé</p>`;
  }
  if (!windowIsOpen(check)) {
    const at = (habit.reminder_time || '20:00').slice(0, 5);
    return `<p class="countdown is-waiting">Ouvre à ${at}</p>`;
  }
  const left = minutesLeft(check);
  return `<p class="countdown ${left <= 15 ? 'is-urgent' : ''}">
    ${icon('spark', 14)} ${left} min avant « non tenu »
  </p>`;
}

// ---------- Onboarding ----------

const ONBOARD_SLIDES = [
  {
    eyebrow: 'MIRROIR',
    title: 'Tu as dit que tu allais le faire.',
    body: "On ne compte pas les intentions. On compte ce qui s'est vraiment passé.",
  },
  {
    eyebrow: 'Chaque promesse est une carte',
    title: 'Elle survit, ou elle meurt.',
    body: 'Plus elle tient, plus elle évolue. Une promesse de six mois est rare.',
    card: true,
  },
  {
    eyebrow: 'Aucune excuse, aucun mensonge',
    title: 'Pas de coach, pas de likes.',
    body: 'Juste le miroir.',
  },
];

function screenOnboarding(onDone) {
  let i = 0;

  const demoHabit = { title: 'Je dors avant 23h', theme: 'sommeil', start_date: '2025-01-01' };
  const demoStats = { rate: 74, daysAlive: 96, streak: 12, best: 21, kept: 71, total: 96 };

  function html() {
    const s = ONBOARD_SLIDES[i];
    return `
      <div class="onboard-wrap">
        <div class="onboard-slide">
          <div class="eyebrow">${esc(s.eyebrow)}</div>
          <h2>${esc(s.title)}</h2>
          <p>${esc(s.body)}</p>
          ${s.card ? `<div class="onboard-card">${habitCard(demoHabit, demoStats)}</div>` : ''}
        </div>
        <div class="onboard-dots">
          ${ONBOARD_SLIDES.map((_, idx) => `<span class="${idx === i ? 'active' : ''}"></span>`).join('')}
        </div>
        <div class="onboard-actions">
          <button class="btn-skip" id="ob-skip">Passer</button>
          <button class="btn-primary" id="ob-next">${i === ONBOARD_SLIDES.length - 1 ? 'Commencer' : 'Suivant'}</button>
        </div>
      </div>`;
  }

  function mount(host) {
    host.innerHTML = html();
    fxBindTilt(host);
    host.querySelector('#ob-skip').addEventListener('click', onDone);
    host.querySelector('#ob-next').addEventListener('click', () => {
      if (i === ONBOARD_SLIDES.length - 1) return onDone();
      i++;
      mount(host);
    });
  }

  return { chrome: false, mount };
}

// ---------- Auth ----------

const PSEUDO_DOMAIN = 'mirroir.local';
const PSEUDO_RE = /^[a-zA-Z0-9_.-]{3,20}$/;
const PASSWORD_RE = /^(?=.*\d).{8,}$/;

function screenLogin() {
  let mode = 'signin';

  const html = `
    <div class="auth-wrap">
      <h1>MIRROIR</h1>
      <p class="tagline">Tu as dit que tu allais le faire. Est-ce que tu l'as fait ?</p>
      <div class="auth-tabs">
        <button data-mode="signin" class="active">Connexion</button>
        <button data-mode="signup">Inscription</button>
      </div>
      <div class="form-group"><label for="auth-pseudo">Pseudo</label><input type="text" id="auth-pseudo" autocomplete="username" autocapitalize="none" /></div>
      <div class="form-group"><label for="auth-password">Mot de passe</label><input type="password" id="auth-password" autocomplete="current-password" /></div>
      <p class="hint-msg" id="pw-hint" style="display:none">8 caractères minimum, avec au moins un chiffre.</p>
      <button class="btn-primary" id="auth-submit">Se connecter</button>
      <p class="error-msg" id="auth-error" style="display:none"></p>
    </div>`;

  function wire(host) {
    const errorEl = host.querySelector('#auth-error');
    const hintEl = host.querySelector('#pw-hint');
    const submitBtn = host.querySelector('#auth-submit');
    const tabs = host.querySelectorAll('.auth-tabs button');

    tabs.forEach(tab => tab.addEventListener('click', () => {
      mode = tab.dataset.mode;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      submitBtn.textContent = mode === 'signin' ? 'Se connecter' : 'Créer mon compte';
      hintEl.style.display = mode === 'signup' ? 'block' : 'none';
    }));

    submitBtn.addEventListener('click', async () => {
      errorEl.style.display = 'none';
      const pseudo = host.querySelector('#auth-pseudo').value.trim();
      const password = host.querySelector('#auth-password').value;
      const fail = msg => { errorEl.textContent = msg; errorEl.style.display = 'block'; };

      if (!pseudo || !password) return fail('Pseudo et mot de passe requis.');
      if (!PSEUDO_RE.test(pseudo)) return fail('Le pseudo doit faire 3 à 20 caractères (lettres, chiffres, . _ -).');
      if (mode === 'signup' && !PASSWORD_RE.test(password)) {
        return fail('Le mot de passe doit faire au moins 8 caractères et contenir un chiffre.');
      }

      const email = `${pseudo.toLowerCase()}@${PSEUDO_DOMAIN}`;
      submitBtn.disabled = true;
      const { error } = mode === 'signin'
        ? await sb.auth.signInWithPassword({ email, password })
        : await sb.auth.signUp({ email, password, options: { data: { pseudo } } });
      submitBtn.disabled = false;
      if (error) {
        if (/already registered|already exists/i.test(error.message)) fail('Ce pseudo est déjà pris.');
        else if (/invalid login credentials/i.test(error.message)) fail('Pseudo ou mot de passe incorrect.');
        else fail(error.message);
      }
    });
  }

  return { chrome: false, html, wire };
}

// A reminder that only fires while a tab is open is not a reminder, so the
// banner pushes towards installing when that is what stands in the way.
function pushBanner() {
  if (!store.habits.length || !pushSupported()) return '';

  if (pushNeedsInstall()) {
    return `<div class="card notif-card">
        <p><strong>Pour recevoir les rappels</strong>, ajoute MIRROIR à ton écran d'accueil : bouton Partager, puis « Sur l'écran d'accueil ». iOS n'autorise pas les notifications depuis un simple onglet.</p>
      </div>`;
  }
  if (Notification.permission === 'denied') {
    return `<div class="card notif-card">
        <p>Les notifications sont bloquées pour MIRROIR. Sans elles, personne ne te rappellera tes promesses — tu peux les réautoriser dans les réglages de ton navigateur.</p>
      </div>`;
  }
  if (Notification.permission === 'default') {
    return `<div class="card notif-card">
        <p>Active les rappels pour être confronté à l'heure que tu as choisie, même app fermée.</p>
        <button class="btn-secondary" id="notif-enable">Activer les rappels</button>
        <p class="error-msg" id="notif-error" style="display:none"></p>
      </div>`;
  }
  return '';
}

// ---------- Aujourd'hui : entrée du rituel ----------

function screenToday() {
  const pending = pendingToday();
  const tally = todayTally();

  const notifBanner = pushBanner();

  let body;
  if (!store.habits.length) {
    body = `<div class="empty-rich">
        ${icon('spark', 40)}
        <h3>Aucune promesse.</h3>
        <p>Rien à te reprocher pour l'instant. Ça ne durera pas.</p>
        <button class="btn-primary" data-nav="/new">Faire une promesse</button>
      </div>`;
  } else if (!pending.length) {
    body = `<div class="empty-rich">
        ${icon('check', 40)}
        <h3>Tu as répondu à tout.</h3>
        <p>${tally.kept} tenue${tally.kept > 1 ? 's' : ''}, ${tally.broken} rompue${tally.broken > 1 ? 's' : ''}${tally.frozen ? `, ${tally.frozen} gelée${tally.frozen > 1 ? 's' : ''}` : ''} aujourd'hui.</p>
        <button class="btn-secondary" data-nav="/home">Voir mon miroir</button>
      </div>`;
  } else {
    // The tightest deadline across everything still open drives the urgency.
    const open = pending.filter(p => windowIsOpen(p.check));
    const soonest = open.length ? Math.min(...open.map(p => minutesLeft(p.check))) : null;

    body = `
      <div class="ritual-intro">
        <div class="ritual-count">${pending.length}</div>
        <h3>promesse${pending.length > 1 ? 's' : ''} pas encore faite${pending.length > 1 ? 's' : ''}</h3>
        ${soonest !== null
          ? `<p class="deadline-banner ${soonest <= 15 ? 'is-urgent' : ''}">
               Sans réponse dans <strong>${soonest} min</strong>, c'est compté comme non tenu.
             </p>`
          : `<p>Une par une. Pas de liste à cocher à la va-vite.</p>`}
        <ul class="ritual-preview">
          ${pending.map(p => `
            <li>
              ${icon(themeById(p.habit.theme).id, 18)}
              <span class="rp-title">${esc(p.habit.title)}</span>
              ${windowIsOpen(p.check)
                ? `<span class="rp-left ${minutesLeft(p.check) <= 15 ? 'is-urgent' : ''}">${minutesLeft(p.check)} min</span>`
                : `<span class="rp-left is-waiting">${(p.habit.reminder_time || '20:00').slice(0, 5)}</span>`}
            </li>`).join('')}
        </ul>
        <button class="btn-primary" id="start-ritual">Commencer le check-in</button>
      </div>`;
  }

  return {
    title: "Aujourd'hui", tab: '/today', chrome: true,
    html: notifBanner + body,
    wire(host) {
      const nb = host.querySelector('#notif-enable');
      if (nb) {
        nb.addEventListener('click', async () => {
          nb.disabled = true;
          const res = await registerPush();
          if (res.ok) { toast('Rappels activés.'); return navigate('/today'); }
          nb.disabled = false;
          const err = host.querySelector('#notif-error');
          if (err) {
            err.textContent = res.reason === 'denied'
              ? 'Tu as refusé les notifications. Réautorise-les dans les réglages du navigateur.'
              : res.reason === 'needs-install'
              ? "Ajoute d'abord MIRROIR à ton écran d'accueil."
              : `Impossible d'activer les rappels : ${res.reason}`;
            err.style.display = 'block';
          }
        });
      }
      const start = host.querySelector('#start-ritual');
      if (start) start.addEventListener('click', () => navigate('/ritual'));
    },
  };
}

// ---------- Le rituel ----------

function screenRitual() {
  const queue = pendingToday();
  let idx = 0;
  const result = { kept: 0, broken: 0, frozen: 0 };

  function mount(host) {
    if (idx >= queue.length) return mountSummary(host);

    const { check, habit } = queue[idx];
    const theme = themeById(habit.theme);
    const streak = habit.current_streak || 0;

    host.innerHTML = `
      <div class="ritual" style="--card-hue:${theme.hue}">
        <div class="ritual-top">
          <button class="ritual-quit" id="ritual-quit" aria-label="Quitter">${icon('cross', 20)}</button>
          <div class="ritual-progress">
            ${queue.map((_, i) => `<span class="${i < idx ? 'done' : i === idx ? 'now' : ''}"></span>`).join('')}
          </div>
        </div>

        <div class="ritual-body">
          <div class="ritual-theme">${icon(theme.id, 44)}</div>
          <p class="ritual-prompt">Tu avais promis</p>
          <h2 class="ritual-title">${esc(habit.title)}</h2>
          ${streak > 0
            ? `<p class="ritual-streak">${icon('flame', 16)} Série de ${streak} jour${streak > 1 ? 's' : ''} en jeu</p>`
            : '<p class="ritual-streak muted">Aucune série en cours.</p>'}
          ${countdownChip(check)}
        </div>

        <div class="ritual-actions">
          <button class="ritual-btn is-no" data-verdict="failed">${icon('cross', 22)}<span>Pas fait</span></button>
          <button class="ritual-btn is-yes" data-verdict="success">${icon('check', 22)}<span>Fait</span></button>
        </div>
        ${canFreeze(habit)
          ? `<button class="ritual-freeze" data-verdict="frozen">${icon('snow', 16)} Geler ce jour (1× ce mois)</button>`
          : ''}
      </div>`;

    host.querySelector('#ritual-quit').addEventListener('click', () => navigate('/today'));

    host.querySelectorAll('[data-verdict]').forEach(btn => {
      btn.addEventListener('click', () => {
        const verdict = btn.dataset.verdict;
        host.querySelectorAll('button').forEach(b => { b.disabled = true; });

        const stage = host.querySelector('.ritual');

        if (verdict === 'frozen') {
          freezeCheck(check.id);
          result.frozen++;
          vibrate(12);
        } else if (verdict === 'success') {
          markCheck(check.id, verdict);
          result.kept++;
          vibrate(25);
          fxBurstFrom(btn, { count: 54, speed: 8 });
        } else {
          // Commit happens on the reason step so the answer and its reason
          // land as one write instead of two.
          result.broken++;
          vibrate([10, 40, 60]);
          fxShake(stage, 'hard');
          const r = stage.getBoundingClientRect();
          fxShatter(r.left + r.width / 2, r.top + r.height * 0.42);
        }

        const veil = document.createElement('div');
        veil.className = `ritual-veil is-${verdict}`;
        veil.innerHTML = icon(verdict === 'success' ? 'check' : verdict === 'frozen' ? 'snow' : 'cross', 72);
        stage.appendChild(veil);
        requestAnimationFrame(() => veil.classList.add('show'));

        setTimeout(() => {
          if (verdict === 'failed') return mountReason(host, check);
          idx++;
          mount(host);
        }, 640);
      });
    });
  }

  // Optional, one tap, always skippable — the point is to learn what the
  // failures are made of, not to interrogate anyone.
  function mountReason(host, check) {
    host.innerHTML = `
      <div class="ritual reason-step">
        <div class="ritual-body">
          <p class="ritual-prompt">Pourquoi ?</p>
          <h2 class="ritual-title">Une raison, en un tap.</h2>
          <div class="reason-grid">
            ${REASONS.map(r => `<button class="reason-chip" data-reason="${r.id}">${esc(r.label)}</button>`).join('')}
          </div>
        </div>
        <div class="ritual-actions single">
          <button class="btn-secondary" id="reason-skip">Ne pas préciser</button>
        </div>
      </div>`;

    const commit = reason => {
      markCheck(check.id, 'failed', reason);
      idx++;
      mount(host);
    };
    host.querySelectorAll('[data-reason]').forEach(b =>
      b.addEventListener('click', () => commit(b.dataset.reason)));
    host.querySelector('#reason-skip').addEventListener('click', () => commit(null));
  }

  function mountSummary(host) {
    const total = result.kept + result.broken + result.frozen;
    const perfect = total > 0 && result.broken === 0;
    if (perfect && Math.random() < 0.35) {
      setTimeout(() => toast(SURPRISE_MESSAGES[Math.floor(Math.random() * SURPRISE_MESSAGES.length)]), 400);
    }

    host.innerHTML = `
      <div class="ritual ritual-summary">
        <div class="ritual-body">
          <p class="ritual-prompt">Aujourd'hui</p>
          <h2 class="ritual-title">${perfect ? 'Rien à te reprocher.' : result.kept === 0 && total > 0 ? 'Une journée blanche.' : 'Voilà les faits.'}</h2>
          <div class="summary-tallies">
            <div class="tally is-kept"><span class="n">${result.kept}</span><span class="l">tenue${result.kept > 1 ? 's' : ''}</span></div>
            <div class="tally is-broken"><span class="n">${result.broken}</span><span class="l">rompue${result.broken > 1 ? 's' : ''}</span></div>
            ${result.frozen ? `<div class="tally is-frozen"><span class="n">${result.frozen}</span><span class="l">gelée${result.frozen > 1 ? 's' : ''}</span></div>` : ''}
          </div>
        </div>
        <div class="ritual-actions single">
          <button class="btn-primary" id="ritual-done">Voir mon miroir</button>
        </div>
      </div>`;
    // Tallies land one after the other rather than all at once.
    const nums = host.querySelectorAll('.summary-tallies .n');
    const values = [result.kept, result.broken, result.frozen];
    nums.forEach((el, i) => {
      el.textContent = '0';
      setTimeout(() => fxCountUp(el, values[i], { duration: 700 }), 160 + i * 170);
    });

    if (perfect) setTimeout(fxConfetti, 260);

    host.querySelector('#ritual-done').addEventListener('click', () => navigate('/home'));
  }

  return { chrome: false, mount };
}

// ---------- Mon miroir ----------

function screenHome() {
  const score = globalScore();
  const shown = score === null ? 0 : score;
  // The reflection degrades as the score drops — the mirror stops being clear.
  const blur = (1 - shown / 100) * 7;
  // No score yet isn't the same as a bad one — nothing to fracture over.
  const crackOpacity = score === null || shown >= 70 ? 0 : Math.min(0.85, (70 - shown) / 70);

  const R = 104, C = 2 * Math.PI * R;
  const dash = C * (1 - shown / 100);
  const label = score === null ? '—' : `${score}%`;
  const isLow = score !== null && score < 50;

  const phrase = score === null
    ? 'Pas encore assez de données.'
    : `Tu tiens ${score}% de tes engagements.`;

  const social = store.socialRate
    ? `<p class="score-social"><b>${store.socialRate.rate}%</b> des gens comme toi ont tenu aujourd'hui.</p>`
    : '';

  const insights = buildInsights();
  const insightBlock = insights.length
    ? `<section class="insights">
         <h4 class="section-label">Ce que le miroir voit</h4>
         ${insights.slice(0, 3).map(i => `<div class="insight is-${i.tone}">${icon('spark', 16)}<span>${esc(i.text)}</span></div>`).join('')}
       </section>`
    : '';

  const cards = store.habits.length
    ? `<section class="deck">
         <h4 class="section-label">Tes cartes <span class="deck-count">${store.habits.length}</span></h4>
         <div class="deck-grid">
           ${store.habits.map(h => habitCard(h, habitStats(h), { compact: true, habitId: h.id })).join('')}
         </div>
       </section>`
    : `<div class="empty-rich">
         ${icon('plus', 36)}
         <h3>Ta collection est vide.</h3>
         <p>Chaque promesse devient une carte qui évolue tant qu'elle survit.</p>
         <button class="btn-primary" data-nav="/new">Créer ma première carte</button>
       </div>`;

  const failures = recentFailures(6);
  const failuresBlock = failures.length
    ? `<section class="failures">
         <h4 class="section-label">Ce que tu n'as pas tenu</h4>
         ${failures.map(({ check, habit }) => `
           <div class="failure-row ${habit.active === false ? 'is-buried' : ''}" data-habit="${habit.id}">
             ${icon(themeById(habit.theme).id, 18)}
             <div class="failure-body">
               <span class="failure-title">${esc(habit.title)}</span>
               <span class="failure-meta">${formatDay(check.date)}${check.reason ? ` · ${esc(reasonLabel(check.reason))}` : check.expired ? ' · sans réponse' : ''}</span>
             </div>
           </div>`).join('')}
       </section>`
    : '';

  const cemetery = store.cemetery.length
    ? `<section class="cemetery">
         <button class="cemetery-toggle" id="cemetery-toggle" aria-expanded="false">
           ${icon('cross', 15)} Cimetière <span class="deck-count">${store.cemetery.length}</span>
           <span class="cemetery-chevron">${icon('right', 14)}</span>
         </button>
         <div class="deck-grid cemetery-grid" id="cemetery-grid" hidden>
           ${store.cemetery.map(h => habitCard(h, habitStats(h), {
             compact: true, habitId: h.id, dead: true, deathDate: formatDay(h.deleted_at?.slice(0, 10)),
           })).join('')}
         </div>
       </section>`
    : '';

  const html = `
    <div class="mirror-hero ${isLow ? 'is-low' : ''}" style="--blur:${blur.toFixed(2)}px">
      <div class="mirror-ring">
        <div class="mirror-aura" aria-hidden="true"></div>
        <svg class="ring" viewBox="0 0 232 232" aria-hidden="true">
          <defs>
            <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="${isLow ? 'var(--danger)' : 'var(--hot)'}" />
              <stop offset="100%" stop-color="${isLow ? 'var(--hot)' : 'var(--success)'}" />
            </linearGradient>
          </defs>
          <circle class="ring-track" cx="116" cy="116" r="${R}" />
          <circle class="ring-value" cx="116" cy="116" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C}" />
        </svg>
        <div class="mirror-face">
          <div class="mirror-num">${score === null ? '—' : '0%'}</div>
          <div class="mirror-reflect" aria-hidden="true">${label}</div>
          <svg class="mirror-cracks" viewBox="0 0 232 232" style="opacity:${crackOpacity.toFixed(2)}" aria-hidden="true">
            <path d="M116 96 L106 132 L127 148 L98 198" />
            <path d="M106 132 L45 121" />
            <path d="M127 148 L188 132" />
            <path d="M98 198 L77 163" />
            <path d="M127 148 L137 195" />
            <path d="M106 132 L82 103" />
          </svg>
        </div>
      </div>
      <p class="score-phrase">${esc(phrase)}</p>
      ${social}
      <button class="btn-week" data-nav="/week">Voir ma semaine ${icon('right', 15)}</button>
    </div>
    ${insightBlock}
    ${failuresBlock}
    ${cards}
    ${cemetery}`;

  return {
    title: 'Mon miroir', tab: '/home', chrome: true, html,
    wire(host) {
      // The ring fills and the figure counts up on arrival — the score is the
      // headline, so it gets the entrance.
      if (score !== null) {
        fxCountUp(host.querySelector('.mirror-num'), score, { suffix: '%', duration: 1100 });
        requestAnimationFrame(() => {
          const ring = host.querySelector('.ring-value');
          if (ring) ring.style.strokeDashoffset = dash;
        });
      }
      fxBindTilt(host);
      wireCardFocus(host, '.deck-grid .pcard[data-habit]', store.habits);
      host.querySelectorAll('.failure-row[data-habit]').forEach(el =>
        el.addEventListener('click', () => navigate('/habit/' + el.dataset.habit)));

      wireCardFocus(host, '.cemetery-grid .pcard[data-habit]', store.cemetery, { dead: true });

      const toggle = host.querySelector('#cemetery-toggle');
      if (toggle) {
        toggle.addEventListener('click', () => {
          const grid = host.querySelector('#cemetery-grid');
          const open = !grid.hidden;
          grid.hidden = open;
          toggle.setAttribute('aria-expanded', String(!open));
          toggle.classList.toggle('is-open', !open);
          if (!open) fxBindTilt(host);
        });
      }

      celebrateTierUps(host);
    },
  };
}

// A tier is age-based, not success-based — it climbs just by not being
// abandoned. That means the moment worth marking isn't a daily "Fait", it's
// the rare day a card actually crosses into a new one. celebrated_tier
// remembers what has already been shown so this fires exactly once.
function celebrateTierUps(host) {
  const crossed = [];
  for (const h of store.habits) {
    const tier = tierFor(habitStats(h).daysAlive);
    if (tierIndex(tier.id) > tierIndex(h.celebrated_tier || 'oeuf')) {
      crossed.push({ habit: h, tier });
      h.celebrated_tier = tier.id;
      enqueue({ table: 'habits', values: { celebrated_tier: tier.id }, matchId: h.id });
    }
  }
  if (!crossed.length) return;
  fxFireworks();
  crossed.forEach(({ habit, tier }, i) => {
    setTimeout(() => toast(`« ${habit.title} » devient ${tier.label}.`), i * 2600);
  });
}

// ---------- Ma semaine ----------

function screenWeek() {
  const w = weekSummary();
  const delta = w.rate !== null && w.prevRate !== null ? w.rate - w.prevRate : null;

  const verdict = w.rate === null
    ? 'Pas encore de données cette semaine.'
    : delta === null ? `Tu as tenu ${w.rate}% cette semaine.`
    : delta > 0 ? `Tu remontes : ${w.rate}%, soit ${delta} points de plus que la semaine dernière.`
    : delta < 0 ? `Tu descends : ${w.rate}%, soit ${Math.abs(delta)} points de moins que la semaine dernière.`
    : `Tu stagnes : ${w.rate}%, exactement comme la semaine dernière.`;

  const html = `
    <div class="week-hero">
      <div class="week-rate">${w.rate === null ? '—' : '0%'}</div>
      <p class="week-verdict">${esc(verdict)}</p>
    </div>
    <div class="card week-grid">
      <div class="week-cell is-kept"><span class="n">0</span><span class="l">tenues</span></div>
      <div class="week-cell is-broken"><span class="n">0</span><span class="l">rompues</span></div>
      <div class="week-cell is-frozen"><span class="n">0</span><span class="l">gelées</span></div>
      <div class="week-cell is-missed"><span class="n">0</span><span class="l">sans réponse</span></div>
    </div>`;

  return {
    title: 'Ma semaine', tab: '/home', chrome: true, back: '/home', html,
    wire(host) {
      if (w.rate !== null) fxCountUp(host.querySelector('.week-rate'), w.rate, { suffix: '%', duration: 1000 });
      const cells = host.querySelectorAll('.week-cell .n');
      [w.kept, w.broken, w.frozen, w.missed].forEach((v, i) => {
        setTimeout(() => fxCountUp(cells[i], v, { duration: 620 }), 120 + i * 110);
      });
    },
  };
}

// ---------- Nouvelle promesse (parcours guidé) ----------

function screenNewHabit() {
  const draft = {
    title: '', theme: '', type: 'daily', frequency: 3,
    target_days: new Set([1, 2, 3, 4, 5, 6, 0]), reminder_time: '20:00', end_date: '',
  };
  let step = 0;
  const STEPS = 3;

  function previewCard() {
    return habitCard(
      { title: draft.title, theme: draft.theme || 'autre', start_date: todayStr() },
      { rate: null, daysAlive: 0, streak: 0, best: 0, kept: 0, total: 0 }
    );
  }

  function stepHtml() {
    if (step === 0) {
      const t = draft.theme ? themeById(draft.theme) : null;
      return `
        <h3 class="step-title">Quel domaine ?</h3>
        <div class="theme-grid">
          ${THEMES.map(th => `
            <button class="theme-chip ${draft.theme === th.id ? 'selected' : ''}" data-theme="${th.id}" style="--card-hue:${th.hue}">
              ${icon(th.id, 22)}<span>${th.label}</span>
            </button>`).join('')}
        </div>
        ${t ? `
          <h3 class="step-title">Ta promesse</h3>
          <div class="suggestions">
            ${t.suggestions.map(s => `<button class="suggestion" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}
          </div>` : ''}
        <div class="form-group">
          <label for="nh-title">${t ? 'Ou écris la tienne' : 'Ta promesse'}</label>
          <input type="text" id="nh-title" value="${esc(draft.title)}" placeholder="Ex : Je dors avant 23h" />
        </div>`;
    }
    if (step === 1) {
      return `
        <h3 class="step-title">À quel rythme ?</h3>
        <div class="type-toggle">
          <button data-type="daily" class="${draft.type === 'daily' ? 'selected' : ''}">Chaque jour choisi</button>
          <button data-type="frequency" class="${draft.type === 'frequency' ? 'selected' : ''}">X fois / semaine</button>
        </div>
        ${draft.type === 'frequency' ? `
          <div class="form-group">
            <label for="nh-frequency">Combien de fois par semaine ?</label>
            <input type="number" id="nh-frequency" min="1" max="7" value="${draft.frequency}" />
          </div>` : ''}
        <div class="form-group">
          <label>Jours concernés</label>
          <div class="day-picker">
            ${[1, 2, 3, 4, 5, 6, 0].map(d => `
              <button type="button" class="day-chip ${draft.target_days.has(d) ? 'selected' : ''}" data-day="${d}">${DOW_LABELS[d]}</button>`).join('')}
          </div>
        </div>`;
    }
    return `
      <h3 class="step-title">Quand te confronter ?</h3>
      <div class="form-group">
        <label for="nh-time">Heure de vérification</label>
        <input type="time" id="nh-time" value="${draft.reminder_time}" />
      </div>
      <div class="form-group">
        <label for="nh-end">Date de fin (optionnel)</label>
        <input type="date" id="nh-end" value="${draft.end_date}" />
      </div>
      <p class="hint-msg">Tu pourras geler un jour par mois, gratuitement, sans casser ta série.</p>`;
  }

  function canAdvance() {
    if (step === 0) return draft.title.trim().length > 0;
    if (step === 1) return draft.target_days.size > 0 &&
      (draft.type !== 'frequency' || (draft.frequency >= 1 && draft.frequency <= draft.target_days.size));
    return true;
  }

  function mount(host) {
    host.innerHTML = `
      <div class="creator">
        <div class="creator-preview">${previewCard()}</div>
        <div class="creator-steps">
          ${Array.from({ length: STEPS }, (_, i) => `<span class="${i === step ? 'active' : i < step ? 'done' : ''}"></span>`).join('')}
        </div>
        <div class="creator-body">${stepHtml()}</div>
        <p class="error-msg" id="nh-error" style="display:none"></p>
        <div class="creator-actions">
          ${step > 0 ? '<button class="btn-secondary" id="nh-back">Retour</button>' : ''}
          <button class="btn-primary" id="nh-next" ${canAdvance() ? '' : 'disabled'}>
            ${step === STEPS - 1 ? 'Créer la carte' : 'Suivant'}
          </button>
        </div>
      </div>`;

    const rerender = () => mount(host);
    fxBindTilt(host);

    host.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => {
      draft.theme = b.dataset.theme; rerender();
    }));
    host.querySelectorAll('[data-suggest]').forEach(b => b.addEventListener('click', () => {
      draft.title = b.dataset.suggest; rerender();
    }));

    const titleInput = host.querySelector('#nh-title');
    if (titleInput) {
      titleInput.addEventListener('input', () => {
        draft.title = titleInput.value;
        host.querySelector('.creator-preview').innerHTML = previewCard();
        host.querySelector('#nh-next').disabled = !canAdvance();
      });
    }

    host.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => {
      draft.type = b.dataset.type; rerender();
    }));
    host.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
      const d = Number(b.dataset.day);
      if (draft.target_days.has(d)) draft.target_days.delete(d); else draft.target_days.add(d);
      rerender();
    }));
    const freq = host.querySelector('#nh-frequency');
    if (freq) freq.addEventListener('input', () => { draft.frequency = Number(freq.value); });
    const time = host.querySelector('#nh-time');
    if (time) time.addEventListener('input', () => { draft.reminder_time = time.value; });
    const end = host.querySelector('#nh-end');
    if (end) end.addEventListener('input', () => { draft.end_date = end.value; });

    const back = host.querySelector('#nh-back');
    if (back) back.addEventListener('click', () => { step--; rerender(); });

    host.querySelector('#nh-next').addEventListener('click', async () => {
      const errorEl = host.querySelector('#nh-error');
      errorEl.style.display = 'none';
      if (!canAdvance()) return;
      if (step < STEPS - 1) { step++; return rerender(); }

      const btn = host.querySelector('#nh-next');
      btn.disabled = true;
      const { error } = await createHabit({
        title: draft.title.trim(),
        theme: draft.theme || 'autre',
        type: draft.type,
        frequency: draft.type === 'frequency' ? draft.frequency : null,
        target_days: Array.from(draft.target_days),
        reminder_time: draft.reminder_time,
        end_date: draft.end_date || null,
      });
      if (error) {
        btn.disabled = false;
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
        return;
      }
      toast('Carte créée.');
      navigate('/home');
    });
  }

  return { title: 'Nouvelle promesse', tab: '/new', chrome: true, mount };
}

// ---------- Historique ----------

const CAL_LEGEND = [
  { cls: 'success', label: 'Tenu' },
  { cls: 'failed', label: 'Non tenu' },
  { cls: 'created', label: 'Pas encore fait' },
  { cls: 'frozen', label: 'Gelé' },
];

function buildMonthGrid(year, month) {
  const firstDow = new Date(year, month, 1).getDay();
  const offset = (firstDow + 6) % 7; // grid starts on Monday
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${pad(month + 1)}-${pad(d)}`);
  return cells;
}

function screenHistory() {
  const now = new Date();
  let year = now.getFullYear(), month = now.getMonth();

  // Worst outcome wins, so a day never looks better than it was. 'created'
  // ranks above 'failed' because it is still answerable, not yet a verdict.
  function dayClass(statuses) {
    if (!statuses || !statuses.length) return 'empty';
    if (statuses.includes('created')) return 'created';
    if (statuses.includes('failed')) return 'failed';
    if (statuses.includes('no_data')) return 'no_data';
    if (statuses.includes('frozen')) return 'frozen';
    if (statuses.includes('success')) return 'success';
    return 'empty';
  }

  function mount(host) {
    const byDate = {};
    store.checks.forEach(c => { (byDate[c.date] ||= []).push(c.status); });

    host.innerHTML = `
      <div class="cal-wrap">
        <div class="month-nav">
          <button id="cal-prev" aria-label="Mois précédent">${icon('left', 20)}</button>
          <span class="label">${MONTH_LABELS[month]} ${year}</span>
          <button id="cal-next" aria-label="Mois suivant">${icon('right', 20)}</button>
        </div>
        <div class="cal-grid">
          ${['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(l => `<div class="cal-dow">${l}</div>`).join('')}
          ${buildMonthGrid(year, month).map(date => {
            if (!date) return '<div class="cal-day empty"></div>';
            const cls = dayClass(byDate[date]);
            return `<button type="button" class="cal-day ${cls}" ${cls !== 'empty' ? `data-date="${date}"` : 'disabled'}>${Number(date.split('-')[2])}</button>`;
          }).join('')}
        </div>
        <div class="cal-legend">
          ${CAL_LEGEND.map(l => `<div class="cal-legend-item"><span class="cal-legend-swatch ${l.cls}"></span>${l.label}</div>`).join('')}
        </div>
      </div>`;

    host.querySelector('#cal-prev').addEventListener('click', () => {
      if (month === 0) { month = 11; year--; } else month--;
      mount(host);
    });
    host.querySelector('#cal-next').addEventListener('click', () => {
      if (month === 11) { month = 0; year++; } else month++;
      mount(host);
    });
    host.querySelectorAll('.cal-day[data-date]').forEach(el =>
      el.addEventListener('click', () => openDaySheet(el.dataset.date)));
  }

  return { title: 'Historique', tab: '/history', chrome: true, mount };
}

// ---------- Card focus (foreground + blurred backdrop) ----------
// Tapping a card in a deck brings it forward for a closer look instead of
// leaving immediately for the detail screen; tapping it again puts it back.
// Deeper stats and the abandon action still live one tap further, inside the
// focused view.

function wireCardFocus(host, selector, list, opts = {}) {
  host.querySelectorAll(selector).forEach(el => {
    el.addEventListener('click', () => {
      const habit = list.find(h => h.id === el.dataset.habit);
      if (habit) openCardFocus(habit, opts);
    });
  });
}

function openCardFocus(habit, opts = {}) {
  const stats = habitStats(habit);
  const cardOpts = opts.dead ? { dead: true, deathDate: formatDay(habit.deleted_at?.slice(0, 10)) } : {};

  const overlay = document.createElement('div');
  overlay.className = 'card-focus-backdrop';
  overlay.innerHTML = `
    <div class="card-focus-stage">
      ${habitCard(habit, stats, cardOpts)}
      <p class="card-focus-hint">Glisse la carte pour la faire pivoter • Pivote-la à deux doigts pour la faire tourner sur elle-même</p>
      <button class="btn-primary card-focus-detail" id="card-focus-open">Voir le détail</button>
    </div>`;
  document.body.appendChild(overlay);
  const card = overlay.querySelector('.pcard');
  requestAnimationFrame(() => overlay.classList.add('show'));

  const close = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 260);
  };
  // The card's position never changes — only its orientation does. A real
  // turn is consumed here so letting go of it doesn't also close the view;
  // a plain tap (or tapping the backdrop) still does, and the detail button
  // keeps its own handler so it never triggers either.
  const turn = fxBindCardTurn(card);
  overlay.addEventListener('click', e => {
    if (e.target.closest('#card-focus-open')) return;
    if (turn.consumeDrag()) return;
    close();
  });
  overlay.querySelector('#card-focus-open').addEventListener('click', () => {
    close();
    navigate('/habit/' + habit.id);
  });
}

const STATUS_LABEL = {
  success: 'Tenu', failed: 'Non tenu', frozen: 'Gelé', created: 'Pas encore fait', no_data: 'Sans réponse',
};

// A day used to collapse into one colour even when it held a mix of kept and
// broken promises. Tapping it now shows every card that was live that day,
// each stamped with its own verdict — the information the aggregate colour
// was throwing away.
function openDaySheet(iso) {
  const rows = checksOnDate(iso);
  const [y, m, d] = iso.split('-');
  const label = `${Number(d)} ${MONTH_LABELS[Number(m) - 1]} ${y}`;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-sheet day-sheet" role="dialog" aria-modal="true">
      <h3>${label}</h3>
      ${rows.length ? `
        <div class="day-rows">
          ${rows.map(({ check, habit }) => `
            <button type="button" class="day-row" data-habit="${habit.id}">
              ${icon(themeById(habit.theme).id, 18)}
              <span class="day-row-title">${esc(habit.title)}</span>
              <span class="day-row-status is-${check.status}">${STATUS_LABEL[check.status] || check.status}</span>
              ${check.reason ? `<span class="day-row-reason">${esc(reasonLabel(check.reason))}</span>` : ''}
            </button>`).join('')}
        </div>`
        : `<p>Aucune promesse ce jour-là.</p>`}
      <button class="btn-secondary" id="day-close">Fermer</button>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('#day-close').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.querySelectorAll('[data-habit]').forEach(el =>
    el.addEventListener('click', () => { close(); navigate('/habit/' + el.dataset.habit); }));
}

// ---------- Détail d'une carte ----------
// No editing screen, deliberately: a promise that can be rewritten stops being
// a record of what was actually said. The only way out is abandoning it
// outright — to the cemetery, not into oblivion.

function screenHabitDetail(habitId) {
  const habit = store.habits.find(h => h.id === habitId) || store.cemetery.find(h => h.id === habitId);
  if (!habit) return { redirect: '/home' };
  const dead = habit.active === false;

  const stats = habitStats(habit);
  const own = store.checks.filter(c => c.habit_id === habit.id);
  const decided = own.filter(c => c.status === 'success' || c.status === 'failed');

  const byDow = Array.from({ length: 7 }, () => ({ ok: 0, n: 0 }));
  decided.forEach(c => { const d = dowOf(c.date); byDow[d].n++; if (c.status === 'success') byDow[d].ok++; });
  const eligible = byDow.map((v, d) => ({ d, rate: v.n ? v.ok / v.n : null, n: v.n })).filter(x => x.n >= 3);

  let lines = '';
  if (eligible.length) {
    const best = eligible.reduce((a, b) => (b.rate > a.rate ? b : a));
    const worst = eligible.reduce((a, b) => (b.rate < a.rate ? b : a));
    if (best.rate > 0) lines += `<div class="stat-line">Ton meilleur jour est le <strong>${DOW_FULL[best.d]}</strong>.</div>`;
    if (worst.rate < 1 && worst.d !== best.d) lines += `<div class="stat-line">Tes échecs arrivent surtout le <strong>${DOW_FULL[worst.d]}</strong>.</div>`;
  }

  // Where the failures came from, when there's enough to be honest about.
  const reasoned = own.filter(c => c.status === 'failed' && c.reason);
  let reasonLine = '';
  if (reasoned.length >= 3) {
    const counts = {};
    reasoned.forEach(c => { counts[c.reason] = (counts[c.reason] || 0) + 1; });
    const [topId, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    reasonLine = `<div class="stat-line">Quand tu la romps, c'est surtout « <strong>${esc(reasonLabel(topId))}</strong> » (${n} fois sur ${reasoned.length}).</div>`;
  }
  const expiredN = own.filter(c => c.status === 'failed' && c.expired).length;
  const expiredLine = expiredN
    ? `<div class="stat-line"><strong>${expiredN}</strong> fois, tu n'as simplement pas répondu dans l'heure.</div>`
    : '';

  const html = `
    <div class="detail-card">${habitCard(habit, stats, dead ? { dead: true, deathDate: formatDay(habit.deleted_at?.slice(0, 10)) } : {})}</div>
    <div class="card">
      <div class="stat-line">Promise <strong>${stats.total}</strong> fois. Tenue <strong>${stats.kept}</strong> fois.</div>
      ${lines}
      ${reasonLine}
      ${expiredLine}
      <div class="stat-line">${dead
        ? `Elle a tenu <strong>${stats.daysAlive}</strong> jour${stats.daysAlive > 1 ? 's' : ''}, jusqu'à son abandon.`
        : `Elle survit depuis <strong>${stats.daysAlive}</strong> jour${stats.daysAlive > 1 ? 's' : ''}.`}</div>
    </div>
    ${dead ? '' : `
    <button class="reminder-row" id="edit-reminder-time">
      <span>Rappel à <strong>${(habit.reminder_time || '20:00').slice(0, 5)}</strong></span>
      <span class="reminder-row-edit">Modifier l'heure</span>
    </button>`}
    ${dead ? '' : '<button class="btn-danger-text" id="delete-habit">Abandonner cette promesse</button>'}`;

  return {
    title: habit.title, tab: '/home', chrome: true, back: '/home', html,
    wire(host) {
      fxBindTilt(host);
      const del = host.querySelector('#delete-habit');
      if (del) del.addEventListener('click', () => openDeleteSheet(habit));
      const editTime = host.querySelector('#edit-reminder-time');
      if (editTime) editTime.addEventListener('click', () => openReminderTimeSheet(habit));
    },
  };
}

// The one field a promise may change after creation — see updateReminderTime.
function openReminderTimeSheet(habit) {
  const current = (habit.reminder_time || '20:00').slice(0, 5);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-sheet" role="dialog" aria-modal="true">
      <h3>Modifier l'heure de rappel</h3>
      <p>Le titre, le thème et le rythme restent figés. Seule l'heure peut changer.</p>
      <div class="form-group">
        <label for="rt-time">Heure de vérification</label>
        <input type="time" id="rt-time" value="${current}" />
      </div>
      <p class="reminder-error" id="rt-error" hidden>Cette promesse attend encore ta réponse aujourd'hui. Réessaie une fois qu'elle est résolue.</p>
      <button class="btn-primary" id="rt-save">Enregistrer</button>
      <button class="btn-ghost" id="rt-cancel">Annuler</button>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('#rt-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#rt-save').addEventListener('click', async () => {
    const value = backdrop.querySelector('#rt-time').value;
    if (!value) return;
    const res = await updateReminderTime(habit.id, value);
    if (res.error === 'live') {
      backdrop.querySelector('#rt-error').hidden = false;
      return;
    }
    close();
    renderRoute();
  });
}

function openDeleteSheet(habit) {
  const streak = habit.current_streak || 0;
  const stats = habitStats(habit);
  const tier = tierFor(stats.daysAlive);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-sheet" role="dialog" aria-modal="true">
      <h3>Abandonner « ${esc(habit.title)} » ?</h3>
      <p>Ta carte <strong>${tier.label}</strong> de ${stats.daysAlive} jour${stats.daysAlive > 1 ? 's' : ''}${streak > 0 ? ` et ta série de <strong>${streak} jour${streak > 1 ? 's' : ''}</strong>` : ''} disparaîtront. Cette action est définitive.</p>
      <button class="btn-primary" id="sheet-keep">Garder ma carte</button>
      <button class="btn-ghost-danger" id="sheet-delete">Abandonner quand même</button>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('#sheet-keep').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#sheet-delete').addEventListener('click', async () => {
    close();
    await deleteHabit(habit.id);
    navigate('/home');
  });
}
