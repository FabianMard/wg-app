"use client";

import { supabase } from "@/lib/supabase";
import { useWG } from "@/lib/wg";
import type { Praise } from "@/lib/types";

/** Anzahl Bienchen, die ein Mitbewohner bekommen hat */
export function beesOf(praises: Praise[], memberId: string) {
  return praises.filter((p) => p.to_member === memberId).length;
}

export function Bees({ count, className = "" }: { count: number; className?: string }) {
  if (!count) return null;
  return (
    <span title={`${count} fleißige Bienchen`}
      className={`inline-flex items-center gap-0.5 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300 ${className}`}>
      🐝 {count}
    </span>
  );
}

/**
 * „Loben“-Button: Gibt jedem Beteiligten (außer mir selbst) ein Bienchen.
 * Nochmal tippen nimmt das Lob zurück.
 */
export function PraiseButton({ kind, refId, to, praises, onChange }: {
  kind: Praise["kind"];
  refId: string;
  to: string[];
  praises: Praise[];
  onChange: () => void;
}) {
  const { household, myId, member } = useWG();
  const targets = to.filter((id) => id !== myId);
  const mine = praises.filter((p) => p.kind === kind && p.ref === refId && p.from_member === myId);
  const all = praises.filter((p) => p.kind === kind && p.ref === refId);
  const praised = targets.length > 0 && targets.every((t) => mine.some((p) => p.to_member === t));

  // Wer hat schon gelobt?
  const from = [...new Set(all.map((p) => member(p.from_member)?.display_name).filter(Boolean))];

  if (!targets.length) {
    return all.length ? <span className="text-xs text-amber-700 dark:text-amber-300">🐝 gelobt von {from.join(", ")}</span> : null;
  }

  async function toggle() {
    if (praised) {
      await supabase.from("praises").delete().in("id", mine.map((p) => p.id));
    } else {
      const rows = targets.filter((t) => !mine.some((p) => p.to_member === t))
        .map((t) => ({ household_id: household.id, to_member: t, kind, ref: refId }));
      await supabase.from("praises").insert(rows);
    }
    onChange();
  }

  const names = targets.map((t) => member(t)?.display_name).join(" & ");
  return (
    <button onClick={toggle} title={praised ? "Lob zurücknehmen" : `${names} ein fleißiges Bienchen geben`}
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium transition active:scale-95 ${
        praised ? "border-amber-400 bg-amber-400/20 text-amber-800 dark:text-amber-200" : "border-line hover:border-amber-400 hover:bg-amber-400/10"}`}>
      🐝 {praised ? "Gelobt!" : `${names} loben`}
      {all.length > 0 && <span className="text-xs opacity-70">· {all.length}</span>}
    </button>
  );
}
