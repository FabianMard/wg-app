"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { Chore } from "@/lib/types";
import { addDays, daysUntil, relativeDay, todayISO } from "@/lib/dates";
import { Avatar, btnCls, Card, DeleteButton, Empty, inputCls, PageTitle } from "@/components/ui";

const INTERVALS = [
  { days: 1, label: "täglich" },
  { days: 3, label: "alle 3 Tage" },
  { days: 7, label: "wöchentlich" },
  { days: 14, label: "alle 2 Wochen" },
  { days: 30, label: "monatlich" },
];
const intervalLabel = (d: number) => INTERVALS.find((i) => i.days === d)?.label ?? `alle ${d} Tage`;

export default function Putzplan() {
  const { household, members, member, userId } = useWG();
  const { rows: chores, loaded, reload } = useRows<Chore>("chores", "next_due");
  const [title, setTitle] = useState("");
  const [interval, setIntervalDays] = useState(7);
  const [assignee, setAssignee] = useState(userId);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await supabase.from("chores").insert({ household_id: household.id, title: title.trim(), interval_days: interval, assignee });
    setTitle("");
    reload();
  }

  // Erledigt: nächste Person in der Reihenfolge der Mitglieder ist dran
  async function done(c: Chore) {
    const idx = members.findIndex((m) => m.user_id === c.assignee);
    const next = members[(idx + 1) % members.length]?.user_id ?? null;
    await supabase.from("chores").update({
      assignee: next,
      next_due: addDays(todayISO(), c.interval_days),
      last_done_at: new Date().toISOString(),
      last_done_by: userId,
    }).eq("id", c.id);
    reload();
  }

  async function remove(c: Chore) {
    if (!confirm(`„${c.title}“ löschen?`)) return;
    await supabase.from("chores").delete().eq("id", c.id);
    reload();
  }

  return (
    <>
      <PageTitle sub="Wer erledigt hat, gibt die Aufgabe automatisch an die nächste Person weiter.">Putzplan</PageTitle>

      <Card className="mb-5">
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <input className={inputCls} placeholder="Neue Aufgabe, z. B. Bad putzen" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className={inputCls} value={interval} onChange={(e) => setIntervalDays(Number(e.target.value))}>
            {INTERVALS.map((i) => <option key={i.days} value={i.days}>{i.label}</option>)}
          </select>
          <select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
          </select>
          <button className={btnCls}>Hinzufügen</button>
        </form>
      </Card>

      {loaded && chores.length === 0 && <Empty>Noch keine Aufgaben. Leg oben die erste an.</Empty>}
      <div className="space-y-2">
        {chores.map((c) => {
          const d = daysUntil(c.next_due);
          const who = member(c.assignee);
          return (
            <Card key={c.id} className={`flex items-center gap-3 ${d < 0 ? "border-red-500/40" : ""}`}>
              <Avatar member={who} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.title}</p>
                <p className="text-sm text-muted">
                  {who?.display_name ?? "niemand"} ·{" "}
                  <span className={d < 0 ? "font-medium text-red-600" : d === 0 ? "font-medium text-amber-600" : ""}>{relativeDay(c.next_due)}</span>
                  {" "}· {intervalLabel(c.interval_days)}
                </p>
              </div>
              <button onClick={() => done(c)} className={`${btnCls} px-3 py-2 text-sm`}>Erledigt</button>
              <DeleteButton onClick={() => remove(c)} />
            </Card>
          );
        })}
      </div>
    </>
  );
}
