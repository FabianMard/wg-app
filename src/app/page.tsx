"use client";

import Link from "next/link";
import { useWG, useRows } from "@/lib/wg";
import type { CalEvent, ChoreArea, ChoreCheck, ChoreTask, Expense, Praise, ShoppingItem, Todo } from "@/lib/types";
import { areaStatuses, isOverdue, periodOf, periodRange, phaseOf } from "@/lib/cleaning";
import { beesOf } from "@/components/Praise";
import { computeBalances } from "@/lib/balances";
import { addDays, euro, formatDate, todayISO } from "@/lib/dates";
import { holidayOn } from "@/lib/holidays";
import { birthdayName, nextBirthdays, occurrencesBetween } from "@/lib/events";
import { Avatar, Card, PageTitle } from "@/components/ui";
import { Pinboard } from "@/components/Pinboard";

function ResidentHome() {
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
  const birthdays = nextBirthdays(events, todayISO(), 3);
  // Termine + Feiertage der nächsten 7 Tage
  const holidays = Array.from({ length: 8 }, (_, i) => addDays(todayISO(), i))
    .filter((d) => holidayOn(d)).map((d) => ({ id: `fei-${d}`, title: `🎉 ${holidayOn(d)}`, day: d, time: null as string | null }));
  const upcoming = [...holidays, ...occurrencesBetween(events, todayISO(), week).map((o) => ({ ...o.event, id: `${o.event.id}-${o.day}`, day: o.day }))]
    .sort((a, b) => (a.day + (a.time ?? "")).localeCompare(b.day + (b.time ?? ""))).slice(0, 5);
  const myTodos = todos.filter((t) => !t.done && (t.assignee === myId || !t.assignee));

  return (
    <>
      <PageTitle sub={formatDate(todayISO(), { weekday: "long", day: "numeric", month: "long" })}>
        Hallo {me?.display_name} 👋
      </PageTitle>
      <Pinboard />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Tile href="/putzplan" icon="🧽" title="Dein Putzbereich"
          tone={mine.length && mine.some((s) => isOverdue(s, household.cleaning_start, period)) ? "red"
            : mine.length && mine.every((s) => s.done) ? "green" : undefined}>
          {mine.length === 0 ? <Muted>Diese Runde nichts</Muted> : mine.map((s) => (
            <div key={s.area.id}>
              <Row label={`${s.area.icon} ${s.area.name}`} right={s.done ? "✓ erledigt" : `${s.doneCount}/${s.tasks.length}`} warn={isOverdue(s, household.cleaning_start, period)} />
              {s.done
                ? phase !== "putzwoche" && <Muted>Frei bis {formatDate(range.end)} 😎</Muted>
                : isOverdue(s, household.cleaning_start, period)
                  ? <p className="text-sm font-semibold text-red-600">⚠️ Überfällig – bitte nachholen!</p>
                  : <Muted>Putzwoche: bis {formatDate(range.due)} erledigen</Muted>}
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
        <Tile href="/kalender" icon="🎂" title="Nächste Geburtstage" className="sm:col-span-2">
          {birthdays.length === 0
            ? <Muted>Noch keine Geburtstage eingetragen – im Kalender mit „🎂 Geburtstag“.</Muted>
            : birthdays.map((b) => (
              <Row key={b.event.id} label={`🎂 ${birthdayName(b.event.title)}`}
                right={`${formatDate(b.day)} · ${b.inDays === 0 ? "heute! 🎉" : b.inDays === 1 ? "morgen" : `in ${b.inDays} Tagen`}`} warn={b.inDays <= 1} />
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
      <Link href="/bericht" className="mt-3 flex items-center gap-3 rounded-2xl border border-line bg-card p-4 shadow-sm transition hover:border-accent/40">
        <span className="text-2xl">📊</span>
        <span className="flex-1">
          <span className="block font-semibold">Monatsbericht</span>
          <span className="block text-sm text-muted">Was war los in der WG? Putzen, Einkäufe, Kosten, Bienchen …</span>
        </span>
        <span className="text-muted">→</span>
      </Link>
    </>
  );
}

const TONES = {
  green: "border-emerald-500/50 bg-emerald-500/15 dark:bg-emerald-500/20",
  red: "border-red-500/60 bg-red-500/15 dark:bg-red-500/20",
};
function Tile({ href, icon, title, children, className = "", tone }: {
  href: string; icon: string; title: string; children: React.ReactNode; className?: string; tone?: keyof typeof TONES;
}) {
  return (
    <Link href={href} className={`min-w-0 ${className}`}>
      <Card className={`h-full transition hover:border-accent/40 ${tone ? TONES[tone] : ""}`}>
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

export default function Home() {
  const { isGuest } = useWG();
  return isGuest ? <GuestHome /> : <ResidentHome />;
}

/** Startseite für Gäste: nur das, was freigegeben ist */
function GuestHome() {
  const { me, household, can } = useWG();
  const tiles = [
    { href: "/spiel", icon: "🎮", title: "WG-Spiel", text: "Lauf durch die Wohnung und sag Hallo" },
    ...(can("kalender") ? [{ href: "/kalender", icon: "📅", title: "Kalender", text: "Was steht an?" }] : []),
    ...(can("pinnwand") ? [{ href: "/pinnwand", icon: "📌", title: "Pinnwand", text: "Zettel und Fotos der WG" }] : []),
    ...(can("watchlist") ? [{ href: "/watchlist", icon: "📺", title: "Watchlist", text: "Was schauen wir als Nächstes?" }] : []),
  ];
  return (
    <>
      <PageTitle sub={`Du bist als Gast in ${household.name} 👋`}>Hallo {me?.display_name}!</PageTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="min-w-0">
            <Card className="flex h-full items-center gap-3 transition hover:border-accent/40">
              <span className="text-3xl">{t.icon}</span>
              <span className="min-w-0">
                <span className="block font-semibold">{t.title}</span>
                <span className="block text-sm text-muted">{t.text}</span>
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
