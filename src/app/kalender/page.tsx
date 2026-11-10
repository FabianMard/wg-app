"use client";

import { NewDot, useMarkSeen, useNews } from "@/lib/news";
import { Fragment, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/push";
import { useRows, useWG } from "@/lib/wg";
import type { CalEvent, ChoreArea, ChoreCheck, ChoreTask } from "@/lib/types";
import { areaStatuses, isOverdue, periodOf, periodRange, type AreaStatus } from "@/lib/cleaning";
import { formatDate, fromISO, toISO, todayISO } from "@/lib/dates";
import { holidayOn } from "@/lib/holidays";
import { birthdayName, birthYear, displayTitle, eventKind, isBirthday, isPrivate, KIND_STYLE, type Occurrence, occurrencesOn, rangeLabel, RECURRENCE_LABEL } from "@/lib/events";
import { addDays } from "@/lib/dates";
import { Avatar, btnCls, Card, DeleteButton, inputCls, PageTitle, SectionTitle } from "@/components/ui";
import { Polls, useOpenPollCount } from "@/components/Polls";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MAX_EVENTS_IN_TILE = 2;

type Tab = "kalender" | "abstimmung";

/** Kalender mit Reiter „Abstimmungen“ (?tab=abstimmung) */
export default function Kalender() {
  const { isGuest } = useWG();
  const [tab, setTab] = useState<Tab>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "abstimmung" ? "abstimmung" : "kalender");
  const openPolls = useOpenPollCount();
  const { has } = useNews();
  useMarkSeen(tab === "abstimmung" ? "kalender.abstimmung" : "kalender");
  const go = (t: Tab) => { setTab(t); window.history.replaceState(null, "", t === "kalender" ? location.pathname : "?tab=abstimmung"); };
  return (
    <>
      <PageTitle sub={tab === "abstimmung" ? "Termine finden, Ja/Nein oder Auswahl – ihr entscheidet vorher, ob Mehrheit reicht." : undefined}>
        {tab === "abstimmung" ? "Abstimmungen" : "Kalender"}
      </PageTitle>
      {!isGuest && (
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-line/50 p-1 text-sm font-semibold">
          <button onClick={() => go("kalender")} className={`relative rounded-lg py-2 transition ${tab === "kalender" ? "bg-card shadow-sm" : "text-muted"}`}>
            📅 Kalender{tab !== "kalender" && has("kalender") && <NewDot className="absolute right-1.5 top-1.5" />}
          </button>
          <button onClick={() => go("abstimmung")} className={`relative rounded-lg py-2 transition ${tab === "abstimmung" ? "bg-card shadow-sm" : "text-muted"}`}>
            🗳️ Abstimmungen
            {openPolls > 0 && <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-bold text-white">{openPolls}</span>}
            {openPolls === 0 && tab !== "abstimmung" && has("kalender.abstimmung") && <NewDot className="absolute right-1.5 top-1.5" />}
          </button>
        </div>
      )}
      {tab === "abstimmung" && !isGuest ? <Polls /> : <CalendarView />}
    </>
  );
}

function CalendarView() {
  const { household, members, everyone, myId, member, isGuest } = useWG();
  const { rows: events, reload } = useRows<CalEvent>("events", "day");
  const { rows: areas } = useRows<ChoreArea>("chore_areas", "sort");
  const { rows: tasks } = useRows<ChoreTask>("chore_tasks", "sort");
  const { rows: checks } = useRows<ChoreCheck>("chore_checks", "done_at");
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  // Ansicht: Tag / Woche / Monat (Standard) / Jahr – die letzte Wahl merkt sich das Gerät
  type View = "tag" | "woche" | "monat" | "jahr";
  const [view, setViewState] = useState<View>(() => {
    try { const v = localStorage.getItem("wg-kalender-ansicht"); return v === "tag" || v === "woche" || v === "jahr" ? v : "monat"; } catch { return "monat"; }
  });
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem("wg-kalender-ansicht", v); } catch { /* egal */ } };
  const [selected, setSelected] = useState(todayISO());
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [birthYearInput, setBirthYearInput] = useState(""); // optional beim Geburtstag
  // Neuer Eintrag: Art bestimmt, welche Felder es gibt
  type Kind = "termin" | "geburtstag" | "urlaub";
  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("termin");
  const [endDay, setEndDay] = useState("");
  const [recurrence, setRecurrence] = useState<NonNullable<CalEvent["recurrence"]>>("keine");
  const [audience, setAudience] = useState<string[] | null>(null); // null = alle
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<CalEvent | null>(null); // Eintrag, der gerade bearbeitet wird

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

  const eventsOn = (iso: string): Occurrence[] => occurrencesOn(events, iso);
  // Ende der Putzwoche (Sonntag) markieren
  const milestone = (iso: string): "Fällig" | null => {
    const p = periodOf(cs, iso);
    if (p < 0) return null;
    const r = periodRange(cs, p);
    return iso === r.due ? "Fällig" : null;
  };
  const [slide, setSlide] = useState<"" | "next" | "prev">("");
  const shift = (n: number) => {
    setSlide(n > 0 ? "next" : "prev");
    if (view === "tag" || view === "woche") {
      const d = addDays(selected, n * (view === "tag" ? 1 : 7));
      setSelected(d);
      setMonth(new Date(fromISO(d).getFullYear(), fromISO(d).getMonth(), 1));
    } else if (view === "jahr") setMonth(new Date(month.getFullYear() + n, month.getMonth(), 1));
    else setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  };

  // Wischen: nach links = nächster Monat, nach rechts = vorheriger Monat
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.changedTouches[0].clientX - t.x, dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1);
  };

  const titleRef = useRef<HTMLInputElement>(null);
  function resetForm() {
    setBirthYearInput(""); setEditing(null);
    setTitle(""); setTime(""); setEndDay(""); setRecurrence("keine"); setAudience(null); setErr(null); setFormOpen(false); setKind("termin");
  }
  function openForm(k: Kind) {
    setKind(k); setErr(null); setFormOpen(true);
    if (k === "urlaub" && (!endDay || endDay <= selected)) setEndDay(addDays(selected, 6));
    setTimeout(() => titleRef.current?.focus(), 50);
  }
  /** Eintrag zum Bearbeiten ins Formular laden */
  function startEdit(ev: CalEvent) {
    const k: Kind = isBirthday(ev) ? "geburtstag" : ev.end_day && ev.end_day > ev.day ? "urlaub" : "termin";
    setEditing(ev); setKind(k); setErr(null);
    if (k === "geburtstag") {
      // Tag im angezeigten Jahr wählen, Geburtsjahr (falls bekannt) ins Feld
      const y = birthYear(ev);
      setSelected(`${selected.slice(0, 4)}-${ev.day.slice(5)}`);
      setBirthYearInput(y ? String(y) : "");
      setTitle(birthdayName(ev.title));
    } else {
      setSelected(ev.day);
      setTitle(ev.title);
    }
    setTime(k === "termin" && ev.time ? ev.time.slice(0, 5) : "");
    setEndDay(k === "urlaub" ? ev.end_day ?? "" : "");
    setRecurrence(k === "termin" ? ev.recurrence ?? "keine" : "keine");
    setAudience(ev.visible_to?.length ? ev.visible_to.filter((id) => id !== myId) : null);
    setFormOpen(true);
    setTimeout(() => { titleRef.current?.focus(); titleRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, 50);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const t = title.trim();
    if (!t && kind !== "urlaub") return setErr(kind === "geburtstag" ? "Wessen Geburtstag? Bitte einen Namen eintragen." : "Bitte einen Titel eintragen.");
    if (kind === "urlaub" && (!endDay || endDay <= selected)) {
      return setErr(`Bitte ein Ende nach dem ${formatDate(selected)} wählen.`);
    }
    // Felder je Art: Geburtstag = ganztägig + jährlich, Urlaub = ganztägig + mehrere Tage
    const row: Record<string, unknown> = {
      household_id: household.id,
      title: kind === "geburtstag" ? `🎂 ${birthdayName(t)}` : kind === "urlaub" ? (t || "🏖️ Urlaub") : t,
      // Geburtstag mit Jahr: im Geburtsjahr speichern (daraus wird das Alter berechnet)
      day: kind === "geburtstag" && /^(19|20)\d\d$/.test(birthYearInput) && Number(birthYearInput) < Number(selected.slice(0, 4))
        ? `${birthYearInput}-${selected.slice(5)}` : selected,
      time: kind === "termin" ? time || null : null,
    };
    const rec = kind === "geburtstag" ? "jaehrlich" : kind === "termin" ? recurrence : "keine";
    if (kind !== "termin" || rec !== "keine" || audience !== null) {
      row.recurrence = rec;
      if (kind === "urlaub") row.end_day = endDay;
      // Wer es einträgt, sieht es immer
      row.visible_to = audience === null ? null : [...new Set([...audience, myId])];
    }
    if (editing) {
      // Beim Bearbeiten alle Felder setzen (auch zurücksetzen, z. B. Urlaub → Termin)
      const upd = { title: row.title, day: row.day, time: row.time, recurrence: rec, end_day: kind === "urlaub" ? endDay : null,
        visible_to: audience === null ? null : [...new Set([...audience, myId])] };
      const { error } = await supabase.from("events").update(upd).eq("id", editing.id);
      if (error) { setErr(error.message); return; }
      resetForm();
      reload();
      return;
    }
    const { error } = await supabase.from("events").insert(row);
    if (error) {
      setErr(/end_day|recurrence|visible_to/.test(error.message)
        ? "Dafür fehlt ein Datenbank-Update: supabase/012_gaeste_kalender_watchlist.sql ausführen."
        : error.message);
      return;
    }
    // Nur wer den Eintrag sehen darf, wird benachrichtigt
    notify("kalender", `${kind === "geburtstag" ? `🎂 ${birthdayName(t)}` : String(row.title)} am ${formatDate(selected)}${row.time ? `, ${String(row.time).slice(0, 5)} Uhr` : ""}`,
      { to: (row.visible_to as string[] | null | undefined) ?? null });
    resetForm();
    reload();
  }
  async function remove(ev: CalEvent) {
    const series = (ev.recurrence ?? "keine") !== "keine" || (ev.end_day && ev.end_day > ev.day);
    if (!confirm(series ? `„${ev.title}“ komplett löschen (alle Tage/Wiederholungen)?` : `„${ev.title}“ löschen?`)) return;
    await supabase.from("events").delete().eq("id", ev.id);
    reload();
  }
  const audienceLabel = (ev: CalEvent) => {
    if (!ev.visible_to?.length) return "";
    const others = ev.visible_to.filter((id) => id !== myId);
    return others.length ? `👁 du, ${others.map((id) => member(id)?.display_name ?? "?").join(", ")}` : "🔒 nur du";
  };

  const dayEvents = eventsOn(selected);
  const selHoliday = holidayOn(selected);
  const selPeriod = periodOf(cs, selected);
  const selChores = statusByPeriod(selPeriod);
  const selRange = periodRange(cs, selPeriod);
  const selMilestone = milestone(selected);
  // ── Kopfzeile je Ansicht ──
  const weekStart = addDays(selected, -((fromISO(selected).getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const now = new Date();
  const headLabel = view === "tag" ? formatDate(selected, { weekday: "short", day: "numeric", month: "long", year: "numeric" })
    : view === "woche" ? `${formatDate(weekDays[0], { day: "numeric", month: "short" })} – ${formatDate(weekDays[6], { day: "numeric", month: "short", year: "numeric" })}`
    : view === "jahr" ? String(month.getFullYear())
    : month.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const showsToday = view === "tag" ? selected === todayISO() : view === "woche" ? weekDays.includes(todayISO())
    : view === "jahr" ? month.getFullYear() === now.getFullYear() : month.getMonth() === now.getMonth() && month.getFullYear() === now.getFullYear();

  // ── Woche: Liste Mo–So mit allen Einträgen in voller Länge, oben der Putzdienst der Woche ──
  const weekPeriod = periodOf(cs, weekStart);
  const weekRange = weekPeriod >= 0 ? periodRange(cs, weekPeriod) : null;
  const weekChores = weekRange && weekStart <= weekRange.due && weekDays[6] >= weekRange.from ? statusByPeriod(weekPeriod) : [];
  const weekList = (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="touch-pan-y border-t border-line">
      {weekChores.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2 text-xs">
          <span className="font-semibold text-muted">🧽 Putzwoche:</span>
          {weekChores.map((c) => (
            <span key={c.area.id} className="rounded-full px-2 py-0.5 font-semibold text-white" style={{ background: c.assignee?.color ?? "#999" }}>
              {c.area.icon} {c.area.name}: {c.assignee?.display_name ?? "?"}{c.done && " ✓"}
            </span>
          ))}
        </div>
      )}
      {weekDays.map((iso) => {
        const evs = eventsOn(iso), hol = holidayOn(iso), isToday = iso === todayISO();
        return (
          <button key={iso} onClick={() => setSelected(iso)}
            className={`flex w-full gap-3 border-b border-line px-3 py-2 text-left last:border-b-0 ${iso === selected ? "bg-accent/10" : "hover:bg-line/30"}`}>
            <span className="w-12 shrink-0 text-center">
              <span className="block text-[11px] font-medium uppercase text-muted">{formatDate(iso, { weekday: "short" }).replace(".", "")}</span>
              <span className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${isToday ? "bg-accent text-white" : hol ? "text-red-600" : ""}`}>{fromISO(iso).getDate()}</span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
              {hol && <span className="w-fit rounded bg-red-500/15 px-1.5 text-xs font-semibold text-red-700 dark:text-red-300">🎉 {hol}</span>}
              {evs.map(({ event: e, dayNo, total }) => (
                <span key={e.id} className={`w-fit max-w-full break-words rounded px-1.5 text-sm font-medium ${KIND_STYLE[eventKind(e, myId)].chip}`}>
                  {isPrivate(e, myId) && "🔒 "}{e.time && <b>{e.time.slice(0, 5)} </b>}{displayTitle(e, iso)}{total > 1 && <span className="whitespace-nowrap opacity-70"> ({dayNo}/{total})</span>}
                </span>
              ))}
              {!hol && evs.length === 0 && <span className="text-xs text-muted">–</span>}
            </span>
          </button>
        );
      })}
    </div>
  );

  // ── Jahr: 12 Mini-Monate; Tage mit Einträgen markiert. Tag → Tagesansicht, Monatsname → Monatsansicht ──
  const yearGrid = view !== "jahr" ? null : (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="grid touch-pan-y grid-cols-2 gap-3 border-t border-line p-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 12 }, (_, mi) => {
        const y = month.getFullYear();
        const first = new Date(y, mi, 1);
        const lead = (first.getDay() + 6) % 7;
        const n = new Date(y, mi + 1, 0).getDate();
        return (
          <div key={mi}>
            <button onClick={() => { setMonth(first); setView("monat"); }} className="mb-1 text-sm font-semibold hover:text-accent">
              {first.toLocaleDateString("de-DE", { month: "long" })}
            </button>
            <div className="grid grid-cols-7 gap-px text-center text-[10px] leading-5">
              {WEEKDAYS.map((w) => <span key={w} className="text-muted">{w[0]}</span>)}
              {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
              {Array.from({ length: n }, (_, di) => {
                const iso = toISO(new Date(y, mi, di + 1));
                const evs = eventsOn(iso);
                const bday = evs.some((o) => isBirthday(o.event));
                const hol = holidayOn(iso);
                const isToday = iso === todayISO();
                return (
                  <button key={iso} onClick={() => { setSelected(iso); setMonth(first); setView("tag"); }}
                    title={[hol, ...evs.map((o) => displayTitle(o.event, iso))].filter(Boolean).join(" · ") || undefined}
                    className={`rounded tabular-nums ${isToday ? "bg-accent font-bold text-white" : hol ? "font-bold text-red-600" : ""}
                      ${!isToday && evs.length ? (bday ? "bg-pink-500/20 font-semibold" : "bg-accent/15 font-semibold") : ""} ${iso === selected && !isToday ? "ring-1 ring-accent" : ""}`}>
                    {di + 1}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      {/* Ansicht wählen */}
      <div className="mb-2 grid grid-cols-4 gap-1 rounded-xl bg-line/50 p-1 text-xs font-semibold">
        {([["tag", "Tag"], ["woche", "Woche"], ["monat", "Monat"], ["jahr", "Jahr"]] as [View, string][]).map(([v, label]) => (
          <button key={v} onClick={() => { setView(v); if (v !== "jahr") setMonth(new Date(fromISO(selected).getFullYear(), fromISO(selected).getMonth(), 1)); }}
            className={`rounded-lg py-1.5 transition ${view === v ? "bg-card shadow-sm" : "text-muted"}`}>{label}</button>
        ))}
      </div>
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between px-2 py-2">
          <button onClick={() => shift(-1)} className="rounded-lg px-3 py-1 text-lg hover:bg-line/50" aria-label="Zurück">‹</button>
          <span className="flex items-center gap-2 text-center font-semibold">
            {headLabel}
            {!showsToday && (
              <button onClick={() => { const t = todayISO(); setSelected(t); setMonth(new Date(fromISO(t).getFullYear(), fromISO(t).getMonth(), 1)); }}
                className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-accent">Heute</button>
            )}
          </span>
          <button onClick={() => shift(1)} className="rounded-lg px-3 py-1 text-lg hover:bg-line/50" aria-label="Weiter">›</button>
        </div>
        {view === "woche" && weekList}
        {view === "jahr" && yearGrid}
        {view === "monat" && <>
        <div className="grid grid-cols-7 border-t border-line text-center text-xs text-muted">
          {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
        </div>
        <div key={month.toISOString()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
          className={`grid touch-pan-y grid-cols-7 gap-px border-t border-line bg-line ${slide === "next" ? "animate-slide-next" : slide === "prev" ? "animate-slide-prev" : ""}`}>
          {days.map((iso) => {
            const inMonth = fromISO(iso).getMonth() === month.getMonth();
            const isToday = iso === todayISO();
            const isSel = iso === selected;
            // Mehrtägiges zuerst (dann laufen die Balken über die Tage auf einer Linie), danach Feiertag und der Rest
            const evs = [...eventsOn(iso)].sort((a, b) => Number(b.total > 1) - Number(a.total > 1));
            const multiCount = evs.slice(0, MAX_EVENTS_IN_TILE).filter((o) => o.total > 1).length;

            const chores = statusByPeriod(periodOf(cs, iso));
            const ms = milestone(iso);
            const holiday = holidayOn(iso);
            const HOLIDAY = holiday ? (
<span title={`Feiertag: ${holiday}`} className="line-clamp-2 hyphens-auto break-words rounded bg-red-500/15 px-0.5 text-[9px] font-semibold leading-[11px] text-red-700 dark:text-red-300 md:truncate md:px-1 md:text-[11px] md:leading-4">
                      {holiday}
                    </span>
            ) : null;
            return (
              <button key={iso} onClick={() => setSelected(iso)} lang="de"
                className={`relative flex min-h-[104px] flex-col gap-0.5 p-1 text-left transition md:min-h-[120px] md:p-1.5
                  ${isSel ? "z-10 bg-card shadow-[inset_0_0_0_999px_color-mix(in_srgb,var(--accent)_8%,transparent)] outline outline-2 -outline-offset-2 outline-accent" : "bg-card hover:bg-line/30"}
                  ${inMonth ? "" : "bg-bg"}`}>
                <span className="flex items-center justify-between">
                  <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs tabular-nums
                    ${isToday ? "bg-accent font-bold text-white" : holiday ? "font-bold text-red-600" : "font-medium"} ${inMonth ? "" : "opacity-40"}`}>
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

                  {evs.slice(0, MAX_EVENTS_IN_TILE).map(({ event: e, dayNo, total }, idx) => {
                    const label = <>{isPrivate(e, myId) && "🔒"}<span className="hidden md:inline">{e.time && `${e.time.slice(0, 5)} `}</span>{displayTitle(e, iso)}</>;
                    const chip = `px-0.5 text-[9px] font-semibold leading-[13px] md:px-1 md:text-[11px] md:leading-4 ${KIND_STYLE[eventKind(e, myId)].chip}`;
                    const holidayHere = idx === multiCount && holiday ? HOLIDAY : null;
                    if (total <= 1) return <Fragment key={e.id}>{holidayHere}<span title={displayTitle(e, iso)} className={`truncate rounded ${chip}`}>{label}</span></Fragment>;
                    // Mehrtägig (z. B. Urlaub): ein durchgehender Balken; die Beschreibung steht einmal und läuft über die Tage –
                    // am ersten Tag und am Anfang jeder neuen Kalenderzeile (Montag)
                    const weekday = (fromISO(iso).getDay() + 6) % 7; // Mo = 0
                    const showText = dayNo === 1 || weekday === 0;
                    const span = Math.min(total - dayNo + 1, 7 - weekday);
                    return (
                      <span key={e.id} title={displayTitle(e, iso)}
                        className={`relative ${chip} ${dayNo > 1 ? "-ml-1 md:-ml-1.5" : ""} ${dayNo < total ? "-mr-1 md:-mr-1.5" : ""}
                          ${dayNo === 1 ? "rounded-l" : ""} ${dayNo === total ? "rounded-r" : ""}`}>
                        <span className="invisible">.</span>
                        {showText && (
                          <span className="absolute inset-y-0 left-0 z-[11] block overflow-hidden text-ellipsis whitespace-nowrap px-0.5 md:px-1"
                            style={{ width: `calc(${span * 100}% + ${(span - 1) * 6}px)` }}>{label}</span>
                        )}
                      </span>
                    );
                  })}
                  {multiCount === Math.min(evs.length, MAX_EVENTS_IN_TILE) && holiday && HOLIDAY}
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
                            {isStart && <span className="absolute left-1 z-[2]">{late && "⚠️ "}{c.area.name}</span>}
                            {isEnd && <span className="absolute right-1 z-[2]">{c.done ? "✓ " : ""}{c.assignee?.display_name}{late && " – nachholen!"}</span>}
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
        </>}
      </Card>

      <SectionTitle>{formatDate(selected, { weekday: "long", day: "numeric", month: "long" })}</SectionTitle>
      {!isGuest && !formOpen && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {([["termin", "📅", "Termin"], ["geburtstag", "🎂", "Geburtstag"], ["urlaub", "🏖️", "Urlaub"]] as [Kind, string, string][]).map(([k, icon, label]) => (
            <button key={k} type="button" onClick={() => openForm(k)}
              className="flex flex-col items-center gap-0.5 rounded-2xl border border-dashed border-line bg-card py-3 text-sm font-medium text-muted transition hover:border-accent hover:text-accent active:scale-95">
              <span className="text-xl">{icon}</span>+ {label}
            </button>
          ))}
        </div>
      )}
      {!isGuest && formOpen && (
        <Card className="mb-3">
          <form onSubmit={add} className="space-y-4">
            {editing && <p className="text-sm font-semibold">✏️ Eintrag bearbeiten{(editing.recurrence ?? "keine") !== "keine" && <span className="font-normal text-muted"> · gilt für alle Wiederholungen</span>}</p>}
            {/* Art */}
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-line/50 p-1 text-sm font-medium">
              {([["termin", "📅 Termin"], ["geburtstag", "🎂 Geburtstag"], ["urlaub", "🏖️ Urlaub"]] as [Kind, string][]).map(([k, label]) => (
                <button key={k} type="button" onClick={() => openForm(k)}
                  className={`rounded-lg py-1.5 transition ${kind === k ? "bg-card shadow-sm" : "text-muted"}`}>{label}</button>
              ))}
            </div>

            {/* Titel / Name */}
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">{kind === "geburtstag" ? "Name" : kind === "urlaub" ? "Wer / wohin? (optional)" : "Was?"}</span>
              <div className="flex items-center gap-2">
                {kind === "geburtstag" && <span className="text-2xl">🎂</span>}
                <input ref={titleRef} className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
                  placeholder={kind === "geburtstag" ? "z. B. Verena" : kind === "urlaub" ? "z. B. 🏖️ Stefan in Italien" : "z. B. WG-Party"} />
              </div>
            </label>

            {/* Wann */}
            <div>
              <span className="mb-1 block text-xs font-semibold text-muted">Wann?</span>
              {kind === "termin" && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="min-w-0">
                    <span className="mb-1 block text-[11px] font-medium text-muted">📅 Tag</span>
                    <span className="flex h-[42px] items-center rounded-xl border border-line bg-bg px-3 text-sm">{formatDate(selected)}</span>
                  </label>
                  <label className="min-w-0">
                    <span className="mb-1 flex items-center justify-between gap-1 whitespace-nowrap text-[11px] font-medium text-muted">
                      {time ? "🕐 Uhrzeit" : "🕐 Uhrzeit (optional)"}
                      {time && <button type="button" onClick={() => setTime("")} className="font-semibold text-accent">✕ ganztägig</button>}
                    </span>
                    <span className="relative block">
                      <input className={`${inputCls} h-[42px] py-2 ${time ? "" : "text-muted"}`} type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Uhrzeit (optional)" />
                      {!time && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center bg-card pr-2 text-sm text-muted">🕐 ganztägig</span>}
                    </span>
                  </label>
                  <select className={`${inputCls} col-span-2 py-2`} value={recurrence} onChange={(e) => setRecurrence(e.target.value as typeof recurrence)} aria-label="Wiederholen">
                    {Object.entries(RECURRENCE_LABEL).map(([k, v]) => <option key={k} value={k}>🔁 {v}</option>)}
                  </select>
                </div>
              )}
              {kind === "geburtstag" && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="min-w-0">
                    <span className="mb-1 block text-[11px] font-medium text-muted">📅 Tag</span>
                    <span className="flex h-[42px] items-center rounded-xl border border-line bg-bg px-3 text-sm">{formatDate(selected, { day: "numeric", month: "long" })} · 🔁 jährlich</span>
                  </label>
                  <label className="min-w-0">
                    <span className="mb-1 block text-[11px] font-medium text-muted">🎈 Geburtsjahr (optional)</span>
                    <input className={`${inputCls} h-[42px] py-2`} inputMode="numeric" maxLength={4} placeholder="z. B. 1996"
                      value={birthYearInput} onChange={(e) => setBirthYearInput(e.target.value.replace(/\D/g, "").slice(0, 4))} />
                  </label>
                  {/^(19|20)\d\d$/.test(birthYearInput) && Number(birthYearInput) < Number(selected.slice(0, 4)) && (
                    <p className="col-span-2 text-xs text-muted">🎂 Wird am {formatDate(selected, { day: "numeric", month: "long" })} {Number(selected.slice(0, 4)) - Number(birthYearInput)}.</p>
                  )}
                </div>
              )}
              {kind === "urlaub" && (
                <div className="grid grid-cols-[auto_1fr] items-center gap-2 text-sm">
                  <span className="text-muted">von</span>
                  <span className="rounded-xl border border-line bg-bg px-3 py-2">{formatDate(selected)}</span>
                  <span className="text-muted">bis</span>
                  <input type="date" className={`${inputCls} py-2`} value={endDay} onChange={(e) => setEndDay(e.target.value)} aria-label="Bis (inklusive)" />
                  {endDay > selected && <span className="col-span-2 text-xs text-muted">ganztägig · {Math.round((new Date(endDay).getTime() - new Date(selected).getTime()) / 86_400_000) + 1} Tage</span>}
                </div>
              )}
              <p className="mt-1 text-xs text-muted">Anderer Tag? Einfach oben im Kalender antippen.</p>
            </div>

            {/* Sichtbarkeit */}
            <div>
              <span className="mb-1 block text-xs font-semibold text-muted">Wer sieht das?</span>
              <div className="flex flex-wrap gap-1.5 text-sm">
                <button type="button" onClick={() => setAudience(null)}
                  className={`rounded-full border px-3 py-1 font-medium ${audience === null ? "border-accent bg-accent text-white" : "border-line text-muted"}`}>👥 Alle</button>
                <button type="button" onClick={() => setAudience([])}
                  className={`rounded-full border px-3 py-1 font-medium ${audience !== null && audience.length === 0 ? "border-neutral-600 bg-neutral-600 text-white" : "border-line text-muted"}`}>🔒 Nur ich</button>
                {everyone.filter((m) => m.id !== myId).map((m) => {
                  const on = audience?.includes(m.id) ?? false;
                  return (
                    <button type="button" key={m.id}
                      onClick={() => setAudience(on ? (audience ?? []).filter((x) => x !== m.id) : [...(audience ?? []), m.id])}
                      className="rounded-full border px-3 py-1 font-medium"
                      style={on ? { background: m.color, borderColor: m.color, color: "white" } : { borderColor: "var(--line)", color: "var(--muted)" }}>
                      {m.display_name}{m.role === "gast" && " (Gast)"}
                    </button>
                  );
                })}
              </div>
              {audience !== null && (
                <p className="mt-1 text-xs text-muted">{audience.length ? `Nur du und ${audience.map((id) => member(id)?.display_name).join(", ")}.` : "🔒 Nur du siehst diesen Eintrag."}</p>
              )}
            </div>

            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="flex gap-2">
              <button className={`${btnCls} flex-1`}>{editing ? "Speichern" : "Eintragen"}</button>
              <button type="button" onClick={resetForm} className="rounded-xl border border-line px-4 text-sm">Abbrechen</button>
            </div>
          </form>
        </Card>
      )}
      <div className="space-y-2">
        {selHoliday && (
          <Card className="flex items-center gap-3 border-red-500/30 bg-red-500/5">
            <span className="w-12 text-sm font-medium text-red-600">ganzt.</span>
            <span className="flex-1 font-medium text-red-700 dark:text-red-300">{selHoliday}</span>
            <span className="text-xs text-muted">Feiertag Sachsen</span>
          </Card>
        )}
        {dayEvents.map(({ event: ev, start, dayNo, total }) => (
          <Card key={ev.id} className={`flex items-center gap-3 border-l-4 py-3 ${KIND_STYLE[eventKind(ev, myId)].bar}`}>
            <span className="w-11 shrink-0 text-center text-sm font-semibold tabular-nums text-muted">
              {ev.time ? ev.time.slice(0, 5) : total > 1 ? `${dayNo}/${total}` : <span className="text-xs font-medium">ganzt.</span>}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{displayTitle(ev, start)}</span>
              {(total > 1 || (ev.recurrence ?? "keine") !== "keine" || audienceLabel(ev)) && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {total > 1 && <span className="rounded-full bg-line/60 px-2 py-0.5 text-[11px] text-muted">📆 {rangeLabel(start, total)}</span>}
                  {(ev.recurrence ?? "keine") !== "keine" && <span className="rounded-full bg-line/60 px-2 py-0.5 text-[11px] text-muted">🔁 {RECURRENCE_LABEL[ev.recurrence!]}</span>}
                  {audienceLabel(ev) && <span className="rounded-full bg-line/60 px-2 py-0.5 text-[11px] text-muted">{audienceLabel(ev)}</span>}
                </span>
              )}
            </span>
            {!isGuest && (
              <button onClick={() => startEdit(ev)} aria-label={`„${ev.title}“ bearbeiten`} title="Bearbeiten"
                className="rounded-lg px-2 py-1 text-base text-muted transition hover:bg-line/50 hover:text-fg">✏️</button>
            )}
            {!isGuest && <DeleteButton onClick={() => remove(ev)} />}
          </Card>
        ))}
        {dayEvents.length === 0 && !selHoliday && <p className="text-sm text-muted">Keine Termine.</p>}
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
