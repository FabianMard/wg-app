import type { StoreId } from "./types";

/**
 * Märkte für die Einkaufsliste.
 * Eigene Logos: Bilddatei nach public/maerkte/ legen (z. B. rewe.png) und hier bei `logo` eintragen.
 */
export const STORES: { id: StoreId; label: string; bg: string; fg: string; short: string; logo?: string }[] = [
  { id: "hit",       label: "HIT",       bg: "#e30613", fg: "#ffffff", short: "HIT" },
  { id: "rewe",      label: "Rewe",      bg: "#cc071e", fg: "#ffffff", short: "REWE" },
  { id: "konsum",    label: "Konsum",    bg: "#00843d", fg: "#ffffff", short: "K" },
  { id: "baumarkt",  label: "Baumarkt",  bg: "#f59e0b", fg: "#ffffff", short: "🔨" },
  { id: "egal",      label: "Egal",      bg: "#94a3b8", fg: "#ffffff", short: "🛒" },
  { id: "sonstiges", label: "Sonstiges", bg: "#64748b", fg: "#ffffff", short: "📍" },
];

export const storeById = (id: StoreId) => STORES.find((s) => s.id === id) ?? STORES[4];

/** Startvorschläge, bis genug eigene Einkäufe da sind */
export const DEFAULT_SUGGESTIONS = [
  "Milch", "Brot", "Eier", "Butter", "Käse", "Nudeln", "Reis", "Kaffee",
  "Klopapier", "Küchenrolle", "Spülmittel", "Müllbeutel", "Waschmittel", "Zahnpasta",
];
