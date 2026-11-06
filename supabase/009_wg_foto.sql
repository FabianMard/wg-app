-- WG-App: WG-Foto neben dem WG-Namen
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.
-- Das Foto liegt im selben privaten Speicher wie die Pinnwand-Fotos (007).

alter table public.households add column if not exists photo_path text;
