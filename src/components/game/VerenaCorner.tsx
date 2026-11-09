"use client";

import { useCallback, useEffect, useState } from "react";

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
type Art = { title: string; img: string; url: string; kind: string; year?: string };
type WpItem = { title: string; URL: string; content: string };

/** Seiten mit Kunst (About/Projects/Latest posts zeigen Fotos bzw. Banner) */
const SKIP_PAGES = /\/(about|projects|latest-posts)\/?$/;
const KIND_OF: [RegExp, string][] = [[/postcards/, "Postkarte"], [/drawings/, "Zeichnung"], [/acryl/, "Acryl"], [/\/$/, "Mixed Media"]];

const decode = (t: string) => { const el = document.createElement("textarea"); el.innerHTML = t; return el.value; };
/** "52_castle_7_HQ" → "Castle 7", "2023_08_forest" → "Forest" (2023), "IMG_6574" → null */
function niceTitle(raw: string): { title: string | null; year?: string } {
  let t = decode(raw).trim();
  const year = t.match(/^(20\d\d)[_-]/)?.[1];
  t = t.replace(/^(20\d\d)[_-](\d\d[_-])?/, "").replace(/^\d+[_-]/, "").replace(/[_-]?HQ\d*$/i, "").replace(/[_-]protected$/i, "").replace(/[_ -](small|klein|web|final)$/i, "").replace(/[_-]+/g, " ").trim();
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
        img: `https://i0.wp.com/${file.replace(/^https?:\/\//, "")}?w=900`,
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

export function ArtGallery() {
  const [arts, setArts] = useState<Art[] | null>(null);
  const [err, setErr] = useState(false);
  const [i, setI] = useState(0);
  const [loadedImg, setLoadedImg] = useState(false);

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

  const next = useCallback(() => {
    if (!arts || arts.length < 2) return;
    setLoadedImg(false);
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
        {!loadedImg && <div className="flex aspect-[4/3] items-center justify-center text-4xl">🎨</div>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={a.img} src={a.img} alt={a.title} onLoad={() => setLoadedImg(true)}
          className={`max-h-[55dvh] w-full object-contain ${loadedImg ? "" : "absolute inset-0 opacity-0"}`} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">„{a.title}“</p>
          <p className="text-xs text-muted">{a.kind}{a.year ? ` · ${a.year}` : ""} · von Verena Plümpe · {arts.length} Bilder</p>
        </div>
        <button onClick={next} className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-sm font-semibold text-white active:scale-95">🎲 Anderes Bild</button>
      </div>
      <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-medium text-accent hover:underline">Auf verenapluempe.wordpress.com ansehen ↗</a>
    </div>
  );
}
