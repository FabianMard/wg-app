"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWG } from "@/lib/wg";
import { Leaderboard } from "./Leaderboard";
import { useGameScore } from "./useGameScore";

/**
 * Minispiel „Lastenrad“: Von hinten gesehen, voll beladen nach Hause. Das Rad kippt von allein –
 * links/rechts gedrückt halten, um gegenzulenken. Schlaglöcher, Bordsteine und Schienen geben Stöße zur Seite.
 * Kippt es zu weit, rutscht Ladung von oben herunter. Kippt es ganz: Sturz.
 */

const COURSE_M = 500;
const H = 380;
type Cargo = { name: string; value: number; tol: number; w: number; h: number; color: string; draw: "kiste" | "brett" | "pflanze" | "pizza" | "lampe" };
const CARGO: Cargo[] = [
  { name: "Bierkasten", value: 30, tol: 0.62, w: 46, h: 30, color: "#b45309", draw: "kiste" },
  { name: "IKEA-Regal", value: 40, tol: 0.5, w: 74, h: 10, color: "#d6b98c", draw: "brett" },
  { name: "Verenas Monstera", value: 25, tol: 0.42, w: 34, h: 40, color: "#16a34a", draw: "pflanze" },
  { name: "Pizza", value: 20, tol: 0.36, w: 40, h: 8, color: "#f59e0b", draw: "pizza" },
  { name: "Stehlampe", value: 15, tol: 0.3, w: 12, h: 42, color: "#fde047", draw: "lampe" },
];
type Obstacle = { z: number; side: -1 | 1; kind: "loch" | "bordstein" | "schiene"; hit: boolean };
const OBST = {
  loch: { label: "Schlagloch", kick: 0.75 },
  bordstein: { label: "Bordstein", kick: 1.15 },
  schiene: { label: "Schienen", kick: 0.95 },
} as const;

export function BikeBalance({ onResult }: { onResult?: (score: number, best: boolean) => void }) {
  const { scores, myBest, submit, dbErr } = useGameScore("lastenrad");
  const [phase, setPhase] = useState<"start" | "spiel" | "ende">("start");
  const [result, setResult] = useState<{ score: number; meters: number; kept: string[]; lost: string[]; finished: boolean; best: boolean } | null>(null);

  const finish = useCallback((meters: number, kept: string[], lost: string[], finished: boolean) => {
    const value = CARGO.filter((c) => kept.includes(c.name)).reduce((s, c) => s + c.value, 0);
    const score = Math.round(Math.min(meters, COURSE_M) / 5) + (finished ? value * 2 : 0);
    const best = score > myBest;
    setResult({ score, meters: Math.round(meters), kept, lost, finished, best });
    setPhase("ende");
    submit(score);
    onResult?.(score, best);
  }, [myBest, submit, onResult]);

  if (phase === "spiel") return <BalanceRun onOver={finish} />;

  return (
    <div className="space-y-4 text-center">
      {phase === "ende" && result ? (
        <>
          <p className="text-5xl">{result.finished ? (result.best ? "🏆" : "🏠") : "💥"}</p>
          <p className="text-3xl font-bold tabular-nums">{result.score} Punkte</p>
          {result.best && <p className="font-semibold text-amber-600">Neuer Rekord!</p>}
          <p className="text-sm text-muted">{result.finished ? "Zu Hause angekommen!" : `Gestürzt nach ${result.meters} m`}</p>
          {result.finished && (
            <p className="text-sm">{result.kept.length ? <>Heil angekommen: <b>{result.kept.join(", ")}</b></> : "Leider ist alles unterwegs heruntergefallen 😅"}</p>
          )}
          {result.lost.length > 0 && <p className="text-xs text-muted">Unterwegs verloren: {result.lost.join(", ")}</p>}
        </>
      ) : (
        <>
          <p className="text-5xl">🚲📦</p>
          <p className="font-semibold">Mit dem Lastenrad nach Hause</p>
          <p className="text-sm text-muted">Bierkasten, Regal, Verenas Monstera, Pizza und Stehlampe – alles soll heil ankommen. {COURSE_M} m bis zur WG.</p>
        </>
      )}
      <button onClick={() => setPhase("spiel")} className="w-full rounded-2xl bg-accent py-3 text-lg font-semibold text-white active:scale-[.98]">
        {phase === "ende" ? "Nochmal aufladen" : "Aufladen & los 🚲"}
      </button>
      <Leaderboard scores={scores} error={dbErr} />
      <ul className="mx-auto max-w-xs space-y-1 text-left text-sm text-muted">
        <li>👈👉 Linke oder rechte Bildschirmhälfte <b>gedrückt halten</b> = Gewicht verlagern (oder Pfeiltasten)</li>
        <li>⚠️ Hindernisse kommen von vorn – sie schubsen das Rad zu ihrer Seite. Vorher schon gegenhalten!</li>
        <li>📦 Kippt es zu weit, rutscht die oberste Ladung herunter. Punkte: Strecke + doppelter Wert der Ladung, die ankommt</li>
      </ul>
    </div>
  );
}

function BalanceRun({ onOver }: { onOver: (meters: number, kept: string[], lost: string[], finished: boolean) => void }) {
  const { me } = useWG();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const input = useRef({ left: false, right: false, touch: 0 });
  const [hud, setHud] = useState({ m: 0, cargo: CARGO.length, msg: "" });
  const color = me?.color ?? "#4f46e5";
  const overRef = useRef(onOver);
  useEffect(() => { overRef.current = onOver; }, [onOver]);

  useEffect(() => {
    const canvas = canvasRef.current!, wrap = wrapRef.current!, ctx = canvas.getContext("2d")!;
    let W = wrap.clientWidth;
    const resize = () => {
      W = wrap.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap);

    const st = {
      theta: 0.04 * (Math.random() < 0.5 ? -1 : 1), omega: 0, meters: 0, speed: 7, stripe: 0,
      stack: CARGO.map((c) => ({ ...c, over: 0, gone: false, fly: 0, flySide: 0 })),
      lost: [] as string[], obstacles: [] as Obstacle[], nextObs: 1.4, gust: 0, gustT: 4, msg: "", msgT: 0, done: false, crashT: 0,
    };
    const say = (m: string) => { st.msg = m; st.msgT = 1.2; };
    // Nur in der Entwicklung: Zustand für automatische Tests
    if (process.env.NODE_ENV !== "production") (window as unknown as { __balance?: unknown }).__balance = { st, input: input.current };
    let last = performance.now(), raf = 0, hudT = 0;

    function frame(now: number) {
      const dt = Math.min(0.033, (now - last) / 1000); last = now;
      if (!st.done) {
        st.speed = Math.min(10.5, 7 + st.meters / 160);
        st.meters += st.speed * dt; st.stripe = (st.stripe + st.speed * dt) % 4;
        // Wind
        st.gustT -= dt;
        if (st.gustT <= 0) { st.gust = (Math.random() - 0.5) * 1.6; st.gustT = 2.5 + Math.random() * 3; if (Math.abs(st.gust) > 0.55) say(st.gust > 0 ? "💨 Wind von links" : "💨 Wind von rechts"); }
        // Hindernisse
        st.nextObs -= dt;
        if (st.nextObs <= 0 && st.meters < COURSE_M - 30) {
          const r = Math.random(), kind: Obstacle["kind"] = r < 0.45 ? "loch" : r < 0.75 ? "bordstein" : "schiene";
          st.obstacles.push({ z: 55, side: Math.random() < 0.5 ? -1 : 1, kind, hit: false });
          st.nextObs = Math.max(0.8, 2.1 - st.meters / 400) + Math.random() * 0.8;
        }
        for (const o of st.obstacles) {
          o.z -= st.speed * dt;
          if (!o.hit && o.z <= 0) { o.hit = true; st.omega += o.side * OBST[o.kind].kick * (0.8 + Math.random() * 0.4); say(`${o.kind === "loch" ? "🕳️" : o.kind === "bordstein" ? "🧱" : "🚋"} ${OBST[o.kind].label}!`); }
        }
        st.obstacles = st.obstacles.filter((o) => o.z > -4);
        // Physik: Schwerkraft kippt, Gegenlenken hält, Ladung oben macht es wackliger
        const load = st.stack.filter((c) => !c.gone).length;
        const ctrl = (input.current.right ? 1 : 0) - (input.current.left ? 1 : 0) + input.current.touch;
        const alpha = 2.6 * Math.sin(st.theta) * (1 + load * 0.1) - 1.4 * st.omega + Math.max(-1, Math.min(1, ctrl)) * 4.4 + st.gust * 0.8;
        st.omega += alpha * dt; st.theta += st.omega * dt;
        // Ladung rutscht (von oben nach unten)
        const top = [...st.stack].reverse().find((c) => !c.gone);
        for (const c of st.stack) {
          if (c.gone) { c.fly += dt; continue; }
          if (Math.abs(st.theta) > c.tol && c === top) {
            c.over += dt;
            if (c.over > 0.35) { c.gone = true; c.flySide = Math.sign(st.theta); st.lost.push(c.name); say(`😱 ${c.name} runtergefallen!`); }
          } else c.over = Math.max(0, c.over - dt);
        }
        if (Math.abs(st.theta) > 1.05) {
          st.done = true; st.crashT = 1.3; say("💥 Umgekippt!");
        } else if (st.meters >= COURSE_M) {
          st.done = true; st.crashT = 0.9; say("🏠 Angekommen!");
        }
      } else {
        st.crashT -= dt;
        if (Math.abs(st.theta) > 1.05) st.theta = Math.sign(st.theta) * Math.min(1.5, Math.abs(st.theta) + dt * 2);
        if (st.crashT <= 0) {
          cancelAnimationFrame(raf);
          const kept = st.stack.filter((c) => !c.gone).map((c) => c.name);
          overRef.current(st.meters, kept, st.lost, st.meters >= COURSE_M);
          return;
        }
      }
      st.msgT = Math.max(0, st.msgT - dt);
      draw();
      hudT -= dt;
      if (hudT <= 0) { hudT = 0.15; setHud({ m: Math.round(st.meters), cargo: st.stack.filter((c) => !c.gone).length, msg: st.msgT > 0 ? st.msg : "" }); }
      raf = requestAnimationFrame(frame);
    }

    function draw() {
      const horizon = 120, cx = W / 2;
      // Himmel & Häuser
      const sky = ctx.createLinearGradient(0, 0, 0, horizon); sky.addColorStop(0, "#9cc9f0"); sky.addColorStop(1, "#dbeafe");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, horizon);
      for (let i = 0; i < 9; i++) {
        const bw = W / 9, bh = 30 + ((i * 37) % 45);
        ctx.fillStyle = ["#e7d8c4", "#d6c3ad", "#cbd5c0", "#e2c9b6"][i % 4];
        ctx.fillRect(i * bw, horizon - bh, bw - 2, bh);
        ctx.fillStyle = "rgba(60,80,110,.35)";
        for (let wy = horizon - bh + 6; wy < horizon - 8; wy += 10) for (let wx = i * bw + 4; wx < i * bw + bw - 8; wx += 9) ctx.fillRect(wx, wy, 4, 5);
      }
      // Gehweg & Straße (Perspektive)
      ctx.fillStyle = "#cbc5b8"; ctx.fillRect(0, horizon, W, H - horizon);
      const roadTop = W * 0.08, roadBot = W * 0.9;
      ctx.fillStyle = "#6b7280";
      ctx.beginPath(); ctx.moveTo(cx - roadTop, horizon); ctx.lineTo(cx + roadTop, horizon); ctx.lineTo(cx + roadBot / 2 + 40, H); ctx.lineTo(cx - roadBot / 2 - 40, H); ctx.closePath(); ctx.fill();
      // Mittelstreifen bewegt sich
      const proj = (z: number) => { const s = 1 / (1 + z / 7); return { y: horizon + (H - horizon) * s, s }; };
      ctx.fillStyle = "#f8fafc";
      for (let z = -st.stripe; z < 60; z += 4) {
        const a = proj(Math.max(0, z)), b = proj(Math.max(0, z + 2));
        ctx.beginPath(); ctx.moveTo(cx - 3 * a.s, a.y); ctx.lineTo(cx + 3 * a.s, a.y); ctx.lineTo(cx + 3 * b.s, b.y); ctx.lineTo(cx - 3 * b.s, b.y); ctx.fill();
      }
      // Hindernisse
      for (const o of [...st.obstacles].sort((a, b) => b.z - a.z)) {
        if (o.z < -1) continue;
        const p = proj(Math.max(0, o.z)), x = cx + o.side * (W * 0.16) * p.s * 2.2, sz = 34 * p.s * 2;
        if (o.kind === "loch") { ctx.fillStyle = "#1f2937"; ctx.beginPath(); ctx.ellipse(x, p.y, sz * 0.7, sz * 0.22, 0, 0, Math.PI * 2); ctx.fill(); }
        else if (o.kind === "bordstein") { ctx.fillStyle = "#e5e7eb"; ctx.fillRect(x - sz * 0.8, p.y - sz * 0.25, sz * 1.6, sz * 0.3); ctx.fillStyle = "#9ca3af"; ctx.fillRect(x - sz * 0.8, p.y + sz * 0.05, sz * 1.6, sz * 0.06); }
        else { ctx.strokeStyle = "#374151"; ctx.lineWidth = Math.max(1, 3 * p.s); for (const d of [-0.35, 0.35]) { ctx.beginPath(); ctx.moveTo(x + d * sz - sz, p.y); ctx.lineTo(x + d * sz + sz, p.y); ctx.stroke(); } }
        // Warnpfeil
        if (o.z > 6) { ctx.fillStyle = "rgba(239,68,68,.85)"; ctx.font = `bold ${Math.max(10, 18 * p.s * 2)}px system-ui`; ctx.textAlign = "center"; ctx.fillText(o.side < 0 ? "◀" : "▶", x, p.y - sz * 0.5); }
      }
      // Rad + Fahrer + Ladung, gedreht um den Reifen-Aufstandspunkt
      const gx = cx, gy = H - 18;
      ctx.save(); ctx.translate(gx, gy); ctx.rotate(st.theta);
      ctx.fillStyle = "#111827"; ctx.fillRect(-5, -46, 10, 46);                  // Hinterrad von hinten
      ctx.fillStyle = "#374151"; ctx.fillRect(-30, -58, 60, 6);                  // Gepäckträger
      ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(-17, -118, 34, 52, 10); ctx.fill(); // Rücken
      ctx.fillStyle = "#1f2937"; ctx.fillRect(-14, -70, 11, 22); ctx.fillRect(3, -70, 11, 22); // Beine
      ctx.fillStyle = "#f2c9a8"; ctx.beginPath(); ctx.arc(0, -130, 13, 0, Math.PI * 2); ctx.fill(); // Kopf
      ctx.fillStyle = "#3f2a1d"; ctx.beginPath(); ctx.arc(0, -134, 13, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color; ctx.fillRect(-34, -112, 17, 7); ctx.fillRect(17, -112, 17, 7);  // Arme zum Lenker
      // Ladung auf dem Gepäckträger (gestapelt, vor dem Rücken)
      let y = -58;
      for (const c of st.stack) {
        if (c.gone) continue;
        const wob = c.over > 0 ? Math.sin(performance.now() / 40) * 2 : 0;
        drawCargo(c, wob, y - c.h);
        y -= c.h + 1;
      }
      ctx.restore();
      // Herunterfallende Ladung
      for (const c of st.stack) if (c.gone && c.fly < 1.2) {
        ctx.save(); ctx.translate(gx + c.flySide * (40 + c.fly * 160), gy - 120 + c.fly * c.fly * 260); ctx.rotate(c.flySide * c.fly * 4);
        drawCargo(c, 0, -c.h / 2); ctx.restore();
      }
      // Neigungsanzeige
      const tilt = Math.min(1, Math.abs(st.theta) / 1.05);
      ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(W / 2 - 60, 8, 120, 8);
      ctx.fillStyle = tilt > 0.75 ? "#ef4444" : tilt > 0.45 ? "#f59e0b" : "#22c55e";
      ctx.fillRect(W / 2 + Math.min(0, st.theta / 1.05) * 60, 8, Math.abs(st.theta / 1.05) * 60, 8);
      ctx.fillStyle = "#fff"; ctx.fillRect(W / 2 - 1, 5, 2, 14);
    }
    function drawCargo(c: Cargo, wob: number, top: number) {
      const x = -c.w / 2 + wob;
      if (c.draw === "kiste") {
        ctx.fillStyle = c.color; ctx.fillRect(x, top, c.w, c.h);
        ctx.fillStyle = "#78350f"; for (let i = 1; i < 4; i++) ctx.fillRect(x + (c.w / 4) * i - 1, top, 2, c.h);
        ctx.fillStyle = "#14532d"; for (let i = 0; i < 4; i++) ctx.fillRect(x + 4 + i * (c.w / 4), top - 7, 5, 8);
      } else if (c.draw === "brett") {
        ctx.fillStyle = c.color; ctx.fillRect(x, top, c.w, c.h); ctx.strokeStyle = "#a07c4f"; ctx.strokeRect(x, top, c.w, c.h);
      } else if (c.draw === "pflanze") {
        ctx.fillStyle = "#c2410c"; ctx.fillRect(x + 6, top + c.h - 14, c.w - 12, 14);
        ctx.fillStyle = c.color; for (const [dx, dy, r] of [[0.5, 0.35, 11], [0.25, 0.5, 8], [0.75, 0.5, 8], [0.5, 0.12, 7]]) { ctx.beginPath(); ctx.arc(x + c.w * dx, top + c.h * dy, r, 0, Math.PI * 2); ctx.fill(); }
      } else if (c.draw === "pizza") {
        ctx.fillStyle = "#f5f5f4"; ctx.fillRect(x, top, c.w, c.h); ctx.fillStyle = "#dc2626"; ctx.font = "bold 7px system-ui"; ctx.textAlign = "center"; ctx.fillText("PIZZA", x + c.w / 2, top + c.h - 1);
      } else {
        ctx.fillStyle = "#57534e"; ctx.fillRect(x + c.w / 2 - 2, top + 12, 4, c.h - 12); ctx.fillStyle = c.color; ctx.beginPath(); ctx.moveTo(x - 4, top + 14); ctx.lineTo(x + c.w + 4, top + 14); ctx.lineTo(x + c.w - 1, top); ctx.lineTo(x + 1, top); ctx.fill();
      }
    }

    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [color]);

  useEffect(() => {
    const set = (e: KeyboardEvent, v: boolean) => {
      if (e.key === "ArrowLeft" || e.key === "a") { e.preventDefault(); input.current.left = v; }
      if (e.key === "ArrowRight" || e.key === "d") { e.preventDefault(); input.current.right = v; }
    };
    const down = (e: KeyboardEvent) => set(e, true), up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // Touch: welche Hälfte wird gedrückt? (mehrere Finger möglich)
  const pointers = useRef(new Map<number, number>());
  const updateTouch = () => { let v = 0; for (const s of pointers.current.values()) v += s; input.current.touch = Math.max(-1, Math.min(1, v)); };
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId);
    const r = wrapRef.current!.getBoundingClientRect();
    pointers.current.set(e.pointerId, e.clientX - r.left < r.width / 2 ? -1 : 1); updateTouch();
  };
  const onUp = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); updateTouch(); };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-bold tabular-nums">🏠 noch {Math.max(0, COURSE_M - hud.m)} m</span>
        <span className="font-bold">📦 {hud.cargo}/{CARGO.length}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line/60"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, (hud.m / COURSE_M) * 100)}%` }} /></div>
      <div ref={wrapRef} className="relative mx-auto max-w-md touch-none select-none overflow-hidden rounded-2xl" style={{ height: H }}
        onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onUp}
        role="application" aria-label="Lastenrad: linke oder rechte Hälfte gedrückt halten zum Ausbalancieren">
        <canvas ref={canvasRef} className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-y-0 left-0 flex w-1/2 items-end justify-start p-3 text-3xl text-white/70">◀</div>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-1/2 items-end justify-end p-3 text-3xl text-white/70">▶</div>
        {hud.msg && <p className="pointer-events-none absolute inset-x-0 top-6 mx-auto w-fit rounded-xl bg-black/65 px-3 py-1.5 text-sm font-semibold text-white">{hud.msg}</p>}
      </div>
      <p className="text-center text-xs text-muted">Halten, wohin du das Gewicht verlagern willst · Pfeiltasten gehen auch</p>
    </div>
  );
}
