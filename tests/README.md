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
  ritual, the failure-reason step, the write queue draining, and editing a
  promise without losing its card.
- `expiry.spec.js` — the core rule: silence past the one-hour window becomes a
  failure with the `expired` flag, breaks the streak, and a window that has
  already closed never opens a check at all.

## Not covered here

- Web Push delivery. Needs a real push service and, on iOS, a home-screen
  install; only a physical device can confirm it.
- The SQL cron paths, per above.
