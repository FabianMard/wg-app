"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRows, useWG } from "@/lib/wg";
import type { CalEvent, ChoreArea, ChoreCheck, ChoreOverride, ChoreTask, CostRequest, Expense, Member, Note, Praise, ShoppingItem, Todo } from "@/lib/types";
import { areaStatuses, periodRange } from "@/lib/cleaning";
import { addDays, euro, formatDate, toISO } from "@/lib/dates";
import { holidaysSachsen } from "@/lib/holidays";
import { displayTitle, occurrencesBetween } from "@/lib/events";
import { storeById } from "@/lib/stores";
import { Avatar, Card, SectionTitle } from "@/components/ui";

const dayOf = (ts: string) => (ts.length <= 10 ? ts : toISO(new Date(ts)));

const award = (list: { m: Member; n: number }[]) => (list[0]?.n ? list[0] : null);

/** Zählt pro Mitbewohner und sortiert absteigend */
function tally(ids: (string | null | undefined)[], members: Member[]) {
  const c = new Map<string, number>();
  for (const id of ids) if (id) c.set(id, (c.get(id) ?? 0) + 1);
  return members.map((m) => ({ m, n: c.get(m.id) ?? 0 })).sort((a, b) => b.n - a.n);
}

export default function Bericht() {
  const { household, members } = useWG();
  const { rows: areas } = useRows<ChoreArea>("chore_areas", "sort");
  const { rows: tasks } = useRows<ChoreTask>("chore_tasks", "sort");
  const { rows: checks } = useRows<ChoreCheck>("chore_checks", "done_at");
  const { rows: overrides } = useRows<ChoreOverride>("chore_overrides", "created_at");
  const { rows: items } = useRows<ShoppingItem>("shopping_items", "created_at");
  const { rows: expenses } = useRows<Expense>("expenses", "created_at");
  const { rows: events } = useRows<CalEvent>("events", "day");
  const { rows: todos } = useRows<Todo>("todos", "created_at");
  const { rows: praises } = useRows<Praise>("praises", "created_at");
  const { rows: notes } = useRows<Note>("notes", "created_at");
  const { rows: requests } = useRows<CostRequest>("cost_requests", "created_at");

  // Standard: aktueller Monat. In der ersten Woche eines Monats lieber der Vormonat (der ist dann "fertig").
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() - (d.getDate() <= 7 ? 1 : 0), 1);
  });
  const from = toISO(month);
  const to = toISO(new Date(month.getFullYear(), month.getMonth() + 1, 1)); // exklusiv
  const inMonth = (ts: string | null | undefined) => !!ts && dayOf(ts) >= from && dayOf(ts) < to;
  const isFuture = to > toISO(new Date()); // nächster Monat läge in der Zukunft
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const touch = useRef<number | null>(null);

  // ── Putzen: Runden, deren Putzwoche in diesem Monat endet ──
  const start = household.cleaning_start;
  // Nur Putzwochen, die schon begonnen haben; die laufende zählt noch nicht in die Statistik
  const today = toISO(new Date());
  const rounds: { period: number; due: string; running: boolean; statuses: ReturnType<typeof areaStatuses> }[] = [];
  for (let p = 0; p < 400; p++) {
    const r = periodRange(start, p);
    if (r.due >= to || r.from > today) break;
    if (r.due >= from) rounds.push({ period: p, due: r.due, running: r.due >= today, statuses: areaStatuses(areas, tasks, checks, members, p, overrides) });
  }
  // Verfallene Dienste zählen nicht (weder als erledigt noch als versäumt)
  const areaResults = rounds.filter((r) => !r.running).flatMap((r) => r.statuses.filter((s) => !s.skipped).map((s) => ({ ...s, due: r.due })));
  const doneAreas = areaResults.filter((s) => s.done).length;
  const checksMonth = checks.filter((c) => inMonth(c.done_at));
  const checkTally = tally(checksMonth.map((c) => c.done_by), members);
  const reliability = members.map((m) => {
    const mine = areaResults.filter((s) => s.assignee?.id === m.id);
    return { m, total: mine.length, done: mine.filter((s) => s.done).length };
  });

  // ── Einkauf ──
  const itemsMonth = items.filter((i) => inMonth(i.created_at));
  const boughtMonth = itemsMonth.filter((i) => i.done || i.archived);
  const itemTally = tally(itemsMonth.map((i) => i.added_by), members);
  // Wer hat eingekauft? (abgehakt, nach Kaufdatum) – und wer hat für Einkäufe bezahlt?
  const boughtByMonth = items.filter((i) => i.done_by && inMonth(i.done_at ?? i.created_at));
  const buyerTally = tally(boughtByMonth.map((i) => i.done_by), members);
  const shoppingSpend = members.map((m) => ({
    m,
    sum: expenses.filter((e) => !e.is_settlement && e.paid_by === m.id && inMonth(e.spent_on) && /^einkauf/i.test(e.title))
      .reduce((s, e) => s + Number(e.amount), 0),
  })).sort((a, b) => b.sum - a.sum);
  const shoppingTotal = shoppingSpend.reduce((s, x) => s + x.sum, 0);
  // Einkaufs-Otto: wer am meisten eingekauft hat. Am liebsten nach abgehakten Sachen;
  // gibt es die (noch) nicht, zählen die bezahlten Einkäufe unter Kosten.
  const shoppingTrips = tally(expenses.filter((e) => !e.is_settlement && inMonth(e.spent_on) && /^einkauf/i.test(e.title)).map((e) => e.paid_by), members);
  const otto = award(buyerTally)
    ? { w: award(buyerTally), unit: "Sachen eingekauft" }
    : { w: award(shoppingTrips), unit: shoppingTrips[0]?.n === 1 ? "Einkauf bezahlt" : "Einkäufe bezahlt" };
  const topItems = [...itemsMonth.reduce((m, i) => m.set(i.name.trim(), (m.get(i.name.trim()) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  const storeCounts = [...itemsMonth.reduce((m, i) => m.set(i.store, (m.get(i.store) ?? 0) + 1), new Map<ShoppingItem["store"], number>())]
    .sort((a, b) => b[1] - a[1]);

  // ── Kosten ──
  const spending = expenses.filter((e) => !e.is_settlement && inMonth(e.spent_on));
  const settlements = expenses.filter((e) => e.is_settlement && inMonth(e.spent_on));
  const total = spending.reduce((s, e) => s + Number(e.amount), 0);
  const paidBy = members.map((m) => ({ m, sum: spending.filter((e) => e.paid_by === m.id).reduce((s, e) => s + Number(e.amount), 0) }))
    .sort((a, b) => b.sum - a.sum);
  const biggest = [...spending].sort((a, b) => Number(b.amount) - Number(a.amount))[0];

  // ── Haushaltsausschuss: eingereichte Kosten (getrennt von „Kosten teilen“) ──
  const paidOutMonth = requests.filter((q) => q.status === "ausgezahlt" && inMonth(q.paid_out_at ?? q.decided_at));
  const approvedOpen = requests.filter((q) => q.status === "freigegeben" && inMonth(q.decided_at));
  const submittedMonth = requests.filter((q) => inMonth(q.created_at));
  const rejectedMonth = requests.filter((q) => q.status === "abgelehnt" && inMonth(q.decided_at));
  const paidOutSum = paidOutMonth.reduce((a, q) => a + Number(q.amount), 0);
  const nameOf = (id: string) => members.find((x) => x.id === id)?.display_name ?? "?";

  // ── Kalender, To-dos, Bienchen, Pinnwand ──
  // inkl. wiederkehrender Termine (z. B. Geburtstage)
  const eventsMonth = occurrencesBetween(events, from, addDays(to, -1)).map((o) => ({ ...o.event, title: displayTitle(o.event, o.day), id: `${o.event.id}-${o.day}`, day: o.day }));
  const holidays = holidaysSachsen(month.getFullYear()).filter((h) => inMonth(h.date));
  const todosCreated = todos.filter((t) => inMonth(t.created_at));
  const todosDone = todos.filter((t) => t.done && inMonth(t.done_at));
  const todoTally = tally(todosDone.map((t) => t.done_by), members);
  const praisesMonth = praises.filter((p) => inMonth(p.created_at));
  const beeTally = tally(praisesMonth.map((p) => p.to_member), members);
  const notesMonth = notes.filter((n) => inMonth(n.created_at));

  // ── Auszeichnungen ──
  const awards = [
    { icon: "🏆", title: "Putz-Champion", w: award(checkTally), unit: "Häkchen" },
    { icon: "🐝", title: "Bienenkönig*in", w: award(beeTally), unit: "Bienchen" },
    { icon: "🛍️", title: "Einkaufs-Otto", w: otto.w, unit: otto.unit },
    { icon: "🛒", title: "Listen-Profi", w: award(itemTally), unit: "Sachen eingetragen" },
    { icon: "✅", title: "To-do-Erlediger*in", w: award(todoTally), unit: "To-dos" },
    { icon: "💸", title: "Spendierhosen", w: paidBy[0]?.sum ? { m: paidBy[0].m, n: paidBy[0].sum } : null, unit: "€", money: true },
  ].filter((a) => a.w);

  const monthName = month.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  // ── Export: Text-Zusammenfassung zum Teilen/Mailen ──
  const reportText = () => {
    const L: string[] = [`🏠 ${household.name} – Monatsbericht ${monthName}`, ""];
    L.push(`🧽 ${doneAreas}/${areaResults.length} Putzbereiche erledigt`, `🛒 ${boughtMonth.length} Sachen eingekauft`,
      `💶 ${euro(total)} Ausgaben`, ...(paidOutMonth.length ? [`📝 ${euro(paidOutSum)} vom Haushaltsausschuss ausgezahlt`] : []), `🐝 ${praisesMonth.length} Bienchen verteilt`);
    if (awards.length) {
      L.push("", "🏆 Auszeichnungen");
      for (const a of awards) L.push(`${a.icon} ${a.title}: ${a.w!.m.display_name} (${a.money ? euro(a.w!.n) : `${a.w!.n} ${a.unit}`})`);
    }
    if (rounds.length) {
      L.push("", "🧽 Putzen");
      for (const r of rounds) {
        L.push(`Putzwoche bis ${formatDate(r.due)}${r.running ? " (läuft noch)" : ""}: ` +
          r.statuses.map((x) => `${x.area.name} ${x.assignee?.display_name ?? "?"} ${x.skipped ? "verfallen" : x.done ? "✓" : r.running ? `${x.doneCount}/${x.tasks.length}` : "✗"}`).join(", "));
      }
    }
    if (itemsMonth.length) {
      L.push("", "🛒 Einkaufen", `${itemsMonth.length} eingetragen, ${boughtMonth.length} gekauft`);
      if (topItems.length) L.push(`Am häufigsten: ${topItems.map(([n, c]) => `${n}${c > 1 ? ` (${c}×)` : ""}`).join(", ")}`);
      if (boughtByMonth.length) L.push(`Eingekauft: ${buyerTally.filter((x) => x.n).map((x) => `${x.m.display_name} ${x.n}`).join(", ")}`);
    }
    if (spending.length) {
      L.push("", "💶 Kosten", `${euro(total)} in ${spending.length} Ausgaben`);
      L.push(`Bezahlt: ${paidBy.filter((x) => x.sum).map((x) => `${x.m.display_name} ${euro(x.sum)}`).join(", ")}`);
      if (biggest) L.push(`Größte Ausgabe: ${biggest.title} (${euro(Number(biggest.amount))})`);
    }
    if (paidOutMonth.length || approvedOpen.length || submittedMonth.length) {
      L.push("", "📝 Haushaltsausschuss (eingereichte Kosten)");
      if (paidOutMonth.length) {
        L.push(`Ausgezahlt: ${euro(paidOutSum)}`);
        for (const q of paidOutMonth) L.push(`• ${q.title} – ${nameOf(q.created_by)} – ${euro(Number(q.amount))}`);
      }
      if (approvedOpen.length) L.push(`Freigegeben, Auszahlung offen: ${approvedOpen.map((q) => `${q.title} (${nameOf(q.created_by)}, ${euro(Number(q.amount))})`).join(", ")}`);
      L.push(`${submittedMonth.length} eingereicht${rejectedMonth.length ? `, ${rejectedMonth.length} abgelehnt` : ""}`);
    }
    if (todosDone.length) L.push("", `✅ ${todosDone.length} To-dos erledigt: ${todosDone.slice(0, 8).map((t) => t.title).join(", ")}`);
    if (eventsMonth.length || holidays.length) {
      L.push("", "📅 Termine");
      for (const e of [...holidays.map((h) => ({ day: h.date, title: `🎉 ${h.name}` })), ...eventsMonth].sort((a, b) => a.day.localeCompare(b.day))) {
        L.push(`${formatDate(e.day)}: ${e.title}`);
      }
    }
    return L.join("\n");
  };
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const flash = (m: string) => { setShareMsg(m); setTimeout(() => setShareMsg(null), 2500); };
  async function share() {
    const text = reportText();
    if (navigator.share) {
      try { await navigator.share({ title: `Monatsbericht ${monthName}`, text }); return; } catch { return; /* abgebrochen */ }
    }
    await navigator.clipboard.writeText(text);
    flash("📋 Kopiert – jetzt z. B. in WhatsApp einfügen");
  }
  async function copy() { await navigator.clipboard.writeText(reportText()); flash("📋 Text kopiert"); }
  const mailto = () => `mailto:?subject=${encodeURIComponent(`${household.name}: Monatsbericht ${monthName}`)}&body=${encodeURIComponent(reportText())}`;

  const nothing = !rounds.length && !itemsMonth.length && !spending.length && !submittedMonth.length && !paidOutMonth.length && !eventsMonth.length && !todosCreated.length && !praisesMonth.length && !notesMonth.length;

  return (
    <div onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => { const t = touch.current; touch.current = null; if (t === null) return; const dx = e.changedTouches[0].clientX - t; if (Math.abs(dx) > 70) shift(dx < 0 ? 1 : -1); }}>
      <div className="mb-5 flex items-center justify-between gap-2">
        <button onClick={() => shift(-1)} className="no-print rounded-xl px-3 py-2 text-xl hover:bg-line/50" aria-label="Vorheriger Monat">‹</button>
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Monatsbericht</p>
          <h1 className="text-2xl font-bold tracking-tight">{monthName}</h1>
          <p className="print-only text-sm text-muted">{household.name}</p>
        </div>
        <button onClick={() => shift(1)} disabled={isFuture} className="no-print rounded-xl px-3 py-2 text-xl hover:bg-line/50 disabled:opacity-25" aria-label="Nächster Monat">›</button>
      </div>

      {!nothing && (
        <div className="no-print mb-5">
          <div className="flex flex-wrap justify-center gap-2">
            <button onClick={share} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm active:scale-95">📤 Teilen</button>
            <a href={mailto()} className="rounded-full border border-line bg-card px-4 py-2 text-sm font-medium active:scale-95">✉️ E-Mail</a>
            <button onClick={() => window.print()} className="rounded-full border border-line bg-card px-4 py-2 text-sm font-medium active:scale-95">🖨️ Als PDF</button>
            <button onClick={copy} className="rounded-full border border-line bg-card px-4 py-2 text-sm font-medium active:scale-95">📋 Kopieren</button>
          </div>
          {shareMsg && <p className="mt-2 text-center text-sm text-emerald-600">{shareMsg}</p>}
        </div>
      )}

      {nothing ? (
        <Card><p className="text-center text-muted">In diesem Monat ist (noch) nichts passiert. 🦗</p></Card>
      ) : (
        <>
          {/* Zahlen auf einen Blick */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat value={`${doneAreas}/${areaResults.length}`} label="Bereiche geputzt" />
            <Stat value={String(boughtMonth.length)} label="Sachen eingekauft" />
            <Stat value={euro(total)} label="Ausgaben gesamt" />
            <Stat value={String(praisesMonth.length)} label="Bienchen verteilt 🐝" />
          </div>

          {awards.length > 0 && (
            <>
              <SectionTitle>Auszeichnungen</SectionTitle>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {awards.map((a) => (
                  <Card key={a.title} className="flex items-center gap-3 py-3">
                    <span className="text-3xl">{a.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{a.title}</p>
                      <p className="font-semibold">{a.w!.m.display_name}</p>
                    </div>
                    <span className="text-sm text-muted">{a.money ? euro(a.w!.n) : `${a.w!.n} ${a.unit}`}</span>
                    <Avatar member={a.w!.m} />
                  </Card>
                ))}
              </div>
            </>
          )}

          {rounds.length > 0 && (
            <>
              <SectionTitle>🧽 Putzen</SectionTitle>
              <Card className="space-y-3">
                {rounds.map((r) => (
                  <div key={r.period}>
                    <p className="mb-1 text-xs font-medium text-muted">Putzwoche bis {formatDate(r.due)}{r.running && " · läuft noch"}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {r.statuses.map((s) => (
                        <span key={s.area.id} className={`rounded-full px-2.5 py-1 text-sm font-medium ${s.skipped ? "bg-line/60 text-muted" : s.done ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : r.running ? "bg-line/60 text-muted" : "bg-red-500/15 text-red-700 dark:text-red-300"}`}>
                          {s.skipped ? "⏭️" : s.done ? "✓" : r.running ? `${s.doneCount}/${s.tasks.length}` : "✗"} {s.area.name}: {s.assignee?.display_name}{s.original ? ` (für ${s.original.display_name})` : ""}{s.skipped ? " · verfallen" : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-xs font-medium text-muted">Zuverlässigkeit (abgeschlossene Putzwochen) &amp; abgehakte Teilaufgaben</p>
                  {reliability.map(({ m, total: t, done: d }) => (
                    <Bar key={m.id} m={m} value={t ? d / t : 0} label={`${d}/${t} Bereiche · ${checkTally.find((x) => x.m.id === m.id)?.n ?? 0} Häkchen`} />
                  ))}
                </div>
              </Card>
            </>
          )}

          {itemsMonth.length > 0 && (
            <>
              <SectionTitle>🛒 Einkaufen</SectionTitle>
              <Card className="space-y-3">
                <p className="text-sm"><b>{itemsMonth.length}</b> Sachen eingetragen, <b>{boughtMonth.length}</b> davon gekauft.</p>
                {topItems.length > 0 && (
                  <p className="text-sm"><span className="text-muted">Am häufigsten: </span>{topItems.map(([n, c]) => `${n}${c > 1 ? ` (${c}×)` : ""}`).join(", ")}</p>
                )}
                {storeCounts.length > 0 && (
                  <p className="text-sm"><span className="text-muted">Märkte: </span>{storeCounts.map(([s, c]) => `${storeById(s).label} ${c}`).join(" · ")}</p>
                )}
                {boughtByMonth.length > 0 && (
                  <div className="border-t border-line pt-3">
                    <p className="mb-2 text-xs font-medium text-muted">Wer hat eingekauft?</p>
                    {buyerTally.map(({ m, n }) => <Bar key={m.id} m={m} value={n / boughtByMonth.length} label={`${n} ${n === 1 ? "Sache" : "Sachen"} gekauft`} />)}
                  </div>
                )}
                {shoppingTotal > 0 && (
                  <div className="border-t border-line pt-3">
                    <p className="mb-2 text-xs font-medium text-muted">Für Einkäufe bezahlt</p>
                    {shoppingSpend.map(({ m, sum }) => <Bar key={m.id} m={m} value={sum / shoppingTotal} label={euro(sum)} />)}
                  </div>
                )}
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-xs font-medium text-muted">Wer hat auf die Liste geschrieben?</p>
                  {itemTally.map(({ m, n }) => <Bar key={m.id} m={m} value={itemsMonth.length ? n / itemsMonth.length : 0} label={`${n} eingetragen`} />)}
                </div>
              </Card>
            </>
          )}

          {(spending.length > 0 || settlements.length > 0) && (
            <>
              <SectionTitle>💶 Kosten</SectionTitle>
              <Card className="space-y-3">
                <p className="text-sm"><b>{euro(total)}</b> in {spending.length} {spending.length === 1 ? "Ausgabe" : "Ausgaben"}
                  {settlements.length > 0 && <>, dazu {settlements.length}× ausgeglichen ({euro(settlements.reduce((s, e) => s + Number(e.amount), 0))})</>}.</p>
                {biggest && <p className="text-sm"><span className="text-muted">Größte Ausgabe: </span>{biggest.title} ({euro(Number(biggest.amount))})</p>}
                <div className="border-t border-line pt-3">
                  {paidBy.map(({ m, sum }) => <Bar key={m.id} m={m} value={total ? sum / total : 0} label={`${euro(sum)} bezahlt`} />)}
                </div>
              </Card>
            </>
          )}

          {(paidOutMonth.length > 0 || approvedOpen.length > 0 || submittedMonth.length > 0) && (
            <>
              <SectionTitle>📝 Haushaltsausschuss</SectionTitle>
              <Card className="space-y-3">
                <p className="text-sm">
                  <b>{euro(paidOutSum)}</b> ausgezahlt · {submittedMonth.length} {submittedMonth.length === 1 ? "Antrag" : "Anträge"} eingereicht
                  {rejectedMonth.length > 0 && <>, {rejectedMonth.length} abgelehnt</>}
                  <span className="block text-xs text-muted">Eingereichte Kosten – getrennt von „Kosten teilen“.</span>
                </p>
                {paidOutMonth.length > 0 && (
                  <div className="divide-y divide-line border-t border-line">
                    {paidOutMonth.map((q) => (
                      <div key={q.id} className="flex items-center gap-2 py-1.5 text-sm">
                        <span>💸</span>
                        <span className="min-w-0 flex-1 truncate">{q.title} <span className="text-muted">· {nameOf(q.created_by)}</span></span>
                        <span className="shrink-0 font-semibold tabular-nums">{euro(Number(q.amount))}</span>
                      </div>
                    ))}
                  </div>
                )}
                {approvedOpen.length > 0 && (
                  <p className="rounded-xl bg-amber-400/15 px-3 py-2 text-sm">
                    ⏳ Freigegeben, Auszahlung offen: {approvedOpen.map((q) => `${q.title} (${nameOf(q.created_by)}, ${euro(Number(q.amount))})`).join(", ")}
                  </p>
                )}
              </Card>
            </>
          )}

          {(todosCreated.length > 0 || todosDone.length > 0) && (
            <>
              <SectionTitle>✅ To-dos</SectionTitle>
              <Card className="space-y-2">
                <p className="text-sm"><b>{todosDone.length}</b> erledigt, <b>{todosCreated.length}</b> neu dazugekommen.</p>
                {todosDone.length > 0 && (
                  <ul className="list-inside list-disc text-sm text-muted">
                    {todosDone.slice(0, 6).map((t) => <li key={t.id}><span className="text-fg">{t.title}</span>{t.done_by && ` (${members.find((m) => m.id === t.done_by)?.display_name})`}</li>)}
                  </ul>
                )}
              </Card>
            </>
          )}

          {(eventsMonth.length > 0 || holidays.length > 0) && (
            <>
              <SectionTitle>📅 Termine</SectionTitle>
              <Card>
                <ul className="space-y-1 text-sm">
                  {[...holidays.map((h) => ({ key: h.date + h.name, day: h.date, title: `🎉 ${h.name}`, holiday: true })),
                    ...eventsMonth.map((e) => ({ key: e.id, day: e.day, title: e.title, holiday: false }))]
                    .sort((a, b) => a.day.localeCompare(b.day)).map((e) => (
                      <li key={e.key} className="flex gap-3">
                        <span className="w-20 shrink-0 text-muted">{formatDate(e.day)}</span>
                        <span className={e.holiday ? "text-red-600" : ""}>{e.title}</span>
                      </li>
                    ))}
                </ul>
              </Card>
            </>
          )}

          {(praisesMonth.length > 0 || notesMonth.length > 0) && (
            <>
              <SectionTitle>🐝 Stimmung</SectionTitle>
              <Card className="space-y-3">
                {praisesMonth.length > 0 && beeTally.map(({ m, n }) => (
                  <Bar key={m.id} m={m} value={praisesMonth.length ? n / praisesMonth.length : 0} label={`${n} Bienchen bekommen`} />
                ))}
                {notesMonth.length > 0 && (
                  <p className="border-t border-line pt-3 text-sm">📌 <b>{notesMonth.length}</b> {notesMonth.length === 1 ? "Zettel" : "Zettel"} an der Pinnwand, z. B. „{notesMonth[0].text.slice(0, 60)}{notesMonth[0].text.length > 60 ? "…" : ""}“</p>
                )}
              </Card>
            </>
          )}
        </>
      )}

      <p className="no-print mt-6 text-center text-xs text-muted">
        Tipp: Zwischen den Monaten wischen. <Link href="/" className="underline">Zur Startseite</Link>
      </p>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Card className="px-3 py-3 text-center">
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </Card>
  );
}

function Bar({ m, value, label }: { m: Member; value: number; label: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 last:mb-0">
      <Avatar member={m} size={22} />
      <span className="w-16 shrink-0 truncate text-sm">{m.display_name}</span>
      <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line/60">
        <span className="block h-full rounded-full" style={{ width: `${Math.round(value * 100)}%`, background: m.color }} />
      </span>
      <span className="w-32 shrink-0 text-right text-xs text-muted sm:w-40">{label}</span>
    </div>
  );
}
