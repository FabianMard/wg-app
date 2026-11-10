-- WG-App: Bilder in den Gemeinschaftsräumen (Wohnzimmer 3, Küche 2, Bad 1) – alle (auch Gäste) können sie austauschen
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.
-- Ein Bild ist entweder ein Kunstwerk von Verenas Website oder ein eigenes hochgeladenes Foto.

create table if not exists public.room_pictures (
  household_id uuid not null references public.households on delete cascade,
  slot         text not null check (slot in ('wohnzimmer-1', 'wohnzimmer-2', 'wohnzimmer-3', 'kueche-1', 'kueche-2', 'bad-1')),
  kind         text not null check (kind in ('kunst', 'foto')),
  title        text check (title is null or char_length(title) <= 120),
  file         text,          -- Kunstwerk: Original-URL auf Verenas Website
  url          text,          -- Kunstwerk: Link zum Beitrag
  image_path   text,          -- Foto: Pfad im Speicher (Ordner <wg>/wand/)
  set_by       uuid default public.my_member_id() references public.members on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (household_id, slot),
  check ((kind = 'kunst' and file like 'https://verenapluempe.wordpress.com/%') or (kind = 'foto' and image_path like '%/wand/%'))
);
alter table public.room_pictures enable row level security;
drop policy if exists "Raumbilder sehen" on public.room_pictures;
drop policy if exists "Raumbilder ändern" on public.room_pictures;
create policy "Raumbilder sehen"  on public.room_pictures for select using (is_member(household_id));
create policy "Raumbilder ändern" on public.room_pictures for all using (is_member(household_id)) with check (is_member(household_id));

-- Fotos für die Wände: alle in der WG (auch Gäste) dürfen sie sehen, hochladen und löschen – nur im Ordner <wg>/wand/
drop policy if exists "Wandfotos lesen" on storage.objects;
drop policy if exists "Wandfotos hochladen" on storage.objects;
drop policy if exists "Wandfotos löschen" on storage.objects;
create policy "Wandfotos lesen" on storage.objects for select to authenticated
  using (bucket_id = 'pinnwand' and (storage.foldername(name))[2] = 'wand' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "Wandfotos hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'pinnwand' and (storage.foldername(name))[2] = 'wand' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "Wandfotos löschen" on storage.objects for delete to authenticated
  using (bucket_id = 'pinnwand' and (storage.foldername(name))[2] = 'wand' and public.is_member(((storage.foldername(name))[1])::uuid));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_pictures') then
    alter publication supabase_realtime add table public.room_pictures;
  end if;
end $$;
