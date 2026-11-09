"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { GameScore, Member } from "@/lib/types";
import { AvatarFigure, lookOf } from "./avatar";
import { Leaderboard } from "./Leaderboard";

/**
 * Minispiel: Kitesurfen im Jump-&-Run-Stil.
 * Tippen = springen, gedrückt halten = höher, in der Luft nochmal tippen = Kite-Boost.
 * Steine, Bojen und Haie ausweichen, Sterne und Muscheln einsammeln, lange Sprünge geben Trick-Punkte.
 */

const H = 300;            // Höhe der Spielfläche (CSS-Pixel)
const SEA = 228;          // Wasserlinie
const GRAVITY = 1500;
const JUMP_V = 560;
const HOLD_GRAVITY = 0.62; // gedrückt halten → Kite zieht nach oben
const BOOST_V = 430;
const FIG = 38;           // Größe der Figur

type Obj = {
  kind: "stein" | "boje" | "hai" | "moewe" | "stern" | "muschel" | "welle";
  x: number; y: number; w: number; h: number; vx?: number; done?: boolean;
};
type Floater = { x: number; y: number; text: string; t: number };
type Splash = { x: number; y: number; vx: number; vy: number; t: number };


/**
 * Spielobjekte selbst gezeichnet (keine Emojis im Canvas – manche Handys zeichnen die einfarbig).
 * Kräftige Farben + dunkler Rand, damit alles vor Himmel und Meer gut sichtbar ist.
 * (x, y) = Mitte unten des Objekts.
 */
const OUTLINE = "#1f2937";
function drawObj(ctx: CanvasRenderingContext2D, o: Obj, t: number) {
  const { x, y } = o;
  ctx.save();
  ctx.lineWidth = 2; ctx.strokeStyle = OUTLINE; ctx.lineJoin = "round";
  switch (o.kind) {
    case "stein": {
      ctx.fillStyle = "#8b8f98";
      ctx.beginPath(); ctx.moveTo(x - 17, y + 4); ctx.lineTo(x - 13, y - 12); ctx.lineTo(x - 3, y - 20); ctx.lineTo(x + 9, y - 17);
      ctx.lineTo(x + 17, y - 6); ctx.lineTo(x + 18, y + 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#c3c7cf"; ctx.beginPath(); ctx.moveTo(x - 9, y - 11); ctx.lineTo(x - 2, y - 16); ctx.lineTo(x + 5, y - 13); ctx.closePath(); ctx.fill();
      break;
    }
    case "boje": {
      // rot-weiß gestreifte Tonne mit Fähnchen
      ctx.beginPath(); ctx.moveTo(x - 12, y + 3); ctx.lineTo(x - 9, y - 22); ctx.lineTo(x + 9, y - 22); ctx.lineTo(x + 12, y + 3); ctx.closePath();
      ctx.fillStyle = "#ef4444"; ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = "#ffffff"; ctx.fillRect(x - 14, y - 14, 28, 6); ctx.restore();
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.lineTo(x, y - 34); ctx.stroke();
      ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.moveTo(x, y - 34); ctx.lineTo(x + 10, y - 30); ctx.lineTo(x, y - 26); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case "hai": {
      // Rückenflosse, die durchs Wasser schneidet
      ctx.fillStyle = "#475569";
      ctx.beginPath(); ctx.moveTo(x - 14, y + 1); ctx.quadraticCurveTo(x - 4, y - 8, x + 2, y - 26); ctx.quadraticCurveTo(x + 6, y - 10, x + 15, y + 1); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.moveTo(x - 20, y + 2); ctx.quadraticCurveTo(x, y - 3, x + 20, y + 2); ctx.stroke();
      break;
    }
    case "moewe": {
      // weiße Möwe mit schlagenden Flügeln
      const flap = Math.sin(t * 12) * 6;
      ctx.fillStyle = "#ffffff"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x - 16, y - 10 - flap); ctx.quadraticCurveTo(x - 8, y - 18, x, y - 10); ctx.quadraticCurveTo(x + 8, y - 18, x + 16, y - 10 - flap); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y - 9, 7, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#f97316"; ctx.beginPath(); ctx.moveTo(x - 7, y - 10); ctx.lineTo(x - 12, y - 8); ctx.lineTo(x - 7, y - 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = OUTLINE; ctx.beginPath(); ctx.arc(x - 4, y - 10, 1.2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "stern": {
      const cy = y - 11, R = 12, rr = 5.2, rot = Math.sin(t * 3 + x / 40) * 0.15;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + rot + (i * Math.PI) / 5, rad = i % 2 ? rr : R;
        ctx.lineTo(x + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      }
      ctx.closePath(); ctx.fillStyle = "#facc15"; ctx.fill(); ctx.strokeStyle = "#b45309"; ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.beginPath(); ctx.arc(x - 3, cy - 3, 2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "muschel": {
      // Fächermuschel
      ctx.fillStyle = "#fb7185";
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, 12, Math.PI * 1.08, Math.PI * 1.92); ctx.closePath(); ctx.fill(); ctx.strokeStyle = "#9f1239"; ctx.stroke();
      ctx.lineWidth = 1.2;
      for (let i = 1; i < 5; i++) { const a = Math.PI * (1.08 + i * 0.168); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12); ctx.stroke(); }
      break;
    }
    default: break;
  }
  ctx.restore();
}

/** Zackiger Knall beim Zusammenstoß */
function drawCrash(ctx: CanvasRenderingContext2D, x: number, y: number, k: number) {
  ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k);
  ctx.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i * Math.PI) / 8, rad = (i % 2 ? 10 : 24) * (1 + k * 0.6); ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
  ctx.closePath(); ctx.fillStyle = "#fde047"; ctx.fill(); ctx.strokeStyle = "#dc2626"; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();
}
const POINTS: Partial<Record<Obj["kind"], number>> = { stern: 10, muschel: 5 };
const BAD: Obj["kind"][] = ["stein", "boje", "hai", "moewe"];

export function KiteGame({ onResult }: { onResult?: (score: number, best: boolean) => void }) {
  const { members, myId } = useWG();
  const riders = [...members].sort((a, b) => a.sort - b.sort).filter((m) => m.sort === 0 || m.sort === 1);
  const pickable = riders.length ? riders : [...members].sort((a, b) => a.sort - b.sort).slice(0, 2);
  // Nur die Person merken – der Look kommt immer frisch aus der WG (= wie im WG-Spiel gerade angezogen)
  const [riderId, setRiderId] = useState<string | null>(null);
  const rider = members.find((m) => m.id === riderId) ?? null;
  const [phase, setPhase] = useState<"wahl" | "spiel" | "ende">("wahl");
  const [result, setResult] = useState<{ score: number; stars: number; tricks: number; best: boolean } | null>(null);
  const { rows: scores, reload: reloadScores } = useRows<GameScore>("game_scores", "best", false);
  const kiteScores = scores.filter((s) => s.game === "kite");
  const myBest = kiteScores.find((s) => s.member_id === myId)?.best ?? 0;
  const [dbErr, setDbErr] = useState<string | null>(null);

  const finish = useCallback((score: number, stars: number, tricks: number) => {
    const best = score > myBest;
    setResult({ score, stars, tricks, best });
    setPhase("ende");
    if (score > 0) supabase.rpc("submit_score", { p_game: "kite", p_score: score }).then(({ error }) => {
      setDbErr(error ? (/game_scores|submit_score|check constraint/i.test(error.message)
        ? "Rekord konnte nicht gespeichert werden: Bitte supabase/014_bestenliste.sql und 017_kite.sql im SQL Editor ausführen."
        : `Rekord konnte nicht gespeichert werden: ${error.message}`) : null);
      reloadScores();
    });
    onResult?.(score, best);
  }, [myBest, onResult, reloadScores]);

  if (phase === "spiel" && rider) return <KiteRun rider={rider} onOver={finish} />;

  if (phase === "ende" && result && rider) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-5xl">{result.best ? "🏆" : "🌊"}</p>
        <p className="text-3xl font-bold tabular-nums">{result.score} Punkte</p>
        {result.best && <p className="font-semibold text-amber-600">Neuer Rekord!</p>}
        <p className="text-sm text-muted">⭐ {result.stars} eingesammelt · 🌀 {result.tricks} Tricks · gefahren als {rider.display_name}</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setPhase("spiel")} className="rounded-2xl bg-accent py-3 font-semibold text-white">Nochmal</button>
          <button onClick={() => setPhase("wahl")} className="rounded-2xl border border-line py-3 font-semibold">Andere Figur</button>
        </div>
        <Leaderboard scores={kiteScores} error={dbErr} />
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <p className="text-5xl">🪁🏄</p>
      <p className="font-semibold">Wer geht aufs Wasser?</p>
      <div className="grid grid-cols-2 gap-3">
        {pickable.map((m) => (
          <button key={m.id} onClick={() => setRiderId(m.id)}
            className={`flex flex-col items-center gap-1 rounded-2xl border-2 p-3 transition active:scale-[.98] ${riderId === m.id ? "border-accent bg-accent/10" : "border-line"}`}>
            <AvatarFigure look={lookOf(m)} size={56} />
            <span className="font-semibold">{m.display_name}</span>
          </button>
        ))}
      </div>
      <button disabled={!rider} onClick={() => setPhase("spiel")}
        className="w-full rounded-2xl bg-accent py-3 text-lg font-semibold text-white active:scale-[.98] disabled:opacity-40">
        {rider ? `Los geht's mit ${rider.display_name}!` : "Erst Figur wählen"}
      </button>
      <p className="text-xs text-muted">Beide tragen, was sie im WG-Spiel gerade anhaben. Der Rekord zählt für dich – egal, wen du steuerst.</p>
      <Leaderboard scores={kiteScores} error={dbErr} />
      <ul className="mx-auto max-w-xs space-y-1 text-left text-sm text-muted">
        <li>👆 <b>Tippen</b> = springen · <b>gedrückt halten</b> = höher</li>
        <li>🪁 In der Luft nochmal tippen = <b>Kite-Boost</b></li>
        <li>⭐ 10 · 🐚 5 Punkte · 🌊 Welle = Rampe · lange Sprünge = Trick-Bonus</li>
        <li>💥 Nicht gegen 🪨 🛟 🦈 oder 🐦 knallen!</li>
      </ul>
    </div>
  );
}

/** Das eigentliche Spiel: Canvas für Meer/Kite/Hindernisse, die Figur als echter Avatar darüber */
function KiteRun({ rider, onOver }: { rider: Member; onOver: (score: number, stars: number, tricks: number) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const figRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLSpanElement>(null);
  const press = useRef({ down: false, tapped: false });
  const look = lookOf(rider);
  // Ergebnis-Callback per Ref – sonst würde das Spiel neu starten, wenn sich die Bestenliste live ändert
  const overRef = useRef(onOver);
  useEffect(() => { overRef.current = onOver; }, [onOver]);
  // Farbe per Ref: zieht sich jemand während der Runde um, ändert sich der Look, ohne dass das Spiel neu startet
  const colorRef = useRef(rider.color);
  useEffect(() => { colorRef.current = rider.color; }, [rider.color]);

  useEffect(() => {
    const canvas = canvasRef.current!, wrap = wrapRef.current!, fig = figRef.current!;
    const ctx = canvas.getContext("2d")!;
    let W = wrap.clientWidth;
    const resize = () => {
      W = wrap.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap);

    const st = {
      y: SEA, vy: 0, onWater: true, boosted: false, spin: 0, airT: 0,
      speed: 230, dist: 0, score: 0, stars: 0, tricks: 0, t: 0, nextSpawn: 1.2, over: false, overT: 0,
      objs: [] as Obj[], floats: [] as Floater[], splash: [] as Splash[],
    };
    const X = () => Math.round(W * 0.24);
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);

    function spawn() {
      const x0 = W + 30;
      const r = Math.random();
      const level = Math.min(1, st.t / 60); // wird mit der Zeit schwerer
      if (r < 0.22) st.objs.push({ kind: "stein", x: x0, y: SEA, w: 30, h: 22 });
      else if (r < 0.36) st.objs.push({ kind: "boje", x: x0, y: SEA, w: 26, h: 26 });
      else if (r < 0.46 + level * 0.06) st.objs.push({ kind: "hai", x: x0, y: SEA, w: 34, h: 24, vx: -rnd(40, 90) });
      else if (r < 0.56 + level * 0.08) st.objs.push({ kind: "moewe", x: x0, y: SEA - rnd(120, 175), w: 28, h: 20, vx: -rnd(60, 120) });
      else if (r < 0.72) {
        // Sternenbogen über einem Sprung
        const n = 3 + Math.floor(Math.random() * 3), top = rnd(70, 150);
        for (let i = 0; i < n; i++) {
          const p = n === 1 ? 0.5 : i / (n - 1);
          st.objs.push({ kind: "stern", x: x0 + i * 34, y: SEA - 18 - Math.sin(p * Math.PI) * top, w: 22, h: 22 });
        }
      } else if (r < 0.84) {
        for (let i = 0; i < 3; i++) st.objs.push({ kind: "muschel", x: x0 + i * 40, y: SEA - 6, w: 20, h: 18 });
      } else {
        st.objs.push({ kind: "welle", x: x0, y: SEA, w: 64, h: 26 });
        st.objs.push({ kind: "stern", x: x0 + 150, y: SEA - 200, w: 22, h: 22 });
      }
      const gap = rnd(0.75, 1.45) * (1 - level * 0.3);
      st.nextSpawn = st.t + gap;
    }

    const jump = (v: number) => { st.vy = -v; st.onWater = false; st.boosted = false; st.airT = 0; };
    const float = (text: string, x: number, y: number) => st.floats.push({ text, x: Math.max(60, Math.min(W - 60, x)), y: Math.max(52, y), t: 0 });

    let last = performance.now(), raf = 0;
    function frame(now: number) {
      const dt = Math.min(0.033, (now - last) / 1000); last = now;
      const x = X();
      if (!st.over) {
        st.t += dt;
        st.speed = Math.min(430, 230 + st.t * 4);
        st.dist += st.speed * dt;

        // Steuerung
        if (press.current.tapped) {
          press.current.tapped = false;
          if (st.onWater) jump(JUMP_V);
          else if (!st.boosted) { st.vy = Math.min(st.vy, -BOOST_V); st.boosted = true; float("Boost!", x, st.y - 50); }
        }
        // Physik
        if (!st.onWater) {
          const g = press.current.down && st.vy < 0 ? GRAVITY * HOLD_GRAVITY : GRAVITY;
          st.vy += g * dt; st.y += st.vy * dt; st.airT += dt;
          st.y = Math.max(42, st.y);
          if (st.boosted) st.spin = Math.min(360, st.spin + 720 * dt);
          if (st.y >= SEA) {
            st.y = SEA; st.vy = 0; st.onWater = true;
            if (st.airT > 1.1) { st.score += 25; st.tricks++; float("Kiteloop! +25", x, SEA - 60); }
            else if (st.airT > 0.75) { st.score += 10; st.tricks++; float("Jump! +10", x, SEA - 60); }
            for (let i = 0; i < 8; i++) st.splash.push({ x, y: SEA, vx: rnd(-120, 40), vy: rnd(-200, -60), t: 0 });
            st.spin = 0;
          }
        }
        // Hindernisse & Sammelsachen
        if (st.t >= st.nextSpawn) spawn();
        const hit = { l: x - 11, r: x + 11, t: st.y - FIG * 1.1, b: st.y - 2 };
        for (const o of st.objs) {
          o.x -= (st.speed - (o.vx ?? 0)) * dt; // vx < 0: kommt einem zusätzlich entgegen
          if (o.done) continue;
          const ol = o.x - o.w / 2, or = o.x + o.w / 2, ot = o.y - o.h, ob = o.y;
          const overlap = hit.l < or && hit.r > ol && hit.t < ob && hit.b > ot;
          if (!overlap) continue;
          if (o.kind === "welle") { if (st.onWater) { jump(JUMP_V * 1.25); float("Rampe!", x, SEA - 40); } o.done = true; }
          else if (BAD.includes(o.kind)) {
            // etwas Gnade: nur echte Treffer zählen
            const core = hit.l + 4 < or - 4 && hit.r - 4 > ol + 4 && hit.t + 4 < ob - 2 && hit.b - 2 > ot + 4;
            if (core) { st.over = true; st.overT = 0; }
          } else {
            o.done = true;
            const pts = POINTS[o.kind] ?? 0;
            st.score += pts; if (o.kind === "stern") st.stars++;
            float(`+${pts}`, o.x, o.y - 20);
          }
        }
        st.objs = st.objs.filter((o) => o.x > -80 && !(o.done && o.kind !== "welle"));
        if (st.onWater && Math.random() < 0.5) st.splash.push({ x: x - 14, y: SEA, vx: rnd(-160, -60), vy: rnd(-90, -20), t: 0 });
      } else {
        st.overT += dt;
        if (st.overT > 1.1) { cancelAnimationFrame(raf); overRef.current(Math.round(st.score + st.dist / 25), st.stars, st.tricks); return; }
      }
      for (const f of st.floats) f.t += dt;
      st.floats = st.floats.filter((f) => f.t < 1);
      for (const p of st.splash) { p.t += dt; p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
      st.splash = st.splash.filter((p) => p.t < 0.6);

      draw(x);
      const total = Math.round(st.score + st.dist / 25);
      if (hudRef.current) hudRef.current.textContent = `${total} Punkte`;
      // Figur (echter Avatar) über dem Canvas bewegen
      const tilt = st.onWater ? -8 : Math.max(-25, Math.min(25, st.vy * 0.03));
      fig.style.transform = `translate(${x - FIG / 2}px, ${st.y - FIG * 1.25 - 3}px) rotate(${(st.over ? 70 : tilt) + st.spin}deg)`;
      raf = requestAnimationFrame(frame);
    }

    function draw(x: number) {
      // Himmel
      const sky = ctx.createLinearGradient(0, 0, 0, SEA);
      sky.addColorStop(0, "#7cc4f5"); sky.addColorStop(1, "#d8f0ff");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, SEA);
      // Sonne & Wolken
      ctx.fillStyle = "#ffe27a"; ctx.beginPath(); ctx.arc(W - 46, 44, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.85)";
      for (let i = 0; i < 3; i++) {
        const cx = ((i * 260 - st.dist * 0.15) % (W + 200) + W + 200) % (W + 200) - 100, cy = 50 + i * 28;
        ctx.beginPath(); ctx.ellipse(cx, cy, 34, 11, 0, 0, Math.PI * 2); ctx.ellipse(cx + 22, cy - 6, 20, 10, 0, 0, Math.PI * 2); ctx.fill();
      }
      // Meer
      const sea = ctx.createLinearGradient(0, SEA, 0, H);
      sea.addColorStop(0, "#2a9fd6"); sea.addColorStop(1, "#11618f");
      ctx.fillStyle = sea;
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let px = 0; px <= W + 8; px += 8) ctx.lineTo(Math.min(px, W), SEA + Math.sin((Math.min(px, W) + st.dist) / 38) * 3);
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 2;
      for (let row = 0; row < 3; row++) {
        ctx.beginPath();
        for (let px = 0; px <= W; px += 6) ctx.lineTo(px, SEA + 18 + row * 18 + Math.sin((px + st.dist * (1 - row * 0.2)) / 22 + row) * 2);
        ctx.stroke();
      }
      // Objekte
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      for (const o of st.objs) {
        if (o.kind === "welle") {
          ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#0e7490"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(o.x - o.w / 2, SEA); ctx.quadraticCurveTo(o.x + 4, SEA - o.h * 1.6, o.x + o.w / 2, SEA); ctx.fill(); ctx.stroke();
          ctx.fillStyle = "#2a9fd6";
          ctx.beginPath(); ctx.moveTo(o.x - o.w / 2 + 10, SEA); ctx.quadraticCurveTo(o.x + 4, SEA - o.h * 1.1, o.x + o.w / 2 - 6, SEA); ctx.fill();
          continue;
        }
        drawObj(ctx, o, st.t);
      }
      // Kite + Leinen
      const kx = x + 70 + Math.sin(st.t * 1.6) * 8, ky = Math.max(26, st.y - 150 + Math.sin(st.t * 2.1) * 6);
      const hx = x + 6, hy = st.y - FIG * 0.75;
      ctx.strokeStyle = "rgba(30,30,30,.55)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx - 30, ky + 6); ctx.moveTo(hx, hy); ctx.lineTo(kx + 30, ky + 6); ctx.stroke();
      ctx.fillStyle = colorRef.current;
      ctx.beginPath(); ctx.moveTo(kx - 34, ky + 8); ctx.quadraticCurveTo(kx, ky - 30, kx + 34, ky + 8); ctx.quadraticCurveTo(kx, ky - 10, kx - 34, ky + 8); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(kx - 26, ky + 2); ctx.quadraticCurveTo(kx, ky - 22, kx + 26, ky + 2); ctx.stroke();
      // Board unter den Füßen
      ctx.save(); ctx.translate(x, st.y - 1); ctx.rotate(((st.onWater ? -8 : Math.max(-25, Math.min(25, st.vy * 0.03))) + st.spin) * Math.PI / 180);
      ctx.fillStyle = "#fafafa"; ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(-20, -3, 40, 6, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = colorRef.current; ctx.fillRect(-6, -3, 12, 6);
      ctx.restore();
      // Gischt
      ctx.fillStyle = "rgba(255,255,255,.9)";
      for (const p of st.splash) { ctx.globalAlpha = 1 - p.t / 0.6; ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      // Punkte-Texte
      if (st.over) drawCrash(ctx, x + 6, st.y - 24, st.overT);
      // Punkte-Texte: dunkle Schrift mit weißem Rand – auf Himmel und Meer lesbar
      ctx.font = "800 16px system-ui, sans-serif"; ctx.lineJoin = "round";
      for (const f of st.floats) {
        ctx.globalAlpha = 1 - f.t;
        ctx.lineWidth = 4; ctx.strokeStyle = "#ffffff"; ctx.strokeText(f.text, f.x, f.y - f.t * 30);
        ctx.fillStyle = "#0f172a"; ctx.fillText(f.text, f.x, f.y - f.t * 30);
      }
      ctx.globalAlpha = 1;
    }

    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [rider.id]);

  // Steuerung: Finger, Maus, Leertaste / Pfeil hoch
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "ArrowUp" || e.key === "w") { e.preventDefault(); if (!press.current.down) press.current.tapped = true; press.current.down = true; }
    };
    const up = (e: KeyboardEvent) => { if (e.key === " " || e.key === "ArrowUp" || e.key === "w") press.current.down = false; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">🏄 {rider.display_name}</span>
        <span ref={hudRef} className="font-bold tabular-nums">0 Punkte</span>
      </div>
      <div ref={wrapRef} className="relative touch-none select-none overflow-hidden rounded-2xl" style={{ height: H }}
        onPointerDown={(e) => { e.preventDefault(); press.current.tapped = true; press.current.down = true; }}
        onPointerUp={() => { press.current.down = false; }} onPointerCancel={() => { press.current.down = false; }} onPointerLeave={() => { press.current.down = false; }}
        role="application" aria-label="Kitesurf-Spiel: tippen zum Springen">
        <canvas ref={canvasRef} className="absolute inset-0" />
        <div ref={figRef} className="pointer-events-none absolute left-0 top-0 origin-bottom will-change-transform" style={{ width: FIG }}>
          <AvatarFigure look={look} size={FIG} />
        </div>
      </div>
      <p className="text-center text-xs text-muted">Tippen = springen · halten = höher · in der Luft tippen = Boost</p>
    </div>
  );
}
