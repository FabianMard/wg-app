"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { WatchItem } from "@/lib/types";
import { Avatar, btnCls, Card, DeleteButton, Empty, inputCls, SectionTitle } from "@/components/ui";

const KINDS: { id: WatchItem["kind"]; label: string; icon: string }[] = [
  { id: "film", label: "Film", icon: "🎬" },
  { id: "serie", label: "Serie", icon: "📺" },
  { id: "doku", label: "Doku", icon: "🌍" },
  { id: "anderes", label: "Anderes", icon: "✨" },
];
const PLATFORMS = ["Netflix", "Prime", "Disney+", "Mediathek", "Kino", "DVD"];
const kindOf = (k: WatchItem["kind"]) => KINDS.find((x) => x.id === k) ?? KINDS[0];

/** Gemeinsame Watchlist: was wollen wir zusammen schauen? Gäste können (mit Freigabe) nur lesen. */
export function Watchlist() {
  const { household, myId, member, isGuest } = useWG();
  const { rows, loaded, reload } = useRows<WatchItem>("watchlist", "created_at", false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<WatchItem["kind"]>("film");
  const [platform, setPlatform] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showWatched, setShowWatched] = useState(false);

  const open = rows.filter((r) => !r.watched).sort((a, b) => b.fans.length - a.fans.length || b.created_at.localeCompare(a.created_at));
  const watched = rows.filter((r) => r.watched);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setErr(null);
    const { error } = await supabase.from("watchlist").insert({ household_id: household.id, title: title.trim(), kind, platform, fans: [myId] });
    if (error) {
      setErr(error.message.includes("watchlist") ? "Datenbank-Update fehlt: Bitte supabase/012_gaeste_kalender_watchlist.sql ausführen." : error.message);
      return;
    }
    setTitle(""); setPlatform(null);
    reload();
  }
  async function toggleFan(w: WatchItem) {
    const fans = w.fans.includes(myId) ? w.fans.filter((f) => f !== myId) : [...w.fans, myId];
    await supabase.from("watchlist").update({ fans }).eq("id", w.id);
    reload();
  }
  async function toggleWatched(w: WatchItem) {
    await supabase.from("watchlist").update({ watched: !w.watched }).eq("id", w.id);
    reload();
  }
  async function remove(w: WatchItem) {
    if (!confirm(`„${w.title}“ von der Watchlist nehmen?`)) return;
    await supabase.from("watchlist").delete().eq("id", w.id);
    reload();
  }

  const Row = ({ w }: { w: WatchItem }) => {
    const k = kindOf(w.kind);
    const fan = w.fans.includes(myId);
    return (
      <Card className={`flex items-center gap-3 ${w.watched ? "opacity-60" : ""}`}>
        <span className="text-2xl" title={k.label}>{k.icon}</span>
        <div className="min-w-0 flex-1">
          <p className={`truncate font-medium ${w.watched ? "line-through" : ""}`}>{w.title}</p>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {k.label}
            {w.platform && <span className="rounded-full bg-line/60 px-1.5 py-0.5">{w.platform}</span>}
            {w.added_by && <>· von {member(w.added_by)?.display_name ?? "?"}</>}
          </p>
          {w.fans.length > 0 && (
            <span className="mt-1 flex items-center gap-1">
              <span className="flex -space-x-1.5">{w.fans.slice(0, 4).map((f) => <span key={f} className="rounded-full ring-2 ring-card"><Avatar member={member(f)} size={18} /></span>)}</span>
              <span className="text-[11px] text-muted">{w.fans.length === 1 ? "will das sehen" : `${w.fans.length} wollen das sehen`}</span>
            </span>
          )}
        </div>
        {!isGuest && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            {!w.watched && (
              <button onClick={() => toggleFan(w)} title={fan ? "Doch nicht" : "Will ich auch sehen"}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition active:scale-95 ${fan ? "border-accent bg-accent/10 text-accent" : "border-line"}`}>
                👍 {fan ? "Dabei" : "Ich auch"}
              </button>
            )}
            <div className="flex items-center gap-1">
              <button onClick={() => toggleWatched(w)} className="rounded-full px-2 py-1 text-xs text-muted hover:bg-line/50">{w.watched ? "↺ Nochmal" : "✓ Geschaut"}</button>
              <DeleteButton onClick={() => remove(w)} />
            </div>
          </div>
        )}
      </Card>
    );
  };

  return (
    <div>
      {!isGuest && (
        <Card className="mb-5">
          <form onSubmit={add} className="space-y-3">
            <div className="flex gap-2">
              <input className={inputCls} placeholder="Film oder Serie, z. B. Dune" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
              <button className={btnCls}>+</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <button type="button" key={k.id} onClick={() => setKind(k.id)}
                  className={`rounded-full border px-3 py-1 text-sm font-medium ${kind === k.id ? "border-accent bg-accent/10 text-accent" : "border-line text-muted"}`}>
                  {k.icon} {k.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <button type="button" key={p} onClick={() => setPlatform(platform === p ? null : p)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${platform === p ? "bg-accent text-white" : "bg-line/50 text-muted"}`}>
                  {p}
                </button>
              ))}
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
          </form>
        </Card>
      )}

      {loaded && open.length === 0 && <Empty>{isGuest ? "Die Watchlist ist gerade leer." : "Noch nichts auf der Watchlist. Was wollt ihr zusammen schauen?"}</Empty>}
      <div className="space-y-2">{open.map((w) => <Row key={w.id} w={w} />)}</div>

      {watched.length > 0 && (
        <>
          <button onClick={() => setShowWatched(!showWatched)} className="mt-4 w-full text-left">
            <SectionTitle>{showWatched ? "▾" : "▸"} Schon geschaut ({watched.length})</SectionTitle>
          </button>
          {showWatched && <div className="space-y-2">{watched.map((w) => <Row key={w.id} w={w} />)}</div>}
        </>
      )}
    </div>
  );
}
