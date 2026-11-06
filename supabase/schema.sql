-- WG-App: Datenbankschema für Supabase
-- Im Supabase-Dashboard unter "SQL Editor" komplett einfügen und ausführen.

create extension if not exists pgcrypto;

-- ───────────── WG & Mitglieder ─────────────
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  created_at  timestamptz not null default now()
);

create table public.members (
  household_id uuid not null references public.households on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  display_name text not null,
  color        text not null default '#6366f1',
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
-- Vereinfachung: jede Person ist in genau einer WG
create unique index members_one_household on public.members (user_id);

create or replace function public.is_member(h uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from members where household_id = h and user_id = auth.uid())
$$;

create or replace function public.next_color(h uuid)
returns text language sql stable set search_path = public as $$
  select (array['#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316'])
         [((select count(*) from members where household_id = h) % 8) + 1]
$$;

-- WG anlegen (Ersteller wird automatisch Mitglied)
create or replace function public.create_household(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Nicht eingeloggt'; end if;
  insert into households (name) values (p_name) returning id into h;
  insert into members (household_id, user_id, display_name, color)
  values (h, auth.uid(), p_display_name, next_color(h));
  return h;
end $$;

-- Per Einladungscode beitreten
create or replace function public.join_household(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Nicht eingeloggt'; end if;
  select id into h from households where invite_code = upper(trim(p_code));
  if h is null then raise exception 'Einladungscode ungültig'; end if;
  insert into members (household_id, user_id, display_name, color)
  values (h, auth.uid(), p_display_name, next_color(h));
  return h;
end $$;

-- ───────────── Putzplan ─────────────
create table public.chores (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households on delete cascade,
  title         text not null,
  interval_days int  not null default 7 check (interval_days > 0),
  assignee      uuid references auth.users on delete set null,
  next_due      date not null default current_date,
  last_done_at  timestamptz,
  last_done_by  uuid references auth.users on delete set null,
  created_at    timestamptz not null default now()
);

-- ───────────── Einkaufsliste ─────────────
create table public.shopping_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name         text not null,
  done         boolean not null default false,
  added_by     uuid default auth.uid() references auth.users on delete set null,
  created_at   timestamptz not null default now()
);

-- ───────────── Kosten teilen ─────────────
-- Eine Ausgleichszahlung (A zahlt B zurück) wird als Ausgabe gespeichert:
-- paid_by = A, participants = {B}, is_settlement = true
create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households on delete cascade,
  title         text not null,
  amount        numeric(10,2) not null check (amount > 0),
  paid_by       uuid not null references auth.users on delete cascade,
  participants  uuid[] not null check (cardinality(participants) > 0),
  is_settlement boolean not null default false,
  spent_on      date not null default current_date,
  created_by    uuid default auth.uid() references auth.users on delete set null,
  created_at    timestamptz not null default now()
);

-- ───────────── Kalender ─────────────
create table public.events (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  title        text not null,
  day          date not null,
  time         time,           -- null = ganztägig
  note         text,
  created_by   uuid default auth.uid() references auth.users on delete set null,
  created_at   timestamptz not null default now()
);

-- ───────────── To-dos ─────────────
create table public.todos (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  title        text not null,
  done         boolean not null default false,
  assignee     uuid references auth.users on delete set null,
  due_date     date,
  created_by   uuid default auth.uid() references auth.users on delete set null,
  created_at   timestamptz not null default now()
);

-- ───────────── Zugriffsrechte (Row Level Security) ─────────────
alter table public.households     enable row level security;
alter table public.members        enable row level security;
alter table public.chores         enable row level security;
alter table public.shopping_items enable row level security;
alter table public.expenses       enable row level security;
alter table public.events         enable row level security;
alter table public.todos          enable row level security;

create policy "WG sehen"      on public.households for select using (is_member(id));
create policy "WG umbenennen" on public.households for update using (is_member(id));

create policy "Mitbewohner sehen"   on public.members for select using (is_member(household_id));
create policy "Eigenes Profil ändern" on public.members for update using (user_id = auth.uid());
create policy "WG verlassen"        on public.members for delete using (user_id = auth.uid());

create policy "WG-Daten" on public.chores         for all using (is_member(household_id)) with check (is_member(household_id));
create policy "WG-Daten" on public.shopping_items for all using (is_member(household_id)) with check (is_member(household_id));
create policy "WG-Daten" on public.expenses       for all using (is_member(household_id)) with check (is_member(household_id));
create policy "WG-Daten" on public.events         for all using (is_member(household_id)) with check (is_member(household_id));
create policy "WG-Daten" on public.todos          for all using (is_member(household_id)) with check (is_member(household_id));

-- ───────────── Live-Updates ─────────────
alter publication supabase_realtime
  add table public.members, public.chores, public.shopping_items,
            public.expenses, public.events, public.todos;
