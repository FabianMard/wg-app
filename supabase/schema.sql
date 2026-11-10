-- ════════════════════════════════════════════════════════════════════
-- WG-App: Datenbank (Version 2)
-- Im Supabase-Dashboard unter "SQL Editor" komplett einfügen und ausführen.
--
-- ACHTUNG: Löscht alle bisherigen WG-Daten und legt alles neu an,
-- inklusive Mitbewohner (Verena, Stefan, Fabian) und Putzplan.
-- Am Ende wird der Einladungscode angezeigt.
--
-- Voraussetzung: Authentication → Sign In / Providers →
-- "Allow anonymous sign-ins" aktivieren.
-- ════════════════════════════════════════════════════════════════════

-- ───────────── Alte Version entfernen ─────────────
drop table if exists public.cost_requests, public.poll_votes, public.poll_options, public.polls, public.tennis_matches, public.kite_spots, public.push_cron, public.push_subscriptions, public.push_prefs, public.game_scores, public.playlists, public.watchlist, public.messages, public.notes, public.praises, public.chore_checks, public.chore_tasks, public.chore_areas,
  public.chores, public.shopping_items, public.expenses, public.events, public.todos,
  public.members, public.households cascade;
drop function if exists public.is_member(uuid) cascade;
drop function if exists public.my_member_id() cascade;
drop function if exists public.next_color(uuid) cascade;
drop function if exists public.create_household(text, text) cascade;
drop function if exists public.join_household(text, text) cascade;
drop function if exists public.household_preview(text) cascade;
drop function if exists public.claim_member(text, uuid) cascade;

create extension if not exists pgcrypto;

-- ───────────── WG & Mitbewohner ─────────────
create table public.households (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  invite_code    text not null unique default upper(substr(md5(random()::text), 1, 6)),
  -- Montag, an dem die erste Putzrunde beginnt (Runden dauern 2 Wochen)
  cleaning_start date not null default date_trunc('week', now())::date,
  -- "Oft gebraucht" in der Einkaufsliste (null = automatisch)
  shopping_favorites text[],
  photo_path     text,            -- WG-Foto (Storage-Bucket "pinnwand")
  created_at     timestamptz not null default now()
);

-- Mitbewohner sind fest angelegt. Ein Gerät "übernimmt" einen Mitbewohner (user_id).
create table public.members (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  display_name text not null,
  color        text not null,
  sort         int  not null default 0,
  user_id      uuid unique references auth.users on delete set null,
  avatar       jsonb,           -- Aussehen im WG-Spiel (Frisur, Kleidung, …)
  photo_path   text,            -- Profilfoto im Storage-Bucket "pinnwand"
  reading      jsonb,           -- "Ich lese gerade" (Titel, Autor, Fortschritt, Link)
  created_at   timestamptz not null default now()
);

create function public.is_member(h uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from members where household_id = h and user_id = auth.uid())
$$;

create function public.my_member_id()
returns uuid language sql security definer stable set search_path = public as $$
  select id from members where user_id = auth.uid()
$$;

-- ───────────── Putzplan ─────────────
create table public.chore_areas (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name         text not null,
  icon         text not null default '🧽',
  sort         int  not null default 0
);

create table public.chore_tasks (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  area_id      uuid not null references public.chore_areas on delete cascade,
  title        text not null,
  sort         int  not null default 0,
  created_at   timestamptz not null default now()
);

-- Abgehakte Tasks je Putzrunde (period = Nummer der 2-Wochen-Runde ab cleaning_start)
create table public.chore_checks (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  area_id      uuid not null references public.chore_areas on delete cascade,
  task_id      uuid not null references public.chore_tasks on delete cascade,
  period       int  not null,
  done_by      uuid default public.my_member_id() references public.members on delete set null,
  done_at      timestamptz not null default now(),
  unique (task_id, period)
);

-- ───────────── Einkaufsliste ─────────────
create table public.shopping_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name         text not null,
  store        text not null default 'egal'
               check (store in ('hit', 'rewe', 'konsum', 'baumarkt', 'egal', 'sonstiges')),
  store_note   text,            -- bei "sonstiges": welcher Laden
  done         boolean not null default false,
  archived     boolean not null default false,  -- "Gekaufte entfernen" (bleibt für Vorschläge erhalten)
  done_by      uuid references public.members on delete set null,  -- wer hat's eingekauft
  done_at      timestamptz,
  added_by     uuid default public.my_member_id() references public.members on delete set null,
  created_at   timestamptz not null default now()
);

-- ───────────── Kosten ─────────────
-- Ausgleichszahlung (A zahlt B zurück): paid_by = A, participants = {B}, is_settlement = true
create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households on delete cascade,
  title         text not null,
  amount        numeric(10,2) not null check (amount > 0),
  paid_by       uuid not null references public.members on delete cascade,
  participants  uuid[] not null check (cardinality(participants) > 0),
  is_settlement boolean not null default false,
  spent_on      date not null default current_date,
  created_by    uuid default public.my_member_id() references public.members on delete set null,
  created_at    timestamptz not null default now()
);

-- ───────────── Kalender ─────────────
create table public.events (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  title        text not null,
  day          date not null,
  time         time,
  note         text,
  created_by   uuid default public.my_member_id() references public.members on delete set null,
  created_at   timestamptz not null default now()
);

-- ───────────── To-dos ─────────────
create table public.todos (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  title        text not null,
  done         boolean not null default false,
  done_by      uuid references public.members on delete set null,
  done_at      timestamptz,
  assignee     uuid references public.members on delete set null,
  due_date     date,
  created_by   uuid default public.my_member_id() references public.members on delete set null,
  created_at   timestamptz not null default now()
);

-- ───────────── Fleißige Bienchen (Lob) ─────────────
create table public.praises (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  from_member  uuid not null default public.my_member_id() references public.members on delete cascade,
  to_member    uuid references public.members on delete cascade,   -- leer = Gruppen-Nachricht an alle
  kind         text not null check (kind in ('putzen', 'todo')),
  ref          text not null,   -- z. B. "<area_id>:<period>" oder todo-id
  created_at   timestamptz not null default now(),
  unique (from_member, to_member, kind, ref),
  check (from_member <> to_member)
);

-- ───────────── Pinnwand (Post-its) ─────────────
create table public.notes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  text         text not null default '' check (char_length(text) <= 300),
  color        text not null default 'gelb' check (color in ('gelb', 'rosa', 'gruen', 'blau', 'orange')),
  image_path   text,            -- Foto im Storage-Bucket "pinnwand"
  author       uuid default public.my_member_id() references public.members on delete set null,
  created_at   timestamptz not null default now(),
  constraint notes_content_check check (char_length(text) > 0 or image_path is not null)
);

-- ───────────── Beitritt per Link ─────────────
create function public.household_preview(p_code text)
returns json language sql security definer stable set search_path = public as $$
  select json_build_object(
    'name', h.name,
    'members', coalesce((
      select json_agg(json_build_object(
               'id', m.id, 'display_name', m.display_name, 'color', m.color,
               'claimed', m.user_id is not null) order by m.sort)
      from members m where m.household_id = h.id), '[]'::json))
  from households h
  where h.invite_code = upper(trim(p_code))
$$;

-- Dieses Gerät wird zu Mitbewohner p_member_id (z. B. "Ich bin Verena")
create function public.claim_member(p_code text, p_member_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Nicht eingeloggt'; end if;
  select id into h from households where invite_code = upper(trim(p_code));
  if h is null then raise exception 'Einladungscode ungültig'; end if;
  if not exists (select 1 from members where id = p_member_id and household_id = h) then
    raise exception 'Mitbewohner nicht gefunden';
  end if;
  update members set user_id = null where user_id = auth.uid();
  update members set user_id = auth.uid() where id = p_member_id;
  return h;
end $$;

-- ───────────── Zugriffsrechte (Row Level Security) ─────────────
alter table public.households     enable row level security;
alter table public.members        enable row level security;
alter table public.chore_areas    enable row level security;
alter table public.chore_tasks    enable row level security;
alter table public.chore_checks   enable row level security;
alter table public.shopping_items enable row level security;
alter table public.expenses       enable row level security;
alter table public.events         enable row level security;
alter table public.todos          enable row level security;
alter table public.praises        enable row level security;
alter table public.notes          enable row level security;

create policy "WG sehen"      on public.households for select using (is_member(id));
create policy "WG umbenennen" on public.households for update using (is_member(id));

create policy "Mitbewohner sehen"     on public.members for select using (is_member(household_id));
create policy "Eigenen Namen ändern"  on public.members for update using (user_id = auth.uid());

create policy "WG-Daten" on public.chore_areas    for all using (is_member(household_id)) with check (is_member(household_id));
create policy "WG-Daten" on public.chore_tasks    for all using (is_member(household_id)) with check (is_member(household_id));
create policy "WG-Daten" on public.chore_checks   for all using (is_member(household_id)) with check (is_member(household_id));
create policy "WG-Daten" on public.shopping_items for all using (is_member(household_id)) with check (is_member(household_id));
create policy "WG-Daten" on public.expenses       for all using (is_member(household_id)) with check (is_member(household_id));
create policy "WG-Daten" on public.events         for all using (is_member(household_id)) with check (is_member(household_id));
create policy "WG-Daten" on public.todos          for all using (is_member(household_id)) with check (is_member(household_id));
create policy "WG-Daten" on public.notes          for all using (is_member(household_id)) with check (is_member(household_id));

create policy "Lob sehen"     on public.praises for select using (is_member(household_id));
create policy "Loben"         on public.praises for insert
  with check (is_member(household_id) and from_member = my_member_id());
create policy "Lob zurücknehmen" on public.praises for delete using (from_member = my_member_id());

-- ───────────── Live-Updates ─────────────
alter publication supabase_realtime
  add table public.households, public.members, public.chore_areas, public.chore_tasks, public.chore_checks,
            public.shopping_items, public.expenses, public.events, public.todos, public.praises, public.notes;

-- ───────────── Startdaten: eure WG ─────────────
do $$
declare
  h uuid;
  a uuid;
begin
  insert into households (name) values ('Unsere WG') returning id into h;

  insert into members (household_id, display_name, color, sort) values
    (h, 'Verena', '#ec4899', 0),
    (h, 'Stefan', '#3b82f6', 1),
    (h, 'Fabian', '#10b981', 2);

  insert into chore_areas (household_id, name, icon, sort) values (h, 'Küche', '🍳', 0) returning id into a;
  insert into chore_tasks (household_id, area_id, title, sort)
  select h, a, t, o from unnest(array[
    'Arbeitsflächen & Herd putzen',
    'Spüle & Armaturen reinigen',
    'Kühlschrank: Abgelaufenes raus & auswischen',
    'Mikrowelle & Backofen auswischen',
    'Mülleimer auswaschen',
    'Boden saugen & wischen'
  ]) with ordinality as x(t, o);

  insert into chore_areas (household_id, name, icon, sort) values (h, 'Bad', '🛁', 1) returning id into a;
  insert into chore_tasks (household_id, area_id, title, sort)
  select h, a, t, o from unnest(array[
    'Toilette putzen',
    'Waschbecken & Spiegel putzen',
    'Dusche / Badewanne putzen',
    'Handtücher & Badvorleger waschen',
    'Mülleimer leeren',
    'Boden saugen & wischen'
  ]) with ordinality as x(t, o);

  insert into chore_areas (household_id, name, icon, sort) values (h, 'Sonstiges', '🧹', 2) returning id into a;
  insert into chore_tasks (household_id, area_id, title, sort)
  select h, a, t, o from unnest(array[
    'Flur saugen & wischen',
    'Wohnzimmer saugen',
    'Staub wischen',
    'Altglas & Pfand wegbringen',
    'Altpapier wegbringen'
  ]) with ordinality as x(t, o);
end $$;

-- ───────────── Chat (nur Absender & Empfänger) ─────────────
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  from_member  uuid not null default public.my_member_id() references public.members on delete cascade,
  to_member    uuid not null references public.members on delete cascade,
  text         text not null check (char_length(text) between 1 and 500),
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists messages_pair on public.messages (household_id, from_member, to_member, created_at);

alter table public.messages enable row level security;

do $$
begin
  -- Nur Absender und Empfänger sehen eine Nachricht
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'Eigene Nachrichten lesen') then
    create policy "Eigene Nachrichten lesen" on public.messages for select
      using (is_member(household_id) and my_member_id() in (from_member, to_member));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'Nachricht schreiben') then
    create policy "Nachricht schreiben" on public.messages for insert
      with check (is_member(household_id) and from_member = my_member_id() and to_member <> from_member);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'Als gelesen markieren') then
    create policy "Als gelesen markieren" on public.messages for update
      using (to_member = my_member_id()) with check (to_member = my_member_id());
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ───────────── Fotos an der Pinnwand (privater Speicher) ─────────────
-- Privater Speicher für die Fotos (max. 5 MB pro Bild)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pinnwand', 'pinnwand', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Nur Mitglieder der WG dürfen die Fotos ihrer WG sehen, hochladen und löschen.
-- Dateien liegen unter <household_id>/<zufälliger-name>.jpg
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Pinnwand-Fotos lesen') then
    create policy "Pinnwand-Fotos lesen" on storage.objects for select to authenticated
      using (bucket_id = 'pinnwand' and public.is_member(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Pinnwand-Fotos hochladen') then
    create policy "Pinnwand-Fotos hochladen" on storage.objects for insert to authenticated
      with check (bucket_id = 'pinnwand' and public.is_member(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Pinnwand-Fotos löschen') then
    create policy "Pinnwand-Fotos löschen" on storage.objects for delete to authenticated
      using (bucket_id = 'pinnwand' and public.is_member(((storage.foldername(name))[1])::uuid));
  end if;
end $$;

-- ════════ Gäste, Kalender-Optionen, Watchlist (siehe 012) ════════
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

-- ════════ Musikliste (siehe 013) ════════
create table if not exists public.playlists (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  url          text not null check (url like 'https://open.spotify.com/%'),
  mood         text not null default 'sonstiges' check (mood in ('party', 'putzen', 'chillen', 'kochen', 'sport', 'sonstiges')),
  added_by     uuid default public.my_member_id() references public.members on delete set null,
  created_at   timestamptz not null default now()
);
alter table public.playlists enable row level security;

drop policy if exists "Musik sehen" on public.playlists;
drop policy if exists "Musik schreiben" on public.playlists;
-- Mitbewohner alles; Gäste nur lesen, wenn "musik" freigegeben ist
create policy "Musik sehen"     on public.playlists for select using (can_see(household_id, 'musik'));
create policy "Musik schreiben" on public.playlists for all using (is_resident(household_id)) with check (is_resident(household_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'playlists') then
    alter publication supabase_realtime add table public.playlists;
  end if;
end $$;

-- ───────────── Bestenliste (Minispiele) ─────────────

create table if not exists public.game_scores (
  household_id uuid not null references public.households on delete cascade,
  member_id    uuid not null references public.members on delete cascade,
  game         text not null check (game ~ '^[a-z]{2,20}$'),
  best         integer not null default 0 check (best >= 0),
  updated_at   timestamptz not null default now(),
  primary key (member_id, game)
);
alter table public.game_scores enable row level security;

drop policy if exists "Bestenliste sehen" on public.game_scores;
-- Alle in der WG (auch Gäste) sehen die Bestenliste. Schreiben nur über submit_score().
create policy "Bestenliste sehen" on public.game_scores for select using (is_member(household_id));

-- Eigenes Ergebnis melden – gespeichert wird nur, wenn es besser ist als der bisherige Rekord.
create or replace function public.submit_score(p_game text, p_score integer)
returns integer language plpgsql security definer set search_path = public as $$
declare m members%rowtype; result integer;
begin
  select * into m from members where user_id = auth.uid();
  if not found then raise exception 'Nicht angemeldet'; end if;
  insert into game_scores (household_id, member_id, game, best)
    values (m.household_id, m.id, p_game, greatest(p_score, 0))
  on conflict (member_id, game) do update
    set best = greatest(game_scores.best, excluded.best),
        updated_at = case when excluded.best > game_scores.best then now() else game_scores.updated_at end
  returning best into result;
  return result;
end $$;
grant execute on function public.submit_score(text, integer) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_scores') then
    alter publication supabase_realtime add table public.game_scores;
  end if;
end $$;

-- ───────────── Push-Nachrichten ─────────────

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

-- ───────────── Geburtstags-Erinnerung (Push) ─────────────

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

-- ───────────── Kite-Spots ─────────────
create table if not exists public.kite_spots (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  place        text,
  cc           text,                      -- Ländercode für die Flagge, z. B. 'DE'
  lat          double precision not null check (lat between -90 and 90),
  lon          double precision not null check (lon between -180 and 180),
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);
alter table public.kite_spots enable row level security;
drop policy if exists "Spots sehen" on public.kite_spots;
drop policy if exists "Spots ändern" on public.kite_spots;
-- Alle in der WG sehen die Spots (auch Gäste), ändern dürfen Mitbewohner
create policy "Spots sehen"  on public.kite_spots for select using (is_member(household_id));
create policy "Spots ändern" on public.kite_spots for all using (is_resident(household_id)) with check (is_resident(household_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kite_spots') then
    alter publication supabase_realtime add table public.kite_spots;
  end if;
end $$;


-- ───────────── Live-Tennis ─────────────
create table if not exists public.tennis_matches (
  id             uuid primary key,                 -- = Match-ID, so wird ein Match nie doppelt gezählt
  household_id   uuid not null references public.households on delete cascade,
  winner         uuid not null references public.members on delete cascade,
  loser          uuid not null references public.members on delete cascade,
  winner_points  int  not null check (winner_points between 0 and 99),
  loser_points   int  not null check (loser_points between 0 and 99),
  created_at     timestamptz not null default now(),
  check (winner <> loser)
);
alter table public.tennis_matches enable row level security;
drop policy if exists "Matches sehen" on public.tennis_matches;
drop policy if exists "Eigenes Match eintragen" on public.tennis_matches;
create policy "Matches sehen" on public.tennis_matches for select using (is_member(household_id));
-- Eintragen darf nur, wer selbst mitgespielt hat
create policy "Eigenes Match eintragen" on public.tennis_matches for insert
  with check (is_member(household_id) and (winner = my_member_id() or loser = my_member_id()));

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tennis_matches') then
    alter publication supabase_realtime add table public.tennis_matches;
  end if;
end $$;

-- ───────────── WG-Chat für alle ─────────────
drop policy if exists "Eigene Nachrichten lesen" on public.messages;
drop policy if exists "Nachricht schreiben" on public.messages;
-- Private Nachrichten: nur Absender & Empfänger. Gruppen-Nachrichten (to_member leer): alle in der WG.
create policy "Eigene Nachrichten lesen" on public.messages for select
  using (is_member(household_id) and (to_member is null or my_member_id() in (from_member, to_member)));
create policy "Nachricht schreiben" on public.messages for insert
  with check (is_member(household_id) and from_member = my_member_id() and (to_member is null or to_member <> from_member));

-- ───────────── Bild an der Wand ─────────────
alter table public.members add column if not exists wall_art jsonb;   -- { title, file, url, kind, year }

-- ───────────── Abstimmungen ─────────────
create table if not exists public.polls (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  created_by   uuid default public.my_member_id() references public.members on delete set null,
  title        text not null check (char_length(title) between 1 and 120),
  note         text check (note is null or char_length(note) <= 500),
  kind         text not null check (kind in ('termin', 'janein', 'auswahl')),
  rule         text not null default 'mehrheit' check (rule in ('mehrheit', 'einstimmig')),
  multi        boolean not null default false,          -- mehrere Optionen ankreuzbar (z. B. alle passenden Termine)
  deadline     timestamptz,
  closed_at    timestamptz,
  result       uuid,                                    -- gewählte Option (null = keine Einigung)
  event_id     uuid references public.events on delete set null,
  created_at   timestamptz not null default now()
);
create table if not exists public.poll_options (
  id           uuid primary key default gen_random_uuid(),
  poll_id      uuid not null references public.polls on delete cascade,
  household_id uuid not null references public.households on delete cascade,
  label        text not null check (char_length(label) between 1 and 120),
  day          date,                                    -- bei Terminen
  time         time,
  sort         int not null default 0
);
create table if not exists public.poll_votes (
  option_id    uuid not null references public.poll_options on delete cascade,
  poll_id      uuid not null references public.polls on delete cascade,
  household_id uuid not null references public.households on delete cascade,
  member_id    uuid not null default public.my_member_id() references public.members on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (option_id, member_id)
);
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists "Abstimmungen sehen" on public.polls;
drop policy if exists "Abstimmung anlegen" on public.polls;
drop policy if exists "Eigene Abstimmung ändern" on public.polls;
drop policy if exists "Eigene Abstimmung löschen" on public.polls;
create policy "Abstimmungen sehen"        on public.polls for select using (is_resident(household_id));
create policy "Abstimmung anlegen"        on public.polls for insert with check (is_resident(household_id) and created_by = my_member_id() and closed_at is null);
create policy "Eigene Abstimmung löschen" on public.polls for delete using (is_resident(household_id) and created_by = my_member_id());

drop policy if exists "Optionen sehen" on public.poll_options;
drop policy if exists "Optionen anlegen" on public.poll_options;
create policy "Optionen sehen"   on public.poll_options for select using (is_resident(household_id));
create policy "Optionen anlegen" on public.poll_options for insert with check (
  is_resident(household_id) and exists (select 1 from polls p where p.id = poll_id and p.created_by = my_member_id() and p.closed_at is null));

drop policy if exists "Stimmen sehen" on public.poll_votes;
drop policy if exists "Abstimmen" on public.poll_votes;
drop policy if exists "Stimme zurücknehmen" on public.poll_votes;
create policy "Stimmen sehen" on public.poll_votes for select using (is_resident(household_id));
create policy "Abstimmen" on public.poll_votes for insert with check (
  is_resident(household_id) and member_id = my_member_id()
  and exists (select 1 from polls p join poll_options o on o.poll_id = p.id where o.id = option_id and p.id = poll_id and p.closed_at is null));
create policy "Stimme zurücknehmen" on public.poll_votes for delete using (
  member_id = my_member_id() and exists (select 1 from polls p where p.id = poll_id and p.closed_at is null));

-- Prüft eine Abstimmung und entscheidet sie, wenn die Regel erfüllt ist.
-- Mehrheit: mehr als die Hälfte aller Mitbewohner. Einstimmig: alle.
-- p_force (Frist vorbei oder Ersteller beendet): Mehrheit → meiste Stimmen (bei Gleichstand keine Einigung); Einstimmig → nur wenn erfüllt.
-- Termine werden dabei genau einmal in den Kalender eingetragen.
create or replace function public.poll_check(p_poll uuid, p_force boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  p polls%rowtype; n int; need int; voted int; win uuid; top int; second int; opt poll_options%rowtype; ev uuid; may_force boolean;
begin
  select * into p from polls where id = p_poll for update;
  if not found or not is_resident(p.household_id) then raise exception 'Nicht erlaubt'; end if;
  if p.closed_at is not null then return 'schon_entschieden'; end if;
  select count(*) into n from members where household_id = p.household_id and role = 'mitbewohner';
  select count(distinct v.member_id) into voted from poll_votes v join members m on m.id = v.member_id and m.role = 'mitbewohner' where v.poll_id = p.id;
  -- Endgültig auswerten: Ersteller*in beendet, Frist vorbei oder alle haben abgestimmt
  may_force := (p_force and p.created_by = my_member_id())
            or (p.deadline is not null and now() >= p.deadline)
            or voted >= n;
  need := case when p.rule = 'einstimmig' then n else n / 2 + 1 end;

  with c as (
    select o.id, o.sort, count(v.member_id) as votes
    from poll_options o left join poll_votes v on v.option_id = o.id
    where o.poll_id = p.id group by o.id, o.sort
  ), r as (select id, votes, row_number() over (order by votes desc, sort) as rn from c)
  select (select id from r where rn = 1), (select votes from r where rn = 1), coalesce((select votes from r where rn = 2), 0)
  into win, top, second;

  -- Ja/Nein: nur "Ja" (erste Option) kann gewinnen
  if p.kind = 'janein' then
    select o.id, count(v.member_id) into win, top from poll_options o left join poll_votes v on v.option_id = o.id
    where o.poll_id = p.id and o.sort = 0 group by o.id;
    second := 0;
  end if;

  if coalesce(top, 0) >= need then
    null; -- Regel erfüllt
  elsif may_force and p.rule = 'mehrheit' and p.kind <> 'janein' and coalesce(top, 0) > 0 and top > second then
    null; -- Frist vorbei: meiste Stimmen gewinnen
  elsif may_force then
    update polls set closed_at = now(), result = null where id = p.id;
    return 'keine_einigung';
  else
    return 'offen';
  end if;

  if p.kind = 'termin' then
    select * into opt from poll_options where id = win;
    insert into events (household_id, title, day, time, created_by) values (p.household_id, p.title, opt.day, opt.time, p.created_by) returning id into ev;
  end if;
  update polls set closed_at = now(), result = win, event_id = ev where id = p.id;
  return 'entschieden';
end $$;
grant execute on function public.poll_check(uuid, boolean) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['polls', 'poll_options', 'poll_votes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ───────────── Kosten einreichen & freigeben ─────────────
alter table public.households add column if not exists finance_chair uuid references public.members on delete set null;
-- Vorsitz zu Beginn: Fabian
update public.households h set finance_chair = (
  select m.id from public.members m where m.household_id = h.id and m.role = 'mitbewohner' and m.display_name ilike 'Fabian%' order by m.sort limit 1)
where h.finance_chair is null;

create table if not exists public.cost_requests (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households on delete cascade,
  created_by    uuid not null default public.my_member_id() references public.members on delete cascade,
  title         text not null check (char_length(title) between 1 and 120),
  amount        numeric(10,2) not null check (amount > 0 and amount < 100000),
  spent_on      date not null default current_date,
  note          text check (note is null or char_length(note) <= 500),
  status        text not null default 'offen' check (status in ('offen', 'freigegeben', 'abgelehnt')),
  decided_by    uuid references public.members on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  expense_id    uuid references public.expenses on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.cost_requests enable row level security;
drop policy if exists "Anträge sehen" on public.cost_requests;
drop policy if exists "Antrag einreichen" on public.cost_requests;
drop policy if exists "Eigenen offenen Antrag zurückziehen" on public.cost_requests;
create policy "Anträge sehen"     on public.cost_requests for select using (is_resident(household_id));
create policy "Antrag einreichen" on public.cost_requests for insert
  with check (is_resident(household_id) and created_by = my_member_id() and status = 'offen' and decided_by is null and expense_id is null);
create policy "Eigenen offenen Antrag zurückziehen" on public.cost_requests for delete
  using (created_by = my_member_id() and status = 'offen');

-- Entscheiden: nur der Vorsitz. Bei Freigabe wird die Ausgabe eingetragen.
create or replace function public.decide_cost_request(p_id uuid, p_approve boolean, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare r cost_requests%rowtype; chair uuid; me uuid := my_member_id(); ex uuid; everyone uuid[];
begin
  select * into r from cost_requests where id = p_id for update;
  if not found then raise exception 'Antrag nicht gefunden'; end if;
  select finance_chair into chair from households where id = r.household_id;
  if me is null or me <> chair then raise exception 'Nur der Vorsitz des Haushaltsausschusses kann freigeben'; end if;
  if r.status <> 'offen' then return r.status; end if;
  if p_approve then
    select array_agg(id order by sort) into everyone from members where household_id = r.household_id and role = 'mitbewohner';
    insert into expenses (household_id, title, amount, paid_by, participants, spent_on, created_by)
    values (r.household_id, r.title, r.amount, r.created_by, everyone, r.spent_on, me) returning id into ex;
  end if;
  update cost_requests set status = case when p_approve then 'freigegeben' else 'abgelehnt' end,
    decided_by = me, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''), expense_id = ex
  where id = r.id;
  return case when p_approve then 'freigegeben' else 'abgelehnt' end;
end $$;
grant execute on function public.decide_cost_request(uuid, boolean, text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cost_requests') then
    alter publication supabase_realtime add table public.cost_requests;
  end if;
end $$;

-- Euer Einladungslink: https://<eure-adresse>/?code=<invite_code>
select name, invite_code from public.households;
