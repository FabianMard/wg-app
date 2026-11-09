-- WG-App: Bestenliste für weitere Minispiele (z. B. Tennis) – danach braucht kein neues Spiel mehr ein Datenbank-Update
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.
-- Voraussetzung: 014_bestenliste.sql

alter table public.game_scores drop constraint if exists game_scores_game_check;
alter table public.game_scores add constraint game_scores_game_check check (game ~ '^[a-z]{2,20}$');
