// Datumshilfen mit lokalen "YYYY-MM-DD"-Strings (keine Zeitzonenfallen)

export function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const todayISO = () => toISO(new Date());

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function daysUntil(iso: string): number {
  return Math.round((fromISO(iso).getTime() - fromISO(todayISO()).getTime()) / 86_400_000);
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return fromISO(iso).toLocaleDateString("de-DE", opts);
}

export function relativeDay(iso: string): string {
  const n = daysUntil(iso);
  if (n < -1) return `seit ${-n} Tagen fällig`;
  if (n === -1) return "seit gestern fällig";
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  return `in ${n} Tagen`;
}

export const euro = (n: number) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
