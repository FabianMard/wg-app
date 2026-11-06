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
drop table if exists public.messages, public.notes, public.praises, public.chore_checks, public.chore_tasks, public.chore_areas,
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
  to_member    uuid not null references public.members on delete cascade,
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

-- Euer Einladungslink: https://<eure-adresse>/?code=<invite_code>
select name, invite_code from public.households;
