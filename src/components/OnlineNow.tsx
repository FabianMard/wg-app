"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useWG } from "@/lib/wg";
import { Avatar } from "./ui";

/**
 * Zeigt, wer gerade irgendwo in der App online ist (Supabase Realtime Presence).
 * Meldet sich nur einmal an – kein Dauerfeuer, also kein Rate-Limit-Problem.
 */
export function OnlineNow() {
  const { household, myId, everyone } = useWG();
  const [online, setOnline] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!myId) return;
    const ch = supabase.channel(`online-${household.id}`, { config: { presence: { key: myId } } });
    ch.on("presence", { event: "sync" }, () => setOnline(Object.keys(ch.presenceState())))
      .subscribe((status) => { if (status === "SUBSCRIBED") ch.track({ seit: Date.now() }); });
    // Nach dem Entsperren des Handys wieder melden
    // Im Hintergrund / beim Schließen sofort als offline melden, beim Zurückkommen wieder online
    const onVis = () => { if (document.visibilityState === "visible") ch.track({ seit: Date.now() }); else ch.untrack(); };
    const leave = () => ch.untrack();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", leave); supabase.removeChannel(ch); };
  }, [household.id, myId]);

  // Mitbewohner und Gäste
  const others = everyone.filter((m) => m.id !== myId && online.includes(m.id));
  if (!others.length) return null;

  const names = others.map((m) => m.display_name).join(", ");
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-label={`Gerade online: ${names}`} title={`Gerade online: ${names}`}
        className="flex items-center gap-1.5 rounded-full border border-line bg-card py-1 pl-1 pr-2.5 shadow-sm">
        <span className="flex -space-x-2">
          {others.slice(0, 3).map((m) => (
            <span key={m.id} className="relative rounded-full ring-2 ring-card">
              <Avatar member={m} size={24} />
            </span>
          ))}
        </span>
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <span className="hidden text-xs font-medium text-muted sm:inline">online</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-48 rounded-xl border border-line bg-card p-2 shadow-lg" onClick={() => setOpen(false)}>
          <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">Gerade online</p>
          {others.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
              <Avatar member={m} size={24} />
              <span className="flex-1 text-sm">{m.display_name}{m.role === "gast" && <span className="text-xs text-muted"> · Gast</span>}</span>
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
