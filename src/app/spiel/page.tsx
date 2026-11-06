"use client";

import { Game } from "@/components/game/Game";

export default function Spiel() {
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">WG-Spiel 🎮</h1>
      <p className="mb-4 text-sm text-muted">
        Lauf durch die Wohnung. Kühlschrank, Kalender, Pinnwand & Co. öffnen die App. Sprich Mitbewohner an, um sie zu loben.
      </p>
      <Game />
    </>
  );
}
