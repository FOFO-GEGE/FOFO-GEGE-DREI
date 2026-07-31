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
// stats.daysAlive itself stays a 0-indexed elapsed-time count (0 on the day
// of creation) -- every tier threshold (TIERS' minDays) is calibrated against
// that raw value, and changing its meaning would silently retune every tier
// in the game. What was wrong is only ever the *display*: a promise created
// today and still alive tomorrow has now existed on 2 calendar days, and
// showing "Jours 1" read as a bug, not as "1 full day has elapsed" -- which
// is true but not what a day *count* means to someone reading it. This is
// the single point every user-facing "Jours"/"jour(s)" render passes through.
function daysCount(daysAlive) { return daysAlive + 1; }
// Local-date arithmetic, deliberately not UTC: a day here is the user's day,
// the same one isDue() and todayStr() reason about.
function shiftDays(iso, n) { const [y, m, d] = iso.split('-').map(Number); return dateStr(new Date(y, m - 1, d + n)); }
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
// A promise's range starts at its reminder time and runs for its own
// configurable window_minutes. Silence past that point is not missing data —
// it counts as broken, and it breaks the streak exactly like an explicit
// "pas fait" would. Unlike the range's end, its start no longer gates
// *replying* — a promise can be answered the moment it exists, any time
// before its deadline. The reminder time now only decides when notifications
// fire and where the card's countdown colour starts.

function windowOpensAt(habit, iso) {
  const [hh, mm] = (habit.reminder_time || '20:00').slice(0, 5).split(':').map(Number);
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d, hh, mm, 0, 0);
}

function deadlineFor(habit, iso) {
  const minutes = habit.window_minutes || 60;
  return new Date(windowOpensAt(habit, iso).getTime() + minutes * 60000);
}

function habitOf(check) {
  return store.habits.find(h => h.id === check.habit_id);
}

// The real, effective cutoff for a specific check — the plain schedule
// unless it's been snoozed today, in which case snoozed_until (an absolute
// instant, never past that day's midnight) takes over. This is the only
// thing snoozing changes: the card's colour keeps following the original
// schedule regardless (see rangeElapsed) — a snooze buys time to act, it
// does not make the card look less overdue than it is.
function deadlineForCheck(check) {
  const habit = habitOf(check);
  if (!habit) return null;
  if (check.snoozed_until) return new Date(check.snoozed_until);
  return deadlineFor(habit, check.date);
}

// null when the habit is gone; negative once the range has run out.
function minutesLeft(check) {
  const d = deadlineForCheck(check);
  return d ? Math.ceil((d.getTime() - Date.now()) / 60000) : null;
}

function isExpired(check) {
  const d = deadlineForCheck(check);
  return d ? Date.now() > d.getTime() : false;
}

// A 15-minute range makes "15 min left" meaningless as an urgency signal if
// that is the entire range — urgency is a quarter of the range, floored at
// 5 minutes so it never rounds away to nothing on a very short one.
function isUrgent(check) {
  const habit = habitOf(check);
  if (!habit) return false;
  const threshold = Math.max(5, Math.round((habit.window_minutes || 60) / 4));
  return minutesLeft(check) <= threshold;
}

// The fraction of today's range already elapsed, purely for the card's
// colour — clamped to [0,1]. 0 before the range opens (answering early must
// never read as urgent, since it's no longer gated), 1 once the deadline has
// passed. Never stored, never read by vitalityOf: the fold that decides
// whether a card is alive only ever looks at finished days.
function rangeElapsed(habit, iso) {
  const opens = windowOpensAt(habit, iso).getTime();
  const ends = deadlineFor(habit, iso).getTime();
  if (ends <= opens) return 1;
  const now = Date.now();
  if (now <= opens) return 0;
  if (now >= ends) return 1;
  return (now - opens) / (ends - opens);
}

// Reminder pings land at quarters of the range rather than fixed 15-minute
// steps, so a 4-hour range doesn't fall silent after the first hour and a
// 15-minute one doesn't try to cram four pings where there's no room.
function reminderStepsFor(windowMinutes) {
  return [0, Math.floor(windowMinutes / 4), Math.floor(windowMinutes / 2), Math.floor(windowMinutes * 3 / 4)];
}

function todaysCheck(habit) {
  const today = todayStr();
  return store.checks.find(c => c.habit_id === habit.id && c.date === today);
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

  // A promise with a fixed end date retires on its own once that date has
  // passed — a natural completion, not a death. Runs before the starvation
  // check below so an already-completed habit is never also weighed for
  // vitality-based death, and only once its last due day has had its normal
  // chance to resolve (end_date < today, not <=). Unlike a starved card,
  // this needs no confirmation dialog — it isn't a loss to confront, so
  // death_announced is set true immediately.
  const completed = store.habits.filter(h => h.end_date && h.end_date < today);
  for (const h of completed) {
    const completedAt = new Date().toISOString();
    h.active = false;
    h.deleted_at = completedAt;
    h.death_cause = 'completed';
    h.death_announced = true;
    store.habits = store.habits.filter(x => x.id !== h.id);
    store.cemetery.unshift(h);
    enqueue({
      table: 'habits',
      values: { active: false, deleted_at: completedAt, death_cause: 'completed', death_announced: true },
      matchId: h.id,
    });
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

// ---------- Selectors ----------

function pendingToday() {
  const today = todayStr();
  return store.checks
    .filter(c => c.date === today && c.status === 'created')
    .map(c => ({ check: c, habit: store.habits.find(h => h.id === c.habit_id) }))
    .filter(x => x.habit);
}

// The single ordering shared by Aujourd'hui's preview list and the ritual
// queue: soonest deadline first. Never sorted by creation date — a promise
// created later but due sooner must still come first, which is exactly the
// bug this fixed: taking pendingToday() as-is could block on a promise not
// due for hours while another was about to expire behind it. Every pending
// promise is answerable the instant it exists, so there is no other state
// left to sort by.
function pendingSorted() {
  return [...pendingToday()].sort((a, b) => minutesLeft(a.check) - minutesLeft(b.check));
}

// Everything Aujourd'hui's story shows, in order: still-pending promises
// first (soonest deadline first — the only part with real stakes), then
// whatever was already decided today, trailing behind as a plain record of
// the day rather than something you're still on the hook for.
function todayItems() {
  const today = todayStr();
  const decided = store.checks
    .filter(c => c.date === today && c.status !== 'created')
    .map(c => ({ check: c, habit: store.habits.find(h => h.id === c.habit_id) }))
    .filter(x => x.habit);
  return [...pendingSorted(), ...decided];
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

// A promise whose entire lifespan is a single calendar day never gets the
// ordinary fold's second chance — one day is the whole story. -8/-12 on a
// 0-100 gauge barely moves it (a declared failure still reads 92%, solidly
// green), so a genuinely one-day promise gets its own compressed ceiling
// instead, and its declared failure is graded by how avoidable the given
// reason was. Silence still costs exactly as much as the worst declared
// reason, never less — honesty must never come out behind staying quiet.
const VITALITY_MAX_ONE_DAY = 20;
const VITALITY_DELTA_ONE_DAY_REASON = {
  imprevu: -8,
  fatigue: -10,
  oubli: -11,
  envie: -12,
};

function isOneDayHabit(habit) {
  return !!habit.end_date && habit.start_date === habit.end_date;
}

function vitalityDelta(check, habit) {
  if (check.status === 'success') return VITALITY_DELTA.success;
  if (check.status === 'frozen') return VITALITY_DELTA.frozen;
  if (check.status === 'failed') {
    if (check.expired) return VITALITY_DELTA.failedSilent;
    if (habit && isOneDayHabit(habit) && VITALITY_DELTA_ONE_DAY_REASON[check.reason] !== undefined) {
      return VITALITY_DELTA_ONE_DAY_REASON[check.reason];
    }
    return VITALITY_DELTA.failedDeclared;
  }
  return 0; // still 'created' — undecided days never move it
}

// Death is terminal: the fold stops at zero, so nothing recorded afterwards
// can quietly revive a card. That is what makes the cemetery permanent —
// *unless* start_date itself moves forward, which is exactly what a
// resurrection does. Bounding the fold at start_date is what lets a revived
// card's vitality actually start over instead of hitting the same historical
// zero and returning immediately, before ever looking at a check recorded
// after the resurrection. A no-op for every card that was never resurrected:
// isDue() already guarantees no check exists before its habit's start_date.
function vitalityOf(habit) {
  const upTo = habit.active === false && habit.deleted_at ? habit.deleted_at.slice(0, 10) : todayStr();
  const own = store.checks
    .filter(c => c.habit_id === habit.id && c.date >= habit.start_date && c.date <= upTo)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const max = isOneDayHabit(habit) ? VITALITY_MAX_ONE_DAY : VITALITY_MAX;
  let v = max;
  for (const c of own) {
    v = Math.max(0, Math.min(max, v + vitalityDelta(c, habit)));
    if (v === 0) return 0;
  }
  // Normalized to a 0-100 percentage regardless of which ceiling produced
  // it, so every other consumer (the gauge width, vitalityState's bands,
  // rupturesBeforeDeath) keeps reading a single common scale.
  return Math.round((v / max) * 100);
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

// The card's own short memory: a sliding seven-day window, oldest first,
// today always last. Its states are deliberately the calendar's, so one day
// reads the same wherever you meet it — and it is what stops today from
// being a blank square with no account of how it got there.
//
// Three states share what used to be a single flat "none", because they are
// not the same fact: a day the promise wasn't due (weekdays not chosen, e.g.
// a 2x/week habit) is a rest day, not a miss — 'rest'. A day before the
// promise even existed is not part of its story at all — 'before', rendered
// with no mark whatsoever, never as a grey failure. Conflating the two used
// to make a habit created mid-week, or one that only runs twice a week, read
// as having failed every day it was never asked to run.
// One day's verdict for one promise, shared by the card's seven-day strip and
// Historique's per-card timeline so the two never disagree about what a
// square means. 'unknown' is the honest answer for a past due day that has no
// check row at all — the app was never open to open one — and must not be
// drawn as 'pending', which claims the day is still answerable.
function dayState(habit, date, check, today = todayStr()) {
  if (date < habit.start_date) return 'before';
  if (!habit.target_days.includes(dowOf(date))) return 'rest';
  if (check) {
    if (check.status === 'success') return 'kept';
    if (check.status === 'failed') return 'broken';
    if (check.status === 'frozen') return 'frozen';
    return date < today ? 'unknown' : 'pending';
  }
  return date < today ? 'unknown' : 'pending';
}

function lastWeekOf(habit, n = 7) {
  const today = todayStr();
  const asOf = habit.active === false && habit.deleted_at ? habit.deleted_at.slice(0, 10) : today;
  const byDate = new Map(store.checks.filter(c => c.habit_id === habit.id).map(c => [c.date, c]));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = shiftDays(asOf, -i);
    out.push({ date, dow: dowOf(date), state: dayState(habit, date, byDate.get(date), today) });
  }
  return out;
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
    // Still computed and still persisted — the card just no longer shows
    // them. A streak punished a single miss a second time (the gauge already
    // did), on top of rewarding whoever lied to keep it intact.
    streak: habit.current_streak || 0,
    best: habit.best_streak || 0,
    week: lastWeekOf(habit),
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

// One per month, and no longer conditional on holding a streak — the streak
// left the card, so gating the freeze on an invisible counter would have made
// the option appear and vanish for no reason the screen ever explains. What a
// freeze actually buys is unchanged: a day that costs no vitality.
function canFreeze(habit) {
  return habit.freeze_used_month !== currentMonthKey();
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

// Pushes a check's real deadline later *today only* — never past this same
// day, no matter how large the offset. minutesOrEod is either a number of
// minutes from now, or the literal 'eod' for "until 23:59:59". This is a
// snoozed alarm, not an edit to the habit: reminder_time itself is
// untouched, so tomorrow opens at the normal hour regardless of how much
// today's copy was pushed back. Doesn't touch the card's colour either (see
// rangeElapsed) — buying time is not the same as looking on track.
function snoozeCheck(checkId, minutesOrEod) {
  const check = store.checks.find(c => c.id === checkId);
  if (!check || check.status !== 'created') return { error: 'not-found' };
  const [y, mo, d] = check.date.split('-').map(Number);
  const endOfDay = new Date(y, mo - 1, d, 23, 59, 59, 999).getTime();
  const target = minutesOrEod === 'eod' ? endOfDay : Math.min(Date.now() + minutesOrEod * 60000, endOfDay);
  check.snoozed_until = new Date(target).toISOString();
  check.snooze_count = (check.snooze_count || 0) + 1;
  enqueue({
    table: 'habit_checks',
    values: { snoozed_until: check.snoozed_until, snooze_count: check.snooze_count },
    matchId: checkId,
  });
  return { ok: true };
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
    window_minutes: fields.window_minutes || 60,
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

  // Today's check may already carry a verdict against the *old* clock — a
  // declared "pas fait" or a silent expiry. If the corrected time means the
  // window genuinely hasn't closed yet, that verdict was against a mistake
  // you're actively fixing, not a real answer, so it's reopened rather than
  // left standing. vitalityOf() folds live check statuses on every call, so
  // reopening it here is enough on its own to hand back whatever it cost —
  // nothing separate to reverse.
  const todayCheck = store.checks.find(c => c.habit_id === habitId && c.date === today);
  if (todayCheck && todayCheck.status === 'failed' && Date.now() <= deadlineFor(habit, today).getTime()) {
    todayCheck.status = 'created';
    todayCheck.expired = false;
    todayCheck.reason = null;
    enqueue({ table: 'habit_checks', values: { status: 'created', expired: false, reason: null }, matchId: todayCheck.id });
  }

  // A habit due today can reach this point with no check yet for today — its
  // old deadline had already passed before the app was ever opened today, so
  // reconcileToday()'s usual pass never opened one. Pushing the reminder time
  // later can put that deadline back in the future, and without calling
  // reconcileToday() again here, nothing would ever notice: it only runs on
  // its own schedule, not in reaction to an edit. Without this, "Aujourd'hui"
  // would keep showing nothing to answer until the next natural reconcile.
  await reconcileToday();
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

// A card gets exactly one resurrection, ever — free of that, abandoning
// would cost nothing and the cemetery would stop meaning anything. It comes
// back at Œuf (start_date resets to today, which is also what lets its
// vitality actually start over — see the note on vitalityOf) and carries a
// permanent, visible scar: there is no way for a revived card to end up
// looking like one that was never buried.
async function resurrectHabit(habitId) {
  const habit = store.cemetery.find(h => h.id === habitId);
  if (!habit || habit.resurrected) return { error: 'not-eligible' };

  const preDeathDays = habitStats(habit).daysAlive;
  const today = todayStr();

  habit.active = true;
  habit.deleted_at = null;
  habit.death_cause = null;
  habit.death_announced = false;
  habit.resurrected = true;
  habit.pre_death_days = preDeathDays;
  habit.start_date = today;
  habit.current_streak = 0;

  store.cemetery = store.cemetery.filter(h => h.id !== habitId);
  store.habits.push(habit);

  await sb.from('habits').update({
    active: true, deleted_at: null, death_cause: null, death_announced: false,
    resurrected: true, pre_death_days: preDeathDays, start_date: today, current_streak: 0,
  }).eq('id', habitId);

  await reconcileToday();
  return { ok: true };
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

// Scoped like everything else on Historique. Called with no arguments (from
// Mon miroir) it still reads the whole record for every habit, exactly as
// before; called with a period it recomputes inside that window, which is
// what makes "ton point faible est le mardi" mean something you can act on
// rather than a verdict on all of recorded time.
function buildInsights(days = null, habitId = null) {
  const out = [];
  const scoped = periodChecks(days, habitId);
  const decided = scoped.filter(c => c.status === 'success' || c.status === 'failed');
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

  // Per-habit outliers — meaningless once a single habit is the whole scope.
  const scored = habitId !== null ? [] : store.habits
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
  const failed = scoped.filter(c => c.status === 'failed');
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

// ---------- Period scoping ----------
// Everything the history screen shows is derived through these: a period
// (in days back from today, or null for the whole record) and a scope (one
// habit id, or null for all of them). What used to be a fixed rolling week
// on its own screen is now one preset among several on Historique.
//
// Cemetery habits are always included: abandoning or completing a promise
// doesn't erase what it recorded on the way out, and a history that quietly
// dropped them would flatter the past.
const PERIODS = [
  { days: 7, label: '7 j' },
  { days: 30, label: '30 j' },
  { days: 90, label: '3 mois' },
  { days: null, label: 'Tout' },
];

function habitsById() {
  return new Map([...store.habits, ...store.cemetery].map(h => [h.id, h]));
}

function periodChecks(days = 7, habitId = null) {
  const today = todayStr();
  const byId = habitsById();
  return store.checks.filter(c =>
    byId.has(c.habit_id)
    && (habitId === null || c.habit_id === habitId)
    && (days === null || daysBetween(c.date, today) < days));
}

// The direct confrontation: what has actually been broken, plainly listed
// rather than folded into a single percentage. The deck is the collection,
// this is the ledger.
function periodFailures(days = 7, habitId = null) {
  const byId = habitsById();
  return periodChecks(days, habitId)
    .filter(c => c.status === 'failed')
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(c => ({ check: c, habit: byId.get(c.habit_id) }));
}

// The tally for a period, plus the same-length period immediately before it
// so the screen can say which way things are going. A null period has no
// "before" to compare against, by definition.
function periodSummary(days = 7, habitId = null) {
  const today = todayStr();
  const byId = habitsById();
  const inScope = c => byId.has(c.habit_id) && (habitId === null || c.habit_id === habitId);
  const rateOf = rows => {
    const d = rows.filter(c => c.status === 'success' || c.status === 'failed');
    return d.length ? Math.round(100 * d.filter(c => c.status === 'success').length / d.length) : null;
  };
  const cur = periodChecks(days, habitId);
  const prev = days === null ? [] : store.checks.filter(c => {
    if (!inScope(c)) return false;
    const age = daysBetween(c.date, today);
    return age >= days && age < days * 2;
  });
  return {
    kept: cur.filter(c => c.status === 'success').length,
    // A declared "pas fait" and a silence are both failures for the rate,
    // but they are not the same act — the tally splits them so the two
    // never hide inside one number.
    broken: cur.filter(c => c.status === 'failed' && !c.expired).length,
    frozen: cur.filter(c => c.status === 'frozen').length,
    missed: cur.filter(c => c.status === 'failed' && c.expired).length,
    rate: rateOf(cur),
    prevRate: days === null ? null : rateOf(prev),
  };
}

// The per-card timeline Historique shows when a single promise is selected:
// one entry per day over the period, in the same vocabulary the card's own
// seven-day strip uses, so the two read as the same object at two zooms.
function periodTimeline(days = 30, habitId) {
  const habit = habitsById().get(habitId);
  if (!habit) return [];
  const today = todayStr();
  const upTo = habit.active === false && habit.deleted_at ? habit.deleted_at.slice(0, 10) : today;
  const byDate = new Map(store.checks.filter(c => c.habit_id === habitId).map(c => [c.date, c]));
  const span = days === null ? Math.max(1, daysBetween(habit.start_date, today) + 1) : days;
  const out = [];
  for (let i = span - 1; i >= 0; i--) {
    const date = shiftDays(today, -i);
    if (date > upTo) continue;
    const c = byDate.get(date);
    out.push({ date, state: dayState(habit, date, c, today) });
  }
  return out;
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

const DOW_FULL = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
