"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useWG } from "@/lib/wg";
import type { Member, Reading } from "@/lib/types";
import { inputCls } from "@/components/ui";

/** Bücherregal: zeigt, was jemand gerade liest. Nur die Person selbst kann es ändern. */
export function BookShelf({ owner }: { owner: Member }) {
  const { myId, refresh } = useWG();
  const mine = owner.id === myId;
  const r = owner.reading;
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Reading>(() => r ?? { title: "", author: "", progress: 0, url: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: Reading | null) {
    setErr(null);
    setBusy(true);
    const { error } = await supabase.from("members").update({ reading: next }).eq("id", owner.id);
    setBusy(false);
    if (error) {
      setErr(error.message.includes("reading") ? "Datenbank-Update fehlt: Bitte supabase/011_buecher.sql im SQL Editor ausführen." : error.message);
      return;
    }
    await refresh();
    setEdit(false);
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    let url = form.url?.trim() ?? "";
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
    save({ title: form.title.trim(), author: form.author?.trim() || undefined, progress: Math.max(0, Math.min(100, Number(form.progress) || 0)), url: url || undefined, updated_at: new Date().toISOString() });
  };

  if (edit) {
    return (
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm font-medium">Titel
          <input className={`${inputCls} mt-1`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={120} />
        </label>
        <label className="block text-sm font-medium">Autor*in
          <input className={`${inputCls} mt-1`} value={form.author ?? ""} onChange={(e) => setForm({ ...form, author: e.target.value })} maxLength={80} />
        </label>
        <label className="block text-sm font-medium">Fortschritt: {form.progress ?? 0} %
          <input type="range" min={0} max={100} step={5} value={form.progress ?? 0} onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })} className="mt-2 w-full accent-[var(--accent)]" />
        </label>
        <label className="block text-sm font-medium">Link zu Reado (optional)
          <input className={`${inputCls} mt-1`} value={form.url ?? ""} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="z. B. Link zum Buch oder Profil" inputMode="url" />
        </label>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-2">
          <button disabled={busy} className="flex-1 rounded-xl bg-accent py-2.5 font-medium text-white disabled:opacity-50">Ins Regal stellen 📚</button>
          <button type="button" onClick={() => setEdit(false)} className="rounded-xl border border-line px-4">Abbrechen</button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {r ? (
        <div className="flex gap-4 rounded-2xl border border-line bg-card p-4">
          {/* gezeichnetes Buchcover */}
          <div className="flex h-28 w-20 shrink-0 flex-col justify-between rounded-r-md rounded-l-sm p-2 text-white shadow-md"
            style={{ background: `linear-gradient(135deg, ${owner.color}, #1f2937)` }}>
            <span className="line-clamp-4 text-[10px] font-bold leading-tight">{r.title}</span>
            <span className="truncate text-[8px] opacity-80">{r.author}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">{mine ? "Du liest gerade" : `${owner.display_name} liest gerade`}</p>
            <p className="mt-1 text-lg font-semibold leading-tight">{r.title}</p>
            {r.author && <p className="text-sm text-muted">{r.author}</p>}
            <div className="mt-3 flex items-center gap-2">
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-line/60">
                <span className="block h-full rounded-full" style={{ width: `${r.progress ?? 0}%`, background: owner.color }} />
              </span>
              <span className="text-xs tabular-nums text-muted">{r.progress ?? 0} %</span>
            </div>
            {r.url && (
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-medium text-accent underline">
                In Reado ansehen ↗
              </a>
            )}
            {r.updated_at && <p className="mt-2 text-[11px] text-muted">aktualisiert {new Date(r.updated_at).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" })}</p>}
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">
          📚 {mine ? "Noch kein Buch eingetragen." : `${owner.display_name} hat noch nicht eingetragen, was gerade gelesen wird.`}
        </p>
      )}
      {mine && (
        <div className="flex gap-2">
          <button onClick={() => { setForm(r ?? { title: "", author: "", progress: 0, url: "" }); setEdit(true); }}
            className="flex-1 rounded-xl bg-accent py-2.5 font-medium text-white">{r ? "Aktualisieren" : "Buch eintragen"}</button>
          {r && <button onClick={() => confirm("Buch aus dem Regal nehmen?") && save(null)} className="rounded-xl border border-line px-4 text-sm">Ausgelesen ✓</button>}
        </div>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
