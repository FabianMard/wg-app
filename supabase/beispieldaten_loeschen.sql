-- WG-App: Beispieldaten löschen und Putzplan am 16.11.2026 starten
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. ACHTUNG: Gelöschtes lässt sich nicht wiederherstellen.
--
-- GELÖSCHT: Einkaufsliste · Kosten & Kontostände · Kalender-Einträge · To-dos · Watchlist · Bienchen ·
--           Putz-Häkchen (der Putzplan beginnt neu) → damit ist auch der Monatsbericht leer
-- BLEIBT:   Pinnwand · Mitbewohner & Gäste · Spielstände & Tennis-Statistik · Putzbereiche & Aufgaben ·
--           Chat · Musik · Kite-Spots · Push-Einstellungen · Favoriten der Einkaufsliste
-- Der Putzdienst im Kalender wird aus dem Putzplan berechnet und erscheint ab dem 16.11. automatisch.

begin;

delete from public.shopping_items;   -- Einkaufsliste
delete from public.expenses;         -- Kosten, Ausgleichszahlungen → Kontostände wieder 0
delete from public.events;           -- Kalender (Termine, Geburtstage, Urlaube)
delete from public.todos;            -- To-dos
delete from public.watchlist;        -- Watchlist (Filme & Serien)
delete from public.praises;          -- Fleißige Bienchen
delete from public.chore_checks;     -- abgehakte Putzaufgaben

update public.households set cleaning_start = date '2026-11-16';   -- Montag: erste Putzwoche 16.–22.11.

commit;

-- Kontrolle: alles 0, Putzplan-Start 2026-11-16
select 'Einkaufsliste' as was, count(*) from public.shopping_items
union all select 'Kosten', count(*) from public.expenses
union all select 'Kalender', count(*) from public.events
union all select 'To-dos', count(*) from public.todos
union all select 'Watchlist', count(*) from public.watchlist
union all select 'Bienchen', count(*) from public.praises
union all select 'Putz-Häkchen', count(*) from public.chore_checks
union all select 'Pinnwand (bleibt)', count(*) from public.notes
union all select 'Spielstände (bleiben)', count(*) from public.game_scores
union all select 'Putzplan-Start: ' || cleaning_start::text, 0 from public.households;
