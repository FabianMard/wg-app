"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useWG } from "@/lib/wg";
import type { Member, RoomPicture, WallArt } from "@/lib/types";
import { resizePhoto, useSignedUrl } from "@/lib/photos";
import { formatDate } from "@/lib/dates";

/** Verenas Paper – Auswahl zum Lesen (öffnet die Verlagsseite) */
const PAPERS = [
  {
    title: "Robots, occupations, and worker age: A production-unit analysis of employment",
    authors: "Liuchun Deng, Steffen Müller, Verena Plümpe, Jens Stegmaier",
    journal: "European Economic Review", year: 2024,
    url: "https://www.sciencedirect.com/science/article/pii/S0014292124002101",
  },
  {
    title: "Robots and Female Employment in German Manufacturing",
    authors: "Liuchun Deng, Steffen Müller, Verena Plümpe, Jens Stegmaier",
    journal: "AEA Papers and Proceedings", year: 2023,
    url: "https://www.aeaweb.org/articles?id=10.1257/pandp.20231040",
  },
  {
    title: "Micro Data on Robots from the IAB Establishment Panel",
    authors: "Verena Plümpe, Jens Stegmaier",
    journal: "Jahrbücher für Nationalökonomie und Statistik", year: 2022,
    url: "https://www.degruyterbrill.com/de/document/doi/10.1515/jbnst-2022-0045/html",
  },
];

export function Papers() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">📄 Verenas Forschung: Roboter und Arbeit. Welches Paper möchtest du lesen?</p>
      {PAPERS.map((p) => (
        <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer"
          className="block rounded-2xl border border-line bg-card p-3 transition hover:border-accent active:scale-[.99]">
          <p className="font-semibold leading-snug">{p.title}</p>
          <p className="mt-1 text-xs text-muted">{p.authors}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium"><i>{p.journal}</i> · {p.year}</span>
            <span className="shrink-0 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white">Lesen ↗</span>
          </div>
        </a>
      ))}
    </div>
  );
}

/** Verenas Kunst – zufälliges Bild von ihrer Website (live geladen, bleibt dort) */
const SITE = "verenapluempe.wordpress.com";
type Art = { title: string; img: string; fallback: string; file: string; url: string; kind: string; year?: string };
/** Vorher aufbereitet: Vercel verkleinert das Original einmal (WebP) und speichert es zwischen. w muss eine Next-Bildgröße sein. */
export const optimized = (file: string, w: 128 | 384 | 828 = 828) => `/_next/image?url=${encodeURIComponent(file)}&w=${w}&q=70`;
type WpItem = { title: string; URL: string; content: string };

/** Seiten mit Kunst (About/Projects/Latest posts zeigen Fotos bzw. Banner) */
const SKIP_PAGES = /\/(about|projects|latest-posts)\/?$/;
const KIND_OF: [RegExp, string][] = [[/postcards/, "Postkarte"], [/drawings/, "Zeichnung"], [/acryl/, "Acryl"], [/\/$/, "Mixed Media"]];

const decode = (t: string) => { const el = document.createElement("textarea"); el.innerHTML = t; return el.value; };
/** "52_castle_7_HQ" → "Castle 7", "2023_08_forest" → "Forest" (2023), "IMG_6574" → null */
function niceTitle(raw: string): { title: string | null; year?: string } {
  let t = decode(raw).trim();
  // Jahr vorne: "2021_x", "2021x", "2023_08_x", "20240624_x"
  const year = t.match(/^(20\d\d)(?:\d{4}[_-]|[_-]|(?=[a-z]))/i)?.[1];
  t = t.replace(/^(20\d\d)(?:\d{4}[_-]|[_-](\d\d[_-])?|(?=[a-z]))/i, "").replace(/^\d+[_-]/, "").replace(/[_-]?HQ\d*$/i, "").replace(/[_-]protected$/i, "").replace(/[_ -](small|klein|web|final)$/i, "").replace(/[_-]+/g, " ").replace(/([a-zäöü])(\d+)$/i, "$1 $2").trim();
  if (!t || /^(img|dsc|albumtemp|\d{6,}|[0-9a-f]{8} ?[0-9a-f]{4})/i.test(t)) return { title: null, year };
  return { title: t.charAt(0).toUpperCase() + t.slice(1), year };
}
/** Alle Bilder aus Beiträgen und Kunst-Seiten, ohne Doppelte */
function collectArt(posts: WpItem[], pages: WpItem[]): Art[] {
  const seen = new Map<string, Art>();
  const add = (item: WpItem, kind: string, preferPostTitle: boolean) => {
    for (const tag of item.content.match(/<img[^>]+>/g) ?? []) {
      const attr = (n: string) => tag.match(new RegExp(`${n}="([^"]*)"`))?.[1];
      const file = (attr("data-orig-file") ?? attr("src") ?? "").split("?")[0];
      if (!/wp-content\/uploads/.test(file) || seen.has(file)) continue;
      const [w, h] = (attr("data-orig-size") ?? "1000,1000").split(",").map(Number);
      if (Math.min(w, h) < 300) continue; // Symbole/Vorschaubilder auslassen
      const nt = niceTitle(attr("data-image-title") ?? "");
      const postTitle = preferPostTitle ? decode(item.title).trim() : "";
      seen.set(file, {
        title: postTitle || nt.title || "Ohne Titel", year: nt.year, kind, url: item.URL,
        // Über WordPress' Bild-Server laden – direkt von der Seite blockieren Handys das Bild teils (Mobil-Weiterleitung)
        img: optimized(file), file,
        // Notlösung, falls die Aufbereitung einmal scheitert: WordPress' eigener Bild-Server
        fallback: `https://i0.wp.com/${file.replace(/^https?:\/\//, "")}?w=900`,
      });
    }
  };
  for (const p of pages) {
    if (SKIP_PAGES.test(p.URL)) continue;
    add(p, KIND_OF.find(([re]) => re.test(p.URL))?.[1] ?? "Kunst", false);
  }
  for (const p of posts) add(p, "Gemälde", true);
  return [...seen.values()];
}

/** Kunstwerk, wie es zum Aufhängen weitergegeben wird */
export type PickedArt = { title: string; file: string; url: string; kind: string; year?: string };

/** Galerie. Mit onPick: Auswahl-Modus (z. B. für ein Bild im Wohnzimmer) statt „in mein Zimmer hängen“. */
export function ArtGallery({ onPick, pickLabel = "🖼️ Hier aufhängen" }: { onPick?: (a: PickedArt) => void; pickLabel?: string } = {}) {
  const { me, isGuest, refresh } = useWG();
  const [hangMsg, setHangMsg] = useState<string | null>(null);
  const [hanging, setHanging] = useState(false);
  async function hang(a: Art) {
    if (!me) return;
    setHanging(true); setHangMsg(null);
    const wall: WallArt = { title: a.title, file: a.file, url: a.url, kind: a.kind, ...(a.year ? { year: a.year } : {}) };
    const { error } = await supabase.from("members").update({ wall_art: wall }).eq("id", me.id);
    setHanging(false);
    if (error) { setHangMsg(error.message.includes("wall_art") ? "Datenbank-Update fehlt: Bitte supabase/021_wandbild.sql im SQL Editor ausführen." : error.message); return; }
    await refresh();
    setHangMsg(`✓ „${a.title}“ hängt jetzt in deinem Zimmer`);
  }
  const [arts, setArts] = useState<Art[] | null>(null);
  const [err, setErr] = useState(false);
  const [i, setI] = useState(0);
  const [loadedImg, setLoadedImg] = useState(false);
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    const api = `https://public-api.wordpress.com/rest/v1.1/sites/${SITE}/posts?number=100&fields=title,URL,content`;
    const get = (url: string) => fetch(url).then((r) => r.json() as Promise<{ posts?: WpItem[] }>).then((d) => d.posts ?? []);
    Promise.all([get(api), get(`${api}&type=page`).catch(() => [] as WpItem[])])
      .then(([posts, pages]) => {
        const list = collectArt(posts, pages);
        if (!list.length) throw new Error();
        // Einmal mischen und der Reihe nach zeigen – so kommt jedes Bild dran, bevor sich eins wiederholt
        for (let k = list.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [list[k], list[j]] = [list[j], list[k]]; }
        setArts(list);
        setI(0);
      })
      .catch(() => setErr(true));
  }, []);

  // Die nächsten zwei Bilder schon im Hintergrund laden → „Anderes Bild“ zeigt sofort etwas
  useEffect(() => {
    if (!arts || arts.length < 2) return;
    for (const k of [1, 2]) { const im = new Image(); im.src = arts[(i + k) % arts.length].img; }
  }, [arts, i]);

  const next = useCallback(() => {
    if (!arts || arts.length < 2) return;
    setLoadedImg(false); setUseFallback(false);
    setI((cur) => (cur + 1) % arts.length);
  }, [arts]);

  if (err) return (
    <p className="text-sm text-muted">Die Bilder konnten gerade nicht geladen werden. 🎨 <a className="font-medium text-accent underline" href={`https://${SITE}`} target="_blank" rel="noopener noreferrer">Zur Website ↗</a></p>
  );
  if (!arts) return <p className="animate-pulse text-sm text-muted">Pinsel werden ausgewaschen … 🎨</p>;
  const a = arts[i];
  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-line/30">
        {!loadedImg && <div className="flex aspect-[4/3] animate-pulse flex-col items-center justify-center gap-1 text-4xl">🎨<span className="text-xs text-muted">Bild wird vorbereitet …</span></div>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={a.img + (useFallback ? "-fb" : "")} src={useFallback ? a.fallback : a.img} alt={a.title} onLoad={() => setLoadedImg(true)}
          onError={() => { if (!useFallback) setUseFallback(true); }}
          className={`max-h-[55dvh] w-full object-contain ${loadedImg ? "" : "absolute inset-0 opacity-0"}`} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">„{a.title}“</p>
          <p className="text-xs text-muted">{a.kind}{a.year ? ` · ${a.year}` : ""} · von Verena Plümpe · {arts.length} Bilder</p>
        </div>
        <button onClick={next} className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-sm font-semibold text-white active:scale-95">🎲 Anderes Bild</button>
      </div>
      {onPick && (
        <button onClick={() => onPick({ title: a.title, file: a.file, url: a.url, kind: a.kind, ...(a.year ? { year: a.year } : {}) })}
          className="w-full rounded-2xl bg-amber-500 px-3 py-2.5 text-sm font-semibold text-white transition active:scale-[.98]">{pickLabel}</button>
      )}
      {!onPick && !isGuest && me && (
        me.wall_art?.file === a.file
          ? <p className="rounded-xl bg-green-500/10 px-3 py-2 text-sm font-medium text-green-700 dark:text-green-400">🖼️ Hängt schon in deinem Zimmer</p>
          : (
            <button onClick={() => hang(a)} disabled={hanging}
              className="w-full rounded-2xl border-2 border-amber-500/60 bg-amber-400/10 px-3 py-2.5 text-sm font-semibold transition active:scale-[.98] disabled:opacity-50">
              {hanging ? "Wird aufgehängt …" : me.wall_art ? <>🖼️ Austauschen – statt „{me.wall_art.title}“ in mein Zimmer</> : "🖼️ In mein Zimmer hängen"}
            </button>
          )
      )}
      {hangMsg && <p className={`text-sm ${hangMsg.startsWith("✓") ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>{hangMsg}</p>}
      <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-medium text-accent hover:underline">Auf verenapluempe.wordpress.com ansehen ↗</a>
    </div>
  );
}

/** Das Bild an der Wand eines Zimmers */
export function WallArtView({ owner }: { owner: Member }) {
  const { me, refresh } = useWG();
  const [loaded, setLoaded] = useState(false);
  const mine = me?.id === owner.id;
  const art = owner.wall_art;
  async function takeDown() {
    if (!confirm(`„${art?.title}“ abhängen?`)) return;
    await supabase.from("members").update({ wall_art: null }).eq("id", owner.id);
    await refresh();
  }
  if (!art) {
    return (
      <div className="space-y-2 py-4 text-center">
        <p className="text-5xl">🖼️</p>
        <p className="font-semibold">{mine ? "Dein Bilderrahmen ist noch leer." : `${owner.display_name} hat noch kein Bild aufgehängt.`}</p>
        {mine && <p className="text-sm text-muted">Such dir eins aus: in Verenas Zimmer an der 🎨 Farbpalette → „In mein Zimmer hängen“.</p>}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {/* Goldrahmen */}
      <div className="mx-auto w-fit max-w-full rounded-md p-2.5 shadow-xl" style={{ background: "linear-gradient(135deg,#f5d77a,#b8860b 45%,#f5d77a 70%,#a87408)" }}>
        <div className="relative bg-white p-2">
          {!loaded && <div className="flex aspect-square w-64 max-w-full animate-pulse items-center justify-center text-4xl">🎨</div>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={optimized(art.file)} alt={art.title} onLoad={() => setLoaded(true)}
            className={`max-h-[50dvh] max-w-full object-contain ${loaded ? "" : "absolute inset-0 opacity-0"}`} />
        </div>
      </div>
      <div className="text-center">
        <p className="font-semibold">„{art.title}“</p>
        <p className="text-xs text-muted">{art.kind}{art.year ? ` · ${art.year}` : ""} · von Verena Plümpe · hängt bei {mine ? "dir" : owner.display_name}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <a href={art.url} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-line px-3 py-1.5 text-sm font-medium">Auf der Website ansehen ↗</a>
        {mine && <button onClick={takeDown} className="rounded-xl border border-line px-3 py-1.5 text-sm font-medium">Abhängen</button>}
      </div>
      {mine && <p className="text-center text-xs text-muted">Austauschen: in Verenas Zimmer an der 🎨 Farbpalette ein anderes Bild aussuchen.</p>}
    </div>
  );
}

/* ───────────── Bilder in den Gemeinschaftsräumen (Wohnzimmer, Küche, Bad) ───────────── */

const ROOM_NAME: Record<RoomPicture["slot"], string> = {
  "wohnzimmer-1": "Wohnzimmer", "wohnzimmer-2": "Wohnzimmer", "wohnzimmer-3": "Wohnzimmer",
  "kueche-1": "Küche", "kueche-2": "Küche", "bad-1": "Bad",
};

/** Bildquelle für ein Raumbild (Kunstwerk vorab verkleinert, Foto über signierte URL) */
export function useRoomPictureSrc(pic: RoomPicture | null | undefined, w: 128 | 384 | 828 = 828) {
  const photo = useSignedUrl(pic?.kind === "foto" ? pic.image_path : null);
  if (!pic) return null;
  return pic.kind === "kunst" && pic.file ? optimized(pic.file, w) : photo;
}

/** Kleines Gemälde im Goldrahmen für die Karte */
export function RoomThumb({ pic, size, bounce }: { pic: RoomPicture; size: number; bounce?: boolean }) {
  const src = useRoomPictureSrc(pic, 128);
  return (
    <span className={`block overflow-hidden rounded-[3px] shadow ${bounce ? "animate-bounce" : ""}`}
      style={{ width: size * 0.82, height: size * 0.82, padding: Math.max(2, size * 0.07), background: "linear-gradient(135deg,#f5d77a,#b8860b 50%,#f5d77a)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt={pic.title ?? "Bild"} className="h-full w-full object-cover" loading="lazy" /> : <span className="block h-full w-full bg-white/70" />}
    </span>
  );
}

/** Ein Bild an der Wand eines Gemeinschaftsraums: ansehen, Kunstwerk aussuchen, Foto hochladen, abhängen – alle dürfen das */
export function RoomPictureView({ slot, pic, onChanged }: { slot: RoomPicture["slot"]; pic: RoomPicture | null; onChanged: () => void }) {
  const { household, member, myId } = useWG();
  const [mode, setMode] = useState<"ansicht" | "kunst">("ansicht");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const src = useRoomPictureSrc(pic);
  const fileRef = useRef<HTMLInputElement>(null);
  const DB = "Datenbank-Update fehlt: Bitte supabase/025_raumbilder.sql im SQL Editor ausführen.";

  async function save(row: Partial<RoomPicture>) {
    const old = pic?.kind === "foto" ? pic.image_path : null;
    const { error } = await supabase.from("room_pictures").upsert({
      household_id: household.id, slot, set_by: myId, updated_at: new Date().toISOString(),
      title: null, file: null, url: null, image_path: null, ...row,
    });
    if (error) { setErr(error.message.includes("room_pictures") ? DB : error.message); return false; }
    // altes eigenes Foto aus dem Speicher entfernen
    if (old && old !== row.image_path) await supabase.storage.from("pinnwand").remove([old]);
    setLoaded(false);
    onChanged();
    return true;
  }
  async function pickArt(a: PickedArt) {
    setBusy(true); setErr(null);
    if (await save({ kind: "kunst", title: a.title, file: a.file, url: a.url })) setMode("ansicht");
    setBusy(false);
  }
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      const blob = await resizePhoto(f, 1600);
      const path = `${household.id}/wand/${slot}-${Date.now()}.jpg`;
      const up = await supabase.storage.from("pinnwand").upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) throw new Error(/row-level|policy|not found/i.test(up.error.message) ? DB : up.error.message);
      const name = f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").slice(0, 60);
      if (!(await save({ kind: "foto", image_path: path, title: /^(img|dsc|photo|bild)\s*\d+/i.test(name) ? null : name }))) {
        await supabase.storage.from("pinnwand").remove([path]);
      }
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  }
  async function takeDown() {
    if (!pic || !confirm("Bild abhängen?")) return;
    await supabase.from("room_pictures").delete().eq("household_id", household.id).eq("slot", slot);
    if (pic.kind === "foto" && pic.image_path) await supabase.storage.from("pinnwand").remove([pic.image_path]);
    onChanged();
  }

  if (mode === "kunst") {
    return (
      <div className="space-y-3">
        <button onClick={() => setMode("ansicht")} className="text-sm font-medium text-accent">← zurück</button>
        <p className="text-sm text-muted">Such ein Bild von Verena für {ROOM_NAME[slot] === "Küche" ? "die" : "das"} {ROOM_NAME[slot]} aus:</p>
        <ArtGallery onPick={pickArt} pickLabel={busy ? "Wird aufgehängt …" : `🖼️ ${slot.startsWith("kueche") ? "In die Küche" : `Ins ${ROOM_NAME[slot]}`} hängen`} />
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    );
  }

  const by = pic ? member(pic.set_by) : null;
  return (
    <div className="space-y-4">
      {pic && src ? (
        <>
          <div className="mx-auto w-fit max-w-full rounded-md p-2.5 shadow-xl" style={{ background: "linear-gradient(135deg,#f5d77a,#b8860b 45%,#f5d77a 70%,#a87408)" }}>
            <div className="relative bg-white p-2">
              {!loaded && <div className="flex aspect-square w-64 max-w-full animate-pulse items-center justify-center text-4xl">🖼️</div>}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={pic.title ?? "Bild"} onLoad={() => setLoaded(true)}
                className={`max-h-[45dvh] max-w-full object-contain ${loaded ? "" : "absolute inset-0 opacity-0"}`} />
            </div>
          </div>
          <div className="text-center">
            {pic.title && <p className="font-semibold">„{pic.title}“</p>}
            <p className="text-xs text-muted">
              {pic.kind === "kunst" ? "von Verena Plümpe" : "📷 Foto"} · aufgehängt von {by ? (by.id === myId ? "dir" : by.display_name) : "?"} am {formatDate(pic.updated_at.slice(0, 10))}
            </p>
            {pic.kind === "kunst" && pic.url && <a href={pic.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-accent hover:underline">Auf der Website ansehen ↗</a>}
          </div>
        </>
      ) : (
        <div className="space-y-1 py-4 text-center">
          <p className="text-5xl">🖼️</p>
          <p className="font-semibold">Hier hängt noch nichts.</p>
          <p className="text-sm text-muted">Alle in der WG können das Bild aussuchen – auch Gäste.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setMode("kunst")} disabled={busy} className="rounded-2xl bg-amber-500 px-3 py-2.5 text-sm font-semibold text-white active:scale-[.98] disabled:opacity-50">🎨 Bild von Verena</button>
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="rounded-2xl border-2 border-line px-3 py-2.5 text-sm font-semibold active:scale-[.98] disabled:opacity-50">{busy ? "Lädt hoch …" : "📷 Foto hochladen"}</button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={upload} />
      {pic && <button onClick={takeDown} className="w-full text-center text-sm font-medium text-muted">Abhängen</button>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
