-- Applied to the 'mirroir' Supabase project via MCP. Kept here for version control.
--
-- "Décaler" on Aujourd'hui can reopen a check that already failed today (a
-- declared "pas fait" or a silent expiry), not just extend a still-pending
-- one. Without a marker, that reopened check could fail again and offer
-- "Décaler" once more, forever -- a standing way to dodge the vitality cost
-- of a real failure. `reopened` is that marker: set once a check has been
-- reopened this way, it never resets for that check's own row, so a given
-- day gets exactly one do-over, not an unlimited one. Tomorrow's check is a
-- fresh row and starts at false again.
--
-- Mirrors docs/store.js's snoozeCheck(). Purely a client-side UI gate — no
-- SQL cron path reads it.
alter table public.habit_checks
  add column reopened boolean not null default false;
