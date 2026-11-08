"use client";

import { useState } from "react";
import { findSpotifyLink, MusicList } from "@/components/MusicList";
import { PageTitle } from "@/components/ui";

/** Ziel des Android-Teilen-Menüs: Spotify → Teilen → WG-App */
export default function MusikTeilen() {
  const [shared] = useState(() => {
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search);
    return findSpotifyLink(q.get("url")) ?? findSpotifyLink(q.get("text")) ?? findSpotifyLink(q.get("title"));
  });
  return (
    <>
      <PageTitle sub={shared ? "Von Spotify geteilt – Stimmung wählen und ＋ tippen." : "Im Geteilten war kein Spotify-Link."}>Zur Musikliste 🎵</PageTitle>
      <MusicList initialLink={shared ?? ""} />
    </>
  );
}
