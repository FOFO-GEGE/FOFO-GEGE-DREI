// Shell, router and boot. The shell is built once; navigating only swaps the
// screen host, so tab changes are instant and never re-fetch.

const TABS = [
  { id: '/today', icon: 'today', label: "Aujourd'hui" },
  { id: '/home', icon: 'mirror', label: 'Miroir' },
  { id: '/new', icon: 'plus', label: 'Nouvelle' },
  { id: '/history', icon: 'history', label: 'Historique' },
];

let shellReady = false;
let currentTab = null;

function buildShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <header class="topbar" id="topbar">
      <button class="icon-btn topbar-back" id="topbar-back" hidden aria-label="Retour">${icon('left', 20)}</button>
      <h1 id="topbar-title"></h1>
      <span class="sync-dot" id="sync-dot" hidden></span>
      <button class="icon-btn" id="signout-btn">Quitter</button>
    </header>
    <main class="screen" id="screen-host"></main>
    <nav class="tabbar" id="tabbar">
      ${TABS.map(t => `<button data-nav="${t.id}">${icon(t.icon, 21, 'tab-icon')}<span>${t.label}</span></button>`).join('')}
    </nav>`;

  app.querySelector('#signout-btn').addEventListener('click', () => sb.auth.signOut());

  // Writes are optimistic, so the user needs a way to see that something has
  // not landed yet — otherwise a failed sync is invisible.
  onSyncChange(state => {
    const dot = document.getElementById('sync-dot');
    if (!dot) return;
    dot.hidden = state === 'idle';
    dot.className = `sync-dot is-${state}`;
    dot.title = state === 'offline'
      ? "Des réponses n'ont pas encore été enregistrées. Nouvelle tentative en cours."
      : 'Enregistrement en cours…';
  });
  app.querySelector('#topbar-back').addEventListener('click', () => {
    const back = app.dataset.back || '/home';
    navigate(back);
  });
  app.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) navigate(nav.dataset.nav);
  });
  shellReady = true;
}

function setChrome(on, screen) {
  const app = document.getElementById('app');
  app.classList.toggle('no-chrome', !on);
  if (!on) return;

  document.getElementById('topbar-title').textContent = screen.title || '';
  const backBtn = document.getElementById('topbar-back');
  backBtn.hidden = !screen.back;
  app.dataset.back = screen.back || '';
  document.getElementById('signout-btn').hidden = !!screen.back;

  if (currentTab !== screen.tab) {
    currentTab = screen.tab;
    document.querySelectorAll('#tabbar [data-nav]').forEach(b =>
      b.classList.toggle('active', b.dataset.nav === screen.tab));
  }
}

function navigate(path) {
  if (location.hash === '#' + path) renderRoute();
  else location.hash = '#' + path;
}

function resolveScreen() {
  const hash = location.hash.replace(/^#/, '') || '/today';
  const habit = hash.match(/^\/habit\/(.+)$/);
  if (habit) return screenHabitDetail(habit[1]);
  const edit = hash.match(/^\/edit\/(.+)$/);
  if (edit) return screenEditHabit(edit[1]);
  switch (hash) {
    case '/today': return screenToday();
    case '/home': return screenHome();
    case '/new': return screenNewHabit();
    case '/history': return screenHistory();
    case '/week': return screenWeek();
    case '/ritual': return screenRitual();
    default: return { redirect: '/today' };
  }
}

function paint(screen) {
  const host = document.getElementById('screen-host');
  const inner = document.createElement('div');
  inner.className = 'screen-inner';
  if (screen.mount) screen.mount(inner);
  else {
    inner.innerHTML = screen.html || '';
    if (screen.wire) screen.wire(inner);
  }
  host.replaceChildren(inner);
  host.scrollTop = 0;
}

function renderRoute() {
  if (!store.user) return renderSignedOut();
  if (!store.loaded) return;

  const screen = resolveScreen();
  if (screen.redirect) return navigate(screen.redirect);
  setChrome(screen.chrome !== false, screen);
  paint(screen);
  checkReminders();
}

function renderSignedOut() {
  const app = document.getElementById('app');
  app.classList.add('no-chrome');
  shellReady = false;
  currentTab = null;

  const show = builder => {
    const inner = document.createElement('div');
    inner.className = 'screen-inner';
    if (builder.mount) builder.mount(inner);
    else { inner.innerHTML = builder.html; if (builder.wire) builder.wire(inner); }
    app.replaceChildren(inner);
  };

  if (!localStorage.getItem('mirroir_onboarded')) {
    show(screenOnboarding(() => {
      localStorage.setItem('mirroir_onboarded', '1');
      show(screenLogin());
    }));
  } else {
    show(screenLogin());
  }
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, 2200);
}

// ---------- Reminders (web fallback: no action buttons, see README) ----------

const notified = new Set();

// The first ping states the promise; the later ones state the clock. Tone
// hardens for habits the user breaks more often than not.
function reminderBody(habit, left) {
  if (left <= 15) return `Il te reste ${left} min pour répondre. Sans réponse, « ${habit.title} » est compté comme non tenu.`;

  const own = store.checks
    .filter(c => c.habit_id === habit.id && (c.status === 'success' || c.status === 'failed'))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 7);
  const fails = own.filter(c => c.status === 'failed').length;

  if (left <= 45) return `« ${habit.title} » — ${left} min avant que ce soit non tenu.`;

  if (own.length >= 2 && fails / own.length >= 0.5) {
    const variants = [
      `Tu as rompu ${fails} fois sur tes ${own.length} derniers jours. Encore aujourd'hui ?`,
      `« ${habit.title} » : tu abandonnes plus souvent que tu ne tiens.`,
      `Ta promesse « ${habit.title} » part en fumée. Une heure pour répondre.`,
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }
  return `Tu avais promis : ${habit.title}. Une heure pour répondre.`;
}

// Fires at the reminder time, then every 15 minutes until the hour is up.
function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const today = todayStr();
  const now = Date.now();

  for (const c of store.checks) {
    if (c.date !== today || c.status !== 'created') continue;
    const habit = store.habits.find(h => h.id === c.habit_id);
    if (!habit) continue;

    const opensAt = windowOpensAt(habit, today).getTime();
    const elapsed = Math.floor((now - opensAt) / 60000);
    if (elapsed < 0 || elapsed >= ANSWER_WINDOW_MIN) continue;

    // Which of the four slots we are in, and only once per slot.
    const step = REMINDER_STEPS.filter(s => elapsed >= s).pop();
    if (step === undefined) continue;
    const key = `${habit.id}-${today}-${step}`;
    if (notified.has(key)) continue;
    notified.add(key);

    const left = ANSWER_WINDOW_MIN - step;
    navigator.serviceWorker?.ready.then(reg =>
      reg.showNotification(left <= 15 ? 'Dernière chance' : 'Promesse du jour', {
        body: reminderBody(habit, left),
        icon: 'icons/icon-192.png',
        tag: `${habit.id}-${today}`,
        renotify: true,
      }));
  }
}

// ---------- Boot ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

window.addEventListener('hashchange', renderRoute);

async function bootSignedIn() {
  if (!shellReady) buildShell();
  const host = document.getElementById('screen-host');
  document.getElementById('app').classList.remove('no-chrome');
  host.replaceChildren(Object.assign(document.createElement('div'), {
    className: 'screen-inner', innerHTML: skeletonHero(),
  }));

  await loadAll();
  renderRoute();

  // Best-effort, non-blocking: refresh the aggregate line once it lands.
  loadSocialRate().then(() => {
    if (location.hash === '#/home' || location.hash === '') renderRoute();
  });
}

async function ensureProfileTimezone() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
  await sb.from('profiles').update({ timezone: tz }).eq('id', store.user.id);
}

sb.auth.onAuthStateChange((event, session) => {
  const user = session?.user || null;
  const changed = user?.id !== store.user?.id;
  store.user = user;
  if (!user) {
    store.loaded = false;
    store.habits = [];
    store.checks = [];
    return renderSignedOut();
  }
  if (changed || !store.loaded) {
    ensureProfileTimezone().catch(() => {});
    bootSignedIn();
  }
});

setInterval(() => { if (store.user && store.loaded) checkReminders(); }, 30000);

// The answer window is a live clock: re-render the pending screen every 30s so
// the countdown ticks, and expire checks the moment their hour runs out.
setInterval(async () => {
  if (!store.user || !store.loaded) return;
  const hadPending = pendingToday().length;
  const expiring = store.checks.some(c => c.status === 'created' && isExpired(c));
  if (expiring) await reconcileToday();
  const onLiveScreen = location.hash === '#/today' || location.hash === '';
  if (expiring || (onLiveScreen && hadPending)) renderRoute();
}, 30000);

// Retry anything still queued when the app comes back to the foreground.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) flushQueue();
});
