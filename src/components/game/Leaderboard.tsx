"use client";

import { useWG } from "@/lib/wg";
import type { GameScore } from "@/lib/types";
import { Avatar } from "@/components/ui";

/** Bestenliste der WG – Rekorde aller, die schon gespielt haben */
export function Leaderboard({ scores, error }: { scores: GameScore[]; error?: string | null }) {
  const { everyone, myId } = useWG();
  const list = scores.filter((s) => s.best > 0).sort((a, b) => b.best - a.best);
  return (
    <div className="rounded-2xl border border-line p-3 text-left">
      <p className="mb-2 text-center text-sm font-semibold">🏆 Bestenliste der WG</p>
      {error && <p className="mb-2 rounded-xl bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">{error}</p>}
      {!list.length && !error && <p className="py-2 text-center text-sm text-muted">Noch keine Rekorde – sei die erste Person! 🥇</p>}
      <ol className="space-y-1.5">
        {list.map((s, i) => {
          const m = everyone.find((x) => x.id === s.member_id);
          return (
            <li key={s.member_id} className={`flex items-center gap-2 rounded-xl px-2 py-1 text-sm ${s.member_id === myId ? "bg-accent/10 font-semibold" : ""}`}>
              <span className="w-6 text-center">{["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`}</span>
              <Avatar member={m} size={22} />
              <span className="min-w-0 flex-1 truncate">{m?.display_name ?? "?"}{s.member_id === myId && " (du)"}</span>
              <span className="tabular-nums">{s.best}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

