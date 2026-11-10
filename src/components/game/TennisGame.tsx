"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { GameScore, Member, TennisMatch } from "@/lib/types";
import { AvatarFigure, lookOf } from "./avatar";
import { Leaderboard } from "./Leaderboard";

/**
 * Minispiel: Tennis von oben. Du unten (mit deinem Avatar), Fabian oben.
 * Mit dem Finger / Pfeiltasten laufen – geschlagen wird automatisch, sobald der Ball in Reichweite ist.
 * Schlägermitte = gerade, Schlägerrand = schräg (schwerer für den Gegner, aber Aus-Gefahr).
 */

const COURT_H = 430;      // Platz
const CTRL = 92;          // Steuerstreifen darunter – dort wischen, damit der Daumen die Figur nicht verdeckt
const H = COURT_H + CTRL;
const FIG = 34;
const REACH = 30;        // Reichweite des Schlägers (seitlich)
const LIVES = 3;

type Phase = "start" | "spiel" | "ende";
type Court = { l: number; r: number; t: number; b: number };
/** Was zum Zeichnen gebraucht wird (Spiel gegen Computer und Live-Match) */
type Scene = {
  px: number; ox: number; swingMe: number; swingOpp: number; sideMe: number; sideOpp: number;
  ball: { x: number; y: number; fromY: number; toY: number; live: boolean };
  trail: { x: number; y: number }[]; marks: { x: number; y: number; out: boolean; t: number }[];
  msg: string; msgT: number; over: boolean; overText?: string;
};
const ALLEY = 0.12; // Einzel: die äußeren Streifen (Doppelfeld) sind Aus
const singlesOf = (c: { l: number; r: number }) => { const i = (c.r - c.l) * ALLEY; return { l: c.l + i, r: c.r - i }; };
const OPP_KEY = "wg-tennis-gegner";

/** Schläger auf der Seite, auf der der Ball kommt (side 1 = rechts/Vorhand, -1 = links/Rückhand) */
function racket(ctx: CanvasRenderingContext2D, x: number, y: number, swing: number, color: string, side: number, top: boolean) {
  ctx.save(); ctx.translate(x + side * 10, y);
  ctx.scale(side, top ? -1 : 1);
  ctx.rotate(0.5 - swing * 5);
  ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(16, 0); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(25, 0, 9, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

/** Platz, Ball, Schläger und Meldungen zeichnen – genutzt vom Spiel gegen den Computer und vom Live-Match */
function drawTennis(ctx: CanvasRenderingContext2D, W: number, c: Court, st: Scene, colors: { me: string; opp: string }) {
  // Hintergrund + Platz (Sand)
  ctx.fillStyle = "#3f8f5a"; ctx.fillRect(0, 0, W, COURT_H);
  // Steuerstreifen mit Markierung, wo die eigene Figur gerade steht
  ctx.fillStyle = "#24533a"; ctx.fillRect(0, COURT_H, W, CTRL);
  ctx.fillStyle = "rgba(255,255,255,.12)";
  ctx.beginPath(); ctx.roundRect(14, COURT_H + 22, W - 28, CTRL - 44, (CTRL - 44) / 2); ctx.fill();
  ctx.fillStyle = colors.me; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(Math.max(14, Math.min(W - 42, st.px - 14)), COURT_H + 18, 28, CTRL - 36, 8); ctx.fill(); ctx.stroke();
  ctx.font = "700 13px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.fillText("◀  hier wischen  ▶", W / 2, COURT_H + CTRL - 6);
  ctx.fillStyle = "#d9773f"; ctx.fillRect(c.l - 14, c.t - 26, c.r - c.l + 28, c.b - c.t + 52);
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.5;
  ctx.strokeRect(c.l, c.t, c.r - c.l, c.b - c.t);
  const mid = (c.t + c.b) / 2, inset = (c.r - c.l) * ALLEY;
  // Doppelfeld etwas dunkler, damit klar ist: das ist Aus
  ctx.fillStyle = "rgba(0,0,0,.12)";
  ctx.fillRect(c.l, c.t, inset, c.b - c.t); ctx.fillRect(c.r - inset, c.t, inset, c.b - c.t);
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

  // Aufsprung-Abdrücke: weiß = drin, rot = Aus
  for (const m of st.marks) {
    ctx.globalAlpha = Math.min(1, m.t);
    ctx.strokeStyle = m.out ? "#dc2626" : "#ffffff"; ctx.lineWidth = m.out ? 3 : 2;
    ctx.beginPath(); ctx.ellipse(m.x, m.y, 7, 4, 0, 0, Math.PI * 2); ctx.stroke();
    if (m.out) { ctx.font = "800 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#dc2626"; ctx.fillText("AUS", m.x, m.y - 9); }
  }
  ctx.globalAlpha = 1;
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
  racket(ctx, st.px, c.b - 14, st.swingMe, colors.me, st.sideMe, false);
  // Hand der Gegnerin/des Gegners: ~19 px über den Füßen (Füße bei c.t + 4)
  racket(ctx, st.ox, c.t - 15, st.swingOpp, colors.opp, st.sideOpp, false);

  // Meldung
  if (st.msgT > 0 || st.over) {
    const text = st.over ? (st.overText ?? "Spiel vorbei!") : st.msg;
    ctx.globalAlpha = st.over ? 1 : Math.min(1, st.msgT * 2);
    ctx.font = "800 26px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.lineJoin = "round";
    ctx.lineWidth = 6; ctx.strokeStyle = "#ffffff"; ctx.strokeText(text, W / 2, (c.t + c.b) / 2 - 18);
    ctx.fillStyle = "#0f172a"; ctx.fillText(text, W / 2, (c.t + c.b) / 2 - 18);
    ctx.globalAlpha = 1;
  }
}

export function TennisGame({ onResult, live }: { onResult?: (score: number, best: boolean) => void; live?: LiveTennisProps }) {
  const { members, everyone, me, myId } = useWG();
  // Gegner frei wählbar: alle Mitbewohner außer einem selbst – alle spielen gleich stark
  const candidates = [...members].sort((a, b) => a.sort - b.sort).filter((m) => m.id !== myId);
  const [oppId, setOppId] = useState<string | null>(() => { try { return localStorage.getItem(OPP_KEY); } catch { return null; } });
  const opponent = candidates.find((m) => m.id === oppId) ?? candidates.find((m) => m.sort === 2) ?? candidates[0];
  const pick = (id: string) => { setOppId(id); try { localStorage.setItem(OPP_KEY, id); } catch { /* egal */ } };
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

  const liveOpp = live?.match ? everyone.find((m) => m.id === live.match!.opponentId) : null; // auch Gäste
  if (live?.match && liveOpp) return <LiveTennisMatch key={live.match.matchId} me={me} opponent={liveOpp} match={live.match} onEnd={live.onMatchEnd} onFinished={live.onFinished} />;
  if (live?.watching) {
    const h = everyone.find((m) => m.id === live.watching!.host), g = everyone.find((m) => m.id === live.watching!.guest);
    if (h && g) return <SpectateMatch key={live.watching.id} matchId={live.watching.id} host={h} guest={g} onEnd={live.onStopWatching} />;
  }

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
        </>
      )}
      {candidates.length > 1 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Gegen wen spielst du?</p>
          <div className="flex flex-wrap justify-center gap-2">
            {candidates.map((m) => (
              <button key={m.id} onClick={() => pick(m.id)}
                className={`flex items-center gap-1.5 rounded-2xl border-2 py-1 pl-1 pr-3 text-sm font-semibold transition active:scale-[.98] ${opponent.id === m.id ? "border-accent bg-accent/10" : "border-line"}`}>
                <AvatarFigure look={lookOf(m)} size={26} /> {m.display_name}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Alle spielen gleich stark.</p>
        </div>
      )}
      <button onClick={() => setPhase("spiel")} className="w-full rounded-2xl bg-accent py-3 text-lg font-semibold text-white active:scale-[.98]">
        {phase === "ende" ? `Nochmal gegen ${opponent.display_name}` : `Aufschlag gegen ${opponent.display_name}!`}
      </button>
      {live && (
        <div className="rounded-2xl border-2 border-red-500/40 p-3">
          <p className="mb-2 flex items-center justify-center gap-1.5 text-sm font-semibold"><span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />Live gegen alle, die online sind</p>
          <p className="-mt-1 mb-2 text-xs text-muted">{RULES_SHORT}</p>
          {live.pendingTo ? (
            <div className="space-y-2">
              <p className="animate-pulse text-sm">Warte auf {everyone.find((m) => m.id === live.pendingTo)?.display_name} …</p>
              <button onClick={live.onCancel} className="rounded-xl border border-line px-3 py-1.5 text-sm font-semibold">Abbrechen</button>
            </div>
          ) : live.online.length ? (
            <div className="flex flex-wrap justify-center gap-2">
              {live.online.map((m) => {
                const mm = live.busy[m.id];
                if (mm) {
                  // Spielt gerade → nicht einladbar, aber zuschauen geht (ein Knopf pro Match)
                  if (mm.guest === m.id && live.online.some((o) => o.id === mm.host)) return null;
                  const other = everyone.find((o) => o.id === (mm.host === m.id ? mm.guest : mm.host));
                  return (
                    <button key={m.id} onClick={() => live.onWatch(mm)}
                      className="flex items-center gap-1.5 rounded-2xl border-2 border-red-500/60 py-1 pl-1 pr-3 text-sm font-semibold active:scale-[.98]">
                      <AvatarFigure look={lookOf(m)} size={26} /> 🎾 {m.display_name} vs. {other?.display_name ?? "?"} · 👀 Zuschauen
                    </button>
                  );
                }
                return (
                  <button key={m.id} onClick={() => live.onInvite(m.id)}
                    className="flex items-center gap-1.5 rounded-2xl bg-red-600 py-1 pl-1 pr-3 text-sm font-semibold text-white active:scale-[.98]">
                    <span className="rounded-xl bg-white/90"><AvatarFigure look={lookOf(m)} size={26} /></span> {m.display_name} herausfordern
                  </button>
                );
              })}
            </div>
          ) : <p className="text-sm text-muted">Gerade ist niemand sonst im WG-Spiel.</p>}
          {live.declinedBy && <p className="mt-2 text-xs text-muted">{everyone.find((m) => m.id === live.declinedBy)?.display_name} hat gerade keine Zeit. 🙅</p>}
        </div>
      )}
      <Leaderboard scores={tennisScores} error={dbErr} />
      <TennisStats />
      <ul className="mx-auto max-w-xs space-y-1 text-left text-sm text-muted">
        <li>👆 <b>Im grünen Streifen unter dem Platz</b> hin- und herwischen (oder ← →)</li>
        <li>🎾 Geschlagen wird automatisch, wenn der Ball nah genug ist</li>
        <li>🎯 Schlägermitte = gerade · Schlägerrand = schräg (Aus-Gefahr!) · Einzel: das dunkle Doppelfeld ist Aus</li>
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

    const court = (): Court => ({ l: 34, r: W - 34, t: 46, b: COURT_H - 40 });
    const singles = singlesOf;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const c0 = court();
    const st = {
      px: W / 2, ox: W / 2, oTarget: W / 2,
      ball: { x: W / 2, y: c0.t + 14, vx: 0, vy: 0, fromY: c0.t + 14, toY: c0.b - 14, live: false, byMe: false, bounced: false },
      // Gegner: reagiert verzögert und schätzt bei schrägen Bällen etwas daneben
      oReact: 0, oErr: 0,
      sideMe: 1, sideOpp: -1, // Schlägerseite (wechselt je nachdem, wo der Ball ankommt)
      marks: [] as { x: number; y: number; out: boolean; t: number }[],
      rally: 0, score: 0, returns: 0, winners: 0, lives: LIVES,
      wait: 0.9, swingMe: 0, swingOpp: 0, msg: "", msgT: 0, over: false, overT: 0, t: 0, trail: [] as { x: number; y: number }[],
    };
    // Nur in der Entwicklung: Zustand für automatische Tests sichtbar machen
    if (process.env.NODE_ENV !== "production") (window as unknown as { __tennis?: unknown }).__tennis = { st, court };
    const speed = () => Math.min(560, 250 + st.rally * 14 + st.winners * 6);
    const say = (m: string) => { st.msg = m; st.msgT = 1.1; };

    // Ball von (x,y) zu Zielpunkt schlagen
    function shoot(fromX: number, fromY: number, toX: number, toY: number, byMe: boolean) {
      const s = speed(), dy = toY - fromY, time = Math.abs(dy) / s;
      const vx = (toX - fromX) / time;
      st.ball = { x: fromX, y: fromY, vx, vy: Math.sign(dy) * s, fromY, toY, live: true, byMe, bounced: false };
      if (byMe) { st.oReact = rnd(0.16, 0.3); st.oErr = rnd(-1, 1) * (8 + Math.abs(vx) * 0.12); }
    }
    function serve() {
      const c = court();
      st.ox = W / 2;
      const sg = singles(c);
      shoot(st.ox, c.t + 14, rnd(sg.l + 14, sg.r - 14), c.b - 14, false);
      st.swingOpp = 0.25;
    }
    function pointOver(won: boolean, text: string) {
      st.ball.live = false;
      if (process.env.NODE_ENV !== "production") ((window as unknown as { __tennisLog?: string[] }).__tennisLog ??= []).push(`${text} | Ball von ${st.ball.byMe ? "mir" : "Gegner"} | x=${Math.round(st.ball.x)} Einzelfeld ${Math.round(singles(court()).l)}–${Math.round(singles(court()).r)}`);
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
          // Aufsprung (bei ~68 % des Wegs, wie gezeichnet): hier wird über Aus entschieden – für beide Seiten
          const prog = (b.y - b.fromY) / (b.toY - b.fromY);
          if (!b.bounced && prog >= 0.68) {
            b.bounced = true;
            const sg = singles(c);
            const out = b.x < sg.l - 3 || b.x > sg.r + 3; // Ball auf der Linie = drin
            st.marks.push({ x: b.x, y: b.y, out, t: 1.6 });
            if (out) {
              if (b.byMe) pointOver(false, "Aus! 😬");
              else pointOver(true, "Aus vom Gegner! +5");
            }
          }
          // Gegner läuft zum Ball: erst nach kurzer Reaktionszeit, mit Schätzfehler; wird im Ballwechsel etwas besser
          if (b.vy < 0) {
            const tLeft = (c.t + 14 - b.y) / b.vy;
            st.oTarget = b.x + b.vx * tLeft + st.oErr * Math.min(1, tLeft * 2.5);
          } else st.oTarget = W / 2;
          st.oReact = Math.max(0, st.oReact - dt);
          const oppSpeed = 125 + Math.min(95, st.rally * 3 + st.winners * 4);
          const od = st.oTarget - st.ox;
          if (st.oReact <= 0) st.ox += Math.sign(od) * Math.min(Math.abs(od), oppSpeed * dt);

          // Schläger auf die Ballseite nehmen (Vorhand/Rückhand)
          if (b.live) {
            const arrive = (yy: number) => b.x + b.vx * ((yy - b.y) / b.vy);
            if (b.vy > 0) { const d = arrive(c.b - 14) - st.px; if (Math.abs(d) > 4) st.sideMe = Math.sign(d); }
            else { const d = arrive(c.t + 14) - st.ox; if (Math.abs(d) > 4) st.sideOpp = Math.sign(d); }
          }
          // Ball kommt bei mir an
          if (b.live && b.vy > 0 && b.y >= c.b - 14) {
            if (Math.abs(b.x - st.px) <= REACH && b.x > c.l - 30 && b.x < c.r + 30) {
              const off = Math.max(-1, Math.min(1, (b.x - st.px) / REACH));
              const sg = singles(c), half = (sg.r - sg.l) / 2;
              const toX = W / 2 + off * half * 1.22 + rnd(-10, 10); // Rand = schräg, ganz außen = Aus
              st.rally++; st.returns++; st.score += 1; st.swingMe = 0.25;
              shoot(b.x, c.b - 14, toX, c.t + 14, true);
            } else if (b.y > c.b + 10) pointOver(false, "Verpasst!");
          }
          // Ball kommt beim Gegner an
          if (b.live && b.vy < 0 && b.y <= c.t + 14) {
            if (Math.abs(b.x - st.ox) <= REACH - 2) {
              st.swingOpp = 0.25; st.rally++;
              const sg = singles(c);
              shoot(b.x, c.t + 14, rnd(sg.l + 12, sg.r - 12), c.b - 14, false);
            } else if (b.y < c.t - 10) pointOver(true, "Gewinnschlag! +5");
          }
        }
      } else {
        st.overT += dt;
        if (st.overT > 1.3) { cancelAnimationFrame(raf); overRef.current(st.score, st.returns, st.winners); return; }
      }
      st.swingMe = Math.max(0, st.swingMe - dt); st.swingOpp = Math.max(0, st.swingOpp - dt);
      st.msgT = Math.max(0, st.msgT - dt);
      for (const m of st.marks) m.t -= dt;
      st.marks = st.marks.filter((m) => m.t > 0);

      draw(c);
      if (hudRef.current) hudRef.current.textContent = `${st.score} ${st.score === 1 ? "Punkt" : "Punkte"}`;
      if (livesRef.current) livesRef.current.textContent = "🎾".repeat(Math.max(0, st.lives)) + "·".repeat(LIVES - Math.max(0, st.lives));
      meEl.style.transform = `translate(${st.px - FIG / 2}px, ${c.b - FIG * 1.25 + 6}px)`;
      oppEl.style.transform = `translate(${st.ox - FIG / 2}px, ${c.t - FIG * 1.25 + 4}px)`;
      raf = requestAnimationFrame(frame);
    }

    const draw = (c: Court) => drawTennis(ctx, W, c, st, colors.current);

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
      <p className="text-center text-xs text-muted">Unten im Streifen wischen · Schlägerrand = schräg</p>
    </div>
  );
}

/* ───────────────────────────── Live gegen Mitbewohner ───────────────────────────── */

export type LiveMatch = { matchId: string; opponentId: string; host: boolean };
export type LiveTennisProps = {
  online: Member[];                 // wer gerade im WG-Spiel ist (ohne mich)
  pendingTo: string | null;         // ich habe diese Person eingeladen und warte
  declinedBy: string | null;        // diese Person hat abgelehnt
  onInvite: (id: string) => void;
  onCancel: () => void;
  match: LiveMatch | null;
  onMatchEnd: () => void;
  onFinished: () => void;                                   // Match vorbei (dann wieder einladbar)
  busy: Record<string, { id: string; host: string; guest: string }>; // wer gerade live spielt
  watching: { id: string; host: string; guest: string } | null;
  onWatch: (m: { id: string; host: string; guest: string }) => void;
  onStopWatching: () => void;
};

/**
 * Live-Duell: bis 6 Punkte. Bei 5:5 geht es bis 7, bei 6:6 entscheidet der nächste Punkt.
 * → gewonnen mit 6 Punkten und 2 Vorsprung (6:0 … 6:4) oder mit 7 Punkten (7:5, 7:6).
 */
export const matchWon = (a: number, b: number) => (a >= 6 && a - b >= 2) || a >= 7;
const RULES_SHORT = "bis 6 · bei 5:5 bis 7 · bei 6:6 entscheidet der nächste Punkt";
type Shot = { seq: number; fx: number; tx: number; v: number; rally: number; to: string };
type PointMsg = { seq: number; winner: string; reason: "aus" | "verpasst"; host: number; guest: number; nextServer: string };

/** Live-Match: jedes Handy entscheidet über Treffer/Aus auf seiner eigenen Seite. Übertragen werden nur Schläge, Punkte und Positionen. */
function LiveTennisMatch({ me, opponent, match, onEnd, onFinished }: { me: Member; opponent: Member; match: LiveMatch; onEnd: () => void; onFinished: () => void }) {
  const { household } = useWG();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const meRef = useRef<HTMLDivElement>(null);
  const oppRef = useRef<HTMLDivElement>(null);
  const input = useRef<{ target: number | null; left: boolean; right: boolean }>({ target: null, left: false, right: false });
  const colors = useRef({ me: me.color, opp: opponent.color });
  useEffect(() => { colors.current = { me: me.color, opp: opponent.color }; }, [me.color, opponent.color]);
  const [hud, setHud] = useState({ mine: 0, theirs: 0, status: "Warte auf " + opponent.display_name + " …", ended: "" as "" | "gewonnen" | "verloren" | "abgebrochen" });
  const endRef = useRef(onEnd);
  useEffect(() => { endRef.current = onEnd; }, [onEnd]);
  const finishedRef = useRef(onFinished);
  useEffect(() => { finishedRef.current = onFinished; }, [onFinished]);
  const [viewers, setViewers] = useState(0);
  useEffect(() => { if (hud.ended) finishedRef.current(); }, [hud.ended]);

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
    const court = (): Court => ({ l: 34, r: W - 34, t: 46, b: COURT_H - 40 });
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    // Welt-Koordinaten: x 0…1 über die Platzbreite (aus Sicht des Hosts). Gast sieht den Platz gedreht.
    const toScreenX = (xw: number) => { const c = court(); return c.l + (match.host ? xw : 1 - xw) * (c.r - c.l); };
    const toWorldX = (sx: number) => { const c = court(); const v = (sx - c.l) / (c.r - c.l); return match.host ? v : 1 - v; };
    const hostId = match.host ? me.id : opponent.id;

    const st: Scene & {
      phase: "warten" | "countdown" | "spiel" | "ende"; countdown: number; oppX: number;
      ball: Scene["ball"] & { vx: number; vy: number; toMe: boolean; bounced: boolean; seq: number; rally: number };
      score: { host: number; guest: number }; server: string; serveWait: number; seq: number; lastOppMsg: number;
    } = {
      px: W / 2, ox: W / 2, swingMe: 0, swingOpp: 0, sideMe: 1, sideOpp: -1,
      ball: { x: 0, y: 0, fromY: 0, toY: 1, live: false, vx: 0, vy: 0, toMe: false, bounced: false, seq: 0, rally: 0 },
      trail: [], marks: [], msg: "", msgT: 0, over: false,
      phase: "warten", countdown: 0, oppX: 0.5, score: { host: 0, guest: 0 }, server: hostId, serveWait: 0, seq: 0, lastOppMsg: performance.now(),
    };
    // Nur in der Entwicklung: Zustand für automatische Tests sichtbar machen
    if (process.env.NODE_ENV !== "production") (window as unknown as { __tennisLive?: unknown }).__tennisLive = { st, court };
    const mine = () => (match.host ? st.score.host : st.score.guest);
    const theirs = () => (match.host ? st.score.guest : st.score.host);
    const pushHud = (status: string, ended: "" | "gewonnen" | "verloren" | "abgebrochen" = "") => setHud({ mine: mine(), theirs: theirs(), status, ended });
    const say = (m: string) => { st.msg = m; st.msgT = 1.2; };

    const ch = supabase.channel(`tennis-${match.matchId}`, { config: { presence: { key: me.id }, broadcast: { self: false } } });
    const send = (event: string, payload: object) => { ch.send({ type: "broadcast", event, payload }); };

    // Ball aus einem Schlag (Welt-Daten) lokal starten
    function startBall(s: Shot) {
      const c = court(), toMe = s.to === me.id;
      const fromY = toMe ? c.t + 14 : c.b - 14, toY = toMe ? c.b - 14 : c.t + 14;
      const len = Math.abs(toY - fromY), time = 1 / s.v; // v = Platzlängen pro Sekunde
      const fromX = toScreenX(s.fx), toX = toScreenX(s.tx);
      st.ball = { x: fromX, y: fromY, fromY, toY, live: true, vx: (toX - fromX) / time, vy: Math.sign(toY - fromY) * len / time, toMe, bounced: false, seq: s.seq, rally: s.rally };
      st.trail = [];
      if (toMe) st.swingOpp = 0.25; else st.swingMe = 0.25;
    }
    function shoot(fromScreenX: number, toWorldXv: number, rally: number) {
      const s: Shot = { seq: ++st.seq, fx: toWorldX(fromScreenX), tx: toWorldXv, v: Math.min(1.7, 0.8 + rally * 0.045), rally, to: opponent.id };
      startBall(s); send("shot", s);
    }
    // Punkt entscheiden (nur das Handy, auf dessen Seite der Ball gerade ist)
    function decidePoint(iWon: boolean, reason: "aus" | "verpasst") {
      st.ball.live = false;
      if ((iWon && match.host) || (!iWon && !match.host)) st.score.host++; else st.score.guest++;
      const winner = iWon ? me.id : opponent.id;
      const nextServer = st.server === me.id ? opponent.id : me.id; // Aufschlag wechselt jeden Punkt
      const msg: PointMsg = { seq: st.ball.seq, winner, reason, host: st.score.host, guest: st.score.guest, nextServer };
      send("point", msg);
      applyPoint(msg, true);
    }
    function applyPoint(p: PointMsg, local: boolean) {
      st.score = { host: p.host, guest: p.guest };
      if (!local) st.ball.live = false;
      const iWon = p.winner === me.id;
      say(iWon ? (p.reason === "aus" ? "Aus! Punkt für dich" : "Punkt für dich!") : (p.reason === "aus" ? "Aus! 😬" : `Punkt für ${opponent.display_name}`));
      const a = mine(), b = theirs();
      if (matchWon(a, b) || matchWon(b, a)) {
        st.phase = "ende"; st.over = true;
        const won = a > b;
        st.overText = won ? "Gewonnen! 🏆" : `${opponent.display_name} gewinnt`;
        pushHud("", won ? "gewonnen" : "verloren");
        // Das Ergebnis trägt die Person ein, die gewonnen hat (Match-ID verhindert Doppelte)
        if (won) supabase.from("tennis_matches").insert({ id: match.matchId, household_id: household.id, winner: me.id, loser: opponent.id, winner_points: a, loser_points: b }).then(() => {});
        return;
      }
      st.server = p.nextServer; st.serveWait = 1.3;
      pushHud(st.server === me.id ? "Du schlägst auf" : `${opponent.display_name} schlägt auf`);
    }
    function abort(text: string) {
      if (st.phase === "ende") return;
      st.phase = "ende"; st.over = true; st.overText = text; st.ball.live = false;
      pushHud("", "abgebrochen");
    }

    ch.on("presence", { event: "sync" }, () => {
      const here = Object.keys(ch.presenceState());
      setViewers(here.filter((id) => id !== me.id && id !== opponent.id).length);
      if (st.phase === "warten" && here.includes(opponent.id)) { st.phase = "countdown"; st.countdown = 3.2; pushHud("Gleich geht's los!"); }
    })
      .on("presence", { event: "leave" }, ({ key }) => { if (key === opponent.id) abort("Verbindung weg – Match beendet"); })
      .on("broadcast", { event: "pos" }, ({ payload }) => {
        const p = payload as { x: number; id?: string };
        if (p.id && p.id !== opponent.id) return;
        st.oppX = p.x; st.lastOppMsg = performance.now();
      })
      // Zuschauer fragen nach dem Stand – der Host antwortet
      .on("broadcast", { event: "hello" }, () => { if (match.host) send("state", { host: st.score.host, guest: st.score.guest, ended: st.phase === "ende" }); })
      .on("broadcast", { event: "shot" }, ({ payload }) => {
        st.lastOppMsg = performance.now();
        // Countdown kann auf beiden Handys minimal versetzt enden – ein Aufschlag startet das Spiel dann sofort
        if (st.phase === "countdown") { st.phase = "spiel"; pushHud(""); }
        if (st.phase === "spiel") startBall(payload as Shot);
      })
      .on("broadcast", { event: "point" }, ({ payload }) => { st.lastOppMsg = performance.now(); applyPoint(payload as PointMsg, false); })
      .on("broadcast", { event: "leave" }, () => abort(`${opponent.display_name} hat aufgehört`))
      .subscribe((status) => { if (status === "SUBSCRIBED") ch.track({ at: Date.now() }); });

    let last = performance.now(), raf = 0, lastPos = 0;
    const waitStart = performance.now();
    function frame(now: number) {
      const dt = Math.min(0.033, (now - last) / 1000); last = now;
      const c = court(), sg = singlesOf(c);
      // eigene Figur
      let goal = st.px;
      if (input.current.target != null) goal = input.current.target;
      if (input.current.left) goal = st.px - 60;
      if (input.current.right) goal = st.px + 60;
      const d = goal - st.px;
      st.px = Math.max(c.l - 18, Math.min(c.r + 18, st.px + Math.sign(d) * Math.min(Math.abs(d), 430 * dt)));
      if (now - lastPos > 70 && st.phase !== "warten") { lastPos = now; send("pos", { x: toWorldX(st.px), id: me.id }); }
      // Gegner weich zur gemeldeten Position
      const ot = toScreenX(st.oppX); st.ox += (ot - st.ox) * Math.min(1, dt * 14);

      if (st.phase === "warten" && now - waitStart > 25_000) abort(`${opponent.display_name} ist nicht gekommen`);
      if (st.phase === "countdown") {
        st.countdown -= dt;
        st.msg = st.countdown > 0.2 ? String(Math.ceil(st.countdown - 0.2)) : "Los!"; st.msgT = 0.5;
        if (st.countdown <= 0) { st.phase = "spiel"; st.serveWait = 0.6; pushHud(st.server === me.id ? "Du schlägst auf" : `${opponent.display_name} schlägt auf`); }
      }
      if (st.phase === "spiel") {
        if (now - st.lastOppMsg > 12_000) abort("Verbindung weg – Match beendet");
        // Aufschlag (nur wer dran ist)
        if (!st.ball.live && st.serveWait > 0) {
          st.serveWait -= dt;
          if (st.serveWait <= 0 && st.server === me.id) shoot(st.px, toWorldX(rnd(sg.l + 14, sg.r - 14)), 0);
        }
        const b = st.ball;
        if (b.live) {
          b.x += b.vx * dt; b.y += b.vy * dt;
          st.trail.push({ x: b.x, y: b.y }); if (st.trail.length > 6) st.trail.shift();
          const arrive = (yy: number) => b.x + b.vx * ((yy - b.y) / b.vy);
          if (b.toMe) { const dd = arrive(c.b - 14) - st.px; if (Math.abs(dd) > 4) st.sideMe = Math.sign(dd); }
          else { const dd = arrive(c.t + 14) - st.ox; if (Math.abs(dd) > 4) st.sideOpp = Math.sign(dd); }
          const prog = (b.y - b.fromY) / (b.toY - b.fromY);
          if (!b.bounced && prog >= 0.68) {
            b.bounced = true;
            const out = b.x < sg.l - 3 || b.x > sg.r + 3;
            st.marks.push({ x: b.x, y: b.y, out, t: 1.6 });
            if (out && b.toMe) decidePoint(true, "aus"); // Aus auf meiner Seite → mein Punkt
          }
          if (b.live && b.toMe && b.y >= c.b - 14) {
            if (Math.abs(b.x - st.px) <= REACH && b.x > c.l - 30 && b.x < c.r + 30) {
              const off = Math.max(-1, Math.min(1, (b.x - st.px) / REACH)), half = (sg.r - sg.l) / 2;
              shoot(b.x, toWorldX(W / 2 + off * half * 1.22 + rnd(-10, 10)), b.rally + 1);
            } else if (b.y > c.b + 10) decidePoint(false, "verpasst");
          }
          // Ball beim Gegner: dessen Handy entscheidet – hier nur weiterfliegen und ausblenden
          if (b.live && !b.toMe && b.y < c.t - 30) b.live = false;
        }
      }
      st.swingMe = Math.max(0, st.swingMe - dt); st.swingOpp = Math.max(0, st.swingOpp - dt);
      st.msgT = Math.max(0, st.msgT - dt);
      for (const m of st.marks) m.t -= dt;
      st.marks = st.marks.filter((m) => m.t > 0);

      drawTennis(ctx, W, c, st, colors.current);
      meEl.style.transform = `translate(${st.px - FIG / 2}px, ${c.b - FIG * 1.25 + 6}px)`;
      oppEl.style.transform = `translate(${st.ox - FIG / 2}px, ${c.t - FIG * 1.25 + 4}px)`;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      if (st.phase !== "ende") send("leave", {});
      supabase.removeChannel(ch);
    };
  }, [match, me.id, opponent.id, opponent.display_name, household.id]);

  useEffect(() => {
    const set = (e: KeyboardEvent, v: boolean) => {
      if (e.key === "ArrowLeft" || e.key === "a") { e.preventDefault(); input.current.left = v; input.current.target = null; }
      if (e.key === "ArrowRight" || e.key === "d") { e.preventDefault(); input.current.right = v; input.current.target = null; }
    };
    const down = (e: KeyboardEvent) => set(e, true), up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);
  const toTarget = (e: React.PointerEvent) => { const r = wrapRef.current!.getBoundingClientRect(); input.current.target = e.clientX - r.left; };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold">Du <b className="text-lg tabular-nums">{hud.mine}</b> : <b className="text-lg tabular-nums">{hud.theirs}</b> {opponent.display_name}</span>
        <span className="flex items-center gap-1 text-xs font-semibold text-red-600">{viewers > 0 && <span className="mr-1 text-muted">👀 {viewers}</span>}<span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />LIVE</span>
      </div>
      <p className="text-center text-xs text-muted">{hud.status || (hud.mine === 6 && hud.theirs === 6 ? "6:6 – der nächste Punkt entscheidet!" : hud.mine >= 5 && hud.theirs >= 5 ? "Verlängerung: bis 7" : RULES_SHORT)}</p>
      <div ref={wrapRef} className="relative mx-auto max-w-md touch-none select-none overflow-hidden rounded-2xl" style={{ height: H }}
        onPointerDown={(e) => { e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId); toTarget(e); }}
        onPointerMove={(e) => { if (e.buttons || e.pointerType === "touch") toTarget(e); }}
        role="application" aria-label="Live-Tennis: Finger hin- und herziehen zum Laufen">
        <canvas ref={canvasRef} className="absolute inset-0" />
        <div ref={oppRef} className="pointer-events-none absolute left-0 top-0 will-change-transform" style={{ width: FIG }}>
          <AvatarFigure look={lookOf(opponent)} size={FIG} />
        </div>
        <div ref={meRef} className="pointer-events-none absolute left-0 top-0 will-change-transform" style={{ width: FIG }}>
          <AvatarFigure look={lookOf(me)} size={FIG} />
        </div>
      </div>
      {hud.ended && (
        <button onClick={() => endRef.current()} className="w-full rounded-2xl bg-accent py-3 font-semibold text-white">
          {hud.ended === "gewonnen" ? "🏆 Zurück" : "Zurück"}
        </button>
      )}
    </div>
  );
}

/** Statistik: wer hat wie oft gegen wen gewonnen */
export function TennisStats() {
  const { everyone } = useWG();
  const { rows, loaded } = useRows<TennisMatch>("tennis_matches", "created_at", false);
  const name = (id: string) => everyone.find((m) => m.id === id);
  const pairs = new Map<string, { a: string; b: string; wa: number; wb: number }>();
  const wins = new Map<string, number>();
  for (const r of rows) {
    const [a, b] = [r.winner, r.loser].sort();
    const p = pairs.get(`${a}|${b}`) ?? { a, b, wa: 0, wb: 0 };
    if (r.winner === a) p.wa++; else p.wb++;
    pairs.set(`${a}|${b}`, p);
    wins.set(r.winner, (wins.get(r.winner) ?? 0) + 1);
  }
  const ranking = [...wins.entries()].sort((x, y) => y[1] - x[1]);
  return (
    <div className="rounded-2xl border border-line p-3 text-left">
      <p className="mb-2 text-center text-sm font-semibold">📊 Live-Statistik: wer gegen wen</p>
      {loaded && rows.length === 0 && <p className="py-2 text-center text-sm text-muted">Noch kein Live-Match gespielt.</p>}
      {ranking.length > 0 && (
        <p className="mb-2 text-center text-xs text-muted">
          Siege: {ranking.map(([id, n]) => `${name(id)?.display_name ?? "?"} ${n}`).join(" · ")}
        </p>
      )}
      <div className="space-y-1.5">
        {[...pairs.values()].sort((x, y) => (y.wa + y.wb) - (x.wa + x.wb)).map((p) => {
          const A = name(p.a), B = name(p.b);
          return (
            <div key={`${p.a}|${p.b}`} className="flex items-center gap-2 rounded-xl bg-line/30 px-2 py-1.5 text-sm">
              <AvatarFigure look={A ? lookOf(A) : lookOf(everyone[0])} size={20} />
              <span className="min-w-0 flex-1 truncate text-right font-medium">{A?.display_name ?? "?"}</span>
              <b className={`tabular-nums ${p.wa > p.wb ? "text-green-700 dark:text-green-400" : ""}`}>{p.wa}</b>
              <span className="text-muted">:</span>
              <b className={`tabular-nums ${p.wb > p.wa ? "text-green-700 dark:text-green-400" : ""}`}>{p.wb}</b>
              <span className="min-w-0 flex-1 truncate font-medium">{B?.display_name ?? "?"}</span>
              <AvatarFigure look={B ? lookOf(B) : lookOf(everyone[0])} size={20} />
            </div>
          );
        })}
      </div>
      {rows.length > 0 && (
        <p className="mt-2 text-center text-[11px] text-muted">
          Zuletzt: {name(rows[0].winner)?.display_name} schlägt {name(rows[0].loser)?.display_name} {rows[0].winner_points}:{rows[0].loser_points}
        </p>
      )}
    </div>
  );
}

/** Zuschauen: Match aus Sicht des Hosts (unten). Ball, Punkte und Positionen kommen live aus dem Match-Kanal. */
function SpectateMatch({ matchId, host, guest, onEnd }: { matchId: string; host: Member; guest: Member; onEnd: () => void }) {
  const { myId } = useWG();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const guestRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState({ host: 0, guest: 0, status: "Verbinde …", ended: false });
  const colors = useRef({ me: host.color, opp: guest.color });
  useEffect(() => { colors.current = { me: host.color, opp: guest.color }; }, [host.color, guest.color]);

  useEffect(() => {
    const canvas = canvasRef.current!, wrap = wrapRef.current!, hostEl = hostRef.current!, guestEl = guestRef.current!;
    const ctx = canvas.getContext("2d")!;
    let W = wrap.clientWidth;
    const resize = () => {
      W = wrap.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr; canvas.height = COURT_H * dpr;
      canvas.style.width = `${W}px`; canvas.style.height = `${COURT_H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    const court = (): Court => ({ l: 34, r: W - 34, t: 46, b: COURT_H - 40 });
    const toScreenX = (xw: number) => { const c = court(); return c.l + xw * (c.r - c.l); };
    const st: Scene & { hx: number; gx: number; ball: Scene["ball"] & { vx: number; vy: number; bounced: boolean; toHost: boolean }; ended: boolean } = {
      px: W / 2, ox: W / 2, hx: 0.5, gx: 0.5, swingMe: 0, swingOpp: 0, sideMe: 1, sideOpp: -1,
      ball: { x: 0, y: 0, fromY: 0, toY: 1, live: false, vx: 0, vy: 0, bounced: false, toHost: false },
      trail: [], marks: [], msg: "", msgT: 0, over: false, ended: false,
    };
    const say = (m: string) => { st.msg = m; st.msgT = 1.2; };
    const finish = (text: string) => { if (st.ended) return; st.ended = true; st.over = true; st.overText = text; st.ball.live = false; setHud((h) => ({ ...h, ended: true, status: "" })); };
    const scoreUpdate = (h: number, g: number) => {
      setHud((x) => ({ ...x, host: h, guest: g, status: "" }));
      if (matchWon(h, g) || matchWon(g, h)) finish(`${h > g ? host.display_name : guest.display_name} gewinnt!`);
    };

    const ch = supabase.channel(`tennis-${matchId}`, { config: { presence: { key: myId }, broadcast: { self: false } } });
    ch.on("broadcast", { event: "pos" }, ({ payload }) => {
      const p = payload as { x: number; id?: string };
      if (p.id === host.id) st.hx = p.x; else if (p.id === guest.id) st.gx = p.x;
    })
      .on("broadcast", { event: "shot" }, ({ payload }) => {
        const s = payload as Shot, c = court(), toHost = s.to === host.id;
        const fromY = toHost ? c.t + 14 : c.b - 14, toY = toHost ? c.b - 14 : c.t + 14;
        const time = 1 / s.v, fromX = toScreenX(s.fx), toX = toScreenX(s.tx);
        st.ball = { x: fromX, y: fromY, fromY, toY, live: true, vx: (toX - fromX) / time, vy: Math.sign(toY - fromY) * Math.abs(toY - fromY) / time, bounced: false, toHost };
        st.trail = [];
        if (toHost) st.swingOpp = 0.25; else st.swingMe = 0.25;
        setHud((h) => (h.status ? { ...h, status: "" } : h));
      })
      .on("broadcast", { event: "point" }, ({ payload }) => {
        const p = payload as PointMsg;
        st.ball.live = false;
        say(`Punkt für ${p.winner === host.id ? host.display_name : guest.display_name}${p.reason === "aus" ? " (Aus)" : ""}`);
        scoreUpdate(p.host, p.guest);
      })
      .on("broadcast", { event: "state" }, ({ payload }) => {
        const p = payload as { host: number; guest: number; ended: boolean };
        scoreUpdate(p.host, p.guest);
        if (p.ended) finish("Match ist schon vorbei");
      })
      .on("broadcast", { event: "leave" }, () => finish("Match abgebrochen"))
      .on("presence", { event: "leave" }, ({ key }) => { if (key === host.id || key === guest.id) finish("Match beendet"); })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { ch.track({ watching: true }); ch.send({ type: "broadcast", event: "hello", payload: {} }); setHud((h) => ({ ...h, status: "Warte auf den nächsten Schlag …" })); }
      });

    let last = performance.now(), raf = 0;
    function frame(now: number) {
      const dt = Math.min(0.033, (now - last) / 1000); last = now;
      const c = court(), sg = singlesOf(c);
      st.px += (toScreenX(st.hx) - st.px) * Math.min(1, dt * 14);
      st.ox += (toScreenX(st.gx) - st.ox) * Math.min(1, dt * 14);
      const b = st.ball;
      if (b.live) {
        b.x += b.vx * dt; b.y += b.vy * dt;
        st.trail.push({ x: b.x, y: b.y }); if (st.trail.length > 6) st.trail.shift();
        const arrive = (yy: number) => b.x + b.vx * ((yy - b.y) / b.vy);
        if (b.toHost) { const d = arrive(c.b - 14) - st.px; if (Math.abs(d) > 4) st.sideMe = Math.sign(d); }
        else { const d = arrive(c.t + 14) - st.ox; if (Math.abs(d) > 4) st.sideOpp = Math.sign(d); }
        if (!b.bounced && (b.y - b.fromY) / (b.toY - b.fromY) >= 0.68) {
          b.bounced = true; st.marks.push({ x: b.x, y: b.y, out: b.x < sg.l - 3 || b.x > sg.r + 3, t: 1.6 });
        }
        if (b.y < c.t - 40 || b.y > c.b + 40) b.live = false;
      }
      st.swingMe = Math.max(0, st.swingMe - dt); st.swingOpp = Math.max(0, st.swingOpp - dt);
      st.msgT = Math.max(0, st.msgT - dt);
      for (const m of st.marks) m.t -= dt;
      st.marks = st.marks.filter((m) => m.t > 0);
      drawTennis(ctx, W, c, st, colors.current);
      // Steuerstreifen gibt es beim Zuschauen nicht – der untere Teil des Canvas ist abgeschnitten
      hostEl.style.transform = `translate(${st.px - FIG / 2}px, ${c.b - FIG * 1.25 + 6}px)`;
      guestEl.style.transform = `translate(${st.ox - FIG / 2}px, ${c.t - FIG * 1.25 + 4}px)`;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); supabase.removeChannel(ch); };
  }, [matchId, host.id, guest.id, host.display_name, guest.display_name, myId]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold">{host.display_name} <b className="text-lg tabular-nums">{hud.host}</b> : <b className="text-lg tabular-nums">{hud.guest}</b> {guest.display_name}</span>
        <span className="flex items-center gap-1 text-xs font-semibold text-red-600">👀 Zuschauen <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" /></span>
      </div>
      <p className="text-center text-xs text-muted">{hud.status || `${host.display_name} unten · ${guest.display_name} oben`}</p>
      <div ref={wrapRef} className="relative mx-auto max-w-md select-none overflow-hidden rounded-2xl" style={{ height: COURT_H }}>
        <canvas ref={canvasRef} className="absolute inset-0" />
        <div ref={guestRef} className="pointer-events-none absolute left-0 top-0 will-change-transform" style={{ width: FIG }}>
          <AvatarFigure look={lookOf(guest)} size={FIG} />
        </div>
        <div ref={hostRef} className="pointer-events-none absolute left-0 top-0 will-change-transform" style={{ width: FIG }}>
          <AvatarFigure look={lookOf(host)} size={FIG} />
        </div>
      </div>
      <button onClick={onEnd} className={`w-full rounded-2xl py-3 font-semibold ${hud.ended ? "bg-accent text-white" : "border border-line"}`}>
        {hud.ended ? "Zurück" : "Zuschauen beenden"}
      </button>
    </div>
  );
}
