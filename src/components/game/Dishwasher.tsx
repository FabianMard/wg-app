"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { GameScore } from "@/lib/types";
import { Leaderboard } from "./Leaderboard";

/**
 * Minispiel: Spülmaschine einräumen – so schnell und so richtig wie möglich.
 * Geschirr kommt nacheinander, man tippt auf den passenden Korb.
 */
// Aufbau wie in der WG: Besteckschublade oben, darunter Ober- und Unterkorb – jeweils mit Fächern zum Sortieren
type Slot = "messer" | "gabeln" | "loeffel" | "glaeser" | "tassen" | "schuesseln" | "teller" | "toepfe";
const RACKS: { id: string; label: string; slots: { id: Slot; label: string; icon: string }[] }[] = [
  { id: "schublade", label: "Besteckschublade (oben)", slots: [
    { id: "messer", label: "Messer", icon: "🔪" }, { id: "gabeln", label: "Gabeln", icon: "🍴" }, { id: "loeffel", label: "Löffel", icon: "🥄" }] },
  { id: "oberkorb", label: "Oberkorb", slots: [
    { id: "glaeser", label: "Gläser", icon: "🥛" }, { id: "tassen", label: "Tassen", icon: "☕" }, { id: "schuesseln", label: "Schüsseln", icon: "🥣" }] },
  { id: "unterkorb", label: "Unterkorb", slots: [
    { id: "teller", label: "Teller", icon: "🍽️" }, { id: "toepfe", label: "Töpfe & Pfannen", icon: "🥘" }] },
];
const rackOf = (slot: Slot) => RACKS.find((r) => r.slots.some((x) => x.id === slot))!.id;
const ITEMS: { icon: string; name: string; slot: Slot }[] = [
  { icon: "🔪", name: "Messer", slot: "messer" }, { icon: "🔪", name: "Buttermesser", slot: "messer" },
  { icon: "🍴", name: "Gabel", slot: "gabeln" }, { icon: "🍴", name: "Kuchengabel", slot: "gabeln" },
  { icon: "🥄", name: "Löffel", slot: "loeffel" }, { icon: "🥄", name: "Teelöffel", slot: "loeffel" },
  { icon: "🥛", name: "Glas", slot: "glaeser" }, { icon: "🍷", name: "Weinglas", slot: "glaeser" }, { icon: "🍺", name: "Bierglas", slot: "glaeser" },
  { icon: "☕", name: "Tasse", slot: "tassen" }, { icon: "🍵", name: "Teetasse", slot: "tassen" },
  { icon: "🥣", name: "Müslischale", slot: "schuesseln" }, { icon: "🥗", name: "Salatschüssel", slot: "schuesseln" },
  { icon: "🍽️", name: "Teller", slot: "teller" }, { icon: "🍽️", name: "Kleiner Teller", slot: "teller" },
  { icon: "🥘", name: "Topf", slot: "toepfe" }, { icon: "🍳", name: "Pfanne", slot: "toepfe" },
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
  const [flash, setFlash] = useState<null | { ok: boolean; slot: Slot }>(null);
  const { myId } = useWG();
  const { rows: scores, reload: reloadScores } = useRows<GameScore>("game_scores", "best", false);
  const [localBest, setLocalBest] = useState(() => { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } });
  const best = Math.max(localBest, scores.find((x) => x.member_id === myId && x.game === "spuelmaschine")?.best ?? 0);
  // Alten Rekord, der bisher nur auf diesem Gerät lag, einmalig in die Bestenliste übernehmen
  useEffect(() => {
    if (localBest > 0) supabase.rpc("submit_score", { p_game: "spuelmaschine", p_score: localBest }).then(() => reloadScores());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
    if (isBest) { setLocalBest(s); setNewBest(true); try { localStorage.setItem(BEST_KEY, String(s)); } catch { /* egal */ } }
    if (s > 0) supabase.rpc("submit_score", { p_game: "spuelmaschine", p_score: s }).then(() => reloadScores());
    onResult?.(s, isBest);
  }, [best, onResult, reloadScores]);

  useEffect(() => {
    if (phase !== "spiel") return;
    if (timeLeft <= 0) { finish(); return; }
    const t = setTimeout(() => setTimeLeft((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, timeLeft, finish]);

  function choose(slot: Slot) {
    if (phase !== "spiel") return;
    const ok = item.slot === slot;
    if (ok) {
      // schneller = mehr Punkte, Serie gibt Bonus
      const ms = Date.now() - shownAt.current;
      const speed = ms < 700 ? 5 : ms < 1100 ? 3 : ms < 1700 ? 1 : 0;
      scoreRef.current += 10 + speed + Math.min(combo, 10);
      setCombo((c) => c + 1); setRight((r) => r + 1);
    } else {
      // richtiger Korb, falsches Fach: kleiner Abzug – ganz falscher Korb: großer Abzug
      scoreRef.current = Math.max(0, scoreRef.current - (rackOf(slot) === rackOf(item.slot) ? 4 : 8));
      setCombo(0); setWrong((w) => w + 1);
    }
    setScore(scoreRef.current);
    setFlash({ ok, slot });
    setTimeout(() => setFlash(null), 180);
    // nie zweimal dasselbe Teil hintereinander
    const pool = ITEMS.filter((x) => x.name !== item.name);
    setItem(pool[Math.floor(Math.random() * pool.length)]);
    shownAt.current = Date.now();
  }

  const accuracy = right + wrong ? Math.round((right / (right + wrong)) * 100) : 0;

  if (phase === "start") {
    return (
      <div className="space-y-4 text-center">
        <p className="text-5xl">🍽️🫧</p>
        <p className="font-semibold">Räum die Spülmaschine ein – so schnell und so richtig wie möglich!</p>
        <ul className="mx-auto max-w-xs space-y-1 text-left text-sm text-muted">
          <li>🍴 <b>Besteckschublade (oben):</b> Messer · Gabeln · Löffel – getrennt!</li>
          <li>⬆️ <b>Oberkorb:</b> Gläser · Tassen · Schüsseln</li>
          <li>⬇️ <b>Unterkorb:</b> Teller · Töpfe &amp; Pfannen</li>
          <li>⏱️ {DURATION} Sekunden · schnell und Serie = Bonus · falsches Fach = Abzug</li>
        </ul>
        <button onClick={start} className="w-full rounded-2xl bg-accent py-3 text-lg font-semibold text-white active:scale-[.98]">Los geht&apos;s!</button>
        <Leaderboard scores={scores.filter((x) => x.game === "spuelmaschine")} />
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
        <Leaderboard scores={scores.filter((x) => x.game === "spuelmaschine")} />
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
      {/* Spülmaschine: Besteckschublade oben, Ober- und Unterkorb mit Fächern */}
      <div className="space-y-2 rounded-2xl bg-neutral-300 p-2 dark:bg-neutral-700">
        {RACKS.map((r) => (
          <div key={r.id} className="rounded-xl bg-neutral-200/80 p-1.5 dark:bg-neutral-800/80">
            <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{r.label}</p>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${r.slots.length}, minmax(0, 1fr))` }}>
              {r.slots.map((x) => (
                <button key={x.id} onClick={() => choose(x.id)}
                  className={`flex flex-col items-center rounded-lg border-2 border-dashed px-1 py-2.5 transition active:scale-95 ${
                    flash?.slot === x.id ? (flash.ok ? "border-emerald-500 bg-emerald-100 dark:bg-emerald-900/40" : "border-red-500 bg-red-100 dark:bg-red-900/40") : "border-neutral-400 bg-neutral-50 dark:bg-neutral-900"}`}>
                  <span className="text-xl opacity-50">{x.icon}</span>
                  <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">{x.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
