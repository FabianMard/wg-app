"use client";

import { MusicList } from "@/components/MusicList";
import { PageTitle } from "@/components/ui";

export default function MusikPage() {
  return (
    <>
      <PageTitle sub="Unsere Spotify-Playlisten">Musik 🎵</PageTitle>
      <MusicList />
    </>
  );
}
