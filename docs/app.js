const sb = window.supabase.createClient(
  window.MIRROIR_CONFIG.supabaseUrl,
  window.MIRROIR_CONFIG.supabaseKey
);

const DOW_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTH_LABELS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

const CHECK_SVG = '<svg viewBox="0 0 16 16"><path d="M3 8.5L6.5 12L13 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CROSS_SVG = '<svg viewBox="0 0 16 16"><path d="M4 4L12 12M12 4L4 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const SURPRISE_MESSAGES = [
  'Jour parfait.',
  'Tu tiens le rythme.',
  'Plus régulier que la moyenne cette semaine.',
];

const GUILT_MESSAGES = (title, failCount, total) => [
  `Tu as échoué ${failCount} fois sur tes ${total} derniers jours pour "${title}". Encore une fois ?`,
  `"${title}" : tu abandonnes plus souvent que tu ne tiens. On continue comme ça ?`,
  `Ta promesse "${title}" part en fumée. Dernière chance aujourd'hui.`,
];

const state = {
  user: null,
  habits: [],
  notifiedThisSession: new Set(),
};

function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function todayStr() { return dateStr(new Date()); }
function currentMonthKey() { return todayStr().slice(0, 7); }
function dowOf(isoDate) { const [y,m,d] = isoDate.split('-').map(Number); return new Date(y, m-1, d).getDay(); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function vibrate(pattern) { if (navigator.vibrate) navigator.vibrate(pattern); }

// ---------- Data layer ----------

async function ensureProfileTimezone() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
  await sb.from('profiles').update({ timezone: tz }).eq('id', state.user.id);
}

async function closeStaleChecks() {
  await sb.from('habit_checks').update({ status: 'no_data' }).lt('date', todayStr()).eq('status', 'created');
}

async function ensureTodayChecks() {
  const today = todayStr();
  const d = dowOf(today);
  for (const h of state.habits) {
    if (!h.active) continue;
    if (!h.target_days.includes(d)) continue;
    if (today < h.start_date) continue;
    if (h.end_date && today > h.end_date) continue;
    const { data: existing } = await sb.from('habit_checks').select('id').eq('habit_id', h.id).eq('date', today).maybeSingle();
    if (!existing) {
      await sb.from('habit_checks').insert({ habit_id: h.id, date: today, status: 'created' });
    }
  }
}

async function loadHabits() {
  const { data } = await sb.from('habits').select('*').eq('active', true).order('created_at');
  state.habits = data || [];
}

async function refreshData() {
  await loadHabits();
  await closeStaleChecks();
  await ensureTodayChecks();
}

async function markCheck(checkId, habitId, status) {
  await sb.from('habit_checks').update({ status }).eq('id', checkId);
  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return null;
  if (status === 'success') {
    const newStreak = (habit.current_streak || 0) + 1;
    const newBest = Math.max(habit.best_streak || 0, newStreak);
    await sb.from('habits').update({ current_streak: newStreak, best_streak: newBest }).eq('id', habitId);
    habit.current_streak = newStreak;
    habit.best_streak = newBest;
  } else if (status === 'failed') {
    await sb.from('habits').update({ current_streak: 0 }).eq('id', habitId);
    habit.current_streak = 0;
  }
  return habit;
}

async function freezeCheck(checkId, habitId) {
  const habit = state.habits.find(h => h.id === habitId);
  const ym = currentMonthKey();
  if (!habit || habit.freeze_used_month === ym) return;
  await sb.from('habit_checks').update({ status: 'frozen' }).eq('id', checkId);
  await sb.from('habits').update({ freeze_used_month: ym }).eq('id', habitId);
  habit.freeze_used_month = ym;
}

// ---------- Router ----------

const routes = { '/login': renderLogin, '/today': renderToday, '/home': renderHome, '/new': renderNewHabit, '/history': renderHistory };

function currentRoute() {
  const hash = location.hash.replace(/^#/, '') || '/today';
  const match = hash.match(/^\/habit\/(.+)$/);
  if (match) return { path: '/habit', id: match[1] };
  return { path: hash };
}

async function render() {
  const app = document.getElementById('app');
  const route = currentRoute();

  if (!state.user) {
    app.innerHTML = '';
    if (!localStorage.getItem('mirroir_onboarded')) {
      renderOnboarding(app);
    } else {
      await renderLogin(app);
    }
    return;
  }

  app.innerHTML = '<div class="screen"><p class="empty-state">Chargement…</p></div>';
  try {
    await refreshData();
  } catch (e) {
    console.error(e);
  }

  if (route.path === '/habit') {
    await renderHabitDetail(app, route.id);
  } else if (routes[route.path]) {
    await routes[route.path](app);
  } else {
    location.hash = '#/today';
  }
  checkReminders();
}

window.addEventListener('hashchange', render);

// ---------- Onboarding ----------

function renderOnboarding(app) {
  const slides = [
    {
      eyebrow: 'MIRROIR',
      title: 'Tu as dit que tu allais le faire.',
      body: "On ne compte pas les intentions. On compte ce qui s'est vraiment passé.",
    },
    {
      eyebrow: 'Un exemple concret',
      title: 'Aucune place pour l’à-peu-près.',
      body: 'Chaque promesse devient une série de faits, jour après jour.',
      example: { title: 'Je dors avant 23h', line: '31 promesses. 18 tenues. 13 rompues.' },
    },
    {
      eyebrow: 'Aucune excuse, aucun mensonge',
      title: 'Pas de coach, pas de likes.',
      body: 'Juste le miroir.',
    },
  ];

  let i = 0;

  function paint() {
    const s = slides[i];
    app.innerHTML = `
      <div class="onboard-wrap">
        <div class="onboard-slide">
          <div class="eyebrow">${esc(s.eyebrow)}</div>
          <h2>${esc(s.title)}</h2>
          <p>${esc(s.body)}</p>
          ${s.example ? `
            <div class="onboard-example">
              <div class="ex-title">${esc(s.example.title)}</div>
              <div>${esc(s.example.line)}</div>
            </div>` : ''}
        </div>
        <div class="onboard-dots">
          ${slides.map((_, idx) => `<span class="${idx === i ? 'active' : ''}"></span>`).join('')}
        </div>
        <div class="onboard-actions">
          <button class="btn-skip" id="ob-skip">Passer</button>
          <button class="btn-primary" id="ob-next">${i === slides.length - 1 ? 'Commencer' : 'Suivant'}</button>
        </div>
      </div>
    `;
    app.querySelector('#ob-skip').addEventListener('click', finish);
    app.querySelector('#ob-next').addEventListener('click', () => {
      if (i === slides.length - 1) finish();
      else { i++; paint(); }
    });
  }

  function finish() {
    localStorage.setItem('mirroir_onboarded', '1');
    renderLogin(app);
  }

  paint();
}

// ---------- Auth screen ----------

const PSEUDO_DOMAIN = 'mirroir.local';
const PSEUDO_RE = /^[a-zA-Z0-9_.-]{3,20}$/;
const PASSWORD_RE = /^(?=.*\d).{8,}$/;

function pseudoToEmail(pseudo) {
  return `${pseudo.toLowerCase()}@${PSEUDO_DOMAIN}`;
}

async function renderLogin(app) {
  let mode = 'signin';
  app.innerHTML = `
    <div class="auth-wrap">
      <h1>MIRROIR</h1>
      <p class="tagline">Tu as dit que tu allais le faire. Est-ce que tu l'as fait ?</p>
      <div class="auth-tabs">
        <button data-mode="signin" class="active">Connexion</button>
        <button data-mode="signup">Inscription</button>
      </div>
      <div class="form-group"><label>Pseudo</label><input type="text" id="auth-pseudo" autocomplete="username" autocapitalize="none" /></div>
      <div class="form-group"><label>Mot de passe</label><input type="password" id="auth-password" autocomplete="current-password" /></div>
      <p class="hint-msg" id="pw-hint" style="display:none">8 caractères minimum, avec au moins un chiffre.</p>
      <button class="btn-primary" id="auth-submit">Se connecter</button>
      <p class="error-msg" id="auth-error" style="display:none"></p>
    </div>
  `;

  const errorEl = app.querySelector('#auth-error');
  const hintEl = app.querySelector('#pw-hint');
  const submitBtn = app.querySelector('#auth-submit');
  const tabs = app.querySelectorAll('.auth-tabs button');

  tabs.forEach(tab => tab.addEventListener('click', () => {
    mode = tab.dataset.mode;
    tabs.forEach(t => t.classList.toggle('active', t === tab));
    submitBtn.textContent = mode === 'signin' ? 'Se connecter' : "Créer mon compte";
    hintEl.style.display = mode === 'signup' ? 'block' : 'none';
  }));

  submitBtn.addEventListener('click', async () => {
    errorEl.style.display = 'none';
    const pseudo = app.querySelector('#auth-pseudo').value.trim();
    const password = app.querySelector('#auth-password').value;
    if (!pseudo || !password) {
      errorEl.textContent = 'Pseudo et mot de passe requis.';
      errorEl.style.display = 'block';
      return;
    }
    if (!PSEUDO_RE.test(pseudo)) {
      errorEl.textContent = 'Le pseudo doit faire 3 à 20 caractères (lettres, chiffres, . _ -).';
      errorEl.style.display = 'block';
      return;
    }
    if (mode === 'signup' && !PASSWORD_RE.test(password)) {
      errorEl.textContent = 'Le mot de passe doit faire au moins 8 caractères et contenir un chiffre.';
      errorEl.style.display = 'block';
      return;
    }

    const email = pseudoToEmail(pseudo);
    submitBtn.disabled = true;
    const { error } = mode === 'signin'
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password, options: { data: { pseudo } } });
    submitBtn.disabled = false;
    if (error) {
      if (/already registered|already exists/i.test(error.message)) {
        errorEl.textContent = 'Ce pseudo est déjà pris.';
      } else if (/invalid login credentials/i.test(error.message)) {
        errorEl.textContent = 'Pseudo ou mot de passe incorrect.';
      } else {
        errorEl.textContent = error.message;
      }
      errorEl.style.display = 'block';
    }
  });
}

// ---------- Shell (tabbar + topbar) ----------

function shell(title, content, activeTab) {
  const tabs = [
    { id: '/today', icon: '◎', label: 'Aujourd’hui' },
    { id: '/home', icon: '▦', label: 'Miroir' },
    { id: '/new', icon: '+', label: 'Nouvelle' },
    { id: '/history', icon: '▤', label: 'Historique' },
  ];
  return `
    <div class="topbar">
      <h1>${esc(title)}</h1>
      <button class="icon-btn" id="signout-btn">Déconnexion</button>
    </div>
    <div class="screen">${content}</div>
    <div class="tabbar">
      ${tabs.map(t => `<button data-nav="${t.id}" class="${t.id === activeTab ? 'active' : ''}"><span class="tab-icon">${t.icon}</span>${t.label}</button>`).join('')}
    </div>
  `;
}

function wireShell(app) {
  app.querySelectorAll('[data-nav]').forEach(btn => btn.addEventListener('click', () => { location.hash = '#' + btn.dataset.nav; }));
  const signout = app.querySelector('#signout-btn');
  if (signout) signout.addEventListener('click', async () => { await sb.auth.signOut(); });
}

function showSurpriseToast(app, text) {
  const toast = document.createElement('div');
  toast.className = 'surprise-toast';
  toast.textContent = text;
  app.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 500);
  }, 2200);
}

// ---------- Objectifs du jour ----------

async function renderToday(app) {
  const today = todayStr();
  const { data: checks } = await sb
    .from('habit_checks')
    .select('id, status, habit_id, habits(title, current_streak, freeze_used_month)')
    .eq('date', today)
    .eq('status', 'created');

  const items = checks || [];
  const notifBanner = ('Notification' in window && Notification.permission === 'default' && state.habits.length > 0)
    ? `<div class="card" id="notif-banner">
        <div class="stat-line">Active les rappels pour recevoir une notification à l'heure de vérification de chaque promesse.</div>
        <button class="btn-secondary" id="notif-enable">Activer les rappels</button>
      </div>`
    : '';

  const content = notifBanner + (items.length === 0
    ? '<p class="empty-state">Rien en attente aujourd’hui.</p>'
    : items.map(c => {
      const streak = c.habits?.current_streak || 0;
      const freezeAvailable = streak > 0 && c.habits?.freeze_used_month !== currentMonthKey();
      return `
      <div class="card check-row" data-check="${c.id}" data-habit="${c.habit_id}">
        <div>
          <span class="title">${esc(c.habits?.title || '')}</span>
          ${streak > 0 ? `<div class="streak-line">🔥 Série de ${streak} jour${streak > 1 ? 's' : ''}</div>` : ''}
        </div>
        <div class="check-actions">
          ${freezeAvailable ? `<button class="btn-freeze" data-freeze="${c.id}" data-freeze-habit="${c.habit_id}" title="Geler ce jour (1x/mois, gratuit)">❄️</button>` : ''}
          <button class="btn-yes" data-check="${c.id}" data-habit="${c.habit_id}" data-value="success">Fait</button>
          <button class="btn-no" data-check="${c.id}" data-habit="${c.habit_id}" data-value="failed">Pas fait</button>
        </div>
      </div>
    `;
    }).join(''));

  app.innerHTML = shell('Objectifs du jour', content, '/today');
  wireShell(app);
  const notifBtn = app.querySelector('#notif-enable');
  if (notifBtn) notifBtn.addEventListener('click', async () => { await Notification.requestPermission(); render(); });

  app.querySelectorAll('[data-freeze]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await freezeCheck(btn.dataset.freeze, btn.dataset.freezeHabit);
      render();
    });
  });

  app.querySelectorAll('[data-check][data-value]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const checkId = btn.dataset.check;
      const habitId = btn.dataset.habit;
      const status = btn.dataset.value;
      const row = btn.closest('.check-row');
      const otherBtn = row.querySelector(status === 'success' ? '.btn-no' : '.btn-yes');
      const freezeBtn = row.querySelector('.btn-freeze');

      row.querySelectorAll('button').forEach(b => b.disabled = true);
      btn.classList.add('done');
      btn.innerHTML = (status === 'success' ? CHECK_SVG : CROSS_SVG) + btn.innerHTML;
      row.classList.add(status === 'success' ? 'pending-success' : 'pending-failed');
      if (otherBtn) otherBtn.style.display = 'none';
      if (freezeBtn) freezeBtn.style.display = 'none';

      vibrate(status === 'success' ? 25 : [10, 40, 60]);

      const habit = await markCheck(checkId, habitId, status);

      if (status === 'success' && habit) {
        const badge = document.createElement('span');
        badge.className = 'streak-badge pop';
        badge.textContent = `+1 (${habit.current_streak})`;
        row.querySelector('.title').after(badge);

        if (Math.random() < 0.15) {
          const msg = SURPRISE_MESSAGES[Math.floor(Math.random() * SURPRISE_MESSAGES.length)];
          showSurpriseToast(app, msg);
        }
      }

      setTimeout(() => {
        row.classList.add('leaving');
        setTimeout(render, 480);
      }, 550);
    });
  });
}

// ---------- Mon miroir (accueil) ----------

async function renderHome(app) {
  const { data: allChecks } = await sb.from('habit_checks').select('habit_id, status');
  const decided = (allChecks || []).filter(c => c.status === 'success' || c.status === 'failed');
  const successCount = decided.filter(c => c.status === 'success').length;
  const globalPct = decided.length ? Math.round((successCount / decided.length) * 100) : null;

  let socialLine = '';
  try {
    const { data: rows } = await sb.rpc('global_today_success_rate');
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row && row.success_rate !== null && row.sample_size >= 5) {
      socialLine = `<div class="score-social"><b>${Math.round(row.success_rate)}%</b> des gens comme toi ont réussi aujourd'hui.</div>`;
    }
  } catch (e) { /* aggregate stat is best-effort */ }

  const habitRows = state.habits.map(h => {
    const own = decided.filter(c => c.habit_id === h.id);
    const s = own.filter(c => c.status === 'success').length;
    const pct = own.length ? Math.round((s / own.length) * 100) : null;
    const streak = h.current_streak || 0;
    return `<div class="habit-row" data-habit="${h.id}">
      <div>
        <span class="title">${esc(h.title)}</span>
        ${streak > 0 ? `<div class="streak-mini">🔥 ${streak}</div>` : ''}
      </div>
      <span class="rate-num">${pct === null ? '—' : pct + '%'}</span>
    </div>`;
  }).join('') || '<p class="empty-state">Aucune promesse pour l’instant.</p>';

  const phrase = globalPct === null
    ? 'Pas encore assez de données.'
    : `Tu tiens ${globalPct}% de tes engagements.`;

  const ringR = 78;
  const circumference = 2 * Math.PI * ringR;
  const pctForRing = globalPct === null ? 0 : globalPct;
  const dashoffset = circumference * (1 - pctForRing / 100);
  const displayScore = globalPct === null ? '—' : `${globalPct}%`;

  const content = `
    <div class="score-hero">
      <div class="score-ring-wrap">
        <svg viewBox="0 0 176 176">
          <circle class="score-ring-track" cx="88" cy="88" r="${ringR}" />
          <circle class="score-ring-value" cx="88" cy="88" r="${ringR}"
            stroke-dasharray="${circumference}" stroke-dashoffset="${dashoffset}" />
        </svg>
        <div class="score-ring-center">
          <div class="score-num-wrap">
            <div class="score-num">${displayScore}</div>
            <div class="score-num-reflection" aria-hidden="true">${displayScore}</div>
          </div>
        </div>
      </div>
      <div class="score-phrase">${esc(phrase)}</div>
      ${socialLine}
    </div>
    <div class="card">${habitRows}</div>
  `;

  app.innerHTML = shell('Mon miroir', content, '/home');
  wireShell(app);
  app.querySelectorAll('[data-habit]').forEach(row => row.addEventListener('click', () => { location.hash = '#/habit/' + row.dataset.habit; }));
}

// ---------- Nouvelle promesse ----------

async function renderNewHabit(app) {
  let type = 'daily';
  let selectedDays = new Set([1,2,3,4,5,6,0]);

  const content = `
    <div class="type-toggle">
      <button data-type="daily" class="selected">Quotidien</button>
      <button data-type="frequency">Fréquence</button>
    </div>
    <div class="form-group">
      <label>Ta promesse</label>
      <input type="text" id="nh-title" placeholder="Ex: Je dors avant 23h" />
    </div>
    <div class="form-group" id="nh-frequency-group" style="display:none">
      <label>Combien de fois par semaine ?</label>
      <input type="number" id="nh-frequency" min="1" max="7" value="3" />
    </div>
    <div class="form-group">
      <label>Jours concernés</label>
      <div class="day-picker" id="nh-days">
        ${[1,2,3,4,5,6,0].map(d => `<button type="button" class="day-chip selected" data-day="${d}">${DOW_LABELS[d]}</button>`).join('')}
      </div>
    </div>
    <div class="form-group">
      <label>Heure de vérification</label>
      <input type="time" id="nh-time" value="20:00" />
    </div>
    <div class="form-group">
      <label>Date de fin (optionnel)</label>
      <input type="date" id="nh-end" />
    </div>
    <button class="btn-primary" id="nh-submit">Créer la promesse</button>
    <p class="error-msg" id="nh-error" style="display:none"></p>
  `;

  app.innerHTML = shell('Nouvelle promesse', content, '/new');
  wireShell(app);

  const typeButtons = app.querySelectorAll('[data-type]');
  const freqGroup = app.querySelector('#nh-frequency-group');
  typeButtons.forEach(btn => btn.addEventListener('click', () => {
    type = btn.dataset.type;
    typeButtons.forEach(b => b.classList.toggle('selected', b === btn));
    freqGroup.style.display = type === 'frequency' ? 'block' : 'none';
  }));

  app.querySelectorAll('.day-chip').forEach(chip => chip.addEventListener('click', () => {
    const day = Number(chip.dataset.day);
    if (selectedDays.has(day)) { selectedDays.delete(day); chip.classList.remove('selected'); }
    else { selectedDays.add(day); chip.classList.add('selected'); }
  }));

  app.querySelector('#nh-submit').addEventListener('click', async () => {
    const errorEl = app.querySelector('#nh-error');
    errorEl.style.display = 'none';
    const title = app.querySelector('#nh-title').value.trim();
    const time = app.querySelector('#nh-time').value || '20:00';
    const end = app.querySelector('#nh-end').value || null;
    const frequency = type === 'frequency' ? Number(app.querySelector('#nh-frequency').value) : null;

    if (!title) { errorEl.textContent = 'Donne un nom à ta promesse.'; errorEl.style.display = 'block'; return; }
    if (selectedDays.size === 0) { errorEl.textContent = 'Sélectionne au moins un jour.'; errorEl.style.display = 'block'; return; }
    if (type === 'frequency' && (!frequency || frequency > selectedDays.size)) {
      errorEl.textContent = 'La fréquence doit être inférieure ou égale au nombre de jours sélectionnés.';
      errorEl.style.display = 'block';
      return;
    }

    const { error } = await sb.from('habits').insert({
      user_id: state.user.id,
      title,
      type,
      frequency,
      target_days: Array.from(selectedDays),
      reminder_time: time,
      start_date: todayStr(),
      end_date: end,
      active: true,
    });

    if (error) { errorEl.textContent = error.message; errorEl.style.display = 'block'; return; }
    location.hash = '#/today';
  });
}

// ---------- Historique (calendrier global) ----------

function buildMonthGrid(year, month) {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${pad(month+1)}-${pad(d)}`);
  return cells;
}

const CAL_LEGEND = [
  { cls: 'success', label: 'Tenu' },
  { cls: 'failed', label: 'Non tenu' },
  { cls: 'frozen', label: 'Gelé' },
  { cls: 'no_data', label: 'Pas de donnée' },
];

async function renderHistory(app, year, month) {
  const now = new Date();
  year = year ?? now.getFullYear();
  month = month ?? now.getMonth();

  const { data: checks } = await sb.from('habit_checks').select('date, status');
  const byDate = {};
  (checks || []).forEach(c => { (byDate[c.date] ||= []).push(c.status); });

  function dayClass(statuses) {
    if (!statuses || statuses.length === 0) return 'empty';
    if (statuses.includes('failed')) return 'failed';
    if (statuses.includes('no_data')) return 'no_data';
    if (statuses.includes('frozen')) return 'frozen';
    if (statuses.includes('success')) return 'success';
    return 'empty';
  }

  const cells = buildMonthGrid(year, month);
  const grid = cells.map(date => {
    if (!date) return '<div class="cal-day empty"></div>';
    const day = Number(date.split('-')[2]);
    const cls = dayClass(byDate[date]);
    return `<div class="cal-day ${cls}">${day}</div>`;
  }).join('');

  const content = `
    <div class="cal-wrap">
      <div class="month-nav">
        <button id="cal-prev">‹</button>
        <span class="label">${MONTH_LABELS[month]} ${year}</span>
        <button id="cal-next">›</button>
      </div>
      <div class="cal-grid">
        ${DOW_LABELS.slice(1).concat(DOW_LABELS[0]).map(l => `<div class="cal-dow">${l}</div>`).join('')}
        ${grid}
      </div>
      <div class="cal-legend">
        ${CAL_LEGEND.map(l => `<div class="cal-legend-item"><span class="cal-legend-swatch ${l.cls}"></span>${l.label}</div>`).join('')}
      </div>
    </div>
  `;

  app.innerHTML = shell('Historique', content, '/history');
  wireShell(app);
  app.querySelector('#cal-prev').addEventListener('click', () => {
    const m = month === 0 ? 11 : month - 1;
    const y = month === 0 ? year - 1 : year;
    renderHistory(app, y, m);
  });
  app.querySelector('#cal-next').addEventListener('click', () => {
    const m = month === 11 ? 0 : month + 1;
    const y = month === 11 ? year + 1 : year;
    renderHistory(app, y, m);
  });
}

// ---------- Détail d'une habitude ----------

async function renderHabitDetail(app, habitId) {
  const habit = state.habits.find(h => h.id === habitId) || (await sb.from('habits').select('*').eq('id', habitId).single()).data;
  if (!habit) { location.hash = '#/home'; return; }

  const { data: checks } = await sb.from('habit_checks').select('date, status').eq('habit_id', habitId).order('date');
  const list = checks || [];
  const decided = list.filter(c => c.status === 'success' || c.status === 'failed');
  const successCount = decided.filter(c => c.status === 'success').length;

  const byDow = Array.from({ length: 7 }, () => ({ success: 0, total: 0 }));
  decided.forEach(c => { const d = dowOf(c.date); byDow[d].total++; if (c.status === 'success') byDow[d].success++; });
  const eligible = byDow.map((v, d) => ({ d, rate: v.total > 0 ? v.success / v.total : null, total: v.total })).filter(x => x.total >= 3);
  let bestLine = '', worstLine = '';
  if (eligible.length > 0) {
    const best = eligible.reduce((a, b) => (b.rate > a.rate ? b : a));
    const worst = eligible.reduce((a, b) => (b.rate < a.rate ? b : a));
    if (best.rate > 0) bestLine = `<div class="stat-line">Ton meilleur jour est le <strong>${DOW_LABELS[best.d]}</strong>.</div>`;
    if (worst.rate < 1 && worst.d !== best.d) worstLine = `<div class="stat-line">Tes échecs arrivent principalement le <strong>${DOW_LABELS[worst.d]}</strong>.</div>`;
  }

  const ageDays = Math.max(0, Math.floor((new Date(todayStr()) - new Date(habit.start_date)) / 86400000));
  const streak = habit.current_streak || 0;
  const best = habit.best_streak || 0;

  const cal = list.map(c => `<div class="cal-day ${c.status === 'created' ? 'empty' : c.status}">${Number(c.date.split('-')[2])}</div>`).join('');

  const content = `
    <div class="card">
      <div class="stat-line streak-line-big">Série actuelle : <strong>${streak} jour${streak > 1 ? 's' : ''}</strong> (record : ${best})</div>
      <div class="stat-line">Tu as promis <strong>"${esc(habit.title)}"</strong> ${decided.length} fois. Tu l'as fait ${successCount} fois.</div>
      ${bestLine}
      ${worstLine}
      <div class="stat-line">Cette habitude existe depuis <strong>${ageDays}</strong> jour${ageDays > 1 ? 's' : ''}.</div>
    </div>
    <div class="card">
      <div class="cal-grid" style="grid-template-columns: repeat(7, 1fr);">${cal}</div>
    </div>
    <button class="btn-danger-text" id="delete-habit-btn">Supprimer cette promesse</button>
  `;

  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" id="back-btn">‹ Retour</button>
      <h1>${esc(habit.title)}</h1>
      <span style="width:60px"></span>
    </div>
    <div class="screen">${content}</div>
  `;
  app.querySelector('#back-btn').addEventListener('click', () => { location.hash = '#/home'; });
  app.querySelector('#delete-habit-btn').addEventListener('click', () => openDeleteModal(app, habit));
}

function openDeleteModal(app, habit) {
  const streak = habit.current_streak || 0;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <h3>Abandonner "${esc(habit.title)}" ?</h3>
      <p>${streak > 0
        ? `Tu vas perdre ta série de <strong>${streak} jour${streak > 1 ? 's' : ''}</strong> et tout l'historique de cette promesse. Cette action est définitive.`
        : `Tout l'historique de cette promesse sera perdu. Cette action est définitive.`}</p>
      <button class="btn-primary" id="modal-keep">Continuer ma série</button>
      <button class="btn-ghost-danger" id="modal-delete">Abandonner quand même</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#modal-keep').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#modal-delete').addEventListener('click', async () => {
    await sb.from('habits').update({ active: false }).eq('id', habit.id);
    backdrop.remove();
    location.hash = '#/home';
  });
}

// ---------- Notifications (mode PWA — voir README pour les limites) ----------

async function reminderBody(habit) {
  const { data } = await sb.from('habit_checks').select('status').eq('habit_id', habit.id).order('date', { ascending: false }).limit(7);
  const decided = (data || []).filter(c => c.status === 'success' || c.status === 'failed');
  const failCount = decided.filter(c => c.status === 'failed').length;
  const failRatio = decided.length ? failCount / decided.length : 0;
  if (decided.length >= 2 && failRatio >= 0.5) {
    const lines = GUILT_MESSAGES(habit.title, failCount, decided.length);
    return lines[Math.floor(Math.random() * lines.length)];
  }
  return `Tu avais promis : ${habit.title}`;
}

async function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  const hh = pad(now.getHours()), mm = pad(now.getMinutes());
  const today = todayStr();
  const d = dowOf(today);

  for (const h of state.habits) {
    if (!h.target_days.includes(d)) continue;
    const [rh, rm] = (h.reminder_time || '20:00').split(':');
    if (rh !== hh || rm !== mm) continue;
    const key = `${h.id}-${today}`;
    if (state.notifiedThisSession.has(key)) continue;
    state.notifiedThisSession.add(key);
    const body = await reminderBody(h);
    navigator.serviceWorker?.ready.then(reg => {
      reg.showNotification('Promesse du jour', { body, icon: 'icons/icon-192.png' });
    });
  }
}

// ---------- Boot ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

sb.auth.onAuthStateChange((event, session) => {
  state.user = session?.user || null;
  if (state.user) ensureProfileTimezone().catch(() => {});
  render();
});

setInterval(() => { if (state.user) checkReminders(); }, 30000);
