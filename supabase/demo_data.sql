-- ════════════════════════════════════════════════════════════════════
-- WG-App: Beispieldaten zum Ausprobieren
-- Im Supabase-Dashboard unter "SQL Editor" ausführen (nach schema.sql).
--
-- • Ersetzt Einkäufe, Kosten, Termine, To-dos, Häkchen und Bienchen durch Beispieldaten.
-- • Verschiebt den Start des Putzplans um 2 Wochen nach hinten, damit es schon
--   eine "letzte Runde" gibt.
-- • Für den echten Start danach einfach schema.sql erneut ausführen
--   (setzt alles zurück; Mitbewohner müssen dann nochmal ihren Namen antippen).
-- ════════════════════════════════════════════════════════════════════

do $$
declare
  h uuid; v uuid; s uuid; f uuid;
  kueche uuid; bad uuid; sonst uuid;
  t_rauch uuid; t_keller uuid; t_tonne uuid;
  start date := date_trunc('week', now())::date - 14;   -- Montag vor 2 Wochen
  d date := current_date;
begin
  select id into h from households order by created_at limit 1;
  if h is null then raise exception 'Bitte zuerst schema.sql ausführen'; end if;

  select id into v from members where household_id = h and display_name = 'Verena';
  select id into s from members where household_id = h and display_name = 'Stefan';
  select id into f from members where household_id = h and display_name = 'Fabian';
  select id into kueche from chore_areas where household_id = h and name = 'Küche';
  select id into bad    from chore_areas where household_id = h and name = 'Bad';
  select id into sonst  from chore_areas where household_id = h and name = 'Sonstiges';

  -- Aufräumen
  delete from praises        where household_id = h;
  delete from chore_checks   where household_id = h;
  delete from shopping_items where household_id = h;
  delete from expenses       where household_id = h;
  delete from events         where household_id = h;
  delete from todos          where household_id = h;

  update households set cleaning_start = start where id = h;

  -- ───── Putzplan ─────
  -- Runde 0 (letzte): Küche = Verena, Bad = Stefan, Sonstiges = Fabian → alles erledigt
  insert into chore_checks (household_id, area_id, task_id, period, done_by, done_at)
  select h, t.area_id, t.id, 0,
         case t.area_id when kueche then v when bad then s else f end,
         start + 3 + (t.sort % 3) + time '18:00'
  from chore_tasks t where t.household_id = h;

  -- Runde 1 (aktuell): Küche = Stefan, Bad = Fabian, Sonstiges = Verena
  insert into chore_checks (household_id, area_id, task_id, period, done_by, done_at)
  select h, t.area_id, t.id, 1,
         case when t.area_id = sonst and t.sort = 4 then s     -- Stefan hilft bei Altglas
              when t.area_id = kueche then s
              when t.area_id = bad then f
              else v end,
         now() - (interval '1 hour' * (10 + t.sort * 5))
  from chore_tasks t
  where t.household_id = h
    and (t.area_id = bad                                   -- Bad komplett erledigt
         or (t.area_id = kueche and t.sort in (1, 2))      -- Küche 2/6
         or (t.area_id = sonst and t.sort in (1, 2, 4)));  -- Sonstiges 3/5

  -- ───── Fleißige Bienchen ─────
  insert into praises (household_id, from_member, to_member, kind, ref, created_at) values
    (h, s, v, 'putzen', kueche || ':0', now() - interval '9 days'),
    (h, f, v, 'putzen', kueche || ':0', now() - interval '9 days'),
    (h, v, s, 'putzen', bad    || ':0', now() - interval '8 days'),
    (h, f, s, 'putzen', bad    || ':0', now() - interval '8 days'),
    (h, v, f, 'putzen', sonst  || ':0', now() - interval '7 days'),
    (h, v, f, 'putzen', bad    || ':1', now() - interval '3 hours'),
    (h, s, f, 'putzen', bad    || ':1', now() - interval '1 hour');

  -- ───── Einkaufsliste ─────
  insert into shopping_items (household_id, name, store, store_note, done, archived, added_by, created_at) values
    (h, 'Hafermilch',          'rewe',      null,       false, false, v, now() - interval '2 days'),
    (h, 'Bananen',             'rewe',      null,       false, false, v, now() - interval '2 days'),
    (h, 'Klopapier',           'hit',       null,       false, false, s, now() - interval '1 day'),
    (h, 'Spülmaschinentabs',   'hit',       null,       false, false, f, now() - interval '1 day'),
    (h, 'Brötchen (Sonntag)',  'konsum',    null,       false, false, s, now() - interval '5 hours'),
    (h, 'Glühbirne E27',       'baumarkt',  null,       false, false, f, now() - interval '3 days'),
    (h, 'Silikon fürs Bad',    'baumarkt',  null,       false, false, f, now() - interval '3 days'),
    (h, 'Zahnpasta',           'sonstiges', 'dm',       false, false, v, now() - interval '4 hours'),
    (h, 'Kaffee',              'egal',      null,       false, false, s, now() - interval '30 minutes'),
    (h, 'Eier',                'egal',      null,       true,  false, f, now() - interval '1 day'),
    (h, 'Tomaten',             'rewe',      null,       true,  false, v, now() - interval '1 day');
  -- Verlauf für "Oft gebraucht"
  insert into shopping_items (household_id, name, store, done, archived, added_by, created_at)
  select h, n, st, true, true, (array[v, s, f])[1 + (i % 3)], now() - (interval '1 day' * (7 + i))
  from unnest(
    array['Hafermilch','Hafermilch','Hafermilch','Bananen','Bananen','Tomaten','Tomaten','Tomaten',
          'Toastbrot','Toastbrot','Mozzarella','Mozzarella','Spülmaschinentabs','Klopapier','Klopapier',
          'Nudeln','Nudeln','Paprika','Paprika','Haferflocken','Haferflocken'],
    array['rewe','rewe','konsum','rewe','hit','rewe','hit','konsum',
          'konsum','konsum','rewe','rewe','hit','hit','hit',
          'egal','egal','rewe','rewe','egal','egal']
  ) with ordinality as x(n, st, i);

  -- ───── Kosten ─────
  insert into expenses (household_id, title, amount, paid_by, participants, is_settlement, spent_on, created_by) values
    (h, 'Wocheneinkauf Rewe',          54.87, v, array[v, s, f], false, d - 12, v),
    (h, 'Internet November',           39.99, s, array[v, s, f], false, d - 6,  s),
    (h, 'Klopapier & Putzmittel (HIT)', 18.45, f, array[v, s, f], false, d - 5,  f),
    (h, 'Pizza-Abend',                 27.50, s, array[s, f],    false, d - 4,  s),
    (h, 'Duschvorhang (Baumarkt)',     14.99, f, array[v, s, f], false, d - 3,  f),
    (h, 'Konsum: Frühstück',           23.10, v, array[v, s, f], false, d - 1,  v),
    (h, 'Ausgleich',                   15.00, f, array[v],       true,  d - 2,  f);

  -- ───── Kalender ─────
  insert into events (household_id, title, day, time, created_by) values
    (h, 'WG-Abend: Raclette 🧀',            d + 1,  '19:30', v),
    (h, 'Vermieter kommt (Heizung ablesen)', d + 4,  '10:00', s),
    (h, 'Sperrmüll rausstellen',             d + 6,  null,    f),
    (h, 'Verenas Geburtstag 🎂',             d + 12, null,    s),
    (h, 'Stefan ist verreist',               d + 15, null,    s),
    (h, 'WG-Besprechung',                    d - 3,  '20:00', f);

  -- ───── To-dos ─────
  insert into todos (household_id, title, done, done_by, done_at, assignee, due_date, created_by, created_at) values
    (h, 'Handwerker wegen tropfendem Wasserhahn anrufen', false, null, null, f,    d + 2,  v, now() - interval '3 days'),
    (h, 'Nebenkostenabrechnung prüfen',                    false, null, null, s,    d + 10, f, now() - interval '5 days'),
    (h, 'Pfandflaschen wegbringen',                        false, null, null, v,    d - 1,  s, now() - interval '6 days'),
    (h, 'WLAN-Passwort ändern',                            false, null, null, null, null,   f, now() - interval '1 day'),
    (h, 'Neuen Duschvorhang aufhängen',                    false, null, null, null, d + 3,  v, now() - interval '2 days');
  insert into todos (household_id, title, done, done_by, done_at, created_by, created_at) values
    (h, 'Rauchmelder testen',        true, s, now() - interval '2 days',  v, now() - interval '9 days') returning id into t_rauch;
  insert into todos (household_id, title, done, done_by, done_at, created_by, created_at) values
    (h, 'Fahrradkeller aufräumen',   true, v, now() - interval '4 days',  f, now() - interval '12 days') returning id into t_keller;
  insert into todos (household_id, title, done, done_by, done_at, created_by, created_at) values
    (h, 'Mülltonnen rausstellen',    true, f, now() - interval '20 hours', s, now() - interval '2 days') returning id into t_tonne;

  insert into praises (household_id, from_member, to_member, kind, ref) values
    (h, v, s, 'todo', t_rauch::text),
    (h, f, s, 'todo', t_rauch::text),
    (h, f, v, 'todo', t_keller::text),
    (h, s, f, 'todo', t_tonne::text);
end $$;

select 'Beispieldaten eingespielt ✓' as status, invite_code from public.households;
