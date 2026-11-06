"use client";

import Link from "next/link";
import { useWG, useRows } from "@/lib/wg";
import type { CalEvent, ChoreArea, ChoreCheck, ChoreTask, Expense, Praise, ShoppingItem, Todo } from "@/lib/types";
import { areaStatuses, periodOf, periodRange, phaseOf } from "@/lib/cleaning";
import { beesOf } from "@/components/Praise";
import { computeBalances } from "@/lib/balances";
import { addDays, euro, formatDate, todayISO } from "@/lib/dates";
import { Avatar, Card, PageTitle } from "@/components/ui";

export default function Home() {
  const { me, myId, members, household } = useWG();
  const { rows: areas } = useRows<ChoreArea>("chore_areas", "sort");
  const { rows: tasks } = useRows<ChoreTask>("chore_tasks", "sort");
  const { rows: checks } = useRows<ChoreCheck>("chore_checks", "done_at");
  const { rows: praises } = useRows<Praise>("praises", "created_at");
  const { rows: items } = useRows<ShoppingItem>("shopping_items", "created_at");
  const { rows: expenses } = useRows<Expense>("expenses", "created_at");
  const { rows: events } = useRows<CalEvent>("events", "day");
  const { rows: todos } = useRows<Todo>("todos", "created_at");

  const period = periodOf(household.cleaning_start);
  const range = periodRange(household.cleaning_start, period);
  const phase = phaseOf(household.cleaning_start, period);
  const mine = areaStatuses(areas, tasks, checks, members, period).filter((s) => s.assignee?.id === myId);
  const openItems = items.filter((i) => !i.done && !i.archived);
  const balance = computeBalances(expenses, members.map((m) => m.id))[myId] ?? 0;
  const ranking = [...members].sort((a, b) => beesOf(praises, b.id) - beesOf(praises, a.id));
  const week = addDays(todayISO(), 7);
  const upcoming = events.filter((e) => e.day >= todayISO() && e.day <= week).slice(0, 4);
  const myTodos = todos.filter((t) => !t.done && (t.assignee === myId || !t.assignee));

  return (
    <>
      <PageTitle sub={formatDate(todayISO(), { weekday: "long", day: "numeric", month: "long" })}>
        Hallo {me?.display_name} 👋
      </PageTitle>
      <Link href="/spiel" className="mb-3 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-accent to-fuchsia-500 p-4 text-white shadow-sm transition hover:opacity-95">
        <span className="text-3xl">🎮</span>
        <span className="flex-1">
          <span className="block font-semibold">Ab ins WG-Spiel</span>
          <span className="block text-sm opacity-90">Lauf durch die Wohnung, red mit den anderen, verteil Bienchen</span>
        </span>
        <span className="text-xl">→</span>
      </Link>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Tile href="/putzplan" icon="🧽" title="Dein Putzbereich">
          {mine.length === 0 ? <Muted>Diese Runde nichts</Muted> : mine.map((s) => (
            <div key={s.area.id}>
              <Row label={`${s.area.icon} ${s.area.name}`} right={s.done ? "✓ erledigt" : `${s.doneCount}/${s.tasks.length}`} warn={!s.done && phase === "woche2"} />
              {!s.done && (
                <Muted>{phase === "woche1" ? `Am besten bis ${formatDate(range.soft)}` : `Spätestens bis ${formatDate(range.end)}!`}</Muted>
              )}
            </div>
          ))}
        </Tile>
        <Tile href="/einkauf" icon="🛒" title="Einkaufsliste">
          {openItems.length === 0 ? <Muted>Alles da</Muted> : (
            <p className="text-sm"><b>{openItems.length}</b> {openItems.length === 1 ? "Sache" : "Sachen"}:{" "}
              <span className="text-muted">{openItems.slice(0, 5).map((i) => i.name).join(", ")}{openItems.length > 5 && " …"}</span></p>
          )}
        </Tile>
        <Tile href="/kosten" icon="💶" title="Dein Kontostand">
          <p className={`text-2xl font-bold tabular-nums ${balance > 0 ? "text-emerald-600" : balance < 0 ? "text-red-600" : ""}`}>
            {euro(balance / 100)}
          </p>
          <Muted>{balance > 0 ? "bekommst du zurück" : balance < 0 ? "schuldest du" : "alles ausgeglichen"}</Muted>
        </Tile>
        <Tile href="/kalender" icon="📅" title="Nächste 7 Tage">
          {upcoming.length === 0 ? <Muted>Keine Termine</Muted> : upcoming.map((e) => (
            <Row key={e.id} label={e.title} right={formatDate(e.day) + (e.time ? `, ${e.time.slice(0, 5)}` : "")} />
          ))}
        </Tile>
        <Tile href="/todos" icon="✅" title="Offene To-dos" className="sm:col-span-2">
          {myTodos.length === 0 ? <Muted>Nichts offen</Muted> : myTodos.slice(0, 5).map((t) => (
            <Row key={t.id} label={t.title} right={t.due_date ? formatDate(t.due_date) : ""} />
          ))}
        </Tile>
        <Tile href="/putzplan" icon="🐝" title="Fleißige Bienchen" className="sm:col-span-2">
          <div className="flex flex-wrap gap-4">
            {ranking.map((m, i) => (
              <span key={m.id} className="flex items-center gap-2 text-sm">
                {i === 0 && beesOf(praises, m.id) > 0 && <span>👑</span>}
                <Avatar member={m} size={24} />{m.display_name}<b>{beesOf(praises, m.id)}</b>
              </span>
            ))}
          </div>
        </Tile>
      </div>
    </>
  );
}

function Tile({ href, icon, title, children, className = "" }: { href: string; icon: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={`min-w-0 ${className}`}>
      <Card className="h-full transition hover:border-accent/40">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><span>{icon}</span>{title}</div>
        <div className="space-y-1">{children}</div>
      </Card>
    </Link>
  );
}
const Muted = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-muted">{children}</p>;
const Row = ({ label, right, warn }: { label: string; right: string; warn?: boolean }) => (
  <div className="flex justify-between gap-2 text-sm">
    <span className="truncate">{label}</span>
    <span className={`shrink-0 ${warn ? "font-medium text-red-600" : "text-muted"}`}>{right}</span>
  </div>
);
