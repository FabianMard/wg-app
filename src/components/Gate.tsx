"use client";

import { useState } from "react";
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
  if (state.status === "signed-out") return <Login />;
  if (state.status === "no-household") return <Setup />;

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

function Login() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) return setMsg(error.message);
    if (mode === "signup" && !data.session) setMsg("Fast geschafft: Bitte bestätige deine E-Mail-Adresse über den Link im Postfach.");
  }

  return (
    <Centered>
      <Card>
        <div className="mb-4 grid grid-cols-2 rounded-xl bg-line/50 p-1 text-sm font-medium">
          {(["login", "signup"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`rounded-lg py-1.5 transition ${mode === m ? "bg-card shadow-sm" : "text-muted"}`}>
              {m === "login" ? "Anmelden" : "Registrieren"}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input className={inputCls} type="email" placeholder="E-Mail" autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className={inputCls} type="password" placeholder="Passwort (min. 6 Zeichen)" minLength={6}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className={`${btnCls} w-full`} disabled={busy}>
            {mode === "login" ? "Anmelden" : "Konto erstellen"}
          </button>
          {msg && <p className="text-sm text-muted">{msg}</p>}
        </form>
      </Card>
    </Centered>
  );
}

function Setup() {
  const { refresh } = useWGState();
  const [name, setName] = useState("");
  const [wgName, setWgName] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("create_household", { p_name: wgName, p_display_name: name });
    if (error) return setErr(error.message);
    refresh();
  }
  async function join(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("join_household", { p_code: code, p_display_name: name });
    if (error) return setErr(error.message);
    refresh();
  }

  return (
    <Centered>
      <Card className="space-y-5">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Wie heißt du?</span>
          <input className={inputCls} placeholder="Dein Name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <form onSubmit={create} className="space-y-2">
          <span className="block text-sm font-medium">Neue WG gründen</span>
          <input className={inputCls} placeholder="Name der WG, z. B. Kastanienallee 12" value={wgName}
            onChange={(e) => setWgName(e.target.value)} required />
          <button className={`${btnCls} w-full`} disabled={!name.trim()}>WG gründen</button>
        </form>
        <div className="flex items-center gap-3 text-xs text-muted"><hr className="flex-1 border-line" />oder<hr className="flex-1 border-line" /></div>
        <form onSubmit={join} className="space-y-2">
          <span className="block text-sm font-medium">Einer WG beitreten</span>
          <input className={`${inputCls} uppercase tracking-widest`} placeholder="Einladungscode" value={code}
            onChange={(e) => setCode(e.target.value)} required />
          <button className={`${btnCls} w-full`} disabled={!name.trim()}>Beitreten</button>
        </form>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </Card>
    </Centered>
  );
}
