-- Applied to the 'mirroir' Supabase project via MCP. Kept here for version control.
--
-- Aujourd'hui is now a one-card-at-a-time story instead of a list behind a
-- button, and each pending card can be snoozed — pushed later *today only*,
-- never past midnight. This is a per-check alarm, not an edit to the habit:
-- reminder_time is untouched, so tomorrow still opens at the normal hour no
-- matter how far today's copy was pushed back.
--
-- Mirrors docs/store.js's deadlineForCheck()/snoozeCheck(). Change one,
-- change both — same discipline as mirroir_vitality() and window_minutes.

alter table public.habit_checks
  add column snoozed_until timestamptz,
  add column snooze_count int not null default 0;

create or replace function public.mirroir_daily_rollover() returns void as $$
begin
  update public.habit_checks hc
  set status = 'failed', expired = true
  from public.habits h, public.profiles p
  where hc.habit_id = h.id
    and h.user_id = p.id
    and hc.status = 'created'
    and (
      -- snoozed_until is an absolute instant (unlike the plain-schedule
      -- branch below, which is naive local-time arithmetic), so it compares
      -- directly against now() rather than "now() at time zone p.timezone".
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
