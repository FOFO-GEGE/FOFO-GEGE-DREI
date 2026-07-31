-- Applied to the 'mirroir' Supabase project via MCP. Kept here for version control.
--
-- The answer window used to be a hardcoded hour for every promise. It is now
-- window_minutes, set per habit at creation — a 15-minute promise is a
-- harder version of the same promise, not a shorter deadline on an easier
-- one. Answering itself is no longer gated by the reminder time either: a
-- promise is answerable from the moment its check exists until this window
-- runs out. The reminder time now only decides where that window starts,
-- for the deadline and for notifications.
--
-- Mirrors the same change in docs/store.js (deadlineFor). Change one, change
-- both — same discipline as mirroir_vitality().

alter table public.habits
  add column window_minutes int not null default 60
    check (window_minutes > 0);

create or replace function public.mirroir_daily_rollover() returns void as $$
begin
  update public.habit_checks hc
  set status = 'failed', expired = true
  from public.habits h, public.profiles p
  where hc.habit_id = h.id
    and h.user_id = p.id
    and hc.status = 'created'
    and (now() at time zone p.timezone)
        > (hc.date + h.reminder_time + (h.window_minutes || ' minutes')::interval);

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

-- Reminder pings land at quarters of the habit's own window rather than
-- fixed 15-minute steps, so a long window doesn't fall silent after the
-- first hour and a short one doesn't try to cram four pings where there is
-- no room. Mirrors reminderStepsFor() in docs/app.js.
create or replace function public.mirroir_due_pings()
returns table(endpoint text, p256dh text, auth_key text, title text, body text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select
      hc.id as check_id,
      h.title,
      h.user_id,
      h.window_minutes,
      floor(extract(epoch from ((now() at time zone p.timezone) - (hc.date + h.reminder_time))) / 60)::int as elapsed
    from public.habit_checks hc
    join public.habits h on h.id = hc.habit_id
    join public.profiles p on p.id = h.user_id
    where hc.status = 'created'
      and h.active
      and hc.date = (now() at time zone p.timezone)::date
  ),
  picked as (
    select check_id, title, user_id, window_minutes,
      case
        when elapsed >= (window_minutes * 3 / 4) then (window_minutes * 3 / 4)
        when elapsed >= (window_minutes / 2) then (window_minutes / 2)
        when elapsed >= (window_minutes / 4) then (window_minutes / 4)
        else 0
      end as step
    from due
    where elapsed >= 0 and elapsed < window_minutes
  ),
  claimed as (
    insert into public.push_log (check_id, step)
    select p.check_id, p.step from picked p
    on conflict (check_id, step) do nothing
    returning check_id, step
  )
  select
    ps.endpoint,
    ps.p256dh,
    ps.auth,
    case when c.step >= (p.window_minutes * 3 / 4) then 'Dernière chance' else 'Promesse du jour' end,
    case
      when c.step >= (p.window_minutes * 3 / 4) then
        'Il te reste ' || (p.window_minutes - c.step) || ' min pour répondre. Sans réponse, « ' || p.title || ' » est compté comme non tenu.'
      when c.step > 0 then
        '« ' || p.title || ' » — ' || (p.window_minutes - c.step) || ' min avant que ce soit non tenu.'
      else
        'Tu avais promis : ' || p.title || '. ' || p.window_minutes || ' min pour répondre.'
    end
  from claimed c
  join picked p on p.check_id = c.check_id and p.step = c.step
  join public.push_subscriptions ps on ps.user_id = p.user_id;
end;
$$;

revoke execute on function public.mirroir_due_pings() from public, anon, authenticated;
