"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { Todo } from "@/lib/types";
import { daysUntil, formatDate } from "@/lib/dates";
import { Avatar, btnCls, Card, Check, DeleteButton, Empty, inputCls, PageTitle } from "@/components/ui";

type Filter = "offen" | "meine" | "erledigt";

export default function Todos() {
  const { household, members, member, userId } = useWG();
  const { rows: todos, loaded, reload } = useRows<Todo>("todos", "created_at", false);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [filter, setFilter] = useState<Filter>("offen");

  const shown = todos
    .filter((t) => filter === "erledigt" ? t.done : !t.done && (filter === "offen" || t.assignee === userId))
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await supabase.from("todos").insert({
      household_id: household.id, title: title.trim(), assignee: assignee || null, due_date: due || null,
    });
    setTitle(""); setDue("");
    reload();
  }
  async function toggle(t: Todo) {
    await supabase.from("todos").update({ done: !t.done }).eq("id", t.id);
    reload();
  }
  async function remove(t: Todo) {
    await supabase.from("todos").delete().eq("id", t.id);
    reload();
  }

  return (
    <>
      <PageTitle sub="Alles, was einmalig erledigt werden muss: Handwerker anrufen, Nebenkosten prüfen …">To-dos</PageTitle>
      <Card className="mb-5">
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <input className={inputCls} placeholder="Neues To-do" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Alle / egal</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
          </select>
          <input className={inputCls} type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fällig am" />
          <button className={btnCls}>Hinzufügen</button>
        </form>
      </Card>

      <div className="mb-3 flex gap-1 rounded-xl bg-line/50 p-1 text-sm font-medium">
        {(["offen", "meine", "erledigt"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-1 rounded-lg py-1.5 capitalize transition ${filter === f ? "bg-card shadow-sm" : "text-muted"}`}>{f}</button>
        ))}
      </div>

      {loaded && shown.length === 0 && <Empty>{filter === "erledigt" ? "Noch nichts erledigt." : "Nichts offen 🎉"}</Empty>}
      <Card className={`divide-y divide-line p-0 ${shown.length ? "" : "hidden"}`}>
        {shown.map((t) => {
          const late = !t.done && t.due_date && daysUntil(t.due_date) < 0;
          return (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3">
              <Check checked={t.done} onChange={() => toggle(t)} />
              <div className="min-w-0 flex-1">
                <p className={`truncate ${t.done ? "text-muted line-through" : ""}`}>{t.title}</p>
                {t.due_date && <p className={`text-xs ${late ? "font-medium text-red-600" : "text-muted"}`}>bis {formatDate(t.due_date)}</p>}
              </div>
              {t.assignee && <Avatar member={member(t.assignee)} size={24} />}
              <DeleteButton onClick={() => remove(t)} />
            </div>
          );
        })}
      </Card>
    </>
  );
}
