"use client";

import { useEffect, useState } from "react";
import { useWG } from "@/lib/wg";
import { cleanupPhotos, createBackup, saveJson } from "@/lib/backup";
import { formatDate, todayISO } from "@/lib/dates";
import { btnCls, Card } from "@/components/ui";

const LAST_KEY = "wg-letzte-sicherung";
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b > 10 * 1024 * 1024 ? 0 : 1).replace(".", ",")} MB`;

/** WG-Einstellungen: Datensicherung herunterladen + Fotospeicher aufräumen */
export function BackupCard() {
  const { household } = useWG();
  const [withPhotos, setWithPhotos] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => { try { setLast(localStorage.getItem(LAST_KEY)); } catch { /* egal */ } }, []);
  const daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000) : null;

  async function backup() {
    setMsg(null);
    try {
      const b = await createBackup(household, withPhotos, setBusy);
      const size = saveJson(b, `wg-sicherung-${todayISO()}.json`);
      const n = Object.values(b.tables).reduce((a, r) => a + r.length, 0);
      const now = new Date().toISOString();
      try { localStorage.setItem(LAST_KEY, now); } catch { /* egal */ }
      setLast(now);
      setMsg(`✓ Gesichert: ${n} Einträge${b.photos ? `, ${Object.keys(b.photos).length} Fotos` : ""} (${mb(size)}). Datei gut aufheben, z. B. in einer Cloud oder auf dem Laptop.`);
    } catch (e) { setMsg(`Sicherung fehlgeschlagen: ${(e as Error).message}`); }
    setBusy(null);
  }
  async function cleanup() {
    setMsg(null); setBusy("Räume auf …");
    const r = await cleanupPhotos(household.id);
    setBusy(null);
    setMsg(r.removed ? `🧹 ${r.removed} nicht mehr verwendete ${r.removed === 1 ? "Foto" : "Fotos"} gelöscht (${mb(r.bytes)} frei).` : "🧹 Alles sauber – keine verwaisten Fotos gefunden.");
  }

  return (
    <Card className="space-y-3">
      <p className="text-sm text-muted">
        Lädt alle WG-Daten als Datei herunter: Putzplan, Einkauf, Kosten, Kalender, To-dos, Pinnwand, Chat, Spielstände … Damit lässt sich die App im Notfall wiederherstellen.
      </p>
      {daysSince === null
        ? <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">Von diesem Gerät wurde noch nie gesichert.</p>
        : <p className={`text-sm ${daysSince > 30 ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted"}`}>
            Letzte Sicherung von diesem Gerät: {formatDate(last!.slice(0, 10))}{daysSince > 30 && " – Zeit für eine neue!"}
          </p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
        Fotos mitsichern (Pinnwand, Bilderrahmen, Profilfotos) – Datei wird größer
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button onClick={backup} disabled={!!busy} className={btnCls}>{busy && busy !== "Räume auf …" ? busy : "💾 Datensicherung herunterladen"}</button>
        <button onClick={cleanup} disabled={!!busy} className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold">{busy === "Räume auf …" ? busy : "🧹 Fotospeicher aufräumen"}</button>
      </div>
      {msg && <p className="text-sm">{msg}</p>}
      <p className="text-xs text-muted">Aufräumen löscht nur Fotos, die nirgends mehr angezeigt werden. Das passiert außerdem automatisch einmal pro Woche.</p>
    </Card>
  );
}
