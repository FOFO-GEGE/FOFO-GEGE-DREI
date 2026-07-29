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
      <button class="icon-btn" id="signout-btn">Quitter</button>
    </header>
    <main class="screen" id="screen-host"></main>
    <nav class="tabbar" id="tabbar">
      ${TABS.map(t => `<button data-nav="${t.id}">${icon(t.icon, 21, 'tab-icon')}<span>${t.label}</span></button>`).join('')}
    </nav>`;

  app.querySelector('#signout-btn').addEventListener('click', () => sb.auth.signOut());
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

function reminderBody(habit) {
  const own = store.checks
    .filter(c => c.habit_id === habit.id && (c.status === 'success' || c.status === 'failed'))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 7);
  const fails = own.filter(c => c.status === 'failed').length;
  if (own.length >= 2 && fails / own.length >= 0.5) {
    const variants = [
      `Tu as rompu ${fails} fois sur tes ${own.length} derniers jours. Encore aujourd'hui ?`,
      `« ${habit.title} » : tu abandonnes plus souvent que tu ne tiens.`,
      `Ta promesse « ${habit.title} » part en fumée. Dernière chance.`,
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }
  return `Tu avais promis : ${habit.title}`;
}

function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const today = todayStr();

  for (const h of store.habits) {
    if (!isDue(h, today)) continue;
    if ((h.reminder_time || '20:00').slice(0, 5) !== hhmm) continue;
    const key = `${h.id}-${today}`;
    if (notified.has(key)) continue;
    notified.add(key);
    const body = reminderBody(h);
    navigator.serviceWorker?.ready.then(reg =>
      reg.showNotification('Promesse du jour', { body, icon: 'icons/icon-192.png' }));
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
