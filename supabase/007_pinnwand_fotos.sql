-- WG-App: Fotos an der Pinnwand
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.
-- Voraussetzung: 005_pinnwand.sql wurde ausgeführt.

-- Zettel dürfen jetzt auch nur ein Foto (ohne Text) sein
alter table public.notes add column if not exists image_path text;
alter table public.notes alter column text set default '';
alter table public.notes drop constraint if exists notes_text_check;
alter table public.notes drop constraint if exists notes_content_check;
alter table public.notes add constraint notes_text_check check (char_length(text) <= 300);
alter table public.notes add constraint notes_content_check check (char_length(text) > 0 or image_path is not null);

-- Privater Speicher für die Fotos (max. 5 MB pro Bild)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pinnwand', 'pinnwand', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Nur Mitglieder der WG dürfen die Fotos ihrer WG sehen, hochladen und löschen.
-- Dateien liegen unter <household_id>/<zufälliger-name>.jpg
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Pinnwand-Fotos lesen') then
    create policy "Pinnwand-Fotos lesen" on storage.objects for select to authenticated
      using (bucket_id = 'pinnwand' and public.is_member(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Pinnwand-Fotos hochladen') then
    create policy "Pinnwand-Fotos hochladen" on storage.objects for insert to authenticated
      with check (bucket_id = 'pinnwand' and public.is_member(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Pinnwand-Fotos löschen') then
    create policy "Pinnwand-Fotos löschen" on storage.objects for delete to authenticated
      using (bucket_id = 'pinnwand' and public.is_member(((storage.foldername(name))[1])::uuid));
  end if;
end $$;
