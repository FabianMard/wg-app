import { createClient } from "@supabase/supabase-js";

/**
 * Supabase zeigt die Projekt-URL an manchen Stellen mit "/rest/v1/" an.
 * Wird sie so eingetragen, schlägt jede Anfrage fehl ("Invalid path specified in request URL").
 * Darum hier auf "https://<projekt>.supabase.co" kürzen.
 */
export function normalizeSupabaseUrl(raw: string | undefined) {
  if (!raw) return raw;
  return raw.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "").replace(/\/(rest|auth|realtime|storage)\/v1$/i, "");
}

const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const isConfigured = Boolean(url && key);

// Platzhalter, damit der Build auch ohne .env.local durchläuft
export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  key || "placeholder-key",
);
