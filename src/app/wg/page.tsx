"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useWG } from "@/lib/wg";
import { Avatar, btnCls, btnGhostCls, Card, inputCls, PageTitle, SectionTitle } from "@/components/ui";

export default function WGSettings() {
  const { household, members, me, userId, refresh } = useWG();
  const [name, setName] = useState(me?.display_name ?? "");
  const [copied, setCopied] = useState(false);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await supabase.from("members").update({ display_name: name.trim() }).eq("user_id", userId);
    refresh();
  }
  async function copy() {
    await navigator.clipboard.writeText(household.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  async function leave() {
    if (!confirm("WG wirklich verlassen?")) return;
    await supabase.from("members").delete().eq("user_id", userId);
    refresh();
  }

  return (
    <>
      <PageTitle>{household.name}</PageTitle>

      <Card>
        <p className="text-sm text-muted">Einladungscode für neue Mitbewohner</p>
        <div className="mt-1 flex items-center gap-3">
          <span className="font-mono text-3xl font-bold tracking-[.25em]">{household.invite_code}</span>
          <button onClick={copy} className={btnGhostCls}>{copied ? "Kopiert ✓" : "Kopieren"}</button>
        </div>
      </Card>

      <SectionTitle>Mitbewohner ({members.length})</SectionTitle>
      <Card className="divide-y divide-line p-0">
        {members.map((m) => (
          <div key={m.user_id} className="flex items-center gap-3 px-4 py-3">
            <Avatar member={m} />
            <span>{m.display_name}{m.user_id === userId && <span className="text-muted"> (du)</span>}</span>
          </div>
        ))}
      </Card>

      <SectionTitle>Dein Name</SectionTitle>
      <form onSubmit={saveName} className="flex gap-2">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        <button className={btnCls}>Speichern</button>
      </form>

      <div className="mt-8 flex flex-wrap gap-2">
        <button onClick={() => supabase.auth.signOut()} className={btnGhostCls}>Abmelden</button>
        <button onClick={leave} className={`${btnGhostCls} text-red-600`}>WG verlassen</button>
      </div>
    </>
  );
}
