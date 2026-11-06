"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { Note, NoteColor } from "@/lib/types";

const COLORS: Record<NoteColor, { bg: string; label: string }> = {
  gelb: { bg: "#fde68a", label: "Gelb" },
  rosa: { bg: "#fbcfe8", label: "Rosa" },
  gruen: { bg: "#bbf7d0", label: "Grün" },
  blau: { bg: "#bfdbfe", label: "Blau" },
  orange: { bg: "#fed7aa", label: "Orange" },
};
const TILTS = [-2.5, 1.8, -1.2, 2.4, -1.8, 1.2];
const MAX_LEN = 300;
const SHOWN = 12;

// Korkwand: Grundfarbe + feine Punkte
const CORK = {
  backgroundColor: "#c89b62",
  backgroundImage:
    "radial-gradient(rgba(90,55,20,.28) 1px, transparent 1.3px), radial-gradient(rgba(255,240,210,.25) 1px, transparent 1.3px)",
  backgroundSize: "9px 9px, 13px 13px",
  backgroundPosition: "0 0, 4px 6px",
};

function Pin({ color = "#ef4444" }: { color?: string }) {
  return (
    <span aria-hidden className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rounded-full shadow-[0_2px_2px_rgba(0,0,0,.35)]"
      style={{ background: `radial-gradient(circle at 35% 35%, #fff8 0 20%, ${color} 45%)` }} />
  );
}

export function Pinboard() {
  const { household, member, myId } = useWG();
  const { rows: notes, loaded, reload } = useRows<Note>("notes", "created_at", false);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [color, setColor] = useState<NoteColor>("gelb");
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function pin(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setErr(null);
    const { error } = await supabase.from("notes").insert({ household_id: household.id, text: t.slice(0, MAX_LEN), color });
    if (error) {
      setErr(error.message.includes("notes") ? "Datenbank-Update fehlt: Bitte supabase/005_pinnwand.sql im SQL Editor ausführen." : error.message);
      return;
    }
    setText("");
    setWriting(false);
    reload();
  }
  async function remove(n: Note) {
    if (!confirm("Zettel abnehmen?")) return;
    await supabase.from("notes").delete().eq("id", n.id);
    reload();
  }

  const shown = showAll ? notes : notes.slice(0, SHOWN);

  return (
    <section aria-label="Pinnwand" className="mb-4 rounded-2xl border-[6px] border-[#8b5a2b] p-3 pt-4 shadow-[inset_0_2px_6px_rgba(0,0,0,.25)]" style={CORK}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="rounded bg-white/85 px-2 py-0.5 font-hand text-2xl font-bold leading-none text-neutral-800 shadow-sm">📌 Pinnwand</h2>
        {!writing && (
          <button onClick={() => setWriting(true)}
            className="rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-neutral-800 shadow transition hover:bg-white active:scale-95">
            + Zettel
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-5 pt-1 sm:grid-cols-3">
        {writing && (
          <form onSubmit={pin} className="relative col-span-2 flex flex-col gap-2 p-3 pt-4 shadow-[2px_4px_8px_rgba(0,0,0,.3)] sm:col-span-1"
            style={{ background: COLORS[color].bg }}>
            <Pin color="#3b82f6" />
            <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_LEN} rows={4}
              placeholder="Was willst du den anderen sagen?"
              className="w-full resize-none bg-transparent font-hand text-2xl leading-tight text-neutral-800 outline-none placeholder:text-neutral-500" />
            <div className="flex items-center gap-1.5">
              {(Object.keys(COLORS) as NoteColor[]).map((c) => (
                <button type="button" key={c} onClick={() => setColor(c)} aria-label={`Farbe ${COLORS[c].label}`}
                  className={`h-6 w-6 rounded-full border border-black/15 ${color === c ? "ring-2 ring-neutral-700 ring-offset-1" : ""}`}
                  style={{ background: COLORS[c].bg }} />
              ))}
              <span className="ml-auto text-xs text-neutral-600">{text.length}/{MAX_LEN}</span>
            </div>
            <div className="flex gap-2">
              <button className="flex-1 rounded-lg bg-neutral-800 py-1.5 text-sm font-semibold text-white disabled:opacity-40" disabled={!text.trim()}>Anpinnen</button>
              <button type="button" onClick={() => { setWriting(false); setText(""); setErr(null); }}
                className="rounded-lg px-3 py-1.5 text-sm text-neutral-700 hover:bg-black/5">Abbrechen</button>
            </div>
            {err && <p className="text-sm font-medium text-red-700">{err}</p>}
          </form>
        )}

        {shown.map((n, i) => {
          const by = member(n.author);
          return (
            <article key={n.id}
              className="group relative flex min-h-[7.5rem] flex-col p-3 pt-4 shadow-[2px_4px_8px_rgba(0,0,0,.3)] transition hover:z-10 hover:rotate-0 hover:scale-[1.03]"
              style={{ background: COLORS[n.color]?.bg ?? COLORS.gelb.bg, transform: `rotate(${TILTS[i % TILTS.length]}deg)` }}>
              <Pin color={by?.color} />
              <p className="flex-1 whitespace-pre-wrap break-words font-hand text-[1.35rem] leading-tight text-neutral-800">{n.text}</p>
              <p className="mt-2 flex items-center justify-between gap-1 text-[11px] text-neutral-600">
                <span className="truncate">
                  {by ? (by.id === myId ? "du" : by.display_name) : "?"} · {new Date(n.created_at).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" })}
                </span>
                <button onClick={() => remove(n)} aria-label="Zettel abnehmen" title="Abnehmen"
                  className="rounded px-1 text-neutral-500 hover:bg-black/10 hover:text-neutral-800">✕</button>
              </p>
            </article>
          );
        })}

        {loaded && notes.length === 0 && !writing && (
          <button onClick={() => setWriting(true)}
            className="col-span-2 rounded-lg border-2 border-dashed border-white/60 py-6 text-center font-hand text-2xl text-white/90 sm:col-span-3">
            Noch leer. Pinn den ersten Zettel an!
          </button>
        )}
      </div>

      {notes.length > SHOWN && (
        <button onClick={() => setShowAll(!showAll)} className="mt-3 w-full rounded-lg bg-white/80 py-1.5 text-sm font-medium text-neutral-800">
          {showAll ? "Weniger anzeigen" : `Alle ${notes.length} Zettel anzeigen`}
        </button>
      )}
    </section>
  );
}
