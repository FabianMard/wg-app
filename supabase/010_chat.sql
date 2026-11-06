-- WG-App: gespeicherter Chat zwischen zwei Mitbewohnern (im WG-Spiel)
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.

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
