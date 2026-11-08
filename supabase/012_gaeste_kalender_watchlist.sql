-- ════════════════════════════════════════════════════════════════════
-- WG-App: Gäste-Zugang, erweiterter Kalender, Watchlist
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.
-- Voraussetzung: 003–011 wurden ausgeführt. Kann gefahrlos mehrfach ausgeführt werden.
-- ════════════════════════════════════════════════════════════════════

-- ───────────── Gäste: Rolle, Rechte, eigener Code ─────────────
alter table public.members add column if not exists role text not null default 'mitbewohner';
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check check (role in ('mitbewohner', 'gast'));
-- Rechte eines Gastes, z. B. {"kalender": true, "pinnwand": false, "watchlist": true}
alter table public.members add column if not exists permissions jsonb not null default '{}'::jsonb;
alter table public.members add column if not exists guest_code text unique;

-- Mitbewohner (keine Gäste) dieser WG?
create or replace function public.is_resident(h uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from members where household_id = h and user_id = auth.uid() and role = 'mitbewohner')
$$;

-- Darf ich (Mitbewohner immer, Gast nur mit Freigabe) diesen Bereich sehen?
create or replace function public.can_see(h uuid, area text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from members
    where household_id = h and user_id = auth.uid()
      and (role = 'mitbewohner' or coalesce((permissions ->> area)::boolean, false))
  )
$$;

-- Gäste dürfen ihre Rolle/Rechte/ihren Code nicht selbst ändern
create or replace function public.protect_member_role()
returns trigger language plpgsql set search_path = public as $$
begin
  if not public.is_resident(old.household_id)
     and (new.role is distinct from old.role
          or new.permissions is distinct from old.permissions
          or new.guest_code is distinct from old.guest_code
          or new.household_id is distinct from old.household_id) then
    raise exception 'Das dürfen nur Mitbewohner ändern';
  end if;
  return new;
end $$;
drop trigger if exists members_protect_role on public.members;
create trigger members_protect_role before update on public.members
  for each row execute function public.protect_member_role();

-- Gast anlegen (nur Mitbewohner). Gibt den persönlichen Gast-Code zurück.
create or replace function public.create_guest(p_name text, p_color text, p_permissions jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  h    uuid;
  code text;
begin
  select household_id into h from members where user_id = auth.uid() and role = 'mitbewohner';
  if h is null then raise exception 'Nur Mitbewohner können Gäste einladen'; end if;
  code := 'G' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 7));
  insert into members (household_id, display_name, color, sort, role, permissions, guest_code)
  values (h, left(trim(p_name), 30), p_color, 100 + (select count(*) from members where household_id = h), 'gast', coalesce(p_permissions, '{}'::jsonb), code);
  return code;
end $$;

-- Gast-Link öffnen: WG-Name und Gastname anzeigen (vor dem Beitritt)
create or replace function public.guest_preview(p_code text)
returns json language sql security definer stable set search_path = public as $$
  select json_build_object('wg', h.name, 'name', m.display_name, 'color', m.color, 'id', m.id)
  from members m join households h on h.id = m.household_id
  where m.role = 'gast' and m.guest_code = upper(trim(p_code))
$$;

-- Dieses Gerät wird zum Gast
create or replace function public.claim_guest(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare g members;
begin
  if auth.uid() is null then raise exception 'Nicht eingeloggt'; end if;
  select * into g from members where role = 'gast' and guest_code = upper(trim(p_code));
  if g.id is null then raise exception 'Gast-Code ungültig'; end if;
  update members set user_id = null where user_id = auth.uid();
  update members set user_id = auth.uid() where id = g.id;
  return g.household_id;
end $$;

-- WG-Infos für Gäste (Gäste dürfen die households-Zeile nicht direkt lesen – dort steht der Einladungscode)
create or replace function public.guest_household()
returns json language sql security definer stable set search_path = public as $$
  select json_build_object('id', h.id, 'name', h.name, 'photo_path', h.photo_path, 'cleaning_start', h.cleaning_start)
  from members m join households h on h.id = m.household_id
  where m.user_id = auth.uid()
$$;

-- Mitbewohner-Einladung zeigt keine Gäste
create or replace function public.household_preview(p_code text)
returns json language sql security definer stable set search_path = public as $$
  select json_build_object(
    'name', h.name,
    'members', coalesce((
      select json_agg(json_build_object(
               'id', m.id, 'display_name', m.display_name, 'color', m.color,
               'claimed', m.user_id is not null) order by m.sort)
      from members m where m.household_id = h.id and m.role = 'mitbewohner'), '[]'::json))
  from households h
  where h.invite_code = upper(trim(p_code))
$$;

-- Mitbewohner-Link darf keine Gast-Zeile übernehmen
create or replace function public.claim_member(p_code text, p_member_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Nicht eingeloggt'; end if;
  select id into h from households where invite_code = upper(trim(p_code));
  if h is null then raise exception 'Einladungscode ungültig'; end if;
  if not exists (select 1 from members where id = p_member_id and household_id = h and role = 'mitbewohner') then
    raise exception 'Mitbewohner nicht gefunden';
  end if;
  update members set user_id = null where user_id = auth.uid();
  update members set user_id = auth.uid() where id = p_member_id;
  return h;
end $$;

-- ───────────── Kalender: mehrtägig, wiederkehrend, Sichtbarkeit ─────────────
alter table public.events add column if not exists end_day date;            -- mehrtägig (z. B. Urlaub)
alter table public.events add column if not exists recurrence text not null default 'keine';
alter table public.events drop constraint if exists events_recurrence_check;
alter table public.events add constraint events_recurrence_check check (recurrence in ('keine', 'woechentlich', 'monatlich', 'jaehrlich'));
alter table public.events add column if not exists visible_to uuid[];       -- null = alle; sonst nur diese Personen (+ wer es eingetragen hat)

-- ───────────── Watchlist ─────────────
create table if not exists public.watchlist (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  kind         text not null default 'film' check (kind in ('film', 'serie', 'doku', 'anderes')),
  platform     text,
  note         text,
  fans         uuid[] not null default '{}',   -- wer will das auch sehen
  watched      boolean not null default false,
  added_by     uuid default public.my_member_id() references public.members on delete set null,
  created_at   timestamptz not null default now()
);
alter table public.watchlist enable row level security;

-- ───────────── Zugriffsrechte neu: Mitbewohner alles, Gäste nur Freigegebenes ─────────────
do $$
declare t text;
begin
  -- Nur für Mitbewohner
  foreach t in array array['chore_areas', 'chore_tasks', 'chore_checks', 'shopping_items', 'expenses', 'todos'] loop
    execute format('drop policy if exists "WG-Daten" on public.%I', t);
    execute format('create policy "WG-Daten" on public.%I for all using (is_resident(household_id)) with check (is_resident(household_id))', t);
  end loop;
end $$;

drop policy if exists "WG sehen" on public.households;
drop policy if exists "WG umbenennen" on public.households;
create policy "WG sehen"      on public.households for select using (is_resident(id));
create policy "WG umbenennen" on public.households for update using (is_resident(id));

-- Mitglieder: Mitbewohner sehen alle; Gäste sehen Mitbewohner und sich selbst
drop policy if exists "Mitbewohner sehen" on public.members;
create policy "Mitbewohner sehen" on public.members for select
  using (is_resident(household_id) or (is_member(household_id) and (role = 'mitbewohner' or user_id = auth.uid())));
drop policy if exists "Gäste verwalten" on public.members;
create policy "Gäste verwalten" on public.members for update
  using (is_resident(household_id) and role = 'gast') with check (is_resident(household_id) and role = 'gast');
drop policy if exists "Gäste entfernen" on public.members;
create policy "Gäste entfernen" on public.members for delete
  using (is_resident(household_id) and role = 'gast');

drop policy if exists "Lob sehen" on public.praises;
drop policy if exists "Loben" on public.praises;
create policy "Lob sehen" on public.praises for select using (is_resident(household_id));
create policy "Loben"     on public.praises for insert with check (is_resident(household_id) and from_member = my_member_id());

-- Kalender: lesen, wer darf und für wen der Eintrag sichtbar ist; schreiben nur Mitbewohner
drop policy if exists "WG-Daten" on public.events;
drop policy if exists "Termine sehen" on public.events;
drop policy if exists "Termine bearbeiten" on public.events;
create policy "Termine sehen" on public.events for select
  using (can_see(household_id, 'kalender')
         and (visible_to is null or my_member_id() = any(visible_to) or created_by = my_member_id()));
create policy "Termine bearbeiten" on public.events for all
  using (is_resident(household_id)
         and (visible_to is null or my_member_id() = any(visible_to) or created_by = my_member_id()))
  with check (is_resident(household_id));

-- Pinnwand & Watchlist: Gäste mit Freigabe dürfen lesen
drop policy if exists "WG-Daten" on public.notes;
drop policy if exists "Pinnwand sehen" on public.notes;
drop policy if exists "Pinnwand schreiben" on public.notes;
create policy "Pinnwand sehen"     on public.notes for select using (can_see(household_id, 'pinnwand'));
create policy "Pinnwand schreiben" on public.notes for all using (is_resident(household_id)) with check (is_resident(household_id));

drop policy if exists "Watchlist sehen" on public.watchlist;
drop policy if exists "Watchlist schreiben" on public.watchlist;
create policy "Watchlist sehen"     on public.watchlist for select using (can_see(household_id, 'watchlist'));
create policy "Watchlist schreiben" on public.watchlist for all using (is_resident(household_id)) with check (is_resident(household_id));

-- Fotos: Profil- und WG-Fotos für alle in der WG, Pinnwand-Fotos nur mit Pinnwand-Freigabe; hochladen nur Mitbewohner
-- (Profilfotos laden Mitbewohner hoch; Gäste haben kein Profilfoto)
drop policy if exists "Pinnwand-Fotos lesen" on storage.objects;
drop policy if exists "Pinnwand-Fotos hochladen" on storage.objects;
drop policy if exists "Pinnwand-Fotos löschen" on storage.objects;
create policy "Pinnwand-Fotos lesen" on storage.objects for select to authenticated
  using (bucket_id = 'pinnwand' and (
    public.is_resident(((storage.foldername(name))[1])::uuid)
    or (public.is_member(((storage.foldername(name))[1])::uuid)
        and (name like '%/profil/%' or name like '%/wg-%'
             or public.can_see(((storage.foldername(name))[1])::uuid, 'pinnwand')))));
create policy "Pinnwand-Fotos hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'pinnwand' and public.is_resident(((storage.foldername(name))[1])::uuid));
create policy "Pinnwand-Fotos löschen" on storage.objects for delete to authenticated
  using (bucket_id = 'pinnwand' and public.is_resident(((storage.foldername(name))[1])::uuid));

-- ───────────── Live-Updates ─────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'watchlist') then
    alter publication supabase_realtime add table public.watchlist;
  end if;
end $$;
