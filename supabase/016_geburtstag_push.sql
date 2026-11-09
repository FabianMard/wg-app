-- WG-App: Geburtstags-Erinnerung per Push – jede*r wählt "Aus" oder "1× am Tag" mit eigener Uhrzeit
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Voraussetzung: 015_push.sql
-- Nutzt die Supabase-Erweiterungen pg_cron (Zeitplan) und pg_net (ruft stündlich die App auf).

-- Geheimer Schlüssel, mit dem nur der Zeitplan die Erinnerungen abrufen darf (für niemanden lesbar)
create table if not exists public.push_cron (
  id     int primary key default 1 check (id = 1),
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
alter table public.push_cron enable row level security;
revoke all on public.push_cron from anon, authenticated;
insert into public.push_cron default values on conflict do nothing;

-- "🎂 Geburtstag von Verena" / "Verenas Geburtstag" / "🎂 Verena" → "Verena"
create or replace function public.birthday_name(t text)
returns text language sql immutable as $$
  select case
    when x = '' then t
    when x ~* '^geburtstag\s+' then regexp_replace(x, '^geburtstag\s+(von\s+)?', '', 'i')
    when x ~* '\s+geburtstag$' then regexp_replace(regexp_replace(x, '\s+geburtstag$', '', 'i'), 's$', '')
    else x end
  from (select btrim(replace(t, '🎂', '')) as x) s
$$;

-- Wer soll JETZT (volle Stunde, deutsche Zeit) an einen Geburtstag von heute erinnert werden?
-- Merkt sich, dass heute schon erinnert wurde. Nur mit dem geheimen Schlüssel aufrufbar.
create or replace function public.birthday_push_due(p_secret text)
returns table (endpoint text, p256dh text, auth text, body text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  now_b timestamp := now() at time zone 'Europe/Berlin';
  today date := (now() at time zone 'Europe/Berlin')::date;
  hh text := to_char(now() at time zone 'Europe/Berlin', 'HH24');
  d text := to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD');
  leap boolean := extract(day from make_date(extract(year from now_b)::int, 3, 1) - 1) = 29;
begin
  if p_secret is null or not exists (select 1 from push_cron c where c.secret = p_secret) then
    raise exception 'Nicht erlaubt';
  end if;
  return query
  with bdays as (
    select e.household_id, e.visible_to, birthday_name(e.title) as name
    from events e
    where coalesce(e.recurrence, 'keine') = 'jaehrlich' and e.title ~* '(🎂|geburtstag)'
      and (to_char(e.day, 'MM-DD') = to_char(today, 'MM-DD')
           -- 29. Februar in Nicht-Schaltjahren am 28. feiern
           or (not leap and to_char(e.day, 'MM-DD') = '02-29' and to_char(today, 'MM-DD') = '02-28'))
  ), rec as (
    select m.id, string_agg(distinct b.name, ' & ') as names
    from members m
    join push_prefs p on p.member_id = m.id
    join bdays b on b.household_id = m.household_id
                and (b.visible_to is null or cardinality(b.visible_to) = 0 or m.id = any(b.visible_to))
                and lower(b.name) <> lower(m.display_name)          -- nicht an den eigenen Geburtstag erinnern
    where m.role = 'mitbewohner'
      and p.prefs ->> 'geburtstag' = 'taeglich'
      and coalesce(p.prefs ->> 'geburtstag_zeit', '09') = hh
      and (p.last_sent ->> 'geburtstag') is distinct from d
    group by m.id
  ), mark as (
    update push_prefs p set last_sent = p.last_sent || jsonb_build_object('geburtstag', d)
    from rec where p.member_id = rec.id
    returning p.member_id, rec.names
  )
  select s.endpoint, s.p256dh, s.auth, 'Heute hat ' || mark.names || ' Geburtstag! 🎉'
  from mark join push_subscriptions s on s.member_id = mark.member_id;
end $$;
revoke all on function public.birthday_push_due(text) from public;
grant execute on function public.birthday_push_due(text) to anon, authenticated;

-- ── Zeitplan: jede volle Stunde die App anstoßen ──
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('wg-geburtstage') where exists (select 1 from cron.job where jobname = 'wg-geburtstage');
select cron.schedule('wg-geburtstage', '0 * * * *', $job$
  select net.http_post(
    url     := 'https://wg-app-iota.vercel.app/api/push/geburtstage',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select secret from public.push_cron where id = 1)),
    body    := '{}'::jsonb
  );
$job$);
