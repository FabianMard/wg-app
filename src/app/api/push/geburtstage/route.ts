import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { normalizeSupabaseUrl } from "@/lib/supabase";
import { VAPID_PUBLIC_KEY } from "@/lib/push";

export const runtime = "nodejs";

/**
 * Wird jede volle Stunde vom Supabase-Zeitplan (pg_cron) aufgerufen.
 * Die Datenbank entscheidet, wer jetzt an einen Geburtstag erinnert werden will –
 * dafür muss der geheime Schlüssel aus der Datenbank mitgeschickt werden.
 */
export async function POST(req: Request) {
  const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  if (!PRIVATE_KEY) return Response.json({ error: "VAPID_PRIVATE_KEY fehlt" }, { status: 503 });
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return Response.json({ error: "Nicht erlaubt" }, { status: 401 });

  const sb = createClient(normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.rpc("birthday_push_due", { p_secret: secret });
  if (error) return Response.json({ error: "Nicht erlaubt" }, { status: 401 });

  const targets = (data ?? []) as { endpoint: string; p256dh: string; auth: string; body: string }[];
  webpush.setVapidDetails("https://wg-app-iota.vercel.app", VAPID_PUBLIC_KEY, PRIVATE_KEY);
  const results = await Promise.allSettled(targets.map((t) =>
    webpush.sendNotification(
      { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
      JSON.stringify({ title: "🎂 Geburtstag", body: t.body, url: "/kalender", tag: "geburtstag" }),
      { TTL: 60 * 60 * 12 },
    )));
  return Response.json({ sent: results.filter((r) => r.status === "fulfilled").length, failed: results.filter((r) => r.status === "rejected").length });
}
