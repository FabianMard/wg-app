"use client";

import { useMarkSeen } from "@/lib/news";
import { Game } from "@/components/game/Game";

export default function Spiel() {
  useMarkSeen("spiel");
  return (
    <>
      <h1 className="mb-3 text-2xl font-bold tracking-tight">WG-Spiel 🎮</h1>
      <Game />
    </>
  );
}
