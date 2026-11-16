"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { Member } from "@/lib/types";
import { Avatar } from "@/components/ui";

/**
 * Minispiel „Geister-Rennen“: von der WG zur Uni. Abwechselnd links/rechts tippen = treten.
 * Vor Kurven bremsen, sonst rutscht man weg. Die Bestfahrt jeder Person wird als „Geist“ gespeichert –
 * gegen den fährt man dann, auch wenn die Person gar nicht online ist.
 */

const TRACK_M = 400;
const SAMPLE_MS = 100;
const CURVES = [
  { from: 95, to: 125, max: 7.5, name: "Kurve am Clara-Park" },
  { from: 205, to: 235, max: 6.2, name: "Spitzkehre Connewitzer Kreuz" },
  { from: 315, to: 340, max: 8.2, name: "Kurve an der Uni" },
];
const kmh = (v: number) => Math.round(v * 3.6);
const fmt = (ms: number) => `${(ms / 1000).toFixed(2).replace(".", ",")} s`;

export type Ghost = { member_id: string; household_id: string; time_ms: number; trace: number[]; updated_at: string };

export function BikeRace({ onResult }: { onResult?: (text: string) => void }) {
  const { everyone, myId } = useWG();
  const { rows: ghosts, reload } = useRows<Ghost>("bike_ghosts", "time_ms");
  const [rival, setRival] = useState<string | null>(null);
  const [phase, setPhase] = useState<"start" | "spiel" | "ende">("start");
  const [result, setResult] = useState<{ time: number; finished: boolean; best: boolean; vs: { name: string; diff: number } | null } | null>(null);
  const [dbErr, setDbErr] = useState<string | null>(null);
  const sorted = [...ghosts].sort((a, b) => a.time_ms - b.time_ms);
  const person = (id: string) => everyone.find((m) => m.id === id);
  const myBest = ghosts.find((g) => g.member_id === myId)?.time_ms ?? null;
  // Standard-Gegner: der Rekord (oder der eigene Geist, wenn man selbst vorne ist)
  const rivalGhost = ghosts.find((g) => g.member_id === (rival ?? sorted[0]?.member_id)) ?? null;

  const finish = useCallback((time: number, trace: number[]) => {
    const best = myBest === null || time < myBest;
    const vs = rivalGhost ? { name: rivalGhost.member_id === myId ? "dein Geist" : person(rivalGhost.member_id)?.display_name ?? "?", diff: time - rivalGhost.time_ms } : null;
    setResult({ time, finished: true, best, vs });
    setPhase("ende");
    if (best) supabase.rpc("submit_ghost", { p_time: Math.round(time), p_trace: trace }).then(({ error }) => {
      setDbErr(error ? (/bike_ghosts|submit_ghost/i.test(error.message) ? "Bestzeit konnte nicht gespeichert werden: Bitte supabase/029_radrennen.sql im SQL Editor ausführen." : error.message) : null);
      reload();
    });
    onResult?.(best ? `🚴 ${fmt(time)} – neue Bestzeit!` : `🚴 ${fmt(time)}`);
  }, [myBest, rivalGhost, myId, reload, onResult]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === "spiel") return <RaceRun rival={rivalGhost} rivalMember={rivalGhost ? person(rivalGhost.member_id) : undefined} onOver={finish} />;

  return (
    <div className="space-y-4 text-center">
      {phase === "ende" && result ? (
        <>
          <p className="text-5xl">{result.best ? "🏆" : "🚴"}</p>
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
          <p className="text-5xl">🚴👻</p>
          <p className="font-semibold">Geister-Rennen: WG → Uni ({TRACK_M} m)</p>
          <p className="text-sm text-muted">Fahr gegen die Bestfahrt der anderen – auch wenn sie gerade nicht da sind.</p>
        </>
      )}
      {ghosts.length > 0 && (
        <div className="text-left">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Gegen wen? 👻</p>
          <div className="flex flex-wrap gap-2">
            {sorted.map((g) => {
              const m = person(g.member_id), on = rivalGhost?.member_id === g.member_id;
              return (
                <button key={g.member_id} onClick={() => setRival(g.member_id)}
                  className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-sm transition active:scale-95 ${on ? "border-accent bg-accent/10 font-semibold" : "border-line"}`}>
                  <Avatar member={m} size={22} />{g.member_id === myId ? "Dein Geist" : m?.display_name ?? "?"} · {fmt(g.time_ms)}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <button onClick={() => setPhase("spiel")} className="w-full rounded-2xl bg-accent py-3 text-lg font-semibold text-white active:scale-[.98]">
        {phase === "ende" ? "Nochmal" : rivalGhost ? `Los gegen ${rivalGhost.member_id === myId ? "deinen Geist" : person(rivalGhost.member_id)?.display_name ?? "?"} 👻` : "Erste Fahrt 🚴"}
      </button>
      <RaceBoard ghosts={sorted} error={dbErr} />
      <ul className="mx-auto max-w-xs space-y-1 text-left text-sm text-muted">
        <li>👣 <b>Abwechselnd links und rechts tippen</b> = treten. Zweimal dieselbe Seite = aus dem Takt</li>
        <li>🛑 Vor Kurven <b>Bremse</b> halten – zu schnell in der Kurve = wegrutschen</li>
        <li>👻 Deine schnellste Fahrt wird dein Geist, gegen den die anderen fahren</li>
      </ul>
    </div>
  );
}

/** Bestzeiten (schnellste zuerst) – auch für die große Bestenliste im Flur */
export function RaceBoard({ ghosts, error }: { ghosts: Ghost[]; error?: string | null }) {
  const { everyone, myId } = useWG();
  const list = [...ghosts].sort((a, b) => a.time_ms - b.time_ms);
  return (
    <div className="rounded-2xl border border-line p-3 text-left">
      <p className="mb-2 text-center text-sm font-semibold">🏆 Bestzeiten WG → Uni</p>
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

function RaceRun({ rival, rivalMember, onOver }: { rival: Ghost | null; rivalMember?: Member; onOver: (time: number, trace: number[]) => void }) {
  const { me } = useWG();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctl = useRef({ last: 0 as -1 | 0 | 1, brake: false, taps: [] as number[] });
  const [hud, setHud] = useState({ v: 0, d: 0, t: 0, msg: "", gap: null as number | null, warn: "", countdown: 3 });
  const overRef = useRef(onOver);
  useEffect(() => { overRef.current = onOver; }, [onOver]);
  const H = 300;
  const myColor = me?.color ?? "#4f46e5", ghostColor = rivalMember?.color ?? "#94a3b8";

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
    const st = { v: 0, d: 0, t: -3000, stun: 0, msg: "", msgT: 0, trace: [] as number[], nextSample: 0, done: false, pedal: 0 };
    if (process.env.NODE_ENV !== "production") (window as unknown as { __race?: unknown }).__race = { st, ctl: ctl.current };
    const say = (m: string, s = 1) => { st.msg = m; st.msgT = s; };
    const ghostAt = (ms: number) => {
      if (!rival) return null;
      const i = ms / SAMPLE_MS, a = Math.floor(i);
      if (a >= rival.trace.length - 1) return TRACK_M;
      const f = i - a;
      return ((rival.trace[a] ?? 0) * (1 - f) + (rival.trace[a + 1] ?? 0) * f) / 10;
    };
    // Tippen verarbeiten (wird vom Button aufgerufen)
    (ctl.current as unknown as { onTap: (side: -1 | 1) => void }).onTap = (side) => {
      if (st.t < 0 || st.done) return;
      if (st.stun > 0) return;
      if (ctl.current.last === side) { st.v *= 0.8; say("🦶 Aus dem Takt!", 0.6); }
      else { st.v += 1.4 * Math.max(0, 1 - st.v / 16); st.pedal += 1; }
      ctl.current.last = side;
    };
    let last = performance.now(), raf = 0, hudT = 0;

    function frame(now: number) {
      const dt = Math.min(0.033, (now - last) / 1000); last = now;
      st.t += dt * 1000;
      if (st.t >= 0 && !st.done) {
        st.v -= dt * (0.3 + 0.02 * st.v * st.v);
        if (ctl.current.brake) st.v -= dt * 7;
        st.v = Math.max(0, st.v);
        st.stun = Math.max(0, st.stun - dt);
        st.d += st.v * dt;
        const curve = CURVES.find((c) => st.d >= c.from && st.d <= c.to);
        if (curve && st.v > curve.max && st.stun <= 0) { st.v = 2.5; st.stun = 0.9; say("💥 Weggerutscht! Zu schnell in der Kurve", 1.3); }
        while (st.t >= st.nextSample) { st.trace.push(Math.round(st.d * 10)); st.nextSample += SAMPLE_MS; }
        if (st.d >= TRACK_M) {
          // exakte Zielzeit (zwischen zwei Frames interpoliert)
          const time = st.t - ((st.d - TRACK_M) / Math.max(0.1, st.v)) * 1000;
          st.done = true; st.d = TRACK_M;
          st.trace.push(TRACK_M * 10);
          setTimeout(() => overRef.current(time, st.trace), 900);
          say("🏁 Ziel!", 2);
        }
      }
      st.msgT = Math.max(0, st.msgT - dt);
      draw();
      hudT -= dt;
      if (hudT <= 0) {
        hudT = 0.1;
        const g = ghostAt(Math.max(0, st.t));
        const next = CURVES.find((c) => c.to > st.d);
        const warn = next && next.from - st.d < 60 ? (st.d >= next.from ? `↪ ${next.name} · max ${kmh(next.max)} km/h` : `⚠️ ${next.name} in ${Math.round(next.from - st.d)} m · max ${kmh(next.max)} km/h`) : "";
        setHud({ v: st.v, d: st.d, t: Math.max(0, st.t), msg: st.msgT > 0 ? st.msg : "", gap: g === null ? null : st.d - g, warn, countdown: Math.ceil(-st.t / 1000) });
      }
      if (!st.done || st.msgT > 0) raf = requestAnimationFrame(frame);
    }

    function draw() {
      const ppm = 9; // Pixel pro Meter
      const camX = st.d * ppm - W * 0.3;
      // Himmel, Parallax-Häuser
      ctx.fillStyle = "#bfdbfe"; ctx.fillRect(0, 0, W, H);
      for (let i = -1; i < W / 70 + 2; i++) {
        const off = (camX * 0.3) % 70, x = i * 70 - off, seed = Math.floor((camX * 0.3) / 70) + i, bh = 60 + ((seed * 53) % 70);
        ctx.fillStyle = ["#e7d8c4", "#d6c3ad", "#cbd5c0", "#e2c9b6"][((seed % 4) + 4) % 4];
        ctx.fillRect(x, 150 - bh, 64, bh);
      }
      // Bäume
      for (let i = -1; i < W / 45 + 2; i++) {
        const off = (camX * 0.7) % 45, x = i * 45 - off;
        ctx.fillStyle = "#65a30d"; ctx.beginPath(); ctx.arc(x, 150, 14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#713f12"; ctx.fillRect(x - 2, 150, 4, 16);
      }
      ctx.fillStyle = "#86efac"; ctx.fillRect(0, 165, W, 20);
      // Radweg
      ctx.fillStyle = "#9ca3af"; ctx.fillRect(0, 185, W, 80);
      for (const c of CURVES) {
        const x1 = c.from * ppm - camX, x2 = c.to * ppm - camX;
        if (x2 < 0 || x1 > W) continue;
        ctx.fillStyle = "rgba(239,68,68,.25)"; ctx.fillRect(x1, 185, x2 - x1, 80);
        ctx.fillStyle = "#fbbf24"; ctx.fillRect(x1 - 70, 168, 4, 20);
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#dc2626"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x1 - 68, 160, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#111"; ctx.font = "bold 10px system-ui"; ctx.textAlign = "center"; ctx.fillText(String(kmh(c.max)), x1 - 68, 164);
      }
      ctx.strokeStyle = "#f8fafc"; ctx.lineWidth = 2; ctx.setLineDash([14, 12]); ctx.lineDashOffset = camX;
      ctx.beginPath(); ctx.moveTo(0, 225); ctx.lineTo(W, 225); ctx.stroke(); ctx.setLineDash([]);
      // Ziel
      const fx = TRACK_M * ppm - camX;
      if (fx < W + 20) for (let r = 0; r < 8; r++) for (let c = 0; c < 2; c++) { ctx.fillStyle = (r + c) % 2 ? "#111" : "#fff"; ctx.fillRect(fx + c * 8, 185 + r * 10, 8, 10); }
      // Geist
      const g = ghostAt(Math.max(0, st.t));
      if (g !== null) drawBike(g * ppm - camX, 212, ghostColor, 0.4, st.t / 90);
      drawBike(W * 0.3, 245, myColor, 1, st.pedal * 0.9 + (st.stun > 0 ? Math.sin(st.t / 40) : 0));
      if (st.t < 0) { ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#fff"; ctx.font = "bold 64px system-ui"; ctx.textAlign = "center"; ctx.fillText(String(Math.ceil(-st.t / 1000)), W / 2, H / 2 + 20); }
    }
    function drawBike(x: number, y: number, color: string, alpha: number, crank: number) {
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y);
      ctx.strokeStyle = "#111827"; ctx.lineWidth = 3;
      for (const wx of [-16, 16]) { ctx.beginPath(); ctx.arc(wx, 0, 11, 0, Math.PI * 2); ctx.stroke(); }
      ctx.strokeStyle = color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-2, -14); ctx.lineTo(14, -14); ctx.lineTo(16, 0); ctx.moveTo(-2, -14); ctx.lineTo(0, 0); ctx.lineTo(-16, 0); ctx.stroke();
      // Fahrer
      ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(2, -30, 7, 13, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f2c9a8"; ctx.beginPath(); ctx.arc(10, -46, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 3;
      const px = Math.cos(crank) * 6, py = Math.sin(crank) * 6;
      ctx.beginPath(); ctx.moveTo(-2, -20); ctx.lineTo(px, py); ctx.moveTo(-2, -20); ctx.lineTo(-px, -py); ctx.stroke();
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [rival, myColor, ghostColor]);

  const tap = (side: -1 | 1) => (ctl.current as unknown as { onTap?: (s: -1 | 1) => void }).onTap?.(side);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "ArrowLeft" || e.key === "a") { e.preventDefault(); tap(-1); }
      if (e.key === "ArrowRight" || e.key === "d") { e.preventDefault(); tap(1); }
      if (e.key === " " || e.key === "ArrowDown") { e.preventDefault(); ctl.current.brake = true; }
    };
    const up = (e: KeyboardEvent) => { if (e.key === " " || e.key === "ArrowDown") ctl.current.brake = false; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const next = CURVES.find((c) => c.to > hud.d);
  const tooFast = next && next.from - hud.d < 60 && hud.v > next.max;
  const pedalBtn = "flex h-20 flex-1 select-none items-center justify-center rounded-2xl bg-accent text-2xl font-bold text-white shadow active:scale-95 active:bg-accent/80 touch-none";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-bold tabular-nums">⏱ {fmt(hud.t)}</span>
        <span className={`rounded-lg px-2 py-0.5 font-bold tabular-nums ${tooFast ? "bg-red-500 text-white" : ""}`}>{kmh(hud.v)} km/h</span>
        <span className="tabular-nums text-muted">{Math.round(hud.d)} / {TRACK_M} m</span>
      </div>
      <div className="relative h-2 rounded-full bg-line/60">
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${(hud.d / TRACK_M) * 100}%` }} />
        {rival && hud.gap !== null && <span className="absolute -top-1 h-4 w-1.5 rounded bg-slate-400" style={{ left: `${Math.min(100, ((hud.d - hud.gap) / TRACK_M) * 100)}%` }} title="Geist" />}
        {CURVES.map((c) => <span key={c.from} className="absolute inset-y-0 bg-red-400/60" style={{ left: `${(c.from / TRACK_M) * 100}%`, width: `${((c.to - c.from) / TRACK_M) * 100}%` }} />)}
      </div>
      <div ref={wrapRef} className="relative mx-auto max-w-md overflow-hidden rounded-2xl" style={{ height: H }}>
        <canvas ref={canvasRef} className="absolute inset-0" />
        {rival && hud.gap !== null && hud.countdown <= 0 && (
          <span className={`absolute right-2 top-2 rounded-lg px-2 py-1 text-xs font-bold ${hud.gap >= 0 ? "bg-emerald-600 text-white" : "bg-white/90 text-neutral-900"}`}>
            👻 {rivalMember?.display_name ?? "Geist"}: {hud.gap >= 0 ? `+${Math.round(hud.gap)} m vorne` : `${Math.round(-hud.gap)} m hinten`}
          </span>
        )}
        {hud.warn && <span className="absolute left-2 top-2 max-w-[60%] rounded-lg bg-amber-400 px-2 py-1 text-xs font-bold text-neutral-900">{hud.warn}</span>}
        {hud.msg && <p className="absolute inset-x-0 top-1/3 mx-auto w-fit rounded-xl bg-black/70 px-3 py-1.5 text-sm font-semibold text-white">{hud.msg}</p>}
      </div>
      <div className="flex gap-2">
        <button className={pedalBtn} onPointerDown={(e) => { e.preventDefault(); tap(-1); }} aria-label="Linkes Pedal">🦶 L</button>
        <button className="flex h-20 w-20 select-none items-center justify-center rounded-2xl bg-red-600 text-sm font-bold text-white shadow active:scale-95 touch-none"
          onPointerDown={(e) => { e.preventDefault(); ctl.current.brake = true; }} onPointerUp={() => { ctl.current.brake = false; }}
          onPointerLeave={() => { ctl.current.brake = false; }} onPointerCancel={() => { ctl.current.brake = false; }} aria-label="Bremse">🛑<br />Bremse</button>
        <button className={pedalBtn} onPointerDown={(e) => { e.preventDefault(); tap(1); }} aria-label="Rechtes Pedal">R 🦶</button>
      </div>
      <p className="text-center text-xs text-muted">Abwechselnd L und R tippen · vor Kurven bremsen · Tastatur: ← → und Leertaste</p>
    </div>
  );
}
