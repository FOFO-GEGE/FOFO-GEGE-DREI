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
  second time cannot be revived again. Also covers the one-day promise's own
  fold: a habit whose entire lifespan is a single calendar day (start_date =
  end_date) uses a compressed ceiling (20 instead of 100) rather than the
  ordinary one, since the flat -8/-12 delta barely moves a 100-point gauge in
  a single event. Its declared failure is graded by how avoidable the chosen
  reason was (imprevu the mildest, envie the harshest), normalized back to
  the same 0-100 percentage every other consumer reads, with silence costing
  exactly as much as the harshest declared reason, never less. An ordinary
  (multi-day, or no end date) habit is asserted to ignore the reason
  entirely and keep the flat -8. Mirrored by hand in `mirroir_vitality()`
  (`20260731_one_day_vitality.sql`) — the mock does not run real SQL, so this
  case table is the JS half of that contract.
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
  Also covers the card's own composition after the redesign: no card of any
  size or lifespan announces the next tier any more (no countdown, no
  progress bar, no "se termine avant" — the badge changing is the whole
  event), and the seven-day strip that replaced it. The strip is a sliding
  window (today always the last column) with a day-initial row underneath
  and today's initial marked — without it a gap in the strip could only be
  counted, never located on the calendar. 'rest' (not scheduled that day —
  a 2x/week promise, say) and 'before' (the promise didn't exist yet) are
  distinct from an actual miss, each with its own mark (a small dot, and no
  mark at all, respectively) — conflating them used to make a promise
  created mid-week, or one that only runs some days, read as failing every
  day it was never asked to run. A fifth state, 'unknown', covers a past due
  day with no check row at all (the app was never open to open one) and is
  deliberately not drawn as 'pending', which would claim a past day is still
  answerable. `dayState()` is the one function both the card strip and
  Historique's timeline derive from, so the two can never disagree about
  what a square means. The strip is withheld entirely below two
  actually-scheduled days in the window (a one-day promise has nothing here
  to say). `lastWeekOf()` itself is covered directly for both the
  mid-window "before" boundary and the rest/scheduled split. Also asserts
  what left the card for good: SÉRIE, the Record stat, and the theme word
  under the icon.

- `history.spec.js` — Historique as the app's single account of the past.
  Ma semaine used to hold the real analysis behind a button on Mon miroir
  while this tab showed only a calendar; the analysis moved here and the
  fixed rolling week it was locked to became one preset among four. Covers
  the fold itself (`screenWeek()` gone, the old `/week` route redirecting,
  the "Voir ma semaine" button removed from Mon miroir) and then the two
  controls that govern everything below them: the period (7 j / 30 j /
  3 mois / Tout — a wider window really does pick up older failures and
  more kept days) and the scope (one promise, or every one). Also asserts
  that a declared "pas fait" and a silence are tallied apart rather than
  hidden inside one number, and that the per-card timeline appears only
  under a single-card scope, in the same vocabulary as the card's own
  seven-day strip.

## Not covered here

- Web Push delivery. Needs a real push service and, on iOS, a home-screen
  install; only a physical device can confirm it.
- The SQL cron paths, per above.
- The two-finger pivot-to-rotate gesture on the focused card. A synthetic
  `PointerEvent` isn't treated as a real, capturable pointer by the browser
  (`setPointerCapture` needs one backed by actual input), so the single-finger
  drag path is what's covered here; the rotate gesture needs a real touchscreen.
