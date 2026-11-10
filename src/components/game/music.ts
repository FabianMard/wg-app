"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { GameSong } from "@/lib/types";

/** Musik im WG-Spiel: Songs, die jemand aus der WG hochgeladen hat (für alle abspielbar). */

// ───────────── Eigene Songs der WG (für alle abspielbar) ─────────────

/** Früher lag ein eigener Song nur auf dem Gerät – den Rest davon aufräumen */
export function dropOldDeviceSong() {
  try {
    if (!localStorage.getItem("wg-spiel-eigener-song")) return;
    localStorage.removeItem("wg-spiel-eigener-song");
    const req = indexedDB.open("wg-app", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("dateien");
    req.onsuccess = () => { try { req.result.transaction("dateien", "readwrite").objectStore("dateien").delete("spiel-song"); } catch { /* egal */ } };
  } catch { /* egal */ }
}

export const MAX_SONG_MB = 8;
export const MAX_SONGS = 3;

/** Song hochladen → für alle in der WG verfügbar */
export async function uploadSong(householdId: string, file: File, start: number, end: number | null): Promise<string | null> {
  if (file.size > MAX_SONG_MB * 1024 * 1024) return `Die Datei ist zu groß (max. ${MAX_SONG_MB} MB).`;
  const ext = (file.name.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? "mp3").toLowerCase();
  const path = `${householdId}/${crypto.randomUUID()}.${ext}`;
  // Manche Handys liefern keinen Dateityp – dann anhand der Endung
  const types: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", webm: "audio/webm", flac: "audio/flac", mp4: "audio/mp4" };
  const contentType = file.type.startsWith("audio/") ? file.type : types[ext] ?? "audio/mpeg";
  const up = await supabase.storage.from("musik").upload(path, file, { contentType });
  if (up.error) return /size|exceed|too large/i.test(up.error.message) ? `Die Datei ist zu groß (max. ${MAX_SONG_MB} MB).` : up.error.message.includes("mime") ? "Dieses Dateiformat geht leider nicht (mp3, m4a, wav, ogg, flac)." : up.error.message;
  const name = file.name.replace(/\.[^.]+$/, "").trim().slice(0, 60) || "Song";
  const { error } = await supabase.from("game_songs").insert({ household_id: householdId, name, path, size: file.size, start_sec: start, end_sec: end });
  if (error) { await supabase.storage.from("musik").remove([path]); return error.message; }
  return null;
}

export async function deleteSong(song: GameSong) {
  await supabase.from("game_songs").delete().eq("id", song.id);
  await supabase.storage.from("musik").remove([song.path]);
}

/** "1:50" → 110 Sekunden; leer → null */
export function parseTime(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const parts = t.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
export const formatTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export type PlayerState = "stopp" | "spielt" | "pause";

/**
 * Kleiner Player für die WG-Songs: Start, Pause, Stopp. Spielt den gewählten Abschnitt in Schleife.
 * Die Download-Links werden vorab geholt, damit „Start“ direkt beim Antippen abspielt (sonst blockt das iPhone).
 */
export function useSongPlayer(songs: GameSong[]) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef<Record<string, string>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [state, setState] = useState<PlayerState>("stopp");
  const [time, setTime] = useState(0);
  const current = songs.find((x) => x.id === currentId) ?? null;
  const range = useRef({ start: 0, end: null as number | null });
  range.current = { start: current?.start_sec ?? 0, end: current?.end_sec ?? null };

  // Links für alle Songs holen (6 Stunden gültig)
  const paths = songs.map((x) => x.path).join("|");
  useEffect(() => {
    const list = paths ? paths.split("|") : [];
    const missing = list.filter((p) => !urls.current[p]);
    if (!missing.length) return;
    supabase.storage.from("musik").createSignedUrls(missing, 60 * 60 * 6).then(({ data }) => {
      for (const d of data ?? []) if (d.path && d.signedUrl) urls.current[d.path] = d.signedUrl;
    }).catch(() => { /* dann beim Antippen holen */ });
  }, [paths]);

  const el = useCallback(() => {
    if (audio.current) return audio.current;
    const a = new Audio();
    a.volume = 0.6;
    a.addEventListener("timeupdate", () => {
      const { start, end } = range.current;
      if (end !== null && a.currentTime >= end) a.currentTime = start;
      setTime(a.currentTime);
    });
    a.addEventListener("ended", () => { a.currentTime = range.current.start; a.play().catch(() => {}); });
    audio.current = a;
    return a;
  }, []);

  const play = useCallback(async (song?: GameSong | null) => {
    const target = song ?? current ?? songs[0];
    if (!target) return;
    const a = el();
    if (a.dataset.path !== target.path) {
      let url = urls.current[target.path];
      if (!url) {
        a.play().catch(() => {}); // im Antipp-Moment freischalten, Link kommt gleich
        const { data } = await supabase.storage.from("musik").createSignedUrl(target.path, 60 * 60 * 6);
        if (!data?.signedUrl) return;
        url = urls.current[target.path] = data.signedUrl;
      }
      a.dataset.path = target.path;
      a.src = url;
      const start = target.start_sec ?? 0;
      a.addEventListener("loadedmetadata", () => { a.currentTime = start; }, { once: true });
      setTime(start);
    }
    setCurrentId(target.id);
    setState("spielt");
    a.play().catch(() => setState("pause"));
  }, [current, songs, el]);

  const pause = useCallback(() => { audio.current?.pause(); setState("pause"); }, []);
  const stop = useCallback(() => {
    const a = audio.current;
    if (a) { a.pause(); a.currentTime = range.current.start; }
    setTime(range.current.start);
    setState("stopp");
  }, []);

  // Song wurde gelöscht → anhalten
  useEffect(() => {
    if (currentId && !songs.some((x) => x.id === currentId)) {
      const a = audio.current;
      if (a) { a.pause(); a.removeAttribute("src"); delete a.dataset.path; }
      setCurrentId(null); setState("stopp");
    }
  }, [songs, currentId]);
  // Spiel verlassen → Ton aus
  useEffect(() => () => { const a = audio.current; if (a) { a.pause(); a.removeAttribute("src"); a.load(); } }, []);

  return { current, state, time, play, pause, stop };
}
