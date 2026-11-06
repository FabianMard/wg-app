"use client";

import { useEffect, useState } from "react";
import { isConfigured, supabase } from "@/lib/supabase";
import { useWGState } from "@/lib/wg";
import { BottomNav, Header } from "./Nav";
import { btnCls, Card, inputCls } from "./ui";

export function Gate({ children }: { children: React.ReactNode }) {
  const { state } = useWGState();

  if (!isConfigured) return <NotConfigured />;
  if (state.status === "loading") {
    return <div className="flex min-h-dvh items-center justify-center text-muted">Lädt …</div>;
  }
  if (state.status === "signed-out" || state.status === "no-household") return <Setup />;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 pb-28 pt-6 md:pb-12">{children}</main>
      <BottomNav />
    </>
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

function Setup() {
  const { refresh } = useWGState();
  const [code, setCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null | "invalid">(null);
  const [manualCode, setManualCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Einladungscode aus dem Link lesen: https://…/?code=ABC123
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    if (c) setCode(c.toUpperCase());
  }, []);

  useEffect(() => {
    if (!code) return;
    setPreview(null);
    supabase.rpc("household_preview", { p_code: code }).then(({ data, error }) => {
      if (error) setErr(error.message.includes("household_preview")
        ? "Datenbank fehlt: Bitte supabase/schema.sql im SQL Editor ausführen." : error.message);
      setPreview(data ?? "invalid");
    });
  }, [code]);

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
          <form onSubmit={(e) => { e.preventDefault(); setCode(manualCode.trim().toUpperCase()); }} className="space-y-2">
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

  if (preview === "invalid") {
    return (
      <Centered>
        <Card>
          <p className="font-semibold">Dieser Einladungscode ist ungültig.</p>
          <p className="mt-1 text-sm text-muted">Frag in deiner WG nach dem aktuellen Link.</p>
          <button className={`${btnCls} mt-4 w-full`} onClick={() => { setCode(null); window.history.replaceState(null, "", "/"); }}>
            Anderen Code eingeben
          </button>
          {err && <ErrorText>{err}</ErrorText>}
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
