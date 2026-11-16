-- WG-App: Fahrradspiele im Wohnzimmer – Geister-Rennen (Bestfahrt jeder Person wird als „Geist“ gespeichert)
-- Kurier und Lastenrad nutzen die normale Bestenliste (game_scores) und brauchen nichts Neues.
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten. Kann mehrfach ausgeführt werden.

create table if not exists public.bike_ghosts (
  member_id    uuid primary key references public.members on delete cascade,
  household_id uuid not null references public.households on delete cascade,
  time_ms      integer not null check (time_ms between 5000 and 600000),
  trace        jsonb not null,            -- zurückgelegte Strecke in Dezimetern, alle 100 ms
  updated_at   timestamptz not null default now()
);
alter table public.bike_ghosts enable row level security;
drop policy if exists "Geister sehen" on public.bike_ghosts;
create policy "Geister sehen" on public.bike_ghosts for select using (is_member(household_id));

-- Neue Fahrt speichern – nur wenn sie schneller ist als die bisherige eigene Bestzeit
create or replace function public.submit_ghost(p_time integer, p_trace jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare me members%rowtype;
begin
  select * into me from members where user_id = auth.uid();
  if me.id is null then raise exception 'Nicht angemeldet'; end if;
  if jsonb_typeof(p_trace) <> 'array' or jsonb_array_length(p_trace) > 6000 then raise exception 'Ungültige Fahrt'; end if;
  insert into bike_ghosts (member_id, household_id, time_ms, trace) values (me.id, me.household_id, p_time, p_trace)
  on conflict (member_id) do update set time_ms = excluded.time_ms, trace = excluded.trace, updated_at = now()
    where bike_ghosts.time_ms > excluded.time_ms;
  return found;
end $$;
grant execute on function public.submit_ghost(integer, jsonb) to authenticated;
