-- WG-App: Avatare fürs WG-Spiel
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.

alter table public.members add column if not exists avatar jsonb;
