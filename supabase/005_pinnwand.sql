-- WG-App: Pinnwand mit Post-its auf der Startseite
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.

create table if not exists public.notes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  text         text not null check (char_length(text) between 1 and 300),
  color        text not null default 'gelb' check (color in ('gelb', 'rosa', 'gruen', 'blau', 'orange')),
  author       uuid default public.my_member_id() references public.members on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.notes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notes' and policyname = 'WG-Daten') then
    create policy "WG-Daten" on public.notes for all using (is_member(household_id)) with check (is_member(household_id));
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notes') then
    alter publication supabase_realtime add table public.notes;
  end if;
end $$;
