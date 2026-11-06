"use client";

import { useEffect, useRef } from "react";

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
