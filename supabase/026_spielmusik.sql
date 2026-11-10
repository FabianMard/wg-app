-- WG-App: Eigene Musik fürs WG-Spiel – hochgeladene Songs sind für alle in der WG (auch Gäste) abspielbar
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.

create table if not exists public.game_songs (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  path         text not null,                 -- Datei im Speicher "musik": <wg>/<zufällig>.<endung>
  size         integer,
  start_sec    real not null default 0 check (start_sec >= 0),
  end_sec      real check (end_sec is null or end_sec > start_sec),
  added_by     uuid default public.my_member_id() references public.members on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists game_songs_household on public.game_songs (household_id, created_at);
alter table public.game_songs enable row level security;
drop policy if exists "Songs sehen" on public.game_songs;
drop policy if exists "Songs ändern" on public.game_songs;
create policy "Songs sehen"  on public.game_songs for select using (is_member(household_id));
create policy "Songs ändern" on public.game_songs for all using (is_member(household_id)) with check (is_member(household_id));

-- Höchstens 3 Songs pro WG
create or replace function public.game_songs_limit() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.game_songs where household_id = new.household_id) >= 3 then
    raise exception 'Es gibt schon 3 Songs – lösche zuerst einen.';
  end if;
  return new;
end $$;
drop trigger if exists game_songs_limit on public.game_songs;
create trigger game_songs_limit before insert on public.game_songs for each row execute function public.game_songs_limit();

-- Eigener privater Speicher für Musik (max. 8 MB pro Song)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('musik', 'musik', false, 8388608, array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac',
  'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/webm', 'audio/flac', 'audio/x-flac'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Musik lesen" on storage.objects;
drop policy if exists "Musik hochladen" on storage.objects;
drop policy if exists "Musik löschen" on storage.objects;
create policy "Musik lesen" on storage.objects for select to authenticated
  using (bucket_id = 'musik' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "Musik hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'musik' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "Musik löschen" on storage.objects for delete to authenticated
  using (bucket_id = 'musik' and public.is_member(((storage.foldername(name))[1])::uuid));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_songs') then
    alter publication supabase_realtime add table public.game_songs;
  end if;
end $$;
