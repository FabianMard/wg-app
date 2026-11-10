import { addDays, fromISO, toISO } from "./dates";
import type { CalEvent } from "./types";

export const RECURRENCE_LABEL: Record<NonNullable<CalEvent["recurrence"]>, string> = {
  keine: "Einmalig",
  woechentlich: "Jede Woche",
  monatlich: "Jeden Monat",
  jaehrlich: "Jedes Jahr",
};

const daysBetween = (a: string, b: string) => Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86_400_000);

/** Wie viele Tage dauert ein Eintrag zusätzlich zum ersten Tag? (0 = eintägig) */
export const extraDays = (e: CalEvent) => (e.end_day && e.end_day > e.day ? daysBetween(e.day, e.end_day) : 0);

/** Beginnt an diesem Tag ein (ggf. wiederholtes) Vorkommen? */
export function startsOn(e: CalEvent, iso: string): boolean {
  if (iso < e.day) return false;
  const r = e.recurrence ?? "keine";
  if (r === "keine") return iso === e.day;
  if (r === "woechentlich") return daysBetween(e.day, iso) % 7 === 0;
  const a = fromISO(e.day), b = fromISO(iso);
  if (r === "monatlich") return a.getDate() === b.getDate();
  // jährlich – 29. Februar in Nicht-Schaltjahren am 28. feiern
  if (a.getMonth() === 1 && a.getDate() === 29 && new Date(b.getFullYear(), 1, 29).getMonth() !== 1) {
    return b.getMonth() === 1 && b.getDate() === 28;
  }
  return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
}

export type Occurrence = { event: CalEvent; start: string; dayNo: number; total: number };

/** Alle Einträge, die an diesem Tag stattfinden (auch mehrtägige und wiederkehrende) */
export function occurrencesOn(events: CalEvent[], iso: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const e of events) {
    const extra = extraDays(e);
    for (let back = 0; back <= extra; back++) {
      const start = addDays(iso, -back);
      if (startsOn(e, start)) { out.push({ event: e, start, dayNo: back + 1, total: extra + 1 }); break; }
    }
  }
  return out.sort((a, b) => (a.event.time ?? "").localeCompare(b.event.time ?? ""));
}

/** Vorkommen (Starttage) in einem Zeitraum [from, to] – z. B. für "Nächste 7 Tage" oder den Monatsbericht */
export function occurrencesBetween(events: CalEvent[], from: string, to: string): { event: CalEvent; day: string }[] {
  const out: { event: CalEvent; day: string }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const e of events) if (startsOn(e, d)) out.push({ event: e, day: d });
  }
  return out;
}

/** "3.–8. Nov." */
export function rangeLabel(start: string, total: number) {
  if (total <= 1) return "";
  const end = addDays(start, total - 1);
  const s = fromISO(start), e = fromISO(end);
  const sameMonth = s.getMonth() === e.getMonth();
  return `${s.getDate()}.${sameMonth ? "" : ` ${s.toLocaleDateString("de-DE", { month: "short" })}`}–${e.toLocaleDateString("de-DE", { day: "numeric", month: "short" })}`;
}

export const todayPlus = (n: number) => toISO(new Date(Date.now() + n * 86_400_000));

/** Ist das ein Geburtstag? (jährlich + 🎂 oder "Geburtstag" im Titel) */
export const isBirthday = (e: CalEvent) => (e.recurrence ?? "keine") === "jaehrlich" && /🎂|geburtstag/i.test(e.title);

/** Die nächsten n Geburtstage ab heute */
export function nextBirthdays(events: CalEvent[], today: string, n = 3): { event: CalEvent; day: string; inDays: number }[] {
  const out: { event: CalEvent; day: string; inDays: number }[] = [];
  for (const e of events.filter(isBirthday)) {
    for (let i = 0; i <= 366; i++) {
      const d = addDays(today, i);
      if (startsOn(e, d)) { out.push({ event: e, day: d, inDays: i }); break; }
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays).slice(0, n);
}

/** "🎂 Geburtstag von Verena" / "Verenas Geburtstag" → "Verena" */
export function birthdayName(title: string): string {
  const t = title.replace(/🎂/g, "").trim();
  const von = t.match(/^geburtstag\s+(?:von\s+)?(.+)$/i);
  if (von) return von[1].trim();
  const s = t.match(/^(.+?)s?\s+geburtstag$/i);
  if (s) return s[1].trim();
  return t || title;
}

/**
 * Geburtsjahr bekannt? Ohne Jahr wird der Geburtstag im aktuellen Jahr gespeichert,
 * mit Jahr liegt das Datum vor dem Jahr, in dem er eingetragen wurde.
 */
export function birthYear(e: CalEvent & { created_at?: string }): number | null {
  if (!isBirthday(e)) return null;
  const y = Number(e.day.slice(0, 4));
  const entered = e.created_at ? Number(e.created_at.slice(0, 4)) : new Date().getFullYear();
  return y < entered ? y : null;
}
/** Wie alt wird die Person an diesem Tag? (null = Jahr unbekannt) */
export function ageOn(e: CalEvent & { created_at?: string }, day: string): number | null {
  const y = birthYear(e);
  return y === null ? null : Number(day.slice(0, 4)) - y;
}

/** Anzeigename: Geburtstage kurz als "🎂 Name", mit Tag (Vorkommen) auch das Alter: "🎂 Verena (30)" */
export const displayTitle = (e: CalEvent & { created_at?: string }, day?: string) => {
  if (!isBirthday(e)) return e.title;
  const age = day ? ageOn(e, day) : null;
  return `🎂 ${birthdayName(e.title)}${age !== null && age > 0 ? ` (${age})` : ""}`;
};

/** Nur für mich sichtbar? */
export const isPrivate = (e: CalEvent, myId: string) => !!e.visible_to && e.visible_to.length > 0 && e.visible_to.every((id) => id === myId);

/** Art eines Eintrags → Farbe im Kalender */
export function eventKind(e: CalEvent, myId: string): "geburtstag" | "mehrtaegig" | "privat" | "normal" {
  if (isBirthday(e)) return "geburtstag";
  if (extraDays(e) > 0) return "mehrtaegig";
  if (isPrivate(e, myId)) return "privat";
  return "normal";
}
export const KIND_STYLE: Record<ReturnType<typeof eventKind>, { chip: string; bar: string }> = {
  geburtstag: { chip: "bg-pink-500/15 text-pink-700 dark:text-pink-300", bar: "border-l-pink-500" },
  mehrtaegig: { chip: "bg-violet-500/20 text-violet-700 dark:text-violet-300", bar: "border-l-violet-500" },
  privat: { chip: "bg-neutral-500/15 text-neutral-600 dark:text-neutral-300", bar: "border-l-neutral-400" },
  normal: { chip: "bg-accent/15 text-accent", bar: "border-l-[var(--accent)]" },
};
