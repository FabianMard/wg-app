"use client";

import { useState } from "react";
import { useRows, useWG } from "@/lib/wg";
import type { ChoreArea, ChoreCheck, ChoreOverride, ChoreTask, Expense, Member, Message, Praise, Todo } from "@/lib/types";
import { areaStatuses, currentPeriod, isOverdue, phaseOf } from "@/lib/cleaning";
import { computeBalances, suggestTransfers } from "@/lib/balances";
import { euro, formatDate } from "@/lib/dates";
import { AvatarFigure, lookOf } from "./avatar";
import { beesOf, GiveBee, PraiseButton } from "@/components/Praise";

type Topic = "hallo" | "loben" | "geld" | "todos";

const GREETINGS = [
  "Hey {me}! Na, alles klar?",
  "Oh, hi {me}! Was gibt's?",
  "Moin {me}! 👋",
  "Na {me}, auch auf dem Weg zur Küche?",
];

export function TalkDialog({ target, online, onEmote, onOpenChat, onClose }: {
  target: Member;
  online: boolean;
  onEmote: (emoji: string, targetId?: string) => void;
  onOpenChat: () => void;
  onClose: () => void;
}) {
  const { me, myId, members, household, isGuest } = useWG();
  const { rows: areas } = useRows<ChoreArea>("chore_areas", "sort");
  const { rows: tasks } = useRows<ChoreTask>("chore_tasks", "sort");
  const { rows: checks } = useRows<ChoreCheck>("chore_checks", "done_at");
  const { rows: overrides } = useRows<ChoreOverride>("chore_overrides", "created_at");
  const { rows: praises, reload: reloadPraises } = useRows<Praise>("praises", "created_at");
  const { rows: todos } = useRows<Todo>("todos", "created_at", false);
  const { rows: expenses } = useRows<Expense>("expenses", "created_at");
  const [topic, setTopic] = useState<Topic>("hallo");
  // Chat-Vorschau: letzte Nachricht + Ungelesene – der eigentliche Chat öffnet sich im Vollbild
  const { rows: allMessages } = useRows<Message>("messages", "created_at");
  const chat = allMessages.filter((m) =>
    (m.from_member === myId && m.to_member === target.id) || (m.from_member === target.id && m.to_member === myId));
  const lastMsg = chat[chat.length - 1];
  const unread = chat.filter((m) => m.from_member === target.id && !m.read_at).length;

  const [greeting] = useState(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
  const period = currentPeriod(household.cleaning_start);
  const current = areaStatuses(areas, tasks, checks, members, period, overrides);
  const previous = period > 0 ? areaStatuses(areas, tasks, checks, members, period - 1, overrides) : [];
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
          ? myArea.skipped
            ? <>Mein Putzdienst {myArea.area.icon} <b>{myArea.area.name}</b> fällt diese Runde aus.</>
            : myArea.done
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
    line = <>Oh, danke! Wofür willst du mich loben? 🐝</>;
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
          {topic === "loben" && (
            <div className="mt-3">
              <GiveBee fixedTo={target.id} onGiven={() => { reloadPraises(); onEmote("🐝", target.id); }} />
            </div>
          )}
          {topic === "loben" && praiseable.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium text-muted">Oder für etwas, das ich erledigt habe:</p>
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
      {/* Chat: Vorschau + Knopf (Vollbild-Chat ist übersichtlicher) */}
      <button onClick={onOpenChat}
        className="flex w-full items-center gap-3 rounded-2xl border border-line bg-card px-3 py-2.5 text-left transition hover:bg-line/40 active:scale-[.99]">
        <span className="text-2xl">💬</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Chat mit {target.display_name}{unread > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-xs text-white">{unread} neu</span>}</span>
          <span className="block truncate text-xs text-muted">{lastMsg ? `${lastMsg.from_member === myId ? "Du: " : ""}${lastMsg.text}` : `Schreib ${target.display_name} etwas …`}</span>
        </span>
        <span className="text-muted">›</span>
      </button>
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
