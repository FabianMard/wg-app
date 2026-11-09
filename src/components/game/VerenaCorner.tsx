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
type Art = { title: string; img: string; url: string };

export function ArtGallery() {
  const [arts, setArts] = useState<Art[] | null>(null);
  const [err, setErr] = useState(false);
  const [i, setI] = useState(0);
  const [loadedImg, setLoadedImg] = useState(false);

  useEffect(() => {
    fetch(`https://public-api.wordpress.com/rest/v1.1/sites/${SITE}/posts?number=100&fields=title,URL,content`)
      .then((r) => r.json() as Promise<{ posts?: { title: string; URL: string; content: string }[] }>)
      .then((d) => {
        const list = (d.posts ?? []).flatMap((p) => {
          const src = p.content.match(/<img[^>]+src="([^"]+)"/)?.[1];
          if (!src) return [];
          const title = p.title.replace(/&#8217;/g, "’").replace(/&amp;/g, "&").trim();
          // Über WordPress' Bild-Server laden – direkt von der Seite blockieren Handys das Bild teils (Mobil-Weiterleitung)
          const img = `https://i0.wp.com/${src.split("?")[0].replace(/^https?:\/\//, "")}?w=900`;
          return [{ title: title || "Ohne Titel", img, url: p.URL }];
        });
        if (!list.length) throw new Error();
        setArts(list);
        setI(Math.floor(Math.random() * list.length));
      })
      .catch(() => setErr(true));
  }, []);

  const next = useCallback(() => {
    if (!arts || arts.length < 2) return;
    setLoadedImg(false);
    setI((cur) => { let n = cur; while (n === cur) n = Math.floor(Math.random() * arts.length); return n; });
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
          <p className="text-xs text-muted">von Verena Plümpe · Bild {i + 1} von {arts.length}</p>
        </div>
        <button onClick={next} className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-sm font-semibold text-white active:scale-95">🎲 Anderes Bild</button>
      </div>
      <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-medium text-accent hover:underline">Auf verenapluempe.wordpress.com ansehen ↗</a>
    </div>
  );
}
