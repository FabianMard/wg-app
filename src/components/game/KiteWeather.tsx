"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { KiteSpot } from "@/lib/types";

/** Spots, solange die WG noch keine eigenen festgelegt hat – Wetter von Open-Meteo (kostenlos, ohne Schlüssel) */
type Spot = Pick<KiteSpot, "name" | "place" | "cc" | "lat" | "lon"> & { id: string };
const DEFAULT_SPOTS: Spot[] = [
  { id: "bodden", name: "Ostsee · Bodden", place: "Suhrendorf, Rügen", cc: "DE", lat: 54.47, lon: 13.15 },
  { id: "sardinien", name: "Sardinien Süd", place: "Chia", cc: "IT", lat: 38.89, lon: 8.88 },
  { id: "tarifa", name: "Tarifa", place: "Andalusien", cc: "ES", lat: 36.01, lon: -5.6 },
];
const MAX_SPOTS = 6;
const flag = (cc: string | null) => cc && /^[a-z]{2}$/i.test(cc)
  ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : "📍";

type Forecast = {
  timezone: string;
  current: { time: string; temperature_2m: number; wind_speed_10m: number; wind_direction_10m: number; wind_gusts_10m: number; weather_code: number };
  hourly: { time: string[]; wind_speed_10m: number[]; wind_gusts_10m: number[]; wind_direction_10m: number[] };
  daily: { time: string[]; wind_speed_10m_max: number[]; wind_gusts_10m_max: number[]; wind_direction_10m_dominant: number[]; weather_code: number[]; temperature_2m_max: number[] };
};
type Marine = { current?: { sea_surface_temperature?: number | null; wave_height?: number | null } };

/** Wie gut ist der Wind zum Kiten? (Knoten) */
export function kiteRating(kn: number) {
  if (kn < 10) return { label: "Zu wenig Wind", emoji: "😴", bar: "bg-neutral-400 dark:bg-neutral-500", badge: "bg-neutral-500/15 text-neutral-700 dark:text-neutral-300" };
  if (kn < 15) return { label: "Leichtwind – großer Kite", emoji: "🪁", bar: "bg-amber-400 dark:bg-amber-500", badge: "bg-amber-500/15 text-amber-800 dark:text-amber-300" };
  if (kn < 28) return { label: "Kiten!", emoji: "🤙", bar: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" };
  if (kn < 35) return { label: "Stark – kleiner Kite", emoji: "💪", bar: "bg-orange-500", badge: "bg-orange-500/15 text-orange-800 dark:text-orange-300" };
  return { label: "Zu viel – nur für Profis", emoji: "⚠️", bar: "bg-red-600", badge: "bg-red-600/15 text-red-700 dark:text-red-300" };
}
const CACHE_KEY = "wg-kite-wetter";
const LEGEND = [5, 12, 20, 30, 40].map(kiteRating);

const beaufort = (kn: number) => [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64].findIndex((t) => kn < t) === -1 ? 12 : [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64].findIndex((t) => kn < t);
const DIRS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
const compass = (deg: number) => DIRS[Math.round(deg / 45) % 8];
function weatherIcon(code: number) {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 67 || (code >= 80 && code <= 82)) return "🌧️";
  if (code <= 77 || code === 85 || code === 86) return "🌨️";
  return "⛈️";
}
const dayName = (iso: string, i: number) => i === 0 ? "Heute" : i === 1 ? "Morgen" : new Date(iso + "T12:00").toLocaleDateString("de-DE", { weekday: "short" });

/** Pfeil zeigt, wohin der Wind weht (Windrichtung = woher er kommt) */
function WindArrow({ deg, size = 22 }: { deg: number; size?: number }) {
  return (
    <span className="inline-flex items-center justify-center" style={{ width: size, height: size, transform: `rotate(${deg + 180}deg)` }} aria-hidden>
      <svg viewBox="0 0 24 24" width={size} height={size}><path d="M12 3 L18 19 L12 15 L6 19 Z" fill="currentColor" /></svg>
    </span>
  );
}

/** Wind der nächsten 12 Stunden als kleines Balkendiagramm */
function WindBars({ f }: { f: Forecast }) {
  const [hover, setHover] = useState<number | null>(null);
  const start = Math.max(0, f.hourly.time.findIndex((t) => t >= f.current.time.slice(0, 13)));
  const idx = Array.from({ length: 12 }, (_, i) => start + i).filter((i) => i < f.hourly.time.length);
  const max = Math.max(30, ...idx.map((i) => f.hourly.wind_gusts_10m[i]));
  const h = hover ?? idx[0];
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-muted">
        <span>Nächste 12 Stunden</span>
        <span className="tabular-nums text-fg">
          {f.hourly.time[h].slice(11, 16)} Uhr · {Math.round(f.hourly.wind_speed_10m[h])} kn, Böen {Math.round(f.hourly.wind_gusts_10m[h])}
        </span>
      </div>
      <div className="flex h-16 items-end gap-[2px]" onMouseLeave={() => setHover(null)}
        role="img" aria-label={`Wind nächste 12 Stunden: ${idx.map((i) => `${f.hourly.time[i].slice(11, 13)} Uhr ${Math.round(f.hourly.wind_speed_10m[i])} Knoten`).join(", ")}`}>
        {idx.map((i) => {
          const kn = f.hourly.wind_speed_10m[i];
          return (
            <button key={i} type="button" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} onFocus={() => setHover(i)}
              className={`relative flex h-full flex-1 items-end rounded-t-[4px] ${hover === i ? "outline outline-2 outline-offset-1 outline-fg/40" : ""}`} aria-label={`${f.hourly.time[i].slice(11, 16)} Uhr: ${Math.round(kn)} Knoten`}>
              {/* Böen als blasser Balken dahinter */}
              <span className="absolute inset-x-0 bottom-0 rounded-t-[4px] bg-line" style={{ height: `${(f.hourly.wind_gusts_10m[i] / max) * 100}%` }} />
              <span className={`relative w-full rounded-t-[4px] ${kiteRating(kn).bar}`} style={{ height: `${Math.max(4, (kn / max) * 100)}%` }} />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted">
        {idx.filter((_, k) => k % 3 === 0).map((i) => <span key={i}>{f.hourly.time[i].slice(11, 13)}h</span>)}
      </div>
    </div>
  );
}

/** Eine gemeinsame Abfrage, auch wenn das Fenster mehrfach öffnet */
const inflight = new Map<string, Promise<{ f: Forecast[]; m: Marine[] }>>();
const spotsKey = (spots: Spot[]) => spots.map((s) => `${s.lat.toFixed(2)},${s.lon.toFixed(2)}`).join(";");
function loadWeather(spots: Spot[]) {
  const key = spotsKey(spots);
  const running = inflight.get(key);
  if (running) return running;
  const lat = spots.map((s) => s.lat).join(","), lon = spots.map((s) => s.lon).join(",");
  const fUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m&daily=wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,weather_code,temperature_2m_max&wind_speed_unit=kn&timezone=auto&forecast_days=3`;
  const mUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=sea_surface_temperature,wave_height`;
  const get = async <T,>(url: string): Promise<T> => {
    for (let i = 0; ; i++) {
      const r = await fetch(url);
      if (r.ok) return r.json() as Promise<T>;
      if (i >= 1) throw new Error(String(r.status));
      await new Promise((ok) => setTimeout(ok, 1500)); // einmal kurz warten und nochmal
    }
  };
  // Bei nur einem Spot liefert Open-Meteo ein einzelnes Objekt statt einer Liste
  const list = <T,>(x: T | T[]) => (Array.isArray(x) ? x : [x]);
  const p = Promise.all([get<Forecast[]>(fUrl), get<Marine[]>(mUrl).catch(() => [] as Marine[])])
    .then(([f, m]) => ({ f: list(f), m: list(m) }))
    .finally(() => { setTimeout(() => inflight.delete(key), 1000); });
  inflight.set(key, p);
  return p;
}

export function KiteWeather({ onPlay }: { onPlay?: () => void }) {
  const { household, isGuest } = useWG();
  const { rows, loaded, reload } = useRows<KiteSpot>("kite_spots", "sort");
  const spots: Spot[] = rows.length ? rows : DEFAULT_SPOTS;
  const key = spotsKey(spots);
  const [data, setData] = useState<{ key: string; f: Forecast[]; m: Marine[] } | null>(null);
  const [err, setErr] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    setErr(false);
    // 15 Minuten merken – Wetter ändert sich nicht so schnell, und die Wetter-API bleibt entspannt
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "null") as { at: number; key: string; f: Forecast[]; m: Marine[] } | null;
      if (c && c.key === key && Date.now() - c.at < 15 * 60_000) { setData(c); return; }
    } catch { /* egal */ }
    let alive = true;
    loadWeather(spots)
      .then((d) => {
        if (!alive) return;
        setData({ key, ...d });
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), key, ...d })); } catch { /* egal */ }
      })
      .catch(() => alive && setErr(true));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loaded]);

  // Solange die WG die Standard-Spots nutzt, werden sie beim ersten Ändern gespeichert
  async function saveSpots(next: Spot[]) {
    if (rows.length) {
      const keep = new Set(next.map((s) => s.id));
      const gone = rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
      if (gone.length) await supabase.from("kite_spots").delete().in("id", gone);
    }
    const fresh = next.filter((s) => !rows.some((r) => r.id === s.id));
    if (fresh.length) {
      const { error } = await supabase.from("kite_spots").insert(fresh.map((s) => ({
        household_id: household.id, name: s.name, place: s.place, cc: s.cc, lat: s.lat, lon: s.lon, sort: next.indexOf(s),
      })));
      if (error) return error.message.includes("kite_spots") ? "Datenbank-Update fehlt: Bitte supabase/017_kite.sql im SQL Editor ausführen." : error.message;
    }
    await reload();
    return null;
  }

  const head = (
    <div className="flex flex-wrap gap-2">
      {onPlay && <button onClick={onPlay} className="flex-1 rounded-2xl bg-accent px-3 py-2 text-sm font-semibold text-white active:scale-[.98]">🏄 Kite-Spiel spielen</button>}
      {!isGuest && <button onClick={() => setEditing(!editing)} className="rounded-2xl border border-line px-3 py-2 text-sm font-semibold">{editing ? "✓ Fertig" : "✏️ Spots ändern"}</button>}
    </div>
  );
  if (editing) return <div className="space-y-3">{head}<SpotEditor spots={spots} onSave={saveSpots} /></div>;

  if (err) return <div className="space-y-3">{head}<p className="text-sm text-muted">Wetter konnte nicht geladen werden – später nochmal versuchen. 🌬️</p></div>;
  if (!data || data.key !== key) return <div className="space-y-3">{head}<p className="animate-pulse text-sm text-muted">Wind wird gemessen … 🌬️</p></div>;

  // Bester Spot gerade: am nächsten an 20 kn
  const best = spots.map((s, i) => ({ s, kn: data.f[i].current.wind_speed_10m })).filter((x) => x.kn >= 12 && x.kn < 35)
    .sort((a, b) => Math.abs(a.kn - 20) - Math.abs(b.kn - 20))[0];

  return (
    <div className="space-y-3">
      {head}
      <p className="rounded-2xl bg-accent/10 px-3 py-2 text-sm">
        {best ? <>🤙 Gerade am besten: <b>{best.s.name}</b> mit {Math.round(best.kn)} kn</> : <>😴 Gerade nirgends richtig Kitewind – Zeit fürs Material-Pflegen.</>}
      </p>
      {spots.map((s, i) => {
        const f = data.f[i], c = f?.current, sea = data.m[i]?.current;
        if (!f) return null;
        const r = kiteRating(c.wind_speed_10m);
        return (
          <div key={s.id} className="space-y-3 rounded-2xl border border-line bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{flag(s.cc)} {s.name}</p>
                <p className="text-xs text-muted">{s.place ? `${s.place} · ` : ""}{c.time.slice(11, 16)} Uhr Ortszeit</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${r.badge}`}>{r.emoji} {r.label}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <WindArrow deg={c.wind_direction_10m} size={28} />
                <span className="text-3xl font-bold tabular-nums">{Math.round(c.wind_speed_10m)}</span>
                <span className="text-sm text-muted">kn</span>
              </div>
              <div className="text-xs leading-5 text-muted">
                <p>Böen <b className="text-fg tabular-nums">{Math.round(c.wind_gusts_10m)} kn</b> · {beaufort(c.wind_speed_10m)} Bft</p>
                <p>aus <b className="text-fg">{compass(c.wind_direction_10m)}</b> ({Math.round(c.wind_direction_10m)}°)</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              <span>{weatherIcon(c.weather_code)} Luft <b className="text-fg">{Math.round(c.temperature_2m)}°</b></span>
              {sea?.sea_surface_temperature != null && <span>🌡️ Wasser <b className="text-fg">{Math.round(sea.sea_surface_temperature)}°</b></span>}
              {sea?.wave_height != null && <span>🌊 Wellen <b className="text-fg">{sea.wave_height < 0.1 ? "flach" : `${sea.wave_height.toFixed(1).replace(".", ",")} m`}</b></span>}
            </div>
            <WindBars f={f} />
            <div className="grid grid-cols-3 gap-1.5">
              {f.daily.time.map((d, k) => {
                const dr = kiteRating(f.daily.wind_speed_10m_max[k]);
                return (
                  <div key={d} className="rounded-xl bg-line/30 px-2 py-1.5 text-center">
                    <p className="text-[11px] font-medium text-muted">{dayName(d, k)} {weatherIcon(f.daily.weather_code[k])}</p>
                    <p className="flex items-center justify-center gap-1 text-sm font-semibold tabular-nums">
                      <span className={`h-2 w-2 rounded-full ${dr.bar}`} aria-hidden />
                      bis {Math.round(f.daily.wind_speed_10m_max[k])} kn
                    </p>
                    <p className="text-[10px] text-muted">Böen {Math.round(f.daily.wind_gusts_10m_max[k])} · {compass(f.daily.wind_direction_10m_dominant[k])}</p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        {LEGEND.map((l) => <span key={l.label} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${l.bar}`} />{l.label}</span>)}
      </div>
      <p className="text-[10px] text-muted">Wetterdaten: Open-Meteo.com · Wind in Knoten (kn), 10 m Höhe</p>
    </div>
  );
}

type GeoResult = { id: number; name: string; latitude: number; longitude: number; country_code?: string; admin1?: string; country?: string };

/** Spots hinzufügen (Ortssuche von Open-Meteo) und entfernen */
function SpotEditor({ spots, onSave }: { spots: Spot[]; onSave: (next: Spot[]) => Promise<string | null> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setMsg(null); setBusy(true);
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.trim())}&count=6&language=de&format=json`);
      const d = (await r.json()) as { results?: GeoResult[] };
      setResults(d.results ?? []);
    } catch { setMsg("Suche hat nicht geklappt – nochmal versuchen."); }
    setBusy(false);
  }
  async function save(next: Spot[]) {
    setBusy(true);
    const e = await onSave(next);
    setBusy(false);
    setMsg(e);
    return !e;
  }
  async function add(g: GeoResult) {
    if (spots.length >= MAX_SPOTS) return setMsg(`Höchstens ${MAX_SPOTS} Spots – erst einen entfernen.`);
    const place = [g.admin1, g.country].filter((x) => x && x !== g.name).join(", ") || null;
    if (await save([...spots, { id: `neu-${g.id}`, name: g.name.slice(0, 60), place, cc: g.country_code ?? null, lat: g.latitude, lon: g.longitude }])) {
      setQ(""); setResults(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="divide-y divide-line rounded-2xl border border-line bg-card">
        {spots.map((s) => (
          <div key={s.id} className="flex items-center gap-2 px-3 py-2">
            <span className="text-lg">{flag(s.cc)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{s.name}</p>
              {s.place && <p className="truncate text-xs text-muted">{s.place}</p>}
            </div>
            <button disabled={busy || spots.length <= 1} onClick={() => save(spots.filter((x) => x !== s))}
              className="rounded-full px-2 py-1 text-sm text-muted hover:bg-line/50 disabled:opacity-30" aria-label={`${s.name} entfernen`}>✕</button>
          </div>
        ))}
      </div>
      <form onSubmit={search} className="flex gap-2">
        <input className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-base outline-none focus:border-accent"
          placeholder="Neuer Spot, z. B. Zingst, Porto Pollo …" value={q} onChange={(e) => setQ(e.target.value)} />
        <button disabled={busy || !q.trim()} className="rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Suchen</button>
      </form>
      {results && results.length === 0 && <p className="text-sm text-muted">Nichts gefunden – anders schreiben oder einen Ort in der Nähe probieren.</p>}
      {results && results.length > 0 && (
        <div className="space-y-1">
          {results.map((g) => (
            <button key={g.id} disabled={busy} onClick={() => add(g)}
              className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-left hover:bg-line/30">
              <span className="text-lg">{flag(g.country_code ?? null)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{g.name}</span>
                <span className="block truncate text-xs text-muted">{[g.admin1, g.country].filter(Boolean).join(", ")}</span>
              </span>
              <span className="text-sm font-semibold text-accent">＋</span>
            </button>
          ))}
        </div>
      )}
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <p className="text-xs text-muted">Die Spots gelten für die ganze WG. Gewählt wird der nächste Ort – das Wetter kommt von dort (bei Buchten am besten den Strandort suchen).</p>
    </div>
  );
}
