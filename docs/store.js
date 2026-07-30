// Data layer: one load into an in-memory store, optimistic mutations, and the
// insight engine. Screens read from the store synchronously so navigation is
// instant — the network is never in the path of a tap.

const sb = window.supabase.createClient(
  window.MIRROIR_CONFIG.supabaseUrl,
  window.MIRROIR_CONFIG.supabaseKey
);

const HISTORY_DAYS = 400;

const store = {
  user: null,
  habits: [],
  cemetery: [], // abandoned habits — kept, never hard-deleted, shown greyed out
  checks: [],
  socialRate: null,
  loaded: false,
  sync: 'idle', // 'idle' | 'pending' | 'offline'
  pushActive: false,
};

// ---------- Write queue ----------
// Taps update memory first so the UI never waits on the network. That means a
// write can fail after the screen has already moved on, so every write goes
// through a queue that survives a reload and retries with backoff. Without it
// the app could show "tenu" for something the database never received.

const QUEUE_KEY = 'mirroir_write_queue';
let writeQueue = [];
let flushTimer = null;
let syncListener = null;

try { writeQueue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { writeQueue = []; }

function onSyncChange(fn) { syncListener = fn; }

function setSync(state) {
  if (store.sync === state) return;
  store.sync = state;
  if (syncListener) syncListener(state);
}

function persistQueue() {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(writeQueue)); } catch (e) { /* quota */ }
  setSync(writeQueue.length ? (writeQueue.some(o => o.tries >= 3) ? 'offline' : 'pending') : 'idle');
}

function enqueue(op) {
  writeQueue.push({ ...op, tries: 0 });
  persistQueue();
  flushQueue();
}

async function runOp(op) {
  let q = sb.from(op.table).update(op.values);
  if (op.matchId) q = q.eq('id', op.matchId);
  else if (op.inIds) q = q.in('id', op.inIds);
  else throw new Error('op without a target');
  const { error } = await q;
  if (error) throw new Error(error.message);
}

async function flushQueue() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!writeQueue.length || !store.user) return;

  while (writeQueue.length) {
    const op = writeQueue[0];
    try {
      await runOp(op);
      writeQueue.shift();
      persistQueue();
    } catch (e) {
      op.tries++;
      persistQueue();
      // Exponential backoff, capped — a phone in a tunnel shouldn't spin.
      const delay = Math.min(30000, 1000 * Math.pow(2, op.tries));
      flushTimer = setTimeout(flushQueue, delay);
      return;
    }
  }
}

window.addEventListener('online', flushQueue);

function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return dateStr(new Date()); }
function currentMonthKey() { return todayStr().slice(0, 7); }
function dowOf(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).getDay(); }
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function vibrate(p) { if (navigator.vibrate) navigator.vibrate(p); }

function isDue(habit, iso) {
  if (!habit.active) return false;
  if (!habit.target_days.includes(dowOf(iso))) return false;
  if (iso < habit.start_date) return false;
  if (habit.end_date && iso > habit.end_date) return false;
  return true;
}

// ---------- The answer window ----------
// A promise opens at its reminder time and stays answerable for one hour.
// Silence past that hour is not missing data — it counts as broken, and it
// breaks the streak exactly like an explicit "pas fait" would.

const ANSWER_WINDOW_MIN = 60;
const REMINDER_STEPS = [0, 15, 30, 45];

function windowOpensAt(habit, iso) {
  const [hh, mm] = (habit.reminder_time || '20:00').slice(0, 5).split(':').map(Number);
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d, hh, mm, 0, 0);
}

function deadlineFor(habit, iso) {
  return new Date(windowOpensAt(habit, iso).getTime() + ANSWER_WINDOW_MIN * 60000);
}

function habitOf(check) {
  return store.habits.find(h => h.id === check.habit_id);
}

// null when the habit is gone; negative once the hour has run out.
function minutesLeft(check) {
  const habit = habitOf(check);
  if (!habit) return null;
  return Math.ceil((deadlineFor(habit, check.date).getTime() - Date.now()) / 60000);
}

function windowIsOpen(check) {
  const habit = habitOf(check);
  if (!habit) return false;
  const now = Date.now();
  return now >= windowOpensAt(habit, check.date).getTime()
      && now <= deadlineFor(habit, check.date).getTime();
}

function isExpired(check) {
  const habit = habitOf(check);
  if (!habit) return false;
  return Date.now() > deadlineFor(habit, check.date).getTime();
}

// ---------- Loading ----------

async function loadAll() {
  const since = dateStr(new Date(Date.now() - HISTORY_DAYS * 86400000));
  const [habitsRes, deadRes, checksRes] = await Promise.all([
    sb.from('habits').select('*').eq('active', true).order('created_at'),
    sb.from('habits').select('*').eq('active', false).order('deleted_at', { ascending: false }),
    sb.from('habit_checks').select('*').gte('date', since),
  ]);
  store.habits = habitsRes.data || [];
  store.cemetery = deadRes.data || [];
  store.checks = checksRes.data || [];
  await reconcileToday();
  store.loaded = true;
}

// Expire every check whose hour has run out, then open today's. Both are
// batched rather than one round-trip per habit. The server cron does the same
// work for users who never open the app; this is the client-side guard-rail
// so the screen is never stale on arrival.
async function reconcileToday() {
  const today = todayStr();

  const expired = store.checks.filter(c => c.status === 'created' && isExpired(c));
  if (expired.length) {
    expired.forEach(c => { c.status = 'failed'; c.expired = true; });
    // One statement per date keeps this bounded — in practice a single day.
    const dates = [...new Set(expired.map(c => c.date))];
    for (const d of dates) {
      const ids = expired.filter(c => c.date === d).map(c => c.id);
      enqueue({ table: 'habit_checks', values: { status: 'failed' }, inIds: ids });
    }
    for (const id of new Set(expired.map(c => c.habit_id))) {
      const h = store.habits.find(x => x.id === id);
      if (h && h.current_streak > 0) {
        h.current_streak = 0;
        enqueue({ table: 'habits', values: { current_streak: 0 }, matchId: id });
      }
    }
  }

  // A card whose vitality is spent dies on its own — no confirmation, no tap.
  // This is the only way something ever leaves the deck without an explicit
  // decision, and it is what makes the deck a place where things happen
  // rather than a list entirely under the user's control. Runs before today's
  // checks are opened so a card that just died is not handed a fresh one.
  const starved = store.habits.filter(h => vitalityOf(h) <= 0);
  for (const h of starved) {
    const diedAt = new Date().toISOString();
    h.active = false;
    h.deleted_at = diedAt;
    h.death_cause = 'neglect';
    h.death_announced = false;
    store.habits = store.habits.filter(x => x.id !== h.id);
    store.cemetery.unshift(h);
    enqueue({
      table: 'habits',
      values: { active: false, deleted_at: diedAt, death_cause: 'neglect' },
      matchId: h.id,
    });
  }

  // Only open a check while its window can still be answered. A promise made
  // at 22h with an 08h reminder starts counting tomorrow — opening it now
  // would create an already-expired check and score a failure the user never
  // had a chance to avoid.
  const haveToday = new Set(store.checks.filter(c => c.date === today).map(c => c.habit_id));
  const now = Date.now();
  const missing = store.habits.filter(h =>
    isDue(h, today) && !haveToday.has(h.id) && now <= deadlineFor(h, today).getTime());
  if (missing.length) {
    const rows = missing.map(h => ({ habit_id: h.id, date: today, status: 'created' }));
    const { data } = await sb.from('habit_checks').insert(rows).select();
    store.checks.push(...(data && data.length ? data : rows));
  }
}

// ---------- Push subscription ----------
// Reminders have to arrive with the app closed, which only Web Push can do.
// On iOS that means the app must be installed to the home screen first —
// Safari refuses the subscription in an ordinary tab.

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// iOS is the one platform that gates push behind installation, so only there
// does "not installed" mean "not available".
function pushNeedsInstall() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !isStandalone();
}

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function registerPush() {
  if (!pushSupported() || !window.MIRROIR_CONFIG.vapidPublicKey) return { ok: false, reason: 'unsupported' };
  if (pushNeedsInstall()) return { ok: false, reason: 'needs-install' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(window.MIRROIR_CONFIG.vapidPublicKey),
    });
  }

  const json = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({
    user_id: store.user.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  }, { onConflict: 'endpoint' });

  if (error) return { ok: false, reason: error.message };
  store.pushActive = true;
  return { ok: true };
}

// Once the server is pinging, the in-page timer would only duplicate it.
async function detectPushState() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    store.pushActive = !!(await reg.pushManager.getSubscription());
  } catch (e) {
    store.pushActive = false;
  }
}

async function loadSocialRate() {
  try {
    const { data } = await sb.rpc('global_today_success_rate');
    const row = Array.isArray(data) ? data[0] : data;
    store.socialRate = row && row.success_rate !== null && row.sample_size >= 5
      ? { rate: Math.round(row.success_rate), sample: row.sample_size }
      : null;
  } catch (e) {
    store.socialRate = null;
  }
}

// ---------- Selectors ----------

function pendingToday() {
  const today = todayStr();
  return store.checks
    .filter(c => c.date === today && c.status === 'created')
    .map(c => ({ check: c, habit: store.habits.find(h => h.id === c.habit_id) }))
    .filter(x => x.habit);
}

// The single ordering shared by Aujourd'hui's preview list and the ritual
// queue: windows open right now come first, soonest deadline first; windows
// still waiting for their hour follow, soonest to open first. Never sorted
// by creation date — a promise whose hour hasn't started cannot be missed by
// definition, so putting it ahead of one about to expire was a real bug that
// could cost the user a promise they never had a chance to protect in time.
function pendingSorted() {
  return [...pendingToday()].sort((a, b) => {
    const aOpen = windowIsOpen(a.check), bOpen = windowIsOpen(b.check);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (aOpen) return minutesLeft(a.check) - minutesLeft(b.check);
    const ta = (a.habit.reminder_time || '20:00');
    const tb = (b.habit.reminder_time || '20:00');
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}

// What the ritual is actually allowed to put in front of you: only promises
// whose window is open. One that hasn't opened yet cannot be answered, so it
// stays visible on Aujourd'hui but out of the forced sequence until its hour
// comes — at which point the next reconcile picks it up.
function pendingOpenSorted() {
  return pendingSorted().filter(p => windowIsOpen(p.check));
}

function todayTally() {
  const today = todayStr();
  const rows = store.checks.filter(c => c.date === today);
  return {
    kept: rows.filter(c => c.status === 'success').length,
    broken: rows.filter(c => c.status === 'failed').length,
    frozen: rows.filter(c => c.status === 'frozen').length,
    pending: rows.filter(c => c.status === 'created').length,
  };
}

// ---------- Vitality ----------
// A card's living state, and the only thing about it that changes while the
// app is closed. Three rules decide the whole design:
//
//  1. It moves *only* on decided due days, never on the calendar. A
//     Monday/Wednesday/Friday promise must not be punished for the rhythm its
//     owner chose — that kind of unfairness is what makes people uninstall.
//  2. It is recomputed from history, never stored and incremented. Two
//     independent counters (one here, one in the cron) would drift apart the
//     first time a write failed; a pure function of the same rows cannot.
//  3. Silence costs more than an honest "pas fait". Ghosting a promise is the
//     one thing this app exists to make expensive, so declaring a failure is
//     always strictly better for the card than ignoring it.
//
// Mirrored exactly by mirroir_vitality() in SQL — change one, change both.

const VITALITY_MAX = 100;
const VITALITY_DELTA = {
  success: 12,
  failedDeclared: -8,
  failedSilent: -12,
  frozen: 0, // a freeze is meant to cost nothing — that is its whole purpose
};

function vitalityDelta(check) {
  if (check.status === 'success') return VITALITY_DELTA.success;
  if (check.status === 'frozen') return VITALITY_DELTA.frozen;
  if (check.status === 'failed') {
    return check.expired ? VITALITY_DELTA.failedSilent : VITALITY_DELTA.failedDeclared;
  }
  return 0; // still 'created' — undecided days never move it
}

// Death is terminal: the fold stops at zero, so nothing recorded afterwards
// can quietly revive a card. That is what makes the cemetery permanent.
function vitalityOf(habit) {
  const upTo = habit.active === false && habit.deleted_at ? habit.deleted_at.slice(0, 10) : todayStr();
  const own = store.checks
    .filter(c => c.habit_id === habit.id && c.date <= upTo)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let v = VITALITY_MAX;
  for (const c of own) {
    v = Math.max(0, Math.min(VITALITY_MAX, v + vitalityDelta(c)));
    if (v === 0) return 0;
  }
  return v;
}

function vitalityState(v) {
  if (v <= 0) return 'morte';
  if (v < 30) return 'mourante';
  if (v < 55) return 'malade';
  if (v < 80) return 'faiblit';
  return 'pleine';
}

// Counted at the cost of silence, so the warning is never optimistic: answer
// honestly and you get more days than promised, never fewer.
function rupturesBeforeDeath(v) {
  return Math.max(1, Math.ceil(v / -VITALITY_DELTA.failedSilent));
}

function habitStats(habit) {
  const own = store.checks.filter(c => c.habit_id === habit.id);
  const decided = own.filter(c => c.status === 'success' || c.status === 'failed');
  const kept = decided.filter(c => c.status === 'success').length;
  // A dead card's age freezes at the moment it was abandoned — otherwise a
  // card buried a year ago would keep reporting itself as older every day.
  const asOf = habit.active === false && habit.deleted_at ? habit.deleted_at.slice(0, 10) : todayStr();
  const vitality = vitalityOf(habit);
  return {
    rate: decided.length ? Math.round((kept / decided.length) * 100) : null,
    kept,
    total: decided.length,
    daysAlive: Math.max(0, daysBetween(habit.start_date, asOf)),
    streak: habit.current_streak || 0,
    best: habit.best_streak || 0,
    vitality,
    vitalityState: vitalityState(vitality),
    rupturesLeft: rupturesBeforeDeath(vitality),
  };
}

function globalScore() {
  const decided = store.checks.filter(c => c.status === 'success' || c.status === 'failed');
  if (!decided.length) return null;
  const kept = decided.filter(c => c.status === 'success').length;
  return Math.round((kept / decided.length) * 100);
}

function canFreeze(habit) {
  return (habit.current_streak || 0) > 0 && habit.freeze_used_month !== currentMonthKey();
}

// ---------- Mutations (optimistic: local first, network after) ----------

function markCheck(checkId, status, reason) {
  const check = store.checks.find(c => c.id === checkId);
  if (!check) return null;
  check.status = status;
  if (reason) check.reason = reason;
  const habit = store.habits.find(h => h.id === check.habit_id);

  const values = reason ? { status, reason } : { status };
  enqueue({ table: 'habit_checks', values, matchId: checkId });

  if (habit) {
    if (status === 'success') {
      habit.current_streak = (habit.current_streak || 0) + 1;
      habit.best_streak = Math.max(habit.best_streak || 0, habit.current_streak);
      enqueue({
        table: 'habits',
        values: { current_streak: habit.current_streak, best_streak: habit.best_streak },
        matchId: habit.id,
      });
    } else if (status === 'failed') {
      habit.current_streak = 0;
      enqueue({ table: 'habits', values: { current_streak: 0 }, matchId: habit.id });
    }
  }
  return habit;
}

function freezeCheck(checkId) {
  const check = store.checks.find(c => c.id === checkId);
  if (!check) return;
  const habit = store.habits.find(h => h.id === check.habit_id);
  if (!habit || !canFreeze(habit)) return;
  check.status = 'frozen';
  habit.freeze_used_month = currentMonthKey();
  enqueue({ table: 'habit_checks', values: { status: 'frozen' }, matchId: checkId });
  enqueue({ table: 'habits', values: { freeze_used_month: habit.freeze_used_month }, matchId: habit.id });
}

async function createHabit(fields) {
  const row = {
    user_id: store.user.id,
    title: fields.title,
    theme: fields.theme || 'autre',
    type: fields.type,
    frequency: fields.frequency,
    target_days: fields.target_days,
    reminder_time: fields.reminder_time,
    start_date: todayStr(),
    end_date: fields.end_date || null,
    active: true,
  };
  const { data, error } = await sb.from('habits').insert(row).select();
  if (error) return { error };
  const created = (data && data[0]) || { ...row, id: crypto.randomUUID(), current_streak: 0, best_streak: 0 };
  store.habits.push(created);
  await reconcileToday();
  return { habit: created };
}

// The only field a promise's card may ever change after creation. Title,
// theme and schedule stay locked — this is purely a clock correction (you
// meant 22h30, you typed 22h). Blocked while today's check is still 'created'
// so it can never be used to extend a countdown that is already running, or
// to collapse today's window into the past and score an unfair "non fait".
async function updateReminderTime(habitId, hhmm) {
  const habit = store.habits.find(h => h.id === habitId);
  if (!habit) return { error: 'not-found' };
  const today = todayStr();
  const liveToday = store.checks.some(c => c.habit_id === habitId && c.date === today && c.status === 'created');
  if (liveToday) return { error: 'live' };
  habit.reminder_time = hhmm;
  enqueue({ table: 'habits', values: { reminder_time: hhmm }, matchId: habitId });
  return { ok: true };
}

// Abandoning a promise moves its card to the cemetery — it is never erased,
// checks and all, because the whole point of the mirror is that the past
// cannot be edited away.
async function deleteHabit(habitId) {
  const habit = store.habits.find(h => h.id === habitId);
  if (!habit) return;
  const deletedAt = new Date().toISOString();
  habit.active = false;
  habit.deleted_at = deletedAt;
  habit.death_cause = 'abandoned';
  habit.death_announced = true; // you were there — nothing to break to you later
  store.habits = store.habits.filter(h => h.id !== habitId);
  store.cemetery.unshift(habit);
  await sb.from('habits')
    .update({ active: false, deleted_at: deletedAt, death_cause: 'abandoned', death_announced: true })
    .eq('id', habitId);
}

// A card that starved while the app was closed has to be reported the next
// time it opens, or it would simply vanish from the deck with no explanation.
function unannouncedDeaths() {
  return store.cemetery.filter(h => h.death_cause === 'neglect' && !h.death_announced);
}

function acknowledgeDeaths(habits) {
  const ids = habits.map(h => h.id);
  if (!ids.length) return;
  habits.forEach(h => { h.death_announced = true; });
  enqueue({ table: 'habits', values: { death_announced: true }, inIds: ids });
}

// ---------- Insight engine ----------

// Every insight carries its own sample floor: below it, we stay silent rather
// than dress up a coincidence as a pattern.
const REASONS = [
  { id: 'oubli', label: 'Oublié' },
  { id: 'fatigue', label: 'Trop fatigué' },
  { id: 'imprevu', label: 'Imprévu' },
  { id: 'envie', label: 'Pas envie' },
];

function reasonLabel(id) {
  const r = REASONS.find(x => x.id === id);
  return r ? r.label.toLowerCase() : null;
}

function buildInsights() {
  const out = [];
  const decided = store.checks.filter(c => c.status === 'success' || c.status === 'failed');
  if (decided.length < 6) return out;

  const rateOf = rows => rows.length
    ? Math.round(100 * rows.filter(c => c.status === 'success').length / rows.length)
    : null;

  // Weekday vs weekend
  const week = decided.filter(c => { const d = dowOf(c.date); return d >= 1 && d <= 5; });
  const wknd = decided.filter(c => { const d = dowOf(c.date); return d === 0 || d === 6; });
  if (week.length >= 4 && wknd.length >= 4) {
    const rw = rateOf(week), rk = rateOf(wknd);
    if (Math.abs(rw - rk) >= 15) {
      out.push(rw > rk
        ? { tone: 'bad', text: `Tu tiens ${rw}% en semaine, mais seulement ${rk}% le week-end.` }
        : { tone: 'good', text: `Tu tiens ${rk}% le week-end, contre ${rw}% en semaine.` });
    }
  }

  // Strongest / weakest weekday
  const byDow = Array.from({ length: 7 }, () => []);
  decided.forEach(c => byDow[dowOf(c.date)].push(c));
  const eligible = byDow.map((rows, d) => ({ d, rows, rate: rateOf(rows) })).filter(x => x.rows.length >= 3);
  if (eligible.length >= 2) {
    const best = eligible.reduce((a, b) => (b.rate > a.rate ? b : a));
    const worst = eligible.reduce((a, b) => (b.rate < a.rate ? b : a));
    if (best.d !== worst.d && best.rate - worst.rate >= 20) {
      out.push({ tone: 'bad', text: `Le ${DOW_FULL[worst.d]} est ton point faible : ${worst.rate}% contre ${best.rate}% le ${DOW_FULL[best.d]}.` });
    }
  }

  // Per-habit outliers
  const scored = store.habits
    .map(h => ({ h, s: habitStats(h) }))
    .filter(x => x.s.total >= 5);
  if (scored.length >= 2) {
    const worst = scored.reduce((a, b) => (b.s.rate < a.s.rate ? b : a));
    const best = scored.reduce((a, b) => (b.s.rate > a.s.rate ? b : a));
    if (best.h.id !== worst.h.id && best.s.rate - worst.s.rate >= 25) {
      out.push({ tone: 'bad', text: `« ${worst.h.title} » ne tient qu’à ${worst.s.rate}%, quand « ${best.h.title} » tient à ${best.s.rate}%.` });
    }
  }

  // Recent trend: last 7 days vs the 7 before
  const today = todayStr();
  const inWindow = (c, from, to) => daysBetween(c.date, today) >= from && daysBetween(c.date, today) < to;
  const recent = decided.filter(c => inWindow(c, 0, 7));
  const prior = decided.filter(c => inWindow(c, 7, 14));
  if (recent.length >= 4 && prior.length >= 4) {
    const rr = rateOf(recent), rp = rateOf(prior);
    if (Math.abs(rr - rp) >= 15) {
      out.push(rr > rp
        ? { tone: 'good', text: `Tu remontes : ${rr}% ces 7 derniers jours contre ${rp}% la semaine d’avant.` }
        : { tone: 'bad', text: `Tu décroches : ${rr}% ces 7 derniers jours contre ${rp}% la semaine d’avant.` });
    }
  }

  // What the failures are actually made of. This is the one insight family
  // that can be acted on directly, so it goes near the top.
  const failed = store.checks.filter(c => c.status === 'failed');
  const withReason = failed.filter(c => c.reason);
  if (withReason.length >= 4) {
    const counts = {};
    withReason.forEach(c => { counts[c.reason] = (counts[c.reason] || 0) + 1; });
    const [topId, topN] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const share = Math.round(100 * topN / withReason.length);
    if (share >= 45) {
      const label = reasonLabel(topId);
      const extra = topId === 'oubli'
        ? ' Ton heure de rappel est peut-être mal placée.'
        : topId === 'fatigue'
        ? ' Tu places peut-être tes promesses trop tard dans la journée.'
        : '';
      out.unshift({ tone: 'bad', text: `${share}% de tes échecs, c’est « ${label} ».${extra}` });
    }
  }

  // Promises lost to silence rather than to a decision.
  const expiredCount = failed.filter(c => c.expired).length;
  if (failed.length >= 5 && expiredCount / failed.length >= 0.4) {
    out.push({
      tone: 'bad',
      text: `${Math.round(100 * expiredCount / failed.length)}% de tes échecs sont des non-réponses : tu n’as même pas ouvert l’app dans l’heure.`,
    });
  }

  return out;
}

// The direct confrontation: what has actually been broken lately, plainly
// listed rather than folded into a single percentage. Includes cemetery
// habits — abandoning a promise doesn't erase what it recorded on the way out.
function recentFailures(limit = 8) {
  const byId = new Map([...store.habits, ...store.cemetery].map(h => [h.id, h]));
  return store.checks
    .filter(c => c.status === 'failed' && byId.has(c.habit_id))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit)
    .map(c => ({ check: c, habit: byId.get(c.habit_id) }));
}

// Every promise touched on a given date, active or buried, each stamped with
// that day's own verdict — used by the calendar's day view so a mixed day
// (one kept, one broken) no longer collapses into a single colour.
function checksOnDate(iso) {
  const byId = new Map([...store.habits, ...store.cemetery].map(h => [h.id, h]));
  return store.checks
    .filter(c => c.date === iso && byId.has(c.habit_id))
    .map(c => ({ check: c, habit: byId.get(c.habit_id) }));
}

function weekSummary() {
  const today = todayStr();
  const win = (from, to) => store.checks.filter(c => {
    const age = daysBetween(c.date, today);
    return age >= from && age < to;
  });
  const rateOf = rows => {
    const d = rows.filter(c => c.status === 'success' || c.status === 'failed');
    return d.length ? Math.round(100 * d.filter(c => c.status === 'success').length / d.length) : null;
  };
  const cur = win(0, 7), prev = win(7, 14);
  return {
    kept: cur.filter(c => c.status === 'success').length,
    broken: cur.filter(c => c.status === 'failed').length,
    frozen: cur.filter(c => c.status === 'frozen').length,
    missed: cur.filter(c => c.status === 'no_data').length,
    rate: rateOf(cur),
    prevRate: rateOf(prev),
  };
}

const DOW_FULL = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
