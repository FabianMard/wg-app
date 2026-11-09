"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { GameScore, Member } from "@/lib/types";
import { AvatarFigure, lookOf } from "./avatar";
import { Leaderboard } from "./Leaderboard";

/**
 * Minispiel: Tennis von oben. Du unten (mit deinem Avatar), Fabian oben.
 * Mit dem Finger / Pfeiltasten laufen – geschlagen wird automatisch, sobald der Ball in Reichweite ist.
 * Schlägermitte = gerade, Schlägerrand = schräg (schwerer für den Gegner, aber Aus-Gefahr).
 */

const H = 460;
const FIG = 34;
const REACH = 30;        // Reichweite des Schlägers (seitlich)
const LIVES = 3;

type Phase = "start" | "spiel" | "ende";

export function TennisGame({ onResult }: { onResult?: (score: number, best: boolean) => void }) {
  const { members, me, myId } = useWG();
  const sorted = [...members].sort((a, b) => a.sort - b.sort);
  // Gegner: Fabian (Zimmerbesitzer) – ist man selbst Fabian, spielt Stefan
  const fabian = sorted.find((m) => m.sort === 2) ?? sorted[sorted.length - 1];
  const opponent = fabian && fabian.id !== myId ? fabian : sorted.find((m) => m.sort === 1 && m.id !== myId) ?? sorted.find((m) => m.id !== myId) ?? fabian;
  const [phase, setPhase] = useState<Phase>("start");
  const [result, setResult] = useState<{ score: number; returns: number; winners: number; best: boolean } | null>(null);
  const [dbErr, setDbErr] = useState<string | null>(null);
  const { rows: scores, reload } = useRows<GameScore>("game_scores", "best", false);
  const tennisScores = scores.filter((s) => s.game === "tennis");
  const myBest = tennisScores.find((s) => s.member_id === myId)?.best ?? 0;

  const finish = useCallback((score: number, returns: number, winners: number) => {
    const best = score > myBest;
    setResult({ score, returns, winners, best });
    setPhase("ende");
    if (score > 0) supabase.rpc("submit_score", { p_game: "tennis", p_score: score }).then(({ error }) => {
      setDbErr(error ? (/game_scores|submit_score|check constraint/i.test(error.message)
        ? "Rekord konnte nicht gespeichert werden: Bitte supabase/018_spiele.sql im SQL Editor ausführen."
        : `Rekord konnte nicht gespeichert werden: ${error.message}`) : null);
      reload();
    });
    onResult?.(score, best);
  }, [myBest, onResult, reload]);

  if (!me || !opponent) return <p className="text-sm text-muted">Hier fehlt noch ein Gegner. 🎾</p>;

  if (phase === "spiel") return <TennisMatch me={me} opponent={opponent} onOver={finish} />;

  return (
    <div className="space-y-4 text-center">
      {phase === "ende" && result ? (
        <>
          <p className="text-5xl">{result.best ? "🏆" : "🎾"}</p>
          <p className="text-3xl font-bold tabular-nums">{result.score} {result.score === 1 ? "Punkt" : "Punkte"}</p>
          {result.best && <p className="font-semibold text-amber-600">Neuer Rekord!</p>}
          <p className="text-sm text-muted">{result.returns} Rückschläge · {result.winners} Gewinnschläge gegen {opponent.display_name}</p>
        </>
      ) : (
        <>
          <div className="flex items-end justify-center gap-6">
            <div className="flex flex-col items-center"><AvatarFigure look={lookOf(me)} size={52} /><span className="text-sm font-semibold">Du</span></div>
            <span className="pb-6 text-3xl">🎾</span>
            <div className="flex flex-col items-center"><AvatarFigure look={lookOf(opponent)} size={52} flip /><span className="text-sm font-semibold">{opponent.display_name}</span></div>
          </div>
          <p className="font-semibold">Tennis gegen {opponent.display_name}!</p>
        </>
      )}
      <button onClick={() => setPhase("spiel")} className="w-full rounded-2xl bg-accent py-3 text-lg font-semibold text-white active:scale-[.98]">
        {phase === "ende" ? "Nochmal" : "Aufschlag!"}
      </button>
      <Leaderboard scores={tennisScores} error={dbErr} />
      <ul className="mx-auto max-w-xs space-y-1 text-left text-sm text-muted">
        <li>👆 <b>Finger auf den Platz</b> und hin- und herziehen (oder ← →)</li>
        <li>🎾 Geschlagen wird automatisch, wenn der Ball nah genug ist</li>
        <li>🎯 Schlägermitte = gerade · Schlägerrand = schräg (Aus-Gefahr!)</li>
        <li>+1 pro Rückschlag · +5 wenn {opponent.display_name} nicht rankommt · {LIVES} Leben</li>
      </ul>
    </div>
  );
}

/** Ein Spiel bis alle Leben weg sind. Canvas für Platz/Ball/Schläger, Avatare als echte Figuren darüber. */
function TennisMatch({ me, opponent, onOver }: { me: Member; opponent: Member; onOver: (score: number, returns: number, winners: number) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const meRef = useRef<HTMLDivElement>(null);
  const oppRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLSpanElement>(null);
  const livesRef = useRef<HTMLSpanElement>(null);
  const input = useRef<{ target: number | null; left: boolean; right: boolean }>({ target: null, left: false, right: false });
  const overRef = useRef(onOver);
  useEffect(() => { overRef.current = onOver; }, [onOver]);
  const colors = useRef({ me: me.color, opp: opponent.color });
  useEffect(() => { colors.current = { me: me.color, opp: opponent.color }; }, [me.color, opponent.color]);

  useEffect(() => {
    const canvas = canvasRef.current!, wrap = wrapRef.current!, meEl = meRef.current!, oppEl = oppRef.current!;
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

    const court = () => ({ l: 34, r: W - 34, t: 46, b: H - 46 });
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const c0 = court();
    const st = {
      px: W / 2, ox: W / 2, oTarget: W / 2,
      ball: { x: W / 2, y: c0.t + 14, vx: 0, vy: 0, fromY: c0.t + 14, toY: c0.b - 14, live: false, byMe: false },
      rally: 0, score: 0, returns: 0, winners: 0, lives: LIVES,
      wait: 0.9, swingMe: 0, swingOpp: 0, msg: "", msgT: 0, over: false, overT: 0, t: 0, trail: [] as { x: number; y: number }[],
    };
    const speed = () => Math.min(560, 250 + st.rally * 14 + st.winners * 6);
    const say = (m: string) => { st.msg = m; st.msgT = 1.1; };

    // Ball von (x,y) zu Zielpunkt schlagen
    function shoot(fromX: number, fromY: number, toX: number, toY: number, byMe: boolean) {
      const s = speed(), dy = toY - fromY, time = Math.abs(dy) / s;
      st.ball = { x: fromX, y: fromY, vx: (toX - fromX) / time, vy: Math.sign(dy) * s, fromY, toY, live: true, byMe };
    }
    function serve() {
      const c = court();
      st.ox = W / 2;
      shoot(st.ox, c.t + 14, rnd(c.l + 20, c.r - 20), c.b - 14, false);
      st.swingOpp = 0.25;
    }
    function pointOver(won: boolean, text: string) {
      st.ball.live = false;
      if (won) { st.winners++; st.score += 5; } else { st.lives--; }
      say(text);
      st.rally = 0;
      if (st.lives <= 0) { st.over = true; st.overT = 0; } else st.wait = 1.1;
    }

    let last = performance.now(), raf = 0;
    function frame(now: number) {
      const dt = Math.min(0.033, (now - last) / 1000); last = now;
      const c = court();
      st.t += dt;
      if (!st.over) {
        // Spieler laufen lassen
        const maxV = 430;
        let goal = st.px;
        if (input.current.target != null) goal = input.current.target;
        if (input.current.left) goal = st.px - 60;
        if (input.current.right) goal = st.px + 60;
        const d = goal - st.px;
        st.px += Math.sign(d) * Math.min(Math.abs(d), maxV * dt);
        st.px = Math.max(c.l - 18, Math.min(c.r + 18, st.px));

        if (st.wait > 0) { st.wait -= dt; if (st.wait <= 0) serve(); }

        const b = st.ball;
        if (b.live) {
          b.x += b.vx * dt; b.y += b.vy * dt;
          st.trail.push({ x: b.x, y: b.y }); if (st.trail.length > 6) st.trail.shift();
          // Gegner läuft zum Ball (mit kleinem Fehler, wird mit der Zeit besser)
          if (b.vy < 0) {
            const tLeft = (c.t + 14 - b.y) / b.vy;
            st.oTarget = b.x + b.vx * tLeft;
          } else st.oTarget = W / 2;
          const oppSpeed = 175 + Math.min(150, st.winners * 9 + st.returns * 2.5);
          const od = st.oTarget - st.ox;
          st.ox += Math.sign(od) * Math.min(Math.abs(od), oppSpeed * dt);

          // Ball kommt bei mir an
          if (b.vy > 0 && b.y >= c.b - 14) {
            if (Math.abs(b.x - st.px) <= REACH && b.x > c.l - 30 && b.x < c.r + 30) {
              const off = Math.max(-1, Math.min(1, (b.x - st.px) / REACH));
              const toX = W / 2 + off * (W / 2 - 34) * 1.25 + rnd(-12, 12); // Rand = schräg, evtl. Aus
              st.rally++; st.returns++; st.score += 1; st.swingMe = 0.25;
              shoot(b.x, c.b - 14, toX, c.t + 14, true);
            } else if (b.y > c.b + 10) pointOver(false, "Verpasst!");
          }
          // Ball kommt beim Gegner an
          if (b.vy < 0 && b.y <= c.t + 14) {
            const out = b.x < c.l - 4 || b.x > c.r + 4;
            if (out) pointOver(false, "Aus!");
            else if (Math.abs(b.x - st.ox) <= REACH - 2) {
              st.swingOpp = 0.25; st.rally++;
              shoot(b.x, c.t + 14, rnd(c.l + 18, c.r - 18), c.b - 14, false);
            } else if (b.y < c.t - 10) pointOver(true, "Punkt! +5");
          }
        }
      } else {
        st.overT += dt;
        if (st.overT > 1.3) { cancelAnimationFrame(raf); overRef.current(st.score, st.returns, st.winners); return; }
      }
      st.swingMe = Math.max(0, st.swingMe - dt); st.swingOpp = Math.max(0, st.swingOpp - dt);
      st.msgT = Math.max(0, st.msgT - dt);

      draw(c);
      if (hudRef.current) hudRef.current.textContent = `${st.score} ${st.score === 1 ? "Punkt" : "Punkte"}`;
      if (livesRef.current) livesRef.current.textContent = "🎾".repeat(Math.max(0, st.lives)) + "·".repeat(LIVES - Math.max(0, st.lives));
      meEl.style.transform = `translate(${st.px - FIG / 2}px, ${c.b - FIG * 1.25 + 6}px)`;
      oppEl.style.transform = `translate(${st.ox - FIG / 2}px, ${c.t - FIG * 1.25 + 4}px)`;
      raf = requestAnimationFrame(frame);
    }

    function racket(x: number, y: number, swing: number, color: string, flip: boolean) {
      ctx.save(); ctx.translate(x, y);
      const ang = (flip ? -1 : 1) * (0.5 - swing * 5);
      ctx.rotate(ang);
      ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(16, 0); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.strokeStyle = color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(25, 0, 9, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    function draw(c: { l: number; r: number; t: number; b: number }) {
      // Hintergrund + Platz (Sand)
      ctx.fillStyle = "#3f8f5a"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#d9773f"; ctx.fillRect(c.l - 14, c.t - 26, c.r - c.l + 28, c.b - c.t + 52);
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.5;
      ctx.strokeRect(c.l, c.t, c.r - c.l, c.b - c.t);
      const mid = (c.t + c.b) / 2, inset = (c.r - c.l) * 0.12;
      ctx.beginPath();
      ctx.moveTo(c.l + inset, c.t); ctx.lineTo(c.l + inset, c.b);
      ctx.moveTo(c.r - inset, c.t); ctx.lineTo(c.r - inset, c.b);
      ctx.moveTo(c.l + inset, mid - (c.b - c.t) * 0.27); ctx.lineTo(c.r - inset, mid - (c.b - c.t) * 0.27);
      ctx.moveTo(c.l + inset, mid + (c.b - c.t) * 0.27); ctx.lineTo(c.r - inset, mid + (c.b - c.t) * 0.27);
      ctx.moveTo(W / 2, mid - (c.b - c.t) * 0.27); ctx.lineTo(W / 2, mid + (c.b - c.t) * 0.27);
      ctx.stroke();
      // Netz
      ctx.fillStyle = "rgba(15,23,42,.35)"; ctx.fillRect(c.l - 10, mid - 1, c.r - c.l + 20, 5);
      ctx.strokeStyle = "#f8fafc"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(c.l - 10, mid - 2); ctx.lineTo(c.r + 10, mid - 2); ctx.stroke();

      // Ball mit Schatten; Höhe (Bogen + Aufsprung) aus dem Fortschritt berechnet
      const b = st.ball;
      if (b.live) {
        const p = Math.max(0, Math.min(1, (b.y - b.fromY) / (b.toY - b.fromY)));
        const z = p < 0.68 ? 34 * Math.sin((Math.PI * p) / 0.68) : 12 * Math.sin((Math.PI * (p - 0.68)) / 0.32);
        ctx.fillStyle = "rgba(0,0,0,.25)";
        ctx.beginPath(); ctx.ellipse(b.x, b.y, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(223,255,79,.35)";
        for (const q of st.trail) { ctx.beginPath(); ctx.arc(q.x, q.y - z, 3, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = "#dfff4f"; ctx.strokeStyle = "#3f6212"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(b.x, b.y - z, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(b.x - 3, b.y - z, 5, -0.9, 0.9); ctx.stroke();
      }
      // Schläger neben den Figuren
      racket(st.px + 10, c.b - 14, st.swingMe, colors.current.me, false);
      racket(st.ox - 10, c.t + 4, st.swingOpp, colors.current.opp, true);

      // Meldung
      if (st.msgT > 0 || st.over) {
        const text = st.over ? "Spiel vorbei!" : st.msg;
        ctx.globalAlpha = st.over ? 1 : Math.min(1, st.msgT * 2);
        ctx.font = "800 26px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.lineJoin = "round";
        ctx.lineWidth = 6; ctx.strokeStyle = "#ffffff"; ctx.strokeText(text, W / 2, (c.t + c.b) / 2 - 18);
        ctx.fillStyle = "#0f172a"; ctx.fillText(text, W / 2, (c.t + c.b) / 2 - 18);
        ctx.globalAlpha = 1;
      }
    }

    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // Pfeiltasten
  useEffect(() => {
    const set = (e: KeyboardEvent, v: boolean) => {
      if (e.key === "ArrowLeft" || e.key === "a") { e.preventDefault(); input.current.left = v; input.current.target = null; }
      if (e.key === "ArrowRight" || e.key === "d") { e.preventDefault(); input.current.right = v; input.current.target = null; }
    };
    const down = (e: KeyboardEvent) => set(e, true), up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const toTarget = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    input.current.target = e.clientX - r.left;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span ref={livesRef} className="tracking-widest">🎾🎾🎾</span>
        <span ref={hudRef} className="font-bold tabular-nums">0 Punkte</span>
      </div>
      <div ref={wrapRef} className="relative mx-auto max-w-md touch-none select-none overflow-hidden rounded-2xl" style={{ height: H }}
        onPointerDown={(e) => { e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId); toTarget(e); }}
        onPointerMove={(e) => { if (e.buttons || e.pointerType === "touch") toTarget(e); }}
        role="application" aria-label="Tennis: Finger hin- und herziehen zum Laufen">
        <canvas ref={canvasRef} className="absolute inset-0" />
        <div ref={oppRef} className="pointer-events-none absolute left-0 top-0 will-change-transform" style={{ width: FIG }}>
          <AvatarFigure look={lookOf(opponent)} size={FIG} />
        </div>
        <div ref={meRef} className="pointer-events-none absolute left-0 top-0 will-change-transform" style={{ width: FIG }}>
          <AvatarFigure look={lookOf(me)} size={FIG} />
        </div>
      </div>
      <p className="text-center text-xs text-muted">Finger auf den Platz und hin- und herziehen · Schlägerrand = schräg</p>
    </div>
  );
}
