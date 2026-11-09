"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import { notify } from "@/lib/push";
import type { Member, Message } from "@/lib/types";
import { AvatarFigure, lookOf } from "./avatar";

/**
 * WG-Chat: Übersicht aller Unterhaltungen + Unterhaltung im Vollbild.
 * Funktioniert von überall im Spiel – man muss nicht neben der Person stehen.
 * Nachrichten sind privat (nur Absender und Empfänger können sie lesen).
 */

const QUICK = ["👍", "Bin gleich da!", "Hast du Hunger? 🍕", "Danke! 🙏", "😂"];
const time = (iso: string) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
function dayLabel(iso: string) {
  const d = new Date(iso), today = new Date(), y = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Heute";
  if (same(d, y)) return "Gestern";
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
}
/** Kurze Zeit für die Übersicht: heute → Uhrzeit, sonst Datum */
const shortWhen = (iso: string) => (dayLabel(iso) === "Heute" ? time(iso) : dayLabel(iso));

export function ChatPanel({ initialWith, online, onSent }: {
  initialWith?: string;
  online: Set<string>;
  onSent?: () => void;            // z. B. „💬“-Blase im Spiel zeigen (ohne Inhalt – Chats sind privat)
}) {
  const { everyone, myId } = useWG();
  const { rows: messages, loaded, reload } = useRows<Message>("messages", "created_at");
  const [withId, setWithId] = useState<string | null>(initialWith ?? null);
  const people = everyone.filter((m) => m.id !== myId);
  const partner = people.find((m) => m.id === withId) ?? null;

  if (partner) {
    return <Conversation partner={partner} online={online.has(partner.id)} messages={messages} reload={reload}
      onBack={() => setWithId(null)} onSent={onSent} />;
  }

  // Übersicht: wer zuletzt geschrieben hat, steht oben
  const rows = people.map((p) => {
    const conv = messages.filter((m) => (m.from_member === myId && m.to_member === p.id) || (m.from_member === p.id && m.to_member === myId));
    const last = conv[conv.length - 1];
    const unread = conv.filter((m) => m.from_member === p.id && !m.read_at).length;
    return { p, last, unread };
  }).sort((a, b) => (b.last?.created_at ?? "").localeCompare(a.last?.created_at ?? "") || a.p.sort - b.p.sort);

  return (
    <div className="space-y-1">
      <p className="px-1 pb-2 text-sm text-muted">Schreib allen in der WG – egal, wo ihr gerade im Spiel seid. 🔒 Nur ihr beide könnt den Chat lesen.</p>
      {loaded && rows.map(({ p, last, unread }) => (
        <button key={p.id} onClick={() => setWithId(p.id)}
          className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition hover:bg-line/40 active:scale-[.99]">
          <span className="relative flex h-12 w-12 shrink-0 items-end justify-center overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${p.color} 22%, transparent)` }}>
            <AvatarFigure look={lookOf(p)} size={36} />
            {online.has(p.id) && <span className="absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full border-2 border-bg bg-green-500" title="Gerade im Spiel" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate font-semibold">{p.display_name}{p.role === "gast" && <span className="ml-1 text-xs font-normal text-muted">(Gast)</span>}</span>
              {last && <span className={`shrink-0 text-xs ${unread ? "font-semibold text-accent" : "text-muted"}`}>{shortWhen(last.created_at)}</span>}
            </span>
            <span className="flex items-center justify-between gap-2">
              <span className={`truncate text-sm ${unread ? "font-medium text-fg" : "text-muted"}`}>
                {last ? <>{last.from_member === myId && <span className="text-muted">Du: </span>}{last.text}</> : <i>Noch keine Nachrichten</i>}
              </span>
              {unread > 0 && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">{unread}</span>}
            </span>
          </span>
        </button>
      ))}
      {loaded && rows.length === 0 && <p className="py-6 text-center text-sm text-muted">Noch niemand da zum Schreiben.</p>}
    </div>
  );
}

function Conversation({ partner, online, messages, reload, onBack, onSent }: {
  partner: Member; online: boolean; messages: Message[]; reload: () => void; onBack: () => void; onSent?: () => void;
}) {
  const { myId, household } = useWG();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chat = useMemo(() => messages.filter((m) =>
    (m.from_member === myId && m.to_member === partner.id) || (m.from_member === partner.id && m.to_member === myId)), [messages, myId, partner.id]);

  // immer ans Ende scrollen, wenn etwas Neues kommt
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [chat.length]);
  // Ungelesenes als gelesen markieren
  const unreadIds = chat.filter((m) => m.from_member === partner.id && !m.read_at).map((m) => m.id).join(",");
  useEffect(() => {
    if (!unreadIds) return;
    supabase.from("messages").update({ read_at: new Date().toISOString() }).in("id", unreadIds.split(",")).then(() => reload());
  }, [unreadIds, reload]);

  async function send(raw: string) {
    const t = raw.trim().slice(0, 500);
    if (!t || sending) return;
    setErr(null); setSending(true);
    const { error } = await supabase.from("messages").insert({ household_id: household.id, to_member: partner.id, text: t });
    setSending(false);
    if (error) {
      setErr(error.message.includes("messages") ? "Datenbank-Update fehlt: Bitte supabase/010_chat.sql im SQL Editor ausführen." : error.message);
      return;
    }
    notify("chat", t, { to: [partner.id] });
    onSent?.();
    setText("");
    reload();
    inputRef.current?.focus();
  }

  return (
    <div className="-mx-4 -mb-8 -mt-4 flex h-[78dvh] flex-col">
      {/* Kopf */}
      <div className="flex items-center gap-3 border-b border-line px-3 py-2">
        <button onClick={onBack} className="rounded-full px-2 py-1 text-xl hover:bg-line/50" aria-label="Zurück zur Übersicht">←</button>
        <span className="relative flex h-10 w-10 shrink-0 items-end justify-center overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${partner.color} 22%, transparent)` }}>
          <AvatarFigure look={lookOf(partner)} size={30} />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{partner.display_name}</p>
          <p className={`text-xs ${online ? "text-green-600" : "text-muted"}`}>{online ? "● gerade im Spiel" : "liest es beim nächsten Öffnen"}</p>
        </div>
      </div>

      {/* Verlauf */}
      <div className="flex-1 space-y-1 overflow-y-auto px-3 py-3" style={{ background: "color-mix(in srgb, var(--line) 25%, transparent)" }}>
        {chat.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted">
            <AvatarFigure look={lookOf(partner)} size={56} />
            Schreib {partner.display_name} die erste Nachricht! 👋
          </div>
        )}
        {chat.map((m, i) => {
          const mine = m.from_member === myId;
          const prev = chat[i - 1];
          const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
          const grouped = !newDay && prev && prev.from_member === m.from_member && (new Date(m.created_at).getTime() - new Date(prev.created_at).getTime()) < 3 * 60_000;
          return (
            <div key={m.id}>
              {newDay && <p className="my-2 text-center"><span className="rounded-full bg-card px-3 py-0.5 text-[11px] font-medium text-muted shadow-sm">{dayLabel(m.created_at)}</span></p>}
              <div className={`flex ${mine ? "justify-end" : "justify-start"} ${grouped ? "" : "pt-1.5"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-[15px] shadow-sm ${mine ? "rounded-br-md bg-accent text-white" : "rounded-bl-md bg-card text-fg"}`}>
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  <p className={`mt-0.5 text-right text-[10px] ${mine ? "text-white/75" : "text-muted"}`}>
                    {time(m.created_at)}{mine && <span title={m.read_at ? "Gelesen" : "Zugestellt"}>{m.read_at ? " ✓✓" : " ✓"}</span>}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Schnellantworten + Eingabe */}
      <div className="border-t border-line bg-bg px-3 pb-3 pt-2">
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
          {QUICK.map((q) => (
            <button key={q} onClick={() => send(q)} disabled={sending}
              className="shrink-0 rounded-full border border-line bg-card px-3 py-1 text-sm transition hover:bg-line/40 active:scale-95">{q}</button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex items-end gap-2">
          <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={1}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }}
            placeholder={`Nachricht an ${partner.display_name} …`} aria-label={`Nachricht an ${partner.display_name}`}
            className="max-h-28 min-h-[44px] w-full resize-none rounded-2xl border border-line bg-card px-3 py-2.5 text-base outline-none focus:border-accent"
            style={{ fieldSizing: "content" } as React.CSSProperties} />
          <button disabled={sending || !text.trim()} aria-label="Senden"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-lg text-white transition active:scale-90 disabled:opacity-40">➤</button>
        </form>
        {err && <p className="mt-1 text-sm text-red-600">{err}</p>}
      </div>
    </div>
  );
}
