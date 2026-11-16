-- WG-App: Gäste sehen auch die anderen Gäste (z. B. in der Bestenliste) · Emoji-Reaktionen auf Pinnwand-Einträge
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten. Kann mehrfach ausgeführt werden.

-- ── Alle Mitglieder der eigenen WG (für Gäste) – ohne Gast-Zugangscodes und Rechte ──
create or replace function public.fellow_members()
returns jsonb language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(m) - 'guest_code' - 'permissions' order by m.sort), '[]'::jsonb)
  from members m
  where m.household_id = (select household_id from members where user_id = auth.uid() limit 1)
$$;
grant execute on function public.fellow_members() to authenticated;

-- ── Reaktionen auf Pinnwand-Zettel und -Fotos ──
create table if not exists public.note_reactions (
  household_id uuid not null references public.households on delete cascade,
  note_id      uuid not null references public.notes on delete cascade,
  member_id    uuid not null default public.my_member_id() references public.members on delete cascade,
  emoji        text not null check (char_length(emoji) between 1 and 16),
  created_at   timestamptz not null default now(),
  primary key (note_id, member_id, emoji)
);
alter table public.note_reactions enable row level security;
drop policy if exists "Reaktionen sehen" on public.note_reactions;
drop policy if exists "Reagieren" on public.note_reactions;
drop policy if exists "Reaktion zurücknehmen" on public.note_reactions;
create policy "Reaktionen sehen" on public.note_reactions for select using (can_see(household_id, 'pinnwand'));
create policy "Reagieren" on public.note_reactions for insert
  with check (can_see(household_id, 'pinnwand') and member_id = my_member_id());
create policy "Reaktion zurücknehmen" on public.note_reactions for delete using (member_id = my_member_id());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'note_reactions') then
    alter publication supabase_realtime add table public.note_reactions;
  end if;
end $$;
