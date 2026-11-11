"use client";

import { useState } from "react";
import { notify } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { useWG } from "@/lib/wg";
import type { ChoreArea, Praise } from "@/lib/types";
import { formatDate } from "@/lib/dates";
import { Avatar, btnCls, Card, inputCls } from "@/components/ui";

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
      const { error } = await supabase.from("praises").insert(rows);
      if (!error) notify("putzplan", `🐝 hat dir ein Bienchen gegeben (${kind === "putzen" ? "fürs Putzen" : "für ein To-do"})`, { to: rows.map((r) => r.to_member) });
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

/** Bienchen für alles Mögliche – man muss schreiben, wofür */
export function GiveBee({ onGiven, fixedTo }: { onGiven: () => void; fixedTo?: string }) {
  const { household, members, myId } = useWG();
  const others = members.filter((m) => m.id !== myId);
  const [picked, setTo] = useState<string | null>(null);
  const to = fixedTo ?? picked;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const target = others.find((m) => m.id === to);

  async function give(e: React.FormEvent) {
    e.preventDefault();
    if (!target) { setMsg({ ok: false, text: "Wähle zuerst, wer das Bienchen bekommt." }); return; }
    if (!reason.trim()) { setMsg({ ok: false, text: "Schreib kurz, wofür das Bienchen ist." }); return; }
    setBusy(true);
    const { error } = await supabase.from("praises").insert({
      household_id: household.id, to_member: target.id, kind: "sonstiges", ref: crypto.randomUUID(), reason: reason.trim().slice(0, 120),
    });
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: error.message.includes("reason") || error.message.includes("kind") ? "Datenbank-Update fehlt: Bitte supabase/027_putzen_bienchen.sql im SQL Editor ausführen." : error.message });
      return;
    }
    notify("putzplan", `🐝 hat dir ein Bienchen gegeben: ${reason.trim()}`, { to: [target.id] });
    setMsg({ ok: true, text: fixedTo ? "🐝 Danke für das Bienchen!" : `🐝 Bienchen an ${target.display_name} vergeben!` });
    setReason(""); setTo(null);
    onGiven();
  }

  if (fixedTo) return (
    <form onSubmit={give} className="space-y-2">
      <div className="flex gap-2">
        <input className={`${inputCls} py-2 text-sm`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120}
          placeholder="Wofür?" aria-label="Wofür ist das Bienchen?" />
        <button disabled={busy} className="shrink-0 whitespace-nowrap rounded-xl bg-amber-400 px-3 text-sm font-semibold text-neutral-900 active:scale-95 disabled:opacity-60">🐝 Geben</button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
    </form>
  );

  return (
    <Card>
      <form onSubmit={give} className="space-y-3">
        <p className="font-semibold">🐝 Bienchen vergeben</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Wer bekommt das Bienchen?">
          {others.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={to === m.id} onClick={() => { setTo(m.id); setMsg(null); }}
              className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-sm font-medium transition active:scale-95 ${
                to === m.id ? "border-amber-400 bg-amber-400/20" : "border-line hover:border-amber-400"}`}>
              <Avatar member={m} size={24} />{m.display_name}
            </button>
          ))}
        </div>
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120}
          placeholder={target ? `Wofür bekommt ${target.display_name} das Bienchen?` : "Wofür? z. B. Kuchen gebacken"} />
        <div className="flex items-center gap-3">
          <button disabled={busy} className={`${btnCls} shrink-0 whitespace-nowrap`}>{busy ? "…" : "🐝 Bienchen geben"}</button>
          {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
        </div>
      </form>
    </Card>
  );
}

/** Die letzten Bienchen: wer hat wem wofür eins gegeben */
export function BeeFeed({ praises, areas, onChange, limit = 8 }: { praises: Praise[]; areas: ChoreArea[]; onChange: () => void; limit?: number }) {
  const { member, myId } = useWG();
  const [all, setAll] = useState(false);
  const list = [...praises].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const shown = all ? list : list.slice(0, limit);
  if (!list.length) return null;
  const what = (p: Praise) => {
    if (p.kind === "sonstiges") return p.reason ?? "";
    if (p.kind === "todo") return "für ein erledigtes To-do";
    const area = areas.find((a) => a.id === p.ref.split(":")[0]);
    return area ? `fürs Putzen: ${area.icon} ${area.name}` : "fürs Putzen";
  };
  async function remove(p: Praise) {
    if (!confirm("Dieses Bienchen zurücknehmen?")) return;
    await supabase.from("praises").delete().eq("id", p.id);
    onChange();
  }
  return (
    <Card className="divide-y divide-line p-0">
      {shown.map((p) => (
        <div key={p.id} className="flex items-start gap-3 px-4 py-2.5">
          <Avatar member={member(p.to_member)} size={28} />
          <div className="min-w-0 flex-1 text-sm">
            <p><b>{member(p.to_member)?.display_name ?? "?"}</b> <span className="text-muted">von {member(p.from_member)?.display_name ?? "?"} · {formatDate(p.created_at.slice(0, 10), { day: "numeric", month: "numeric" })}</span></p>
            <p className={p.kind === "sonstiges" ? "" : "text-muted"}>🐝 {what(p)}</p>
          </div>
          {p.from_member === myId && p.kind === "sonstiges" && (
            <button onClick={() => remove(p)} className="shrink-0 text-xs text-muted underline hover:text-red-600">zurücknehmen</button>
          )}
        </div>
      ))}
      {list.length > limit && (
        <button onClick={() => setAll(!all)} className="w-full px-4 py-2 text-left text-sm text-muted hover:text-fg">
          {all ? "Weniger anzeigen" : `Alle ${list.length} anzeigen`}
        </button>
      )}
    </Card>
  );
}
