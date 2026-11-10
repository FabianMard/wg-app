"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import { notify } from "@/lib/push";
import { formatDate, todayISO, addDays } from "@/lib/dates";
import type { Member, Poll, PollOption, PollVote } from "@/lib/types";
import { Avatar, btnCls, Card, Empty, inputCls } from "@/components/ui";

/**
 * Abstimmungen (Reiter im Kalender): Termin finden · Ja/Nein · Auswahl.
 * Entschieden wird in der Datenbank (poll_check) – Termine landen dann automatisch im Kalender.
 */

const KINDS = [
  { id: "termin", icon: "📅", label: "Termin finden", hint: "Tage vorschlagen – alle kreuzen an, was passt" },
  { id: "janein", icon: "✅", label: "Ja / Nein", hint: "z. B. „Neues Sofa kaufen?“" },
  { id: "auswahl", icon: "📋", label: "Auswahl", hint: "z. B. „Welche Pizza?“" },
] as const;

const optionLabel = (o: PollOption) =>
  o.day ? `${formatDate(o.day, { weekday: "short", day: "numeric", month: "short" })}${o.time ? `, ${o.time.slice(0, 5)} Uhr` : ""}` : o.label;

/** Wie viele Stimmen braucht eine Option? */
export const needed = (rule: Poll["rule"], n: number) => (rule === "einstimmig" ? n : Math.floor(n / 2) + 1);

/** Offene Abstimmungen, bei denen ich noch nicht abgestimmt habe (für die Zahl am Reiter) */
export function useOpenPollCount() {
  const { myId, isGuest } = useWG();
  const { rows: polls } = useRows<Poll>("polls", "created_at", false);
  const { rows: votes } = useRows<PollVote>("poll_votes", "created_at");
  if (isGuest) return 0;
  return polls.filter((p) => !p.closed_at && !votes.some((v) => v.poll_id === p.id && v.member_id === myId)).length;
}

export function Polls() {
  const { members, myId, household, isGuest } = useWG();
  const { rows: polls, loaded, reload: reloadPolls } = useRows<Poll>("polls", "created_at", false);
  const { rows: options, reload: reloadOptions } = useRows<PollOption>("poll_options", "sort");
  const { rows: votes, reload: reloadVotes } = useRows<PollVote>("poll_votes", "created_at");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reloadAll = () => { reloadPolls(); reloadOptions(); reloadVotes(); };

  // Abgelaufene Fristen auswerten (macht die Datenbank – egal, wer gerade schaut)
  const expired = polls.filter((p) => !p.closed_at && p.deadline && new Date(p.deadline) <= new Date()).map((p) => p.id).join(",");
  useEffect(() => {
    if (!expired) return;
    Promise.all(expired.split(",").map((id) => supabase.rpc("poll_check", { p_poll: id, p_force: true }))).then(() => reloadPolls());
  }, [expired, reloadPolls]);

  if (isGuest) return <Empty>Abstimmungen gibt es nur für Mitbewohner.</Empty>;
  const open = polls.filter((p) => !p.closed_at), closed = polls.filter((p) => p.closed_at);

  async function check(p: Poll, force = false) {
    const { data, error } = await supabase.rpc("poll_check", { p_poll: p.id, p_force: force });
    if (error) { setErr(error.message); return; }
    if (data === "entschieden" || data === "keine_einigung") {
      // Ergebnis frisch lesen und alle benachrichtigen
      const { data: fresh } = await supabase.from("polls").select("result").eq("id", p.id).single();
      const win = options.find((o) => o.id === fresh?.result);
      notify("abstimmung", win ? `Entschieden: ${p.title} → ${optionLabel(win)}${p.kind === "termin" ? " (im Kalender)" : ""}` : `Keine Einigung: ${p.title}`);
    }
    reloadAll();
  }

  async function vote(p: Poll, o: PollOption) {
    setErr(null);
    const mine = votes.filter((v) => v.poll_id === p.id && v.member_id === myId);
    const has = mine.some((v) => v.option_id === o.id);
    if (has) await supabase.from("poll_votes").delete().eq("option_id", o.id).eq("member_id", myId);
    else {
      if (!p.multi && mine.length) await supabase.from("poll_votes").delete().eq("poll_id", p.id).eq("member_id", myId);
      const { error } = await supabase.from("poll_votes").insert({ option_id: o.id, poll_id: p.id, household_id: household.id });
      if (error) { setErr(error.message); reloadAll(); return; }
    }
    await check(p);
  }

  async function remove(p: Poll) {
    if (!confirm(`Abstimmung „${p.title}“ löschen?${p.event_id ? " (Der Kalendertermin bleibt.)" : ""}`)) return;
    await supabase.from("polls").delete().eq("id", p.id);
    reloadAll();
  }

  return (
    <div className="space-y-4">
      {creating
        ? <NewPoll onDone={() => { setCreating(false); reloadAll(); }} onCancel={() => setCreating(false)} />
        : <button onClick={() => setCreating(true)} className={`${btnCls} w-full`}>🗳️ Neue Abstimmung</button>}
      {err && <p className="text-sm text-red-600">{err.includes("polls") || err.includes("poll_") ? "Datenbank-Update fehlt: Bitte supabase/022_abstimmungen.sql im SQL Editor ausführen." : err}</p>}

      {loaded && polls.length === 0 && !creating && <Empty>Noch keine Abstimmungen. Wann ist der nächste WG-Abend? 🍝</Empty>}
      {open.map((p) => <PollCard key={p.id} poll={p} options={options} votes={votes} members={members} myId={myId}
        onVote={(o) => vote(p, o)} onClose={() => check(p, true)} onRemove={() => remove(p)} />)}
      {closed.length > 0 && (
        <>
          <p className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted">Entschieden</p>
          {closed.map((p) => <PollCard key={p.id} poll={p} options={options} votes={votes} members={members} myId={myId}
            onVote={() => {}} onClose={() => {}} onRemove={() => remove(p)} />)}
        </>
      )}
    </div>
  );
}

function PollCard({ poll: p, options, votes, members, myId, onVote, onClose, onRemove }: {
  poll: Poll; options: PollOption[]; votes: PollVote[]; members: Member[]; myId: string;
  onVote: (o: PollOption) => void; onClose: () => void; onRemove: () => void;
}) {
  const opts = options.filter((o) => o.poll_id === p.id).sort((a, b) => a.sort - b.sort);
  const pv = votes.filter((v) => v.poll_id === p.id);
  const n = members.length, need = needed(p.rule, n);
  const voters = new Set(pv.map((v) => v.member_id));
  const missing = members.filter((m) => !voters.has(m.id));
  const creator = members.find((m) => m.id === p.created_by);
  const isOpen = !p.closed_at;
  const result = opts.find((o) => o.id === p.result);
  const kind = KINDS.find((k) => k.id === p.kind)!;

  return (
    <Card className={`space-y-3 ${isOpen ? "" : "opacity-90"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{kind.icon} {p.title}</p>
          <p className="text-xs text-muted">
            {creator ? (creator.id === myId ? "von dir" : `von ${creator.display_name}`) : ""} · {formatDate(p.created_at.slice(0, 10))}
            {p.deadline && isOpen && <> · ⏰ bis {formatDate(p.deadline.slice(0, 10), { weekday: "short", day: "numeric", month: "numeric" })} {new Date(p.deadline).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</>}
          </p>
          {p.note && <p className="mt-1 text-sm">{p.note}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.rule === "einstimmig" ? "bg-violet-500/15 text-violet-700 dark:text-violet-300" : "bg-accent/10 text-accent"}`}>
          {p.rule === "einstimmig" ? `Einstimmig · alle ${n}` : `Mehrheit · ${need} von ${n}`}
        </span>
      </div>

      {!isOpen && (
        <div className={`rounded-xl px-3 py-2 text-sm font-medium ${result ? "bg-green-500/10 text-green-800 dark:text-green-300" : "bg-line/50 text-muted"}`}>
          {result
            ? <>✅ Entschieden: <b>{optionLabel(result)}</b>{p.kind === "termin" && " · steht im Kalender 📅"}</>
            : "🤷 Keine Einigung"}
        </div>
      )}

      <div className="space-y-1.5">
        {opts.map((o) => {
          const ov = pv.filter((v) => v.option_id === o.id);
          const mine = ov.some((v) => v.member_id === myId);
          const lead = isOpen && ov.length > 0 && ov.length === Math.max(...opts.map((x) => pv.filter((v) => v.option_id === x.id).length));
          const pct = Math.round((ov.length / Math.max(1, n)) * 100);
          return (
            <button key={o.id} disabled={!isOpen} onClick={() => onVote(o)}
              className={`relative flex w-full items-center gap-2 overflow-hidden rounded-xl border px-3 py-2 text-left text-sm transition active:scale-[.99] disabled:active:scale-100 ${
                mine ? "border-accent" : "border-line"} ${o.id === p.result ? "ring-2 ring-green-500" : ""}`}>
              {/* Balken: Anteil der Stimmen */}
              <span className="absolute inset-y-0 left-0 bg-accent/10" style={{ width: `${pct}%` }} aria-hidden />
              <span className={`relative flex h-5 w-5 shrink-0 items-center justify-center border-2 text-[11px] font-bold ${p.multi ? "rounded-md" : "rounded-full"} ${mine ? "border-accent bg-accent text-white" : "border-line"}`}>{mine && "✓"}</span>
              <span className={`relative min-w-0 flex-1 ${lead ? "font-semibold" : ""}`}>{optionLabel(o)}</span>
              <span className="relative flex -space-x-1.5">
                {ov.map((v, k) => <Avatar key={v.member_id ?? k} member={members.find((m) => m.id === v.member_id)} size={20} />)}
              </span>
              <span className="relative w-10 shrink-0 text-right text-xs tabular-nums text-muted">{ov.length}/{need}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {isOpen
            ? (missing.length ? <>🗳️ {voters.size} von {n} haben abgestimmt · fehlt: {missing.map((m) => m.id === myId ? "du" : m.display_name).join(", ")}</> : "Alle haben abgestimmt")
            : `${voters.size} von ${n} haben abgestimmt`}
          {isOpen && p.multi && " · mehrere ankreuzbar"}
        </span>
        {p.created_by === myId && (
          <span className="flex gap-1.5">
            {isOpen && <button onClick={onClose} className="rounded-lg border border-line px-2 py-1 font-medium text-fg">Jetzt beenden</button>}
            <button onClick={onRemove} className="rounded-lg border border-line px-2 py-1 font-medium text-fg">Löschen</button>
          </span>
        )}
      </div>
    </Card>
  );
}

function NewPoll({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { household, myId, members } = useWG();
  const [kind, setKind] = useState<Poll["kind"]>("termin");
  const [title, setTitle] = useState("");
  const [rule, setRule] = useState<Poll["rule"]>("mehrheit");
  const [multiChoice, setMultiChoice] = useState(false);
  const [dates, setDates] = useState<{ day: string; time: string }[]>(() => [
    { day: addDays(todayISO(), 3), time: "19:00" }, { day: addDays(todayISO(), 4), time: "19:00" }]);
  const [choices, setChoices] = useState<string[]>(["", ""]);
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = members.length;

  const optionRows = useMemo(() => {
    if (kind === "janein") return [{ label: "Ja", day: null, time: null }, { label: "Nein", day: null, time: null }];
    if (kind === "termin") return dates.filter((d) => d.day).map((d) => ({ label: `${d.day} ${d.time}`.trim(), day: d.day, time: d.time || null }));
    return choices.map((c) => c.trim()).filter(Boolean).map((c) => ({ label: c.slice(0, 120), day: null, time: null }));
  }, [kind, dates, choices]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!title.trim()) return setErr(kind === "termin" ? "Wofür sucht ihr einen Termin?" : "Worüber wird abgestimmt?");
    if (optionRows.length < 2) return setErr(kind === "termin" ? "Mindestens zwei Termine vorschlagen." : "Mindestens zwei Antworten eintragen.");
    setBusy(true);
    const { data: poll, error } = await supabase.from("polls").insert({
      household_id: household.id, created_by: myId, title: title.trim().slice(0, 120), kind, rule,
      multi: kind === "termin" ? true : kind === "auswahl" ? multiChoice : false,
      deadline: deadline ? new Date(deadline).toISOString() : null,
    }).select().single();
    if (error || !poll) {
      setBusy(false);
      return setErr(error?.message.includes("polls") ? "Datenbank-Update fehlt: Bitte supabase/022_abstimmungen.sql im SQL Editor ausführen." : error?.message ?? "Fehler");
    }
    const { error: e2 } = await supabase.from("poll_options").insert(optionRows.map((o, i) => ({ ...o, poll_id: poll.id, household_id: household.id, sort: i })));
    setBusy(false);
    if (e2) return setErr(e2.message);
    notify("abstimmung", `Neue Abstimmung: ${title.trim()}`);
    onDone();
  }

  return (
    <Card>
      <form onSubmit={create} className="space-y-4">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-line/50 p-1 text-xs font-semibold">
          {KINDS.map((k) => (
            <button type="button" key={k.id} onClick={() => setKind(k.id)}
              className={`rounded-lg px-1 py-2 transition ${kind === k.id ? "bg-card shadow-sm" : "text-muted"}`}>{k.icon} {k.label}</button>
          ))}
        </div>
        <p className="-mt-2 text-xs text-muted">{KINDS.find((k) => k.id === kind)!.hint}</p>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">{kind === "termin" ? "Wofür?" : "Frage"}</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
            placeholder={kind === "termin" ? "z. B. WG-Abend 🍝" : kind === "janein" ? "z. B. Neues Sofa kaufen?" : "z. B. Welche Pizza bestellen wir?"} />
        </label>

        {kind === "termin" && (
          <div className="space-y-2">
            <span className="block text-sm font-medium">Vorschläge <span className="font-normal text-muted">(alle kreuzen an, was passt)</span></span>
            {dates.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="date" className={`${inputCls} min-w-0 flex-1 py-2`} value={d.day} min={todayISO()}
                  onChange={(e) => setDates(dates.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)))} aria-label={`Tag ${i + 1}`} />
                <input type="time" className={`${inputCls} w-28 py-2`} value={d.time}
                  onChange={(e) => setDates(dates.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} aria-label={`Uhrzeit ${i + 1}`} />
                {dates.length > 2 && <button type="button" onClick={() => setDates(dates.filter((_, j) => j !== i))} className="px-1 text-muted" aria-label="Vorschlag entfernen">✕</button>}
              </div>
            ))}
            {dates.length < 8 && <button type="button" onClick={() => setDates([...dates, { day: addDays(dates[dates.length - 1]?.day || todayISO(), 1), time: dates[dates.length - 1]?.time ?? "19:00" }])}
              className="text-sm font-medium text-accent">+ weiterer Termin</button>}
          </div>
        )}
        {kind === "auswahl" && (
          <div className="space-y-2">
            <span className="block text-sm font-medium">Antworten</span>
            {choices.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className={`${inputCls} py-2`} value={c} maxLength={120} placeholder={`Antwort ${i + 1}`}
                  onChange={(e) => setChoices(choices.map((x, j) => (j === i ? e.target.value : x)))} />
                {choices.length > 2 && <button type="button" onClick={() => setChoices(choices.filter((_, j) => j !== i))} className="px-1 text-muted" aria-label="Antwort entfernen">✕</button>}
              </div>
            ))}
            {choices.length < 10 && <button type="button" onClick={() => setChoices([...choices, ""])} className="text-sm font-medium text-accent">+ weitere Antwort</button>}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={multiChoice} onChange={(e) => setMultiChoice(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" /> Mehrere Antworten ankreuzbar</label>
          </div>
        )}

        <div>
          <span className="mb-1 block text-sm font-medium">Wann ist entschieden?</span>
          <div className="grid grid-cols-2 gap-2">
            {([["mehrheit", "👍 Mehrheit", `${needed("mehrheit", n)} von ${n} reichen`], ["einstimmig", "🤝 Einstimmig", `alle ${n} müssen zustimmen`]] as const).map(([id, label, sub]) => (
              <button type="button" key={id} onClick={() => setRule(id)}
                className={`rounded-xl border-2 px-3 py-2 text-left text-sm transition ${rule === id ? "border-accent bg-accent/10" : "border-line"}`}>
                <span className="block font-semibold">{label}</span><span className="text-xs text-muted">{sub}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 flex items-center justify-between text-sm font-medium">⏰ Frist (optional)
            {deadline && <button type="button" onClick={() => setDeadline("")} className="text-xs font-semibold text-accent">✕ ohne Frist</button>}</span>
          <input type="datetime-local" className={`${inputCls} py-2 ${deadline ? "" : "text-muted"}`} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          <span className="mt-1 block text-xs text-muted">Ist die Frist um, zählt {rule === "mehrheit" ? "die Option mit den meisten Stimmen" : "nur, was alle angekreuzt haben"}.</span>
        </label>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-line py-2.5 font-medium">Abbrechen</button>
          <button disabled={busy} className={`${btnCls} flex-1`}>{busy ? "…" : "Abstimmung starten"}</button>
        </div>
      </form>
    </Card>
  );
}
