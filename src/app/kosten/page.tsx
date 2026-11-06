"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { Expense } from "@/lib/types";
import { computeBalances, suggestTransfers, type Transfer } from "@/lib/balances";
import { euro, formatDate, todayISO } from "@/lib/dates";
import { Avatar, btnCls, btnGhostCls, Card, DeleteButton, Empty, inputCls, PageTitle, SectionTitle } from "@/components/ui";

export default function Kosten() {
  const { household, members, member, myId } = useWG();
  const { rows: expenses, loaded, reload } = useRows<Expense>("expenses", "created_at", false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(myId);
  const [parts, setParts] = useState<string[] | null>(null); // null = alle
  const participants = parts ?? members.map((m) => m.id);

  const balances = useMemo(() => computeBalances(expenses, members.map((m) => m.id)), [expenses, members]);
  const transfers = useMemo(() => suggestTransfers(balances), [balances]);

  function togglePart(id: string) {
    setParts(participants.includes(id) ? participants.filter((p) => p !== id) : [...participants, id]);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount.replace(",", "."));
    if (!title.trim() || !(value > 0) || participants.length === 0) return;
    await supabase.from("expenses").insert({
      household_id: household.id, title: title.trim(), amount: value, paid_by: paidBy, participants, spent_on: todayISO(),
    });
    setTitle(""); setAmount(""); setParts(null);
    reload();
  }

  async function settle(t: Transfer) {
    const from = member(t.from)?.display_name, to = member(t.to)?.display_name;
    if (!confirm(`Hat ${from} ${euro(t.cents / 100)} an ${to} überwiesen?`)) return;
    await supabase.from("expenses").insert({
      household_id: household.id, title: "Ausgleich", amount: t.cents / 100, paid_by: t.from, participants: [t.to], is_settlement: true,
    });
    reload();
  }

  async function remove(x: Expense) {
    if (!confirm(`„${x.title}“ löschen?`)) return;
    await supabase.from("expenses").delete().eq("id", x.id);
    reload();
  }

  return (
    <>
      <PageTitle sub="Ausgaben eintragen und am Ende mit möglichst wenigen Überweisungen ausgleichen.">Kosten teilen</PageTitle>

      <Card className="mb-5">
        <form onSubmit={add} className="space-y-3">
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <input className={inputCls} placeholder="Wofür? z. B. Wocheneinkauf" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className={`${inputCls} text-right tabular-nums`} placeholder="0,00 €" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Bezahlt von</span>
            <select className={`${inputCls} w-auto py-1.5`} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
            </select>
            <span className="text-muted">für</span>
            {members.map((m) => {
              const on = participants.includes(m.id);
              return (
                <button type="button" key={m.id} onClick={() => togglePart(m.id)}
                  className="rounded-full border px-3 py-1 font-medium transition"
                  style={on ? { background: m.color, borderColor: m.color, color: "white" } : { borderColor: "var(--line)", color: "var(--muted)" }}>
                  {m.display_name}
                </button>
              );
            })}
          </div>
          <button className={`${btnCls} w-full sm:w-auto`}>Ausgabe eintragen</button>
        </form>
      </Card>

      <SectionTitle>Salden</SectionTitle>
      <Card className="divide-y divide-line p-0">
        {members.map((m) => {
          const b = balances[m.id] ?? 0;
          return (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar member={m} />
              <span className="flex-1">{m.display_name}{m.id === myId && <span className="text-muted"> (du)</span>}</span>
              <span className={`font-semibold tabular-nums ${b > 0 ? "text-emerald-600" : b < 0 ? "text-red-600" : "text-muted"}`}>
                {b > 0 && "+"}{euro(b / 100)}
              </span>
            </div>
          );
        })}
      </Card>

      {transfers.length > 0 && (
        <>
          <SectionTitle>So gleicht ihr aus</SectionTitle>
          <div className="space-y-2">
            {transfers.map((t) => (
              <Card key={t.from + t.to} className="flex items-center gap-2">
                <Avatar member={member(t.from)} />
                <span className="text-sm"><b>{member(t.from)?.display_name}</b> → <b>{member(t.to)?.display_name}</b></span>
                <span className="ml-auto font-semibold tabular-nums">{euro(t.cents / 100)}</span>
                <button onClick={() => settle(t)} className={btnGhostCls}>Bezahlt</button>
              </Card>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Verlauf</SectionTitle>
      {loaded && expenses.length === 0 && <Empty>Noch keine Ausgaben.</Empty>}
      <div className="space-y-2">
        {expenses.map((x) => (
          <Card key={x.id} className="flex items-center gap-3">
            <Avatar member={member(x.paid_by)} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{x.is_settlement ? "💸 " : ""}{x.title}</p>
              <p className="truncate text-sm text-muted">
                {formatDate(x.spent_on)} · {member(x.paid_by)?.display_name} {x.is_settlement ? "an" : "für"}{" "}
                {x.participants.length === members.length && !x.is_settlement ? "alle" : x.participants.map((p) => member(p)?.display_name ?? "?").join(", ")}
              </p>
            </div>
            <span className="font-semibold tabular-nums">{euro(Number(x.amount))}</span>
            <DeleteButton onClick={() => remove(x)} />
          </Card>
        ))}
      </div>
    </>
  );
}
