import { addDays, fromISO, todayISO } from "./dates";
import type { ChoreArea, ChoreCheck, ChoreTask, Member } from "./types";

/**
 * Eine Runde dauert 2 Wochen:
 *  Woche 1 = Putzwoche (fällig am Sonntag),
 *  Woche 2 = freie Woche – wer nicht fertig wurde, ist überfällig und muss nachholen.
 * Danach wechseln die Bereiche.
 */
export const PERIOD_DAYS = 14;

export function periodOf(start: string, day: string = todayISO()): number {
  const diff = Math.round((fromISO(day).getTime() - fromISO(start).getTime()) / 86_400_000);
  return Math.floor(diff / PERIOD_DAYS);
}

export function periodRange(start: string, period: number) {
  const from = addDays(start, period * PERIOD_DAYS);
  // due = letzter Tag der Putzwoche, freeFrom = erster Tag der freien Woche
  return { from, due: addDays(from, 6), freeFrom: addDays(from, 7), end: addDays(from, PERIOD_DAYS - 1) };
}

/** Bereich i ist in Runde p bei Mitbewohner (i + p) mod n. So wechselt jeder reihum. */
export function assigneeFor(areaIndex: number, period: number, members: Member[]): Member | undefined {
  if (!members.length) return undefined;
  const n = members.length;
  return members[(((areaIndex + period) % n) + n) % n];
}

export type AreaStatus = {
  area: ChoreArea;
  tasks: ChoreTask[];
  checks: ChoreCheck[];      // Häkchen dieser Runde
  assignee?: Member;
  done: boolean;
  doneCount: number;
  helpers: string[];         // wer Häkchen gesetzt hat (Member-IDs)
};

export function areaStatuses(
  areas: ChoreArea[], tasks: ChoreTask[], checks: ChoreCheck[], members: Member[], period: number,
): AreaStatus[] {
  return [...areas].sort((a, b) => a.sort - b.sort).map((area, i) => {
    const t = tasks.filter((x) => x.area_id === area.id).sort((a, b) => a.sort - b.sort);
    const c = checks.filter((x) => x.area_id === area.id && x.period === period && t.some((tt) => tt.id === x.task_id));
    return {
      area,
      tasks: t,
      checks: c,
      assignee: assigneeFor(i, period, members),
      done: t.length > 0 && c.length >= t.length,
      doneCount: c.length,
      helpers: [...new Set(c.map((x) => x.done_by).filter((x): x is string => !!x))],
    };
  });
}

export type Phase = "putzwoche" | "frei" | "vorbei";
export function phaseOf(start: string, period: number, day = todayISO()): Phase {
  const r = periodRange(start, period);
  if (day <= r.due) return "putzwoche";
  if (day <= r.end) return "frei";
  return "vorbei";
}

/** Nicht in der Putzwoche erledigt (und die Putzwoche ist vorbei). Vor dem Start des Putzplans ist nichts überfällig. */
export function isOverdue(s: AreaStatus, start: string, period: number, day = todayISO()): boolean {
  if (period < 0 || day < start) return false;
  return !s.done && s.tasks.length > 0 && day > periodRange(start, period).due;
}

/** Hat der Putzplan schon begonnen? (Startdatum kann in der Zukunft liegen) */
export const beforeStart = (start: string, day = todayISO()) => day < start;
/** Aktuelle Runde – vor dem Start wird die erste Runde gezeigt */
export const currentPeriod = (start: string, day = todayISO()) => Math.max(0, periodOf(start, day));
