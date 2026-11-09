-- WG-App: Kite-Spots selbst festlegen + Kitesurf-Minispiel in der Bestenliste
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.
-- Voraussetzung: 014_bestenliste.sql

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

-- Bestenliste: neues Spiel "kite"
alter table public.game_scores drop constraint if exists game_scores_game_check;
alter table public.game_scores add constraint game_scores_game_check check (game in ('spuelmaschine', 'kite'));
