import { addDays, toISO } from "./dates";

export type Holiday = { date: string; name: string };

/** Ostersonntag (Gauß/Meeus-Algorithmus, gregorianischer Kalender) */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toISO(new Date(year, month - 1, day));
}

/** Buß- und Bettag: Mittwoch vor dem 23. November */
function bussUndBettag(year: number): string {
  const d = new Date(year, 10, 22); // 22. November
  while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
  return toISO(d);
}

/**
 * Gesetzliche Feiertage in Sachsen.
 * (Fronleichnam gilt nur in einigen Gemeinden im sorbischen Siedlungsgebiet und ist daher nicht enthalten.)
 */
export function holidaysSachsen(year: number): Holiday[] {
  const easter = easterSunday(year);
  const fixed = (m: number, d: number) => toISO(new Date(year, m - 1, d));
  return [
    { date: fixed(1, 1), name: "Neujahr" },
    { date: addDays(easter, -2), name: "Karfreitag" },
    { date: addDays(easter, 1), name: "Ostermontag" },
    { date: fixed(5, 1), name: "Tag der Arbeit" },
    { date: addDays(easter, 39), name: "Christi Himmelfahrt" },
    { date: addDays(easter, 50), name: "Pfingstmontag" },
    { date: fixed(10, 3), name: "Tag der Deutschen Einheit" },
    { date: fixed(10, 31), name: "Reformationstag" },
    { date: bussUndBettag(year), name: "Buß- und Bettag" },
    { date: fixed(12, 25), name: "1. Weihnachtstag" },
    { date: fixed(12, 26), name: "2. Weihnachtstag" },
  ];
}

const cache = new Map<number, Map<string, string>>();

/** Name des Feiertags an diesem Tag (oder undefined) */
export function holidayOn(iso: string): string | undefined {
  const year = Number(iso.slice(0, 4));
  if (!cache.has(year)) cache.set(year, new Map(holidaysSachsen(year).map((h) => [h.date, h.name])));
  return cache.get(year)!.get(iso);
}
