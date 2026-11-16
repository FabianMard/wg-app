-- WG-App: Radrennen Geißlerstraße → Cossi (ersetzt die alten Fahrradspiele)
-- Enthält alles aus 029 (falls das noch nicht lief). Bestehende Daten bleiben erhalten. Kann mehrfach ausgeführt werden.

create table if not exists public.bike_ghosts (
  member_id    uuid primary key references public.members on delete cascade,
  household_id uuid not null references public.households on delete cascade,
  time_ms      integer not null check (time_ms between 5000 and 600000),
  trace        jsonb not null,
  updated_at   timestamptz not null default now()
);
-- Welche Strecke? Alte Geister (Strecke zur Uni) werden bei der ersten Cossi-Fahrt ersetzt
alter table public.bike_ghosts add column if not exists track text not null default 'uni';
alter table public.bike_ghosts enable row level security;
drop policy if exists "Geister sehen" on public.bike_ghosts;
create policy "Geister sehen" on public.bike_ghosts for select using (is_member(household_id));

drop function if exists public.submit_ghost(integer, jsonb);
create or replace function public.submit_ghost(p_time integer, p_trace jsonb, p_track text default 'cossi')
returns boolean language plpgsql security definer set search_path = public as $$
declare me members%rowtype;
begin
  select * into me from members where user_id = auth.uid();
  if me.id is null then raise exception 'Nicht angemeldet'; end if;
  if jsonb_typeof(p_trace) <> 'array' or jsonb_array_length(p_trace) > 8000 then raise exception 'Ungültige Fahrt'; end if;
  insert into bike_ghosts (member_id, household_id, time_ms, trace, track) values (me.id, me.household_id, p_time, p_trace, p_track)
  on conflict (member_id) do update set time_ms = excluded.time_ms, trace = excluded.trace, track = excluded.track, updated_at = now()
    where bike_ghosts.track <> excluded.track or bike_ghosts.time_ms > excluded.time_ms;
  return found;
end $$;
grant execute on function public.submit_ghost(integer, jsonb, text) to authenticated;

-- Eigenes Fahrrad (Art + Farbe) – jede Person wählt selbst, auch Gäste
alter table public.members add column if not exists bike jsonb;   -- { "type": "randonneur" | "gravel" | "lastenrad" | "klapprad", "color": "#…" }

-- Rekorde der entfernten Spiele (Kurier, Lastenrad) aufräumen
delete from public.game_scores where game in ('kurier', 'lastenrad');
