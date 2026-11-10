"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import type { GameSong } from "@/lib/types";

/**
 * Drei eigene, kleine Chiptune-Melodien fürs WG-Spiel.
 * Werden live im Browser erzeugt (Web Audio API) – keine Audiodateien nötig.
 * Noten als MIDI-Nummern (60 = C4), 0 = Pause. Melodie in Achteln, Bass in Vierteln.
 */
export type Song = {
  id: string;
  name: string;
  bpm: number;
  lead: number[];
  bass: number[];
  leadWave: OscillatorType;
  drums: boolean;
};

export const SONGS: Song[] = [
  {
    id: "sonntag",
    name: "Gemütlicher Sonntag",
    bpm: 92,
    leadWave: "triangle",
    drums: false,
    lead: [
      72, 0, 76, 79, 76, 0, 74, 72,
      69, 0, 72, 76, 74, 72, 71, 0,
      69, 72, 77, 0, 76, 74, 72, 0,
      71, 74, 79, 77, 76, 74, 71, 74,
    ],
    bass: [48, 55, 52, 55, 45, 52, 48, 52, 41, 48, 45, 48, 43, 50, 47, 50],
  },
  {
    id: "putzparty",
    name: "Putzparty",
    bpm: 128,
    leadWave: "square",
    drums: true,
    lead: [
      69, 69, 72, 69, 76, 0, 74, 72,
      65, 65, 69, 65, 72, 0, 71, 69,
      67, 67, 72, 67, 76, 77, 76, 72,
      71, 0, 74, 0, 79, 77, 74, 71,
    ],
    bass: [45, 57, 45, 57, 41, 53, 41, 53, 48, 60, 48, 60, 43, 55, 43, 55],
  },
  {
    id: "bummel",
    name: "Einkaufsbummel",
    bpm: 108,
    leadWave: "square",
    drums: true,
    lead: [
      74, 0, 78, 81, 78, 76, 74, 0,
      71, 74, 78, 0, 76, 74, 73, 71,
      67, 71, 74, 79, 78, 0, 76, 74,
      73, 76, 81, 0, 79, 78, 76, 73,
    ],
    bass: [50, 57, 54, 57, 47, 54, 50, 54, 43, 50, 47, 50, 45, 52, 49, 52],
  },
];

const midiToFreq = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const VOLUME = 0.14;

/** Spielt den gewählten Song in Schleife; null = Stille. */
export function useGameMusic(songId: string | null) {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const song = SONGS.find((s) => s.id === songId);
    if (!song) return;

    // AudioContext erst nach einem Klick erzeugen (Browser erlauben Ton nur nach Nutzeraktion)
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = ctxRef.current ?? new Ctx();
    ctxRef.current = ctx;
    if (ctx.state === "suspended") ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0;
    master.gain.linearRampToValueAtTime(VOLUME, ctx.currentTime + 0.3);
    master.connect(ctx.destination);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const tone = (freq: number, t: number, dur: number, wave: OscillatorType, gain: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = wave;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.02);
    };
    const hat = (t: number) => {
      const src = ctx.createBufferSource();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      src.buffer = noise;
      f.type = "highpass";
      f.frequency.value = 7000;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      src.connect(f).connect(g).connect(master);
      src.start(t);
      src.stop(t + 0.06);
    };
    const kick = (t: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.16);
    };

    const eighth = 60 / song.bpm / 2;
    let step = 0;
    let next = ctx.currentTime + 0.05;
    const timer = setInterval(() => {
      // Kleiner Vorlauf, damit der Takt auch bei ruckelndem Browser sauber bleibt
      while (next < ctx.currentTime + 0.15) {
        const i = step % song.lead.length;
        const note = song.lead[i];
        if (note) tone(midiToFreq(note), next, eighth * 0.9, song.leadWave, song.leadWave === "square" ? 0.18 : 0.35);
        if (i % 2 === 0) {
          const b = song.bass[(i / 2) % song.bass.length];
          if (b) tone(midiToFreq(b), next, eighth * 1.8, "triangle", 0.45);
          if (song.drums && i % 4 === 0) kick(next);
        } else if (song.drums) {
          hat(next);
        }
        step++;
        next += eighth;
      }
    }, 25);

    return () => {
      clearInterval(timer);
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + 0.2);
      setTimeout(() => master.disconnect(), 300);
    };
  }, [songId]);

  // Beim Verlassen des Spiels Audio komplett schließen
  useEffect(() => () => { ctxRef.current?.close(); ctxRef.current = null; }, []);
}

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

/** Spielt einen WG-Song von start bis end in Schleife (null = aus). */
export function useSharedSong(song: GameSong | null) {
  const path = song?.path ?? null, start = song?.start_sec ?? 0, end = song?.end_sec ?? null;
  useEffect(() => {
    if (!path) return;
    let audio: HTMLAudioElement | null = null;
    let cancelled = false;
    // Sofort ein (leeres) Audio-Element anlegen: iPhones erlauben Ton nur direkt nach dem Antippen
    audio = new Audio();
    audio.volume = 0.6;
    const a = audio;
    a.play().catch(() => {});
    supabase.storage.from("musik").createSignedUrl(path, 60 * 60 * 6).then(({ data }) => {
      if (!data?.signedUrl || cancelled) return;
      const toStart = () => { a.currentTime = start; };
      a.addEventListener("loadedmetadata", toStart, { once: true });
      a.addEventListener("timeupdate", () => { if (end !== null && a.currentTime >= end) toStart(); });
      a.addEventListener("ended", () => { toStart(); a.play().catch(() => {}); });
      a.src = data.signedUrl;
      a.play().catch(() => {});
    });
    return () => { cancelled = true; a.pause(); a.removeAttribute("src"); a.load(); };
  }, [path, start, end]);
}
