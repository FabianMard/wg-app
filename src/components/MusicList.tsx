"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { Playlist } from "@/lib/types";
import { btnCls, Card, DeleteButton, Empty, inputCls } from "@/components/ui";

const MOODS: { id: Playlist["mood"]; label: string; icon: string }[] = [
  { id: "party", label: "Party", icon: "🎉" },
  { id: "putzen", label: "Putzen", icon: "🧽" },
  { id: "chillen", label: "Chillen", icon: "😌" },
  { id: "kochen", label: "Kochen", icon: "🍳" },
  { id: "sport", label: "Sport", icon: "💪" },
  { id: "sonstiges", label: "Sonstiges", icon: "✨" },
];
const moodOf = (m: Playlist["mood"]) => MOODS.find((x) => x.id === m) ?? MOODS[5];

/**
 * Spotify-Link erkennen: https://open.spotify.com/(intl-de/)playlist/ID?si=…  oder  spotify:playlist:ID
 * → saubere URL + Embed-URL für den offiziellen Spotify-Player
 */
export function parseSpotify(input: string): { url: string; embed: string; type: string } | null {
  const s = input.trim();
  const m = s.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/)
    ?? s.match(/^spotify:(playlist|album|track|artist|show|episode):([A-Za-z0-9]+)$/);
  if (!m) return null;
  return { type: m[1], url: `https://open.spotify.com/${m[1]}/${m[2]}`, embed: `https://open.spotify.com/embed/${m[1]}/${m[2]}` };
}

/** Gemeinsame Musikliste mit Spotify-Playlisten. Gäste (mit Freigabe) können nur hören. */
export function MusicList() {
  const { household, member, isGuest } = useWG();
  const { rows, loaded, reload } = useRows<Playlist>("playlists", "created_at", false);
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [mood, setMood] = useState<Playlist["mood"]>("party");
  const [filter, setFilter] = useState<Playlist["mood"] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = link ? parseSpotify(link) : null;
  const shown = filter ? rows.filter((r) => r.mood === filter) : rows;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!parsed) { setErr("Das ist kein Spotify-Link. In Spotify: ··· → Teilen → Link kopieren."); return; }
    setBusy(true);
    let name = title.trim();
    if (!name) {
      // Namen der Playlist bei Spotify nachschlagen (öffentliche oEmbed-Schnittstelle)
      try {
        const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(parsed.url)}`);
        if (r.ok) name = ((await r.json()) as { title?: string }).title ?? "";
      } catch { /* egal – dann Standardname */ }
    }
    const { error } = await supabase.from("playlists").insert({
      household_id: household.id, title: (name || "Spotify-Playlist").slice(0, 120), url: parsed.url, mood,
    });
    setBusy(false);
    if (error) {
      setErr(error.message.includes("playlists") ? "Datenbank-Update fehlt: Bitte supabase/013_musik.sql im SQL Editor ausführen." : error.message);
      return;
    }
    setLink(""); setTitle("");
    reload();
  }
  async function remove(p: Playlist) {
    if (!confirm(`„${p.title}“ aus der Musikliste nehmen?`)) return;
    await supabase.from("playlists").delete().eq("id", p.id);
    reload();
  }

  return (
    <div>
      {!isGuest && (
        <Card className="mb-5">
          <form onSubmit={add} className="space-y-3">
            <div className="flex gap-2">
              <input className={inputCls} placeholder="Spotify-Link einfügen" value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" />
              <button className={btnCls} disabled={busy || !link.trim()}>+</button>
            </div>
            {link && !parsed && <p className="text-xs text-amber-700 dark:text-amber-300">In Spotify: ··· → Teilen → Link kopieren, dann hier einfügen.</p>}
            {parsed && (
              <input className={`${inputCls} py-2 text-sm`} placeholder="Name (optional – wird sonst von Spotify geholt)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            )}
            <div className="flex flex-wrap gap-1.5">
              {MOODS.map((m) => (
                <button type="button" key={m.id} onClick={() => setMood(m.id)}
                  className={`rounded-full border px-3 py-1 text-sm font-medium ${mood === m.id ? "border-accent bg-accent/10 text-accent" : "border-line text-muted"}`}>
                  {m.icon} {m.label}
                </button>
              ))}
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
          </form>
        </Card>
      )}

      {rows.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button onClick={() => setFilter(null)} className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === null ? "bg-fg text-bg" : "bg-line/50 text-muted"}`}>Alle</button>
          {MOODS.filter((m) => rows.some((r) => r.mood === m.id)).map((m) => (
            <button key={m.id} onClick={() => setFilter(filter === m.id ? null : m.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === m.id ? "bg-fg text-bg" : "bg-line/50 text-muted"}`}>{m.icon} {m.label}</button>
          ))}
        </div>
      )}

      {loaded && rows.length === 0 && <Empty>{isGuest ? "Noch keine Musik eingetragen." : "Noch keine Playlisten. Füg eure Lieblings-Playlist von Spotify hinzu!"}</Empty>}
      <div className="space-y-2">
        {shown.map((p) => {
          const md = moodOf(p.mood);
          const sp = parseSpotify(p.url);
          return (
            <Card key={p.id} className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1db954]/15 text-2xl">{md.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.title}</p>
                  <p className="text-xs text-muted">{md.label}{p.added_by && ` · von ${member(p.added_by)?.display_name ?? "?"}`}</p>
                </div>
                <button onClick={() => setPlaying(playing === p.id ? null : p.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold transition active:scale-95 ${playing === p.id ? "bg-line/60" : "bg-[#1db954] text-white"}`}>
                  {playing === p.id ? "Zu" : "▶ Hören"}
                </button>
                {!isGuest && <DeleteButton onClick={() => remove(p)} />}
              </div>
              {playing === p.id && sp && (
                <iframe title={p.title} src={`${sp.embed}?utm_source=generator`} width="100%" height="352" loading="lazy"
                  className="rounded-xl border-0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />
              )}
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-medium text-[#1db954] hover:underline">In Spotify öffnen ↗</a>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
