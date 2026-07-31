// Test-only in-memory mock of the @supabase/supabase-js client surface used by app.js.
// Not shipped to production — only swapped in for local logic testing when the
// sandbox network policy blocks outbound calls to the real Supabase project.
(function () {
  const db = { profiles: [], habits: [], habit_checks: [] };
  const users = [];
  const authState = { session: null, listeners: [] };

  function uuid() { return crypto.randomUUID(); }
  function notify(event) {
    authState.listeners.forEach(cb => setTimeout(() => cb(event, authState.session), 0));
  }

  function findOrCreateUser(email) {
    let user = users.find(u => u.email === email);
    if (!user) {
      user = { id: uuid(), email };
      users.push(user);
      db.profiles.push({ id: user.id, timezone: 'Europe/Paris', created_at: new Date().toISOString() });
    }
    return user;
  }

  function ownedHabitIds() {
    const uid = authState.session?.user?.id;
    return db.habits.filter(h => h.user_id === uid).map(h => h.id);
  }

  function rlsScope(table, row) {
    const uid = authState.session?.user?.id;
    if (table === 'profiles') return row.id === uid;
    if (table === 'habits') return row.user_id === uid;
    if (table === 'habit_checks') return ownedHabitIds().includes(row.habit_id);
    return true;
  }

  function applyFilters(rows, filters) {
    return rows.filter(row => filters.every(([op, col, val]) => {
      if (op === 'eq') return row[col] === val;
      if (op === 'lt') return row[col] < val;
      if (op === 'gte') return row[col] >= val;
      if (op === 'in') return val.includes(row[col]);
      return true;
    }));
  }

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this._select = '*';
      this._order = null;
      this._single = false;
      this._maybeSingle = false;
      this._insert = null;
      this._update = null;
    }
    select(cols) { this._select = cols; return this; }
    eq(col, val) { this.filters.push(['eq', col, val]); return this; }
    lt(col, val) { this.filters.push(['lt', col, val]); return this; }
    gte(col, val) { this.filters.push(['gte', col, val]); return this; }
    in(col, vals) { this.filters.push(['in', col, vals]); return this; }
    order(col, opts) { this._order = col; this._orderDesc = !!(opts && opts.ascending === false); return this; }
    maybeSingle() { this._maybeSingle = true; return this; }
    single() { this._single = true; return this; }
    insert(obj) { this._insert = obj; return this; }
    update(obj) { this._update = obj; return this; }

    async _exec() {
      const table = this.table;
      if (this._insert) {
        const incoming = Array.isArray(this._insert) ? this._insert : [this._insert];
        // Column defaults matter: vitality reads `expired`, so a check
        // inserted without it must default to false exactly as the real
        // schema does, or the fold silently scores silence as a declared
        // failure.
        const defaults = {
          habits: {
            current_streak: 0, best_streak: 0, freeze_used_month: null,
            deleted_at: null, celebrated_tier: 'oeuf',
            death_cause: null, death_announced: false, active: true,
            resurrected: false, pre_death_days: null,
          },
          habit_checks: { expired: false, reason: null, reopened: false },
          profiles: {},
        }[table] || {};
        const rows = incoming.map(o => ({
          id: uuid(), created_at: new Date().toISOString(), ...defaults, ...o,
        }));
        db[table].push(...rows);
        return { data: rows, error: null };
      }
      if (this._update) {
        const rows = applyFilters(db[table].filter(r => rlsScope(table, r)), this.filters);
        rows.forEach(r => Object.assign(r, this._update));
        return { data: rows, error: null };
      }
      let rows = applyFilters(db[table].filter(r => rlsScope(table, r)), this.filters);
      if (this._order) {
        const dir = this._orderDesc ? -1 : 1;
        rows = [...rows].sort((a, b) => (a[this._order] > b[this._order] ? dir : a[this._order] < b[this._order] ? -dir : 0));
      }
      if (typeof this._select === 'string' && this._select.includes('habits(')) {
        rows = rows.map(r => ({ ...r, habits: { title: db.habits.find(h => h.id === r.habit_id)?.title } }));
      }
      if (this._maybeSingle) return { data: rows[0] || null, error: null };
      if (this._single) return { data: rows[0] || null, error: rows[0] ? null : { message: 'not found' } };
      return { data: rows, error: null };
    }
    then(resolve, reject) { this._exec().then(resolve, reject); }
  }

  window.supabase = {
    createClient() {
      return {
        auth: {
          async signUp({ email, password }) {
            const user = findOrCreateUser(email);
            authState.session = { user };
            notify('SIGNED_IN');
            return { data: { user, session: authState.session }, error: null };
          },
          async signInWithPassword({ email, password }) {
            const user = findOrCreateUser(email);
            authState.session = { user };
            notify('SIGNED_IN');
            return { data: { user, session: authState.session }, error: null };
          },
          async signOut() {
            authState.session = null;
            notify('SIGNED_OUT');
            return { error: null };
          },
          onAuthStateChange(cb) {
            authState.listeners.push(cb);
            setTimeout(() => cb('INITIAL_SESSION', authState.session), 0);
            return { data: { subscription: { unsubscribe() {} } } };
          },
        },
        from(table) { return new Query(table); },
        async rpc(name) {
          if (name === 'global_today_success_rate') {
            const today = new Date().toISOString().slice(0, 10);
            const rows = db.habit_checks.filter(c => c.date === today && (c.status === 'success' || c.status === 'failed'));
            const successRate = rows.length ? Math.round(100 * rows.filter(c => c.status === 'success').length / rows.length) : null;
            return { data: [{ success_rate: successRate, sample_size: rows.length }], error: null };
          }
          return { data: null, error: null };
        },
      };
    },
  };
})();
