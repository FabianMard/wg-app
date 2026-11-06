"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

// ───────────── Auswahl ─────────────
export const SKINS = ["#fbe0cf", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#5c3a21"];
export const HAIR_COLORS = ["#2b2118", "#5a3825", "#a0522d", "#d6a354", "#f2d16b", "#c0c0c0", "#e2588b", "#4f7cff", "#38b48b"];
export const CLOTH_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#10b981", "#14b8a6", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#1f2937", "#9ca3af", "#fafafa"];
export const PANTS_COLORS = ["#1f2937", "#4b5563", "#1e3a8a", "#3b82f6", "#78350f", "#a3a3a3", "#065f46", "#ec4899", "#f5f5f4"];
export const SHOE_COLORS = ["#3f3f46", "#fafafa", "#ef4444", "#78350f", "#3b82f6", "#f59e0b"];

export const HAIRS = {
  kurz: "Kurz", lang: "Lang", zerzaust: "Zerzaust lang", zopf: "Zopf", dutt: "Dutt",
  locken: "Locken", goldlocke: "Locken + Goldlocke", iro: "Iro", glatze: "Glatze",
} as const;
export const TOPS = { tshirt: "T-Shirt", pulli: "Pulli", hoodie: "Hoodie", streifen: "Ringelshirt", jacke: "Jacke", kleid: "Kleid", bademantel: "Bademantel", tanktop: "Bauchfrei-Top" } as const;
export const SOCKS = { keine: "Keine", weiss: "Weiß", gruenblau: "Grün & Blau" } as const;
export const BOTTOMS = { hose: "Hose", jeans: "Jeans", shorts: "Shorts", adidas: "Adidas-Hose" } as const;
export const ACCS = {
  keins: "Nichts", brille: "Brille", sonnenbrille: "Sonnenbrille", cap: "Cap", muetze: "Mütze",
  kopfhoerer: "Kopfhörer", schleife: "Schleife", krone: "Krone", blume: "Blume", schal: "Schal",
} as const;

export type AvatarLook = {
  skin: string;
  hair: keyof typeof HAIRS;
  hairColor: string;
  top: keyof typeof TOPS;
  topColor: string;
  pants: string;
  /** Hosenart (ältere gespeicherte Looks haben das noch nicht → "hose") */
  bottom?: keyof typeof BOTTOMS;
  socks?: keyof typeof SOCKS;
  shoes: string;
  acc: keyof typeof ACCS;
  accColor: string;
};

/** Startaussehen, abgeleitet von der Farbe des Mitbewohners */
export function defaultLook(m: Pick<Member, "color" | "sort">): AvatarLook {
  return {
    skin: SKINS[(m.sort ?? 0) % 3],
    hair: (["lang", "kurz", "locken"] as const)[(m.sort ?? 0) % 3],
    hairColor: HAIR_COLORS[(m.sort ?? 0) + 1] ?? HAIR_COLORS[0],
    top: "tshirt",
    topColor: m.color,
    pants: PANTS_COLORS[2],
    shoes: SHOE_COLORS[1],
    acc: "keins",
    accColor: "#f59e0b",
  };
}

export const lookOf = (m: Member): AvatarLook => ({ ...defaultLook(m), ...(m.avatar ?? {}) });

/**
 * Jeder Kleiderschrank hat ein eigenes Sortiment (Index = members.sort).
 * Alle Schränke sind für alle offen – man kann sich bei den anderen etwas ausleihen.
 */
type Top = keyof typeof TOPS;
type Bottom = keyof typeof BOTTOMS;
type Acc = keyof typeof ACCS;
type Sock = keyof typeof SOCKS;
export const WARDROBES: { tops: Top[]; bottoms: Bottom[]; socks: Sock[]; accs: Acc[] }[] = [
  { tops: ["tanktop", "kleid", "bademantel", "pulli", "streifen", "tshirt"], bottoms: ["adidas", "jeans", "hose", "shorts"], socks: ["gruenblau", "weiss", "keine"], accs: ["keins", "blume", "schleife", "sonnenbrille", "krone", "schal"] },
  { tops: ["hoodie", "tshirt", "jacke", "pulli"], bottoms: ["jeans", "shorts", "hose"], socks: ["weiss", "keine"], accs: ["keins", "kopfhoerer", "cap", "muetze", "sonnenbrille"] },
  { tops: ["tshirt", "streifen", "hoodie", "jacke"], bottoms: ["hose", "shorts", "jeans"], socks: ["weiss", "keine"], accs: ["keins", "brille", "cap", "schal", "muetze"] },
];
const ALL_WARDROBE = { tops: Object.keys(TOPS) as Top[], bottoms: Object.keys(BOTTOMS) as Bottom[], socks: Object.keys(SOCKS) as Sock[], accs: Object.keys(ACCS) as Acc[] };
export const wardrobeOf = (sort: number) => WARDROBES[sort] ?? ALL_WARDROBE;

export function randomLook(): AvatarLook {
  const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
  return {
    skin: pick(SKINS), hair: pick(Object.keys(HAIRS) as AvatarLook["hair"][]), hairColor: pick(HAIR_COLORS),
    top: pick(Object.keys(TOPS) as AvatarLook["top"][]), topColor: pick(CLOTH_COLORS), pants: pick(PANTS_COLORS),
    bottom: pick(Object.keys(BOTTOMS) as Bottom[]), socks: pick(Object.keys(SOCKS) as Sock[]),
    shoes: pick(SHOE_COLORS), acc: pick(Object.keys(ACCS) as AvatarLook["acc"][]), accColor: pick(CLOTH_COLORS),
  };
}

/** Farbe abdunkeln (amount < 0) oder aufhellen (amount > 0) */
function shade(hex: string, amount: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// ───────────── Figur ─────────────
export function AvatarFigure({ look, size = 40, flip = false, className = "" }: {
  look: AvatarLook; size?: number; flip?: boolean; className?: string;
}) {
  const { skin, hair, hairColor, top, topColor, pants, shoes, acc, accColor } = look;
  const bottom = look.bottom ?? "hose";
  const topDark = shade(topColor, -0.22);
  const hairDark = shade(hairColor, -0.2);
  const longSleeves = top !== "tshirt" && top !== "kleid" && top !== "tanktop";
  const socks = look.socks ?? "keine";
  const sleeve = longSleeves ? topColor : skin;

  return (
    <svg viewBox="0 0 32 40" width={size} height={size * 1.25} className={className}
      style={{ transform: flip ? "scaleX(-1)" : undefined, overflow: "visible" }} aria-hidden>
      <ellipse cx="16" cy="38.3" rx="8.5" ry="1.8" fill="rgba(0,0,0,.2)" />

      {/* Haare hinten */}
      {hair === "lang" && <rect x="7.2" y="7" width="17.6" height="15.5" rx="7" fill={hairDark} />}
      {hair === "zopf" && <><circle cx="24.6" cy="15" r="2.6" fill={hairDark} /><circle cx="25.4" cy="19" r="2.1" fill={hairDark} /></>}
      {hair === "zerzaust" && (
        <path d="M8 7 C5.8 10 6.6 13 5.6 15.6 L7.6 15 L6.2 19.6 L8.8 18.2 L8 22.8 L10.6 20.4 L11.4 23.6 L13 21 L16 22.8 L19 21 L20.6 23.6 L21.4 20.4 L24 22.8 L23.2 18.2 L25.8 19.6 L24.4 15 L26.4 15.6 C25.4 13 26.2 10 24 7 Z" fill={hairDark} />
      )}

      {/* Beine & Schuhe */}
      {bottom === "shorts" ? <>
        <rect x="11.6" y="30" width="3.2" height="6" rx="1.4" fill={skin} />
        <rect x="17.2" y="30" width="3.2" height="6" rx="1.4" fill={skin} />
        <rect x="11" y="27.5" width="4.4" height="4.2" rx="1.4" fill={pants} />
        <rect x="16.6" y="27.5" width="4.4" height="4.2" rx="1.4" fill={pants} />
      </> : <>
        <rect x="11.2" y="27.5" width="4" height="8.5" rx="1.6" fill={pants} />
        <rect x="16.8" y="27.5" width="4" height="8.5" rx="1.6" fill={pants} />
      </>}
      {bottom === "adidas" && <g fill="#fff">
        {/* drei Streifen außen an jedem Bein */}
        <rect x="11.4" y="28.2" width=".3" height="7.4" /><rect x="11.9" y="28.2" width=".3" height="7.4" /><rect x="12.4" y="28.2" width=".3" height="7.4" />
        <rect x="19.3" y="28.2" width=".3" height="7.4" /><rect x="19.8" y="28.2" width=".3" height="7.4" /><rect x="20.3" y="28.2" width=".3" height="7.4" />
      </g>}
      {bottom === "jeans" && <g stroke="#f59e0b" strokeWidth=".3" fill="none" opacity=".9">
        <line x1="13.2" y1="28.4" x2="13.2" y2="35.6" /><line x1="18.8" y1="28.4" x2="18.8" y2="35.6" />
        <path d="M11.6 29.4 h2.4 M17.9 29.4 h2.4" />
      </g>}
      {socks !== "keine" && <>
        <rect x="11.2" y="33" width="4" height="2.2" rx=".6" fill={socks === "gruenblau" ? "#22c55e" : "#f5f5f4"} stroke="rgba(0,0,0,.12)" strokeWidth=".25" />
        <rect x="16.8" y="33" width="4" height="2.2" rx=".6" fill={socks === "gruenblau" ? "#3b82f6" : "#f5f5f4"} stroke="rgba(0,0,0,.12)" strokeWidth=".25" />
      </>}
      <rect x="10.4" y="34.6" width="5.4" height="2.6" rx="1.3" fill={shoes} stroke="rgba(0,0,0,.15)" strokeWidth=".4" />
      <rect x="16.2" y="34.6" width="5.4" height="2.6" rx="1.3" fill={shoes} stroke="rgba(0,0,0,.15)" strokeWidth=".4" />

      {/* Arme */}
      <rect x="6.6" y="18.6" width="3.8" height="9.2" rx="1.9" fill={sleeve} />
      <rect x="21.6" y="18.6" width="3.8" height="9.2" rx="1.9" fill={sleeve} />
      {top === "tshirt" && <><rect x="6.4" y="18.4" width="4.2" height="4" rx="1.6" fill={topColor} /><rect x="21.4" y="18.4" width="4.2" height="4" rx="1.6" fill={topColor} /></>}
      <circle cx="8.5" cy="28.4" r="1.8" fill={skin} />
      <circle cx="23.5" cy="28.4" r="1.8" fill={skin} />

      {/* Oberkörper */}
      {top === "tanktop" && <>
        <rect x="9.8" y="17.6" width="12.4" height="10.6" rx="3" fill={skin} />
        <circle cx="16" cy="25.6" r=".38" fill={shade(skin, -0.3)} />
        <rect x="11.1" y="17.3" width="1.5" height="2.4" rx=".6" fill={topColor} />
        <rect x="19.4" y="17.3" width="1.5" height="2.4" rx=".6" fill={topColor} />
        <path d="M9.8 19.2 Q16 21.4 22.2 19.2 L22.2 22.4 Q16 23.6 9.8 22.4 Z" fill={topColor} />
      </>}
      {top === "tanktop" ? null : top === "kleid"
        ? <path d="M10.4 18 H21.6 L24.6 31 Q16 33 7.4 31 Z" fill={topColor} />
        : top === "bademantel"
          ? <path d="M9.4 17.6 H22.6 Q23.6 18 23.8 20 L24.2 34 Q16 35.4 7.8 34 L8.2 20 Q8.4 18 9.4 17.6 Z" fill={topColor} />
          : <rect x="9.6" y="17.6" width="12.8" height="11.6" rx="3.2" fill={topColor} />}
      {top === "bademantel" && <>
        {/* Revers, Gürtel mit Schleife, Frottee-Saum */}
        <path d="M13.2 17.7 L16 23 L18.8 17.7" stroke={shade(topColor, 0.45)} strokeWidth="1.6" fill="none" />
        <path d="M16 23 L16.4 34.6" stroke={topDark} strokeWidth=".5" />
        <rect x="8.4" y="24.2" width="15.2" height="1.5" rx=".7" fill={topDark} />
        <path d="M16.6 25.6 l-1 3.2 M17.2 25.6 l1.2 3" stroke={topDark} strokeWidth=".9" strokeLinecap="round" />
        <path d="M8 33.6 Q16 35 24 33.6" stroke={shade(topColor, 0.45)} strokeWidth=".9" fill="none" />
      </>}
      {top === "streifen" && <><rect x="9.6" y="21" width="12.8" height="1.6" fill="#fff" opacity=".85" /><rect x="9.6" y="24.6" width="12.8" height="1.6" fill="#fff" opacity=".85" /></>}
      {top === "hoodie" && <>
        <path d="M11 17.6 Q16 21.5 21 17.6" stroke={topDark} strokeWidth="1.6" fill="none" />
        <rect x="12.3" y="24" width="7.4" height="3.2" rx="1.2" fill={topDark} />
        <line x1="14.6" y1="19" x2="14.6" y2="22" stroke="#fff" strokeWidth=".6" />
        <line x1="17.4" y1="19" x2="17.4" y2="22" stroke="#fff" strokeWidth=".6" />
      </>}
      {top === "jacke" && <>
        <rect x="14.4" y="17.8" width="3.2" height="11.2" fill="#f5f5f4" />
        <path d="M14.4 17.8 L12.6 22 L14.4 23 Z M17.6 17.8 L19.4 22 L17.6 23 Z" fill={topDark} />
      </>}
      {top === "pulli" && <path d="M12.6 17.8 Q16 20 19.4 17.8" stroke={topDark} strokeWidth="1.2" fill="none" />}
      {top === "kleid" && <path d="M10.4 22 Q16 23.4 21.6 22" stroke={topDark} strokeWidth=".9" fill="none" />}

      {/* Hals & Kopf */}
      <rect x="14.5" y="16" width="3" height="2.6" fill={skin} />
      <circle cx="8.6" cy="12.4" r="1.5" fill={skin} />
      <circle cx="23.4" cy="12.4" r="1.5" fill={skin} />
      <circle cx="16" cy="11.6" r="7.6" fill={skin} />
      <circle cx="11.6" cy="14.4" r="1.3" fill="#f472b6" opacity=".35" />
      <circle cx="20.4" cy="14.4" r="1.3" fill="#f472b6" opacity=".35" />
      <circle cx="13.2" cy="12.4" r="1.05" fill="#1f2937" />
      <circle cx="18.8" cy="12.4" r="1.05" fill="#1f2937" />
      <circle cx="13.5" cy="12" r=".35" fill="#fff" />
      <circle cx="19.1" cy="12" r=".35" fill="#fff" />
      <path d="M14.6 15.2 Q16 16.4 17.4 15.2" stroke="#7c2d12" strokeWidth=".8" fill="none" strokeLinecap="round" />

      {/* Haare vorne */}
      {(hair === "kurz" || hair === "lang" || hair === "zopf" || hair === "dutt") && (
        <path d="M7.6 13.2 C7.2 6.4 10.8 3 16 3 C21.2 3 24.8 6.4 24.4 13.2 C23.4 10.6 21.8 9.3 19.8 9 C18.2 10 15.2 10.3 12.4 9.4 C10.4 9.9 8.6 11.3 7.6 13.2 Z" fill={hairColor} />
      )}
      {hair === "dutt" && <circle cx="16" cy="2.6" r="2.9" fill={hairColor} />}
      {hair === "zerzaust" && <>
        <path d="M7.4 13.4 C6.8 6 10.6 2.6 16 2.6 C21.4 2.6 25.2 6 24.6 13.4 L23.4 10.6 L22.6 12.2 L21.4 9.2 L20 10.9 L18.8 8.8 L17.2 10.5 L16 8.6 L14.6 10.5 L13.2 8.8 L12 10.9 L10.6 9.2 L9.4 12.2 L8.6 10.6 Z" fill={hairColor} />
        <path d="M12.2 3.4 l-1.8 -1.7 M16.6 2.7 l.8 -2.1 M20.4 3.8 l2.1 -1.1 M9 6.4 l-1.9 -.4" stroke={hairColor} strokeWidth=".9" strokeLinecap="round" />
      </>}
      {(hair === "locken" || hair === "goldlocke") && [[9.4, 9.2], [11.2, 6.2], [14.2, 4.6], [17.8, 4.6], [20.8, 6.2], [22.6, 9.2], [16, 6.4]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="2.7" fill={hairColor} />
      ))}
      {hair === "goldlocke" && <g>
        {/* goldene Locke: Strähne fällt in die Stirn und rollt sich ein */}
        <path d="M15.2 5.6 C17.9 6.8 18.3 9.6 16.6 10.6 C15.3 11.4 14.1 10.4 14.7 9.3 C15.1 8.6 16.1 8.8 16.1 9.5"
          stroke="#eab308" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M15.6 6.1 C17.4 7 17.7 8.8 16.9 9.8" stroke="#fde68a" strokeWidth=".5" fill="none" strokeLinecap="round" />
      </g>}
      {hair === "iro" && <>
        <path d="M8.2 11.4 C8.2 6 11.6 4 16 4 C20.4 4 23.8 6 23.8 11.4 C21 8.6 11 8.6 8.2 11.4 Z" fill={hairColor} opacity=".22" />
        <rect x="14.2" y="0.8" width="3.6" height="8.6" rx="1.8" fill={hairColor} />
      </>}
      {hair === "glatze" && <ellipse cx="13" cy="6.4" rx="2" ry="1" fill="#fff" opacity=".35" />}

      {/* Accessoires */}
      {acc === "brille" && <g stroke="#1f2937" strokeWidth=".7" fill="none">
        <circle cx="13.2" cy="12.4" r="2.1" /><circle cx="18.8" cy="12.4" r="2.1" /><line x1="15.3" y1="12.2" x2="16.7" y2="12.2" />
      </g>}
      {acc === "sonnenbrille" && <g fill="#111827">
        <rect x="10.8" y="11" width="4.6" height="3" rx="1.2" /><rect x="16.6" y="11" width="4.6" height="3" rx="1.2" />
        <rect x="15.2" y="11.6" width="1.6" height=".7" />
      </g>}
      {acc === "cap" && <g>
        <path d="M7.6 11 C7.4 4.6 11.2 2.4 16 2.4 C20.8 2.4 24.6 4.6 24.4 11 Z" fill={accColor} />
        <ellipse cx="19.8" cy="11" rx="6.6" ry="1.5" fill={shade(accColor, -0.2)} />
        <circle cx="16" cy="2.6" r=".8" fill={shade(accColor, -0.3)} />
      </g>}
      {acc === "muetze" && <g>
        <path d="M7.3 11.6 C7.1 3.8 11.2 1.6 16 1.6 C20.8 1.6 24.9 3.8 24.7 11.6 Z" fill={accColor} />
        <rect x="7" y="9.8" width="18" height="3" rx="1.5" fill={shade(accColor, -0.2)} />
        <circle cx="16" cy="1.4" r="2" fill="#fff" />
      </g>}
      {acc === "kopfhoerer" && <g>
        <path d="M7.6 12 C7.2 4.4 11 2.2 16 2.2 C21 2.2 24.8 4.4 24.4 12" stroke={accColor} strokeWidth="1.7" fill="none" />
        <rect x="6.4" y="10.2" width="3.2" height="4.8" rx="1.5" fill={shade(accColor, -0.25)} />
        <rect x="22.4" y="10.2" width="3.2" height="4.8" rx="1.5" fill={shade(accColor, -0.25)} />
      </g>}
      {acc === "schleife" && <g fill={accColor}>
        <path d="M21.6 5.6 L18.8 3.4 L18.8 7.8 Z" /><path d="M21.6 5.6 L24.4 3.4 L24.4 7.8 Z" /><circle cx="21.6" cy="5.6" r="1" fill={shade(accColor, -0.25)} />
      </g>}
      {acc === "krone" && <path d="M10 5.2 L10.8 0.8 L13.4 3.4 L16 0 L18.6 3.4 L21.2 0.8 L22 5.2 Z" fill="#fbbf24" stroke="#d97706" strokeWidth=".5" />}
      {acc === "blume" && <g>
        {[[0, -1.6], [1.5, -0.5], [0.9, 1.3], [-0.9, 1.3], [-1.5, -0.5]].map(([dx, dy]) => (
          <circle key={`${dx}-${dy}`} cx={21.8 + dx} cy={5.4 + dy} r="1.2" fill={accColor} />
        ))}
        <circle cx="21.8" cy="5.4" r=".9" fill="#fde047" />
      </g>}
      {acc === "schal" && <g fill={accColor}>
        <rect x="10.2" y="16" width="11.6" height="3" rx="1.5" />
        <rect x="17.6" y="17.6" width="2.6" height="5.6" rx="1" fill={shade(accColor, -0.15)} />
      </g>}
    </svg>
  );
}

// ───────────── Kleiderschrank ─────────────
type Tab = "koerper" | "oben" | "unten" | "acc";

export function Wardrobe({ member, owner, firstTime, onSaved }: {
  /** wer sich umzieht */
  member: Member;
  /** wessen Schrank (Sortiment); Standard: der eigene */
  owner?: Member;
  firstTime?: boolean;
  onSaved: (look: AvatarLook) => void;
}) {
  const shelf = wardrobeOf((owner ?? member).sort);
  const borrowed = owner && owner.id !== member.id;
  const [look, setLook] = useState<AvatarLook>(() => lookOf(member));
  // (Wardrobe wird beim Öffnen frisch erzeugt und startet mit dem gespeicherten Look)
  const [tab, setTab] = useState<Tab>("koerper");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<AvatarLook>) => setLook((l) => ({ ...l, ...patch }));

  async function save() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("members").update({ avatar: look }).eq("id", member.id);
    setBusy(false);
    if (error) {
      setErr(error.message.includes("avatar")
        ? "Datenbank-Update fehlt: Bitte supabase/003_avatare.sql im SQL Editor ausführen."
        : error.message);
      return;
    }
    onSaved(look);
  }

  return (
    <div className="space-y-4">
      {firstTime && (
        <p className="rounded-2xl bg-accent/10 px-4 py-3 text-sm text-accent">
          👋 Willkommen im WG-Spiel! Such dir zuerst aus, wie du aussehen willst. Später kannst du dich jederzeit an deinem Kleiderschrank umziehen.
        </p>
      )}
      {borrowed && (
        <p className="rounded-2xl bg-amber-400/15 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          👀 Du stöberst in <b>{owner!.display_name}s</b> Schrank. Alles darf ausgeliehen werden!
        </p>
      )}
      <div className="flex items-center gap-4">
        <div className="flex h-36 w-32 shrink-0 items-end justify-center rounded-3xl bg-gradient-to-b from-accent/10 to-accent/5 pb-2">
          <AvatarFigure look={look} size={88} />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <p className="text-lg font-semibold">{member.display_name}</p>
          <button onClick={() => setLook(randomLook())} className="rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-line/40">🎲 Zufällig</button>
          <button onClick={save} disabled={busy} className="rounded-xl bg-accent px-3 py-2.5 font-medium text-white disabled:opacity-50">
            {busy ? "Speichert …" : "Anziehen ✓"}
          </button>
        </div>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="grid grid-cols-4 gap-1 rounded-xl bg-line/50 p-1 text-xs font-medium sm:text-sm">
        {([["koerper", "Haare"], ["oben", "Oberteil"], ["unten", "Hose & Schuhe"], ["acc", "Extras"]] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`rounded-lg py-1.5 transition ${tab === id ? "bg-card shadow-sm" : "text-muted"}`}>{label}</button>
        ))}
      </div>

      {tab === "koerper" && <>
        <Options label="Frisur" items={HAIRS} value={look.hair} preview={(k) => ({ ...look, hair: k, acc: "keins" })} onPick={(k) => set({ hair: k })} />
        <Swatches label="Haarfarbe" colors={HAIR_COLORS} value={look.hairColor} onPick={(c) => set({ hairColor: c })} />
        <Swatches label="Hautton" colors={SKINS} value={look.skin} onPick={(c) => set({ skin: c })} />
      </>}
      {tab === "oben" && <>
        <Options label="Oberteil" items={subset(TOPS, shelf.tops)} value={look.top} preview={(k) => ({ ...look, top: k })} onPick={(k) => set(k === "tanktop" && look.top !== "tanktop" ? { top: k, topColor: "#10b981" } : { top: k })} />
        <Swatches label="Farbe" colors={CLOTH_COLORS} value={look.topColor} onPick={(c) => set({ topColor: c })} />
      </>}
      {tab === "unten" && <>
        <Options label="Hose" items={subset(BOTTOMS, shelf.bottoms)} value={look.bottom ?? "hose"} preview={(k) => ({ ...look, bottom: k })} onPick={(k) => set({ bottom: k })} />
        <Swatches label="Hosenfarbe" colors={PANTS_COLORS} value={look.pants} onPick={(c) => set({ pants: c })} />
        <Options label="Socken" items={subset(SOCKS, shelf.socks)} value={look.socks ?? "keine"} preview={(k) => ({ ...look, socks: k, bottom: "shorts" })} onPick={(k) => set({ socks: k })} />
        <Swatches label="Schuhe" colors={SHOE_COLORS} value={look.shoes} onPick={(c) => set({ shoes: c })} />
      </>}
      {tab === "acc" && <>
        <Options label="Accessoire" items={subset(ACCS, shelf.accs)} value={look.acc} preview={(k) => ({ ...look, acc: k })} onPick={(k) => set({ acc: k })} />
        {!["keins", "brille", "sonnenbrille", "krone"].includes(look.acc) && (
          <Swatches label="Farbe" colors={CLOTH_COLORS} value={look.accColor} onPick={(c) => set({ accColor: c })} />
        )}
      </>}
    </div>
  );
}

/** Nur die Teile, die in diesem Schrank hängen */
function subset<K extends string>(all: Record<K, string>, keys: K[]): Record<K, string> {
  return Object.fromEntries(keys.map((k) => [k, all[k]])) as Record<K, string>;
}

function Options<K extends string>({ label, items, value, preview, onPick }: {
  label: string; items: Record<K, string>; value: K; preview: (k: K) => AvatarLook; onPick: (k: K) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {(Object.keys(items) as K[]).map((k) => (
          <button key={k} onClick={() => onPick(k)}
            className={`flex flex-col items-center rounded-2xl border-2 pb-1 pt-2 text-[11px] font-medium transition active:scale-95 ${
              value === k ? "border-accent bg-accent/10 text-accent" : "border-transparent bg-card hover:border-line"}`}>
            <AvatarFigure look={preview(k)} size={38} />
            {items[k]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Swatches({ label, colors, value, onPick }: { label: string; colors: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>
      <div className="flex flex-wrap gap-2">
        {colors.map((c) => (
          <button key={c} onClick={() => onPick(c)} aria-label={c}
            className={`h-8 w-8 rounded-full border border-black/10 transition active:scale-90 ${value === c ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : ""}`}
            style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}
