-- Applied to the 'mirroir' Supabase project via MCP. Kept here for version control.
--
-- A dead card can be revived from the cemetery — once, ever. It comes back
-- at Œuf and carries a permanent scar rather than looking like a card that
-- was never buried.
--
-- This requires bounding mirroir_vitality()'s fold at the habit's start_date
-- rather than folding every check the habit has ever had. Without that, a
-- revived card's vitality would still hit the exact same historical zero
-- that killed it and return 0 immediately, before ever reaching a check
-- recorded after the resurrection — the fold is terminal by design (see the
-- original migration), so nothing chronologically after that zero can matter
-- unless the starting point itself moves forward. Resurrecting a card resets
-- start_date to the day of the revival, which both re-eggs its tier and is
-- what lets its vitality start over. This bound is a no-op for every card
-- that was never resurrected: isDue() already guarantees no check exists
-- before its habit's start_date.

alter table public.habits
  add column resurrected boolean not null default false,
  add column pre_death_days int;

create or replace function public.mirroir_vitality(p_habit uuid) returns int as $$
declare
  v int := 100;
  r record;
begin
  for r in
    select hc.status, hc.expired
    from public.habit_checks hc
    join public.habits h on h.id = hc.habit_id
    where hc.habit_id = p_habit
      and hc.date >= h.start_date
    order by hc.date asc
  loop
    v := v + case
      when r.status = 'success' then 12
      when r.status = 'frozen'  then 0
      when r.status = 'failed'  then (case when r.expired then -12 else -8 end)
      else 0
    end;
    if v > 100 then v := 100; end if;
    if v <= 0 then return 0; end if;
  end loop;
  return v;
end;
$$ language plpgsql stable security definer set search_path = public;

revoke execute on function public.mirroir_vitality(uuid) from public, anon, authenticated;
