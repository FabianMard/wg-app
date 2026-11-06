"use client";

import Link from "next/link";
import { useWG, useRows } from "@/lib/wg";
import type { CalEvent, Chore, Expense, ShoppingItem, Todo } from "@/lib/types";
import { computeBalances } from "@/lib/balances";
import { addDays, daysUntil, euro, formatDate, relativeDay, todayISO } from "@/lib/dates";
import { Card, PageTitle } from "@/components/ui";

export default function Home() {
  const { me, userId, members } = useWG();
  const { rows: chores } = useRows<Chore>("chores", "next_due");
  const { rows: items } = useRows<ShoppingItem>("shopping_items", "created_at");
  const { rows: expenses } = useRows<Expense>("expenses", "created_at");
  const { rows: events } = useRows<CalEvent>("events", "day");
  const { rows: todos } = useRows<Todo>("todos", "created_at");

  const myChores = chores.filter((c) => c.assignee === userId && daysUntil(c.next_due) <= 2);
  const openItems = items.filter((i) => !i.done);
  const balance = computeBalances(expenses, members.map((m) => m.user_id))[userId] ?? 0;
  const week = addDays(todayISO(), 7);
  const upcoming = events.filter((e) => e.day >= todayISO() && e.day <= week).slice(0, 4);
  const myTodos = todos.filter((t) => !t.done && (t.assignee === userId || !t.assignee));

  return (
    <>
      <PageTitle sub={formatDate(todayISO(), { weekday: "long", day: "numeric", month: "long" })}>
        Hallo {me?.display_name} 👋
      </PageTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Tile href="/putzplan" icon="🧽" title="Deine Putzaufgaben">
          {myChores.length === 0 ? <Muted>Gerade nichts zu tun 🎉</Muted> : myChores.map((c) => (
            <Row key={c.id} label={c.title} right={relativeDay(c.next_due)} warn={daysUntil(c.next_due) < 0} />
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
      </div>
    </>
  );
}

function Tile({ href, icon, title, children, className = "" }: { href: string; icon: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={className}>
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
