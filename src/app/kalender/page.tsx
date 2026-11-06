"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { CalEvent, Chore } from "@/lib/types";
import { formatDate, fromISO, toISO, todayISO } from "@/lib/dates";
import { Avatar, btnCls, Card, DeleteButton, inputCls, PageTitle, SectionTitle } from "@/components/ui";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export default function Kalender() {
  const { household, member } = useWG();
  const { rows: events, reload } = useRows<CalEvent>("events", "day");
  const { rows: chores } = useRows<Chore>("chores", "next_due");
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState(todayISO());
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");

  // Raster: beginnt am Montag vor dem Monatsersten, 6 Wochen
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return toISO(d); });

  const eventsOn = (iso: string) => events.filter((e) => e.day === iso);
  const choresOn = (iso: string) => chores.filter((c) => c.next_due === iso);
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

  const dayEvents = eventsOn(selected).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  const dayChores = choresOn(selected);

  return (
    <>
      <PageTitle>Kalender</PageTitle>
      <Card className="p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <button onClick={() => shift(-1)} className="rounded-lg px-3 py-1 text-lg hover:bg-line/50" aria-label="Vorheriger Monat">‹</button>
          <span className="font-semibold">{month.toLocaleDateString("de-DE", { month: "long", year: "numeric" })}</span>
          <button onClick={() => shift(1)} className="rounded-lg px-3 py-1 text-lg hover:bg-line/50" aria-label="Nächster Monat">›</button>
        </div>
        <div className="grid grid-cols-7 text-center text-xs text-muted">
          {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((iso) => {
            const inMonth = fromISO(iso).getMonth() === month.getMonth();
            const isToday = iso === todayISO();
            const isSel = iso === selected;
            const ev = eventsOn(iso).length, ch = choresOn(iso).length;
            return (
              <button key={iso} onClick={() => setSelected(iso)}
                className={`flex aspect-square flex-col items-center justify-center rounded-xl text-sm transition
                  ${isSel ? "bg-accent text-white" : isToday ? "bg-accent/10 font-semibold text-accent" : "hover:bg-line/50"}
                  ${inMonth ? "" : "opacity-35"}`}>
                {fromISO(iso).getDate()}
                <span className="flex h-1.5 gap-0.5">
                  {ev > 0 && <span className={`h-1.5 w-1.5 rounded-full ${isSel ? "bg-white" : "bg-accent"}`} />}
                  {ch > 0 && <span className={`h-1.5 w-1.5 rounded-full ${isSel ? "bg-white/70" : "bg-amber-500"}`} />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex gap-4 px-1 text-xs text-muted">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent" />Termin</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />Putzaufgabe fällig</span>
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
        {dayChores.map((c) => (
          <Card key={c.id} className="flex items-center gap-3 border-amber-500/40">
            <span className="w-12 text-lg">🧽</span>
            <span className="flex-1">{c.title}</span>
            <Avatar member={member(c.assignee)} />
          </Card>
        ))}
        {dayEvents.length + dayChores.length === 0 && <p className="text-sm text-muted">Nichts geplant.</p>}
      </div>
    </>
  );
}
