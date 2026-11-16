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
 * Das Rad fährt von selbst schnell. Lenken: Handy neigen (oder Pfeiltasten). Bremsen: Bremshebel rechts am Rand.
 * Am Ziel hängt man am Cossi seine Hängematte auf.
 * Hindernisse: Kurven, Autos, Schlaglöcher, Straßenbahnschienen. Die Strecke ist immer gleich.
 * Die Bestfahrt jeder Person wird als „Geist“ gespeichert.
 */

export const TRACK_ID = "cossi";
const K = 1.2;              // Streckenfaktor (alle Positionen unten sind in „Plan-Metern“)
const LEN = 800 * K;        // Meter
const SAMPLE_MS = 100;
const MAX_LAT = 5;          // m/s seitlich bei vollem Lenkeinschlag
const VMAX = 13.6;          // Höchstgeschwindigkeit (≈ 49 km/h) – in engen Kurven muss man bremsen
const BELL_RINGS = 3;       // so oft darf man klingeln
const BELL_RANGE = 35;      // so weit vorne hört man die Klingel (Meter)
const HAMMOCK_S = 20;       // Hängematte: so viele Meter hinter der Ziellinie am Strand

export type Ghost = { member_id: string; household_id: string; time_ms: number; trace: number[]; track: string; updated_at: string };

// ───────────── Strecke ─────────────
const scaled = (pts: [number, number][]) => pts.map(([a, v]) => [a * K, v] as [number, number]);
const CENTER = scaled([[0, 0], [130, 0], [158, 5], [186, -1.5], [200, 0], [320, 0], [340, 8], [362, 8], [392, 1.5], [420, -4], [452, 3], [482, -3], [520, 2], [560, 0], [595, -6], [625, 3], [660, -1], [700, 0], [860, 0]]);
const WIDTH = scaled([[0, 9], [190, 9], [205, 10], [320, 10], [350, 8], [370, 7.5], [550, 7.5], [575, 9.5], [860, 9.5]]);
const SECTIONS: { from: number; name: string; forest?: boolean }[] = [
  { from: 0, name: "🏁 Start: Geißlerstraße" },
  { from: 40 * K, name: "🚶 Eisenbahnstraße – viele Leute unterwegs!" },
  { from: 200 * K, name: "🚋 Südvorstadt – Straßenbahn & viel Verkehr!" },
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
const railLines = (s: number) => { const c = center(s); return [c - 0.72, c + 0.72]; };

/** Immer gleiche Zufallszahlen → Strecke ist bei jeder Fahrt identisch */
function seeded(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
type Pothole = { s: number; off: number; r: number };
type Car = { s0: number; off: number; v: number; color: string; parked: boolean; zone: [number, number] };
type BikeKind = "randonneur" | "gravel" | "lastenrad" | "klapprad";
// Eisenbahnstraße: viele Fußgänger:innen, rechts die Bar „Treuhand“ (zu nah dran = aus Versehen ein Bier)
const EISEN_FROM = 40 * K, EISEN_TO = 198 * K;
const TREU_FROM = 112 * K, TREU_TO = 126 * K;
const inTreuhand = (s: number, y: number) => s >= TREU_FROM && s <= TREU_TO && y > center(s) + width(s) / 2 - 2.1;
type Ped = { s0: number; off: number; mode: "quer" | "laengs"; v: number; phase: number; dir: 1 | -1; shirt: string; hair: string };
type Cyclist = { s0: number; dir: 1 | -1; v: number; off: number; look: AvatarLook; bike: { type: BikeKind; color: string }; zone: [number, number] };
// Kurz vor dem Ziel rechts: Café „Brot und Kees“ (zu nah dran = Apfelkuchen mit Sahne)
const CAFE_FROM = 735 * K, CAFE_TO = 749 * K;
const inCafe = (s: number, y: number) => s >= CAFE_FROM && s <= CAFE_TO && y > center(s) + width(s) / 2 - 2.1;
const FOREST_FROM = 370 * K, FOREST_TO = 560 * K;
const { POTHOLES, CARS, CYCLISTS, PEDS } = (() => {
  const rnd = seeded(7);
  const potholes: Pothole[] = [];
  for (let s = 30; s < LEN - 20; s += 22 + rnd() * 28) {
    const w = width(s) / 2 - 0.8;
    potholes.push({ s, off: (rnd() * 2 - 1) * w, r: 0.35 + rnd() * 0.25 });
  }
  const colors = ["#ef4444", "#3b82f6", "#f8fafc", "#111827", "#f59e0b", "#10b981", "#a855f7"];
  const cars: Car[] = [];
  // Geparkte Autos am Rand: Eisenbahnstraße locker, Markkleeberg dicht an dicht (je Seite mit Abstand, nie übereinander)
  for (const [a, b, gap] of [[15 * K, 126 * K, 22], [578 * K, 770 * K, 12]] as const) for (const side of [-1, 1] as const) {
    for (let s = a + rnd() * 6; s < b; s += 4.4 + gap + rnd() * gap * 1.4) {
      if (side > 0 && s > TREU_FROM - 8 && s < TREU_TO + 8) continue;   // vor der Treuhand ist Biergarten
      if (side > 0 && s > CAFE_FROM - 8 && s < CAFE_TO + 8) continue;   // vor dem Café auch
      if (a < 100 && rnd() < 0.5) continue;                               // Eisenbahnstraße: nur jede zweite Lücke
      cars.push({ s0: s, off: side * (width(s) / 2 - 1.0), v: 0, color: colors[Math.floor(rnd() * colors.length)], parked: true, zone: [0, LEN + 20] });
    }
  }
  // Fahrende Autos – feste Spuren, gleiche Geschwindigkeit je Spur → sie fahren nie ineinander
  // Rechte Spur (in Fahrtrichtung, langsamer als du): Start bis zum Wald
  for (const s0 of [40, 120, 190, 235, 280, 320]) cars.push({ s0: s0 * K, off: 1, v: 5.8, color: colors[Math.floor(rnd() * colors.length)], parked: false, zone: [0, FOREST_FROM - 4] });
  // Linke Spur (Gegenverkehr): Eisenbahnstraße und Südvorstadt
  for (const s0 of [180, 230, 285, 430, 470, 505, 540, 575, 610]) cars.push({ s0, off: -1, v: -7.2, color: colors[Math.floor(rnd() * colors.length)], parked: false, zone: [EISEN_FROM, RAIL_TO] });
  // Im Auwald: andere Radfahrerinnen (mit und gegen die Fahrtrichtung) statt Autos
  const cyclists: Cyclist[] = [];
  const looks = ["#ef4444", "#8b5cf6", "#0ea5e9", "#f59e0b", "#ec4899", "#14b8a6", "#84cc16"];
  const hair = ["#3f2a1d", "#a16207", "#111827", "#d97706", "#7c2d12"];
  const types: BikeKind[] = ["randonneur", "gravel", "lastenrad", "klapprad"];
  const rider = (s0: number, dir: 1 | -1, v: number, off: number, zone: [number, number]): Cyclist => ({
    s0, dir, v, off, zone,
    look: { skin: ["#f2c9a8", "#e0ac69", "#8d5524", "#c68642"][Math.floor(rnd() * 4)], hairColor: hair[Math.floor(rnd() * hair.length)], topColor: looks[Math.floor(rnd() * looks.length)], pants: "#1f2937", shoes: "#f8fafc" } as AvatarLook,
    bike: { type: types[Math.floor(rnd() * 4)], color: looks[Math.floor(rnd() * looks.length)] },
  });
  // Viele Radfahrer:innen im Auwald und in Markkleeberg – zwei Spuren je Richtung, je Spur gleich schnell
  for (const [off, v] of [[0.6, 3.8], [1.5, 3.0]] as const) for (let s = FOREST_FROM + 8; s < 900; s += 30 + rnd() * 30) cyclists.push(rider(s, 1, v, off, [FOREST_FROM, LEN]));
  for (const [off, v] of [[-0.6, 4.2], [-1.5, 3.4]] as const) for (let s = 700; s < 1240; s += 30 + rnd() * 30) cyclists.push(rider(s, -1, v, off, [RAIL_TO, LEN]));
  // Fußgänger:innen auf der Eisenbahnstraße: manche gehen quer über die Straße, manche an den Rändern entlang
  const peds: Ped[] = [];
  const shirts = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#f8fafc", "#111827", "#14b8a6"];
  for (let s = EISEN_FROM + 8; s < EISEN_TO - 6; s += 10 + rnd() * 12) {
    const quer = rnd() < 0.55, side = rnd() < 0.5 ? -1 : 1;
    peds.push({
      s0: s, off: side * (width(s) / 2 - 0.6 - rnd() * 1.2), mode: quer ? "quer" : "laengs", v: 0.9 + rnd() * 0.8, phase: rnd() * 20,
      dir: rnd() < 0.5 ? 1 : -1, shirt: shirts[Math.floor(rnd() * shirts.length)], hair: ["#3f2a1d", "#111827", "#a16207", "#d97706", "#9ca3af"][Math.floor(rnd() * 5)],
    });
  }
  return { POTHOLES: potholes, CARS: cars, CYCLISTS: cyclists, PEDS: peds };
})();
// Wildschweine kreuzen im Auwald den Weg (Bache + Frischlinge), laufen dabei ins Unterholz und wieder zurück
const BOARS = [480, 560, 640].map((s, i) => ({ s, v: 2.2 + (i % 2) * 0.6, phase: i * 7.3 }));
function boarPos(b: { s: number; v: number; phase: number }, tSec: number, k = 0) {
  const A = width(b.s) / 2 + 3.5, x = (b.phase + b.v * Math.max(0, tSec) - k * 0.9 + 400 * A) % (4 * A);
  const off = x < 2 * A ? -A + x : 3 * A - x;
  return { s: b.s + k * 0.5, y: center(b.s) + off, dir: x < 2 * A ? 1 : -1 };
}
const inForest = (s: number) => s >= FOREST_FROM - 4 && s <= FOREST_TO + 4;
const carS = (c: Car, tSec: number) => c.s0 + c.v * Math.max(0, tSec);
/** Seitliche Lage eines Autos: geparkt fest am Rand, sonst Fahrspur (in der Straßenbahn-Strecke neben den Schienen) */
const carY = (c: Car, s: number) => c.parked ? center(s) + c.off : center(s) + c.off * (s > RAIL_FROM - 10 && s < RAIL_TO + 10 ? 2.6 : Math.max(1.1, width(s) / 2 - 3.05));
// Straßenbahnen: kommen ab und zu auf den Schienen entgegen (Abfahrtszeiten in Sekunden nach dem Start)
const TRAM_LEN = 24, TRAM_V = 8, TRAM_TIMES = [14, 30, 47];
const RAIL_DRAW_TO = RAIL_TO + 40;           // Schienen sieht man noch ein Stück weiter (dort kommt die Bahn her)
const TRAM_START = RAIL_DRAW_TO + TRAM_LEN; // Startpunkt der Bahn (noch außer Sicht)
function tramPos(t0: number, tSec: number) {
  const s = TRAM_START - TRAM_V * (tSec - t0);
  return { s, y: center(s), active: tSec >= t0 && s > RAIL_FROM - TRAM_LEN && s <= TRAM_START };
}
/** Autos fahren nicht in den Wald – dort biegen sie ab (verschwinden) */
const carActive = (c: Car, tSec: number) => { const s = carS(c, tSec); return s >= c.zone[0] && s <= c.zone[1] && !inForest(s); };
/** Wo ist die Person gerade? (quer: hin und her über die Straße, längs: am Rand entlang) */
function pedPos(p: Ped, tSec: number) {
  const t = Math.max(0, tSec);
  if (p.mode === "quer") {
    const A = width(p.s0) / 2 - 0.5, x = (p.phase + p.v * t) % (4 * A);
    const off = x < 2 * A ? -A + x : 3 * A - x; // Dreieck: von links nach rechts und zurück
    return { s: p.s0, y: center(p.s0) + off, active: true, heading: x < 2 * A ? Math.PI / 2 : -Math.PI / 2 };
  }
  const s = p.s0 + p.dir * p.v * t;
  return { s, y: center(s) + p.off, active: s > EISEN_FROM && s < EISEN_TO, heading: p.dir > 0 ? 0 : Math.PI };
}
const cycS = (c: Cyclist, tSec: number) => c.s0 + c.dir * c.v * Math.max(0, tSec);
/** Radlerinnen bleiben im Wald */
const cycActive = (c: Cyclist, tSec: number) => { const s = cycS(c, tSec); return s > c.zone[0] && s < c.zone[1]; };

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

/** Fahrradklingel: zwei helle „Pling“ (Web Audio, kein Sound-File nötig) */
let bellCtx: AudioContext | null = null;
function bellSound() {
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    bellCtx = bellCtx ?? new C();
    const ctx = bellCtx; if (ctx.state === "suspended") ctx.resume();
    for (const start of [0, 0.16]) for (const [f, g] of [[2350, 0.22], [3480, 0.09], [5120, 0.05]] as const) {
      const o = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime + start;
      o.type = "sine"; o.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(g, t + 0.005); gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(gain).connect(ctx.destination); o.start(t); o.stop(t + 0.6);
    }
  } catch { /* ohne Ton */ }
}

/** Unsichtbare Person – fürs abgestellte Rad */
const EMPTY_LOOK = { skin: "transparent", hairColor: "transparent", topColor: "transparent", pants: "transparent", shoes: "transparent" } as AvatarLook;

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
        <li>🚴 Du fährst <b>von selbst</b> los – volle Fahrt voraus</li>
        <li>🔄 <b>Lenken:</b> Handy neigen wie ein Lenkrad · am Computer: Pfeiltasten</li>
        <li>🛑 <b>Bremsen:</b> Bremshebel rechts am Rand gedrückt halten · am Computer: Leertaste</li>
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
  const myName = useRef(me?.display_name ?? "");
  // Alle anderen (Mitbewohner und Gäste) warten am Cossi schon in ihren Hängematten
  const { everyone } = useWG();
  const crew = useRef(everyone.filter((m) => m.id !== me?.id).slice(0, 8).map((m, i) => ({
    name: m.display_name, look: lookOf(m), color: bikeOf(m).color,
    // abwechselnd links/rechts neben deiner Hängematte, ab dem 7. eine Reihe weiter hinten
    lat: (i % 2 ? 1 : -1) * 7 * (Math.floor((i % 6) / 2) + 1), row: i >= 6 ? 7 : 0, phase: i * 1.7,
  })));
  const ghostLook = useRef(rivalMember ? lookOf(rivalMember) : null), ghostBike = useRef(bikeOf(rivalMember));

  // Eingaben
  const ctl = useRef({
    steerKeys: 0, tilt: 0, tiltSign: 0, brakeKey: false, brakeTouch: new Set<number>(), ringQueue: 0,
  });
  const [braking, setBraking] = useState(false);
  const [ringsLeft, setRingsLeft] = useState(BELL_RINGS);
  const ringsRef = useRef(BELL_RINGS);
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
      trace: [] as number[], nextSample: 0, hitHoles: new Set<number>(), hitCars: new Set<number>(), hitCyc: new Set<number>(), hitPeds: new Set<number>(), hitTram: new Set<number>(), tramOn: TRAM_TIMES.map(() => null as boolean | null), beer: false, cake: false, hitBoar: new Set<number>(), dodged: new Map<string, { t: number; sign: number }>(), hammock: 0, left: false, chilled: false, railCool: 0, camY: 0,
    };
    if (process.env.NODE_ENV !== "production") (window as unknown as { __race?: unknown }).__race = { st, ctl: ctl.current, center, width, LEN, POTHOLES, CARS, carS, carActive, CYCLISTS, cycS, cycActive, PEDS, TRAM_TIMES, tramPos, TRAM_LEN, carY, inCafe, BOARS, boarPos, ring: () => { ctl.current.ringQueue++; }, pedPos, inTreuhand, railLines, RAIL_FROM, RAIL_TO };
    const say = (m: string, sec = 1.1) => { st.msg = m; st.msgT = sec; };
    // Klingel: Fußgänger:innen, Radler:innen und Wildschweine in Hörweite gehen zur Seite (Autos nicht)
    const dodgeY = (key: string, s: number, y: number, kind: "ped" | "cyc" | "boar") => {
      const d = st.dodged.get(key);
      if (!d) return { y, away: false };
      const w = width(s), lim = kind === "boar" ? w / 2 + 2.6 : kind === "cyc" ? Math.min(w / 2 - 0.45, 2.3) : w / 2 - 0.5;
      const f = Math.min(1, (st.t / 1000 - d.t) / 0.6);
      return { y: y + (center(s) + d.sign * lim - y) * f, away: f > 0.3 };
    };
    const ring = () => {
      if (ringsRef.current <= 0) { say("🔕 Klingel leer – nur 3× pro Fahrt", 1.2); return; }
      ringsRef.current--; setRingsLeft(ringsRef.current);
      const tSec = st.t / 1000, near = (s: number) => s > st.s - 3 && s < st.s + BELL_RANGE;
      const mark = (key: string, y: number) => { if (!st.dodged.has(key)) st.dodged.set(key, { t: tSec, sign: y >= st.y ? 1 : -1 }); };
      PEDS.forEach((pd, i) => { const q = pedPos(pd, tSec); if (q.active && near(q.s)) mark(`p${i}`, q.y); });
      CYCLISTS.forEach((c, i) => { if (cycActive(c, tSec)) { const s = cycS(c, tSec); if (near(s)) mark(`c${i}`, center(s) + c.off); } });
      BOARS.forEach((b, i) => { if (near(b.s)) mark(`b${i}`, boarPos(b, tSec).y); });
      say(`🔔 Kling kling! (noch ${ringsRef.current}×)`, 1);
    };
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
      const brake = c.brakeKey || c.brakeTouch.size > 0;
      if (c.ringQueue > 0) { c.ringQueue = 0; if (st.t >= 0 && !st.done) ring(); }
      if (st.t >= 0 && !st.done) {
        if (!phaseSet) { phaseSet = true; setPhase("fahrt"); }
        const steer = Math.max(-1, Math.min(1, c.steerKeys + c.tilt));
        const w = width(st.s), cs = center(st.s);
        // Fährt von selbst: beschleunigt bis zur Höchstgeschwindigkeit (nach Stößen auch wieder hoch)
        if (brake) st.v -= dt * 8;
        else if (st.stun <= 0 && st.v < VMAX) st.v = Math.min(VMAX, st.v + dt * (st.v < 4 ? 3.2 : 2.2));
        st.pedal += st.v * dt * 0.9;
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
        // Autos, Fußgänger:innen, Radlerinnen
        const tSec = st.t / 1000;
        PEDS.forEach((pd, i) => {
          if (st.hitPeds.has(i)) return;
          const q = pedPos(pd, tSec), dq = dodgeY(`p${i}`, q.s, q.y, "ped");
          if (q.active && !dq.away && Math.abs(q.s - st.s) < 0.8 && Math.abs(dq.y - st.y) < 0.65) { st.hitPeds.add(i); st.v = Math.min(st.v, 1.5); st.stun = 0.6; say("🚶 Huch! Fußgänger – klingeln!", 1.2); }
        });
        BOARS.forEach((b, i) => {
          if (st.hitBoar.has(i) || Math.abs(b.s - st.s) > 2) return;
          for (let k = 0; k < 3; k++) { const q = boarPos(b, tSec, k), dq = dodgeY(`b${i}`, q.s, q.y, "boar"); if (!dq.away && Math.abs(q.s - st.s) < 1 && Math.abs(dq.y - st.y) < (k ? 0.5 : 0.8)) { st.hitBoar.add(i); st.v = 0; st.stun = 1.3; say("🐗 Wildschwein! Vollbremsung im Auwald!", 1.6); break; } }
        });
        if (!st.cake && inCafe(st.s, st.y)) { st.cake = true; st.v = 0; st.stun = 3.2; say("🍰 Brot und Kees: Apfelkuchen mit Sahne muss jetzt sein …", 3.4); }
        if (!st.beer && inTreuhand(st.s, st.y)) { st.beer = true; st.v = 0; st.stun = 3; say("🍺 Ups – in der Treuhand aus Versehen ein Bier getrunken …", 3.2); }
        CYCLISTS.forEach((cy, i) => {
          if (!cycActive(cy, tSec)) return;
          const s = cycS(cy, tSec), dq = dodgeY(`c${i}`, s, center(s) + cy.off, "cyc"), y = dq.y;
          if (!dq.away && Math.abs(s - st.s) < 1.8 && Math.abs(y - st.y) < 0.75) {
            if (!st.hitCyc.has(i)) { st.hitCyc.add(i); st.v = Math.min(st.v, 1.5); st.stun = 0.6; say(cy.dir < 0 ? "🚲 Frontal mit einer Radlerin – Klingel benutzen!" : "🚲 Radlerin angerempelt – Entschuldigung!", 1.3); }
            st.y += Math.sign(st.y - y || 1) * dt * 3;
          }
        });
        CARS.forEach((car, i) => {
          if (!carActive(car, tSec)) return;
          const s = carS(car, tSec), y = carY(car, s);
          if (Math.abs(s - st.s) < 2.4 && Math.abs(y - st.y) < 1.2) {
            if (!st.hitCars.has(i)) { st.hitCars.add(i); st.v = Math.min(st.v, 1.2); st.stun = 0.8; say(car.parked ? "🚗 Gegen ein parkendes Auto!" : (car.v < 0 ? "🚗 Hupp! Gegenverkehr!" : "🚗 Hupp! Auto gerammt!"), 1.3); }
            st.y += Math.sign(st.y - y || 1) * dt * 3; // wegschubsen
          }
        });
        // Straßenbahn
        // Eine Bahn fährt nur los, wenn du noch weit genug weg bist – sonst käme sie „aus dem Nichts“
        TRAM_TIMES.forEach((t0, i) => { if (st.tramOn[i] === null && tSec >= t0) st.tramOn[i] = st.s < TRAM_START - 45; });
        TRAM_TIMES.forEach((t0, i) => {
          if (!st.tramOn[i]) return;
          const q = tramPos(t0, tSec);
          if (q.active && st.s > q.s - TRAM_LEN / 2 - 0.6 && st.s < q.s + TRAM_LEN / 2 + 0.6 && Math.abs(q.y - st.y) < 1.6) {
            if (!st.hitTram.has(i)) { st.hitTram.add(i); st.v = 0; st.stun = 1.6; say("🚋 Bimmel bimmel! Fast unter die Straßenbahn!", 1.8); }
            st.y += Math.sign(st.y - q.y || -1) * dt * 4;
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
          say("🏖️ Am Cossi!", 2); setPhase("ziel");
        }
      } else if (st.done) {
        // Ins Ziel ausrollen, Rad abstellen, Hängematte aufhängen
        const spot = LEN + HAMMOCK_S - 5;
        if (!st.hammock) {
          st.v = Math.max(2.5, Math.min(st.v, (spot - st.s) * 1.6));
          st.s += st.v * dt;
          st.y += (center(spot) + 3.4 - st.y) * Math.min(1, dt * 1.8);
          st.pedal += st.v * dt * 0.9;
          if (st.s >= spot - 0.15) { st.hammock = 0.0001; st.v = 0; say("🪢 Hängematte aufhängen …", 1.2); }
        } else {
          st.hammock += dt;
          if (st.hammock > 1.1 && !st.chilled) { st.chilled = true; say("😎 Hängematte hängt – Feierabend am Cossi!", 3); }
          if (st.hammock > 3.4 && !st.left) { st.left = true; leave(finishedAt, st.trace); }
        }
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
      // Ansicht von oben, man fährt von unten nach oben: Welt (s = Strecke, y = seitlich) wird um −90° gedreht
      const ppm = Math.max(12, H / 22);
      const R = ppm * 1.25; // Radfahrende etwas größer zeichnen, damit man sie gut erkennt
      st.camY += (center(st.s + 6) - st.camY) * 0.08;
      const X = (s: number) => (s - st.s) * ppm;          // nach vorn (= nach oben am Bildschirm)
      const Y = (y: number) => (y - st.camY) * ppm;       // seitlich (= links/rechts)
      const behind = H * 0.2, ahead = H * 0.8;
      const s0 = st.s - behind / ppm - 2, s1 = st.s + ahead / ppm + 2;
      const latMax = W / 2 / ppm + 2;
      const forestNow = !!sectionAt(st.s + 10).forest;
      ctx.save();
      ctx.fillStyle = forestNow ? "#4d7c3a" : "#86b86b"; ctx.fillRect(0, 0, W, H);
      ctx.translate(W / 2, ahead); ctx.rotate(-Math.PI / 2);
      // Bäume im Auwald, Häuserblöcke in der Stadt – links und rechts bis zum Bildrand
      for (let s = Math.floor(s0 / 7) * 7; s < s1; s += 7) {
        const sec = sectionAt(s), w = width(s), cy = center(s);
        for (const side of [-1, 1]) for (let k = 0; ; k++) {
          const d = w / 2 + 1.5 + k * 6.5;
          if (d > latMax + Math.abs(cy - st.camY) + 6) break;
          const h = Math.abs(Math.sin(s * 12.9898 + side * 78.233 + k * 3.7) * 43758.5453) % 1;
          if (sec.forest) {
            ctx.fillStyle = h > 0.5 ? "#166534" : "#15803d"; ctx.beginPath(); ctx.arc(X(s + h * 3), Y(cy + side * (d + 1 + h * 2)), (1.6 + h * 1.2) * ppm, 0, Math.PI * 2); ctx.fill();
          } else if ((s < 560 * K || s > 600 * K) && !(side > 0 && s > TREU_FROM - 7 && s < TREU_TO + 2) && !(side > 0 && s > CAFE_FROM - 7 && s < CAFE_TO + 2)) {
            ctx.fillStyle = ["#e7d8c4", "#d6c3ad", "#cbd5c0", "#e2c9b6"][Math.floor(h * 4)];
            const near = cy + side * d, far = cy + side * (d + 5);
            ctx.fillRect(X(s), Y(Math.min(near, far)), 5.5 * ppm, 5 * ppm);
          }
        }
      }
      // Ziel: Strand und See
      if (s1 > LEN) {
        const big = (latMax + 40) * ppm;
        ctx.fillStyle = "#f5deb3"; ctx.fillRect(X(LEN + 8), -big, 400 * ppm, 2 * big);
        ctx.fillStyle = "#38bdf8"; ctx.fillRect(X(LEN + 30), -big, 400 * ppm, 2 * big);
        ctx.fillStyle = "rgba(255,255,255,.5)"; for (let k = 0; k < 8; k++) ctx.fillRect(X(LEN + 34 + k * 5), Y(center(LEN) - 12 + k * 3), 3 * ppm, 0.3 * ppm);
      }
      // Straße
      const roadPoly = (inset: number, color: string) => {
        ctx.fillStyle = color; ctx.beginPath();
        const e = Math.min(s1, LEN + 6); // am Strand hört die Straße auf
        for (let s = s0; s <= e; s += 1) ctx.lineTo(X(s), Y(center(s) - width(s) / 2 + inset));
        for (let s = e; s >= s0; s -= 1) ctx.lineTo(X(s), Y(center(s) + width(s) / 2 - inset));
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
      if (s0 < RAIL_DRAW_TO && s1 > RAIL_FROM) {
        ctx.strokeStyle = "#374151"; ctx.lineWidth = Math.max(2, 0.18 * ppm);
        for (const k of [0, 1]) {
          ctx.beginPath();
          const a = Math.max(s0, RAIL_FROM), b = Math.min(s1, RAIL_DRAW_TO);
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
      // Bar „Treuhand“ rechts an der Eisenbahnstraße: Haus, Markise, Biergarten bis an die Fahrbahn
      if (s1 > TREU_FROM - 4 && s0 < TREU_TO + 4) {
        const edge = center(TREU_FROM) + width(TREU_FROM) / 2;
        ctx.fillStyle = "#5b3a1e"; ctx.fillRect(X(TREU_FROM - 2), Y(edge + 2.2), (TREU_TO - TREU_FROM + 4) * ppm, 7 * ppm);
        for (let k = 0; k < 9; k++) { ctx.fillStyle = k % 2 ? "#facc15" : "#b91c1c"; ctx.fillRect(X(TREU_FROM - 2 + k * ((TREU_TO - TREU_FROM + 4) / 9)), Y(edge + 1.4), ((TREU_TO - TREU_FROM + 4) / 9) * ppm, 0.8 * ppm); }
        ctx.fillStyle = "rgba(250,204,21,.28)"; ctx.fillRect(X(TREU_FROM), Y(edge - 2.1), (TREU_TO - TREU_FROM) * ppm, 3.5 * ppm); // Biergarten-Zone
        for (let k = 0; k < 4; k++) {
          const ts = TREU_FROM + 2 + k * 3.2;
          ctx.fillStyle = "#92400e"; ctx.beginPath(); ctx.arc(X(ts), Y(edge - 0.6), 0.55 * ppm, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#fde68a"; ctx.beginPath(); ctx.arc(X(ts + 0.2), Y(edge - 0.7), 0.16 * ppm, 0, Math.PI * 2); ctx.fill();
        }
      }
      // Micha steht am Start am rechten Straßenrand und winkt
      const MICHA_S = 4, michaY = center(MICHA_S) + width(MICHA_S) / 2 + 0.9;
      if (MICHA_S > s0 - 3 && MICHA_S < s1 + 3) {
        ctx.save(); ctx.translate(X(MICHA_S), Y(michaY)); ctx.rotate(-Math.PI / 2); ctx.scale(2, 2);
        const wave = Math.sin(performance.now() / 150) * 0.12 * ppm;
        ctx.fillStyle = "#1f2937"; ctx.beginPath(); ctx.arc(-0.12 * ppm, 0.05 * ppm, 0.11 * ppm, 0, Math.PI * 2); ctx.arc(0.12 * ppm, 0.05 * ppm, 0.11 * ppm, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#f97316"; ctx.lineWidth = 0.1 * ppm; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(-0.25 * ppm, 0); ctx.lineTo(-0.45 * ppm + wave, -0.35 * ppm); ctx.stroke(); // winkender Arm
        ctx.fillStyle = "#f97316"; ctx.beginPath(); ctx.ellipse(0, 0, 0.36 * ppm, 0.2 * ppm, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#4b2e1a"; ctx.beginPath(); ctx.arc(0, 0, 0.17 * ppm, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      // Café „Brot und Kees“ rechts kurz vor dem Ziel: Haus, Markise, Tische mit Kuchen bis an die Fahrbahn
      if (s1 > CAFE_FROM - 4 && s0 < CAFE_TO + 4) {
        const edge = center(CAFE_FROM) + width(CAFE_FROM) / 2, len = CAFE_TO - CAFE_FROM + 4;
        ctx.fillStyle = "#fef3c7"; ctx.fillRect(X(CAFE_FROM - 2), Y(edge + 2.2), len * ppm, 7 * ppm);
        for (let k = 0; k < 9; k++) { ctx.fillStyle = k % 2 ? "#ffffff" : "#15803d"; ctx.fillRect(X(CAFE_FROM - 2 + k * (len / 9)), Y(edge + 1.4), (len / 9) * ppm, 0.8 * ppm); }
        ctx.fillStyle = "rgba(244,114,182,.25)"; ctx.fillRect(X(CAFE_FROM), Y(edge - 2.1), (CAFE_TO - CAFE_FROM) * ppm, 3.5 * ppm); // Kuchen-Zone
        for (let k = 0; k < 4; k++) {
          const ts = CAFE_FROM + 2 + k * 3.2;
          ctx.fillStyle = "#f8fafc"; ctx.beginPath(); ctx.arc(X(ts), Y(edge - 0.6), 0.55 * ppm, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#d97706"; ctx.beginPath(); ctx.moveTo(X(ts), Y(edge - 0.6)); ctx.arc(X(ts), Y(edge - 0.6), 0.32 * ppm, 0, Math.PI / 3); ctx.fill(); // Kuchenstück
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(X(ts + 0.15), Y(edge - 0.45), 0.1 * ppm, 0, Math.PI * 2); ctx.fill();          // Sahne
        }
      }
      // Wildschweine (von oben): Bache vorne, zwei gestreifte Frischlinge hinterher
      BOARS.forEach((b, bi) => {
        if (b.s < s0 - 3 || b.s > s1 + 3) return;
        for (let k = 2; k >= 0; k--) {
          const q = boarPos(b, tSec, k), sc = k ? 0.6 : 1, dq = dodgeY(`b${bi}`, q.s, q.y, "boar");
          ctx.save(); ctx.translate(X(q.s + (dq.away ? k * 0.4 : 0)), Y(dq.y)); ctx.rotate(q.dir > 0 ? Math.PI / 2 : -Math.PI / 2); ctx.scale(sc, sc);
          ctx.fillStyle = k ? "#a16207" : "#44291a"; ctx.beginPath(); ctx.ellipse(0, 0, 0.75 * ppm, 0.42 * ppm, 0, 0, Math.PI * 2); ctx.fill();
          if (k) { ctx.strokeStyle = "#fde68a"; ctx.lineWidth = 0.06 * ppm; for (const o of [-0.15, 0.15]) { ctx.beginPath(); ctx.moveTo(-0.5 * ppm, o * ppm); ctx.lineTo(0.5 * ppm, o * ppm); ctx.stroke(); } }
          ctx.fillStyle = k ? "#854d0e" : "#2b1a10"; ctx.beginPath(); ctx.ellipse(0.75 * ppm, 0, 0.32 * ppm, 0.25 * ppm, 0, 0, Math.PI * 2); ctx.fill(); // Kopf
          ctx.fillStyle = "#d6a587"; ctx.beginPath(); ctx.arc(1.02 * ppm, 0, 0.1 * ppm, 0, Math.PI * 2); ctx.fill(); // Rüssel
          ctx.restore();
        }
      });
      // Fußgänger:innen (von oben: Schultern + Kopf)
      PEDS.forEach((pd, pi) => {
        const q = pedPos(pd, tSec); if (!q.active || q.s < s0 - 2 || q.s > s1 + 2) return;
        const dq = dodgeY(`p${pi}`, q.s, q.y, "ped");
        ctx.save(); ctx.translate(X(q.s), Y(dq.y)); ctx.rotate(q.heading); ctx.scale(1.6, 1.6);
        const swing = Math.sin(tSec * 7 + pd.phase) * 0.18 * ppm;
        ctx.fillStyle = "#1f2937"; ctx.beginPath(); ctx.arc(swing, -0.14 * ppm, 0.11 * ppm, 0, Math.PI * 2); ctx.arc(-swing, 0.14 * ppm, 0.11 * ppm, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = pd.shirt; ctx.beginPath(); ctx.ellipse(0, 0, 0.2 * ppm, 0.36 * ppm, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = pd.hair; ctx.beginPath(); ctx.arc(0, 0, 0.17 * ppm, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
      CYCLISTS.forEach((cy, ci) => {
        if (!cycActive(cy, tSec)) return;
        const s = cycS(cy, tSec); if (s < s0 - 3 || s > s1 + 3) return;
        drawRider(ctx, R, X(s), Y(dodgeY(`c${ci}`, s, center(s) + cy.off, "cyc").y), cy.dir > 0 ? 0 : Math.PI, cy.look, cy.bike, 1, tSec * 7 + s);
      });
      for (const car of CARS) {
        if (!carActive(car, tSec)) continue;
        const s = carS(car, tSec); if (s < s0 - 5 || s > s1 + 5) continue;
        const x = X(s), y = Y(carY(car, s)), L = 4.4 * ppm, B = 1.9 * ppm;
        ctx.fillStyle = "rgba(0,0,0,.2)"; ctx.fillRect(x - L / 2 + 3, y - B / 2 + 3, L, B);
        ctx.fillStyle = car.color; ctx.beginPath(); ctx.roundRect(x - L / 2, y - B / 2, L, B, 0.5 * ppm); ctx.fill();
        ctx.fillStyle = "rgba(30,41,59,.75)"; ctx.fillRect(x + L * 0.12, y - B * 0.38, L * 0.18, B * 0.76); ctx.fillRect(x - L * 0.32, y - B * 0.36, L * 0.14, B * 0.72);
        if (!car.parked) { const fx = car.v >= 0 ? x + L / 2 - 2 : x - L / 2 - 1; ctx.fillStyle = "#fde047"; ctx.fillRect(fx, y - B * 0.4, 3, 4); ctx.fillRect(fx, y + B * 0.4 - 4, 3, 4); }
      }
      // Straßenbahn (weiß-blau), fährt auf den Schienen entgegen
      for (const [i, t0] of TRAM_TIMES.entries()) {
        if (!st.tramOn[i]) continue;
        const q = tramPos(t0, tSec); if (!q.active || q.s < s0 - TRAM_LEN || q.s > s1 + TRAM_LEN) continue;
        const L = TRAM_LEN * ppm, B = 2.5 * ppm, x = X(q.s), y = Y(q.y);
        ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(x - L / 2 + 4, y - B / 2 + 4, L, B);
        ctx.fillStyle = "#f8fafc"; ctx.beginPath(); ctx.roundRect(x - L / 2, y - B / 2, L, B, 0.8 * ppm); ctx.fill();
        ctx.fillStyle = "#1d4ed8"; ctx.fillRect(x - L / 2, y - B * 0.12, L, B * 0.24);
        for (let k = 0; k < 3; k++) { ctx.fillStyle = "#94a3b8"; ctx.fillRect(x - L / 2 + (k + 1) * (L / 4) - 2, y - B / 2, 4, B); }
        ctx.fillStyle = "#fde047"; ctx.fillRect(x - L / 2 - 1, y - B * 0.38, 3, 5); ctx.fillRect(x - L / 2 - 1, y + B * 0.38 - 5, 3, 5);
      }
      // Hängematte zwischen zwei Bäumen, optional mit Person drin
      const hammock = (hs: number, cy: number, color: string, look: AvatarLook | null, rope = 1, swing = 0) => {
        const a = cy - 2.9, b = cy + 2.9;
        for (const ty of [a, b]) {
          ctx.fillStyle = "#713f12"; ctx.beginPath(); ctx.arc(X(hs), Y(ty), 0.35 * ppm, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "rgba(22,101,52,.85)"; ctx.beginPath(); ctx.arc(X(hs + 0.3), Y(ty + (ty < cy ? -0.8 : 0.8)), 1.7 * ppm, 0, Math.PI * 2); ctx.fill();
        }
        if (rope <= 0) return;
        ctx.strokeStyle = "#fef3c7"; ctx.lineWidth = 0.08 * ppm;
        ctx.beginPath(); ctx.moveTo(X(hs), Y(a)); ctx.lineTo(X(hs), Y(a + (b - a) * Math.min(1, rope))); ctx.stroke();
        if (rope < 1) return;
        const x0 = hs + swing;
        ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(X(x0), Y(cy), 0.75 * ppm, 2.2 * ppm, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.lineWidth = 0.06 * ppm;
        for (const k of [-0.4, 0, 0.4]) { ctx.beginPath(); ctx.moveTo(X(x0 + k), Y(cy - 2)); ctx.lineTo(X(x0 + k), Y(cy + 2)); ctx.stroke(); }
        if (!look) return;
        ctx.fillStyle = look.pants; ctx.fillRect(X(x0) - 0.18 * ppm, Y(cy + 0.2), 0.36 * ppm, 1.3 * ppm);
        ctx.fillStyle = look.topColor; ctx.beginPath(); ctx.ellipse(X(x0), Y(cy - 0.35), 0.32 * ppm, 0.6 * ppm, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = look.skin; ctx.beginPath(); ctx.arc(X(x0), Y(cy - 1.15), 0.24 * ppm, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = look.hairColor; ctx.beginPath(); ctx.arc(X(x0), Y(cy - 1.25), 0.24 * ppm, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
      };
      // Die anderen warten schon in ihren Hängematten (schaukeln, wenn du ankommst)
      if (s1 > LEN + HAMMOCK_S - 8) {
        const cyB = center(LEN);
        for (const c of crew.current) hammock(LEN + HAMMOCK_S + c.row, cyB + c.lat, c.color, c.look, 1, st.done ? Math.sin(performance.now() / 260 + c.phase) * 0.25 : 0);
      }
      // Am Cossi: deine Hängematte in der Mitte – sie wird nach der Ankunft aufgehängt
      if (s1 > LEN + HAMMOCK_S - 8) {
        const cy = center(LEN);
        hammock(LEN + HAMMOCK_S, cy, myBike.current.color, st.hammock > 1.1 ? myLook.current : null, st.hammock > 0 ? st.hammock / 0.9 : 0);
        if (st.hammock > 0) drawRider(ctx, R, X(LEN + HAMMOCK_S - 5), Y(cy + 3.4), Math.PI / 2, EMPTY_LOOK, myBike.current, 1, 0); // abgestelltes Rad
      }
      // Geist & Fahrer
      const g = ghostAt(Math.max(0, st.t));
      if (g) drawRider(ctx, R, X(g.s), Y(g.y), 0, ghostLook.current ?? myLook.current, ghostBike.current, 0.45, st.t / 160);
      if (!st.hammock) drawRider(ctx, R, X(st.s), Y(st.y), st.heading, myLook.current, myBike.current, 1, st.pedal);
      if (brake && !st.done && st.t > 0) { ctx.fillStyle = "#ef4444"; ctx.beginPath(); ctx.arc(X(st.s) - 1.1 * ppm, Y(st.y), 0.18 * ppm, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      if (st.t < 0) { ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.round(H / 4)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(Math.ceil(-st.t / 1000)), W / 2, H / 2); }
      // Michas Sprechblase (nur am Anfang)
      if (st.t < 5000 && 4 > s0 - 3) {
        const mx = W / 2 + (center(4) + width(4) / 2 + 0.9 - st.camY) * ppm, my = ahead - (4 - st.s) * ppm;
        const name = myName.current ? `, ${myName.current}` : "";
        const text = `Gute Fahrt${name}! 👋`;
        ctx.font = `bold ${Math.round(ppm * 0.85)}px system-ui`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        const tw = ctx.measureText(text).width, bx = Math.min(W - tw - 24, mx + ppm * 0.8), by = my - ppm * 2.2;
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(bx, by - ppm * 0.75, tw + 20, ppm * 1.5, ppm * 0.5); ctx.fill();
        ctx.beginPath(); ctx.moveTo(bx + 10, by + ppm * 0.7); ctx.lineTo(mx, my - ppm * 0.5); ctx.lineTo(bx + 30, by + ppm * 0.7); ctx.fill();
        ctx.fillStyle = "#111827"; ctx.fillText(text, bx + 10, by);
        ctx.font = `bold ${Math.round(ppm * 0.55)}px system-ui`; ctx.fillStyle = "#fff"; ctx.textAlign = "center";
        ctx.fillText("Micha", mx, my + ppm * 1.1);
      }
      // Die anderen jubeln dir am Ziel zu
      if (st.s > LEN - 25 && crew.current.length) {
        const cheers = ["Juhu! 🎉", "Endlich! 🥳", "Bravo! 👏", "Da bist du ja! 😎", "Komm in die Hängematte! 🌴", "Prost! 🍻"];
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        crew.current.forEach((c, k) => {
          const hs = LEN + HAMMOCK_S + c.row, cy = center(LEN) + c.lat;
          const sx = W / 2 + (cy - st.camY) * ppm, sy = ahead - (hs - st.s) * ppm - 2.4 * ppm;
          if (sx < -60 || sx > W + 60 || sy < -40 || sy > H + 40) return;
          const text = k === 0 && myName.current ? `Juhu, ${myName.current}! 🎉` : cheers[k % cheers.length];
          const bounce = Math.sin(performance.now() / 180 + c.phase) * 3;
          ctx.font = `bold ${Math.round(ppm * 0.62)}px system-ui`;
          const tw = ctx.measureText(text).width;
          ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.beginPath(); ctx.roundRect(sx - tw / 2 - 8, sy - ppm * 0.55 + bounce, tw + 16, ppm * 1.1, ppm * 0.4); ctx.fill();
          ctx.fillStyle = "#111827"; ctx.fillText(text, sx, sy + bounce);
          ctx.font = `bold ${Math.round(ppm * 0.5)}px system-ui`; ctx.fillStyle = "#78350f";
          ctx.fillText(c.name, sx, ahead - (hs - st.s) * ppm + 2.9 * ppm);
        });
      }
      // Schild „Brot und Kees“
      const cmid = (CAFE_FROM + CAFE_TO) / 2;
      if (cmid > s0 - 4 && cmid < s1 + 4) {
        const sx = W / 2 + (center(cmid) + width(cmid) / 2 + 5.7 - st.camY) * ppm, sy = ahead - (cmid - st.s) * ppm;
        ctx.font = `bold ${Math.round(ppm * 0.8)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const label = "☕ BROT UND KEES", tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(21,128,61,.9)"; ctx.fillRect(sx - tw / 2 - 6, sy - ppm * 0.7, tw + 12, ppm * 1.4);
        ctx.fillStyle = "#fef3c7"; ctx.fillText(label, sx, sy);
      }
      // Schild „TREUHAND“ (nach dem Zurückdrehen, damit es lesbar ist)
      const mid = (TREU_FROM + TREU_TO) / 2;
      if (mid > s0 - 4 && mid < s1 + 4) {
        const sx = W / 2 + (center(mid) + width(mid) / 2 + 5.4 - st.camY) * ppm, sy = ahead - (mid - st.s) * ppm;
        ctx.font = `bold ${Math.round(ppm * 0.9)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const tw = ctx.measureText("🍺 TREUHAND").width;
        ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillRect(sx - tw / 2 - 6, sy - ppm * 0.7, tw + 12, ppm * 1.4);
        ctx.fillStyle = "#fde047"; ctx.fillText("🍺 TREUHAND", sx, sy);
      }
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
      if (e.key === " ") ctl.current.brakeKey = true;
      if (e.key === "k" || e.key === "b") { if (ringsRef.current > 0) bellSound(); ctl.current.ringQueue++; }
    };
    const up = (e: KeyboardEvent) => { keys.delete(e.key); steer(); if (e.key === " ") ctl.current.brakeKey = false; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [leave]);

  // Bremshebel rechts: gedrückt halten = bremsen
  const brakeDown = (e: React.PointerEvent) => { e.preventDefault(); e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); ctl.current.brakeTouch.add(e.pointerId); setBraking(true); };
  const brakeUp = (e: React.PointerEvent) => { ctl.current.brakeTouch.delete(e.pointerId); setBraking(ctl.current.brakeTouch.size > 0); };

  const progress = Math.min(1, hud.s / LEN);
  // Direkt an die Seite hängen (nicht ins Spiel-Fenster), damit es wirklich den ganzen Bildschirm füllt
  return createPortal(
    <div className="fixed inset-0 z-[200] select-none bg-black text-left text-white" style={{ touchAction: "none" }}>
      <div ref={boxRef} className="absolute inset-0" onPointerDown={(e) => e.preventDefault()}
        role="application" aria-label="Radrennen: Handy neigen zum Lenken, Bremshebel rechts zum Bremsen">
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>
      {/* Klingel: linkes Lenkerende mit Glocke – antippen = klingeln (3× pro Fahrt) */}
      <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); if (ringsRef.current > 0) { bellSound(); } ctl.current.ringQueue++; }}
        className="absolute bottom-0 left-0 flex h-[42%] w-[38%] items-end justify-start" role="button" aria-label={`Klingel (noch ${ringsLeft}×)`}>
        <svg viewBox="0 0 260 130" className={`w-full max-w-[19rem] drop-shadow-xl transition ${ringsLeft ? "" : "opacity-50 grayscale"}`} aria-hidden>
          <rect x="120" y="78" width="160" height="18" rx="7" fill="#4b5563" />
          <rect x="10" y="70" width="118" height="34" rx="16" fill="#111827" />
          {[0, 1, 2, 3, 4, 5, 6].map((k) => <rect key={k} x={22 + k * 14} y="72" width="5" height="30" rx="2" fill="#1f2937" />)}
          {/* Glocke */}
          <rect x="150" y="66" width="12" height="16" rx="3" fill="#374151" />
          <circle cx="170" cy="50" r="30" fill="url(#bellGrad)" stroke="#6b7280" strokeWidth="2" />
          <circle cx="170" cy="50" r="8" fill="#9ca3af" />
          <path d="M150 66 L 132 58" stroke="#6b7280" strokeWidth="6" strokeLinecap="round" />
          <defs><radialGradient id="bellGrad" cx="40%" cy="35%" r="70%"><stop offset="0%" stopColor="#ffffff" /><stop offset="60%" stopColor="#d1d5db" /><stop offset="100%" stopColor="#9ca3af" /></radialGradient></defs>
        </svg>
        <span className={`pointer-events-none absolute bottom-2 left-3 rounded-lg px-2 py-0.5 text-[11px] font-bold ${ringsLeft ? "bg-amber-500" : "bg-black/45"}`}>🔔 {ringsLeft}×</span>
      </div>
      {/* Bremse: rechtes Lenkerende von oben gesehen – Griff mit Bremshebel davor. Drücken = Hebel an den Griff ziehen */}
      <div onPointerDown={brakeDown} onPointerUp={brakeUp} onPointerCancel={brakeUp} onPointerLeave={brakeUp}
        className="absolute bottom-0 right-0 flex h-[46%] w-[44%] items-end justify-end" role="button" aria-label="Bremse (gedrückt halten)" aria-pressed={braking}>
        <svg viewBox="0 0 300 130" className="w-full max-w-[22rem] drop-shadow-xl" aria-hidden>
          {/* Lenkerrohr kommt von links (Lenkermitte) */}
          <rect x="-10" y="78" width="170" height="18" rx="7" fill="#4b5563" />
          <rect x="-10" y="80" width="170" height="4" fill="#9ca3af" opacity=".5" />
          {/* Schalthebel-/Bremsschelle */}
          <rect x="130" y="66" width="30" height="42" rx="6" fill="#1f2937" />
          {/* Bremszug */}
          <path d="M138 66 C 120 30, 70 30, 40 10" fill="none" stroke="#111827" strokeWidth="5" strokeLinecap="round" />
          {/* Griff (Gummi mit Rillen) */}
          <rect x="158" y="70" width="128" height="34" rx="16" fill="#111827" />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => <rect key={k} x={172 + k * 14} y="72" width="5" height="30" rx="2" fill="#1f2937" />)}
          {/* Bremshebel: dreht sich beim Drücken zum Griff */}
          <g style={{ transform: `rotate(${braking ? 7 : 0}deg)`, transformOrigin: "146px 62px", transition: "transform 70ms" }}>
            <circle cx="146" cy="62" r="9" fill="#6b7280" />
            <path d="M146 54 C 190 40, 240 38, 282 46 L 284 60 C 240 52, 192 54, 150 70 Z" fill={braking ? "#ef4444" : "#d1d5db"} stroke="#4b5563" strokeWidth="2.5" />
            <circle cx="283" cy="53" r="7" fill={braking ? "#b91c1c" : "#9ca3af"} />
          </g>
        </svg>
        <span className={`pointer-events-none absolute bottom-2 right-3 rounded-lg px-2 py-0.5 text-[11px] font-bold ${braking ? "bg-red-600" : "bg-black/45"}`}>BREMSE</span>
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
          <span className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-xl bg-black/55 px-3 py-2 text-center text-xs">
            🚴 Du fährst von selbst · Bremshebel rechts halten = bremsen<br />
            {hasTilt ? "📱 Handy neigen = lenken" : "Pfeiltasten lenken · Leertaste bremst"}
          </span>
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
