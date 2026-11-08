"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { Praise, Todo } from "@/lib/types";
import { daysUntil, formatDate } from "@/lib/dates";
import { Avatar, btnCls, Card, Check, DeleteButton, Empty, inputCls, PageTitle } from "@/components/ui";
import { PraiseButton } from "@/components/Praise";
import { Watchlist } from "@/components/Watchlist";

type Filter = "offen" | "meine" | "erledigt";

function TodoList() {
  const { household, members, member, myId } = useWG();
  const { rows: todos, loaded, reload } = useRows<Todo>("todos", "created_at", false);
  const { rows: praises, reload: reloadPraises } = useRows<Praise>("praises", "created_at");
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [filter, setFilter] = useState<Filter>("offen");

  const shown = todos
    .filter((t) => filter === "erledigt" ? t.done : !t.done && (filter === "offen" || t.assignee === myId))
    .sort((a, b) => filter === "erledigt"
      ? (b.done_at ?? "").localeCompare(a.done_at ?? "")
      : (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));

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
    await supabase.from("todos").update(t.done
      ? { done: false, done_by: null, done_at: null }
      : { done: true, done_by: myId, done_at: new Date().toISOString() }).eq("id", t.id);
    reload();
  }
  async function remove(t: Todo) {
    await supabase.from("todos").delete().eq("id", t.id);
    reload();
  }

  return (
    <>
      <Card className="mb-5">
        <form onSubmit={add} className="space-y-2">
          <div className="flex gap-2">
            <input className={inputCls} placeholder="Neues To-do" value={title} onChange={(e) => setTitle(e.target.value)} />
            <button className={`${btnCls} shrink-0`} aria-label="Hinzufügen">+</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0">
              <span className="mb-1 block text-xs font-medium text-muted">👤 Wer?</span>
              <select className={`${inputCls} py-2`} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Alle / egal</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <span className="mb-1 flex items-center justify-between text-xs font-medium text-muted">
                📅 Fällig bis {due && <button type="button" onClick={() => setDue("")} className="underline">löschen</button>}
              </span>
              <input className={`${inputCls} min-w-0 py-2 ${due ? "" : "text-muted"}`} type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fällig bis (optional)" />
            </label>
          </div>
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
          const doneBy = member(t.done_by);
          return (
            <div key={t.id} className="flex items-start gap-3 px-4 py-3">
              <div className="pt-0.5"><Check checked={t.done} onChange={() => toggle(t)} /></div>
              <div className="min-w-0 flex-1">
                <p className={`${t.done ? "text-muted line-through" : ""}`}>{t.title}</p>
                {!t.done && t.due_date && <p className={`text-xs ${late ? "font-medium text-red-600" : "text-muted"}`}>bis {formatDate(t.due_date)}</p>}
                {t.done && doneBy && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">
                      ✓ {doneBy.id === myId ? "von dir" : doneBy.display_name}{t.done_at && `, ${formatDate(t.done_at.slice(0, 10))}`}
                    </span>
                    <PraiseButton kind="todo" refId={t.id} to={[doneBy.id]} praises={praises} onChange={reloadPraises} />
                  </div>
                )}
              </div>
              {t.assignee && !t.done && <Avatar member={member(t.assignee)} size={24} />}
              <DeleteButton onClick={() => remove(t)} />
            </div>
          );
        })}
      </Card>
    </>
  );
}

type Tab = "todos" | "watchlist";

export default function Todos() {
  const [tab, setTab] = useState<Tab>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "watchlist" ? "watchlist" : "todos");
  return (
    <>
      <PageTitle sub={tab === "todos" ? "Alles, was einmalig erledigt werden muss: Handwerker anrufen, Nebenkosten prüfen …" : "Was wollen wir zusammen schauen?"}>
        {tab === "todos" ? "To-dos" : "Watchlist"}
      </PageTitle>
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-line/50 p-1 text-sm font-semibold">
        {([["todos", "✅ To-dos"], ["watchlist", "📺 Watchlist"]] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); window.history.replaceState(null, "", id === "watchlist" ? "?tab=watchlist" : location.pathname); }}
            className={`rounded-lg py-2 transition ${tab === id ? "bg-card shadow-sm" : "text-muted"}`}>{label}</button>
        ))}
      </div>
      {tab === "todos" ? <TodoList /> : <Watchlist />}
    </>
  );
}
