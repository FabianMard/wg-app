"use client";

import { useRows, useWG } from "@/lib/wg";
import type { GameScore } from "@/lib/types";
import { AvatarFigure, lookOf } from "./avatar";
import { TennisStats } from "./TennisGame";

/** Alle Minispiele mit Bestenliste – und wo man sie in der Wohnung findet */
const GAMES: { id: GameScore["game"]; icon: string; name: string; where: string }[] = [
  { id: "spuelmaschine", icon: "🫧", name: "Spülmaschine", where: "Küche" },
  { id: "kite", icon: "🏄", name: "Kitesurfen", where: "Stefans Zimmer" },
  { id: "tennis", icon: "🎾", name: "Tennis gegen Computer", where: "Fabians Zimmer" },
  { id: "giessen", icon: "💧", name: "Verenas Dschungel", where: "Verenas Zimmer" },
];
const MEDALS = ["🥇", "🥈", "🥉"];

/** Die Bestenliste im Flur: Übersicht über alle Spiele */
export function HallOfFame() {
  const { everyone, myId } = useWG();
  const { rows: scores, loaded } = useRows<GameScore>("game_scores", "best", false);
  const person = (id: string) => everyone.find((m) => m.id === id);

  const boards = GAMES.map((g) => ({ ...g, list: scores.filter((s) => s.game === g.id && s.best > 0).sort((a, b) => b.best - a.best) }));
  // Wer hält die meisten ersten Plätze?
  const titles = new Map<string, number>();
  for (const b of boards) if (b.list[0]) titles.set(b.list[0].member_id, (titles.get(b.list[0].member_id) ?? 0) + 1);
  const champ = [...titles.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="space-y-4">
      {champ && person(champ[0]) && (
        <div className="flex items-center gap-3 rounded-2xl bg-amber-400/15 p-3">
          <span className="flex h-14 w-14 shrink-0 items-end justify-center overflow-hidden rounded-full bg-amber-300/40"><AvatarFigure look={lookOf(person(champ[0])!)} size={42} /></span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">👑 WG-Champion</p>
            <p className="font-semibold">{champ[0] === myId ? "Du" : person(champ[0])!.display_name}</p>
            <p className="text-xs text-muted">hält {champ[1]} von {GAMES.length} Rekorden</p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {boards.map((b) => {
          const mineIdx = b.list.findIndex((s) => s.member_id === myId);
          return (
            <div key={b.id} className="rounded-2xl border border-line bg-card p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="font-semibold">{b.icon} {b.name}</p>
                <p className="shrink-0 text-[11px] text-muted">📍 {b.where}</p>
              </div>
              {loaded && b.list.length === 0 && <p className="py-2 text-sm text-muted">Noch kein Rekord – sei die erste Person!</p>}
              <ol className="space-y-1">
                {b.list.slice(0, 3).map((s, i) => {
                  const m = person(s.member_id);
                  return (
                    <li key={s.member_id} className={`flex items-center gap-2 rounded-xl px-2 py-1 text-sm ${s.member_id === myId ? "bg-accent/10 font-semibold" : ""}`}>
                      <span className="w-6 text-center">{MEDALS[i]}</span>
                      {m && <AvatarFigure look={lookOf(m)} size={20} />}
                      <span className="min-w-0 flex-1 truncate">{m?.display_name ?? "?"}{s.member_id === myId && " (du)"}</span>
                      <span className="tabular-nums">{s.best}</span>
                    </li>
                  );
                })}
                {mineIdx >= 3 && (
                  <li className="flex items-center gap-2 rounded-xl bg-accent/10 px-2 py-1 text-sm font-semibold">
                    <span className="w-6 text-center text-xs">{mineIdx + 1}.</span>
                    <span className="min-w-0 flex-1 truncate">Du</span>
                    <span className="tabular-nums">{b.list[mineIdx].best}</span>
                  </li>
                )}
              </ol>
            </div>
          );
        })}
      </div>

      <TennisStats />
      <p className="text-center text-xs text-muted">Die Rekorde zählen für die Person, die gespielt hat.</p>
    </div>
  );
}
