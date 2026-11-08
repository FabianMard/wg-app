"use client";

import { useEffect, useRef, useState } from "react";
import { useRows, useWG } from "@/lib/wg";
import { supabase } from "@/lib/supabase";
import type { ChoreArea, ChoreCheck, ChoreTask, Expense, Member, Message, Praise, Todo } from "@/lib/types";
import { areaStatuses, isOverdue, periodOf, phaseOf } from "@/lib/cleaning";
import { computeBalances, suggestTransfers } from "@/lib/balances";
import { euro, formatDate } from "@/lib/dates";
import { AvatarFigure, lookOf } from "./avatar";
import { beesOf, PraiseButton } from "@/components/Praise";

type Topic = "hallo" | "loben" | "geld" | "todos";

const GREETINGS = [
  "Hey {me}! Na, alles klar?",
  "Oh, hi {me}! Was gibt's?",
  "Moin {me}! 👋",
  "Na {me}, auch auf dem Weg zur Küche?",
];

export function TalkDialog({ target, online, onEmote, onSay, onClose }: {
  target: Member;
  online: boolean;
  onEmote: (emoji: string, targetId?: string) => void;
  onSay: (text: string) => void;
  onClose: () => void;
}) {
  const { me, myId, members, household, isGuest } = useWG();
  const { rows: areas } = useRows<ChoreArea>("chore_areas", "sort");
  const { rows: tasks } = useRows<ChoreTask>("chore_tasks", "sort");
  const { rows: checks } = useRows<ChoreCheck>("chore_checks", "done_at");
  const { rows: praises, reload: reloadPraises } = useRows<Praise>("praises", "created_at");
  const { rows: todos } = useRows<Todo>("todos", "created_at", false);
  const { rows: expenses } = useRows<Expense>("expenses", "created_at");
  const [topic, setTopic] = useState<Topic>("hallo");
  const [msg, setMsg] = useState("");
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Gespeicherter Chat zwischen mir und dieser Person (nur wir beide können ihn lesen)
  const { rows: allMessages, reload: reloadMessages } = useRows<Message>("messages", "created_at");
  const chat = allMessages.filter((m) =>
    (m.from_member === myId && m.to_member === target.id) || (m.from_member === target.id && m.to_member === myId));
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest" }); }, [chat.length]);

  // Ungelesenes von der Person als gelesen markieren
  const unreadIds = chat.filter((m) => m.from_member === target.id && !m.read_at).map((m) => m.id).join(",");
  useEffect(() => {
    if (!unreadIds) return;
    supabase.from("messages").update({ read_at: new Date().toISOString() }).in("id", unreadIds.split(",")).then(() => reloadMessages());
  }, [unreadIds, reloadMessages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const t = msg.trim().slice(0, 500);
    if (!t || sending) return;
    setChatErr(null);
    setSending(true);
    const { error } = await supabase.from("messages").insert({ household_id: household.id, to_member: target.id, text: t });
    setSending(false);
    if (error) {
      setChatErr(error.message.includes("messages") ? "Datenbank-Update fehlt: Bitte supabase/010_chat.sql im SQL Editor ausführen." : error.message);
      return;
    }
    onSay(t.slice(0, 80)); // zusätzlich als Sprechblase im Spiel
    setMsg("");
    reloadMessages();
  }

  const [greeting] = useState(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
  const period = periodOf(household.cleaning_start);
  const current = areaStatuses(areas, tasks, checks, members, period);
  const previous = period > 0 ? areaStatuses(areas, tasks, checks, members, period - 1) : [];
  const myArea = current.find((s) => s.assignee?.id === target.id);

  // Was hat die Person erledigt und kann gelobt werden?
  const praiseable = (() => {
    const list: { key: string; label: string; kind: Praise["kind"]; refId: string }[] = [];
    for (const [p, statuses] of [[period, current], [period - 1, previous]] as const) {
      for (const s of statuses) {
        if (!s.done) continue;
        const who = s.helpers.length ? s.helpers : s.assignee ? [s.assignee.id] : [];
        if (!who.includes(target.id)) continue;
        list.push({ key: `${s.area.id}:${p}`, label: `${s.area.icon} ${s.area.name} geputzt${p < period ? " (letzte Runde)" : ""}`, kind: "putzen", refId: `${s.area.id}:${p}` });
      }
    }
    const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();
    for (const t of todos) {
      if (t.done && t.done_by === target.id && (t.done_at ?? "") >= twoWeeksAgo) {
        list.push({ key: t.id, label: `✅ ${t.title}`, kind: "todo", refId: t.id });
      }
    }
    return list;
  })();

  const transfers = suggestTransfers(computeBalances(expenses, members.map((m) => m.id)));
  const iOwe = transfers.find((t) => t.from === myId && t.to === target.id);
  const theyOwe = transfers.find((t) => t.from === target.id && t.to === myId);
  const theirTodos = todos.filter((t) => !t.done && t.assignee === target.id);

  let line: React.ReactNode;
  if (topic === "hallo") {
    line = (
      <>
        {!online && <>💤 <i>{target.display_name} ist gerade nicht im Spiel, hört dich aber trotzdem.</i><br /></>}
        {greeting.replace("{me}", me?.display_name ?? "")}{" "}
        {myArea
          ? myArea.done
            ? phaseOf(household.cleaning_start, period) === "putzwoche"
              ? <>Ich hab diese Woche {myArea.area.icon} <b>{myArea.area.name}</b>, und die ist schon fertig! 💪</>
              : <>{myArea.area.icon} <b>{myArea.area.name}</b> ist erledigt, ich hab diese Woche frei! 😎</>
            : isOverdue(myArea, household.cleaning_start, period)
              ? <>Ups … {myArea.area.icon} <b>{myArea.area.name}</b> hätte ich letzte Woche machen sollen, ich hol das nach! 😅 ({myArea.doneCount} von {myArea.tasks.length})</>
              : <>Ich hab diese Woche Putzdienst: {myArea.area.icon} <b>{myArea.area.name}</b>, {myArea.doneCount} von {myArea.tasks.length} erledigt.</>
          : null}
        {!isGuest && target.role !== "gast" && <>{" "}Ich hab übrigens schon <b>🐝 {beesOf(praises, target.id)}</b> Bienchen.</>}
        {target.role === "gast" && <> Ich bin heute zu Besuch! 👋</>}
        {target.reading?.title && <> Gerade lese ich übrigens <b>„{target.reading.title}“</b>{target.reading.author ? ` von ${target.reading.author}` : ""} 📖</>}
      </>
    );
  } else if (topic === "loben") {
    line = praiseable.length
      ? <>Oh, danke! Wofür willst du mich loben?</>
      : <>Hm, ich hab in letzter Zeit gar nichts abgehakt … Aber lieb von dir! 😊</>;
  } else if (topic === "geld") {
    line = iOwe
      ? <>Laut Haushaltskasse schuldest du mir noch <b>{euro(iOwe.cents / 100)}</b>. 😉</>
      : theyOwe
        ? <>Ich schulde dir noch <b>{euro(theyOwe.cents / 100)}</b>, überweis ich dir!</>
        : <>Zwischen uns ist alles ausgeglichen. 👍</>;
  } else {
    line = theirTodos.length
      ? <>Auf meiner Liste steht noch:</>
      : <>Ich hab gerade keine offenen To-dos. 🎉</>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-[72px] w-14 shrink-0 items-end justify-center"><AvatarFigure look={lookOf(target)} size={52} /></div>
        <div className="relative flex-1 rounded-2xl rounded-tl-sm border border-line bg-card p-3 text-[15px] leading-relaxed shadow-sm">
          <p className="mb-1 text-xs font-semibold" style={{ color: target.color }}>{target.display_name}</p>
          {line}
          {topic === "loben" && praiseable.length > 0 && (
            <div className="mt-3 space-y-2">
              {praiseable.map((p) => (
                <div key={p.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-line/30 px-3 py-2">
                  <span className="text-sm">{p.label}</span>
                  <span onClickCapture={() => onEmote("🐝", target.id)}>
                    <PraiseButton kind={p.kind} refId={p.refId} to={[target.id]} praises={praises} onChange={reloadPraises} />
                  </span>
                </div>
              ))}
            </div>
          )}
          {topic === "todos" && theirTodos.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-sm">
              {theirTodos.map((t) => <li key={t.id}>{t.title}{t.due_date && <span className="text-muted"> (bis {formatDate(t.due_date)})</span>}</li>)}
            </ul>
          )}
        </div>
      </div>

      <div className={`grid grid-cols-2 gap-2 ${isGuest || target.role === "gast" ? "hidden" : ""}`}>
        <Choice onClick={() => setTopic("loben")} active={topic === "loben"}>🐝 Loben</Choice>
        <Choice onClick={() => setTopic("geld")} active={topic === "geld"}>💶 Wer schuldet wem?</Choice>
        <Choice onClick={() => setTopic("todos")} active={topic === "todos"}>✅ Was steht an?</Choice>
        <Choice onClick={() => { onEmote("👋", target.id); onClose(); }}>👋 Winken & tschüss</Choice>
      </div>
      {/* Chatverlauf */}
      <div className="rounded-2xl border border-line bg-card/60">
        <div className="max-h-56 space-y-1.5 overflow-y-auto p-3">
          {chat.length === 0 && <p className="py-2 text-center text-xs text-muted">Noch keine Nachrichten. Schreib {target.display_name} etwas!</p>}
          {chat.map((m, i) => {
            const mine = m.from_member === myId;
            const day = new Date(m.created_at).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
            const prevDay = i > 0 ? new Date(chat[i - 1].created_at).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" }) : null;
            return (
              <div key={m.id}>
                {day !== prevDay && <p className="py-1 text-center text-[10px] font-medium uppercase tracking-wider text-muted">{day}</p>}
                <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${mine ? "rounded-br-sm bg-accent text-white" : "rounded-bl-sm text-white"}`}
                    style={mine ? undefined : { background: target.color }}>
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    <p className="mt-0.5 text-right text-[10px] opacity-75">
                      {new Date(m.created_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                      {mine && (m.read_at ? " ✓✓" : " ✓")}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={chatEnd} />
        </div>
        <form onSubmit={send} className="flex gap-2 border-t border-line p-2">
          <input value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500} placeholder={`Nachricht an ${target.display_name} …`}
            className="w-full rounded-xl border border-line bg-card px-3 py-2 text-base outline-none focus:border-accent" aria-label={`Nachricht an ${target.display_name}`} />
          <button disabled={sending || !msg.trim()} className="rounded-xl bg-accent px-4 font-medium text-white disabled:opacity-40" aria-label="Senden">➤</button>
        </form>
      </div>
      {!online && chat.length > 0 && <p className="-mt-2 text-xs text-muted">💤 {target.display_name} ist gerade nicht im Spiel und liest es beim nächsten Öffnen.</p>}
      {chatErr && <p className="-mt-2 text-sm text-red-600">{chatErr}</p>}
      <div className="flex justify-center gap-2">
        {["❤️", "😂", "🙏", "🍕", "☕"].map((e) => (
          <button key={e} onClick={() => onEmote(e, target.id)} title="Emote senden"
            className="rounded-full border border-line px-3 py-1.5 text-lg transition hover:bg-line/40 active:scale-90">{e}</button>
        ))}
      </div>
    </div>
  );
}

function Choice({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition active:scale-[.98] ${
        active ? "border-accent bg-accent/10 text-accent" : "border-line bg-card hover:bg-line/40"}`}>
      {children}
    </button>
  );
}
