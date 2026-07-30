-- Applied to the 'mirroir' Supabase project via MCP. Kept here for version control.
--
-- Two changes:
--  1. A broken promise can carry a one-tap reason, and we record whether it was
--     declared by the user or simply never answered.
--  2. Silence past the one-hour answer window counts as broken, not as missing
--     data. The rollover therefore runs every 5 minutes instead of hourly, and
--     never opens a check whose window has already closed.

alter table public.habit_checks add column reason text
  check (reason is null or reason in ('oubli','fatigue','imprevu','envie'));
alter table public.habit_checks add column expired boolean not null default false;

create or replace function public.mirroir_daily_rollover() returns void as $$
begin
  update public.habit_checks hc
  set status = 'failed', expired = true
  from public.habits h, public.profiles p
  where hc.habit_id = h.id
    and h.user_id = p.id
    and hc.status = 'created'
    and (now() at time zone p.timezone)
        > (hc.date + h.reminder_time + interval '1 hour');

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
        <= ((now() at time zone p.timezone)::date + h.reminder_time + interval '1 hour')
    and not exists (
      select 1 from public.habit_checks hc
      where hc.habit_id = h.id and hc.date = (now() at time zone p.timezone)::date
    );
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.mirroir_daily_rollover() from public, anon, authenticated;

-- An hour-wide window needs finer granularity than an hourly cron.
select cron.unschedule('mirroir-daily-rollover');
select cron.schedule('mirroir-rollover', '*/5 * * * *', 'select public.mirroir_daily_rollover();');
