"use client";

import { useEffect, useState } from "react";
import { isConfigured, supabase } from "@/lib/supabase";
import { useWGState } from "@/lib/wg";
import { BottomNav, guestMayOpen, Header } from "./Nav";
import { NewsProvider } from "@/lib/news";
import { cleanupPhotos } from "@/lib/backup";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useWG } from "@/lib/wg";
import { btnCls, Card, inputCls } from "./ui";

export function Gate({ children }: { children: React.ReactNode }) {
  const { state } = useWGState();

  if (!isConfigured) return <NotConfigured />;
  if (state.status === "loading") {
    return <div className="flex min-h-dvh items-center justify-center text-muted">Lädt …</div>;
  }
  if (state.status === "signed-out" || state.status === "no-household") return <Setup />;

  return (
    <NewsProvider>
      <WeeklyCleanup />
      <Header />
      <main className="mx-auto max-w-3xl px-4 pb-28 pt-6 md:pb-12"><GuestGuard>{children}</GuestGuard></main>
      <BottomNav />
    </NewsProvider>
  );
}

/** Gäste sehen nur freigegebene Seiten (die Datenbank sperrt den Rest zusätzlich) */
function GuestGuard({ children }: { children: React.ReactNode }) {
  const { isGuest, can } = useWG();
  const path = usePathname();
  if (!isGuest || guestMayOpen(path, can)) return <>{children}</>;
  return (
    <Card className="mt-6 text-center">
      <p className="text-4xl">🔒</p>
      <p className="mt-2 font-semibold">Dieser Bereich ist nur für Mitbewohner.</p>
      <Link href="/" className={`${btnCls} mt-4`}>Zur Startseite</Link>
    </Card>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-5xl">🏠</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">WG-App</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

function NotConfigured() {
  return (
    <Centered>
      <Card>
        <p className="font-semibold">Supabase ist noch nicht verbunden.</p>
        <p className="mt-2 text-sm text-muted">
          Lege eine Datei <code>.env.local</code> mit <code>NEXT_PUBLIC_SUPABASE_URL</code> und{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> an (siehe README) und starte den Server neu.
        </p>
      </Card>
    </Centered>
  );
}

type PreviewMember = { id: string; display_name: string; color: string; claimed: boolean };
type Preview = { name: string; members: PreviewMember[] };

/** Stellt sicher, dass dieses Gerät eine (anonyme) Sitzung hat. */
async function ensureSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw new Error(error.message.toLowerCase().includes("anonymous")
      ? "Anonyme Anmeldung ist in Supabase noch nicht aktiviert (Authentication → Sign In / Providers)."
      : error.message);
  }
}

/**
 * Code bereinigen: nur Buchstaben/Ziffern, Großbuchstaben.
 * Die Codes bestehen nur aus 0-9 und A-F, daher sind O→0 und I/L→1 sichere Korrekturen.
 * Fängt z. B. einen von WhatsApp angehängten Punkt oder Tippfehler ab.
 */
export function normalizeCode(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** Gast-Link: https://…/?gast=GABC1234 */
function GuestJoin({ code }: { code: string }) {
  const { refresh } = useWGState();
  const [info, setInfo] = useState<{ wg: string; name: string; color: string } | null | "invalid">(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.rpc("guest_preview", { p_code: code }).then(({ data, error }) => {
      if (error) setErr(error.message);
      setInfo(data ?? "invalid");
    });
  }, [code]);
  async function join() {
    setBusy(true);
    setErr(null);
    try {
      await ensureSession();
      const { error } = await supabase.rpc("claim_guest", { p_code: code });
      if (error) throw new Error(error.message);
      window.history.replaceState(null, "", "/");
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (info === null) return <Centered><p className="text-center text-muted">Lädt …</p>{err && <ErrorText>{err}</ErrorText>}</Centered>;
  if (info === "invalid") {
    return <Centered><Card><p className="font-semibold">Dieser Gast-Link ist nicht (mehr) gültig.</p><p className="mt-1 text-sm text-muted">Frag in der WG nach einem neuen Link.</p>{err && <ErrorText>{err}</ErrorText>}</Card></Centered>;
  }
  return (
    <Centered>
      <Card className="space-y-4 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-2xl font-bold text-white" style={{ background: info.color }}>
          {info.name.slice(0, 1).toUpperCase()}
        </span>
        <p>Hallo <b>{info.name}</b>! 👋<br />Du bist als Gast in <b>{info.wg}</b> eingeladen.</p>
        <button onClick={join} disabled={busy} className={`${btnCls} w-full`}>Als Gast beitreten</button>
        {err && <ErrorText>{err}</ErrorText>}
      </Card>
    </Centered>
  );
}

function Setup() {
  const [guestCode] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("gast")));
  if (guestCode) return <GuestJoin code={guestCode.trim().toUpperCase()} />;
  return <ResidentSetup />;
}

function ResidentSetup() {
  const { refresh } = useWGState();
  const [code, setCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null | "invalid" | "error">(null);
  const [rawCode, setRawCode] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [manualCode, setManualCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Einladungscode aus dem Link lesen: https://…/?code=ABC123
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    if (c) { setRawCode(c); setCode(normalizeCode(c)); }
  }, []);

  useEffect(() => {
    if (!code) return;
    setPreview(null);
    setErr(null);
    supabase.rpc("household_preview", { p_code: code }).then(({ data, error }) => {
      if (error) {
        // Verbindungs-/Serverfehler sind etwas anderes als ein falscher Code
        setErr(error.message.includes("household_preview")
          ? "Datenbank fehlt: Bitte supabase/schema.sql im SQL Editor ausführen." : error.message);
        setPreview("error");
        return;
      }
      setPreview(data ?? "invalid");
    }, (e: unknown) => { setErr(e instanceof Error ? e.message : String(e)); setPreview("error"); });
  }, [code, attempt]);

  async function claim(m: PreviewMember) {
    if (m.claimed && !confirm(`${m.display_name} ist schon auf einem anderen Gerät angemeldet.\n\nNeues Handy? Dann übernimmt dieses Gerät.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await ensureSession();
      const { error } = await supabase.rpc("claim_member", { p_code: code, p_member_id: m.id });
      if (error) throw new Error(error.message);
      window.history.replaceState(null, "", "/");
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!code) {
    return (
      <Centered>
        <Card>
          <form onSubmit={(e) => { e.preventDefault(); setRawCode(manualCode); setCode(normalizeCode(manualCode)); }} className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="code">Einladungscode</label>
            <p className="text-sm text-muted">Öffne den Einladungslink aus eurer WG-Gruppe oder gib den Code ein.</p>
            <div className="flex gap-2">
              <input id="code" className={`${inputCls} uppercase tracking-widest`} placeholder="ABC123" value={manualCode}
                onChange={(e) => setManualCode(e.target.value)} required />
              <button className={btnCls}>Weiter</button>
            </div>
          </form>
        </Card>
      </Centered>
    );
  }

  if (preview === null) {
    return <Centered><p className="text-center text-muted">Lädt …</p>{err && <ErrorText>{err}</ErrorText>}</Centered>;
  }

  if (preview === "error") {
    return (
      <Centered>
        <Card>
          <p className="font-semibold">Keine Verbindung zur WG-Datenbank.</p>
          <p className="mt-1 text-sm text-muted">Prüf deine Internetverbindung und versuch es nochmal.</p>
          {err && <p className="mt-2 break-words rounded-lg bg-line/40 px-2 py-1 font-mono text-xs text-muted">{err}</p>}
          <button className={`${btnCls} mt-4 w-full`} onClick={() => setAttempt((a) => a + 1)}>Nochmal versuchen</button>
        </Card>
      </Centered>
    );
  }

  if (preview === "invalid") {
    return (
      <Centered>
        <Card>
          <p className="font-semibold">Diesen Einladungscode gibt es nicht.</p>
          <p className="mt-1 text-sm text-muted">
            Geprüft: <b className="font-mono tracking-widest text-fg">{code || "–"}</b>
            {rawCode && normalizeCode(rawCode) !== rawCode.trim().toUpperCase() && <> (eingegeben: „{rawCode}“)</>}
          </p>
          <p className="mt-1 text-sm text-muted">Tipp den Code nochmal ein oder frag in deiner WG nach dem aktuellen Link.</p>
          <form onSubmit={(e) => { e.preventDefault(); setRawCode(manualCode); setCode(normalizeCode(manualCode)); }} className="mt-4 flex gap-2">
            <input className={`${inputCls} uppercase tracking-widest`} placeholder="ABC123" value={manualCode}
              onChange={(e) => setManualCode(e.target.value)} required aria-label="Einladungscode" />
            <button className={btnCls}>Prüfen</button>
          </form>
        </Card>
      </Centered>
    );
  }

  return (
    <Centered>
      <Card>
        <p className="text-center text-sm text-muted">Willkommen in</p>
        <p className="text-center text-xl font-bold">{preview.name}</p>
        <p className="mb-3 mt-5 text-center font-medium">Wer bist du?</p>
        <div className="space-y-2">
          {preview.members.map((m) => (
            <button key={m.id} onClick={() => claim(m)} disabled={busy}
              className="flex w-full items-center gap-3 rounded-2xl border border-line p-3 text-left transition hover:border-accent/50 hover:bg-accent/5 active:scale-[.99] disabled:opacity-50">
              <span className="flex h-11 w-11 items-center justify-center rounded-full text-lg font-semibold text-white" style={{ background: m.color }}>
                {m.display_name.slice(0, 1).toUpperCase()}
              </span>
              <span className="flex-1 text-lg font-medium">{m.display_name}</span>
              {m.claimed && <span className="text-xs text-muted">schon angemeldet</span>}
            </button>
          ))}
        </div>
        {err && <ErrorText>{err}</ErrorText>}
      </Card>
    </Centered>
  );
}

const ErrorText = ({ children }: { children: React.ReactNode }) => <p className="mt-3 text-sm text-red-600">{children}</p>;

/** Einmal pro Woche (je Gerät) verwaiste Fotos löschen – nur Mitbewohner, da Gäste nicht alle Daten sehen */
function WeeklyCleanup() {
  const { household, isGuest } = useWG();
  useEffect(() => {
    if (isGuest) return;
    const KEY = "wg-letztes-aufraeumen";
    let last = 0;
    try { last = Number(localStorage.getItem(KEY) ?? 0); } catch { /* egal */ }
    if (Date.now() - last < 7 * 86_400_000) return;
    const t = setTimeout(() => {
      cleanupPhotos(household.id).then(() => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* egal */ } }).catch(() => {});
    }, 8000); // nicht beim Start bremsen
    return () => clearTimeout(t);
  }, [household.id, isGuest]);
  return null;
}
