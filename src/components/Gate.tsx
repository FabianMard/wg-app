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

type Preview = { name: string; members: { user_id: string; display_name: string; color: string }[] };

/** Stellt sicher, dass dieses Gerät eine (anonyme) Sitzung hat. */
async function ensureSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw new Error(error.message.includes("Anonymous")
      ? "Anonyme Anmeldung ist in Supabase noch nicht aktiviert (Authentication → Sign In / Providers)."
      : error.message);
  }
}

function Setup() {
  const { refresh } = useWGState();
  const [code, setCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null | "invalid">(null);
  const [name, setName] = useState("");
  const [wgName, setWgName] = useState("");
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
    supabase.rpc("household_preview", { p_code: code }).then(({ data, error }) => {
      if (error) setErr(error.message.includes("household_preview")
        ? "Datenbank-Update fehlt: Bitte supabase/002_link_join.sql ausführen." : error.message);
      setPreview(data ?? "invalid");
    });
  }, [code]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setErr(null);
    try {
      await ensureSession();
      const { error } = await fn();
      if (error) throw new Error(error.message);
      window.history.replaceState(null, "", "/");
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => supabase.rpc("join_household", { p_code: code, p_display_name: name.trim() }));
  };
  const claim = (m: Preview["members"][number]) => {
    if (!confirm(`Bist du ${m.display_name}? Dieses Gerät übernimmt dann deine Aufgaben und deinen Kontostand.`)) return;
    run(() => supabase.rpc("claim_member", { p_code: code, p_user_id: m.user_id }));
  };
  const create = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => supabase.rpc("create_household", { p_name: wgName.trim(), p_display_name: name.trim() }));
  };

  // ── Mit Einladungslink ──
  if (code) {
    if (preview === null) return <Centered><p className="text-center text-muted">Lädt …</p>{err && <ErrorText>{err}</ErrorText>}</Centered>;
    if (preview === "invalid") {
      return (
        <Centered>
          <Card>
            <p className="font-semibold">Dieser Einladungslink ist ungültig.</p>
            <p className="mt-1 text-sm text-muted">Frag in deiner WG nach dem aktuellen Link.</p>
            <button className={`${btnCls} mt-4 w-full`} onClick={() => { setCode(null); window.history.replaceState(null, "", "/"); }}>Neue WG gründen</button>
            {err && <ErrorText>{err}</ErrorText>}
          </Card>
        </Centered>
      );
    }
    return (
      <Centered>
        <Card className="space-y-5">
          <div className="text-center">
            <p className="text-sm text-muted">Du wurdest eingeladen in</p>
            <p className="text-xl font-bold">{preview.name}</p>
          </div>
          <form onSubmit={join} className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="name">Wie heißt du?</label>
            <input id="name" className={inputCls} placeholder="Dein Name" value={name} autoFocus
              onChange={(e) => setName(e.target.value)} required maxLength={30} />
            <button className={`${btnCls} w-full`} disabled={busy || !name.trim()}>Mitbewohner werden</button>
          </form>
          {preview.members.length > 0 && (
            <div>
              <p className="mb-2 text-sm text-muted">Schon dabei, aber neues Handy oder Browser? Tipp auf deinen Namen:</p>
              <div className="flex flex-wrap gap-2">
                {preview.members.map((m) => (
                  <button key={m.user_id} onClick={() => claim(m)} disabled={busy}
                    className="flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 text-sm font-medium transition hover:bg-line/40">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: m.color }}>
                      {m.display_name.slice(0, 1).toUpperCase()}
                    </span>
                    {m.display_name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {err && <ErrorText>{err}</ErrorText>}
        </Card>
      </Centered>
    );
  }

  // ── Ohne Link: WG gründen oder Code eingeben ──
  return (
    <Centered>
      <Card className="space-y-5">
        <form onSubmit={create} className="space-y-2">
          <span className="block text-sm font-medium">Neue WG gründen</span>
          <input className={inputCls} placeholder="Dein Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={30} />
          <input className={inputCls} placeholder="Name der WG, z. B. Kastanienallee 12" value={wgName}
            onChange={(e) => setWgName(e.target.value)} required />
          <button className={`${btnCls} w-full`} disabled={busy}>WG gründen</button>
        </form>
        <div className="flex items-center gap-3 text-xs text-muted"><hr className="flex-1 border-line" />oder<hr className="flex-1 border-line" /></div>
        <form onSubmit={(e) => { e.preventDefault(); setCode(manualCode.trim().toUpperCase()); }} className="space-y-2">
          <span className="block text-sm font-medium">Einladungscode eingeben</span>
          <div className="flex gap-2">
            <input className={`${inputCls} uppercase tracking-widest`} placeholder="ABC123" value={manualCode}
              onChange={(e) => setManualCode(e.target.value)} required />
            <button className={btnCls}>Weiter</button>
          </div>
        </form>
        {err && <ErrorText>{err}</ErrorText>}
      </Card>
    </Centered>
  );
}

const ErrorText = ({ children }: { children: React.ReactNode }) => <p className="mt-3 text-sm text-red-600">{children}</p>;
