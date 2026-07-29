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
  checks: [],
  socialRate: null,
  loaded: false,
};

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

// ---------- Loading ----------

async function loadAll() {
  const since = dateStr(new Date(Date.now() - HISTORY_DAYS * 86400000));
  const [habitsRes, checksRes] = await Promise.all([
    sb.from('habits').select('*').eq('active', true).order('created_at'),
    sb.from('habit_checks').select('*').gte('date', since),
  ]);
  store.habits = habitsRes.data || [];
  store.checks = checksRes.data || [];
  await reconcileToday();
  store.loaded = true;
}

// Close yesterday's unanswered checks and open today's — both as single
// batched statements rather than one round-trip per habit.
async function reconcileToday() {
  const today = todayStr();

  const stale = store.checks.filter(c => c.status === 'created' && c.date < today);
  if (stale.length) {
    stale.forEach(c => { c.status = 'no_data'; });
    await sb.from('habit_checks').update({ status: 'no_data' }).lt('date', today).eq('status', 'created');
    // A missed day breaks the streak.
    const brokenIds = new Set(stale.map(c => c.habit_id));
    for (const id of brokenIds) {
      const h = store.habits.find(x => x.id === id);
      if (h && h.current_streak > 0) {
        h.current_streak = 0;
        sb.from('habits').update({ current_streak: 0 }).eq('id', id);
      }
    }
  }

  const haveToday = new Set(store.checks.filter(c => c.date === today).map(c => c.habit_id));
  const missing = store.habits.filter(h => isDue(h, today) && !haveToday.has(h.id));
  if (missing.length) {
    const rows = missing.map(h => ({ habit_id: h.id, date: today, status: 'created' }));
    const { data } = await sb.from('habit_checks').insert(rows).select();
    store.checks.push(...(data && data.length ? data : rows));
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

function habitStats(habit) {
  const own = store.checks.filter(c => c.habit_id === habit.id);
  const decided = own.filter(c => c.status === 'success' || c.status === 'failed');
  const kept = decided.filter(c => c.status === 'success').length;
  return {
    rate: decided.length ? Math.round((kept / decided.length) * 100) : null,
    kept,
    total: decided.length,
    daysAlive: Math.max(0, daysBetween(habit.start_date, todayStr())),
    streak: habit.current_streak || 0,
    best: habit.best_streak || 0,
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

function markCheck(checkId, status) {
  const check = store.checks.find(c => c.id === checkId);
  if (!check) return null;
  check.status = status;
  const habit = store.habits.find(h => h.id === check.habit_id);

  sb.from('habit_checks').update({ status }).eq('id', checkId).then(() => {});

  if (habit) {
    if (status === 'success') {
      habit.current_streak = (habit.current_streak || 0) + 1;
      habit.best_streak = Math.max(habit.best_streak || 0, habit.current_streak);
      sb.from('habits')
        .update({ current_streak: habit.current_streak, best_streak: habit.best_streak })
        .eq('id', habit.id).then(() => {});
    } else if (status === 'failed') {
      habit.current_streak = 0;
      sb.from('habits').update({ current_streak: 0 }).eq('id', habit.id).then(() => {});
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
  sb.from('habit_checks').update({ status: 'frozen' }).eq('id', checkId).then(() => {});
  sb.from('habits').update({ freeze_used_month: habit.freeze_used_month }).eq('id', habit.id).then(() => {});
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

async function deleteHabit(habitId) {
  store.habits = store.habits.filter(h => h.id !== habitId);
  store.checks = store.checks.filter(c => c.habit_id !== habitId);
  await sb.from('habits').update({ active: false }).eq('id', habitId);
}

// ---------- Insight engine ----------

// Every insight carries its own sample floor: below it, we stay silent rather
// than dress up a coincidence as a pattern.
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

  return out;
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
