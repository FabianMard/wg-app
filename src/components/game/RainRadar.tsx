"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Regenradar rund um Leipzig: Niederschlagsradar des Deutschen Wetterdienstes (DWD, frei nutzbar)
 * über einer OpenStreetMap-Karte. Animation von 1 Stunde zurück bis 1½ Stunden Vorhersage (DWD-Nowcast).
 */

const LAT = 51.34, LON = 12.37;
const R = 6378137;
const STEP_MIN = 15, PAST = 4, FUTURE = 6; // −60 … +90 Minuten
const ZOOMS = [{ z: 8, label: "Region" }, { z: 9, label: "Nah" }] as const;

const tileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
/** Kachel-Koordinate → Web-Mercator-Meter (EPSG:3857) */
const merX = (t: number, z: number) => (t / 2 ** z) * 2 * Math.PI * R - Math.PI * R;
const merY = (t: number, z: number) => Math.PI * R - (t / 2 ** z) * 2 * Math.PI * R;

const floor5 = (d: Date) => { const x = new Date(d); x.setUTCSeconds(0, 0); x.setUTCMinutes(x.getUTCMinutes() - (x.getUTCMinutes() % 5)); return x; };
const clock = (d: Date) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

export function RainRadar() {
  const [zi, setZi] = useState(0);
  const z = ZOOMS[zi].z;
  // Zeitpunkte: alle 15 Minuten, „jetzt“ = letzte volle 5 Minuten
  const [base] = useState(() => floor5(new Date()));
  const frames = useMemo(() => Array.from({ length: PAST + FUTURE + 1 }, (_, i) => new Date(base.getTime() + (i - PAST) * STEP_MIN * 60_000)), [base]);
  const [idx, setIdx] = useState(PAST);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const failedRef = useRef(failed);
  failedRef.current = failed;

  // Ausschnitt: 3 Kacheln breit, Leipzig in der Mitte
  const cx = tileX(LON, z), cy = tileY(LAT, z), half = 1.5;
  const tiles = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    for (let x = Math.floor(cx - half); x <= Math.floor(cx + half); x++)
      for (let y = Math.floor(cy - half); y <= Math.floor(cy + half); y++) out.push({ x, y });
    return out;
  }, [cx, cy]);
  const bbox = [merX(cx - half, z), merY(cy + half, z), merX(cx + half, z), merY(cy - half, z)].map((v) => v.toFixed(1)).join(",");
  const radarUrl = (t: Date) => "https://maps.dwd.de/geoserver/dwd/wms?service=WMS&version=1.3.0&request=GetMap"
    + `&layers=dwd:Niederschlagsradar&styles=&crs=EPSG:3857&bbox=${bbox}&width=600&height=600&format=image/png&transparent=true`
    + `&time=${t.toISOString().slice(0, 19)}Z`;
  const urls = frames.map(radarUrl);

  // Alle Bilder vorladen, damit die Animation flüssig läuft
  useEffect(() => {
    const imgs = urls.map((u) => {
      const im = new Image();
      im.onload = () => setLoaded((l) => ({ ...l, [u]: true }));
      im.onerror = () => setFailed((f) => ({ ...f, [u]: true }));
      im.src = u;
      return im;
    });
    return () => { for (const im of imgs) { im.onload = null; im.onerror = null; } };
  }, [urls.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setIdx((i) => {
      // Bilder, die DWD nicht liefern konnte, überspringen
      for (let k = 1; k <= frames.length; k++) { const n = (i + k) % frames.length; if (!failedRef.current[urls[n]]) return n; }
      return i;
    }), 700);
    return () => clearInterval(t);
  }, [playing, frames.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = urls.filter((u) => loaded[u] || failed[u]).length;
  const cur = frames[idx], diff = Math.round((cur.getTime() - base.getTime()) / 60_000);
  const when = diff === 0 ? "jetzt" : diff < 0 ? `vor ${-diff} Min.` : `in ${diff} Min. · Vorhersage`;
  const pct = (v: number) => `${(v / (2 * half)) * 100}%`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Regenradar</p>
        <div className="flex gap-1 rounded-lg bg-line/50 p-0.5 text-xs font-medium">
          {ZOOMS.map((o, i) => (
            <button key={o.z} onClick={() => setZi(i)} className={`rounded-md px-2 py-0.5 ${zi === i ? "bg-card shadow-sm" : "text-muted"}`}>{o.label}</button>
          ))}
        </div>
      </div>
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-[#e8e4da] ring-1 ring-line">
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${z}-${t.x}-${t.y}`} src={`https://tile.openstreetmap.org/${z}/${t.x}/${t.y}.png`} alt="" draggable={false}
            className="absolute max-w-none select-none" loading="lazy"
            style={{ left: pct(t.x - (cx - half)), top: pct(t.y - (cy - half)), width: pct(1), height: pct(1) }} />
        ))}
        {failed[urls[idx]] && <span className="absolute inset-x-0 bottom-8 mx-auto w-fit rounded bg-white/90 px-2 py-0.5 text-[11px] text-neutral-700">Für diese Uhrzeit gibt es kein Radarbild</span>}
        {urls.map((u, i) => !failed[u] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={u} src={u} alt={i === idx ? `Regenradar ${clock(frames[i])}` : ""} draggable={false}
            className="absolute inset-0 h-full w-full select-none transition-opacity duration-200"
            style={{ opacity: i === idx ? 0.8 : 0, imageRendering: "pixelated" }} />
        ))}
        {/* Leipzig */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="block h-3 w-3 rounded-full border-2 border-white bg-red-600 shadow" />
          <span className="absolute left-4 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-white/85 px-1 text-[11px] font-bold text-neutral-900">Leipzig</span>
        </div>
        <span className={`absolute left-2 top-2 rounded-lg px-2 py-1 text-xs font-bold shadow ${diff > 0 ? "bg-indigo-600 text-white" : "bg-white/90 text-neutral-900"}`}>
          {clock(cur)} Uhr · {when}
        </span>
        {ready < urls.length && <span className="absolute right-2 top-2 rounded-lg bg-white/90 px-2 py-1 text-[11px] text-neutral-700">lädt {ready}/{urls.length} …</span>}
        <span className="absolute bottom-1 right-1 rounded bg-white/80 px-1 text-[9px] text-neutral-700">Radar: DWD · Karte: © OpenStreetMap</span>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setPlaying(!playing)} aria-label={playing ? "Anhalten" : "Abspielen"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white active:scale-90">{playing ? "⏸" : "▶"}</button>
        <input type="range" min={0} max={frames.length - 1} value={idx} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
          className="flex-1 accent-[var(--color-accent,#4f46e5)]" aria-label="Zeitpunkt" />
        <button onClick={() => { setPlaying(false); setIdx(PAST); }} className="shrink-0 rounded-lg border border-line px-2 py-1 text-xs font-medium">Jetzt</button>
      </div>
      <div className="flex items-center justify-between gap-1 text-[10px] text-muted">
        {[["#00ffff", "leicht"], ["#00a050", "mäßig"], ["#c8dc00", "kräftig"], ["#ff8c00", "stark"], ["#e60000", "sehr stark"]].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>
        ))}
      </div>
    </div>
  );
}
