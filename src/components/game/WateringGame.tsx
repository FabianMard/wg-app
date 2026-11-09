"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { GameScore } from "@/lib/types";
import { Leaderboard } from "./Leaderboard";

/**
 * Minispiel „Gieß-Roulette in Verenas Dschungel“ – auf Zeit.
 * Finger auf einen Topf halten = gießen. Jede Pflanze hat versteckten Durst, alle trocknen nach und nach aus.
 * Manche Töpfe sind randvoll mit Erde („Erdbomben“) und laufen sofort über → Pfütze.
 * 1. Pfütze: Katze tapst durch · 2.: Frau Lazer klopft · 3.: Game over.
 */

const DURATION = 45;
const MAX_PUDDLES = 3;
const GOOD = [0.45, 0.85] as const;     // grüner Bereich
const PERFECT = [0.6, 0.75] as const;   // „genau richtig“
const CACTUS_MAX = 0.35;                // Kaktus will (fast) nichts

type Kind = "kaktus" | "bambus" | "sonnenblume" | "farn" | "monstera" | "tulpe";
type Pot = {
  kind: Kind; icon: string; name: string;
  level: number;      // 0 = staubtrocken, 1 = randvoll
  thirst: number;     // wie schnell sie austrocknet (pro Sekunde)
  fill: number;       // wie schnell sie beim Gießen voll wird (pro Sekunde)
  bomb: boolean;      // Erdbombe: fast kein Platz für Wasser
  angry: number;      // Kaktus beleidigt (Sekunden)
  splash: number;     // Überlauf-Animation (Sekunden)
  puddle: number;     // Pfützengröße unter dem Topf
};

const PLANTS: Record<Kind, { icon: string; name: string; thirst: number; fill: number }> = {
  kaktus: { icon: "🌵", name: "Kaktus", thirst: 0.004, fill: 0.55 },
  bambus: { icon: "🎋", name: "Bambus", thirst: 0.07, fill: 0.32 },
  sonnenblume: { icon: "🌻", name: "Sonnenblume", thirst: 0.045, fill: 0.5 },
  farn: { icon: "🌿", name: "Farn", thirst: 0.04, fill: 0.5 },
  monstera: { icon: "🪴", name: "Monstera", thirst: 0.035, fill: 0.45 },
  tulpe: { icon: "🌷", name: "Tulpe", thirst: 0.05, fill: 0.6 },
};

function newPots(): Pot[] {
  const kinds: Kind[] = ["kaktus", "bambus", "sonnenblume", "farn", "monstera", "tulpe"];
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  // 2 Erdbomben – nie der Kaktus (der soll ja eh nichts bekommen)
  const bombable = kinds.map((k, i) => (k === "kaktus" ? -1 : i)).filter((i) => i >= 0).sort(() => Math.random() - 0.5).slice(0, 2);
  return kinds.map((k, i) => {
    const p = PLANTS[k], bomb = bombable.includes(i);
    return {
      kind: k, icon: p.icon, name: p.name,
      level: k === "kaktus" ? 0.12 : 0.22 + Math.random() * 0.25,
      thirst: p.thirst * (0.85 + Math.random() * 0.3) * (bomb ? 1.3 : 1),
      fill: bomb ? 3.2 + Math.random() * 1.5 : p.fill * (0.85 + Math.random() * 0.3),
      bomb, angry: 0, splash: 0, puddle: 0,
    };
  });
}

/** Gesicht der Pflanze – der einzige Hinweis, wie voll sie ist */
function mood(p: Pot): { face: string; text: string } {
  if (p.splash > 0) return { face: "🌊", text: "Läuft über!" };
  if (p.kind === "kaktus") {
    if (p.angry > 0 || p.level > CACTUS_MAX) return { face: "😠", text: "Bin ein KAKTUS!" };
    return { face: "😎", text: "Alles gut so" };
  }
  if (p.level < 0.18) return { face: "😫", text: "Durst!!" };
  if (p.level < GOOD[0]) return { face: "😐", text: "Ein bisschen …" };
  if (p.level >= PERFECT[0] && p.level <= PERFECT[1]) return { face: "😍", text: "Genau richtig!" };
  if (p.level <= GOOD[1]) return { face: "🙂", text: "Schön feucht" };
  return { face: "😰", text: "Stopp! Voll!" };
}

const RANKS: [number, string][] = [
  [0, "🌱 Gießkannen-Grünschnabel"], [90, "🪴 Topfpflanzen-Praktikant:in"], [170, "🌿 Blattflüsterer:in"],
  [250, "🌻 Verenas Vertretung des Vertrauens"], [330, "🌳 Dschungel-Flüsterer:in"],
];
const rankOf = (score: number) => [...RANKS].reverse().find(([min]) => score >= min)![1];

/** Kleine Töne (Gluck-gluck wird höher, je voller; Klopfen von unten) */
function useSounds() {
  const ctxRef = useRef<AudioContext | null>(null);
  const ac = () => {
    if (!ctxRef.current) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current = new C();
    }
    return ctxRef.current;
  };
  const tone = useCallback((freq: number, dur: number, type: OscillatorType = "sine", vol = 0.08) => {
    try {
      const c = ac(), o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur);
    } catch { /* kein Ton – egal */ }
  }, []);
  const gluck = useCallback((level: number) => tone(220 + level * 520, 0.09, "sine", 0.07), [tone]);
  const knock = useCallback(() => { [0, 0.18, 0.36].forEach((t) => setTimeout(() => tone(95, 0.12, "square", 0.12), t * 1000)); }, [tone]);
  const splash = useCallback(() => tone(140, 0.35, "sawtooth", 0.05), [tone]);
  useEffect(() => () => { ctxRef.current?.close().catch(() => {}); }, []);
  return { gluck, knock, splash, unlock: () => { try { ac().resume(); } catch { /* egal */ } } };
}

export function WateringGame({ onResult }: { onResult?: (score: number, best: boolean) => void }) {
  const { myId } = useWG();
  const [phase, setPhase] = useState<"start" | "spiel" | "ende">("start");
  const [result, setResult] = useState<{ score: number; puddles: number; reason: "zeit" | "pfuetzen"; best: boolean } | null>(null);
  const [dbErr, setDbErr] = useState<string | null>(null);
  const { rows: scores, reload } = useRows<GameScore>("game_scores", "best", false);
  const myScores = scores.filter((s) => s.game === "giessen");
  const myBest = myScores.find((s) => s.member_id === myId)?.best ?? 0;

  const finish = useCallback((score: number, puddles: number, reason: "zeit" | "pfuetzen") => {
    const best = score > myBest;
    setResult({ score, puddles, reason, best });
    setPhase("ende");
    if (score > 0) supabase.rpc("submit_score", { p_game: "giessen", p_score: score }).then(({ error }) => {
      setDbErr(error ? (/game_scores|submit_score|check constraint/i.test(error.message)
        ? "Rekord konnte nicht gespeichert werden: Bitte supabase/018_spiele.sql im SQL Editor ausführen."
        : `Rekord konnte nicht gespeichert werden: ${error.message}`) : null);
      reload();
    });
    onResult?.(score, best);
  }, [myBest, onResult, reload]);

  if (phase === "spiel") return <WateringRound onOver={finish} />;

  return (
    <div className="space-y-4 text-center">
      {phase === "ende" && result ? (
        <>
          {result.reason === "pfuetzen" ? (
            <div className="mx-auto max-w-xs rounded-2xl bg-line/40 p-3 text-left">
              <p className="text-xs text-muted">📱 Neue Nachricht von <b>Verena</b></p>
              <p className="mt-1 font-bold">WAS IST MIT MEINEM BODEN PASSIERT 😱💦</p>
            </div>
          ) : <p className="text-5xl">{result.best ? "🏆" : "🌿"}</p>}
          <p className="text-3xl font-bold tabular-nums">{result.score} Punkte</p>
          {result.best && <p className="font-semibold text-amber-600">Neuer Rekord!</p>}
          <p className="text-sm text-muted">{result.reason === "zeit" ? "Zeit um!" : "Drei Pfützen …"} · {result.puddles} {result.puddles === 1 ? "Pfütze" : "Pfützen"}</p>
          <p className="rounded-2xl bg-accent/10 px-3 py-2 text-sm">Verenas Zeugnis: <b>{rankOf(result.score)}</b></p>
        </>
      ) : (
        <>
          <p className="text-5xl">🪴💧</p>
          <div className="mx-auto max-w-xs rounded-2xl bg-line/40 p-3 text-left">
            <p className="text-xs text-muted">📱 Nachricht von <b>Verena</b></p>
            <p className="mt-1">Bin übers Wochenende weg. Bitte alle gießen. Aber nicht zu viel!!! 🙏</p>
          </div>
        </>
      )}
      <button onClick={() => setPhase("spiel")} className="w-full rounded-2xl bg-accent py-3 text-lg font-semibold text-white active:scale-[.98]">
        {phase === "ende" ? "Nochmal" : "Gießkanne nehmen 💧"}
      </button>
      <Leaderboard scores={myScores} error={dbErr} />
      <ul className="mx-auto max-w-xs space-y-1 text-left text-sm text-muted">
        <li>👆 <b>Finger auf einen Topf halten</b> = gießen, loslassen = stopp</li>
        <li>😍 Gesichter verraten, wie es der Pflanze geht – alle trocknen langsam aus</li>
        <li>🟫 Vorsicht: Manche Töpfe sind randvoll mit Erde und laufen <b>sofort</b> über</li>
        <li>🌵 Der Kaktus will gar nichts · 🎋 der Bambus säuft viel</li>
        <li>⏱️ {DURATION} Sekunden · {MAX_PUDDLES} Pfützen = Game over</li>
      </ul>
    </div>
  );
}

function WateringRound({ onOver }: { onOver: (score: number, puddles: number, reason: "zeit" | "pfuetzen") => void }) {
  const pots = useRef<Pot[]>(newPots());
  const st = useRef({ t: 0, score: 0, puddles: 0, pouring: -1, over: false, lastGluck: 0, cat: -1, lazer: -1 });
  const [, setTick] = useState(0);
  const overRef = useRef(onOver);
  useEffect(() => { overRef.current = onOver; }, [onOver]);
  const sounds = useSounds();
  const soundsRef = useRef(sounds);
  useEffect(() => { soundsRef.current = sounds; }, [sounds]);

  useEffect(() => {
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const s = st.current;
      if (!s.over) {
        s.t += dt;
        const speedUp = 1 + s.t / DURATION; // gegen Ende trocknet alles schneller aus
        pots.current.forEach((p, i) => {
          p.level = Math.max(0, p.level - p.thirst * speedUp * dt);
          p.angry = Math.max(0, p.angry - dt);
          p.splash = Math.max(0, p.splash - dt);
          if (s.pouring === i) {
            p.level += p.fill * dt;
            if (now - s.lastGluck > 110) { soundsRef.current.gluck(Math.min(1, p.level)); s.lastGluck = now; }
            if (p.kind === "kaktus" && p.level > CACTUS_MAX && p.angry <= 0) { p.angry = 1.5; s.score = Math.max(0, s.score - 5); }
            if (p.level > 1) {
              // Überlauf → Pfütze
              p.level = 0.92; p.splash = 1.2; p.puddle = Math.min(1, p.puddle + 0.6);
              s.pouring = -1; s.puddles++;
              soundsRef.current.splash();
              if (s.puddles === 1) s.cat = s.t;
              if (s.puddles === 2) { s.lazer = s.t; soundsRef.current.knock(); }
              if (s.puddles >= MAX_PUDDLES) { s.over = true; setTimeout(() => overRef.current(Math.round(s.score), s.puddles, "pfuetzen"), 1600); }
            }
          }
          // Punkte: Pflanze im grünen Bereich (Kaktus: trocken genug)
          if (p.kind === "kaktus") { if (p.level <= CACTUS_MAX && p.angry <= 0) s.score += dt * 1.2; }
          else if (p.level >= PERFECT[0] && p.level <= PERFECT[1]) s.score += dt * 2.2;
          else if (p.level >= GOOD[0] && p.level <= GOOD[1]) s.score += dt * 1.4;
        });
        if (s.t >= DURATION && !s.over) { s.over = true; s.pouring = -1; setTimeout(() => overRef.current(Math.round(s.score), s.puddles, "zeit"), 700); }
      }
      setTick((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const stop = () => { st.current.pouring = -1; };
    window.addEventListener("pointerup", stop); window.addEventListener("pointercancel", stop); window.addEventListener("blur", stop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); window.removeEventListener("blur", stop); };
  }, []);

  const s = st.current;
  const left = Math.max(0, Math.ceil(DURATION - s.t));
  const catOn = s.cat >= 0 && s.t - s.cat < 2.6;
  const lazerOn = s.lazer >= 0 && s.t - s.lazer < 2.5;

  return (
    <div className="relative select-none space-y-3">
      <div className="flex items-center justify-between text-sm font-semibold">
        <span className={`tabular-nums ${left <= 10 ? "text-red-600" : ""}`}>⏱️ {left} s</span>
        <span>{Array.from({ length: MAX_PUDDLES }, (_, i) => (i < s.puddles ? "💦" : "▫️")).join(" ")}</span>
        <span className="tabular-nums">{Math.round(s.score)} Punkte</span>
      </div>
      <div className="grid grid-cols-3 gap-2 rounded-2xl p-2" style={{ background: "color-mix(in srgb, #ec4899 10%, #f3e6cf)" }}>
        {pots.current.map((p, i) => {
          const m = mood(p), pouring = s.pouring === i;
          return (
            <button key={i} type="button" aria-label={`${p.name} gießen`}
              onPointerDown={(e) => { e.preventDefault(); if (!s.over) { sounds.unlock(); s.pouring = i; } }}
              onPointerLeave={() => { if (s.pouring === i) s.pouring = -1; }}
              onContextMenu={(e) => e.preventDefault()}
              className={`relative flex h-36 touch-none flex-col items-center justify-end overflow-visible rounded-xl pb-2 transition ${pouring ? "bg-sky-200/50" : "bg-white/40"}`}>
              {/* Gießkanne + Wasserstrahl */}
              {pouring && (
                <span className="pointer-events-none absolute -top-1 right-1 text-2xl" style={{ transform: "rotate(-35deg)" }}>🚿</span>
              )}
              {pouring && <span className="pointer-events-none absolute right-5 top-6 h-10 w-1 animate-pulse rounded bg-sky-400/80" />}
              {/* Stimmung */}
              <span className="absolute left-1 top-1 max-w-[calc(100%-8px)] truncate rounded-full bg-white/80 px-1.5 text-[11px] font-semibold leading-5 text-neutral-700">{m.face} {m.text}</span>
              {p.angry > 0 && <span className="absolute inset-x-0 top-7 text-center text-lg">💢</span>}
              {/* Pflanze */}
              <span className={`text-4xl transition-transform ${p.level < 0.18 && p.kind !== "kaktus" ? "rotate-12 opacity-70" : ""}`} style={{ transform: p.splash > 0 ? "scale(1.1)" : undefined }}>{p.icon}</span>
              {/* Topf mit Erde – Erdbomben haben etwas dunklere, glänzende Erde */}
              <span className="relative mt-0.5 block h-7 w-16 overflow-hidden rounded-b-xl rounded-t-sm border-2 border-[#7c2d12] bg-[#c2410c]">
                <span className="absolute inset-x-0 top-0 h-2" style={{ background: p.bomb ? "#4d3020" : "#5b3a24", boxShadow: p.bomb ? "inset 0 1px 0 rgba(255,255,255,.18)" : undefined }} />
              </span>
              {/* Überlauf + Pfütze */}
              {p.splash > 0 && <span className="pointer-events-none absolute bottom-6 text-xl">💦</span>}
              {p.puddle > 0 && (
                <span className="pointer-events-none absolute -bottom-1 rounded-[50%] bg-sky-400/60" style={{ width: `${50 + p.puddle * 40}%`, height: 8 + p.puddle * 6 }} />
              )}
            </button>
          );
        })}
      </div>
      {/* 1. Pfütze: die WG-Katze tapst durch */}
      {catOn && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-8 overflow-hidden">
          <span className="absolute whitespace-nowrap text-xl" style={{ left: `${-30 + ((s.t - s.cat) / 2.6) * 130}%` }}>🐈 🐾 🐾 🐾 🐾</span>
        </div>
      )}
      {/* 2. Pfütze: Frau Lazer klopft */}
      {lazerOn && (
        <div className="pointer-events-none absolute inset-x-2 top-10 animate-[pop_.2s_ease-out] rounded-2xl border-2 border-amber-500 bg-amber-50 p-3 text-center text-amber-900 shadow-lg">
          <p className="text-xs font-semibold">🚪 *klopf klopf klopf*</p>
          <p className="font-bold">„Frau Lazer aus dem 2. Stock: Bei mir tropft&apos;s von der Decke!“ 🧓☝️</p>
        </div>
      )}
      {s.over && s.puddles >= MAX_PUDDLES && (
        <div className="pointer-events-none absolute inset-x-6 top-1/3 rounded-2xl bg-neutral-900/90 p-3 text-center text-white shadow-xl">
          <p className="text-xs opacity-70">📱 Verena</p>
          <p className="font-bold">WAS IST MIT MEINEM BODEN PASSIERT</p>
        </div>
      )}
      <p className="text-center text-xs text-muted">Finger auf den Topf halten = gießen · Gesichter beachten!</p>
    </div>
  );
}
