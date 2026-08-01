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
  (blocked while today's check is still live, allowed once it isn't, and —
  for a promise whose old deadline had already passed with no check ever
  opened for today — pushing the reminder time later immediately opens one
  rather than waiting for the next unrelated reconcile; the same edit also
  reopens a check that already carries a verdict against the old clock, a
  declared "pas fait" or a silent expiry alike, as long as the corrected
  time genuinely still lies ahead — a mistake you're actively fixing
  doesn't get to leave a frozen verdict standing — but does nothing if the
  new time still lies behind the clock), the
  cemetery (abandon, toggle open **and** closed — checked via computed style,
  not just the `hidden` attribute — the toggle reveals a `.yard` graveyard
  panel wrapping the `cemetery-grid`, and the tier badge carries its emoji),
  the clickable calendar day sheet, and the card's day-state classes (`.pcard`
  carries `.time-pending` while unanswered, and settles to neither
  `.time-pending` nor `.time-done` once answered "Pas fait" — `.time-done` is
  reserved for "Fait", see `answer-window.spec.js`). Those classes now drive
  the status glyph rather than the body colour; what the body is painted with
  is `card-colour.spec.js`'s business.
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
- `card-colour.spec.js` — what a card's colour means, after the two channels
  swapped places. The body used to be painted by today's answer (green→red as
  the range ran down, gold once answered), which put the shortest-lived fact
  in the app on the channel the eye reads first and left the promise's own
  health with no voice at all. The body now carries **vitality** — the same
  three bands the VIE gauge fills with, plus grey for death, and no gold
  anywhere (gold is the reward colour, and a card that merely still has a
  pulse hasn't earned it) — while **today** moved to a single status glyph
  top right. Covers: the body class following vitality and ignoring today's
  answer entirely (a healthy promise reads `vit-pleine` whether it was kept
  or broken today; one kept day does not repaint a dying card), those classes
  actually resolving to four distinct painted backgrounds (a class nothing
  paints would satisfy the class assertions while leaving every card
  identical on screen), `faiblit`/`malade` deliberately sharing one amber
  band, and the full glyph table — ⏳/⏰/🚨 counting today's range down,
  ✅/❌/❄️/🌙 for how it settled, 🏆/🪦 for a card that has left the deck,
  each with a written label since an emoji is a picture and not a name, no
  glyph at all on a synthetic preview card that has no real "today", and none
  either when the caller passes `opts.noStatus` — the ritual card on
  Aujourd'hui opts out this way, since the same fact is already the countdown
  chip or the status line sitting right below it. Also covers Taux/Jours
  sitting genuinely centred under the card (regression coverage: it used to
  be a 3-column grid holding only 2 stat boxes, so the pair sat left with an
  empty third column's worth of space to their right).
  Its headline case, and the reason the file exists: **a retired card keeps
  the colour it had the moment it left the deck.** A promise abandoned in
  perfect health stays green in the cemetery — you are meant to see that you
  threw away something that was working — and one that starved is grey with
  no special rule anywhere, because its vitality really was zero when it
  went. The muting is `.is-retired`'s job, which preserves that colour; the
  blanket greyscale that used to repaint every buried card identically is
  gone.
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
  settled. Also covers "Décaler" reopening an already-failed day in place —
  a declared "pas fait" or a silent expiry alike — resetting its status,
  expiry flag and reason exactly as an ordinary snooze resets a pending one,
  same day only and without ever touching the habit's own `reminder_time`
  (that permanent correction stays on the detail screen's "Modifier
  l'heure", covered in `flow.spec.js`). A kept (or frozen) day is a real
  decision, not a mistake to walk back, so it offers no "Décaler" at all.
  One do-over only: a reopened check is marked `reopened`, and if it fails
  a second time "Décaler" is gone for good on that day's own row — checked
  both through the UI and by calling `snoozeCheck()` directly, since
  without that marker a repeat failure would just offer another reopen,
  forever, quietly dodging the vitality cost of a real failure.
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
  completions, its toggle revealing a `.shelf` trophy panel wrapping the
  `finished-grid` — and the detail screen offering none of the
  live/dead-specific actions (no reminder edit, no abandon, no resurrect) for
  a finished promise.
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
  under the icon. Also covers the "Jours" stat (and every "jour(s)"
  sentence built from the same figure) as a calendar day count rather than
  the raw elapsed-time value tier gating runs on — a promise still alive
  the day after creation reads "Jours 2", never "Jours 1" — while asserting
  `tierFor()`/`ageTierFor()`/`nextTier()` keep comparing the untouched raw
  value, so the display conversion never retunes when a tier is actually
  reached. A one-day promise's day count is always exactly 1, so its
  finished/dead blurb (card and detail screen alike) drops the count
  entirely rather than stating it — "Terminée."/"Abandonnée." instead of
  "Terminée après 1 jour." — while a multi-day promise keeps its count as
  before; covered both as a pure `habitCard()` case and end to end on the
  detail screen's own sentence.

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
