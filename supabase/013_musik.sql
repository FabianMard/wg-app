-- WG-App: Musikliste mit Spotify-Playlisten
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.
-- Voraussetzung: 012_gaeste_kalender_watchlist.sql

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
