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

// Shared chip describing where a pending check sits in its range.
function countdownChip(check) {
  const habit = store.habits.find(h => h.id === check.habit_id);
  if (!habit) return '';
  if (isExpired(check)) {
    return `<p class="countdown is-urgent">${icon('spark', 14)} Le temps est écoulé</p>`;
  }
  const left = minutesLeft(check);
  return `<p class="countdown ${isUrgent(check) ? 'is-urgent' : ''}">
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

// ---------- Aujourd'hui : la story ----------
// Aujourd'hui no longer leads into the ritual through an intro screen and a
// button — it IS the ritual. One real card at a time, full screen, with its
// own tier/série/fissures, not a simplified stand-in. Pending promises come
// first (soonest deadline first — the only part with actual stakes); once
// answered they fall in behind, still visible, as a plain record of the day
// rather than something still owed. No numeric "3 restantes" anywhere — the
// segmented bar at top says where you are without turning it into a score.
// Tap gauche/droite (or the swipe-down to leave) move between cards
// freely, on every card, pending or not — deciding one is never a
// condition for looking at the next.

// Remembers position across a forced re-render (the background reconcile
// can force one if something expires while you're mid-story) so a 30s tick
// doesn't silently snap you back to the first card.
let todayCursorHabitId = null;

function screenToday() {
  const notifBanner = pushBanner();

  if (!store.habits.length) {
    return {
      title: "Aujourd'hui", tab: '/home', chrome: true,
      html: notifBanner + `<div class="empty-rich">
          ${icon('spark', 40)}
          <h3>Aucune promesse.</h3>
          <p>Rien à te reprocher pour l'instant. Ça ne durera pas.</p>
          <button class="btn-primary" data-nav="/new">Faire une promesse</button>
        </div>`,
      wire: host => wireNotifBanner(host),
    };
  }

  const items = todayItems();
  if (!items.length) {
    todayCursorHabitId = null;
    return {
      title: "Aujourd'hui", tab: '/home', chrome: true,
      html: notifBanner + `<div class="empty-rich">
          ${icon('spark', 40)}
          <h3>Repos aujourd'hui.</h3>
          <p>Aucune promesse prévue pour aujourd'hui. Reviens demain.</p>
          <button class="btn-secondary" data-nav="/home">Voir mon miroir</button>
        </div>`,
      wire: host => wireNotifBanner(host),
    };
  }

  let index = 0;
  if (todayCursorHabitId) {
    const at = items.findIndex(p => p.habit.id === todayCursorHabitId);
    if (at >= 0) index = at;
  }
  const totalCount = items.length;

  function mount(host) {
    if (index >= items.length) { todayCursorHabitId = null; return mountSummary(host); }

    const { check, habit } = items[index];
    const pending = check.status === 'created';
    // A day already failed — declared "pas fait" or silently ignored — can
    // still be decaled: it reopens in the same stroke, today only, without
    // touching the habit's real reminder_time. A kept or frozen day is a
    // real decision, not a mistake to walk back, so it gets nothing here.
    // One do-over only: once a reopened check fails again, `reopened` is
    // already set and "Décaler" is gone for good on that day's own row —
    // otherwise a repeat failure would just offer another reopen, forever.
    const decalable = pending || (check.status === 'failed' && !check.reopened);
    todayCursorHabitId = habit.id;
    const stats = habitStats(habit);
    const theme = themeById(habit.theme);
    const tier = tierFor(stats.daysAlive, stats.vitality);
    const vitState = stats.vitalityState || 'pleine';
    // The screen's own colour, not a stand-in card's — same rule as
    // everywhere else since PR #36: vitality decides it, not theme, not
    // today's answer. Only the pending bands below (red/amber/green) speak
    // to today specifically.
    const story = vitalityStory(vitState);

    let timeBand = '';
    if (pending) {
      const elapsed = rangeElapsed(habit, check.date);
      timeBand = elapsed < 1 / 3 ? 'green' : elapsed < 2 / 3 ? 'amber' : 'red';
    }

    const snoozeLine = check.snooze_count
      ? `<p class="ritual-snooze-line">Repoussée ${check.snooze_count} fois aujourd'hui</p>`
      : '';
    const statusLine = pending ? '' : `
      <p class="ritual-status is-${check.status}">${STATUS_LABEL[check.status] || check.status}${check.reason ? ` · ${esc(reasonLabel(check.reason))}` : check.expired ? ' · sans réponse' : ''}</p>`;

    // No stand-in card here any more — the story shows the real numbers
    // (tier, vitality, taux, jours) directly. band-*/vit-*/tier-* land on
    // the story root itself, the same vocabulary .pcard used to carry.
    host.innerHTML = `
      <div class="ritual rs-story vit-${vitState} tier-${tier.id} ${timeBand ? 'band-' + timeBand : ''}"
        data-habit="${habit.id}" style="--story-bg:${story.gradient}">
        <button class="rs-story-tap rs-story-tap-prev" data-tap="prev" aria-label="Carte précédente"></button>
        <button class="rs-story-tap rs-story-tap-next" data-tap="next" aria-label="Carte suivante"></button>

        <div class="ritual-top">
          <div class="ritual-progress">
            ${Array.from({ length: totalCount }, (_, i) =>
              `<span class="${i < index ? 'done' : i === index ? 'now' : ''}"></span>`).join('')}
          </div>
          <div class="rs-story-head">
            <span class="rs-story-icon" aria-hidden="true">${icon(theme.id, 15)}</span>
            <span class="rs-story-name">${esc(habit.title)}</span>
            <button class="ritual-quit" id="ritual-quit" aria-label="Quitter">${icon('cross', 20)}</button>
          </div>
        </div>

        <div class="ritual-body">
          <div class="rs-story-tier-emoji" aria-hidden="true">${tier.emoji}</div>
          <span class="rs-story-tier-label">${tier.label}</span>
          <h2 class="rs-story-title">${esc(habit.title)}</h2>

          <div class="rs-story-vitality">
            <div class="rs-story-vitality-row"><span>Vitalité</span><span>${Math.round(stats.vitality ?? 100)}%</span></div>
            <div class="rs-story-vitality-track"><div class="rs-story-vitality-fill" style="width:${Math.max(2, Math.min(100, stats.vitality ?? 100))}%"></div></div>
          </div>

          <div class="rs-story-stats">
            <div class="rs-story-stat"><span class="v">${stats.rate === null ? '—' : stats.rate + '%'}</span><span class="k">Taux</span></div>
            <div class="rs-story-stat"><span class="v">${daysCount(stats.daysAlive)}</span><span class="k">Jours</span></div>
          </div>

          ${weekStripHTML(stats.week)}

          ${pending ? countdownChip(check) : statusLine}
          ${snoozeLine}
        </div>

        ${pending
          ? `<div class="ritual-actions">
          <button class="ritual-btn is-no" data-verdict="failed">${icon('cross', 22)}<span>Pas fait</span></button>
          <button class="ritual-btn is-yes" data-verdict="success">${icon('check', 22)}<span>Fait</span></button>
        </div>`
          : decalable
          ? `<div class="ritual-actions single">
          <button class="ritual-btn is-no" id="ritual-snooze">${icon('history', 22)}<span>Décaler à plus tard</span></button>
        </div>`
          : ''}
      </div>`;

    const stage = host.querySelector('.ritual');

    stage.querySelector('#ritual-quit').addEventListener('click', () => {
      todayCursorHabitId = null;
      navigate('/home');
    });

    // Moving on to another card is always free — deciding this one is never
    // a condition for it, pending or not. Only the actions below actually
    // resolve (or snooze) this specific check. Tap left/right is the only
    // way to move between cards now — no more Précédent/Suivant buttons.
    const goPrev = () => { if (index === 0) return; index--; mount(host); };
    const goNext = () => { index++; mount(host); };
    stage.querySelector('.rs-story-tap-prev').addEventListener('click', goPrev);
    stage.querySelector('.rs-story-tap-next').addEventListener('click', goNext);

    // Swipe down to leave, like closing an Instagram story — a live
    // translateY + fade while dragging, a snap back under the ~90px
    // threshold, a real exit past it.
    let dragStartY = null, dragging = false;
    stage.addEventListener('pointerdown', e => {
      // Skip swipe-down for action buttons; tap zones are buttons too but
      // should still allow a swipe-down if the user drags from the side.
      if (e.target.closest('button') && !e.target.closest('[data-tap]')) return;
      dragStartY = e.clientY;
      dragging = true;
    });
    stage.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dy = Math.max(0, e.clientY - dragStartY);
      stage.style.transform = dy ? `translateY(${dy}px)` : '';
      stage.style.opacity = dy ? String(1 - Math.min(0.6, dy / 300)) : '';
    });
    const endDrag = e => {
      if (!dragging) return;
      dragging = false;
      const dy = Math.max(0, (e.clientY ?? dragStartY) - dragStartY);
      if (dy > 90) {
        todayCursorHabitId = null;
        navigate('/home');
        return;
      }
      stage.style.transform = '';
      stage.style.opacity = '';
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    const snoozeBtn = stage.querySelector('#ritual-snooze');
    if (snoozeBtn) {
      snoozeBtn.addEventListener('click', () => {
        openSnoozeSheet(check, () => {
          index++;
          mount(host);
        });
      });
    }

    stage.querySelectorAll('[data-verdict]').forEach(btn => {
      btn.addEventListener('click', () => {
        stage.querySelectorAll('button').forEach(b => { b.disabled = true; });
        settleVerdict(host, btn.dataset.verdict, check, stage, btn, habit, decalable);
      });
    });
  }

  // The veil + shake/shatter FX that plays once an outcome is actually
  // settled: on "Fait", on "Geler" (from the main card, or from the reason
  // step below when Geler rides along there), and on committing "Pas fait"
  // itself. A sibling of mount() rather than nested in it, since "Geler"
  // can now also fire from mountReason()'s own stage, long after the card
  // that triggered this is gone — takes the live stage and check
  // explicitly instead of closing over either.
  function settleVerdict(host, verdict, check, liveStage, btn, habit, decalable) {
    if (verdict === 'frozen') {
      freezeCheck(check.id);
      vibrate(12);
    } else if (verdict === 'success') {
      markCheck(check.id, verdict);
      vibrate(25);
      if (btn) fxBurstFrom(btn, { count: 54, speed: 8 });
    } else {
      // Commit happens on the reason step so the answer and its reason
      // land as one write instead of two.
      vibrate([10, 40, 60]);
      fxShake(liveStage, 'hard');
      const r = liveStage.getBoundingClientRect();
      fxShatter(r.left + r.width / 2, r.top + r.height * 0.42);
    }

    const veil = document.createElement('div');
    veil.className = `ritual-veil is-${verdict}`;
    veil.innerHTML = icon(verdict === 'success' ? 'check' : verdict === 'frozen' ? 'snow' : 'cross', 72);
    liveStage.appendChild(veil);
    requestAnimationFrame(() => veil.classList.add('show'));

    setTimeout(() => {
      if (verdict === 'failed') return mountReason(host, check, habit, decalable);
      index++;
      mount(host);
    }, 640);
  }

  // Optional, one tap, always skippable — the point is to learn what the
  // failures are made of, not to interrogate anyone. Geler and Décaler ride
  // along on this same page, right after the reason chips, instead of a
  // separate "Comment ça ?" step in between: one screen, not two, and
  // tapping "Pas fait" reads as "still choosing" rather than "already
  // recorded". Both omitted when unavailable (gel déjà pris ce mois,
  // etc.) — same rule as before, just relocated here.
  function mountReason(host, check, habit, decalable) {
    const canFrz = canFreeze(habit);
    host.innerHTML = `
      <div class="ritual reason-step rs-interstitial">
        <div class="ritual-body">
          <p class="ritual-prompt">Pourquoi ?</p>
          <h2 class="ritual-title">Une raison, en un tap.</h2>
          <div class="reason-grid">
            ${REASONS.map(r => `<button class="reason-chip" data-reason="${r.id}">${esc(r.label)}</button>`).join('')}
          </div>
          ${canFrz || decalable ? `
          <div class="ritual-actions single reason-alt-actions">
            ${canFrz ? `<button class="ritual-btn" data-verdict="frozen">${icon('snow', 22)}<span>Geler ce jour</span></button>` : ''}
            ${decalable ? `<button class="ritual-btn" id="reason-snooze">${icon('history', 22)}<span>Décaler à plus tard</span></button>` : ''}
          </div>` : ''}
        </div>
        <div class="ritual-actions single">
          <button class="btn-secondary" id="reason-skip">Ne pas préciser</button>
        </div>
      </div>`;

    const stage = host.querySelector('.ritual');
    const commit = reason => {
      markCheck(check.id, 'failed', reason);
      index++;
      mount(host);
    };
    host.querySelectorAll('[data-reason]').forEach(b =>
      b.addEventListener('click', () => commit(b.dataset.reason)));
    host.querySelector('#reason-skip').addEventListener('click', () => commit(null));

    const freezeBtn = host.querySelector('[data-verdict="frozen"]');
    if (freezeBtn) freezeBtn.addEventListener('click', () => {
      host.querySelectorAll('button').forEach(b => { b.disabled = true; });
      settleVerdict(host, 'frozen', check, stage, freezeBtn, habit, decalable);
    });
    const snoozeBtn = host.querySelector('#reason-snooze');
    if (snoozeBtn) snoozeBtn.addEventListener('click', () => {
      openSnoozeSheet(check, () => { index++; mount(host); });
    });
  }

  function mountSummary(host) {
    const today = todayTally();
    const total = today.kept + today.broken + today.frozen;
    const perfect = total > 0 && today.broken === 0;
    const blanche = today.kept === 0 && total > 0;
    if (perfect && Math.random() < 0.35) {
      setTimeout(() => toast(SURPRISE_MESSAGES[Math.floor(Math.random() * SURPRISE_MESSAGES.length)]), 400);
    }

    // The last card in the story, not a different kind of screen — same
    // full-bleed treatment as every other one, coloured by how the day
    // went rather than by a single habit's vitality (reusing the same
    // gradients, not inventing new ones).
    const dayStory = vitalityStory(perfect ? 'pleine' : blanche ? 'mourante' : 'faiblit');

    host.innerHTML = `
      <div class="ritual rs-story ritual-summary" style="--story-bg:${dayStory.gradient}">
        <button class="rs-story-tap rs-story-tap-next" data-tap="next" aria-label="Voir mon miroir"></button>
        <div class="ritual-body">
          <p class="ritual-prompt">Aujourd'hui</p>
          <h2 class="rs-story-title">${perfect ? 'Rien à te reprocher.' : blanche ? 'Une journée blanche.' : 'Voilà les faits.'}</h2>
          <div class="summary-tallies">
            <div class="tally is-kept"><span class="n">${today.kept}</span><span class="l">tenue${today.kept > 1 ? 's' : ''}</span></div>
            <div class="tally is-broken"><span class="n">${today.broken}</span><span class="l">rompue${today.broken > 1 ? 's' : ''}</span></div>
            ${today.frozen ? `<div class="tally is-frozen"><span class="n">${today.frozen}</span><span class="l">gelée${today.frozen > 1 ? 's' : ''}</span></div>` : ''}
          </div>
        </div>
        <div class="ritual-actions single">
          <button class="btn-primary" id="ritual-done">Voir mon miroir</button>
        </div>
      </div>`;
    // Tallies land one after the other rather than all at once.
    const nums = host.querySelectorAll('.summary-tallies .n');
    const values = [today.kept, today.broken, today.frozen];
    nums.forEach((el, i) => {
      el.textContent = '0';
      setTimeout(() => fxCountUp(el, values[i], { duration: 700 }), 160 + i * 170);
    });

    if (perfect) setTimeout(fxConfetti, 260);

    // Tapping right again, same as every card before it, is one more way
    // out — the explicit button stays for anyone who hasn't picked up on
    // the gesture.
    const goHome = () => navigate('/home');
    host.querySelector('#ritual-done').addEventListener('click', goHome);
    host.querySelector('.rs-story-tap-next').addEventListener('click', goHome);
  }

  return { chrome: false, mount };
}

function wireNotifBanner(host) {
  const nb = host.querySelector('#notif-enable');
  if (!nb) return;
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

// A snooze only ever buys today — never past this same midnight — so the
// choices are all same-day. Deliberately a plain, unassuming sheet: this is
// an escape hatch, not an equal option to Fait/Pas fait.
function openSnoozeSheet(check, onSnoozed) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-sheet" role="dialog" aria-modal="true">
      <h3>Décaler à plus tard aujourd'hui</h3>
      <p>Ça ne change rien pour demain — juste un délai pour aujourd'hui, jamais après minuit.</p>
      <div class="duration-grid">
        <button type="button" class="duration-chip" data-snooze="15">+15 min</button>
        <button type="button" class="duration-chip" data-snooze="30">+30 min</button>
        <button type="button" class="duration-chip" data-snooze="60">+1 h</button>
        <button type="button" class="duration-chip" data-snooze="eod">Jusqu'à 23h59</button>
      </div>
      <button class="btn-ghost" id="snooze-cancel">Annuler</button>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('#snooze-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.querySelectorAll('[data-snooze]').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.snooze;
    snoozeCheck(check.id, v === 'eod' ? 'eod' : Number(v));
    close();
    onSnoozed();
  }));
}

// ---------- Mon miroir ----------

function screenHome() {
  // The hero used to show the lifetime score. Insta-story style now: a
  // small ring for *today* only, tap to open the story, swipe down to
  // return — the lifetime picture lives in Historique, not repeated here.
  const items = todayItems();
  const totalToday = items.length;
  const keptToday = items.filter(x => x.check.status === 'success').length;
  const todayPct = totalToday ? Math.round((keptToday / totalToday) * 100) : null;
  const R = 32, C = 2 * Math.PI * R;
  const ringOffset = todayPct === null ? C : C * (1 - todayPct / 100);
  const streak = store.habits.length ? Math.max(0, ...store.habits.map(h => habitStats(h).streak)) : 0;

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

  // "Terminées" is not the cemetery: reaching a fixed end date on schedule
  // is a natural completion, not a death, and doesn't belong in the same
  // abandoned/neglect framing. Both used to be accordions folded onto this
  // screen; each now gets a real page of its own (see screenCemetery /
  // screenFinished below) and this is just a link into it.
  const buried = store.cemetery.filter(h => h.death_cause !== 'completed');
  const finished = store.cemetery.filter(h => h.death_cause === 'completed');

  const moreLinks = (buried.length || finished.length)
    ? `<section class="rs-more">
         ${buried.length ? `
         <button class="rs-more-link" data-nav="/cemetery">
           <span class="section-glyph" aria-hidden="true">🪦</span>
           <span class="rs-more-link-label">Cimetière</span>
           <span class="deck-count">${buried.length}</span>
           ${icon('right', 16)}
         </button>` : ''}
         ${finished.length ? `
         <button class="rs-more-link" data-nav="/finished">
           <span class="section-glyph" aria-hidden="true">🏆</span>
           <span class="rs-more-link-label">Terminées</span>
           <span class="deck-count">${finished.length}</span>
           ${icon('right', 16)}
         </button>` : ''}
       </section>`
    : '';

  const html = `
    <div class="rs-home-head">
      <div>
        <div class="rs-greeting">Bonjour <span aria-hidden="true">👋</span></div>
        <div class="rs-subgreeting">Voyons où tu en es</div>
      </div>
      <div class="rs-home-head-actions">
        ${streak ? `<div class="rs-streak">${icon('flame', 13)} ${streak}</div>` : ''}
        <button class="rs-ob-replay" id="ob-replay" aria-label="Revoir la présentation">✨</button>
      </div>
    </div>

    <button class="rs-today-banner" id="today-banner" aria-label="Voir Aujourd'hui">
      <span class="rs-today-ring">
        <svg viewBox="0 0 76 76" aria-hidden="true">
          <circle class="rs-ring-track" cx="38" cy="38" r="${R}"></circle>
          <circle class="rs-ring-value" cx="38" cy="38" r="${R}" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}"></circle>
        </svg>
        <span class="rs-today-pct">${todayPct === null ? '—' : todayPct + '%'}</span>
      </span>
      <span class="rs-today-copy">
        <span class="rs-today-title">Aujourd'hui</span>
        <span class="rs-today-sub">${totalToday === 0
          ? "Rien de prévu aujourd'hui."
          : `${keptToday} sur ${totalToday} promesse${totalToday > 1 ? 's' : ''} tenue${keptToday > 1 ? 's' : ''}. Tape pour continuer →`}</span>
      </span>
    </button>

    ${cards}
    ${moreLinks}`;

  return {
    title: 'Mon miroir', tab: '/home', chrome: true, html,
    wire(host) {
      requestAnimationFrame(() => {
        const ring = host.querySelector('.rs-ring-value');
        if (ring) ring.style.strokeDashoffset = ringOffset.toFixed(2);
      });
      fxBindTilt(host);
      wireCardFocus(host, '.deck-grid .pcard[data-habit]', store.habits);

      const banner = host.querySelector('#today-banner');
      if (banner) banner.addEventListener('click', () => navigate('/today'));
      const obBtn = host.querySelector('#ob-replay');
      if (obBtn) obBtn.addEventListener('click', () => openOnboardingReplay());

      celebrateTierUps(host);
    },
  };
}

// Cimetière and Terminées each get a real page now instead of an accordion
// folded onto Mon miroir — reached via the links at the bottom of the deck,
// closed with the normal back button. The cards inside are untouched.
function screenCemetery() {
  const buried = store.cemetery.filter(h => h.death_cause !== 'completed');
  const html = buried.length
    ? `<div class="yard">
         <div class="yard-moon" aria-hidden="true"></div>
         <div class="deck-grid cemetery-grid">
           ${buried.map(h => habitCard(h, habitStats(h), {
             compact: true, habitId: h.id, dead: true,
             deathDate: formatDay(h.deleted_at?.slice(0, 10)), deathCause: h.death_cause,
           })).join('')}
         </div>
       </div>`
    : `<div class="empty-rich">
         <span class="rs-empty-glyph" aria-hidden="true">🪦</span>
         <h3>Le cimetière est vide.</h3>
         <p>Aucune promesse morte ou abandonnée pour l'instant.</p>
       </div>`;

  return {
    title: 'Cimetière', tab: '/home', chrome: true, back: '/home', html,
    wire(host) {
      fxBindTilt(host);
      wireCardFocus(host, '.cemetery-grid .pcard[data-habit]', buried, { dead: true });
    },
  };
}

function screenFinished() {
  const finished = store.cemetery.filter(h => h.death_cause === 'completed');
  const html = finished.length
    ? `<div class="shelf">
         <div class="deck-grid finished-grid">
           ${finished.map(h => habitCard(h, habitStats(h), {
             compact: true, habitId: h.id, finished: true,
             finishedDate: formatDay(h.deleted_at?.slice(0, 10)),
           })).join('')}
         </div>
       </div>`
    : `<div class="empty-rich">
         <span class="rs-empty-glyph" aria-hidden="true">🏆</span>
         <h3>Rien de terminé pour l'instant.</h3>
         <p>Une promesse avec une date de fin atterrit ici une fois arrivée à son terme.</p>
       </div>`;

  return {
    title: 'Terminées', tab: '/home', chrome: true, back: '/home', html,
    wire(host) {
      fxBindTilt(host);
      wireCardFocus(host, '.finished-grid .pcard[data-habit]', finished, { finished: true });
    },
  };
}

// A replay of the same three slides shown at first sign-in, reachable any
// time from the ✨ on Mon miroir. An overlay rather than a route: it isn't
// a place in the app, just a thing you can look at again.
function openOnboardingReplay() {
  const overlay = document.createElement('div');
  overlay.className = 'rs-ob-overlay';
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  screenOnboarding(close).mount(overlay);
}

// A tier now has to be earned on both age and vitality, so it can also be
// lost and reclaimed — celebrated_tier is a high-water mark, never lowered,
// so a dip-and-recovery through a tier already shown doesn't fire again;
// only a genuinely new one, never reached before, does.
function celebrateTierUps(host) {
  const crossed = [];
  for (const h of store.habits) {
    const stats = habitStats(h);
    const tier = tierFor(stats.daysAlive, stats.vitality);
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

// ---------- Nouvelle promesse (parcours guidé) ----------

// How long a promise stays answerable once its range opens — the reminder
// time is only where it starts. A short range is a harder version of the
// same promise: there's no partial credit for answering late.
const WINDOW_PRESETS = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 h' },
  { minutes: 120, label: '2 h' },
  { minutes: 240, label: '4 h' },
  { minutes: 480, label: '8 h' },
];

function screenNewHabit() {
  const draft = {
    title: '', theme: '', type: 'daily', frequency: 3,
    target_days: new Set([1, 2, 3, 4, 5, 6, 0]), reminder_time: '20:00', window_minutes: 60, end_date: '',
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
        <label>Plage pour répondre</label>
        <div class="duration-grid">
          ${WINDOW_PRESETS.map(w => `
            <button type="button" class="duration-chip ${draft.window_minutes === w.minutes ? 'selected' : ''}" data-window="${w.minutes}">${w.label}</button>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label for="nh-end">Date de fin (optionnel)</label>
        <input type="date" id="nh-end" value="${draft.end_date}" />
      </div>
      <p class="hint-msg">Passé ce délai après l'heure de vérification, sans réponse, c'est compté comme non tenu. Tu pourras geler un jour par mois, gratuitement, sans casser ta série.</p>`;
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
    host.querySelectorAll('[data-window]').forEach(b => b.addEventListener('click', () => {
      draft.window_minutes = Number(b.dataset.window); rerender();
    }));
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
        window_minutes: draft.window_minutes,
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

// Historique is now the app's single account of the past. Ma semaine used to
// hold the real analysis behind a button on Mon miroir while this tab showed
// only a calendar — the analysis is here now, and the fixed rolling week it
// was locked to became one preset among four. Two controls govern everything
// below them: which period, and whether we're looking at every promise or
// one. Mon miroir keeps the present (the deck), Historique keeps the past.
function screenHistory() {
  const now = new Date();
  let year = now.getFullYear(), month = now.getMonth();
  let periodDays = 7;
  let scopeId = null;

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

  function periodLabel() {
    return (PERIODS.find(p => p.days === periodDays) || PERIODS[0]).label;
  }

  function verdictFor(s) {
    const delta = s.rate !== null && s.prevRate !== null ? s.rate - s.prevRate : null;
    if (s.rate === null) return 'Rien de décidé sur cette période.';
    if (delta === null) return `Tu as tenu ${s.rate}% sur cette période.`;
    if (delta > 0) return `Tu remontes : ${s.rate}%, soit ${delta} points de plus que la période précédente.`;
    if (delta < 0) return `Tu descends : ${s.rate}%, soit ${Math.abs(delta)} points de moins que la période précédente.`;
    return `Tu stagnes : ${s.rate}%, exactement comme la période précédente.`;
  }

  function mount(host) {
    const all = [...store.habits, ...store.cemetery];
    // A scope pointing at a promise that no longer exists would silently
    // filter everything out — fall back to "toutes" rather than show a
    // blank screen with no explanation.
    if (scopeId !== null && !all.some(h => h.id === scopeId)) scopeId = null;

    const summary = periodSummary(periodDays, scopeId);
    const failures = periodFailures(periodDays, scopeId);
    const insights = buildInsights(periodDays, scopeId);
    const scoped = periodChecks(periodDays, scopeId);

    const byDate = {};
    scoped.forEach(c => { (byDate[c.date] ||= []).push(c.status); });

    const controls = `
      <div class="hist-controls">
        <div class="seg" role="group" aria-label="Période">
          ${PERIODS.map(p => `
            <button type="button" class="seg-btn ${p.days === periodDays ? 'is-on' : ''}"
              data-period="${p.days === null ? 'all' : p.days}">${p.label}</button>`).join('')}
        </div>
        ${all.length ? `
        <label class="hist-scope">
          <span class="hist-scope-label">Portée</span>
          <select id="hist-scope">
            <option value="">Toutes les cartes</option>
            ${all.map(h => `<option value="${h.id}" ${h.id === scopeId ? 'selected' : ''}>${esc(h.title)}${h.active === false ? ' (archivée)' : ''}</option>`).join('')}
          </select>
        </label>` : ''}
      </div>`;

    const timelineBlock = scopeId === null ? '' : (() => {
      const days = periodTimeline(periodDays, scopeId);
      if (!days.length) return '';
      return `
        <section class="hist-timeline">
          <h4 class="section-label">Jour par jour</h4>
          <div class="timeline-strip">
            ${days.map(d => `<span class="timeline-day is-${d.state}" title="${formatDay(d.date)}"></span>`).join('')}
          </div>
          <div class="timeline-ends">
            <span>${formatDay(days[0].date)}</span>
            <span>${formatDay(days[days.length - 1].date)}</span>
          </div>
        </section>`;
    })();

    const insightBlock = insights.length
      ? `<section class="insights">
           <h4 class="section-label">Ce que le miroir voit</h4>
           ${insights.slice(0, 3).map(i => `<div class="insight is-${i.tone}">${icon('spark', 16)}<span>${esc(i.text)}</span></div>`).join('')}
         </section>`
      : '';

    const failuresBlock = failures.length
      ? `<section class="failures">
           <h4 class="section-label">Ce que tu n'as pas tenu <span class="deck-count">${failures.length}</span></h4>
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

    host.innerHTML = `
      ${controls}
      <div class="hist-hero">
        <div class="hist-rate">${summary.rate === null ? '—' : '0%'}</div>
        <p class="hist-verdict">${esc(verdictFor(summary))}</p>
      </div>
      <div class="card week-grid">
        <div class="week-cell is-kept"><span class="n">0</span><span class="l">tenues</span></div>
        <div class="week-cell is-broken"><span class="n">0</span><span class="l">rompues</span></div>
        <div class="week-cell is-frozen"><span class="n">0</span><span class="l">gelées</span></div>
        <div class="week-cell is-missed"><span class="n">0</span><span class="l">sans réponse</span></div>
      </div>
      ${timelineBlock}
      ${insightBlock}
      ${failuresBlock}
      <div class="cal-wrap">
        <h4 class="section-label">Calendrier</h4>
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

    if (summary.rate !== null) fxCountUp(host.querySelector('.hist-rate'), summary.rate, { suffix: '%', duration: 900 });
    const cells = host.querySelectorAll('.week-cell .n');
    [summary.kept, summary.broken, summary.frozen, summary.missed].forEach((v, i) => {
      setTimeout(() => fxCountUp(cells[i], v, { duration: 560 }), 100 + i * 90);
    });

    host.querySelectorAll('.seg-btn[data-period]').forEach(el =>
      el.addEventListener('click', () => {
        const raw = el.dataset.period;
        periodDays = raw === 'all' ? null : Number(raw);
        mount(host);
      }));

    const scopeSel = host.querySelector('#hist-scope');
    if (scopeSel) {
      scopeSel.addEventListener('change', () => {
        scopeId = scopeSel.value || null;
        mount(host);
      });
    }

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
    host.querySelectorAll('.failure-row[data-habit]').forEach(el =>
      el.addEventListener('click', () => navigate('/habit/' + el.dataset.habit)));
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
  const cardOpts = opts.dead
    ? { dead: true, deathDate: formatDay(habit.deleted_at?.slice(0, 10)), deathCause: habit.death_cause }
    : opts.finished
    ? { finished: true, finishedDate: formatDay(habit.deleted_at?.slice(0, 10)) }
    : {};

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

// Stated as a fact about the card, not as a verdict on the person.
const VITALITY_LINE = {
  faiblit: 'Elle commence à faiblir.',
  malade: 'Elle est en train de se fissurer.',
  mourante: 'Elle est mourante. Une rupture de plus peut suffire.',
};

// The payoff of autonomous death. A card that starved while the app was shut
// has to be reported the next time it opens — otherwise it is simply missing
// from the deck with no explanation, which reads as a bug rather than as a
// consequence. This is the one moment the app takes something without asking.
function openDeathNotice(habits) {
  if (!habits.length) return;
  const many = habits.length > 1;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-sheet death-notice" role="dialog" aria-modal="true">
      <h3>${many ? `${habits.length} promesses sont mortes` : 'Une promesse est morte'}</h3>
      <p>Pendant que tu n'étais pas là. Tu ne l'${many ? 'es' : 'as'} pas abandonnée${many ? 's' : ''} —
         tu l'${many ? 'es' : 'as'} laissée${many ? 's' : ''} s'éteindre.</p>
      <div class="death-notice-cards">
        ${habits.map(h => habitCard(h, habitStats(h), {
          compact: true, dead: true,
          deathDate: formatDay(h.deleted_at?.slice(0, 10)), deathCause: 'neglect',
        })).join('')}
      </div>
      <button class="btn-primary" id="death-ack">J'ai vu</button>
    </div>`;
  document.body.appendChild(backdrop);
  fxShake(backdrop.querySelector('.death-notice'), 'hard');
  const card = backdrop.querySelector('.pcard');
  if (card) setTimeout(() => fxBurstFrom(card, { colors: ['#ff3b5c', '#7a1229', '#c9314c'], count: 34, speed: 5 }), 220);

  // Acknowledged on close whichever way it is closed — this must never be
  // shown twice for the same death.
  const close = () => { acknowledgeDeaths(habits); backdrop.remove(); renderRoute(); };
  backdrop.querySelector('#death-ack').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
}

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
  // A naturally completed promise (fixed end date reached) is retired but
  // never "dead" — it gets its own framing, not the cemetery's.
  const finished = habit.death_cause === 'completed';
  const dead = habit.active === false && !finished;

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

  const retired = dead || finished;
  const html = `
    <div class="detail-card">${habitCard(habit, stats, dead
      ? { dead: true, deathDate: formatDay(habit.deleted_at?.slice(0, 10)), deathCause: habit.death_cause }
      : finished
      ? { finished: true, finishedDate: formatDay(habit.deleted_at?.slice(0, 10)) }
      : {})}</div>
    <div class="card">
      <div class="stat-line">Promise <strong>${stats.total}</strong> fois. Tenue <strong>${stats.kept}</strong> fois.</div>
      ${lines}
      ${reasonLine}
      ${expiredLine}
      <div class="stat-line">${
        // A one-day promise's day count is always exactly 1 -- every branch
        // below has a shorter, equally true sentence that doesn't state it.
        isOneDayHabit(habit)
        ? (dead
          ? (habit.death_cause === 'neglect' ? 'Laissée mourir.' : 'Abandonnée.')
          : finished
          ? 'Elle est allée jusqu\'à sa fin prévue.'
          : 'C\'est son unique jour.')
        : dead
        ? `Elle a tenu <strong>${daysCount(stats.daysAlive)}</strong> jour${daysCount(stats.daysAlive) > 1 ? 's' : ''}, ${
            habit.death_cause === 'neglect' ? "jusqu'à ce que tu la laisses mourir." : "jusqu'à son abandon."}`
        : finished
        ? `Elle a tenu <strong>${daysCount(stats.daysAlive)}</strong> jour${daysCount(stats.daysAlive) > 1 ? 's' : ''}, jusqu'à sa fin prévue.`
        : `Elle survit depuis <strong>${daysCount(stats.daysAlive)}</strong> jour${daysCount(stats.daysAlive) > 1 ? 's' : ''}.`}</div>
      ${!retired && stats.vitalityState !== 'pleine' ? `<div class="stat-line">${VITALITY_LINE[stats.vitalityState]}</div>` : ''}
    </div>
    ${retired ? '' : `
    <button class="reminder-row" id="edit-reminder-time">
      <span>Rappel à <strong>${(habit.reminder_time || '20:00').slice(0, 5)}</strong></span>
      <span class="reminder-row-edit">Modifier l'heure</span>
    </button>`}
    ${dead && !habit.resurrected
      ? '<button class="btn-primary" id="resurrect-habit">Ressusciter cette promesse</button>'
      : ''}
    ${retired ? '' : '<button class="btn-danger-text" id="delete-habit">Abandonner cette promesse</button>'}`;

  return {
    title: habit.title, tab: '/home', chrome: true, back: '/home', html,
    wire(host) {
      fxBindTilt(host);
      const del = host.querySelector('#delete-habit');
      if (del) del.addEventListener('click', () => openDeleteSheet(habit));
      const editTime = host.querySelector('#edit-reminder-time');
      if (editTime) editTime.addEventListener('click', () => openReminderTimeSheet(habit));
      const res = host.querySelector('#resurrect-habit');
      if (res) res.addEventListener('click', () => openResurrectSheet(habit));
    },
  };
}

// A resurrection is exactly one decision, ever — it needs the same weight as
// abandoning did, not a casual tap.
function openResurrectSheet(habit) {
  const stats = habitStats(habit);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-sheet" role="dialog" aria-modal="true">
      <h3>Ressusciter « ${esc(habit.title)} » ?</h3>
      <p>Elle repart à <strong>Œuf</strong>, série et palier remis à zéro. Elle portera une cicatrice
         permanente — <strong>${daysCount(stats.daysAlive)} jour${daysCount(stats.daysAlive) > 1 ? 's' : ''} avant sa mort</strong> —
         visible sur la carte pour toujours. Une seule résurrection, à vie : si elle meurt à nouveau, c'est définitif.</p>
      <button class="btn-primary" id="sheet-resurrect">La ressusciter</button>
      <button class="btn-ghost" id="sheet-cancel">Laisser reposer</button>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('#sheet-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#sheet-resurrect').addEventListener('click', async () => {
    close();
    await resurrectHabit(habit.id);
    navigate('/habit/' + habit.id);
  });
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
  const stats = habitStats(habit);
  const tier = tierFor(stats.daysAlive, stats.vitality);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-sheet" role="dialog" aria-modal="true">
      <h3>Abandonner « ${esc(habit.title)} » ?</h3>
      <p>Ta carte <strong>${tier.label}</strong>${isOneDayHabit(habit) ? '' : ` de ${daysCount(stats.daysAlive)} jour${daysCount(stats.daysAlive) > 1 ? 's' : ''}`} disparaîtra. Cette action est définitive.</p>
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
