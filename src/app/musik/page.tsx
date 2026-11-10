"use client";

import { useMarkSeen } from "@/lib/news";
import { MusicList } from "@/components/MusicList";
import { PageTitle } from "@/components/ui";

export default function MusikPage() {
  useMarkSeen("lists.musik");
  return (
    <>
      <PageTitle sub="Unsere Spotify-Playlisten">Musik 🎵</PageTitle>
      <MusicList />
    </>
  );
}
