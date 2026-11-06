"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { Praise } from "@/lib/types";
import { beesOf } from "@/components/Praise";
import { Avatar, btnCls, btnGhostCls, Card, inputCls, PageTitle, SectionTitle } from "@/components/ui";

export default function WGSettings() {
  const { household, members, myId, refresh } = useWG();
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
