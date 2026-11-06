"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useWG } from "@/lib/wg";
import type { ShoppingItem } from "@/lib/types";
import { storeById } from "@/lib/stores";
import { euro, todayISO } from "@/lib/dates";
import { btnCls, btnGhostCls, Card, inputCls } from "@/components/ui";

type Mode = "gleich" | "individuell";

const parseEuro = (s: string) => {
  const n = Number(s.replace(/\s|€/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const centsToInput = (c: number) => (c / 100).toFixed(2).replace(".", ",");

/** Titel wie „Einkauf Rewe: Hafermilch, Tomaten +2“ */
function titleFor(items: ShoppingItem[]) {
  const stores = [...new Set(items.map((i) => (i.store === "sonstiges" && i.store_note ? i.store_note : storeById(i.store).label)))]
    .filter((s) => s !== "Egal");
  const names = items.map((i) => i.name);
  const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
  return `Einkauf${stores.length ? " " + stores.join("/") : ""}: ${shown}`.slice(0, 80);
}

/**
 * Nach dem Einkaufen: Betrag eintragen und aufteilen.
 * Legt Ausgaben unter „Kosten“ an und räumt die gekauften Sachen von der Liste.
 */
export function Checkout({ items, onDone, onCancel }: { items: ShoppingItem[]; onDone: (msg: string) => void; onCancel: () => void }) {
  const { household, members, myId, member } = useWG();
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(myId);
  const [title, setTitle] = useState(() => titleFor(items));
  const [mode, setMode] = useState<Mode>("gleich");
  const [parts, setParts] = useState<string[]>(() => members.map((m) => m.id));
  const [shares, setShares] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const total = parseEuro(amount);
  const validTotal = Number.isFinite(total) && total > 0;
  const shareCents = Object.fromEntries(members.map((m) => [m.id, parseEuro(shares[m.id] || "0")]));
  const sumShares = members.reduce((s, m) => s + (Number.isFinite(shareCents[m.id]) ? shareCents[m.id] : 0), 0);
  const rest = validTotal ? total - sumShares : 0;

  function togglePart(id: string) {
    setParts((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }
  // Individuell: Rest auf alle verteilen, die noch 0 haben (oder auf alle)
  function distributeRest() {
    if (!validTotal) return;
    const empty = members.filter((m) => !shareCents[m.id]);
    const targets = empty.length ? empty : members;
    const add = Math.floor(rest / targets.length);
    let extra = rest - add * targets.length;
    const next = { ...shares };
    for (const m of targets) {
      const e = extra > 0 ? 1 : 0;
      extra -= e;
      next[m.id] = centsToInput((Number.isFinite(shareCents[m.id]) ? shareCents[m.id] : 0) + add + e);
    }
    setShares(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!validTotal) return setErr("Bitte einen Betrag eingeben, z. B. 23,45");
    let rows: object[];
    const base = { household_id: household.id, paid_by: paidBy, spent_on: todayISO() };
    if (mode === "gleich") {
      if (!parts.length) return setErr("Mindestens eine Person auswählen.");
      rows = [{ ...base, title: title.trim() || "Einkauf", amount: total / 100, participants: parts }];
    } else {
      if (members.some((m) => !Number.isFinite(shareCents[m.id]) || shareCents[m.id] < 0)) return setErr("Bitte gültige Beträge eingeben.");
      if (rest !== 0) return setErr(`Die Anteile ergeben ${euro(sumShares / 100)}, der Einkauf kostet aber ${euro(total / 100)}.`);
      // Pro Person eine Ausgabe – so bleibt der Kontostand für jede Person exakt
      rows = members.filter((m) => shareCents[m.id] > 0).map((m) => ({
        ...base, title: `${title.trim() || "Einkauf"} (Anteil ${m.display_name})`, amount: shareCents[m.id] / 100, participants: [m.id],
      }));
    }
    setBusy(true);
    const { error } = await supabase.from("expenses").insert(rows);
    if (error) { setBusy(false); return setErr(error.message); }
    await supabase.from("shopping_items").update({ archived: true }).in("id", items.map((i) => i.id));
    setBusy(false);
    onDone(`✓ ${euro(total / 100)} von ${member(paidBy)?.display_name} unter Kosten eingetragen`);
  }

  return (
    <Card className="mb-4 border-accent/40">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold">🧾 Einkauf abrechnen</p>
          <button type="button" onClick={onCancel} className="text-sm text-muted hover:text-fg">Abbrechen</button>
        </div>

        <div className="grid grid-cols-[1fr_8rem] gap-2">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Bezeichnung" />
          <input className={`${inputCls} text-right text-lg font-semibold tabular-nums`} placeholder="0,00 €" inputMode="decimal"
            value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus aria-label="Betrag" />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Bezahlt von</span>
          <select className={`${inputCls} w-auto py-1.5`} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
        </label>

        <div>
          <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-line/50 p-1 text-sm font-medium">
            {([["gleich", "Gleich aufteilen"], ["individuell", "Individuell"]] as [Mode, string][]).map(([id, label]) => (
              <button type="button" key={id} onClick={() => setMode(id)}
                className={`rounded-lg py-1.5 transition ${mode === id ? "bg-card shadow-sm" : "text-muted"}`}>{label}</button>
            ))}
          </div>

          {mode === "gleich" ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {members.map((m) => {
                  const on = parts.includes(m.id);
                  return (
                    <button type="button" key={m.id} onClick={() => togglePart(m.id)}
                      className="rounded-full border px-3 py-1 text-sm font-medium transition"
                      style={on ? { background: m.color, borderColor: m.color, color: "white" } : { borderColor: "var(--line)", color: "var(--muted)" }}>
                      {m.display_name}
                    </button>
                  );
                })}
              </div>
              {validTotal && parts.length > 0 && (
                <p className="text-sm text-muted">Je <b className="text-fg">{euro(total / 100 / parts.length)}</b> für {parts.length} {parts.length === 1 ? "Person" : "Personen"}</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full" style={{ background: m.color }} />
                  <span className="flex-1 text-sm">{m.display_name}{m.id === myId && <span className="text-muted"> (du)</span>}</span>
                  <input className={`${inputCls} w-28 py-1.5 text-right tabular-nums`} placeholder="0,00" inputMode="decimal"
                    value={shares[m.id] ?? ""} onChange={(e) => setShares({ ...shares, [m.id]: e.target.value })} />
                </label>
              ))}
              {validTotal && (
                <div className="flex items-center justify-between text-sm">
                  <span className={rest === 0 ? "text-emerald-600" : "text-amber-700 dark:text-amber-300"}>
                    {rest === 0 ? "✓ Passt genau" : rest > 0 ? `Noch ${euro(rest / 100)} zu verteilen` : `${euro(-rest / 100)} zu viel`}
                  </span>
                  {rest > 0 && <button type="button" onClick={distributeRest} className={btnGhostCls}>Rest verteilen</button>}
                </div>
              )}
              <p className="text-xs text-muted">Z. B. wenn jemand eigene Sachen mitgekauft hat: Anteil der Person eintragen, Rest gleich verteilen.</p>
            </div>
          )}
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className={`${btnCls} w-full`} disabled={busy}>
          {busy ? "Wird eingetragen …" : `Eintragen & ${items.length} ${items.length === 1 ? "Sache" : "Sachen"} abhaken`}
        </button>
      </form>
    </Card>
  );
}
