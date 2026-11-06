"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { CalEvent, ChoreArea, ChoreCheck, ChoreTask } from "@/lib/types";
import { areaStatuses, isOverdue, periodOf, periodRange, type AreaStatus } from "@/lib/cleaning";
import { formatDate, fromISO, toISO, todayISO } from "@/lib/dates";
import { Avatar, btnCls, Card, DeleteButton, inputCls, PageTitle, SectionTitle } from "@/components/ui";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MAX_EVENTS_IN_TILE = 2;

export default function Kalender() {
  const { household, members } = useWG();
  const { rows: events, reload } = useRows<CalEvent>("events", "day");
  const { rows: areas } = useRows<ChoreArea>("chore_areas", "sort");
  const { rows: tasks } = useRows<ChoreTask>("chore_tasks", "sort");
  const { rows: checks } = useRows<ChoreCheck>("chore_checks", "done_at");
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState(todayISO());
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");

  const cs = household.cleaning_start;

  // Raster: beginnt am Montag vor dem Monatsersten, 6 Wochen
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return toISO(d); });

  // Putzplan-Status je Runde (wird pro Runde nur einmal berechnet)
  const statusByPeriod = useMemo(() => {
    const map = new Map<number, AreaStatus[]>();
    return (p: number) => {
      if (!map.has(p)) map.set(p, p < 0 ? [] : areaStatuses(areas, tasks, checks, members, p));
      return map.get(p)!;
    };
  }, [areas, tasks, checks, members]);

  const eventsOn = (iso: string) =>
    events.filter((e) => e.day === iso).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  // Ende der Putzwoche (Sonntag) markieren
  const milestone = (iso: string): "Fällig" | null => {
    const p = periodOf(cs, iso);
    if (p < 0) return null;
    const r = periodRange(cs, p);
    return iso === r.due ? "Fällig" : null;
  };
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await supabase.from("events").insert({ household_id: household.id, title: title.trim(), day: selected, time: time || null });
    setTitle(""); setTime("");
    reload();
  }
  async function remove(ev: CalEvent) {
    await supabase.from("events").delete().eq("id", ev.id);
    reload();
  }

  const dayEvents = eventsOn(selected);
  const selPeriod = periodOf(cs, selected);
  const selChores = statusByPeriod(selPeriod);
  const selRange = periodRange(cs, selPeriod);
  const selMilestone = milestone(selected);

  return (
    <>
      <PageTitle>Kalender</PageTitle>
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between px-2 py-2">
          <button onClick={() => shift(-1)} className="rounded-lg px-3 py-1 text-lg hover:bg-line/50" aria-label="Vorheriger Monat">‹</button>
          <span className="font-semibold">{month.toLocaleDateString("de-DE", { month: "long", year: "numeric" })}</span>
          <button onClick={() => shift(1)} className="rounded-lg px-3 py-1 text-lg hover:bg-line/50" aria-label="Nächster Monat">›</button>
        </div>
        <div className="grid grid-cols-7 border-t border-line text-center text-xs text-muted">
          {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-px border-t border-line bg-line">
          {days.map((iso) => {
            const inMonth = fromISO(iso).getMonth() === month.getMonth();
            const isToday = iso === todayISO();
            const isSel = iso === selected;
            const evs = eventsOn(iso);
            const chores = statusByPeriod(periodOf(cs, iso));
            const ms = milestone(iso);
            return (
              <button key={iso} onClick={() => setSelected(iso)} lang="de"
                className={`relative flex min-h-[104px] flex-col gap-0.5 p-1 text-left transition md:min-h-[120px] md:p-1.5
                  ${isSel ? "z-10 bg-card shadow-[inset_0_0_0_999px_color-mix(in_srgb,var(--accent)_8%,transparent)] outline outline-2 -outline-offset-2 outline-accent" : "bg-card hover:bg-line/30"}
                  ${inMonth ? "" : "bg-bg"}`}>
                <span className="flex items-center justify-between">
                  <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs tabular-nums
                    ${isToday ? "bg-accent font-bold text-white" : "font-medium"} ${inMonth ? "" : "opacity-40"}`}>
                    {fromISO(iso).getDate()}
                  </span>
                  {ms && (
                    <span title="Ende der Putzwoche: alles sollte fertig sein"
                      className="hidden rounded bg-red-500/15 px-0.5 text-[9px] font-bold uppercase leading-tight text-red-600 md:inline">
                      Fällig
                    </span>
                  )}
                </span>

                {ms && <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-red-500 md:hidden" />}

                {/* Termine */}
                <span className={`flex min-w-0 flex-col gap-0.5 ${inMonth ? "" : "opacity-50"}`}>
                  {evs.slice(0, MAX_EVENTS_IN_TILE).map((e) => (
                    <span key={e.id} className="line-clamp-2 hyphens-auto break-words rounded bg-accent/15 px-0.5 text-[9px] font-medium leading-[11px] text-accent md:truncate md:px-1 md:text-[11px] md:leading-4">
                      <span className="hidden md:inline">{e.time && `${e.time.slice(0, 5)} `}</span>{e.title}
                    </span>
                  ))}
                  {evs.length > MAX_EVENTS_IN_TILE && (
                    <span className="px-0.5 text-[9px] leading-3 text-muted md:px-1 md:text-[10px]">+{evs.length - MAX_EVENTS_IN_TILE}<span className="hidden md:inline"> weitere</span></span>
                  )}
                </span>

                {/* Putzplan: Balken je Bereich in der Farbe der Person über die Putzwoche.
                    In der freien Woche nur, wenn der Bereich überfällig ist (rot gestreift). */}
                {chores.length > 0 && (() => {
                  const p = periodOf(cs, iso);
                  const r = periodRange(cs, p);
                  const duty = iso <= r.due;
                  const isStart = iso === (duty ? r.from : r.freeFrom);
                  const isEnd = iso === (duty ? r.due : r.end);
                  const isSunday = fromISO(iso).getDay() === 0;
                  return (
                    <span className="-mx-1 mt-auto flex flex-col gap-px md:-mx-1.5">
                      {chores.map((c) => {
                        const late = !duty && isOverdue(c, cs, p);
                        // Platzhalter, damit die Zeilen (Küche/Bad/Sonstiges) immer gleich liegen
                        if (!duty && !late) return <span key={c.area.id} className="h-3.5 md:h-4" />;
                        const color = c.assignee?.color ?? "#999";
                        return (
                          <span key={c.area.id}
                            title={`${c.area.name}: ${c.assignee?.display_name ?? "?"}${c.done ? " ✓ erledigt" : late ? " – überfällig, bitte nachholen" : ""}`}
                            className={`relative flex h-3.5 items-center whitespace-nowrap text-[9px] font-semibold leading-none text-white md:h-4 md:text-[10px]
                              ${isStart ? "ml-0.5 rounded-l-full" : ""}
                              ${isEnd ? "mr-0.5 rounded-r-full" : isSunday ? "" : "-mr-px"}`}
                            style={{
                              background: late
                                ? "repeating-linear-gradient(135deg, #dc2626 0 5px, #f87171 5px 10px)"
                                : c.done ? `color-mix(in srgb, ${color} 45%, var(--card))` : color,
                            }}>
                            {/* Text darf in die Nachbarkachel laufen, daher absolut + über den Nachbarn */}
                            {isStart && <span className="absolute left-1 z-[2]">{late && "⚠️"}{c.area.icon}&nbsp;{c.assignee?.display_name}</span>}
                            {isEnd && <span className="absolute right-1 z-[2]">{late ? "nachholen!" : <>{c.done ? "✓ " : ""}{c.assignee?.display_name}</>}</span>}
                          </span>
                        );
                      })}
                    </span>
                  );
                })()}
              </button>
            );
          })}
        </div>

        {/* Legende */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-3 py-2.5 text-xs text-muted">
          {members.map((m) => (
            <span key={m.id} className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />{m.display_name}
            </span>
          ))}
          <span className="hidden h-3 w-px bg-line sm:block" />
          <span>Balken = Putzwoche: {[...areas].sort((a, b) => a.sort - b.sort).map((a) => `${a.icon} ${a.name}`).join(" · ")} (blass = erledigt)</span>
          <span className="flex items-center gap-1"><span className="h-1 w-3 rounded bg-red-500" />Fällig (Ende Putzwoche)</span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-5 rounded-full" style={{ background: "repeating-linear-gradient(135deg, #dc2626 0 3px, #f87171 3px 6px)" }} />überfällig, nachholen
          </span>
        </div>
      </Card>

      <SectionTitle>{formatDate(selected, { weekday: "long", day: "numeric", month: "long" })}</SectionTitle>
      <form onSubmit={add} className="mb-3 flex gap-2">
        <input className={inputCls} placeholder="Neuer Termin, z. B. WG-Party" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className={`${inputCls} w-28`} type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Uhrzeit (optional)" />
        <button className={btnCls}>+</button>
      </form>
      <div className="space-y-2">
        {dayEvents.map((ev) => (
          <Card key={ev.id} className="flex items-center gap-3">
            <span className="w-12 text-sm font-medium tabular-nums text-accent">{ev.time ? ev.time.slice(0, 5) : "ganzt."}</span>
            <span className="flex-1">{ev.title}</span>
            <DeleteButton onClick={() => remove(ev)} />
          </Card>
        ))}
        {dayEvents.length === 0 && <p className="text-sm text-muted">Keine Termine.</p>}
      </div>

      {selChores.length > 0 && (
        <>
          <SectionTitle>
            Putzwoche {formatDate(selRange.from, { day: "numeric", month: "numeric" })} – {formatDate(selRange.due, { day: "numeric", month: "numeric" })}
          </SectionTitle>
          {selMilestone && (
            <p className="mb-2 text-sm font-medium text-red-600">
              Heute endet die Putzwoche – alles sollte fertig sein.
            </p>
          )}
          <Card className="divide-y divide-line p-0">
            {selChores.map((c) => (
              <div key={c.area.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-lg">{c.area.icon}</span>
                <span className="flex-1 font-medium">{c.area.name}</span>
                <Avatar member={c.assignee} size={24} />
                <span className="w-16 text-sm">{c.assignee?.display_name}</span>
                <span className={`w-20 text-right text-sm font-medium ${c.done ? "text-emerald-600" : isOverdue(c, cs, selPeriod) ? "text-red-600" : "text-muted"}`}>
                  {c.done ? "✓" : isOverdue(c, cs, selPeriod) ? `⚠️ ${c.doneCount}/${c.tasks.length}` : `${c.doneCount}/${c.tasks.length}`}
                </span>
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  );
}
