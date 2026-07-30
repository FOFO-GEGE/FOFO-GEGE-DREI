-- Applied to the 'mirroir' Supabase project via MCP. Kept here for version control.
--
-- Cards can now die on their own.
--
-- Until now the only way a promise left the deck was the user tapping
-- "Abandonner", which made the deck a place where nothing could ever happen to
-- you. A card now carries a vitality that is spent by broken promises and
-- restored by kept ones, and when it reaches zero the card dies unattended —
-- the cron buries it whether or not the app has been opened in weeks.
--
-- mirroir_vitality() is a deliberate mirror of vitalityOf() in docs/store.js.
-- The two must stay identical: the client shows the value, the cron acts on
-- it, and a disagreement between them would either kill a card the user
-- believed was healthy or keep alive one the app had already written off.
-- Change one, change both.

alter table public.habits
  add column death_cause text
    check (death_cause is null or death_cause in ('abandoned', 'neglect')),
  add column death_announced boolean not null default false;

-- Everything already in the cemetery got there by an explicit tap, and its
-- owner was present when it happened — nothing left to break to them.
update public.habits
  set death_cause = 'abandoned', death_announced = true
  where not active and deleted_at is not null;

-- A clamped running fold: it saturates at 100 and stops dead at 0. Not
-- expressible as a plain window sum, which is why this is a loop rather than
-- an aggregate. Habits per user are few, so the cost is irrelevant.
create or replace function public.mirroir_vitality(p_habit uuid) returns int as $$
declare
  v int := 100;
  r record;
begin
  for r in
    select hc.status, hc.expired
    from public.habit_checks hc
    where hc.habit_id = p_habit
    order by hc.date asc
  loop
    v := v + case
      when r.status = 'success' then 12
      when r.status = 'frozen'  then 0   -- a freeze is meant to cost nothing
      when r.status = 'failed'  then (case when r.expired then -12 else -8 end)
      else 0                             -- 'created' days are undecided
    end;
    if v > 100 then v := 100; end if;
    if v <= 0 then return 0; end if;      -- death is terminal
  end loop;
  return v;
end;
$$ language plpgsql stable security definer set search_path = public;

revoke execute on function public.mirroir_vitality(uuid) from public, anon, authenticated;

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
        <= ((now() at time zone p.timezone)::date + h.reminder_time + interval '1 hour')
    and not exists (
      select 1 from public.habit_checks hc
      where hc.habit_id = h.id and hc.date = (now() at time zone p.timezone)::date
    );
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.mirroir_daily_rollover() from public, anon, authenticated;
