-- Applied to the 'mirroir' Supabase project via MCP. Kept here for version control / reproducibility.

create extension if not exists pg_cron;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Europe/Paris',
  created_at timestamptz not null default now()
);

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  type text not null check (type in ('daily','frequency')),
  frequency int,
  target_days int[] not null,
  reminder_time time not null default '20:00',
  start_date date not null default current_date,
  end_date date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.habit_checks (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  date date not null,
  status text not null default 'created' check (status in ('created','success','failed','no_data')),
  unique (habit_id, date)
);

create index habit_checks_habit_id_idx on public.habit_checks(habit_id);
create index habits_user_id_idx on public.habits(user_id);

alter table public.profiles enable row level security;
alter table public.habits enable row level security;
alter table public.habit_checks enable row level security;

create policy "profiles_own" on public.profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

create policy "habits_own" on public.habits for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "habit_checks_own" on public.habit_checks for all
  using (habit_id in (select id from public.habits where user_id = auth.uid()))
  with check (habit_id in (select id from public.habits where user_id = auth.uid()));

create function public.handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.mirroir_daily_rollover() returns void as $$
begin
  update public.habit_checks hc
  set status = 'no_data'
  from public.habits h, public.profiles p
  where hc.habit_id = h.id
    and h.user_id = p.id
    and hc.status = 'created'
    and hc.date < (now() at time zone p.timezone)::date;

  insert into public.habit_checks (habit_id, date, status)
  select h.id, (now() at time zone p.timezone)::date, 'created'
  from public.habits h
  join public.profiles p on p.id = h.user_id
  where h.active
    and extract(dow from (now() at time zone p.timezone)::date)::int = any(h.target_days)
    and (now() at time zone p.timezone)::date >= h.start_date
    and (h.end_date is null or (now() at time zone p.timezone)::date <= h.end_date)
    and not exists (
      select 1 from public.habit_checks hc
      where hc.habit_id = h.id and hc.date = (now() at time zone p.timezone)::date
    );
end;
$$ language plpgsql security definer set search_path = public;

select cron.schedule('mirroir-daily-rollover', '0 * * * *', 'select public.mirroir_daily_rollover();');

-- security: these functions must not be callable directly via the REST API
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.mirroir_daily_rollover() from public, anon, authenticated;
