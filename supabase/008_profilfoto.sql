-- WG-App: Profilfotos
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.
-- Voraussetzung: 007_pinnwand_fotos.sql (die Fotos liegen im selben privaten Speicher).

alter table public.members add column if not exists photo_path text;
