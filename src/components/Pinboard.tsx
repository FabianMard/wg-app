"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/push";
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

/** Foto verkleinern (max. 1280 px, JPEG), damit Upload schnell geht und Speicher spart */
async function shrinkImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Dieses Bildformat kann der Browser nicht öffnen."));
      i.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Foto konnte nicht verarbeitet werden."))), "image/jpeg", 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Pin({ color = "#ef4444" }: { color?: string }) {
  return (
    <span aria-hidden className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rounded-full shadow-[0_2px_2px_rgba(0,0,0,.35)]"
      style={{ background: `radial-gradient(circle at 35% 35%, #fff8 0 20%, ${color} 45%)` }} />
  );
}

export function Pinboard() {
  const { household, member, myId, isGuest } = useWG();
  const { rows: notes, loaded, reload } = useRows<Note>("notes", "created_at", false);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [color, setColor] = useState<NoteColor>("gelb");
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [big, setBig] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const requested = useRef(new Set<string>()); // jedes Foto nur einmal anfragen

  // Private Fotos: kurzlebige, signierte Links holen
  const paths = notes.map((n) => n.image_path).filter((p): p is string => !!p);
  const pathKey = paths.join("|");
  useEffect(() => {
    const missing = pathKey ? pathKey.split("|").filter((p) => !requested.current.has(p)) : [];
    if (!missing.length) return;
    missing.forEach((p) => requested.current.add(p));
    supabase.storage.from("pinnwand").createSignedUrls(missing, 60 * 60 * 6).then(({ data }) => {
      if (!data) return;
      const fresh: Record<string, string> = {};
      for (const d of data) if (d.path && d.signedUrl) fresh[d.path] = d.signedUrl;
      if (Object.keys(fresh).length) setUrls((u) => ({ ...u, ...fresh }));
    });
  }, [pathKey]);

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErr(null);
    try {
      const blob = await shrinkImage(f);
      if (photo) URL.revokeObjectURL(photo.preview);
      setPhoto({ blob, preview: URL.createObjectURL(blob) });
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  function closeEditor() {
    setWriting(false); setText(""); setErr(null);
    if (photo) URL.revokeObjectURL(photo.preview);
    setPhoto(null);
  }

  async function pin(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t && !photo) return;
    setErr(null);
    setBusy(true);
    let image_path: string | null = null;
    if (photo) {
      image_path = `${household.id}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("pinnwand").upload(image_path, photo.blob, { contentType: "image/jpeg" });
      if (up.error) {
        setBusy(false);
        setErr(/bucket|not found/i.test(up.error.message)
          ? "Foto-Speicher fehlt: Bitte supabase/007_pinnwand_fotos.sql im SQL Editor ausführen."
          : `Foto-Upload fehlgeschlagen: ${up.error.message}`);
        return;
      }
    }
    const { error } = await supabase.from("notes").insert({ household_id: household.id, text: t.slice(0, MAX_LEN), color, ...(image_path ? { image_path } : {}) });
    setBusy(false);
    if (!error) notify("pinnwand", t ? t.slice(0, 120) : "📷 Neues Foto");
    if (error) {
      if (image_path) await supabase.storage.from("pinnwand").remove([image_path]);
      setErr(error.message.includes("image_path") || error.message.includes("notes_text_check")
        ? "Datenbank-Update fehlt: Bitte supabase/007_pinnwand_fotos.sql im SQL Editor ausführen."
        : error.message.includes("notes") ? "Datenbank-Update fehlt: Bitte supabase/005_pinnwand.sql im SQL Editor ausführen." : error.message);
      return;
    }
    closeEditor();
    reload();
  }
  async function remove(n: Note) {
    if (!confirm(n.image_path ? "Foto abnehmen?" : "Zettel abnehmen?")) return;
    await supabase.from("notes").delete().eq("id", n.id);
    if (n.image_path) await supabase.storage.from("pinnwand").remove([n.image_path]);
    reload();
  }

  const shown = showAll ? notes : notes.slice(0, SHOWN);

  return (
    <section aria-label="Pinnwand" className="mb-4 rounded-2xl border-[6px] border-[#8b5a2b] p-3 pt-4 shadow-[inset_0_2px_6px_rgba(0,0,0,.25)]" style={CORK}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="rounded bg-white/85 px-2 py-0.5 font-hand text-2xl font-bold leading-none text-neutral-800 shadow-sm">📌 Pinnwand</h2>
        {!writing && !isGuest && (
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
            {photo && (
              <div className="relative bg-white p-1.5 pb-2 shadow">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.preview} alt="Vorschau" className="max-h-48 w-full object-cover" />
                <button type="button" onClick={() => { URL.revokeObjectURL(photo.preview); setPhoto(null); }} aria-label="Foto entfernen"
                  className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-sm text-white">✕</button>
              </div>
            )}
            <textarea autoFocus={!photo} value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_LEN} rows={photo ? 2 : 4}
              placeholder={photo ? "Bildunterschrift (optional)" : "Was willst du den anderen sagen?"}
              className="w-full resize-none bg-transparent font-hand text-2xl leading-tight text-neutral-800 outline-none placeholder:text-neutral-500" />
            <div className="flex items-center gap-1.5">
              {(Object.keys(COLORS) as NoteColor[]).map((c) => (
                <button type="button" key={c} onClick={() => setColor(c)} aria-label={`Farbe ${COLORS[c].label}`}
                  className={`h-6 w-6 rounded-full border border-black/15 ${color === c ? "ring-2 ring-neutral-700 ring-offset-1" : ""}`}
                  style={{ background: COLORS[c].bg }} />
              ))}
              <button type="button" onClick={() => fileRef.current?.click()}
                className="ml-auto rounded-full bg-white/70 px-2.5 py-0.5 text-sm font-medium text-neutral-800 hover:bg-white">📷 Foto</button>
              <input ref={fileRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
            </div>
            <div className="flex gap-2">
              <button className="flex-1 rounded-lg bg-neutral-800 py-1.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || (!text.trim() && !photo)}>
                {busy ? "Wird angepinnt …" : "Anpinnen"}
              </button>
              <button type="button" onClick={closeEditor}
                className="rounded-lg px-3 py-1.5 text-sm text-neutral-700 hover:bg-black/5">Abbrechen</button>
            </div>
            {err && <p className="text-sm font-medium text-red-700">{err}</p>}
          </form>
        )}

        {shown.map((n, i) => {
          const by = member(n.author);
          const meta = (
            <p className="mt-2 flex items-center justify-between gap-1 text-[11px] text-neutral-600">
              <span className="truncate">
                {by ? (by.id === myId ? "du" : by.display_name) : "?"} · {new Date(n.created_at).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" })}
              </span>
              {!isGuest && <button onClick={() => remove(n)} aria-label={n.image_path ? "Foto abnehmen" : "Zettel abnehmen"} title="Abnehmen"
                className="rounded px-1 text-neutral-500 hover:bg-black/10 hover:text-neutral-800">✕</button>}
            </p>
          );
          if (n.image_path) {
            // Foto im Polaroid-Look
            const src = urls[n.image_path];
            return (
              <article key={n.id}
                className="group relative flex flex-col bg-white p-2 pb-2.5 shadow-[2px_4px_8px_rgba(0,0,0,.3)] transition hover:z-10 hover:rotate-0 hover:scale-[1.03]"
                style={{ transform: `rotate(${TILTS[i % TILTS.length]}deg)` }}>
                <Pin color={by?.color} />
                <button onClick={() => src && setBig(src)} className="block aspect-square w-full overflow-hidden bg-neutral-200" aria-label="Foto groß anzeigen">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {src ? <img src={src} alt={n.text || "Foto"} className="h-full w-full object-cover" loading="lazy" />
                    : <span className="flex h-full items-center justify-center text-2xl text-neutral-400">📷</span>}
                </button>
                {n.text && <p className="mt-1.5 whitespace-pre-wrap break-words font-hand text-xl leading-tight text-neutral-800">{n.text}</p>}
                {meta}
              </article>
            );
          }
          return (
            <article key={n.id}
              className="group relative flex min-h-[7.5rem] flex-col p-3 pt-4 shadow-[2px_4px_8px_rgba(0,0,0,.3)] transition hover:z-10 hover:rotate-0 hover:scale-[1.03]"
              style={{ background: COLORS[n.color]?.bg ?? COLORS.gelb.bg, transform: `rotate(${TILTS[i % TILTS.length]}deg)` }}>
              <Pin color={by?.color} />
              <p className="flex-1 whitespace-pre-wrap break-words font-hand text-[1.35rem] leading-tight text-neutral-800">{n.text}</p>
              {meta}
            </article>
          );
        })}

        {loaded && notes.length === 0 && !writing && isGuest && (
          <p className="col-span-2 py-6 text-center font-hand text-2xl text-white/90 sm:col-span-3">Noch keine Zettel.</p>
        )}
        {loaded && notes.length === 0 && !writing && !isGuest && (
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
      {big && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setBig(null)} role="dialog" aria-label="Foto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={big} alt="Foto" className="max-h-full max-w-full rounded shadow-2xl" />
          <button className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-neutral-800">Schließen ✕</button>
        </div>
      )}
    </section>
  );
}
