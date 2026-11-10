"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Fotos liegen privat im Bucket "pinnwand". Zum Anzeigen braucht es kurzlebige, signierte Links.
 * Diese werden gesammelt angefragt und zwischengespeichert.
 */
const BUCKET = "pinnwand";
const cache = new Map<string, string>();
const waiting = new Map<string, ((url: string | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const paths = [...waiting.keys()];
  const cbs = new Map(waiting);
  waiting.clear();
  supabase.storage.from(BUCKET).createSignedUrls(paths, 60 * 60 * 6).then(({ data }) => {
    for (const p of paths) {
      const url = data?.find((d) => d.path === p)?.signedUrl ?? null;
      if (url) cache.set(p, url);
      cbs.get(p)?.forEach((cb) => cb(url));
    }
  });
}

export function signedUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    waiting.set(path, [...(waiting.get(path) ?? []), resolve]);
    if (!timer) timer = setTimeout(flush, 20);
  });
}

export function useSignedUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(path ? cache.get(path) ?? null : null);
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    let alive = true;
    signedUrl(path).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [path]);
  return url;
}

/** Bild laden, quadratisch zuschneiden (Mitte) und verkleinern → JPEG */
export async function squarePhoto(file: File, size = 400): Promise<Blob> {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Dieses Bildformat kann der Browser nicht öffnen."));
      i.src = src;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(size, side);
    canvas.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Foto konnte nicht verarbeitet werden."))), "image/jpeg", 0.85));
  } finally {
    URL.revokeObjectURL(src);
  }
}

/**
 * Foto herunterladen. Handy: Teilen-Menü mit „Bild sichern“ (landet in den Fotos);
 * Computer: normaler Download. Gibt "geteilt" | "geladen" | "abgebrochen" zurück.
 */
export async function downloadPhoto(url: string, filename: string): Promise<"geteilt" | "geladen" | "abgebrochen"> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Foto konnte nicht geladen werden.");
  const blob = await res.blob();
  const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return "geteilt"; }
    catch (e) { if ((e as Error).name === "AbortError") return "abgebrochen"; /* sonst normal herunterladen */ }
  }
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return "geladen";
}
