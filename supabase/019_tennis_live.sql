-- WG-App: Live-Tennis – Ergebnisse für die Statistik "wer hat wie oft gegen wen gewonnen"
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.

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
