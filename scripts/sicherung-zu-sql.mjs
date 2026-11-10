#!/usr/bin/env node
// WG-App: Datensicherung (JSON aus der App) → SQL zum Einspielen im Supabase SQL Editor
//
//   node scripts/sicherung-zu-sql.mjs wg-sicherung-2026-11-10.json
//
// Erzeugt neben der Sicherung:
//   wiederherstellen.sql  → im SQL Editor ausführen (vorher supabase/schema.sql bzw. alle Update-Skripte)
//   fotos/                → enthaltene Fotos; im Supabase-Dashboard unter Storage → Bucket "pinnwand"
//                           mit genau dieser Ordnerstruktur hochladen
// Vorhandene Einträge werden nicht überschrieben (ON CONFLICT DO NOTHING).
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2];
if (!file) { console.error("Aufruf: node scripts/sicherung-zu-sql.mjs <sicherung.json>"); process.exit(1); }
const backup = JSON.parse(fs.readFileSync(file, "utf8"));
if (backup.app !== "wg-app") { console.error("Das ist keine Sicherung der WG-App."); process.exit(1); }

const ORDER = ["households", "members", "chore_areas", "chore_tasks", "chore_checks", "shopping_items", "expenses", "events",
  "todos", "praises", "notes", "messages", "watchlist", "playlists", "game_scores", "tennis_matches", "kite_spots",
  "polls", "poll_options", "poll_votes", "cost_requests", "room_pictures", "game_songs"];
// Dollar-Quoting mit eigenem Tag, damit Texte mit $ oder ' nichts kaputt machen
const lit = (v) => { const tag = "$wg" + Math.random().toString(36).slice(2, 8) + "$"; return `${tag}${JSON.stringify(v)}${tag}::jsonb`; };
// Tabelle fehlt im Zielprojekt (Update-Skript nicht ausgeführt)? Dann überspringen statt abbrechen.
const guarded = (t, sql) => `do $do$ begin if to_regclass('public.${t}') is null then raise notice 'Tabelle ${t} fehlt – übersprungen'; else ${sql} end if; end $do$;`;
const ins = (t, json) => guarded(t, `execute 'insert into public.${t} select * from jsonb_populate_recordset(null::public.${t}, $1) on conflict do nothing' using ${json};`);

const out = [
  `-- WG-App: Wiederherstellung aus ${path.basename(file)} (gesichert ${backup.created_at}, WG „${backup.household.name}“)`,
  "-- Im Supabase SQL Editor ausführen. Vorher müssen alle Tabellen existieren (supabase/schema.sql oder Update-Skripte).",
  "begin;",
];
const tables = backup.tables ?? {};
for (const t of ORDER) {
  let rows = tables[t];
  if (!rows?.length) continue;
  if (t === "households") {
    // Vorsitz verweist auf Mitbewohner → erst ohne, am Ende nachtragen
    out.push(ins("households", lit(rows.map((r) => ({ ...r, finance_chair: null })))));
    continue;
  }
  if (t === "members") {
    // Anmeldungen (auth.users) gibt es in einem neuen Projekt nicht → dann ohne Verknüpfung einspielen
    out.push(`create temp table _m on commit drop as select * from jsonb_populate_recordset(null::public.members, ${lit(rows)});`);
    out.push("update _m set user_id = null where user_id is not null and not exists (select 1 from auth.users u where u.id = _m.user_id);");
    out.push("insert into public.members select * from _m on conflict do nothing;");
    continue;
  }
  out.push(ins(t, lit(rows)));
}
for (const h of tables.households ?? []) {
  if (h.finance_chair) out.push(guarded("households", `execute 'update public.households set finance_chair = $1 where id = $2 and finance_chair is null' using '${h.finance_chair}'::uuid, '${h.id}'::uuid;`));
}
out.push("commit;", "", "-- Kontrolle: Anzahl je Tabelle",
  "select relname as tabelle, n_live_tup as eintraege from pg_stat_user_tables where schemaname = 'public' order by relname;");

const dir = path.dirname(path.resolve(file));
fs.writeFileSync(path.join(dir, "wiederherstellen.sql"), out.join("\n") + "\n");
let photos = 0;
for (const [p, dataUrl] of Object.entries(backup.photos ?? {})) {
  const m = /^data:[^;]+;base64,(.*)$/.exec(dataUrl);
  if (!m) continue;
  const target = path.join(dir, "fotos", p);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(m[1], "base64"));
  photos++;
}
const count = ORDER.reduce((a, t) => a + (tables[t]?.length ?? 0), 0);
console.log(`✓ ${count} Einträge → ${path.join(dir, "wiederherstellen.sql")}`);
if (photos) console.log(`✓ ${photos} Fotos → ${path.join(dir, "fotos")}  (in Storage → Bucket "pinnwand" hochladen, Ordner beibehalten)`);
if ((tables.members ?? []).length) console.log("Hinweis: Hat das Supabase-Projekt die alten Anmeldungen nicht mehr, treten alle über den Einladungslink neu bei.");
