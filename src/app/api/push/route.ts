import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { normalizeSupabaseUrl } from "@/lib/supabase";
import { PUSH_AREAS, VAPID_PUBLIC_KEY, type PushArea } from "@/lib/push";

export const runtime = "nodejs";

const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

/** Ist das Versenden eingerichtet? (für die Einstellungen-Seite) */
export function GET() {
  return Response.json({ configured: !!PRIVATE_KEY });
}

/**
 * Benachrichtigt die anderen über einen neuen Eintrag.
 * Wer was bekommt, entscheidet die Datenbank (push_targets) anhand der Einstellungen jeder Person –
 * aufgerufen mit dem Login der Person, die eingetragen hat.
 */
export async function POST(req: Request) {
  if (!PRIVATE_KEY) return Response.json({ error: "VAPID_PRIVATE_KEY fehlt" }, { status: 503 });
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });

  let body: { area?: string; text?: string; to?: string[] | null };
  try { body = await req.json(); } catch { return Response.json({ error: "Ungültig" }, { status: 400 }); }
  const area = body.area as PushArea | "test";
  const info = PUSH_AREAS.find((a) => a.id === area);
  if (!info && area !== "test") return Response.json({ error: "Unbekannter Bereich" }, { status: 400 });

  const sb = createClient(normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const to = Array.isArray(body.to) && body.to.length ? body.to.slice(0, 50) : null;
  const { data, error } = await sb.rpc("push_targets", { p_area: area, p_to: to });
  if (error) return Response.json({ error: error.message }, { status: 400 });

  const targets = (data ?? []) as { endpoint: string; p256dh: string; auth: string; sender: string }[];
  if (!targets.length) return Response.json({ sent: 0 });

  webpush.setVapidDetails("https://wg-app-iota.vercel.app", VAPID_PUBLIC_KEY, PRIVATE_KEY);
  const sender = targets[0].sender;
  const text = String(body.text ?? "").slice(0, 200);
  const payload = JSON.stringify(area === "test"
    ? { title: "🔔 WG-App", body: "Test: Push-Nachrichten funktionieren auf diesem Gerät! 🎉", url: "/wg", tag: "test" }
    : { title: `${info!.icon} ${info!.label}`, body: text ? `${sender}: ${text}` : `${sender} hat etwas eingetragen`, url: info!.url, tag: area });

  const gone: string[] = [];
  const results = await Promise.allSettled(targets.map((t) =>
    webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, { TTL: 60 * 60 * 24 })
      .catch((e: { statusCode?: number }) => { if (e.statusCode === 404 || e.statusCode === 410) gone.push(t.endpoint); throw e; })));
  if (gone.length) await sb.rpc("drop_push_subs", { p_endpoints: gone });
  return Response.json({ sent: results.filter((r) => r.status === "fulfilled").length, failed: results.filter((r) => r.status === "rejected").length });
}
