"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWG } from "@/lib/wg";
import { Leaderboard } from "./Leaderboard";
import { useGameScore } from "./useGameScore";

/**
 * Minispiel „Kurier durch Leipzig“: Route planen, dann fährt das Rad los.
 * Fahrradstraßen sind schnell, Kopfstein langsam, an Ampeln wartet man, auf Straßenbahnschienen kann man stürzen.
 * Baustellen sperren jede Lieferung andere Straßen. Regnet es gerade wirklich in Leipzig, wird alles rutschiger.
 */

const COLS = 10, ROWS = 13;
const GAME_SECONDS = 90, WARM_SECONDS = 30;
type Kind = "haus" | "r" | "f" | "k" | "s" | "a";
const STREET_ROWS = [0, 4, 8, 12], STREET_COLS = [0, 3, 6, 9];
const LIGHTS = new Set(["3,4", "6,4", "3,8", "6,8", "6,12"]);

function kindAt(x: number, y: number): Kind {
  const row = STREET_ROWS.includes(y), col = STREET_COLS.includes(x);
  if (!row && !col) return "haus";
  if (row && col) return LIGHTS.has(`${x},${y}`) ? "a" : "r";
  if (row) return y === 0 ? "k" : y === 8 ? "s" : "r";
  return x === 3 ? "f" : x === 9 ? "k" : "r";
}
/** Sekunden pro Feld */
const COST: Record<Exclude<Kind, "haus">, number> = { r: 0.45, f: 0.26, k: 0.8, s: 0.45, a: 0.45 };
const KIND_INFO: Record<Exclude<Kind, "haus">, { label: string; tip: string }> = {
  r: { label: "Straße", tip: "normal" },
  f: { label: "Fahrradstraße", tip: "schnell" },
  k: { label: "Kopfsteinpflaster", tip: "langsam" },
  s: { label: "Straßenbahnschienen", tip: "Sturzgefahr" },
  a: { label: "Ampel", tip: "evtl. rot" },
};

type Place = { id: string; x: number; y: number; icon: string; name: string; orders: string[] };
const PLACES: Place[] = [
  { id: "wg", x: 1, y: 12, icon: "🏠", name: "WG", orders: ["🔑 Vergessener Schlüssel zurück in die WG", "🍦 Eis nach Hause, bevor es schmilzt"] },
  { id: "spaeti", x: 4, y: 8, icon: "🛒", name: "Späti", orders: ["🍾 Pfandflaschen zum Späti", "🪙 Kleingeld zum Späti bringen"] },
  { id: "uni", x: 6, y: 2, icon: "🎓", name: "Uni", orders: ["📚 Bücher zur Uni-Bibliothek", "💻 Laptop-Ladekabel zur Uni"] },
  { id: "buero", x: 9, y: 2, icon: "💼", name: "Stefans Büro", orders: ["🥪 Stefans Brotdose ins Büro", "📎 Unterlagen zu Stefan ins Büro"] },
  { id: "park", x: 0, y: 6, icon: "🌳", name: "Clara-Park", orders: ["🧺 Picknickdecke in den Clara-Park", "🏐 Ball in den Clara-Park"] },
  { id: "bahnhof", x: 5, y: 0, icon: "🚉", name: "Hauptbahnhof", orders: ["🎒 Rucksack zum Hauptbahnhof – Zug fährt gleich!", "🎟️ Ticket zum Hauptbahnhof"] },
  { id: "pizza", x: 7, y: 12, icon: "🍕", name: "Pizzeria", orders: ["🧾 Bestellzettel zur Pizzeria", "🍽️ Leere Pizzakartons zurück"] },
  { id: "cafe", x: 0, y: 2, icon: "☕", name: "Café Plagwitz", orders: ["🥐 Croissants zum Café", "☕ Thermobecher zum Café"] },
  { id: "atelier", x: 9, y: 10, icon: "🎨", name: "Verenas Atelier", orders: ["🖌️ Pinsel zu Verena ins Atelier", "🎨 Farben zu Verena ins Atelier"] },
  { id: "tennis", x: 2, y: 4, icon: "🎾", name: "Tennisplatz", orders: ["🎾 Neue Bälle für Fabian zum Tennisplatz", "🥤 Wasserflasche zum Tennisplatz"] },
];
const placeAt = (x: number, y: number) => PLACES.find((p) => p.x === x && p.y === y);
const key = (x: number, y: number) => `${x},${y}`;
type Cell = { x: number; y: number };

/** Ist das Ziel ohne Baustellen erreichbar? */
function reachable(from: Cell, to: Cell, blocked: Set<string>) {
  const seen = new Set([key(from.x, from.y)]), q = [from];
  while (q.length) {
    const c = q.shift()!;
    if (c.x === to.x && c.y === to.y) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: c.x + dx, y: c.y + dy }, k = key(n.x, n.y);
      if (n.x < 0 || n.y < 0 || n.x >= COLS || n.y >= ROWS || seen.has(k) || blocked.has(k) || kindAt(n.x, n.y) === "haus") continue;
      seen.add(k); q.push(n);
    }
  }
  return false;
}

function newOrder(from: Place) {
  const dest = PLACES.filter((p) => p.id !== from.id)[Math.floor(Math.random() * (PLACES.length - 1))];
  const text = dest.orders[Math.floor(Math.random() * dest.orders.length)];
  // 3 Baustellen auf Straßen (nicht an Kreuzungen, nicht an Start/Ziel), Ziel muss erreichbar bleiben
  const streets: Cell[] = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const k = kindAt(x, y);
    if (k !== "haus" && k !== "a" && !(STREET_ROWS.includes(y) && STREET_COLS.includes(x)) && !placeAt(x, y)) streets.push({ x, y });
  }
  for (let tries = 0; tries < 50; tries++) {
    const blocked = new Set(streets.sort(() => Math.random() - 0.5).slice(0, 3).map((c) => key(c.x, c.y)));
    if (reachable(from, dest, blocked)) return { dest, text, blocked };
  }
  return { dest, text, blocked: new Set<string>() };
}

/** Regnet es gerade in Leipzig? (echtes Wetter, Open-Meteo) */
function useLeipzigRain() {
  const [rain, setRain] = useState<boolean | null>(null);
  useEffect(() => {
    let stop = false;
    fetch("https://api.open-meteo.com/v1/forecast?latitude=51.34&longitude=12.37&current=precipitation,weather_code&timezone=Europe%2FBerlin")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { current?: { precipitation?: number; weather_code?: number } }) => {
        const c = d.current?.weather_code ?? 0;
        if (!stop) setRain((d.current?.precipitation ?? 0) > 0 || (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 71 && c <= 77));
      })
      .catch(() => { if (!stop) setRain(false); });
    return () => { stop = true; };
  }, []);
  return rain;
}

export function BikeCourier({ onResult }: { onResult?: (score: number, best: boolean) => void }) {
  const { scores, myBest, submit, dbErr } = useGameScore("kurier");
  const rain = useLeipzigRain();
  const [phase, setPhase] = useState<"start" | "spiel" | "ende">("start");
  const [result, setResult] = useState<{ score: number; deliveries: number; falls: number; best: boolean } | null>(null);

  const finish = useCallback((score: number, deliveries: number, falls: number) => {
    const best = score > myBest;
    setResult({ score, deliveries, falls, best });
    setPhase("ende");
    submit(score);
    onResult?.(score, best);
  }, [myBest, submit, onResult]);

  if (phase === "spiel") return <CourierRound rain={!!rain} onOver={finish} />;

  return (
    <div className="space-y-4 text-center">
      {phase === "ende" && result ? (
        <>
          <p className="text-5xl">{result.best ? "🏆" : "🚴"}</p>
          <p className="text-3xl font-bold tabular-nums">{result.score} Punkte</p>
          {result.best && <p className="font-semibold text-amber-600">Neuer Rekord!</p>}
          <p className="text-sm text-muted">{result.deliveries} {result.deliveries === 1 ? "Lieferung" : "Lieferungen"} · {result.falls} {result.falls === 1 ? "Sturz" : "Stürze"}</p>
        </>
      ) : (
        <>
          <p className="text-5xl">🚲📦</p>
          <p className="font-semibold">Kurier durch Leipzig</p>
          <p className="text-sm text-muted">{GAME_SECONDS} Sekunden, so viele Lieferungen wie möglich. Erst die Route tippen, dann losfahren!</p>
        </>
      )}
      {rain !== null && (
        <p className={`rounded-xl px-3 py-2 text-sm ${rain ? "bg-sky-500/15 text-sky-800 dark:text-sky-300" : "bg-amber-400/15 text-amber-800 dark:text-amber-300"}`}>
          {rain ? "🌧️ Es regnet gerade wirklich in Leipzig – alles dauert länger und die Schienen sind rutschig!" : "☀️ Gerade trocken in Leipzig – gute Fahrt!"}
        </p>
      )}
      <button onClick={() => setPhase("spiel")} className="w-full rounded-2xl bg-accent py-3 text-lg font-semibold text-white active:scale-[.98]">
        {phase === "ende" ? "Nochmal" : "Aufs Rad 🚲"}
      </button>
      <Leaderboard scores={scores} error={dbErr} />
      <ul className="mx-auto max-w-xs space-y-1 text-left text-sm text-muted">
        <li>👆 Straßen antippen = Route bauen (auch weiter weg in einer Linie), nochmal tippen = zurück bis dahin</li>
        <li>🟩 Fahrradstraße schnell · 🟫 Kopfstein langsam · 🚦 Ampel evtl. rot · 🚋 Schienen: Sturzgefahr · 🚧 gesperrt</li>
        <li>🔥 Schnell geliefert = warm = Bonuspunkte</li>
      </ul>
    </div>
  );
}

function CourierRound({ rain, onOver }: { rain: boolean; onOver: (score: number, deliveries: number, falls: number) => void }) {
  const { me } = useWG();
  const rainF = rain ? 1.25 : 1, fallChance = rain ? 0.16 : 0.07;
  const [at, setAt] = useState<Place>(PLACES[0]);
  const [order, setOrder] = useState(() => newOrder(PLACES[0]));
  const [path, setPath] = useState<Cell[]>([{ x: PLACES[0].x, y: PLACES[0].y }]);
  const [riding, setRiding] = useState(false);
  const [pos, setPos] = useState<Cell>({ x: PLACES[0].x, y: PLACES[0].y });
  const [stepMs, setStepMs] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [red, setRed] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const stats = useRef({ deliveries: 0, falls: 0, score: 0 });
  const startT = useRef(performance.now()), orderT = useRef(performance.now());
  const [now, setNow] = useState(performance.now());
  const over = useRef(false);

  useEffect(() => { const t = setInterval(() => setNow(performance.now()), 100); return () => clearInterval(t); }, []);
  const left = Math.max(0, GAME_SECONDS - (now - startT.current) / 1000);
  const warm = Math.max(0, WARM_SECONDS - (now - orderT.current) / 1000);
  useEffect(() => {
    if (left <= 0 && !over.current) { over.current = true; onOver(stats.current.score, stats.current.deliveries, stats.current.falls); }
  }, [left, onOver]);

  const inPath = (x: number, y: number) => path.findIndex((c) => c.x === x && c.y === y);
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < COLS && y < ROWS && kindAt(x, y) !== "haus" && !order.blocked.has(key(x, y));

  function tap(x: number, y: number) {
    if (riding) return;
    const i = inPath(x, y);
    if (i >= 0) { setPath(path.slice(0, i + 1)); return; }
    const end = path[path.length - 1];
    if (end.x === order.dest.x && end.y === order.dest.y) return;
    if (x !== end.x && y !== end.y) return;
    // Gerade Linie bis zum angetippten Feld – alles muss befahrbar sein
    const dx = Math.sign(x - end.x), dy = Math.sign(y - end.y), add: Cell[] = [];
    for (let cx = end.x + dx, cy = end.y + dy; ; cx += dx, cy += dy) {
      if (!free(cx, cy) || inPath(cx, cy) >= 0) return;
      add.push({ x: cx, y: cy });
      if (cx === order.dest.x && cy === order.dest.y) break;
      if (cx === x && cy === y) break;
    }
    setPath([...path, ...add]);
  }

  const planned = path.slice(1).reduce((s, c) => s + COST[kindAt(c.x, c.y) as Exclude<Kind, "haus">], 0) * rainF;
  const lights = path.slice(1).filter((c) => kindAt(c.x, c.y) === "a").length;
  const ready = path.length > 1 && path[path.length - 1].x === order.dest.x && path[path.length - 1].y === order.dest.y;

  async function ride() {
    if (!ready || riding) return;
    setRiding(true);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const c of path.slice(1)) {
      if (over.current) return;
      const k = kindAt(c.x, c.y) as Exclude<Kind, "haus">;
      if (k === "a" && Math.random() < 0.45) {
        setRed(key(c.x, c.y)); setMsg("🚦 Rot – warten …");
        await wait(500 + Math.random() * 1500);
        setRed(null); setMsg(null);
      }
      const ms = COST[k] * rainF * 1000;
      setStepMs(ms); setPos(c);
      await wait(ms);
      if (k === "s" && Math.random() < fallChance) {
        stats.current.falls++;
        setMsg(rain ? "💥 Nasse Schiene erwischt! Aua …" : "💥 In die Schiene geraten! Aua …");
        await wait(2200); setMsg(null);
      }
    }
    if (over.current) return;
    const bonus = Math.min(10, Math.ceil(Math.max(0, WARM_SECONDS - (performance.now() - orderT.current) / 1000) / 3));
    stats.current.deliveries++; stats.current.score += 10 + bonus;
    setScore(stats.current.score);
    setMsg(bonus >= 7 ? `🔥 Geliefert – noch warm! +${10 + bonus}` : bonus > 0 ? `✅ Geliefert! +${10 + bonus}` : "🥶 Geliefert, aber kalt … +10");
    const here = order.dest;
    setAt(here);
    const next = newOrder(here);
    await wait(900);
    setMsg(null);
    setOrder(next); setPath([{ x: here.x, y: here.y }]); orderT.current = performance.now();
    setRiding(false);
  }

  const cellPct = 100 / COLS;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-bold tabular-nums">⏱ {Math.ceil(left)} s</span>
        <span className="font-bold tabular-nums">{score} Punkte</span>
      </div>
      <div className="rounded-xl bg-line/40 px-3 py-2 text-sm">
        <p className="font-semibold">{order.text}</p>
        <p className="text-xs text-muted">von {at.icon} {at.name} nach <b className="text-fg">{order.dest.icon} {order.dest.name}</b> · {warm > 0 ? <>🔥 noch {Math.ceil(warm)} s warm</> : "🥶 schon kalt"}</p>
      </div>
      <div className="relative mx-auto w-full max-w-sm select-none" style={{ aspectRatio: `${COLS} / ${ROWS}` }}>
        <div className="absolute inset-0 grid overflow-hidden rounded-xl bg-[#d9d3c3]" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)` }}>
          {Array.from({ length: ROWS * COLS }, (_, i) => {
            const x = i % COLS, y = Math.floor(i / COLS), k = kindAt(x, y), pl = placeAt(x, y);
            const blocked = order.blocked.has(key(x, y)), pi = inPath(x, y), isDest = order.dest.x === x && order.dest.y === y;
            if (k === "haus") return <div key={i} className="m-[2px] rounded-[3px]" style={{ background: ["#c9b9a6", "#b8c4b0", "#c4b4c8", "#cbbfa0"][(x * 7 + y * 3) % 4] }} />;
            const bg = k === "f" ? "#86d39c" : k === "k" ? "#a8a29e" : "#9ca3af";
            const pattern = k === "k" ? "radial-gradient(#7c7570 1px, transparent 1.4px)" : k === "s" ? "linear-gradient(180deg, transparent 30%, #4b5563 30% 37%, transparent 37% 63%, #4b5563 63% 70%, transparent 70%)" : undefined;
            return (
              <button key={i} onClick={() => tap(x, y)} aria-label={`${pl ? pl.name + ", " : ""}${KIND_INFO[k].label}${blocked ? ", Baustelle" : ""}`}
                className="relative flex items-center justify-center text-[11px] leading-none"
                style={{ background: bg, backgroundImage: pattern, backgroundSize: k === "k" ? "5px 5px" : undefined }}>
                {pi > 0 && <span className="absolute inset-[18%] rounded-sm bg-blue-600/70" />}
                {k === "a" && <span className={`relative h-2.5 w-2.5 rounded-full ring-1 ring-black/40 ${red === key(x, y) ? "bg-red-500" : "bg-emerald-400"}`} />}
                {k === "f" && pi <= 0 && !pl && <span className="relative opacity-60">🚲</span>}
                {blocked && <span className="relative text-base">🚧</span>}
                {pl && <span className={`relative z-[1] text-base ${isDest ? "animate-bounce" : ""}`}>{pl.icon}</span>}
                {isDest && <span className="absolute inset-0 animate-pulse rounded-sm ring-2 ring-red-500" />}
              </button>
            );
          })}
        </div>
        {/* Kurier */}
        <div className="pointer-events-none absolute z-10 flex items-center justify-center text-xl"
          style={{ width: `${cellPct}%`, height: `${100 / ROWS}%`, left: `${pos.x * cellPct}%`, top: `${(pos.y * 100) / ROWS}%`, transition: `left ${stepMs}ms linear, top ${stepMs}ms linear` }}>
          <span className="rounded-full px-0.5" style={{ background: me?.color ?? "#4f46e5" }}>🚴</span>
        </div>
        {msg && <p className="absolute inset-x-2 top-1/2 z-20 -translate-y-1/2 rounded-xl bg-black/75 px-3 py-2 text-center text-sm font-semibold text-white">{msg}</p>}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setPath(path.slice(0, 1))} disabled={riding || path.length < 2} className="rounded-xl border border-line px-3 py-2 text-sm disabled:opacity-40">↺ Neu</button>
        <p className="min-w-0 flex-1 text-xs text-muted">
          {riding ? "Unterwegs …" : ready ? <>Route: ca. <b className="text-fg">{planned.toFixed(1)} s</b>{lights ? ` + ${lights} 🚦` : ""}</> : "Tippe die Straßen bis zum Ziel"}
        </p>
        <button onClick={ride} disabled={!ready || riding} className="rounded-xl bg-accent px-5 py-2 font-semibold text-white disabled:opacity-40">Los! 🚴</button>
      </div>
      <p className="text-center text-[11px] text-muted">🟩 Fahrradstraße · 🟫 Kopfstein · ║ Schienen · 🟢 Ampel · 🚧 Baustelle</p>
    </div>
  );
}
