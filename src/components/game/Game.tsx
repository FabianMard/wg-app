"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { Member, Message } from "@/lib/types";
import {
  BEDROOM_LABELS, COLS, findPath, floorColor, HOME_SPOTS, isAdjacent, isWalkable, MAP, neighbors,
  objectAt, OBJECTS, ROOM_LABELS, ROWS, type Action, type GameObject, type Pos,
} from "./map";
import { TalkDialog } from "./TalkDialog";
import { BookShelf } from "./BookShelf";
import { AvatarFigure, lookOf, Wardrobe, type AvatarLook } from "./avatar";
import {
  deleteCustomSong, formatTime, loadCustomMeta, parseTime, saveCustomMeta, saveCustomSong, SONGS,
  useCustomSong, useGameMusic, type CustomSongMeta,
} from "./music";
import { inputCls } from "@/components/ui";

// Die echten App-Seiten – im Spiel öffnen sie sich als Fenster
import StartPage from "@/app/page";
import PutzplanPage from "@/app/putzplan/page";
import EinkaufPage from "@/app/einkauf/page";
import KostenPage from "@/app/kosten/page";
import KalenderPage from "@/app/kalender/page";
import TodosPage from "@/app/todos/page";
import WGPage from "@/app/wg/page";
import { Pinboard } from "@/components/Pinboard";
import { Watchlist } from "@/components/Watchlist";
import { MusicList } from "@/components/MusicList";
import { Dishwasher } from "./Dishwasher";
import { KiteWeather } from "./KiteWeather";
import { KiteGame } from "./KiteGame";
import { TennisGame } from "./TennisGame";
import { ArtGallery, Papers } from "./VerenaCorner";
import { WateringGame } from "./WateringGame";

type PageAction = Exclude<Action, "schlafen" | "kleiderschrank" | "giessen" | "buecher" | "spuelmaschine" | "kitegame" | "tennis" | "giessspiel">;
const WatchlistPanel = () => <Watchlist />;
const PinnwandPanel = () => <Pinboard />;
const MusikPanel = () => <MusicList />;
const KitePanel = () => <KiteWeather />;
/** Was Gäste im Spiel nie öffnen dürfen */
const RESIDENT_ONLY: Action[] = ["start", "putzplan", "einkauf", "kosten", "todos", "wg"];
const PANELS: Record<PageAction, React.ComponentType> = {
  start: StartPage, putzplan: PutzplanPage, einkauf: EinkaufPage, kosten: KostenPage,
  watchlist: WatchlistPanel, pinnwand: PinnwandPanel, musik: MusikPanel, kite: KitePanel, paper: Papers, kunst: ArtGallery,
  kalender: KalenderPage, todos: TodosPage, wg: WGPage,
};

const STEP_MS = 120;
const BUBBLE_MS = 6000;

type Target = { type: "object"; obj: GameObject } | { type: "member"; id: string } | { type: "cat" };
type Panel = Target | { type: "wardrobe"; first?: boolean; ownerId?: string } | { type: "books"; ownerId: string } | { type: "dishwasher" } | { type: "kitegame" } | { type: "tennis" } | { type: "giessspiel" };
const CAT_LINES = ["Schnurrrr … 💕", "Miau! 😺", "*kuschelt sich an* 🐾", "Prrrrr 😻", "Mehr! Mehr! 🐱"];
const CAT_SEE = 3; // so nah muss man sein, um die Katze zu entdecken
const dist = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* privater Modus */ } },
};

/** Zufälliges Versteck für die Katze: begehbar, nicht in Sichtweite von `far` */
function catHideout(avoid: Pos[], far?: Pos): Pos {
  const spots: Pos[] = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const p = { x, y };
    if (!isWalkable(x, y) || MAP[y][x] === "h") continue;
    if (avoid.some((a) => dist(a, p) < 2)) continue;
    if (far && dist(far, p) < 7) continue;
    spots.push(p);
  }
  return spots[Math.floor(Math.random() * spots.length)] ?? { x: 11, y: 8 };
}

/** Position + Blickrichtung (l = schaut nach links) */
type Spot = Pos & { l?: boolean };
type Bubble = { text: string; until: number };
type SayPayload = { on: string; text: string };
type MovePayload = { id: string; x: number; y: number; l?: boolean };

export function Game() {
  const { members, everyone, myId, household, me, refresh, isGuest, can } = useWG();
  const homeOf = useCallback((id: string) => {
    const i = members.findIndex((m) => m.id === id);
    // Gäste starten im Flur an der Haustür
    return HOME_SPOTS[i] ?? { x: 2, y: 8 };
  }, [members]);

  // Dort weitermachen, wo man aufgehört hat (pro Gerät gespeichert)
  const posKey = `wg-spiel-pos-${myId}`;
  const [pos, setPos] = useState<Pos>(() => {
    try {
      const p = JSON.parse(store.get(posKey) ?? "null");
      if (p && isWalkable(p.x, p.y)) return { x: p.x, y: p.y };
    } catch { /* ungültig */ }
    return homeOf(myId);
  });
  useEffect(() => { store.set(posKey, JSON.stringify(pos)); }, [pos, posKey]);
  const posRef = useRef(pos);
  useEffect(() => { posRef.current = pos; }, [pos]);
  const [path, setPath] = useState<Pos[]>([]);
  const pending = useRef<Target | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [remote, setRemote] = useState<Record<string, Spot>>({});
  const [faceLeft, setFaceLeft] = useState(false);
  const faceRef = useRef(false);
  useEffect(() => { faceRef.current = faceLeft; }, [faceLeft]);
  // Eigenes Aussehen sofort anzeigen, auch bevor die Datenbank antwortet
  const [myLook, setMyLook] = useState<AvatarLook | null>(null);
  const [moving, setMoving] = useState<Record<string, boolean>>({});
  const moveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const markMoving = useCallback((id: string) => {
    setMoving((m) => (m[id] ? m : { ...m, [id]: true }));
    clearTimeout(moveTimers.current[id]);
    moveTimers.current[id] = setTimeout(() => setMoving((m) => ({ ...m, [id]: false })), 260);
  }, []);
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({});
  const [chat, setChat] = useState("");
  // Ungelesene Chat-Nachrichten an mich, pro Absender
  const { rows: messages, reload: reloadMessages } = useRows<Message>("messages", "created_at");
  const unreadFrom = (id: string) => messages.filter((m) => m.from_member === id && m.to_member === myId && !m.read_at).length;
  const [live, setLive] = useState<"verbinde" | "live" | "offline">("verbinde");
  // Musik: standardmäßig aus, muss aktiv angemacht werden (wird nicht gespeichert)
  const [song, setSong] = useState<string | null>(null);
  useGameMusic(song === "eigen" ? null : song);
  const [custom, setCustom] = useState<CustomSongMeta | null>(() => (typeof window === "undefined" ? null : loadCustomMeta()));
  useCustomSong(song === "eigen", custom);
  const [songSettings, setSongSettings] = useState(false);
  const [from, setFrom] = useState(() => (custom ? formatTime(custom.start) : ""));
  const [to, setTo] = useState(() => (custom?.end != null ? formatTime(custom.end) : ""));
  const songFile = useRef<HTMLInputElement>(null);
  async function pickSong(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const meta = { name: f.name.replace(/\.[^.]+$/, "").slice(0, 40), start: parseTime(from) ?? 0, end: parseTime(to) };
    await saveCustomSong(f, meta);
    setCustom(meta);
    setSongSettings(true);
    setSong("eigen");
  }
  function applyRange() {
    if (!custom) return;
    const meta = { ...custom, start: parseTime(from) ?? 0, end: parseTime(to) };
    saveCustomMeta(meta);
    setCustom(meta);
  }
  const channel = useRef<RealtimeChannel | null>(null);
  const joined = useRef(false); // erst senden, wenn die Live-Verbindung steht
  const present = useRef(new Set<string>()); // wer laut Presence gerade im Spiel ist
  const sendMoveRef = useRef<() => void>(() => {});
  const lastStep = useRef(0);

  // ── Bubbles ──
  const showBubble = useCallback((on: string, text: string) => {
    setBubbles((b) => ({ ...b, [on]: { text, until: Date.now() + BUBBLE_MS } }));
    setTimeout(() => setBubbles((b) => (b[on] && b[on].until <= Date.now() ? Object.fromEntries(Object.entries(b).filter(([k]) => k !== on)) : b)), BUBBLE_MS + 50);
  }, []);
  const say = useCallback((on: string, text: string) => {
    showBubble(on, text);
    if (joined.current) channel.current?.send({ type: "broadcast", event: "say", payload: { on, text } satisfies SayPayload });
  }, [showBubble]);

  // ── Live: wer ist im Spiel und wo? (Supabase Realtime Presence) ──
  useEffect(() => {
    const ch = supabase.channel(`spiel-${household.id}`, { config: { presence: { key: myId }, broadcast: { self: false } } });
    // Presence = wer ist online. Die Position kommt v. a. über "move"-Nachrichten (schneller, nichts geht verloren).
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<Spot>();
      present.current = new Set(Object.keys(state));
      setRemote((prev) => {
        const next: Record<string, Spot> = {};
        for (const [id, metas] of Object.entries(state)) {
          const m = metas[metas.length - 1];
          if (id === myId || !m) continue;
          next[id] = prev[id] ?? { x: m.x, y: m.y, l: m.l };
        }
        return next;
      });
    })
      .on("presence", { event: "join" }, ({ key }) => {
        if (key !== myId) setTimeout(() => sendMoveRef.current(), 300);
      })
      .on("broadcast", { event: "move" }, ({ payload }) => {
        const m = payload as MovePayload;
        // Nachzügler von jemandem, der das Spiel schon verlassen hat, ignorieren
        if (m.id === myId || !present.current.has(m.id)) return;
        setRemote((prev) => {
          const old = prev[m.id];
          if (old && old.x === m.x && old.y === m.y && old.l === m.l) return prev;
          return { ...prev, [m.id]: { x: m.x, y: m.y, l: m.l } };
        });
        markMoving(m.id);
      })
      .on("broadcast", { event: "say" }, ({ payload }) => showBubble((payload as SayPayload).on, (payload as SayPayload).text))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { joined.current = true; setLive("live"); ch.track({ ...posRef.current, l: faceRef.current }); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { joined.current = false; setLive("offline"); }
      });
    channel.current = ch;
    return () => { joined.current = false; channel.current = null; supabase.removeChannel(ch); };
  }, [household.id, myId, showBubble, markMoving]);

  // Eigene Bewegung senden: als schnelle Nachricht (max. ~8/s, die letzte Position immer).
  // Presence (wer ist online) NICHT bei jedem Schritt – sonst blockt Supabase ("presence rate limit").
  const lastMove = useRef(0), moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendMove = useCallback(() => {
    lastMove.current = Date.now();
    if (joined.current) channel.current?.send({ type: "broadcast", event: "move", payload: { id: myId, ...posRef.current, l: faceRef.current } satisfies MovePayload });
  }, [myId]);
  useEffect(() => {
    if (moveTimer.current) clearTimeout(moveTimer.current);
    const wait = 120 - (Date.now() - lastMove.current);
    if (wait <= 0) sendMove(); else moveTimer.current = setTimeout(sendMove, wait);
  }, [pos, faceLeft, sendMove]);
  useEffect(() => () => { if (moveTimer.current) clearTimeout(moveTimer.current); }, []);
  useEffect(() => { sendMoveRef.current = sendMove; }, [sendMove]);

  // Regelmäßig neu melden – z. B. nachdem das Handy gesperrt war
  useEffect(() => {
    let lastPing = 0;
    const ping = () => {
      if (!joined.current || Date.now() - lastPing < 5_000) return;
      lastPing = Date.now();
      channel.current?.track({ ...posRef.current, l: faceRef.current });
    };
    const id = setInterval(ping, 15_000);
    // App im Hintergrund / geschlossen → sofort abmelden (sonst merkt Supabase es erst nach bis zu einer Minute)
    const leave = () => { if (joined.current) channel.current?.untrack(); };
    const onVis = () => {
      if (document.visibilityState === "visible") { lastPing = 0; ping(); }
      else leave();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", leave);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", leave); };
  }, []);

  // Beim allerersten Mal: Avatar gestalten
  const askedAvatar = useRef(false);
  useEffect(() => {
    if (me && !me.avatar && !askedAvatar.current) { askedAvatar.current = true; setPanel({ type: "wardrobe", first: true }); }
  }, [me]);

  // Eigene Position ändern (mit Blickrichtung & Laufanimation)
  const moveTo = useCallback((n: Pos) => {
    const dx = n.x - posRef.current.x;
    if (dx) setFaceLeft(dx < 0);
    setPos(n);
    markMoving(myId);
  }, [markMoving, myId]);

  // ── Positionen aller Mitbewohner ──
  const memberPos = useCallback((m: Member): Spot => (m.id === myId ? { ...pos, l: faceLeft } : remote[m.id] ?? homeOf(m.id)), [myId, pos, faceLeft, remote, homeOf]);
  // Mitbewohner immer; Gäste nur, wenn sie gerade im Spiel sind (oder ich selbst)
  const people = everyone.filter((m) => m.role !== "gast" || m.id === myId || remote[m.id]);
  const others = people.filter((m) => m.id !== myId);
  const memberAt = (p: Pos) => others.find((m) => { const q = memberPos(m); return q.x === p.x && q.y === p.y; });
  // ── Versteckte Katze ──
  const [cat, setCat] = useState<Pos>(() => catHideout([...HOME_SPOTS], pos));
  const [catHappy, setCatHappy] = useState(false);
  const [pets, setPets] = useState(() => Number(store.get("wg-spiel-katze") ?? 0) || 0);
  const catVisible = catHappy || dist(pos, cat) <= CAT_SEE;
  const catAt = (p: Pos) => p.x === cat.x && p.y === cat.y;

  const blockedRef = useRef<(p: Pos) => boolean>(() => false);
  useEffect(() => { blockedRef.current = (p: Pos) => !!memberAt(p) || catAt(p); });

  // Was ist direkt neben mir?
  const nearby: Target | null = useMemo(() => {
    for (const n of neighbors(pos)) {
      const m = others.find((o) => { const q = memberPos(o); return q.x === n.x && q.y === n.y; });
      if (m) return { type: "member", id: m.id };
    }
    if (neighbors(pos).some((n) => n.x === cat.x && n.y === cat.y)) return { type: "cat" };
    for (const n of neighbors(pos)) {
      const o = objectAt(n.x, n.y);
      if (o) return { type: "object", obj: o };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, remote, everyone, cat]);

  const open = useCallback((t: Target) => {
    if (t.type === "cat") {
      if (catHappy) return;
      const n = pets + 1;
      setPets(n);
      store.set("wg-spiel-katze", String(n));
      setCatHappy(true);
      showBubble("katze", CAT_LINES[Math.floor(Math.random() * CAT_LINES.length)]);
      // Nach dem Streicheln huscht sie in ein neues Versteck
      setTimeout(() => {
        setCatHappy(false);
        setCat(catHideout([...HOME_SPOTS], posRef.current));
      }, 2600);
      return;
    }
    if (t.type === "object" && isGuest) {
      const a = t.obj.action;
      const blocked = RESIDENT_ONLY.includes(a) || ((a === "kalender" || a === "pinnwand" || a === "watchlist" || a === "musik") && !can(a));
      if (blocked) { say(myId, "🔒 Nur für Mitbewohner"); return; }
    }
    if (t.type === "object" && t.obj.action === "spuelmaschine") { setPanel({ type: "dishwasher" }); return; }
    if (t.type === "object" && t.obj.action === "kitegame") { setPanel({ type: "kitegame" }); return; }
    if (t.type === "object" && t.obj.action === "tennis") { setPanel({ type: "tennis" }); return; }
    if (t.type === "object" && t.obj.action === "giessspiel") { setPanel({ type: "giessspiel" }); return; }
    if (t.type === "object" && t.obj.action === "schlafen") { say(myId, "💤"); return; }
    if (t.type === "object" && t.obj.action === "giessen") {
      say(myId, ["💧 Gegossen!", "💧🌱 Wächst schon!", "Na, du Hübsche? 🌿", "💧 Prost!"][Math.floor(Math.random() * 4)]);
      return;
    }
    if (t.type === "object" && t.obj.action === "buecher") {
      const owner = [...members].sort((a, b) => a.sort - b.sort)[t.obj.owner ?? -1];
      if (owner) setPanel({ type: "books", ownerId: owner.id });
      return;
    }
    if (t.type === "object" && t.obj.action === "kleiderschrank") {
      const owner = [...members].sort((a, b) => a.sort - b.sort)[t.obj.owner ?? -1];
      setPanel({ type: "wardrobe", ownerId: owner?.id });
      return;
    }
    setPanel(t);
  }, [say, myId, members, catHappy, pets, showBubble, isGuest, can]);

  // ── Laufen ──
  const step = useCallback((dx: number, dy: number) => {
    const now = Date.now();
    if (now - lastStep.current < STEP_MS - 10) return;
    lastStep.current = now;
    const p = posRef.current;
    const n = { x: p.x + dx, y: p.y + dy };
    if (dx) setFaceLeft(dx < 0);
    if (isWalkable(n.x, n.y) && !blockedRef.current(n)) moveTo(n);
  }, [moveTo]);

  useEffect(() => {
    if (!path.length) {
      const t = pending.current;
      if (t) {
        pending.current = null;
        const tp = t.type === "object" ? t.obj : t.type === "cat" ? cat : memberPos(everyone.find((m) => m.id === t.id)!);
        if (isAdjacent(pos, tp)) open(t);
      }
      return;
    }
    const id = setTimeout(() => {
      // Steht inzwischen jemand im Weg? Dann stehen bleiben.
      if (blockedRef.current(path[0])) { setPath([]); pending.current = null; return; }
      moveTo(path[0]); setPath(path.slice(1));
    }, STEP_MS);
    return () => clearTimeout(id);
  }, [path, pos, open, memberPos, everyone, moveTo, cat]);

  // Tastatur
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (panel) { if (e.key === "Escape") { if (panel.type === "member") reloadMessages(); setPanel(null); } return; }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const dirs: Record<string, [number, number]> = {
        ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
        w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
      };
      if (dirs[e.key]) { e.preventDefault(); setPath([]); pending.current = null; step(...dirs[e.key]); }
      else if ((e.key === "e" || e.key === "E" || e.key === "Enter" || e.key === " ") && nearby) { e.preventDefault(); open(nearby); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, nearby, open, step, reloadMessages]);

  // ── Kamera & Größe ──
  const viewRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(360);
  const [viewHMax, setViewHMax] = useState(420);
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { setViewW(el.clientWidth); setViewHMax(Math.round(window.innerHeight * 0.58)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tile = Math.max(28, Math.min(40, Math.floor(viewW / COLS)));
  const mapW = COLS * tile, mapH = ROWS * tile;
  const viewH = Math.min(mapH, viewHMax);
  const camX = Math.max(0, Math.min(mapW - viewW, pos.x * tile + tile / 2 - viewW / 2));
  const camY = Math.max(0, Math.min(mapH - viewH, pos.y * tile + tile / 2 - viewH / 2));

  function onMapClick(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const t = { x: Math.floor((e.clientX - r.left) / tile), y: Math.floor((e.clientY - r.top) / tile) };
    const m = memberAt(t);
    const o = objectAt(t.x, t.y);
    const target: Target | null = m ? { type: "member", id: m.id } : catVisible && catAt(t) ? { type: "cat" } : o ? { type: "object", obj: o } : null;
    if (target && isAdjacent(pos, t)) { open(target); return; }
    const p = findPath(pos, t, blockedRef.current);
    if (!p) return;
    pending.current = target;
    setPath(p);
  }

  const memberColors = [...members].sort((a, b) => a.sort - b.sort).map((m) => m.color);
  const onlineIds = new Set([myId, ...Object.keys(remote)]);
  const targetMember = panel?.type === "member" ? everyone.find((m) => m.id === panel.id) : undefined;
  const nearbyLabel = nearby?.type === "cat" ? "🐈 Katze streicheln" : nearby?.type === "member"
    ? `Mit ${everyone.find((m) => m.id === nearby.id)?.display_name} reden${unreadFrom(nearby.id) ? ` (💬 ${unreadFrom(nearby.id)} neu)` : ""}`
    : nearby?.type === "object" ? `${nearby.obj.icon} ${nearby.obj.label}: ${nearby.obj.hint}` : null;

  return (
    <div className="space-y-3">
      {/* Spielfeld */}
      <div ref={viewRef} className="relative overflow-hidden rounded-2xl border border-line bg-[#4b4453] shadow-sm select-none"
        style={{ height: viewH }}>
        <div className="absolute left-0 top-0 transition-transform duration-150 ease-linear"
          style={{ width: mapW, height: mapH, transform: `translate(${-camX}px, ${-camY}px)` }}
          onClick={onMapClick}>
          {/* Boden & Wände */}
          {MAP.map((row, y) => row.split("").map((ch, x) => (
            <div key={`${x}-${y}`} className="absolute" style={{
              left: x * tile, top: y * tile, width: tile, height: tile, background: floorColor(ch, x, y, memberColors),
              boxShadow: ch === "#" ? "inset 0 -3px 0 rgba(0,0,0,.25)" : undefined,
            }} />
          )))}
          {/* Raumnamen */}
          {ROOM_LABELS.map((l) => (
            <span key={l.text} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-[11px] font-semibold uppercase tracking-wider text-black/25"
              style={{ left: l.x * tile + tile / 2, top: l.y * tile }}>{l.text}</span>
          ))}
          {[...members].sort((a, b) => a.sort - b.sort).slice(0, 3).map((m, i) => (
            <span key={m.id} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-[11px] font-semibold uppercase tracking-wider"
              style={{ left: BEDROOM_LABELS[i].x * tile + tile / 2, top: BEDROOM_LABELS[i].y * tile, color: m.color, opacity: 0.6 }}>
              {m.display_name}s Zimmer
            </span>
          ))}
          {/* Gegenstände */}
          {OBJECTS.map((o) => {
            const hot = nearby?.type === "object" && nearby.obj === o;
            return (
              <div key={`${o.x}-${o.y}`} title={`${o.label}: ${o.hint}`}
                className={`absolute flex cursor-pointer items-center justify-center rounded-lg transition ${hot ? "z-[5] scale-110 bg-white/70 ring-2 ring-accent" : "hover:bg-white/40"}`}
                style={{ left: o.x * tile, top: o.y * tile, width: tile, height: tile, fontSize: tile * 0.68 }}>
                <span className={hot ? "animate-bounce" : ""}>{o.icon}</span>
              </div>
            );
          })}
          {/* Katze – nur sichtbar, wenn man nah genug ist */}
          {catVisible && (
            <div className="pointer-events-none absolute z-10 flex items-end justify-center transition-transform duration-300"
              style={{ width: tile, height: tile, transform: `translate(${cat.x * tile}px, ${cat.y * tile}px)` }}>
              {bubbles["katze"] && (
                <div className="absolute bottom-full left-1/2 z-30 mb-1 w-max max-w-[150px] -translate-x-1/2 rounded-xl bg-white px-2 py-1 text-center text-xs font-medium text-neutral-900 shadow-lg">
                  {bubbles["katze"].text}
                </div>
              )}
              {catHappy && <span className="absolute -top-2 left-1/2 -translate-x-1/2 animate-ping text-sm">💕</span>}
              <span className={catHappy ? "animate-bounce" : "animate-pulse"} style={{ fontSize: tile * 0.78, lineHeight: 1 }}>🐈</span>
            </div>
          )}
          {/* Mitbewohner */}
          {people.map((m) => {
            const p = memberPos(m);
            const isMe = m.id === myId;
            const online = onlineIds.has(m.id);
            const bubble = bubbles[m.id];
            const hot = nearby?.type === "member" && nearby.id === m.id;
            return (
              <div key={m.id} className={`absolute transition-transform ease-linear ${bubble ? "z-30" : isMe ? "z-20" : "z-10"}`}
                style={{ width: tile, height: tile, transform: `translate(${p.x * tile}px, ${p.y * tile}px)`, transitionDuration: `${STEP_MS}ms` }}>
                {bubble && (
                  <div className="absolute bottom-full left-1/2 z-20 mb-6 w-max max-w-[170px] -translate-x-1/2 rounded-xl bg-white px-2.5 py-1.5 text-center text-sm font-medium text-neutral-900 shadow-lg after:absolute after:left-1/2 after:top-full after:-translate-x-1/2 after:border-[6px] after:border-transparent after:border-t-white after:content-['']">
                    {bubble.text}
                  </div>
                )}
                {/* Leuchtring unter der Figur, wenn man sie ansprechen kann */}
                {hot && <span className="absolute bottom-0 left-1/2 h-2 w-[90%] -translate-x-1/2 animate-pulse rounded-[50%] bg-white/80 ring-2 ring-accent" />}
                <span className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 text-[10px] font-bold leading-4 text-white shadow ${hot ? "ring-2 ring-white" : ""}`}
                  style={{ background: m.color, top: -tile * 0.42 - 15 }}>
                  {isMe ? "Du" : m.display_name}{!online && " 💤"}
                  {!isMe && unreadFrom(m.id) > 0 && <span className="ml-1 rounded-full bg-red-500 px-1 text-[9px]">💬{unreadFrom(m.id)}</span>}
                </span>
                <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 ${moving[m.id] ? "animate-waddle" : ""} ${online ? "" : "opacity-75 grayscale-[.35]"}`}>
                  <AvatarFigure look={isMe && myLook ? myLook : lookOf(m)} size={tile * 1.12} flip={!!p.l} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Aktion */}
      <button disabled={!nearby} onClick={() => nearby && open(nearby)}
        className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-center text-sm font-semibold transition active:scale-[.99] ${
          nearby ? "bg-accent text-white shadow" : "border border-dashed border-line text-muted"}`}>
        {nearbyLabel
          ? <><kbd className="hidden rounded bg-white/25 px-1.5 text-xs md:inline">E</kbd>{nearbyLabel}</>
          : "Lauf zu einem Gegenstand oder Mitbewohner"}
      </button>

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <form onSubmit={(e) => { e.preventDefault(); if (chat.trim()) { say(myId, chat.trim().slice(0, 80)); setChat(""); } }} className="flex gap-2">
            <input className={`${inputCls} py-2 text-sm`} placeholder="Etwas sagen …" maxLength={80} value={chat} onChange={(e) => setChat(e.target.value)} />
            <button className="rounded-xl bg-accent px-3 text-sm font-medium text-white">💬</button>
          </form>
          <div className="flex gap-1.5">
            {["👋", "😂", "❤️", "🍕", "🎉"].map((em) => (
              <button key={em} onClick={() => say(myId, em)} className="flex-1 rounded-xl border border-line bg-card py-1.5 text-lg transition hover:bg-line/40 active:scale-90">{em}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Musik">
            <span className="text-xs font-medium text-muted">Musik:</span>
            {[{ id: null, name: "🔇 Aus" }, ...SONGS.map((x) => ({ id: x.id, name: `🎵 ${x.name}` })),
              ...(custom ? [{ id: "eigen", name: `🎧 ${custom.name}` }] : [])].map((x) => (
              <button key={x.id ?? "aus"} role="radio" aria-checked={song === x.id} onClick={() => setSong(x.id)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition active:scale-95 ${
                  song === x.id ? "border-accent bg-accent text-white" : "border-line bg-card text-muted hover:text-fg"}`}>
                {x.name}
              </button>
            ))}
            <button onClick={() => setSongSettings(!songSettings)} className="rounded-full px-2 py-1 text-xs text-muted underline hover:text-fg">
              {custom ? "Eigener Song …" : "+ Eigener Song"}
            </button>
          </div>
          {songSettings && (
            <div className="space-y-2 rounded-xl border border-dashed border-line p-3 text-xs">
              <p className="text-muted">
                Wähle eine Musikdatei von deinem Gerät. Sie bleibt <b>nur auf diesem Gerät</b> und wird nicht hochgeladen.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => songFile.current?.click()} className="rounded-lg border border-line bg-card px-3 py-1.5 font-medium">
                  📁 {custom ? "Andere Datei wählen" : "Datei wählen"}
                </button>
                <input ref={songFile} type="file" accept="audio/*" onChange={pickSong} className="hidden" />
                {custom && <span className="truncate text-muted">🎧 {custom.name}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted">Abschnitt in Schleife: von</span>
                <input value={from} onChange={(e) => setFrom(e.target.value)} onBlur={applyRange} placeholder="0:00" inputMode="numeric"
                  className="w-16 rounded-lg border border-line bg-card px-2 py-1 text-center" aria-label="Start (mm:ss)" />
                <span className="text-muted">bis</span>
                <input value={to} onChange={(e) => setTo(e.target.value)} onBlur={applyRange} placeholder="Ende" inputMode="numeric"
                  className="w-16 rounded-lg border border-line bg-card px-2 py-1 text-center" aria-label="Ende (mm:ss)" />
              </div>
              {custom && (
                <button onClick={async () => { await deleteCustomSong(); setCustom(null); if (song === "eigen") setSong(null); }}
                  className="text-red-600 underline">Eigenen Song entfernen</button>
              )}
            </div>
          )}
          <p className="text-xs text-muted">
            🐾 Irgendwo versteckt sich eine Katze{pets > 0 && <> · schon {pets}× gestreichelt</>}
          </p>
          <p className="text-xs text-muted">
            <span className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ${live === "live" ? "bg-emerald-500" : live === "offline" ? "bg-red-500" : "bg-amber-400"}`} />
            {live === "live" ? "Live verbunden" : live === "offline" ? "Keine Live-Verbindung" : "Verbinde …"}
          </p>
        </div>
      </div>

      {panel && (
        <Sheet onClose={() => { if (panel.type === "member") reloadMessages(); setPanel(null); }} light={panel.type === "member"}
          title={panel.type === "member" ? `Gespräch mit ${targetMember?.display_name}` : panel.type === "wardrobe" ? (panel.ownerId && panel.ownerId !== myId ? `👚 ${members.find((m) => m.id === panel.ownerId)?.display_name}s Kleiderschrank` : "👚 Dein Kleiderschrank") : panel.type === "object" ? (panel.obj.action === "kite" ? "🪁 Stefans Kite-Wetter" : panel.obj.action === "paper" ? "📄 Verenas Paper" : panel.obj.action === "kunst" ? "🎨 Verenas Kunst" : `${panel.obj.icon} ${panel.obj.label}`) : panel.type === "books" ? `📚 ${members.find((m) => m.id === panel.ownerId)?.display_name}s Bücher` : panel.type === "dishwasher" ? "🫧 Spülmaschine einräumen" : panel.type === "kitegame" ? "🏄 Kitesurfen" : panel.type === "tennis" ? "🎾 Tennis" : panel.type === "giessspiel" ? "💧 Verenas Dschungel" : ""}>
          {panel.type === "member" && targetMember ? (
            <TalkDialog target={targetMember} online={onlineIds.has(targetMember.id)}
              onEmote={(em, on) => say(em === "🐝" && on ? on : myId, em)} onSay={(text) => say(myId, text)} onClose={() => { reloadMessages(); setPanel(null); }} />
          ) : panel.type === "dishwasher" ? (
            <Dishwasher onResult={(score, best) => say(myId, best ? `🏆 ${score} Punkte – neuer Rekord!` : `🍽️ ${score} Punkte!`)} />
          ) : panel.type === "giessspiel" ? (
            <WateringGame onResult={(score, best) => say(myId, best ? `💧 ${score} Punkte – neuer Gieß-Rekord!` : `💧 ${score} Punkte!`)} />
          ) : panel.type === "tennis" ? (
            <TennisGame onResult={(score, best) => say(myId, best ? `🎾 ${score} Punkte – neuer Tennis-Rekord!` : `🎾 ${score} Punkte!`)} />
          ) : panel.type === "kitegame" ? (
            <KiteGame onResult={(score, best) => say(myId, best ? `🏄 ${score} Punkte – neuer Kite-Rekord!` : `🏄 ${score} Punkte!`)} />
          ) : panel.type === "object" && panel.obj.action === "kite" ? (
            <KiteWeather onPlay={() => setPanel({ type: "kitegame" })} />
          ) : panel.type === "books" && members.find((m) => m.id === panel.ownerId) ? (
            <BookShelf owner={members.find((m) => m.id === panel.ownerId)!} />
          ) : panel.type === "wardrobe" && me ? (
            <Wardrobe member={me} owner={members.find((m) => m.id === panel.ownerId)} firstTime={panel.first} onSaved={(look) => { setMyLook(look); refresh(); setPanel(null); say(myId, "✨"); }} />
          ) : panel.type === "object" ? (
            (() => { const Comp = PANELS[panel.obj.action as PageAction]; return <Comp />; })()
          ) : null}
        </Sheet>
      )}
    </div>
  );
}

function Sheet({ title, onClose, children, light }: { title: string; onClose: () => void; children: React.ReactNode; light?: boolean }) {
  // light = Gespräch: Spiel bleibt klar sichtbar (kein Abdunkeln/Weichzeichnen), Fenster nur unten
  return (
    <div className={`fixed inset-0 z-50 flex items-end justify-center ${light ? "bg-transparent" : "bg-black/40 backdrop-blur-[2px] md:items-center md:p-6"}`} onClick={onClose}>
      <div className={`flex w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-bg ${light ? "max-h-[62dvh] border-t border-line shadow-[0_-8px_30px_rgba(0,0,0,.18)]" : "max-h-[90dvh] shadow-2xl md:rounded-3xl"}`}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="font-semibold">{title}</span>
          <button onClick={onClose} className="rounded-full px-3 py-1 text-sm font-medium text-muted hover:bg-line/50" aria-label="Schließen">
            Zurück ins Spiel ✕
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-8 pt-4">{children}</div>
      </div>
    </div>
  );
}
