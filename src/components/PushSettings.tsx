"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useWG } from "@/lib/wg";
import {
  DEFAULT_PREFS, deviceHasPush, disablePushOnDevice, enablePushOnDevice, isIosBrowser, notify,
  PUSH_AREAS, pushSupported, type PushArea, type PushMode,
} from "@/lib/push";
import { btnCls, btnGhostCls, Card } from "@/components/ui";

const MODES: { id: PushMode; label: string }[] = [
  { id: "aus", label: "Aus" },
  { id: "taeglich", label: "1× am Tag" },
  { id: "jeder", label: "Jeder Eintrag" },
];

/** Jede*r entscheidet selbst: auf welchem Gerät, wofür und wie oft */
export function PushSettings() {
  const { household, myId } = useWG();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [onDevice, setOnDevice] = useState(false);
  type Prefs = Record<PushArea, PushMode> & { geburtstag?: PushMode; geburtstag_zeit?: string };
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setSupported(pushSupported());
    setIosHint(isIosBrowser());
    deviceHasPush().then(setOnDevice).catch(() => {});
    fetch("/api/push").then((r) => r.json()).then((d) => setConfigured(!!d.configured)).catch(() => setConfigured(null));
    supabase.from("push_prefs").select("prefs").eq("member_id", myId).maybeSingle().then(({ data }) => {
      setPrefs(data ? { ...Object.fromEntries(PUSH_AREAS.map((a) => [a.id, "aus"])), ...(data.prefs as object) } as Prefs : null);
    });
  }, [myId]);

  async function savePrefs(next: Prefs) {
    setPrefs(next);
    const { error } = await supabase.from("push_prefs").upsert({ member_id: myId, prefs: next, updated_at: new Date().toISOString() });
    if (error) setMsg({ ok: false, text: error.message.includes("push_prefs") ? "Datenbank-Update fehlt: Bitte supabase/015_push.sql im SQL Editor ausführen." : error.message });
  }

  async function enable() {
    setMsg(null); setBusy(true);
    try {
      await enablePushOnDevice(myId, household.id);
      setOnDevice(true);
      if (!prefs) await savePrefs(DEFAULT_PREFS);
      setMsg({ ok: true, text: "Push ist auf diesem Gerät an. Unten kannst du einstellen, wofür." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }
  async function disable() {
    setMsg(null); setBusy(true);
    try { await disablePushOnDevice(); setOnDevice(false); setMsg({ ok: true, text: "Auf diesem Gerät kommen keine Push-Nachrichten mehr." }); }
    finally { setBusy(false); }
  }

  if (supported === null) return null;

  return (
    <Card className="space-y-4">
      {!supported ? (
        <p className="text-sm text-muted">
          {iosHint
            ? <>Auf dem iPhone gehen Push-Nachrichten nur, wenn die App auf dem Home-Bildschirm liegt: in Safari <b>Teilen ⬆️ → „Zum Home-Bildschirm“</b>, dann die App von dort öffnen und hier einschalten.</>
            : "Dieser Browser kann leider keine Push-Nachrichten empfangen."}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-sm font-medium ${onDevice ? "text-green-700 dark:text-green-400" : "text-muted"}`}>
            {onDevice ? "🔔 Auf diesem Gerät an" : "🔕 Auf diesem Gerät aus"}
          </span>
          <div className="ml-auto flex gap-2">
            {onDevice && <button className={btnGhostCls} disabled={busy} onClick={() => { setMsg(null); notify("test", ""); setMsg({ ok: true, text: "Test-Nachricht geschickt – sie sollte gleich erscheinen." }); }}>Testen</button>}
            {onDevice
              ? <button className={btnGhostCls} disabled={busy} onClick={disable}>Ausschalten</button>
              : <button className={btnCls} disabled={busy} onClick={enable}>🔔 Einschalten</button>}
          </div>
        </div>
      )}
      {configured === false && (
        <p className="rounded-xl bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
          Versand ist noch nicht eingerichtet: In Vercel fehlt die Umgebungsvariable <b>VAPID_PRIVATE_KEY</b>.
        </p>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>{msg.text}</p>}

      {prefs && (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Wofür willst du benachrichtigt werden? <b>1× am Tag</b> = nur beim ersten neuen Eintrag des Tages. Eigene Einträge lösen nie eine Nachricht aus.
          </p>
          {PUSH_AREAS.map((a) => (
            <div key={a.id}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{a.icon} {a.label}</span>
                <span className="truncate text-[11px] text-muted">{a.hint}</span>
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-line/50 p-1 text-xs font-semibold">
                {MODES.map((m) => (
                  <button key={m.id} onClick={() => savePrefs({ ...prefs, [a.id]: m.id })}
                    className={`rounded-lg py-1.5 transition ${prefs[a.id] === m.id ? (m.id === "aus" ? "bg-card shadow-sm" : "bg-accent text-white shadow-sm") : "text-muted"}`}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* Geburtstage: keine Einträge, sondern Erinnerung am Tag selbst – zur gewünschten Uhrzeit */}
          <div className="border-t border-line pt-3">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">🎂 Geburtstage</span>
              <span className="truncate text-[11px] text-muted">Erinnerung am Geburtstag</span>
            </div>
            <div className="flex gap-2">
              <div className="grid flex-1 grid-cols-2 gap-1 rounded-xl bg-line/50 p-1 text-xs font-semibold">
                {(["aus", "taeglich"] as PushMode[]).map((m) => (
                  <button key={m} onClick={() => savePrefs({ ...prefs, geburtstag: m, geburtstag_zeit: prefs.geburtstag_zeit ?? "09" })}
                    className={`rounded-lg py-1.5 transition ${(prefs.geburtstag ?? "aus") === m ? (m === "aus" ? "bg-card shadow-sm" : "bg-accent text-white shadow-sm") : "text-muted"}`}>
                    {m === "aus" ? "Nie" : "1× am Tag"}
                  </button>
                ))}
              </div>
              {prefs.geburtstag === "taeglich" && (
                <label className="flex shrink-0 items-center gap-1 rounded-xl border border-line bg-bg px-2 text-sm">
                  🕐
                  <select aria-label="Uhrzeit der Geburtstags-Erinnerung" className="bg-transparent py-1.5 text-base font-semibold outline-none"
                    value={prefs.geburtstag_zeit ?? "09"} onChange={(e) => savePrefs({ ...prefs, geburtstag_zeit: e.target.value })}>
                    {Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")).map((h) => <option key={h} value={h}>{h}:00 Uhr</option>)}
                  </select>
                </label>
              )}
            </div>
            {prefs.geburtstag === "taeglich" && <p className="mt-1 text-[11px] text-muted">Am Geburtstag um {prefs.geburtstag_zeit ?? "09"}:00 Uhr – auch für Geburtstage, die nur du sehen kannst.</p>}
          </div>
          {!onDevice && supported && <p className="text-xs text-muted">Damit etwas ankommt, Push oben auf diesem Gerät einschalten.</p>}
        </div>
      )}
    </Card>
  );
}
