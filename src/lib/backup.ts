import { supabase } from "./supabase";

/**
 * Datensicherung: alle WG-Daten als eine JSON-Datei (optional mit Fotos).
 * Wiederherstellen: scripts/sicherung-zu-sql.mjs erzeugt daraus SQL für den Supabase SQL Editor.
 */

/** Tabellen in der Reihenfolge, in der sie wieder eingespielt werden müssen (Abhängigkeiten zuerst) */
export const BACKUP_TABLES = [
  "households", "members", "chore_areas", "chore_tasks", "chore_checks", "chore_overrides", "shopping_items", "expenses", "events",
  "todos", "praises", "notes", "messages", "watchlist", "playlists", "game_scores", "tennis_matches", "kite_spots",
  "polls", "poll_options", "poll_votes", "cost_requests", "room_pictures", "game_songs",
] as const;

export type Backup = {
  app: "wg-app"; version: 1; created_at: string; household: { id: string; name: string };
  tables: Record<string, Record<string, unknown>[]>;
  photos?: Record<string, string>; // Pfad → data:image/jpeg;base64,…
  notes: string[];
};

/** Alle Zeilen einer Tabelle (seitenweise, falls es viele sind) */
async function allRows(table: string, householdId: string): Promise<Record<string, unknown>[] | null> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const q = supabase.from(table).select("*").range(from, from + 999);
    const { data, error } = await (table === "households" ? q.eq("id", householdId) : q.eq("household_id", householdId));
    if (error) return out.length ? out : null; // Tabelle gibt es (noch) nicht → überspringen
    out.push(...(data as Record<string, unknown>[]));
    if (!data || data.length < 1000) return out;
  }
}

/** Alle Foto-Pfade, die gerade irgendwo verwendet werden */
export function photoPaths(tables: Backup["tables"]): string[] {
  const p = new Set<string>();
  for (const r of tables.households ?? []) if (r.photo_path) p.add(String(r.photo_path));
  for (const r of tables.members ?? []) if (r.photo_path) p.add(String(r.photo_path));
  for (const r of tables.notes ?? []) if (r.image_path) p.add(String(r.image_path));
  for (const r of tables.room_pictures ?? []) if (r.image_path) p.add(String(r.image_path));
  return [...p];
}

const toDataUrl = (b: Blob) => new Promise<string>((ok, fail) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = fail; fr.readAsDataURL(b); });

export async function createBackup(household: { id: string; name: string }, withPhotos: boolean, onProgress?: (t: string) => void): Promise<Backup> {
  const tables: Backup["tables"] = {};
  for (const t of BACKUP_TABLES) {
    onProgress?.(`Lese ${t} …`);
    const rows = await allRows(t, household.id);
    if (rows) tables[t] = rows;
  }
  const backup: Backup = {
    app: "wg-app", version: 1, created_at: new Date().toISOString(), household: { id: household.id, name: household.name }, tables,
    notes: [
      "Private Chats sind nur enthalten, soweit die Person, die gesichert hat, sie lesen kann.",
      "Push-Einstellungen und Geräte sind nicht enthalten (werden beim Einschalten neu angelegt).",
    ],
  };
  if (withPhotos) {
    const paths = photoPaths(tables);
    backup.photos = {};
    let i = 0;
    for (const p of paths) {
      onProgress?.(`Foto ${++i} von ${paths.length} …`);
      const { data } = await supabase.storage.from("pinnwand").download(p);
      if (data) backup.photos[p] = await toDataUrl(data);
    }
  }
  return backup;
}

/** Datei speichern (Download) */
export function saveJson(obj: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return blob.size;
}

/**
 * Speicher aufräumen: Fotos im Speicher, die nirgends mehr verwendet werden (Pinnwand, Bilderrahmen,
 * Profil-/WG-Foto), werden gelöscht. Nur Dateien, die älter als 1 Stunde sind (falls gerade jemand hochlädt).
 * Nur für Mitbewohner sinnvoll – Gäste sehen nicht alle Daten.
 */
export async function cleanupPhotos(householdId: string): Promise<{ removed: number; bytes: number }> {
  const used = new Set<string>();
  const add = (rows: { [k: string]: unknown }[] | null, col: string) => { for (const r of rows ?? []) if (r[col]) used.add(String(r[col])); };
  const [h, m, n, rp] = await Promise.all([
    supabase.from("households").select("photo_path").eq("id", householdId),
    supabase.from("members").select("photo_path").eq("household_id", householdId),
    supabase.from("notes").select("image_path").eq("household_id", householdId),
    supabase.from("room_pictures").select("image_path").eq("household_id", householdId),
  ]);
  // Sicherheitsnetz: Wenn eine Abfrage scheitert, lieber nichts löschen
  if (h.error || m.error || n.error) return { removed: 0, bytes: 0 };
  add(h.data, "photo_path"); add(m.data, "photo_path"); add(n.data, "image_path"); if (!rp.error) add(rp.data, "image_path");

  const old = Date.now() - 60 * 60 * 1000;
  const orphans: { path: string; size: number }[] = [];
  for (const folder of [householdId, `${householdId}/profil`, `${householdId}/wand`]) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage.from("pinnwand").list(folder, { limit: 1000, offset });
      if (error || !data) break;
      for (const f of data) {
        if (!f.id) continue; // Unterordner
        const path = `${folder}/${f.name}`;
        const created = f.created_at ? new Date(f.created_at).getTime() : 0;
        if (!used.has(path) && created < old) orphans.push({ path, size: Number((f.metadata as { size?: number } | null)?.size ?? 0) });
      }
      if (data.length < 1000) break;
    }
  }
  // Musik fürs Spiel (eigener Speicher „musik“)
  const songs = await supabase.from("game_songs").select("path").eq("household_id", householdId);
  const musicOrphans: typeof orphans = [];
  if (!songs.error) {
    const usedSongs = new Set((songs.data ?? []).map((r) => String(r.path)));
    const { data } = await supabase.storage.from("musik").list(householdId, { limit: 1000 });
    for (const f of data ?? []) {
      const path = `${householdId}/${f.name}`;
      const created = f.created_at ? new Date(f.created_at).getTime() : 0;
      if (f.id && !usedSongs.has(path) && created < old) musicOrphans.push({ path, size: Number((f.metadata as { size?: number } | null)?.size ?? 0) });
    }
  }
  let removed = 0, bytes = 0;
  for (const [bucket, list] of [["pinnwand", orphans], ["musik", musicOrphans]] as const) for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const { data, error } = await supabase.storage.from(bucket).remove(chunk.map((o) => o.path));
    if (error || !data) continue;
    // Supabase meldet die gelöschten Dateien zurück
    const done = new Set(data.map((d) => d.name));
    for (const o of chunk) if (done.has(o.path) || done.has(o.path.split("/").pop()!)) { removed++; bytes += o.size; }
  }
  return { removed, bytes };
}
