-- WG-App: Bild an der Wand im eigenen Zimmer (eins von Verenas Kunstwerken)
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.

alter table public.members add column if not exists wall_art jsonb;   -- { title, file, url, kind, year }
