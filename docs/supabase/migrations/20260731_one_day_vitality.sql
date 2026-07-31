-- Applied to the 'mirroir' Supabase project via MCP. Kept here for version control.
--
-- A promise whose entire lifespan is a single calendar day (start_date =
-- end_date) never gets the ordinary fold's second chance to recover -- one
-- day is the whole story. The flat -8/-12 delta on a 0-100 gauge barely
-- moves it (a declared failure still reads 92%, solidly green), so such a
-- promise now gets a compressed ceiling of its own, and its declared
-- failure is graded by how avoidable the given reason was. Silence still
-- costs exactly as much as the worst declared reason, never less --
-- honesty must never come out behind staying quiet.
--
-- Mirrors the same change to vitalityOf()/vitalityDelta() in docs/store.js.
-- Change one, change both.
create or replace function public.mirroir_vitality(p_habit uuid) returns int as $$
declare
  h record;
  is_one_day boolean;
  max_v int;
  v int;
  r record;
begin
  select start_date, end_date into h from public.habits where id = p_habit;
  is_one_day := h.end_date is not null and h.end_date = h.start_date;
  max_v := case when is_one_day then 20 else 100 end;
  v := max_v;

  for r in
    select hc.status, hc.expired, hc.reason
    from public.habit_checks hc
    where hc.habit_id = p_habit
    order by hc.date asc
  loop
    v := v + case
      when r.status = 'success' then 12
      when r.status = 'frozen'  then 0   -- a freeze is meant to cost nothing
      when r.status = 'failed' and r.expired then -12
      when r.status = 'failed' and is_one_day then
        case r.reason
          when 'imprevu' then -8
          when 'fatigue' then -10
          when 'oubli'   then -11
          when 'envie'   then -12
          else -8
        end
      when r.status = 'failed' then -8
      else 0                             -- 'created' days are undecided
    end;
    if v > max_v then v := max_v; end if;
    if v <= 0 then return 0; end if;      -- death is terminal
  end loop;

  -- Normalized to a 0-100 percentage regardless of which ceiling produced
  -- it, so every consumer of this function keeps reading a single scale.
  return round((v::numeric / max_v) * 100);
end;
$$ language plpgsql stable security definer set search_path = public;
