"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { ChoreArea, ChoreCheck, ChoreTask, Praise } from "@/lib/types";
import { areaStatuses, isOverdue, periodOf, periodRange, phaseOf, type AreaStatus } from "@/lib/cleaning";
import { formatDate } from "@/lib/dates";
import { Avatar, Card, Check, DeleteButton, inputCls, PageTitle, SectionTitle } from "@/components/ui";
import { Bees, beesOf, PraiseButton } from "@/components/Praise";

export default function Putzplan() {
  const { household, members, myId } = useWG();
  const { rows: areas } = useRows<ChoreArea>("chore_areas", "sort");
  const { rows: tasks, reload: reloadTasks } = useRows<ChoreTask>("chore_tasks", "sort");
  const { rows: checks, reload: reloadChecks } = useRows<ChoreCheck>("chore_checks", "done_at");
  const { rows: praises, reload: reloadPraises } = useRows<Praise>("praises", "created_at");

  const start = household.cleaning_start;
  const period = periodOf(start);
  const range = periodRange(start, period);
  const phase = phaseOf(start, period);

  // Reihenfolge: überfällige zuerst, dann meiner, dann der Rest
  const rank = (x: AreaStatus) => (isOverdue(x, start, period) ? 2 : 0) + (x.assignee?.id === myId ? 1 : 0);
  const current = areaStatuses(areas, tasks, checks, members, period).sort((a, b) => rank(b) - rank(a));
  const overdueCount = current.filter((x) => isOverdue(x, start, period)).length;
  const dayLong = (iso: string) => formatDate(iso, { weekday: "long", day: "numeric", month: "numeric" });
  const previous = areaStatuses(areas, tasks, checks, members, period - 1);
  const next = areaStatuses(areas, tasks, checks, members, period + 1);

  async function toggle(s: AreaStatus, task: ChoreTask) {
    const existing = s.checks.find((c) => c.task_id === task.id);
    if (existing) await supabase.from("chore_checks").delete().eq("id", existing.id);
    else await supabase.from("chore_checks").insert({ household_id: household.id, area_id: s.area.id, task_id: task.id, period });
    reloadChecks();
  }

  return (
    <>
      <PageTitle sub={`Putzwoche ${formatDate(range.from)} – ${formatDate(range.due)} · frei bis ${formatDate(range.end)}`}>Putzplan</PageTitle>

      <div className={`mb-5 rounded-2xl px-4 py-3 text-sm ${
        phase === "putzwoche" ? "bg-accent/10 text-accent"
        : overdueCount ? "bg-red-500/15 text-red-700 dark:text-red-300" : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"}`}>
        {phase === "putzwoche"
          ? <>🧽 <b>Putzwoche!</b> Alles bis <b>{dayLong(range.due)}</b> erledigen. Danach habt ihr eine Woche frei.</>
          : overdueCount
            ? <>⚠️ <b>Freie Woche, aber {overdueCount === 1 ? "ein Bereich ist" : `${overdueCount} Bereiche sind`} noch nicht fertig.</b> Bitte nachholen! Ab {dayLong(periodRange(start, period + 1).from)} gibt es neue Aufgaben.</>
            : <>😎 <b>Freie Woche!</b> Alles erledigt. Neue Aufgaben ab {dayLong(periodRange(start, period + 1).from)}.</>}
      </div>

      <div className="space-y-4">
        {current.map((s) => (
          <AreaCard key={s.area.id} s={s} period={period} overdue={isOverdue(s, start, period)} free={phase !== "putzwoche"} mine={s.assignee?.id === myId}
            praises={praises} onToggle={(t) => toggle(s, t)} onPraise={reloadPraises} onTasksChanged={reloadTasks} />
        ))}
      </div>

      {previous.length > 0 && period > 0 && (
        <>
          <SectionTitle>Letzte Runde</SectionTitle>
          <Card className="divide-y divide-line p-0">
            {previous.map((s) => (
              <div key={s.area.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <span className="text-lg">{s.area.icon}</span>
                <span className="font-medium">{s.area.name}</span>
                <Avatar member={s.assignee} size={22} />
                <span className="text-sm text-muted">{s.assignee?.display_name}</span>
                <span className={`ml-auto text-sm font-medium ${s.done ? "text-emerald-600" : "text-red-600"}`}>
                  {s.done ? "✓ erledigt" : `✗ nicht fertig (${s.doneCount}/${s.tasks.length})`}
                </span>
                {s.done && (
                  <div className="w-full">
                    <PraiseButton kind="putzen" refId={`${s.area.id}:${period - 1}`} praises={praises} onChange={reloadPraises}
                      to={s.helpers.length ? s.helpers : s.assignee ? [s.assignee.id] : []} />
                  </div>
                )}
              </div>
            ))}
          </Card>
        </>
      )}

      <SectionTitle>Nächste Runde ab {formatDate(periodRange(start, period + 1).from)}</SectionTitle>
      <Card className="flex flex-wrap gap-x-5 gap-y-2">
        {next.map((s) => (
          <span key={s.area.id} className="flex items-center gap-2 text-sm">
            <span>{s.area.icon}</span>{s.area.name}<span className="text-muted">→</span>
            <Avatar member={s.assignee} size={22} />{s.assignee?.display_name}
          </span>
        ))}
      </Card>

      <SectionTitle>Fleißige Bienchen</SectionTitle>
      <Card className="flex flex-wrap gap-4">
        {[...members].sort((a, b) => beesOf(praises, b.id) - beesOf(praises, a.id)).map((m) => (
          <span key={m.id} className="flex items-center gap-2">
            <Avatar member={m} />
            <span className="font-medium">{m.display_name}</span>
            <span className="text-sm">🐝 {beesOf(praises, m.id)}</span>
          </span>
        ))}
      </Card>
    </>
  );
}

function AreaCard({ s, period, overdue, free, mine, praises, onToggle, onPraise, onTasksChanged }: {
  s: AreaStatus; period: number; overdue: boolean; free: boolean; mine: boolean; praises: Praise[];
  onToggle: (t: ChoreTask) => void; onPraise: () => void; onTasksChanged: () => void;
}) {
  const { household, member } = useWG();
  const [editing, setEditing] = useState(false);
  const [newTask, setNewTask] = useState("");
  const pct = s.tasks.length ? Math.round((s.doneCount / s.tasks.length) * 100) : 0;

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTask.trim()) return;
    const sort = Math.max(0, ...s.tasks.map((t) => t.sort)) + 1;
    await supabase.from("chore_tasks").insert({ household_id: household.id, area_id: s.area.id, title: newTask.trim(), sort });
    setNewTask("");
    onTasksChanged();
  }
  async function removeTask(t: ChoreTask) {
    if (!confirm(`„${t.title}“ aus der Liste löschen?`)) return;
    await supabase.from("chore_tasks").delete().eq("id", t.id);
    onTasksChanged();
  }

  return (
    <Card className={`p-0 ${overdue ? "border-2 border-red-500 bg-red-500/10 shadow-[0_0_0_4px_rgba(239,68,68,.12)]" : mine && !s.done ? "ring-2 ring-accent/40" : ""} ${s.done ? "border-emerald-500/50 bg-emerald-500/10" : ""}`}>
      {overdue && (
        <div className="flex items-center gap-2 rounded-t-2xl bg-red-500 px-4 py-2 text-sm font-semibold text-white">
          <span className="animate-pulse">⚠️</span>
          Überfällig! {mine ? "Bitte diese Woche nachholen" : `${s.assignee?.display_name} muss nachholen`}
        </div>
      )}
      <div className="flex items-center gap-3 p-4 pb-3">
        <span className="text-3xl">{s.area.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{s.area.name}</p>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Avatar member={s.assignee} size={18} />
            {mine ? <b className="text-fg">Du bist dran</b> : s.assignee?.display_name}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
          s.done ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : overdue ? "bg-red-500/15 text-red-700 dark:text-red-300" : "bg-line/60 text-muted"}`}>
          {s.done ? (free ? "✓ Erledigt · frei 😎" : "✓ Erledigt") : overdue ? `Überfällig ${s.doneCount}/${s.tasks.length}` : `${s.doneCount}/${s.tasks.length}`}
        </span>
      </div>

      <div className="mx-4 h-1.5 overflow-hidden rounded-full bg-line/60">
        <div className={`h-full rounded-full transition-all ${s.done ? "bg-emerald-500" : overdue ? "bg-red-500" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </div>

      <ul className="mt-2">
        {s.tasks.map((t) => {
          const c = s.checks.find((x) => x.task_id === t.id);
          const by = c && c.done_by !== s.assignee?.id ? member(c.done_by)?.display_name : null;
          return (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2">
              <Check checked={!!c} onChange={() => onToggle(t)} color="#10b981" />
              <button onClick={() => onToggle(t)} className={`flex-1 text-left ${c ? "text-muted line-through" : ""}`}>{t.title}</button>
              {by && <span className="text-xs text-muted">✓ {by}</span>}
              {editing && <DeleteButton onClick={() => removeTask(t)} />}
            </li>
          );
        })}
      </ul>

      {editing && (
        <form onSubmit={addTask} className="flex gap-2 px-4 pb-2">
          <input className={`${inputCls} py-2 text-sm`} placeholder="Neue Teilaufgabe" value={newTask} onChange={(e) => setNewTask(e.target.value)} />
          <button className="rounded-xl bg-accent px-3 text-white">+</button>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
        {s.done && (
          <>
            <PraiseButton kind="putzen" refId={`${s.area.id}:${period}`} praises={praises} onChange={onPraise}
              to={s.helpers.length ? s.helpers : s.assignee ? [s.assignee.id] : []} />
            {s.assignee && <Bees count={beesOf(praises, s.assignee.id)} />}
          </>
        )}
        <button onClick={() => setEditing(!editing)} className="ml-auto text-xs text-muted hover:text-fg">
          {editing ? "Fertig" : "Liste bearbeiten"}
        </button>
      </div>
    </Card>
  );
}

