-- WG-App: Push-Nachrichten – jede*r stellt selbst ein, wofür und wie oft
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.

-- Ein Eintrag pro Gerät (Handy, Laptop …), auf dem Push eingeschaltet wurde
create table if not exists public.push_subscriptions (
  endpoint     text primary key,
  member_id    uuid not null references public.members on delete cascade,
  household_id uuid not null references public.households on delete cascade,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "Eigene Geräte" on public.push_subscriptions;
create policy "Eigene Geräte" on public.push_subscriptions for all
  using (member_id = my_member_id()) with check (member_id = my_member_id() and is_member(household_id));

-- Einstellungen je Person: prefs = {"einkauf": "jeder" | "taeglich" | "aus", …}
-- last_sent = {"einkauf": "2026-11-09", …} – für "nur beim ersten Eintrag des Tages"
create table if not exists public.push_prefs (
  member_id  uuid primary key references public.members on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  last_sent  jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.push_prefs enable row level security;
drop policy if exists "Eigene Einstellungen" on public.push_prefs;
create policy "Eigene Einstellungen" on public.push_prefs for all
  using (member_id = my_member_id()) with check (member_id = my_member_id());

-- Wer bekommt für diesen Eintrag eine Nachricht? (wird von der App-Route /api/push aufgerufen)
-- Gibt die Geräte der Empfänger zurück und merkt sich bei "taeglich", dass heute schon benachrichtigt wurde.
create or replace function public.push_targets(p_area text, p_to uuid[] default null)
returns table (endpoint text, p256dh text, auth text, sender text)
language plpgsql security definer set search_path = public as $$
declare me members%rowtype; today text := to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD');
begin
  select * into me from members where user_id = auth.uid();
  if not found then raise exception 'Nicht angemeldet'; end if;

  -- Test-Nachricht: nur an die eigenen Geräte
  if p_area = 'test' then
    return query select s.endpoint, s.p256dh, s.auth, me.display_name from push_subscriptions s where s.member_id = me.id;
    return;
  end if;

  return query
  with r as (
    select m.id, coalesce(p.prefs ->> p_area, 'aus') as mode, p.last_sent ->> p_area as last
    from members m join push_prefs p on p.member_id = m.id
    where m.household_id = me.household_id and m.id <> me.id and m.role = 'mitbewohner'
      and (p_to is null or m.id = any(p_to))
  ), chosen as (
    select id from r where mode = 'jeder' or (mode = 'taeglich' and last is distinct from today)
  ), mark as (
    update push_prefs p set last_sent = p.last_sent || jsonb_build_object(p_area, today)
    where p.member_id in (select id from chosen)
    returning p.member_id
  )
  select s.endpoint, s.p256dh, s.auth, me.display_name
  from push_subscriptions s where s.member_id in (select member_id from mark);
end $$;
grant execute on function public.push_targets(text, uuid[]) to authenticated;

-- Abgelaufene Geräte aufräumen (nur innerhalb der eigenen WG)
create or replace function public.drop_push_subs(p_endpoints text[])
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions
  where endpoint = any(p_endpoints)
    and household_id = (select household_id from members where user_id = auth.uid());
$$;
grant execute on function public.drop_push_subs(text[]) to authenticated;
