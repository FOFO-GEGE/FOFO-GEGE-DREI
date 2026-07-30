-- Applied to the 'mirroir' Supabase project via MCP. Kept here for version control.
--
-- Web Push plumbing. The scheduling logic stays in SQL, where the per-user
-- timezone maths already lives; the Edge Function is only the transport.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
create policy "push_subscriptions_own" on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Ledger of pings already sent, so a cron running every 5 minutes cannot
-- re-send the same 15-minute step. RLS on with no policy is the deny-all:
-- only the service role touches this.
create table public.push_log (
  check_id uuid not null references public.habit_checks(id) on delete cascade,
  step int not null,
  sent_at timestamptz not null default now(),
  primary key (check_id, step)
);
alter table public.push_log enable row level security;
comment on table public.push_log is
  'Sent-ping ledger. Service role only - RLS on with no policy is intentional.';

-- Returns the pings due right now and claims them in the same statement: the
-- insert is the gate, so a row is handed out once even if two runs overlap.
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
      floor(extract(epoch from ((now() at time zone p.timezone) - (hc.date + h.reminder_time))) / 60)::int as elapsed
    from public.habit_checks hc
    join public.habits h on h.id = hc.habit_id
    join public.profiles p on p.id = h.user_id
    where hc.status = 'created'
      and h.active
      and hc.date = (now() at time zone p.timezone)::date
  ),
  picked as (
    select check_id, title, user_id,
      case
        when elapsed >= 45 then 45
        when elapsed >= 30 then 30
        when elapsed >= 15 then 15
        else 0
      end as step
    from due
    where elapsed >= 0 and elapsed < 60
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
    case when c.step >= 45 then 'Dernière chance' else 'Promesse du jour' end,
    case
      when c.step >= 45 then 'Il te reste 15 min pour répondre. Sans réponse, « ' || p.title || ' » est compté comme non tenu.'
      when c.step >= 15 then '« ' || p.title || ' » — ' || (60 - c.step) || ' min avant que ce soit non tenu.'
      else 'Tu avais promis : ' || p.title || '. Une heure pour répondre.'
    end
  from claimed c
  join picked p on p.check_id = c.check_id and p.step = c.step
  join public.push_subscriptions ps on ps.user_id = p.user_id;
end;
$$;

revoke execute on function public.mirroir_due_pings() from public, anon, authenticated;

create extension if not exists pg_net;

-- The Edge Function keeps verify_jwt on, so the call presents the service-role
-- key, read from Vault rather than written into the job definition. Until that
-- Vault secret exists the job runs and fails harmlessly.
select cron.schedule(
  'mirroir-send-reminders',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://nkdncuikalxjozltjqyy.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'mirroir_service_role_key' limit 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $job$
);

-- The aggregate comparison is for signed-in users only.
revoke execute on function public.global_today_success_rate() from anon;
