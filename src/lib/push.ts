import { supabase } from "./supabase";

/** Öffentlicher VAPID-Schlüssel (darf öffentlich sein; der private liegt nur auf Vercel) */
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "BLE36QcPepvr8b04GqQwSOSdP2-AjqQMbXreTT2UREyOA5p1bf5tTUwo1ZIMJF5EzcuRYfjVCYfptSql4-UcbrI";

export type PushArea = "putzplan" | "einkauf" | "kosten" | "freigabe" | "kalender" | "abstimmung" | "todos" | "pinnwand" | "watchlist" | "musik" | "chat";
export type PushMode = "aus" | "jeder" | "taeglich";

export const PUSH_AREAS: { id: PushArea; label: string; icon: string; url: string; hint: string }[] = [
  { id: "putzplan", label: "Putzplan & Bienchen", icon: "🧽", url: "/putzplan", hint: "Wenn jemand einen Dienst übernimmt oder er verfällt – und Bienchen für dich" },
  { id: "einkauf", label: "Einkaufsliste", icon: "🛒", url: "/einkauf", hint: "Neue Sachen auf der Liste" },
  { id: "kosten", label: "Kosten", icon: "💶", url: "/kosten", hint: "Neue Ausgaben" },
  { id: "freigabe", label: "Kosten-Freigaben", icon: "📝", url: "/kosten?tab=einreichen", hint: "Eingereichte Kosten & Entscheidungen" },
  { id: "kalender", label: "Kalender", icon: "📅", url: "/kalender", hint: "Neue Termine, die du sehen darfst" },
  { id: "abstimmung", label: "Abstimmungen", icon: "🗳️", url: "/kalender?tab=abstimmung", hint: "Neue Abstimmungen & Ergebnisse" },
  { id: "todos", label: "To-dos", icon: "✅", url: "/todos", hint: "Neue Aufgaben" },
  { id: "pinnwand", label: "Pinnwand", icon: "📌", url: "/pinnwand", hint: "Neue Zettel & Fotos" },
  { id: "watchlist", label: "Watchlist", icon: "📺", url: "/todos?tab=watchlist", hint: "Neue Filme & Serien" },
  { id: "musik", label: "Musik", icon: "🎵", url: "/todos?tab=musik", hint: "Neue Playlisten" },
  { id: "chat", label: "Chat", icon: "💬", url: "/spiel", hint: "Nachrichten an dich und im WG-Chat" },
];

/** Vorschlag beim Einschalten: Nachrichten an mich immer, alles andere 1× am Tag, Geburtstage morgens um 9 */
export const DEFAULT_PREFS: Record<PushArea, PushMode> & { geburtstag: PushMode; geburtstag_zeit: string } = {
  geburtstag: "taeglich", geburtstag_zeit: "09",
  putzplan: "jeder", einkauf: "taeglich", kosten: "taeglich", freigabe: "jeder", kalender: "taeglich", abstimmung: "jeder", todos: "taeglich",
  pinnwand: "taeglich", watchlist: "taeglich", musik: "taeglich", chat: "jeder",
};

/**
 * Nach einem neuen Eintrag die anderen benachrichtigen (je nach deren Einstellungen).
 * Läuft im Hintergrund – Fehler stören die App nicht.
 */
export function notify(area: PushArea | "test", text: string, opts: { to?: string[] | null } = {}) {
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ area, text: text.slice(0, 200), to: opts.to ?? null }),
        keepalive: true,
      });
    } catch { /* egal */ }
  })();
}

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** iPhone/iPad ohne "Zum Home-Bildschirm" → dort gibt es kein Push */
export const isIosBrowser = () =>
  typeof window !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !(window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone);

function keyBytes(base64: string) {
  const b = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
}

export async function swRegistration() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js");
}

/** Push auf diesem Gerät einschalten und Gerät speichern */
export async function enablePushOnDevice(memberId: string, householdId: string) {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied"
    ? "Benachrichtigungen sind für diese Seite blockiert. Bitte in den Browser-/Handy-Einstellungen erlauben."
    : "Benachrichtigungen wurden nicht erlaubt.");
  const reg = await swRegistration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert({
    endpoint: sub.endpoint, member_id: memberId, household_id: householdId, p256dh: j.keys?.p256dh, auth: j.keys?.auth,
  });
  if (error) throw new Error(error.message.includes("push_subscriptions") ? "Datenbank-Update fehlt: Bitte supabase/015_push.sql im SQL Editor ausführen." : error.message);
}

export async function disablePushOnDevice() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

export async function deviceHasPush() {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return !!(await reg?.pushManager.getSubscription());
}
