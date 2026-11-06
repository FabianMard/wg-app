-- WG-App: bearbeitbare Liste "Oft gebraucht" in der Einkaufsliste
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.

alter table public.households add column if not exists shopping_favorites text[];

-- Änderungen an der WG (z. B. Favoriten) live an alle verteilen
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'households') then
    alter publication supabase_realtime add table public.households;
  end if;
end $$;
