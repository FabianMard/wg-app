"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { Praise } from "@/lib/types";
import { beesOf } from "@/components/Praise";
import { Avatar, btnCls, btnGhostCls, Card, inputCls, PageTitle, SectionTitle } from "@/components/ui";

// Gut unterscheidbare Farben, die auch mit weißer Schrift lesbar sind
const MEMBER_COLORS = [
  "#ef4444", "#f97316", "#d97706", "#65a30d", "#10b981", "#14b8a6",
  "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#d946ef", "#ec4899",
  "#be123c", "#78716c", "#334155",
];

export default function WGSettings() {
  const { household, members, myId, me, refresh } = useWG();
  const [colorErr, setColorErr] = useState<string | null>(null);
  const [myColor, setMyColor] = useState<string | null>(null); // sofort anzeigen

  async function pickColor(c: string) {
    setColorErr(null);
    setMyColor(c);
    const { error } = await supabase.from("members").update({ color: c }).eq("id", myId);
    if (error) { setMyColor(null); setColorErr(error.message); return; }
    await refresh();
    setMyColor(null);
  }
  const { rows: praises } = useRows<Praise>("praises", "created_at");
  const [name, setName] = useState(household.name);
  const [copied, setCopied] = useState(false);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await supabase.from("households").update({ name: name.trim() }).eq("id", household.id);
    refresh();
  }
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/?code=${household.invite_code}`;

  async function copy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  async function share() {
    if (navigator.share) {
      await navigator.share({ title: household.name, text: `Komm in unsere WG-App „${household.name}“:`, url: link }).catch(() => {});
    } else {
      copy();
    }
  }
  async function signOut() {
    if (!confirm("Auf diesem Gerät abmelden? Du kommst jederzeit über den Einladungslink zurück, indem du auf deinen Namen tippst.")) return;
    await supabase.auth.signOut();
  }

  return (
    <>
      <PageTitle>{household.name}</PageTitle>

      <Card>
        <p className="font-semibold">Mitbewohner einladen</p>
        <p className="mt-1 text-sm text-muted">
          Wer diesen Link hat, kann sich ohne Anmeldung als Mitbewohner eintragen. Teilt ihn nur in eurer WG-Gruppe.
        </p>
        <p className="mt-3 break-all rounded-xl bg-line/40 px-3 py-2 font-mono text-sm">{link}</p>
        <div className="mt-3 flex gap-2">
          <button onClick={share} className={btnCls}>Link teilen</button>
          <button onClick={copy} className={btnGhostCls}>{copied ? "Kopiert ✓" : "Kopieren"}</button>
        </div>
        <p className="mt-3 text-xs text-muted">Code zum Eintippen: <b className="font-mono tracking-widest">{household.invite_code}</b></p>
      </Card>

      <SectionTitle>Deine Farbe</SectionTitle>
      <Card>
        <p className="mb-3 text-sm text-muted">So erscheinst du überall in der App: Kreis, Kalender-Balken, Putzplan.</p>
        <div className="flex flex-wrap gap-2.5">
          {MEMBER_COLORS.map((c) => {
            const current = (myColor ?? me?.color) === c;
            const takenBy = members.find((m) => m.id !== myId && m.color === c);
            return (
              <button key={c} onClick={() => !takenBy && !current && pickColor(c)} disabled={!!takenBy}
                title={takenBy ? `Schon vergeben an ${takenBy.display_name}` : c}
                aria-label={takenBy ? `Farbe vergeben an ${takenBy.display_name}` : `Farbe ${c} wählen`}
                className={`relative flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white transition active:scale-90
                  ${current ? "ring-[3px] ring-accent ring-offset-2 ring-offset-card" : ""} ${takenBy ? "cursor-not-allowed opacity-35" : "hover:scale-110"}`}
                style={{ background: c }}>
                {current ? "✓" : takenBy ? takenBy.display_name.slice(0, 1) : ""}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted">Blasse Farben mit Buchstaben sind schon vergeben.</p>
        {colorErr && <p className="mt-2 text-sm text-red-600">{colorErr}</p>}
      </Card>

      <SectionTitle>Mitbewohner ({members.length})</SectionTitle>
      <Card className="divide-y divide-line p-0">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar member={m} />
            <span className="flex-1">{m.display_name}{m.id === myId && <span className="text-muted"> (du)</span>}</span>
            {!m.user_id && <span className="text-xs text-muted">noch nicht dabei</span>}
            <span className="text-sm font-medium">🐝 {beesOf(praises, m.id)}</span>
          </div>
        ))}
      </Card>

      <SectionTitle>Name der WG</SectionTitle>
      <form onSubmit={saveName} className="flex gap-2">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        <button className={btnCls}>Speichern</button>
      </form>

      <div className="mt-8 flex flex-wrap gap-2">
        <button onClick={signOut} className={btnGhostCls}>Auf diesem Gerät abmelden</button>
      </div>
    </>
  );
}
