"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { GameScore } from "@/lib/types";

/** Rekorde eines Minispiels laden und neue Punkte speichern (die Datenbank behält nur den besten Wert je Person) */
export function useGameScore(game: string) {
  const { myId } = useWG();
  const { rows, reload } = useRows<GameScore>("game_scores", "best", false);
  const scores = rows.filter((s) => s.game === game);
  const myBest = scores.find((s) => s.member_id === myId)?.best ?? 0;
  const [dbErr, setDbErr] = useState<string | null>(null);

  const submit = useCallback((score: number) => {
    if (score <= 0) return;
    supabase.rpc("submit_score", { p_game: game, p_score: Math.round(score) }).then(({ error }) => {
      setDbErr(error ? (/game_scores|submit_score|check constraint/i.test(error.message)
        ? "Rekord konnte nicht gespeichert werden: Bitte supabase/018_spiele.sql im SQL Editor ausführen."
        : `Rekord konnte nicht gespeichert werden: ${error.message}`) : null);
      reload();
    });
  }, [game, reload]);

  return { scores, myBest, submit, dbErr };
}
