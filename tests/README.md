# Tests

End-to-end checks driven by Playwright against a throwaway copy of `docs/`.

## Running

```sh
npm install playwright          # once
tests/run.sh
```

`run.sh` copies `docs/` to a temp directory, swaps `vendor/supabase.js` for the
in-memory mock in this folder, serves it, and runs every `*.spec.js`. The real
Supabase project is never contacted.

If Chromium lives somewhere non-standard (a preinstalled browser, CI image),
point at it:

```sh
MIRROIR_CHROME=/path/to/chrome tests/run.sh
```

## The mock

`supabase-mock.js` reimplements only the slice of `@supabase/supabase-js` the
app actually uses — the query builder methods called in `store.js`, password
auth, and the `global_today_success_rate` RPC. It enforces row-level scoping the
same way the real policies do, so a query that would be rejected by RLS returns
nothing here too.

It is deliberately not a full Postgres: anything relying on real SQL (the
`mirroir_daily_rollover` cron, the `mirroir_due_pings` sender) is not covered
and has to be verified against the project itself.

## Specs

- `flow.spec.js` — signup, guided creation, the answer-window countdown, the
  ritual, the failure-reason step, the write queue draining, the card-focus
  overlay (the card pivots around X/Y on a one-finger drag without ever
  translating — checked by asserting its on-screen center barely moves while
  its rotation passes 90° — springs back flat on release, and a real turn
  doesn't also count as the tap that closes it, while a plain tap or a
  backdrop tap does), reminder-time editing (blocked while today's check is
  live, allowed once it isn't), the cemetery (abandon, toggle open **and**
  closed — checked via computed style, not just the `hidden` attribute), the
  clickable calendar day sheet, and the daily rhythm (a card is `.is-awake`
  while its window is open, and no longer once it has been answered — even
  though the window itself is still technically open).
- `expiry.spec.js` — the core rule: silence past the one-hour window becomes a
  failure with the `expired` flag, breaks the streak, and a window that has
  already closed never opens a check at all.
- `vitality.spec.js` — the value that makes a card change while the app is
  closed. Its case table is **the contract between two implementations**:
  `vitalityOf()` in JS and `mirroir_vitality()` in PL/pgSQL compute the same
  fold, and the identical cases were run against the real database when the
  migration was applied. A change here that is not mirrored in SQL will make
  the client show a card the cron has already buried, or the reverse. Also
  covers autonomous death end to end: a starved card leaves the deck with no
  tap, reaches the database, and is announced exactly once. Also covers
  resurrection: a dead card revived resets to Œuf with vitality back at 100,
  carries a permanent scar visible even in the compact deck grid, persists to
  the database, and — the one-resurrection-ever ceiling — a card that dies a
  second time cannot be revived again.
- `ritual-queue.spec.js` — the ritual queue: sorted by urgency rather than
  creation order (regression coverage for a real bug — it used to take
  `pendingToday()` as-is, so it could block on a promise not due yet while
  another expired behind it), promises whose window hasn't opened excluded
  from the forced sequence entirely, "Plus tard" requeues without recording a
  verdict, and a click on Aujourd'hui's preview list enters the ritual at that
  specific promise rather than the most urgent one.

## Not covered here

- Web Push delivery. Needs a real push service and, on iOS, a home-screen
  install; only a physical device can confirm it.
- The SQL cron paths, per above.
- The two-finger pivot-to-rotate gesture on the focused card. A synthetic
  `PointerEvent` isn't treated as a real, capturable pointer by the browser
  (`setPointerCapture` needs one backed by actual input), so the single-finger
  drag path is what's covered here; the rotate gesture needs a real touchscreen.
