"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useWG } from "@/lib/wg";
import { GUEST_AREAS, type GuestArea, type Member } from "@/lib/types";
import { Avatar, btnCls, btnGhostCls, Card, DeleteButton, inputCls } from "./ui";

const GUEST_COLORS = ["#f97316", "#14b8a6", "#a855f7", "#eab308", "#06b6d4", "#84cc16", "#f43f5e", "#64748b"];

/** Gäste einladen und einzeln festlegen, was sie sehen dürfen */
export function GuestManager() {
  const { guests, everyone, refresh } = useWG();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const linkOf = (g: Member) => `${window.location.origin}/?gast=${g.guest_code}`;

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setErr(null);
    const color = GUEST_COLORS.find((c) => !everyone.some((m) => m.color === c)) ?? GUEST_COLORS[0];
    const { error } = await supabase.rpc("create_guest", {
      p_name: name.trim(), p_color: color, p_permissions: { kalender: true, pinnwand: true, watchlist: true },
    });
    if (error) {
      setErr(error.message.includes("create_guest") ? "Datenbank-Update fehlt: Bitte supabase/012_gaeste_kalender_watchlist.sql ausführen." : error.message);
      return;
    }
    setName("");
    await refresh();
  }
  async function toggle(g: Member, area: GuestArea) {
    const permissions = { ...(g.permissions ?? {}), [area]: !g.permissions?.[area] };
    const { error } = await supabase.from("members").update({ permissions }).eq("id", g.id);
    if (error) setErr(error.message);
    await refresh();
  }
  async function remove(g: Member) {
    if (!confirm(`Gast ${g.display_name} entfernen? Der Link funktioniert dann nicht mehr.`)) return;
    await supabase.from("members").delete().eq("id", g.id);
    await refresh();
  }
  async function share(g: Member) {
    const url = linkOf(g);
    if (navigator.share) {
      try { await navigator.share({ title: "WG-Einladung", text: `Hey ${g.display_name}, komm als Gast in unsere WG-App:`, url }); return; } catch { return; }
    }
    await navigator.clipboard.writeText(url);
    setCopied(g.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Gäste bekommen einen eigenen Link, laufen im Spiel mit herum und sehen nur, was du hier freigibst.
        Putzplan, Einkauf, Kosten und To-dos bleiben immer privat.
      </p>
      {guests.map((g) => (
        <Card key={g.id} className="space-y-3">
          <div className="flex items-center gap-3">
            <Avatar member={g} size={32} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{g.display_name}</p>
              <p className="text-xs text-muted">{g.user_id ? "✓ hat den Link geöffnet" : "Link noch nicht geöffnet"}</p>
            </div>
            <DeleteButton onClick={() => remove(g)} label="Gast entfernen" />
          </div>
          <div className="flex flex-wrap gap-2">
            {GUEST_AREAS.map((a) => {
              const on = !!g.permissions?.[a.id];
              return (
                <button key={a.id} onClick={() => toggle(g, a.id)} role="switch" aria-checked={on}
                  className={`rounded-full border px-3 py-1 text-sm font-medium transition ${on ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "border-line text-muted line-through"}`}>
                  {a.icon} {a.label}
                </button>
              );
            })}
          </div>
          {g.guest_code && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-line/40 px-2 py-1.5 text-xs">{linkOf(g)}</code>
              <button onClick={() => share(g)} className={btnGhostCls}>{copied === g.id ? "Kopiert ✓" : "📤 Link teilen"}</button>
            </div>
          )}
        </Card>
      ))}
      <form onSubmit={invite} className="flex gap-2">
        <input className={inputCls} placeholder="Name des Gastes, z. B. Oma Gisela" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
        <button className={btnCls}>Einladen</button>
      </form>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
