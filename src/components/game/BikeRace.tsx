"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { Member } from "@/lib/types";
import { Avatar } from "@/components/ui";
import { lookOf, type AvatarLook } from "./avatar";

/**
 * Radrennen von der Geißlerstraße zum Cossi (Cospudener See) – von oben gesehen, Handy quer.
 * Treten: abwechselnd links/rechts tippen. Lenken: Handy neigen (oder Pfeiltasten). Beide Seiten halten = bremsen.
 * Hindernisse: Kurven, Autos, Schlaglöcher, Straßenbahnschienen. Die Strecke ist immer gleich.
 * Die Bestfahrt jeder Person wird als „Geist“ gespeichert.
 */

export const TRACK_ID = "cossi";
const K = 1.2;              // Streckenfaktor (alle Positionen unten sind in „Plan-Metern“)
const LEN = 800 * K;        // Meter
const SAMPLE_MS = 100;
const MAX_LAT = 5;          // m/s seitlich bei vollem Lenkeinschlag

export type Ghost = { member_id: string; household_id: string; time_ms: number; trace: number[]; track: string; updated_at: string };

// ───────────── Strecke ─────────────
const scaled = (pts: [number, number][]) => pts.map(([a, v]) => [a * K, v] as [number, number]);
const CENTER = scaled([[0, 0], [80, 0], [120, 4], [160, -3], [200, 0], [320, 0], [345, 6], [365, 6], [400, 1.5], [440, -2.5], [480, 2], [520, -1], [560, 0], [600, -4], [640, 2], [680, 0], [860, 0]]);
const WIDTH = scaled([[0, 9], [190, 9], [205, 10], [320, 10], [350, 7.5], [370, 5], [550, 5], [575, 8], [860, 9]]);
const SECTIONS: { from: number; name: string; forest?: boolean }[] = [
  { from: 0, name: "🏁 Start: Geißlerstraße" },
  { from: 85 * K, name: "Südvorstadt" },
  { from: 200 * K, name: "🚋 Straßenbahn – Vorsicht Schienen!" },
  { from: 325 * K, name: "↪ Connewitzer Kreuz" },
  { from: 370 * K, name: "🌳 Auwald", forest: true },
  { from: 560 * K, name: "Markkleeberg" },
  { from: 690 * K, name: "🏖️ Gleich am Cossi!" },
];
const RAIL_FROM = 200 * K, RAIL_TO = 322 * K;
const smooth = (t: number) => t * t * (3 - 2 * t);
function interp(pts: [number, number][], s: number) {
  if (s <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (s <= pts[i][0]) {
    const [a, va] = pts[i - 1], [b, vb] = pts[i];
    return va + (vb - va) * smooth((s - a) / (b - a));
  }
  return pts[pts.length - 1][1];
}
const center = (s: number) => interp(CENTER, s);
const width = (s: number) => interp(WIDTH, s);
const sectionAt = (s: number) => [...SECTIONS].reverse().find((x) => s >= x.from) ?? SECTIONS[0];
const railLines = (s: number) => { const c = center(s) + 2.3; return [c - 0.72, c + 0.72]; };

/** Immer gleiche Zufallszahlen → Strecke ist bei jeder Fahrt identisch */
function seeded(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
type Pothole = { s: number; off: number; r: number };
type Car = { s0: number; off: number; v: number; color: string; parked: boolean };
const { POTHOLES, CARS } = (() => {
  const rnd = seeded(7);
  const potholes: Pothole[] = [];
  for (let s = 30; s < LEN - 20; s += 14 + rnd() * 22) {
    const w = width(s) / 2 - 0.8;
    potholes.push({ s, off: (rnd() * 2 - 1) * w, r: 0.35 + rnd() * 0.25 });
  }
  const colors = ["#ef4444", "#3b82f6", "#f8fafc", "#111827", "#f59e0b", "#10b981", "#a855f7"];
  const cars: Car[] = [];
  // Geparkte Autos am Rand (Geißlerstraße, Südvorstadt, Markkleeberg)
  for (const [a, b] of [[15 * K, 190 * K], [585 * K, 770 * K]]) for (let s = a; s < b; s += 22 + rnd() * 30) {
    const side = rnd() < 0.5 ? -1 : 1;
    cars.push({ s0: s, off: side * (width(s) / 2 - 1.1), v: 0, color: colors[Math.floor(rnd() * colors.length)], parked: true });
  }
  // Fahrende Autos in Fahrtrichtung (langsamer als ein guter Radler) – man muss überholen
  for (const [s0, off, v] of [[40, 1.6, 5.2], [130, -1.4, 6], [230, -1.8, 5.5], [610, 1.5, 5], [690, -1.5, 6.2]] as const) {
    cars.push({ s0: s0 * K, off, v, color: colors[Math.floor(rnd() * colors.length)], parked: false });
  }
  return { POTHOLES: potholes, CARS: cars };
})();
const carS = (c: Car, tSec: number) => c.s0 + c.v * Math.max(0, tSec);

// ───────────── Fahrräder (alle gleich schnell – reine Geschmackssache) ─────────────
type BikeType = NonNullable<Member["bike"]>["type"];
const BIKES: { id: BikeType; name: string; icon: string }[] = [
  { id: "randonneur", name: "Randonneur", icon: "🚲" },
  { id: "gravel", name: "Gravelbike", icon: "🚵" },
  { id: "lastenrad", name: "E-Lastenrad", icon: "🔋" },
  { id: "klapprad", name: "E-Klapprad", icon: "🧳" },
];
const BIKE_COLORS = ["#dc2626", "#f97316", "#facc15", "#16a34a", "#0d9488", "#2563eb", "#7c3aed", "#db2777", "#111827", "#e5e7eb", "#78716c", "#b45309"];
const bikeOf = (m?: Member | null) => ({ type: m?.bike?.type ?? "randonneur", color: m?.bike?.color ?? m?.color ?? "#2563eb" });

/** Fahrrad + Fahrer:in von oben. x/y = Mitte, heading in Radiant, u = Pixel pro Meter */
function drawRider(ctx: CanvasRenderingContext2D, u: number, x: number, y: number, heading: number, look: AvatarLook, bike: { type: BikeType; color: string }, alpha: number, crank: number) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(heading);
  ctx.lineCap = "round";
  const t = bike.type;
  // Radstand je Typ: Klapprad kurz, Lastenrad lang
  const front = t === "klapprad" ? 0.62 : t === "lastenrad" ? 1.0 : 0.92, rear = t === "klapprad" ? -0.62 : t === "lastenrad" ? -1.35 : -0.92;
  // Reifen
  ctx.strokeStyle = "#111827"; ctx.lineWidth = (t === "gravel" ? 0.2 : t === "klapprad" ? 0.17 : 0.14) * u;
  for (const [a, b] of [[front - 0.34, front + 0.34], [rear - 0.34, rear + 0.34]]) {
    const r = t === "klapprad" ? 0.24 : 0.34; const m = (a + b) / 2;
    ctx.beginPath(); ctx.moveTo((m - r) * u, 0); ctx.lineTo((m + r) * u, 0); ctx.stroke();
    if (t === "gravel") { ctx.strokeStyle = "#4b5563"; ctx.lineWidth = 0.05 * u; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo((m + k * 0.12) * u, -0.1 * u); ctx.lineTo((m + k * 0.12) * u, 0.1 * u); ctx.stroke(); } ctx.strokeStyle = "#111827"; ctx.lineWidth = 0.2 * u; }
  }
  // Schutzbleche (Randonneur)
  if (t === "randonneur") { ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 0.07 * u; for (const m of [front, rear]) { ctx.beginPath(); ctx.moveTo((m - 0.3) * u, 0); ctx.lineTo((m + 0.3) * u, 0); ctx.stroke(); } }
  // Rahmen in Wunschfarbe
  ctx.strokeStyle = bike.color; ctx.lineWidth = 0.13 * u;
  ctx.beginPath(); ctx.moveTo(rear * u, 0); ctx.lineTo(front * u, 0); ctx.stroke();
  // Langer Gepäckträger mit Taschen (Lastenrad), Akku (E-Räder)
  if (t === "lastenrad") {
    ctx.fillStyle = "#374151"; ctx.fillRect(-1.55 * u, -0.22 * u, 0.95 * u, 0.44 * u);
    ctx.fillStyle = bike.color; ctx.fillRect(-1.5 * u, -0.42 * u, 0.85 * u, 0.2 * u); ctx.fillRect(-1.5 * u, 0.22 * u, 0.85 * u, 0.2 * u);
  }
  if (t === "lastenrad" || t === "klapprad") { ctx.fillStyle = "#1f2937"; ctx.fillRect(-0.35 * u, -0.07 * u, 0.3 * u, 0.14 * u); ctx.fillStyle = "#22c55e"; ctx.fillRect(-0.33 * u, -0.03 * u, 0.06 * u, 0.06 * u); }
  if (t === "randonneur") { ctx.fillStyle = "#92400e"; ctx.fillRect((front + 0.05) * u, -0.18 * u, 0.28 * u, 0.36 * u); } // Lenkertasche
  // Lenker: Rennlenker beim Gravel (gebogen), sonst gerade
  const hb = (front - 0.3) * u;
  ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 0.08 * u;
  ctx.beginPath();
  if (t === "gravel") { ctx.moveTo(hb + 0.12 * u, -0.34 * u); ctx.quadraticCurveTo(hb - 0.05 * u, -0.2 * u, hb, 0); ctx.quadraticCurveTo(hb - 0.05 * u, 0.2 * u, hb + 0.12 * u, 0.34 * u); }
  else { ctx.moveTo(hb, -0.38 * u); ctx.lineTo(hb, 0.38 * u); }
  ctx.stroke();
  // Beine (treten), Körper, Arme, Kopf – im eigenen Look
  const seat = t === "klapprad" ? -0.2 : -0.15, leg = Math.sin(crank) * 0.2 * u;
  ctx.strokeStyle = look.pants; ctx.lineWidth = 0.14 * u;
  ctx.beginPath(); ctx.moveTo(seat * u, -0.15 * u); ctx.lineTo((seat + 0.3) * u + leg, -0.2 * u); ctx.moveTo(seat * u, 0.15 * u); ctx.lineTo((seat + 0.3) * u - leg, 0.2 * u); ctx.stroke();
  ctx.fillStyle = look.shoes; ctx.beginPath(); ctx.arc((seat + 0.32) * u + leg, -0.2 * u, 0.07 * u, 0, Math.PI * 2); ctx.arc((seat + 0.32) * u - leg, 0.2 * u, 0.07 * u, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = look.topColor; ctx.beginPath(); ctx.ellipse(seat * u, 0, 0.3 * u, 0.29 * u, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = look.topColor; ctx.lineWidth = 0.12 * u;
  ctx.beginPath(); ctx.moveTo((seat + 0.12) * u, -0.22 * u); ctx.lineTo(hb, -0.32 * u); ctx.moveTo((seat + 0.12) * u, 0.22 * u); ctx.lineTo(hb, 0.32 * u); ctx.stroke();
  ctx.fillStyle = look.skin; ctx.beginPath(); ctx.arc(hb, -0.32 * u, 0.06 * u, 0, Math.PI * 2); ctx.arc(hb, 0.32 * u, 0.06 * u, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = look.hairColor; ctx.beginPath(); ctx.arc((seat + 0.32) * u, 0, 0.19 * u, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Kleine Vorschau des eigenen Rads */
function BikePreview({ look, bike, size = 120 }: { look: AvatarLook; bike: { type: BikeType; color: string }; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!, ctx = c.getContext("2d")!, dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = size * dpr; c.height = (size / 2) * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size / 2);
    ctx.fillStyle = "#6b7280"; ctx.fillRect(0, 0, size, size / 2);
    drawRider(ctx, size / 3.4, size * 0.55, size / 4, 0, look, bike, 1, 0.8);
  }, [look, bike, size]);
  return <canvas ref={ref} style={{ width: size, height: size / 2 }} className="rounded-lg" aria-hidden />;
}

/** Fahrrad aussuchen und Farbe wählen – wird bei der Person gespeichert (auch der Geist fährt damit) */
function BikePicker() {
  const { me, refresh } = useWG();
  const cur = bikeOf(me);
  const [err, setErr] = useState<string | null>(null);
  if (!me) return null;
  const look = lookOf(me);
  async function save(next: { type: BikeType; color: string }) {
    const { error } = await supabase.from("members").update({ bike: next }).eq("id", me!.id);
    setErr(error ? (error.message.includes("bike") ? "Datenbank-Update fehlt: Bitte supabase/030_radrennen_cossi.sql im SQL Editor ausführen." : error.message) : null);
    refresh();
  }
  return (
    <div className="space-y-2 rounded-2xl border border-line p-3 text-left">
      <div className="flex items-center gap-3">
        <BikePreview look={look} bike={cur} />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">Dein Rad: {BIKES.find((b) => b.id === cur.type)?.name}</p>
          <p className="text-xs text-muted">Du fährst in deinem Outfit aus dem Kleiderschrank. Alle Räder sind gleich schnell.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {BIKES.map((b) => (
          <button key={b.id} onClick={() => save({ ...cur, type: b.id })}
            className={`rounded-xl border px-2 py-1.5 text-sm transition active:scale-95 ${cur.type === b.id ? "border-accent bg-accent/10 font-semibold" : "border-line"}`}>
            {b.icon} {b.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Rahmenfarbe">
        {BIKE_COLORS.map((c) => (
          <button key={c} onClick={() => save({ ...cur, color: c })} aria-label={`Farbe ${c}`}
            className={`h-7 w-7 rounded-full border border-black/15 ${cur.color === c ? "ring-2 ring-accent ring-offset-2 ring-offset-card" : ""}`} style={{ background: c }} />
        ))}
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}

const kmh = (v: number) => Math.round(v * 3.6);
const fmt = (ms: number) => `${(ms / 1000).toFixed(2).replace(".", ",")} s`;

// ───────────── Startbildschirm, Gegner-Wahl, Bestzeiten ─────────────
export function BikeRace({ onResult }: { onResult?: (text: string) => void }) {
  const { everyone, myId } = useWG();
  const { rows: all, reload } = useRows<Ghost>("bike_ghosts", "time_ms");
  const ghosts = all.filter((g) => g.track === TRACK_ID);
  const [rival, setRival] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ time: number; best: boolean; vs: { name: string; diff: number } | null } | null>(null);
  const [dbErr, setDbErr] = useState<string | null>(null);
  const sorted = [...ghosts].sort((a, b) => a.time_ms - b.time_ms);
  const person = (id: string) => everyone.find((m) => m.id === id);
  const myBest = ghosts.find((g) => g.member_id === myId)?.time_ms ?? null;
  const rivalGhost = ghosts.find((g) => g.member_id === (rival ?? sorted[0]?.member_id)) ?? null;
  const rivalName = (g: Ghost) => (g.member_id === myId ? "dein Geist" : person(g.member_id)?.display_name ?? "?");

  const finish = useCallback((time: number | null, trace: number[]) => {
    setRunning(false);
    if (time === null) return; // abgebrochen
    const best = myBest === null || time < myBest;
    setResult({ time, best, vs: rivalGhost ? { name: rivalName(rivalGhost), diff: time - rivalGhost.time_ms } : null });
    if (best) supabase.rpc("submit_ghost", { p_time: Math.round(time), p_trace: trace, p_track: TRACK_ID }).then(({ error }) => {
      setDbErr(error ? (/bike_ghosts|submit_ghost/i.test(error.message) ? "Bestzeit konnte nicht gespeichert werden: Bitte supabase/030_radrennen_cossi.sql im SQL Editor ausführen." : error.message) : null);
      reload();
    });
    onResult?.(best ? `🚴 ${fmt(time)} zum Cossi – neue Bestzeit!` : `🚴 ${fmt(time)} zum Cossi`);
  }, [myBest, rivalGhost, reload, onResult]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    // iPhone: Bewegungssensor nur nach Erlaubnis – muss direkt im Tipp passieren
    const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    try { if (DM?.requestPermission) await DM.requestPermission(); } catch { /* dann Tastatur */ }
    try { await document.documentElement.requestFullscreen?.(); } catch { /* iPhone kann das nicht */ }
    try { await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.("landscape"); } catch { /* egal */ }
    setResult(null);
    setRunning(true);
  }

  return (
    <div className="space-y-4 text-center">
      {running && <RaceRun rival={rivalGhost} rivalMember={rivalGhost ? person(rivalGhost.member_id) : undefined} onOver={finish} />}
      {result ? (
        <>
          <p className="text-5xl">{result.best ? "🏆" : "🏖️"}</p>
          <p className="text-3xl font-bold tabular-nums">{fmt(result.time)}</p>
          {result.best && <p className="font-semibold text-amber-600">Neue Bestzeit – dein Geist fährt jetzt so!</p>}
          {result.vs && (
            <p className={`text-sm font-medium ${result.vs.diff < 0 ? "text-emerald-600" : "text-red-600"}`}>
              {result.vs.diff < 0 ? `🎉 ${fmt(-result.vs.diff)} schneller als ${result.vs.name}` : `${fmt(result.vs.diff)} langsamer als ${result.vs.name}`}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-5xl">🚴🏖️</p>
          <p className="font-semibold">Von der Geißlerstraße zum Cossi</p>
          <p className="text-sm text-muted">Gute Fahrer brauchen etwa 1½ Minuten. <b>Handy quer halten!</b></p>
        </>
      )}
      <BikePicker />
      {ghosts.length > 0 && (
        <div className="text-left">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Gegen welchen Geist? 👻</p>
          <div className="flex flex-wrap gap-2">
            {sorted.map((g) => {
              const on = rivalGhost?.member_id === g.member_id;
              return (
                <button key={g.member_id} onClick={() => setRival(g.member_id)}
                  className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-sm transition active:scale-95 ${on ? "border-accent bg-accent/10 font-semibold" : "border-line"}`}>
                  <Avatar member={person(g.member_id)} size={22} />{g.member_id === myId ? "Dein Geist" : person(g.member_id)?.display_name ?? "?"} · {fmt(g.time_ms)}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <button onClick={start} className="w-full rounded-2xl bg-accent py-3 text-lg font-semibold text-white active:scale-[.98]">
        {result ? "Nochmal 🚴" : rivalGhost ? `Los – gegen ${rivalName(rivalGhost)} 👻` : "Los 🚴"}
      </button>
      <RaceBoard ghosts={sorted} error={dbErr} />
      <ul className="mx-auto max-w-xs space-y-1 text-left text-sm text-muted">
        <li>📱 <b>Handy quer</b>, mit beiden Daumen halten</li>
        <li>👣 <b>Treten:</b> abwechselnd links und rechts tippen (zweimal dieselbe Seite = aus dem Takt)</li>
        <li>🔄 <b>Lenken:</b> Handy neigen wie ein Lenkrad · am Computer: Pfeiltasten, treten mit A/D</li>
        <li>🛑 <b>Bremsen:</b> beide Seiten gleichzeitig gedrückt halten</li>
        <li>🚗 Autos, 🕳️ Schlaglöcher, 🚋 Schienen und 🌿 Gras bremsen dich aus</li>
      </ul>
    </div>
  );
}

/** Bestzeiten (schnellste zuerst) */
export function RaceBoard({ ghosts, error }: { ghosts: Ghost[]; error?: string | null }) {
  const { everyone, myId } = useWG();
  const list = [...ghosts].sort((a, b) => a.time_ms - b.time_ms);
  return (
    <div className="rounded-2xl border border-line p-3 text-left">
      <p className="mb-2 text-center text-sm font-semibold">🏆 Bestzeiten Geißlerstraße → Cossi</p>
      {error && <p className="mb-2 rounded-xl bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">{error}</p>}
      {!list.length && !error && <p className="py-2 text-center text-sm text-muted">Noch keine Fahrt – sei die erste Person! 🥇</p>}
      <ol className="space-y-1.5">
        {list.map((g) => {
          const m = everyone.find((x) => x.id === g.member_id);
          const rank = 1 + list.filter((x) => x.time_ms < g.time_ms).length;
          return (
            <li key={g.member_id} className={`flex items-center gap-2 rounded-xl px-2 py-1 text-sm ${g.member_id === myId ? "bg-accent/10 font-semibold" : ""}`}>
              <span className="w-6 text-center">{["🥇", "🥈", "🥉"][rank - 1] ?? `${rank}.`}</span>
              <Avatar member={m} size={22} />
              <span className="min-w-0 flex-1 truncate">{m?.display_name ?? "?"}{g.member_id === myId && " (du)"}</span>
              <span className="tabular-nums">{fmt(g.time_ms)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ───────────── Das Rennen (Vollbild, quer) ─────────────
type Phase = "drehen" | "kalibrieren" | "countdown" | "fahrt" | "ziel";

function RaceRun({ rival, rivalMember, onOver }: { rival: Ghost | null; rivalMember?: Member; onOver: (time: number | null, trace: number[]) => void }) {
  const { me } = useWG();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [phase, setPhase] = useState<Phase>("countdown");
  const [hud, setHud] = useState({ t: 0, v: 0, s: 0, msg: "", gap: null as number | null, section: SECTIONS[0].name, count: 3 });
  const [hasTilt, setHasTilt] = useState(false);
  const overRef = useRef(onOver);
  useEffect(() => { overRef.current = onOver; }, [onOver]);
  // Jede Person fährt als sie selbst: Outfit aus dem Kleiderschrank + eigenes Rad
  const myLook = useRef(lookOf(me ?? ({} as Member))), myBike = useRef(bikeOf(me));
  const ghostLook = useRef(rivalMember ? lookOf(rivalMember) : null), ghostBike = useRef(bikeOf(rivalMember));

  // Eingaben
  const ctl = useRef({ steerKeys: 0, tilt: 0, tiltSign: 0, lastSide: 0 as -1 | 0 | 1, held: new Map<number, -1 | 1>(), brakeKey: false, tapQueue: [] as (-1 | 1)[] });
  const rawY = useRef<number | null>(null);
  const angle = () => (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0);
  const signKey = () => `wg-rad-neigung-${angle()}`;

  // Größe & Hochformat erkennen
  useEffect(() => {
    const upd = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    upd();
    window.addEventListener("resize", upd);
    window.addEventListener("orientationchange", upd);
    return () => { window.removeEventListener("resize", upd); window.removeEventListener("orientationchange", upd); };
  }, []);
  const portrait = size.h > size.w && size.w < 700;

  // Bewegungssensor: Schwerkraft entlang der langen Handy-Achse = Neigung nach links/rechts (bei Querformat)
  useEffect(() => {
    const on = (e: DeviceMotionEvent) => {
      const y = e.accelerationIncludingGravity?.y;
      if (y == null) return;
      rawY.current = y;
      setHasTilt(true);
      const c = ctl.current;
      if (c.tiltSign) { const v = (y * c.tiltSign) / 4; c.tilt = Math.abs(v) < 0.07 ? 0 : Math.max(-1, Math.min(1, v)); }
    };
    window.addEventListener("devicemotion", on);
    return () => window.removeEventListener("devicemotion", on);
  }, []);

  // Vor dem Start: quer drehen → (Neigung einmal kalibrieren) → Countdown
  useEffect(() => {
    if (phase === "fahrt" || phase === "ziel") return;
    if (portrait) { if (phase !== "drehen") setPhase("drehen"); return; }
    if (hasTilt) {
      let stored = 0;
      try { stored = Number(localStorage.getItem(signKey()) ?? 0); } catch { /* egal */ }
      if (stored) { ctl.current.tiltSign = stored; if (phase !== "countdown") setPhase("countdown"); }
      else if (phase !== "kalibrieren") setPhase("kalibrieren");
    } else if (phase === "drehen") setPhase("countdown");
  }, [portrait, hasTilt, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kalibrieren: „kipp das Handy nach rechts“
  useEffect(() => {
    if (phase !== "kalibrieren") return;
    const t = setInterval(() => {
      const y = rawY.current;
      if (y != null && Math.abs(y) > 3.5) {
        ctl.current.tiltSign = Math.sign(y);
        try { localStorage.setItem(signKey(), String(Math.sign(y))); } catch { /* egal */ }
        setPhase("countdown");
      }
    }, 80);
    return () => clearInterval(t);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = useCallback((time: number | null, trace: number[]) => {
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* egal */ }
    try { (screen.orientation as unknown as { unlock?: () => void })?.unlock?.(); } catch { /* egal */ }
    overRef.current(time, trace);
  }, []);

  // Spielschleife (startet nach dem Drehen/Kalibrieren)
  const started = phase === "countdown" || phase === "fahrt" || phase === "ziel";
  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current!, ctx = canvas.getContext("2d")!;
    let W = 0, H = 0;
    const resize = () => {
      if (!boxRef.current) return;
      W = boxRef.current.clientWidth; H = boxRef.current.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(boxRef.current!);
    const st = {
      t: -3000, s: 0, y: 0, v: 0, heading: 0, stun: 0, msg: "", msgT: 0, done: false, pedal: 0,
      trace: [] as number[], nextSample: 0, hitHoles: new Set<number>(), hitCars: new Set<number>(), railCool: 0, camY: 0,
    };
    if (process.env.NODE_ENV !== "production") (window as unknown as { __race?: unknown }).__race = { st, ctl: ctl.current, center, width, LEN, POTHOLES, CARS, carS, railLines, RAIL_FROM, RAIL_TO };
    const say = (m: string, sec = 1.1) => { st.msg = m; st.msgT = sec; };
    const ghostAt = (ms: number) => {
      if (!rival) return null;
      const n = rival.trace.length / 2, i = ms / SAMPLE_MS, a = Math.floor(i);
      if (a >= n - 1) return { s: (rival.trace[(n - 1) * 2] ?? LEN * 10) / 10, y: (rival.trace[(n - 1) * 2 + 1] ?? 0) / 100 };
      const f = i - a, g = (k: number) => rival.trace[a * 2 + k] * (1 - f) + rival.trace[(a + 1) * 2 + k] * f;
      return { s: g(0) / 10, y: g(1) / 100 };
    };
    let last = performance.now(), raf = 0, hudT = 0, finishedAt = 0, phaseSet = false;

    function frame(now: number) {
      const dt = Math.min(0.033, (now - last) / 1000); last = now;
      st.t += dt * 1000;
      const c = ctl.current;
      const brake = new Set(c.held.values()).size === 2 || c.brakeKey;
      // Treten
      for (const side of c.tapQueue.splice(0)) {
        if (st.t < 0 || st.done || st.stun > 0) continue;
        if (c.lastSide === side) { st.v *= 0.82; say("🦶 Aus dem Takt!", 0.6); }
        else { st.v += 1.5 * Math.max(0, 1 - st.v / 14); st.pedal++; }
        c.lastSide = side;
      }
      if (st.t >= 0 && !st.done) {
        if (!phaseSet) { phaseSet = true; setPhase("fahrt"); }
        const steer = Math.max(-1, Math.min(1, c.steerKeys + c.tilt));
        const w = width(st.s), cs = center(st.s);
        st.v -= dt * (0.25 + 0.018 * st.v * st.v);
        if (brake) st.v -= dt * 7;
        const off = Math.abs(st.y - cs) > w / 2 - 0.3;
        if (off) { st.v = Math.min(st.v, 3.5); st.v -= dt * 3; if (st.msgT <= 0) say(sectionAt(st.s).forest ? "🌳 Im Unterholz!" : "🌿 Auf dem Gras!", 0.7); }
        st.v = Math.max(0, st.v);
        st.stun = Math.max(0, st.stun - dt);
        st.s += st.v * dt;
        const lat = steer * MAX_LAT * Math.min(1, 0.35 + st.v / 6);
        st.y += lat * dt;
        st.heading = Math.atan2(lat, Math.max(1, st.v));
        // Schlaglöcher
        POTHOLES.forEach((p, i) => {
          if (st.hitHoles.has(i) || Math.abs(p.s - st.s) > p.r + 0.3) return;
          if (Math.abs(center(p.s) + p.off - st.y) < p.r + 0.25) { st.hitHoles.add(i); st.v *= 0.55; say("🕳️ Schlagloch!"); }
        });
        // Autos
        const tSec = st.t / 1000;
        CARS.forEach((car, i) => {
          const s = carS(car, tSec), y = center(s) + car.off;
          if (Math.abs(s - st.s) < 2.4 && Math.abs(y - st.y) < 1.2) {
            if (!st.hitCars.has(i)) { st.hitCars.add(i); st.v = Math.min(st.v, 1.2); st.stun = 0.8; say(car.parked ? "🚗 Gegen ein parkendes Auto!" : "🚗 Hupp! Auto gerammt!", 1.3); }
            st.y += Math.sign(st.y - y || 1) * dt * 3; // wegschubsen
          }
        });
        // Straßenbahnschienen
        st.railCool = Math.max(0, st.railCool - dt);
        if (st.s > RAIL_FROM && st.s < RAIL_TO && st.railCool <= 0 && railLines(st.s).some((r) => Math.abs(r - st.y) < 0.16)) {
          st.railCool = 1.3; st.v *= 0.5; st.stun = 0.4; say("🚋 In die Schiene gerutscht!", 1.2);
        }
        while (st.t >= st.nextSample) { st.trace.push(Math.round(st.s * 10), Math.round(st.y * 100)); st.nextSample += SAMPLE_MS; }
        if (st.s >= LEN) {
          const time = st.t - ((st.s - LEN) / Math.max(0.1, st.v)) * 1000;
          st.done = true; finishedAt = time;
          st.trace.push(LEN * 10, Math.round(st.y * 100));
          say("🏖️ Am Cossi!", 3); setPhase("ziel");
          setTimeout(() => leave(finishedAt, st.trace), 1500);
        }
      } else if (st.done) {
        st.v = Math.max(0, st.v - dt * 4); st.s += st.v * dt;
      }
      st.msgT = Math.max(0, st.msgT - dt);
      draw(brake);
      hudT -= dt;
      if (hudT <= 0) {
        hudT = 0.1;
        const g = ghostAt(Math.max(0, st.t));
        setHud({ t: Math.max(0, st.done ? finishedAt : st.t), v: st.v, s: st.s, msg: st.msgT > 0 ? st.msg : "", gap: g ? st.s - g.s : null, section: sectionAt(st.s).name, count: Math.ceil(-st.t / 1000) });
      }
      raf = requestAnimationFrame(frame);
    }

    function draw(brake: boolean) {
      const ppm = Math.max(14, H / 15);
      st.camY += (center(st.s + 6) - st.camY) * 0.08;
      const X = (s: number) => W * 0.24 + (s - st.s) * ppm;
      const Y = (y: number) => H / 2 + (y - st.camY) * ppm;
      const s0 = st.s - (W * 0.24) / ppm - 2, s1 = st.s + (W * 0.76) / ppm + 2;
      const forestNow = !!sectionAt(st.s + 10).forest;
      // Untergrund
      ctx.fillStyle = forestNow ? "#4d7c3a" : "#86b86b"; ctx.fillRect(0, 0, W, H);
      // Bäume im Auwald, Häuser in der Stadt
      for (let s = Math.floor(s0 / 6) * 6; s < s1; s += 6) {
        const sec = sectionAt(s), w = width(s), cy = center(s);
        for (const side of [-1, 1]) {
          const h = Math.abs(Math.sin(s * 12.9898 + side * 78.233) * 43758.5453) % 1;
          if (sec.forest) {
            const y = cy + side * (w / 2 + 2 + h * 3);
            ctx.fillStyle = h > 0.5 ? "#166534" : "#15803d"; ctx.beginPath(); ctx.arc(X(s), Y(y), (1.4 + h) * ppm, 0, Math.PI * 2); ctx.fill();
          } else if (s < 560 * K || s > 600 * K) {
            ctx.fillStyle = ["#e7d8c4", "#d6c3ad", "#cbd5c0", "#e2c9b6"][Math.floor(h * 4)];
            const yy = side < 0 ? Y(cy - w / 2 - 1.2) - 4 * ppm : Y(cy + w / 2 + 1.2);
            ctx.fillRect(X(s), yy, 5 * ppm, 4 * ppm);
          }
        }
      }
      // Ziel: Strand und See
      if (s1 > LEN) {
        ctx.fillStyle = "#f5deb3"; ctx.fillRect(X(LEN + 8), 0, W, H);
        ctx.fillStyle = "#38bdf8"; ctx.fillRect(X(LEN + 30), 0, W, H);
        ctx.fillStyle = "rgba(255,255,255,.5)"; for (let k = 0; k < 6; k++) ctx.fillRect(X(LEN + 34 + k * 7), Y(center(LEN) - 6 + k * 2), 3 * ppm, 0.3 * ppm);
      }
      // Straße
      const roadPoly = (inset: number, color: string) => {
        ctx.fillStyle = color; ctx.beginPath();
        for (let s = s0; s <= s1; s += 1) ctx.lineTo(X(s), Y(center(s) - width(s) / 2 + inset));
        for (let s = s1; s >= s0; s -= 1) ctx.lineTo(X(s), Y(center(s) + width(s) / 2 - inset));
        ctx.closePath(); ctx.fill();
      };
      roadPoly(-0.4, forestNow ? "#a3896a" : "#d1d5db");
      roadPoly(0, forestNow ? "#c7a978" : "#6b7280");
      // Mittellinie (nicht im Wald)
      ctx.strokeStyle = "#f8fafc"; ctx.lineWidth = Math.max(1.5, 0.12 * ppm); ctx.setLineDash([2 * ppm, 2 * ppm]); ctx.lineDashOffset = st.s * ppm;
      ctx.beginPath(); let pen = false;
      for (let s = s0; s <= s1; s += 1) { if (sectionAt(s).forest || s > LEN) { pen = false; continue; } const x = X(s), y = Y(center(s)); if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; } }
      ctx.stroke(); ctx.setLineDash([]);
      // Schienen
      if (s0 < RAIL_TO && s1 > RAIL_FROM) {
        ctx.strokeStyle = "#374151"; ctx.lineWidth = Math.max(2, 0.18 * ppm);
        for (const k of [0, 1]) {
          ctx.beginPath();
          const a = Math.max(s0, RAIL_FROM), b = Math.min(s1, RAIL_TO);
          for (let s = a; s <= b; s += 1) { const r = railLines(s)[k]; if (s === a) ctx.moveTo(X(s), Y(r)); else ctx.lineTo(X(s), Y(r)); }
          ctx.stroke();
        }
      }
      // Schlaglöcher
      for (const p of POTHOLES) if (p.s > s0 && p.s < s1) { ctx.fillStyle = "#1f2937"; ctx.beginPath(); ctx.ellipse(X(p.s), Y(center(p.s) + p.off), p.r * ppm * 1.2, p.r * ppm, 0.4, 0, Math.PI * 2); ctx.fill(); }
      // Ziellinie
      if (LEN > s0 && LEN < s1) { const w = width(LEN), cy = center(LEN); for (let k = 0; k < Math.ceil(w / 0.5); k++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (k + j) % 2 ? "#111" : "#fff"; ctx.fillRect(X(LEN) + j * 0.5 * ppm, Y(cy - w / 2 + k * 0.5), 0.5 * ppm, 0.5 * ppm); } }
      // Autos
      const tSec = Math.max(0, st.t / 1000);
      for (const car of CARS) {
        const s = carS(car, tSec); if (s < s0 - 5 || s > s1 + 5) continue;
        const x = X(s), y = Y(center(s) + car.off), L = 4.4 * ppm, B = 1.9 * ppm;
        ctx.fillStyle = "rgba(0,0,0,.2)"; ctx.fillRect(x - L / 2 + 3, y - B / 2 + 3, L, B);
        ctx.fillStyle = car.color; ctx.beginPath(); ctx.roundRect(x - L / 2, y - B / 2, L, B, 0.5 * ppm); ctx.fill();
        ctx.fillStyle = "rgba(30,41,59,.75)"; ctx.fillRect(x + L * 0.12, y - B * 0.38, L * 0.18, B * 0.76); ctx.fillRect(x - L * 0.32, y - B * 0.36, L * 0.14, B * 0.72);
        if (!car.parked) { ctx.fillStyle = "#fde047"; ctx.fillRect(x + L / 2 - 2, y - B * 0.4, 3, 4); ctx.fillRect(x + L / 2 - 2, y + B * 0.4 - 4, 3, 4); }
      }
      // Geist & Fahrer
      const g = ghostAt(Math.max(0, st.t));
      if (g) drawRider(ctx, ppm, X(g.s), Y(g.y), 0, ghostLook.current ?? myLook.current, ghostBike.current, 0.45, st.t / 160);
      drawRider(ctx, ppm, X(st.s), Y(st.y), st.heading, myLook.current, myBike.current, 1, st.pedal * 0.9);
      if (brake && !st.done && st.t > 0) { ctx.fillStyle = "#ef4444"; ctx.beginPath(); ctx.arc(X(st.s) - 1.1 * ppm, Y(st.y), 0.18 * ppm, 0, Math.PI * 2); ctx.fill(); }
      if (st.t < 0) { ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.round(H / 4)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(Math.ceil(-st.t / 1000)), W / 2, H / 2); }
    }

    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [started, rival, leave]);

  // Tastatur: Pfeile lenken, A/D (oder F/J) treten, Leertaste bremst
  useEffect(() => {
    const keys = new Set<string>();
    const steer = () => { ctl.current.steerKeys = (keys.has("ArrowDown") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("ArrowLeft") ? 1 : 0); };
    const down = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
      if (e.key === "Escape") { leave(null, []); return; }
      if (e.repeat) return;
      keys.add(e.key); steer();
      if (e.key === "a" || e.key === "f") ctl.current.tapQueue.push(-1);
      if (e.key === "d" || e.key === "j") ctl.current.tapQueue.push(1);
      if (e.key === " ") ctl.current.brakeKey = true;
    };
    const up = (e: KeyboardEvent) => { keys.delete(e.key); steer(); if (e.key === " ") ctl.current.brakeKey = false; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [leave]);

  // Touch: linke/rechte Bildschirmhälfte = Pedal; beide gleichzeitig gehalten = Bremse
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const side: -1 | 1 = e.clientX < window.innerWidth / 2 ? -1 : 1;
    ctl.current.held.set(e.pointerId, side);
    if (new Set(ctl.current.held.values()).size < 2) ctl.current.tapQueue.push(side);
  };
  const onUp = (e: React.PointerEvent) => { ctl.current.held.delete(e.pointerId); };

  const progress = Math.min(1, hud.s / LEN);
  // Direkt an die Seite hängen (nicht ins Spiel-Fenster), damit es wirklich den ganzen Bildschirm füllt
  return createPortal(
    <div className="fixed inset-0 z-[200] select-none bg-black text-left text-white" style={{ touchAction: "none" }}>
      <div ref={boxRef} className="absolute inset-0" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onUp}
        role="application" aria-label="Radrennen: links und rechts abwechselnd tippen zum Treten, Handy neigen zum Lenken">
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>
      {/* Anzeige oben */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 p-2 text-sm font-bold">
        <span className="rounded-lg bg-black/55 px-2 py-1 tabular-nums">⏱ {fmt(hud.t)}</span>
        <span className="rounded-lg bg-black/55 px-2 py-1 tabular-nums">{kmh(hud.v)} km/h</span>
        <div className="relative h-2 flex-1 rounded-full bg-white/30">
          <div className="h-full rounded-full bg-white" style={{ width: `${progress * 100}%` }} />
          {hud.gap !== null && <span className="absolute -top-1 h-4 w-1.5 rounded bg-slate-300/90" style={{ left: `${Math.max(0, Math.min(1, (hud.s - hud.gap) / LEN)) * 100}%` }} />}
        </div>
        {rival && hud.gap !== null && hud.count <= 0 && (
          <span className={`rounded-lg px-2 py-1 tabular-nums ${hud.gap >= 0 ? "bg-emerald-600" : "bg-black/55"}`}>👻 {hud.gap >= 0 ? `+${Math.round(hud.gap)} m` : `${Math.round(hud.gap)} m`}</span>
        )}
        <button className="pointer-events-auto rounded-lg bg-black/55 px-3 py-1" onPointerDown={(e) => e.stopPropagation()} onClick={() => leave(null, [])} aria-label="Rennen abbrechen">✕</button>
      </div>
      <p className="pointer-events-none absolute left-2 top-11 rounded-lg bg-black/45 px-2 py-0.5 text-xs font-semibold">{hud.section}</p>
      {hud.msg && <p className="pointer-events-none absolute inset-x-0 top-1/4 mx-auto w-fit rounded-xl bg-black/70 px-3 py-1.5 text-base font-bold">{hud.msg}</p>}
      {(phase === "countdown" || (phase === "fahrt" && hud.t < 6000)) && (
        <>
          <span className="pointer-events-none absolute bottom-3 left-3 rounded-xl bg-black/45 px-3 py-2 text-sm font-bold">🦶 L tippen</span>
          <span className="pointer-events-none absolute bottom-3 right-3 rounded-xl bg-black/45 px-3 py-2 text-sm font-bold">R tippen 🦶</span>
          <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-xl bg-black/45 px-3 py-2 text-xs">{hasTilt ? "📱 Neigen = lenken · beide halten = bremsen" : "Pfeiltasten lenken · A/D treten · Leertaste bremst"}</span>
        </>
      )}
      {(phase === "drehen" || phase === "kalibrieren") && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-neutral-900/95 p-6 text-center">
          {phase === "drehen" ? (
            <>
              <p className="animate-pulse text-6xl">📱↪️</p>
              <p className="text-xl font-bold">Bitte Handy quer halten</p>
              <p className="text-sm text-white/70">Falls sich nichts dreht: Bildschirm-Drehsperre ausschalten.</p>
            </>
          ) : (
            <>
              <p className="text-6xl">↘️📱</p>
              <p className="text-xl font-bold">Kipp das Handy kurz nach rechts</p>
              <p className="text-sm text-white/70">Wie ein Lenkrad – damit das Spiel weiß, wo rechts ist. Das passiert nur einmal.</p>
            </>
          )}
          <button onClick={() => leave(null, [])} className="rounded-xl border border-white/40 px-4 py-2 text-sm">Abbrechen</button>
        </div>
      )}
    </div>,
    document.body,
  );
}
