"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import { notify } from "@/lib/push";
import { euro, formatDate, todayISO } from "@/lib/dates";
import type { CostRequest } from "@/lib/types";
import { Avatar, btnCls, Card, Empty, inputCls } from "@/components/ui";

/**
 * Kosten einreichen: Wer etwas für die WG ausgelegt hat, reicht es ein.
 * Der Vorsitz des Haushaltsausschusses gibt frei → wird automatisch als Ausgabe eingetragen (geteilt durch alle).
 */

/** Offene Anträge, die ich als Vorsitz entscheiden muss (für die Zahl am Reiter) */
export function useOpenRequestCount() {
  const { household, myId } = useWG();
  const { rows } = useRows<CostRequest>("cost_requests", "created_at", false);
  return household.finance_chair === myId ? rows.filter((r) => r.status === "offen").length : 0;
}

const DB_HINT = "Datenbank-Update fehlt: Bitte supabase/023_kosten_freigabe.sql im SQL Editor ausführen.";

export function CostRequests({ onApproved }: { onApproved?: () => void }) {
  const { household, members, member, myId, refresh } = useWG();
  const { rows, loaded, reload } = useRows<CostRequest>("cost_requests", "created_at", false);
  const chair = member(household.finance_chair ?? null);
  const iAmChair = household.finance_chair === myId;
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(todayISO());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [changingChair, setChangingChair] = useState(false);

  const open = rows.filter((r) => r.status === "offen");
  const done = rows.filter((r) => r.status !== "offen").slice(0, 15);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const value = Number(amount.replace(",", "."));
    if (!title.trim()) return setMsg({ ok: false, text: "Wofür hast du Geld ausgegeben?" });
    if (!(value > 0)) return setMsg({ ok: false, text: "Bitte einen Betrag eingeben." });
    setBusy(true);
    const { error } = await supabase.from("cost_requests").insert({
      household_id: household.id, title: title.trim().slice(0, 120), amount: Math.round(value * 100) / 100, spent_on: day, note: note.trim() || null,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message.includes("cost_requests") ? DB_HINT : error.message });
    if (chair && chair.id !== myId) notify("freigabe", `${title.trim()} – ${euro(value)} (bitte freigeben)`, { to: [chair.id] });
    setTitle(""); setAmount(""); setNote(""); setDay(todayISO());
    setMsg({ ok: true, text: chair ? `✓ Eingereicht – ${chair.id === myId ? "du kannst es unten gleich freigeben" : `${chair.display_name} bekommt Bescheid`}.` : "✓ Eingereicht." });
    reload();
  }

  async function decide(r: CostRequest, approve: boolean) {
    const reason = (notes[r.id] ?? "").trim();
    if (!approve && !confirm(`„${r.title}“ (${euro(r.amount)}) ablehnen?`)) return;
    const { error } = await supabase.rpc("decide_cost_request", { p_id: r.id, p_approve: approve, p_note: reason || null });
    if (error) return setMsg({ ok: false, text: error.message.includes("decide_cost_request") ? DB_HINT : error.message });
    if (r.created_by !== myId) notify("freigabe", `${approve ? "✅ Freigegeben" : "❌ Abgelehnt"}: ${r.title} – ${euro(r.amount)}${reason ? ` („${reason}“)` : ""}`, { to: [r.created_by] });
    reload();
    if (approve) onApproved?.();
  }

  async function withdraw(r: CostRequest) {
    if (!confirm(`Antrag „${r.title}“ zurückziehen?`)) return;
    await supabase.from("cost_requests").delete().eq("id", r.id);
    reload();
  }

  async function setChair(id: string) {
    const { error } = await supabase.from("households").update({ finance_chair: id }).eq("id", household.id);
    if (error) return setMsg({ ok: false, text: error.message.includes("finance_chair") ? DB_HINT : error.message });
    setChangingChair(false);
    await refresh();
  }

  // Für den Vorsitz stehen offene Anträge vor dem Formular
  const pendingFirst = iAmChair && open.length > 0;
  return (
    <div className="flex flex-col gap-5">
      {/* Vorsitz */}
      <div className="order-first flex items-center gap-3 rounded-2xl bg-amber-400/15 px-3 py-2.5">
        <span className="text-2xl">👑</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">Vorsitz Haushaltsausschuss</p>
          {changingChair ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {members.map((m) => (
                <button key={m.id} onClick={() => setChair(m.id)}
                  className={`rounded-full border px-2.5 py-0.5 text-sm font-medium ${m.id === household.finance_chair ? "border-accent bg-accent/10" : "border-line"}`}>{m.display_name}</button>
              ))}
            </div>
          ) : <p className="font-semibold">{chair ? (iAmChair ? `${chair.display_name} (du)` : chair.display_name) : "Noch niemand"}</p>}
        </div>
        <button onClick={() => setChangingChair(!changingChair)} className="shrink-0 text-xs font-semibold text-accent">{changingChair ? "Fertig" : "ändern"}</button>
      </div>

      {/* Einreichen */}
      <Card className={pendingFirst ? "order-3" : "order-1"}>
        <form onSubmit={submit} className="space-y-3">
          <p className="font-semibold">📝 Kosten einreichen</p>
          <input className={inputCls} placeholder="Wofür? z. B. Putzmittel, Glühbirnen …" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0">
              <span className="mb-1 block text-xs font-medium text-muted">💶 Betrag</span>
              <span className="relative block">
                <input className={`${inputCls} py-2 pr-8`} inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted">€</span>
              </span>
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-xs font-medium text-muted">📅 Gekauft am</span>
              <input type="date" className={`${inputCls} py-2`} value={day} max={todayISO()} onChange={(e) => setDay(e.target.value)} />
            </label>
          </div>
          <input className={`${inputCls} py-2 text-sm`} placeholder="Notiz (optional), z. B. Laden oder Grund" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          <button disabled={busy} className={`${btnCls} w-full`}>{busy ? "…" : chair && !iAmChair ? `Bei ${chair.display_name} einreichen` : "Einreichen"}</button>
          {msg && <p className={`text-sm ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>{msg.text}</p>}
          <p className="text-xs text-muted">Nach der Freigabe wird der Betrag unter Kosten eingetragen: bezahlt von dir, geteilt durch alle.</p>
        </form>
      </Card>

      {/* Offene Anträge */}
      <div className={pendingFirst ? "order-1" : "order-2"}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          {iAmChair ? `Warten auf deine Freigabe (${open.length})` : `Offen (${open.length})`}
        </p>
        {loaded && open.length === 0 && <Empty>Nichts offen. 🎉</Empty>}
        <div className="space-y-2">
          {open.map((r) => {
            const by = member(r.created_by);
            return (
              <Card key={r.id} className="space-y-2">
                <div className="flex items-start gap-3">
                  <Avatar member={by} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{r.title}</p>
                    <p className="text-xs text-muted">{by?.id === myId ? "von dir" : `von ${by?.display_name ?? "?"}`} · gekauft {formatDate(r.spent_on)}</p>
                    {r.note && <p className="mt-0.5 text-sm text-muted">„{r.note}“</p>}
                  </div>
                  <p className="shrink-0 text-lg font-bold tabular-nums">{euro(r.amount)}</p>
                </div>
                {iAmChair ? (
                  <div className="space-y-2">
                    <input className={`${inputCls} py-1.5 text-sm`} placeholder="Kommentar (optional)" value={notes[r.id] ?? ""} maxLength={300}
                      onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => decide(r, false)} className="rounded-xl border border-line py-2 text-sm font-semibold">❌ Ablehnen</button>
                      <button onClick={() => decide(r, true)} className="rounded-xl bg-green-600 py-2 text-sm font-semibold text-white">✅ Freigeben</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>⏳ wartet auf {chair?.display_name ?? "den Vorsitz"}</span>
                    {r.created_by === myId && <button onClick={() => withdraw(r)} className="font-semibold text-accent">Zurückziehen</button>}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* Erledigt */}
      {done.length > 0 && (
        <div className="order-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Entschieden</p>
          <Card className="divide-y divide-line p-0">
            {done.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="text-lg">{r.status === "freigegeben" ? "✅" : "❌"}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.title}</p>
                  <p className="truncate text-xs text-muted">
                    {member(r.created_by)?.display_name ?? "?"} · {r.status === "freigegeben" ? "freigegeben" : "abgelehnt"}{r.decided_at && ` am ${formatDate(r.decided_at.slice(0, 10))}`}
                    {r.decision_note && ` · „${r.decision_note}“`}
                  </p>
                </div>
                <span className={`shrink-0 tabular-nums ${r.status === "abgelehnt" ? "text-muted line-through" : "font-semibold"}`}>{euro(r.amount)}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
