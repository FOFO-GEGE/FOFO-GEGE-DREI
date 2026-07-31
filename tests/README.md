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

- `flow.spec.js` — signup, guided creation, Aujourd'hui as the story itself
  (tapping the tab drops straight onto the real card, full screen, no chrome),
  the answer-window countdown, the failure-reason step, the write queue
  draining, the card-focus overlay (the card pivots around X/Y on a
  one-finger drag without ever translating — checked by asserting its
  on-screen center barely moves while its rotation passes 90° — springs back
  flat on release, and a real turn doesn't also count as the tap that closes
  it, while a plain tap or a backdrop tap does), reminder-time editing
  (blocked while today's check is still live, allowed once it isn't), the
  cemetery (abandon, toggle open **and** closed — checked via computed style,
  not just the `hidden` attribute), the clickable calendar day sheet, and the
  card's time-remaining colour (`.pcard` carries `.time-pending` while
  unanswered, and settles to neither `.time-pending` nor `.time-done` once
  answered "Pas fait" — `.time-done` is reserved for "Fait", see
  `answer-window.spec.js`).
- `expiry.spec.js` — the core rule: silence past a promise's own range becomes
  a failure with the `expired` flag, breaks the streak, and a range that has
  already closed never opens a check at all.
- `answer-window.spec.js` — the configurable per-habit range that replaced
  the fixed one-hour window: `rangeElapsed()` as a pure function (0 just after
  opening, clamped to 0 before the range opens so answering early never reads
  as urgent, clamped to 1 past the deadline), a habit created with a
  30-minute range whose reminder is 2h out — answerable immediately rather
  than "waiting" — and the card settling to the gold `.time-done` state (not
  the green→red `.time-pending` one) once answered "Fait".
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
- `ritual-queue.spec.js` — Aujourd'hui as a one-card-at-a-time story rather
  than a list behind a button: pending promises sorted by urgency (regression
  coverage for a real bug — it used to take `pendingToday()` as-is, so it
  could block on a promise not due yet while another expired behind it), a
  promise not due today excluded from the story entirely, no numeric counter
  anywhere on screen, free `Précédent`/`Suivant` navigation on every card
  (pending or already decided — moving on never forces a verdict on the one
  left behind), "Décaler" pushing a card's real deadline later *today only*
  without ever moving its colour band backwards (it's read off the original
  schedule, not the snoozed one — a snooze buys time to act, it doesn't make
  the card look less overdue), a snoozed promise not resurfacing within the
  same pass through the story but leading a fresh visit again (still
  pending, still unresolved), and decided cards trailing behind the
  still-pending ones with no verdict buttons once everything for the day is
  settled.
- `tier-gating.spec.js` — a tier now needs both age and vitality; age alone
  only raises the ceiling. Covers the pure `tierFor(days, vitality)` table
  (including that `ageTierFor()` ignores vitality entirely, by design), a
  card gated below its age ceiling rendering the missed-evolution message
  in place of the ordinary progress bar, the card's own CSS class reflecting
  the earned (lower) tier rather than the age ceiling, and recovery: once
  vitality clears the bar again, the tier is regained.
- `completed-promises.spec.js` — a promise with a fixed end date (a one-day
  commitment, or any finite run) retiring on its own once that date passes:
  a natural completion, not a death. Covers the pure `habitCard()` output for
  `opts.finished` (gold `.time-done`/`pcard-xp-kept` when mostly kept, red
  `.time-broken`/`pcard-xp-broken` when not, and never the dead card's
  `is-dead` greyscale either way), the end-to-end retirement through
  `reconcileToday()` (leaves the active deck, tagged `death_cause:
  'completed'`, `death_announced` already true so it never surfaces through
  the death-notice dialog `unannouncedDeaths()` only watches for neglect),
  Mon miroir splitting the old cemetery query into two sections — Cimetière
  keeps only abandoned/neglected cards, a separate Terminées section holds
  completions — and the detail screen offering none of the live/dead-specific
  actions (no reminder edit, no abandon, no resurrect) for a finished promise.
  Also covers the lifespan-capped tier-progress lookup on full-size (non-
  compact) cards, and the compact deck-grid tiles never showing the tier
  countdown bar/text at all (reachable or not) while still carrying the
  vitality gauge on any live card, dropped on a retired one.

## Not covered here

- Web Push delivery. Needs a real push service and, on iOS, a home-screen
  install; only a physical device can confirm it.
- The SQL cron paths, per above.
- The two-finger pivot-to-rotate gesture on the focused card. A synthetic
  `PointerEvent` isn't treated as a real, capturable pointer by the browser
  (`setPointerCapture` needs one backed by actual input), so the single-finger
  drag path is what's covered here; the rotate gesture needs a real touchscreen.
