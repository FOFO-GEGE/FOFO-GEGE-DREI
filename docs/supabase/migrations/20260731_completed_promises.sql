-- Applied to the 'mirroir' Supabase project via MCP. Kept here for version control.
--
-- A promise with a fixed end date — a one-day commitment, or any finite
-- run — now retires on its own once that date has passed. This is a
-- natural completion, not a death: it does not go through the vitality
-- fold, does not get announced with a death-notice dialog, and does not
-- belong in the cemetery's "abandoned"/"neglect" framing. It lands in the
-- same active=false bucket (so the existing cemetery query already fetches
-- it) tagged with a new death_cause so the client can split it into its own
-- "Terminées" section instead.
--
-- Mirrors docs/store.js's new completion pass in reconcileToday(). Change
-- one, change both — same discipline as mirroir_vitality() and
-- window_minutes.

alter table public.habits
  drop constraint if exists habits_death_cause_check,
  add constraint habits_death_cause_check
    check (death_cause is null or death_cause in ('abandoned', 'neglect', 'completed'));

create or replace function public.mirroir_daily_rollover() returns void as $$
begin
  update public.habit_checks hc
  set status = 'failed', expired = true
  from public.habits h, public.profiles p
  where hc.habit_id = h.id
    and h.user_id = p.id
    and hc.status = 'created'
    and (
      (hc.snoozed_until is not null and now() > hc.snoozed_until)
      or (hc.snoozed_until is null and (now() at time zone p.timezone)
          > (hc.date + h.reminder_time + (h.window_minutes || ' minutes')::interval))
    );

  update public.habits h
  set current_streak = 0
  where h.current_streak > 0
    and exists (
      select 1 from public.habit_checks hc
      where hc.habit_id = h.id
        and hc.status = 'failed'
        and hc.expired
        and hc.date >= current_date - 2
    );

  -- Natural completion: a fixed end date has passed. Runs before the
  -- starvation check below so an already-completed habit is never also
  -- buried as neglect.
  update public.habits h
  set active = false,
      deleted_at = now(),
      death_cause = 'completed',
      death_announced = true
  from public.profiles p
  where h.user_id = p.id
    and h.active
    and h.end_date is not null
    and h.end_date < (now() at time zone p.timezone)::date;

  -- Starvation. Runs after the expiries above so today's silence is already
  -- counted, and before the insert below so a card that just died is not
  -- handed a fresh check. Guarded on h.active, which makes it idempotent:
  -- the 5-minute cron cannot bury the same card twice.
  update public.habits h
  set active = false,
      deleted_at = now(),
      death_cause = 'neglect',
      death_announced = false
  where h.active
    and public.mirroir_vitality(h.id) <= 0;

  -- A promise made at 22h with an 08h reminder starts counting tomorrow:
  -- opening it now would score a failure the user could not have avoided.
  insert into public.habit_checks (habit_id, date, status)
  select h.id, (now() at time zone p.timezone)::date, 'created'
  from public.habits h
  join public.profiles p on p.id = h.user_id
  where h.active
    and extract(dow from (now() at time zone p.timezone)::date)::int = any(h.target_days)
    and (now() at time zone p.timezone)::date >= h.start_date
    and (h.end_date is null or (now() at time zone p.timezone)::date <= h.end_date)
    and (now() at time zone p.timezone)
        <= ((now() at time zone p.timezone)::date + h.reminder_time + (h.window_minutes || ' minutes')::interval)
    and not exists (
      select 1 from public.habit_checks hc
      where hc.habit_id = h.id and hc.date = (now() at time zone p.timezone)::date
    );
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.mirroir_daily_rollover() from public, anon, authenticated;
