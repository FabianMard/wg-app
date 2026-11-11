"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { useWG } from "./wg";

/**
 * Roter Punkt für Neues: Hat jemand ANDERES in einem Bereich etwas eingetragen, seit ich zuletzt dort war?
 * „Zuletzt gesehen“ merkt sich jedes Gerät (localStorage). Verglichen wird mit Zeitstempeln der Datenbank.
 */

export type NewsKey =
  | "start" | "putzen" | "einkauf" | "kosten" | "kosten.einreichen"
  | "kalender" | "kalender.abstimmung" | "lists.todos" | "lists.watchlist" | "lists.musik" | "spiel";

/** Woher „neu“ kommt: Tabelle, Zeitspalte, Spalte „wer“ */
const SOURCES: { key: NewsKey; table: string; time: string; by: string }[] = [
  { key: "start", table: "notes", time: "created_at", by: "author" },                       // Start: nur Pinnwand
  { key: "putzen", table: "chore_checks", time: "done_at", by: "done_by" },
  { key: "putzen", table: "praises", time: "created_at", by: "from_member" },
  { key: "einkauf", table: "shopping_items", time: "created_at", by: "added_by" },
  { key: "kosten", table: "expenses", time: "created_at", by: "created_by" },
  { key: "kosten.einreichen", table: "cost_requests", time: "created_at", by: "created_by" },
  { key: "kosten.einreichen", table: "cost_requests", time: "decided_at", by: "decided_by" },
  { key: "kosten.einreichen", table: "cost_requests", time: "paid_out_at", by: "decided_by" },
  { key: "kalender", table: "events", time: "created_at", by: "created_by" },
  { key: "kalender.abstimmung", table: "polls", time: "created_at", by: "created_by" },
  { key: "kalender.abstimmung", table: "poll_votes", time: "created_at", by: "member_id" },
  { key: "lists.todos", table: "todos", time: "created_at", by: "created_by" },
  { key: "lists.watchlist", table: "watchlist", time: "created_at", by: "added_by" },
  { key: "lists.musik", table: "playlists", time: "created_at", by: "added_by" },
  { key: "spiel", table: "messages", time: "created_at", by: "from_member" },               // Chat (privat an mich + WG-Chat)
];

/** Welche Bereiche hängen an welchem Menüpunkt? */
export const NAV_NEWS: Record<string, NewsKey[]> = {
  "/": ["start"], "/pinnwand": ["start"], "/putzplan": ["putzen"], "/einkauf": ["einkauf"],
  "/kosten": ["kosten", "kosten.einreichen"], "/kalender": ["kalender", "kalender.abstimmung"],
  "/todos": ["lists.todos", "lists.watchlist", "lists.musik"], "/watchlist": ["lists.watchlist"], "/musik": ["lists.musik"],
  "/spiel": ["spiel"],
};

const STORE = "wg-gesehen";
type Map_ = Partial<Record<NewsKey, string>>;
const load = (): Map_ => { try { return JSON.parse(localStorage.getItem(STORE) ?? "{}"); } catch { return {}; } };
const save = (m: Map_) => { try { localStorage.setItem(STORE, JSON.stringify(m)); } catch { /* egal */ } };

const Ctx = createContext<{ has: (k: NewsKey) => boolean; markSeen: (k: NewsKey) => void; latest: Map_; count: number } | null>(null);

type BadgeNav = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
/** Zahl auf dem App-Icon (Home-Bildschirm / Dock) setzen – und für den Service Worker merken, der bei Push hochzählt */
export function setIconBadge(n: number) {
  if (typeof navigator === "undefined") return;
  const nav = navigator as BadgeNav;
  try {
    if (n > 0) nav.setAppBadge?.(n).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  } catch { /* nicht unterstützt */ }
  try { caches.open("wg-badge").then((c) => c.put("/badge-count", new Response(String(n)))).catch(() => {}); } catch { /* egal */ }
}

export function NewsProvider({ children }: { children: React.ReactNode }) {
  const { household, myId } = useWG();
  const [latest, setLatest] = useState<Map_>({});
  const [seen, setSeen] = useState<Map_>({});
  const first = useRef(true);

  const fetchAll = useCallback(async () => {
    const results = await Promise.all(SOURCES.map(async (s) => {
      const { data } = await supabase.from(s.table).select(s.time)
        .eq("household_id", household.id).neq(s.by, myId).not(s.time, "is", null)
        .order(s.time, { ascending: false }).limit(1);
      const row = (data as Record<string, string>[] | null)?.[0];
      return [s.key, row?.[s.time] ?? null] as const;
    }));
    const next: Map_ = {};
    for (const [k, t] of results) if (t && (!next[k] || t > next[k]!)) next[k] = t;
    setLatest(next);
    // Beim allerersten Mal auf diesem Gerät gilt alles Bisherige als gesehen (kein Punkte-Gewitter)
    if (first.current) {
      first.current = false;
      const stored = load();
      let changed = false;
      for (const k of Object.keys(next) as NewsKey[]) if (!stored[k]) { stored[k] = next[k]; changed = true; }
      if (changed) save(stored);
      setSeen(stored);
    }
  }, [household.id, myId]);

  useEffect(() => {
    fetchAll();
    // Jede Änderung in der WG → kurz warten, dann neu nachsehen
    let t: ReturnType<typeof setTimeout> | null = null;
    const later = () => { if (t) clearTimeout(t); t = setTimeout(fetchAll, 800); };
    const ch = supabase.channel(`neues-${household.id}-${myId}`)
      .on("postgres_changes", { event: "*", schema: "public" }, later)
      .subscribe();
    const onVis = () => { if (document.visibilityState === "visible") fetchAll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { if (t) clearTimeout(t); supabase.removeChannel(ch); document.removeEventListener("visibilitychange", onVis); };
  }, [fetchAll, household.id, myId]);

  const markSeen = useCallback((k: NewsKey) => {
    setSeen((cur) => {
      const t = latest[k];
      if (!t || (cur[k] && cur[k]! >= t)) return cur;
      const next = { ...cur, [k]: t };
      save(next);
      return next;
    });
  }, [latest]);

  const has = useCallback((k: NewsKey) => !!latest[k] && (!seen[k] || latest[k]! > seen[k]!), [latest, seen]);

  // Wie viele neue Einträge von anderen gibt es insgesamt? → Zahl auf dem App-Icon
  const [count, setCount] = useState(0);
  useEffect(() => {
    let stop = false;
    const t = setTimeout(async () => {
      const counts = await Promise.all(SOURCES.map(async (s) => {
        if (!latest[s.key] || (seen[s.key] && latest[s.key]! <= seen[s.key]!)) return 0;
        if (!seen[s.key]) return 1;
        const { count: n } = await supabase.from(s.table).select(s.time, { count: "exact", head: true })
          .eq("household_id", household.id).neq(s.by, myId).gt(s.time, seen[s.key]!);
        return n ?? 0;
      }));
      if (!stop) setCount(counts.reduce((a, b) => a + b, 0));
    }, 400);
    return () => { stop = true; clearTimeout(t); };
  }, [latest, seen, household.id, myId]);
  useEffect(() => { setIconBadge(count); }, [count]);

  return <Ctx.Provider value={{ has, markSeen, latest, count }}>{children}</Ctx.Provider>;
}

/** Gibt es in diesem Bereich etwas Neues? */
export function useNews() {
  return useContext(Ctx) ?? { has: () => false, markSeen: () => {}, latest: {}, count: 0 };
}

/** Auf dieser Seite / in diesem Reiter: als gesehen markieren (auch wenn währenddessen Neues dazukommt) */
export function useMarkSeen(key: NewsKey | null) {
  const { markSeen, latest } = useNews();
  const t = key ? latest[key] : undefined;
  useEffect(() => {
    if (!key) return;
    const mark = () => { if (document.visibilityState === "visible") markSeen(key); };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [key, t, markSeen]);
}

/** Kleiner roter Punkt */
export function NewDot({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full bg-red-500 ring-2 ring-bg ${className}`} aria-label="Neu" />;
}
