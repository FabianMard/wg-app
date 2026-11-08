-- WG-App: Bestenliste für die Minispiele (z. B. Spülmaschine) – alle sehen die Rekorde der anderen
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.

create table if not exists public.game_scores (
  household_id uuid not null references public.households on delete cascade,
  member_id    uuid not null references public.members on delete cascade,
  game         text not null check (game in ('spuelmaschine')),
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
