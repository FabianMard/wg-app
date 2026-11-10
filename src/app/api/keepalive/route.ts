import { normalizeSupabaseUrl } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hält das Supabase-Projekt wach: Gratis-Projekte werden nach ca. einer Woche ohne Anfragen pausiert.
 * Wird von Vercel automatisch aufgerufen (vercel.json → crons, montags und donnerstags).
 * Stellt eine echte, harmlose Anfrage an Datenbank und Anmeldedienst – liest dabei keine Daten.
 */
export async function GET() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ ok: false, error: "Supabase nicht eingerichtet" }, { status: 500 });
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const started = Date.now();
  const [db, auth] = await Promise.all([
    // Ohne Anmeldung liefert das wegen der Zugriffsregeln keine Zeilen – zählt aber als Datenbank-Anfrage
    fetch(`${url}/rest/v1/households?select=id&limit=1`, { headers, cache: "no-store" }).then((r) => r.status).catch(() => 0),
    fetch(`${url}/auth/v1/health`, { headers, cache: "no-store" }).then((r) => r.status).catch(() => 0),
  ]);
  const ok = db === 200;
  return Response.json({ ok, datenbank: db, anmeldung: auth, ms: Date.now() - started, zeit: new Date().toISOString() }, { status: ok ? 200 : 502 });
}
