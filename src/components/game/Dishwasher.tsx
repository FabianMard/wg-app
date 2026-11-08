"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minispiel: Spülmaschine einräumen – so schnell und so richtig wie möglich.
 * Geschirr kommt nacheinander, man tippt auf den passenden Korb.
 */
type Basket = "oben" | "unten" | "besteck";
const ITEMS: { icon: string; name: string; basket: Basket }[] = [
  { icon: "🍽️", name: "Teller", basket: "unten" },
  { icon: "🥘", name: "Topf", basket: "unten" },
  { icon: "🍳", name: "Pfanne", basket: "unten" },
  { icon: "🥗", name: "Salatschüssel", basket: "unten" },
  { icon: "🥛", name: "Glas", basket: "oben" },
  { icon: "☕", name: "Tasse", basket: "oben" },
  { icon: "🍷", name: "Weinglas", basket: "oben" },
  { icon: "🥣", name: "Müslischale", basket: "oben" },
  { icon: "🍴", name: "Besteck", basket: "besteck" },
  { icon: "🥄", name: "Löffel", basket: "besteck" },
  { icon: "🔪", name: "Messer", basket: "besteck" },
  { icon: "🥢", name: "Stäbchen", basket: "besteck" },
];
const BASKETS: { id: Basket; label: string; hint: string }[] = [
  { id: "oben", label: "Oberkorb", hint: "Gläser, Tassen, Schalen" },
  { id: "unten", label: "Unterkorb", hint: "Teller, Töpfe, Pfannen" },
  { id: "besteck", label: "Besteckkorb", hint: "Besteck" },
];
const DURATION = 30;
const BEST_KEY = "wg-spiel-spuelmaschine-rekord";

const pick = () => ITEMS[Math.floor(Math.random() * ITEMS.length)];

export function Dishwasher({ onResult }: { onResult?: (score: number, best: boolean) => void }) {
  const [phase, setPhase] = useState<"start" | "spiel" | "ende">("start");
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [item, setItem] = useState(pick);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [right, setRight] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [flash, setFlash] = useState<null | { ok: boolean; basket: Basket }>(null);
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } });
  const [newBest, setNewBest] = useState(false);
  const shownAt = useRef(0);
  const scoreRef = useRef(0);

  const start = () => {
    setScore(0); scoreRef.current = 0; setCombo(0); setRight(0); setWrong(0); setNewBest(false);
    setTimeLeft(DURATION); setItem(pick()); shownAt.current = Date.now(); setPhase("spiel");
  };

  const finish = useCallback(() => {
    setPhase("ende");
    const s = scoreRef.current;
    const isBest = s > best;
    if (isBest) { setBest(s); setNewBest(true); try { localStorage.setItem(BEST_KEY, String(s)); } catch { /* egal */ } }
    onResult?.(s, isBest);
  }, [best, onResult]);

  useEffect(() => {
    if (phase !== "spiel") return;
    if (timeLeft <= 0) { finish(); return; }
    const t = setTimeout(() => setTimeLeft((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, timeLeft, finish]);

  function choose(b: Basket) {
    if (phase !== "spiel") return;
    const ok = item.basket === b;
    if (ok) {
      // schneller = mehr Punkte, Serie gibt Bonus
      const ms = Date.now() - shownAt.current;
      const speed = ms < 600 ? 5 : ms < 1000 ? 3 : ms < 1600 ? 1 : 0;
      const gained = 10 + speed + Math.min(combo, 10);
      scoreRef.current += gained;
      setScore(scoreRef.current); setCombo((c) => c + 1); setRight((r) => r + 1);
    } else {
      scoreRef.current = Math.max(0, scoreRef.current - 8);
      setScore(scoreRef.current); setCombo(0); setWrong((w) => w + 1);
    }
    setFlash({ ok, basket: b });
    setTimeout(() => setFlash(null), 180);
    // nie zweimal dasselbe Teil hintereinander (ohne Schleife)
    const pool = ITEMS.filter((x) => x.icon !== item.icon);
    setItem(pool[Math.floor(Math.random() * pool.length)]);
    shownAt.current = Date.now();
  }

  // Tastatur: 1 = oben, 2 = unten, 3 = Besteck
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Basket> = { "1": "oben", "2": "unten", "3": "besteck" };
      if (map[e.key]) { e.preventDefault(); choose(map[e.key]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const accuracy = right + wrong ? Math.round((right / (right + wrong)) * 100) : 0;

  if (phase === "start") {
    return (
      <div className="space-y-4 text-center">
        <p className="text-5xl">🍽️🫧</p>
        <p className="font-semibold">Räum die Spülmaschine ein – so schnell und so richtig wie möglich!</p>
        <ul className="mx-auto max-w-xs space-y-1 text-left text-sm text-muted">
          <li>⬆️ <b>Oberkorb:</b> Gläser, Tassen, Schalen</li>
          <li>⬇️ <b>Unterkorb:</b> Teller, Töpfe, Pfannen</li>
          <li>🍴 <b>Besteckkorb:</b> Besteck</li>
          <li>⏱️ {DURATION} Sekunden · schnell = Bonus · Serie = Bonus · falsch = Abzug</li>
        </ul>
        {best > 0 && <p className="text-sm">🏆 Dein Rekord: <b>{best}</b></p>}
        <button onClick={start} className="w-full rounded-2xl bg-accent py-3 text-lg font-semibold text-white active:scale-[.98]">Los geht&apos;s!</button>
      </div>
    );
  }

  if (phase === "ende") {
    return (
      <div className="space-y-3 text-center">
        <p className="text-5xl">{newBest ? "🏆" : accuracy >= 90 ? "✨" : "🧽"}</p>
        <p className="text-3xl font-bold tabular-nums">{score} Punkte</p>
        {newBest && <p className="font-semibold text-amber-600">Neuer Rekord!</p>}
        <p className="text-sm text-muted">{right} richtig · {wrong} falsch · {accuracy} % Treffer · Rekord {best}</p>
        <p className="text-sm">{accuracy === 100 && right >= 20 ? "Perfekt einsortiert, Spülmaschinen-Profi! 🥇" : accuracy >= 85 ? "Sauber! Fast alles am richtigen Platz." : "Hmm … da klappert es beim Spülen. 😅"}</p>
        <button onClick={start} className="w-full rounded-2xl bg-accent py-3 font-semibold text-white">Nochmal</button>
      </div>
    );
  }

  return (
    <div className="select-none space-y-3">
      <div className="flex items-center justify-between text-sm font-semibold tabular-nums">
        <span>⏱️ {timeLeft}s</span>
        <span>{combo >= 3 && <span className="mr-2 text-amber-600">🔥 {combo}er-Serie</span>}{score} Punkte</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line/60">
        <div className="h-full rounded-full bg-accent transition-all duration-1000 ease-linear" style={{ width: `${(timeLeft / DURATION) * 100}%` }} />
      </div>
      <div className={`flex h-32 flex-col items-center justify-center rounded-2xl border-2 transition-colors ${
        flash ? (flash.ok ? "border-emerald-500 bg-emerald-500/10" : "border-red-500 bg-red-500/10") : "border-line bg-card"}`}>
        <span key={item.icon + score + wrong} className="animate-[pop_.15s_ease-out] text-6xl">{item.icon}</span>
        <span className="mt-1 text-sm text-muted">{item.name}</span>
      </div>
      {/* Spülmaschine mit drei Körben */}
      <div className="space-y-2 rounded-2xl bg-neutral-300 p-2 dark:bg-neutral-700">
        {BASKETS.map((b, i) => (
          <button key={b.id} onClick={() => choose(b.id)}
            className={`flex w-full items-center justify-between rounded-xl border-2 border-dashed px-4 py-4 text-left transition active:scale-[.98] ${
              flash?.basket === b.id ? (flash.ok ? "border-emerald-500 bg-emerald-100 dark:bg-emerald-900/40" : "border-red-500 bg-red-100 dark:bg-red-900/40") : "border-neutral-400 bg-neutral-100 dark:bg-neutral-800"}`}>
            <span>
              <span className="block font-semibold text-neutral-800 dark:text-neutral-100">{b.label}</span>
              <span className="block text-xs text-neutral-500 dark:text-neutral-400">{b.hint}</span>
            </span>
            <kbd className="hidden rounded bg-neutral-300 px-1.5 text-xs text-neutral-600 md:inline">{i + 1}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
}
