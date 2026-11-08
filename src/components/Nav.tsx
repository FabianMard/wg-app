"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWG } from "@/lib/wg";
import { Avatar } from "./ui";
import { OnlineNow } from "./OnlineNow";
import { useSignedUrl } from "@/lib/photos";

export const NAV = [
  { href: "/", label: "Start", icon: "🏠" },
  { href: "/putzplan", label: "Putzen", icon: "🧽" },
  { href: "/einkauf", label: "Einkauf", icon: "🛒" },
  { href: "/kosten", label: "Kosten", icon: "💶" },
  { href: "/kalender", label: "Kalender", icon: "📅" },
  { href: "/todos", label: "To-dos", icon: "✅" },
  { href: "/spiel", label: "Spiel", icon: "🎮" },
];

/** Menü für Gäste: nur, was freigegeben ist */
function useNav() {
  const { isGuest, can } = useWG();
  if (!isGuest) return NAV;
  return [
    { href: "/", label: "Start", icon: "🏠" },
    { href: "/spiel", label: "Spiel", icon: "🎮" },
    ...(can("kalender") ? [{ href: "/kalender", label: "Kalender", icon: "📅" }] : []),
    ...(can("pinnwand") ? [{ href: "/pinnwand", label: "Pinnwand", icon: "📌" }] : []),
    ...(can("watchlist") ? [{ href: "/watchlist", label: "Watchlist", icon: "📺" }] : []),
  ];
}

/** Welche Seiten darf ein Gast öffnen? */
export function guestMayOpen(path: string, can: (a: "kalender" | "pinnwand" | "watchlist") => boolean) {
  if (path === "/" || path === "/spiel") return true;
  if (path.startsWith("/kalender")) return can("kalender");
  if (path.startsWith("/pinnwand")) return can("pinnwand");
  if (path.startsWith("/watchlist")) return can("watchlist");
  return false;
}

export function Header() {
  const { household, me, isGuest } = useWG();
  const wgPhoto = useSignedUrl(household.photo_path);
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          {wgPhoto && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={wgPhoto} alt="" className="h-9 w-9 shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-line" />
          )}
          <span className="truncate text-lg font-bold tracking-tight">{household.name}</span>
        </Link>
        <nav className="hidden gap-1 md:flex">
          <DesktopLinks />
        </nav>
        <div className="flex items-center gap-2">
          <OnlineNow />
          {isGuest
            ? <span className="flex items-center gap-1.5"><span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">Gast</span><Avatar member={me} size={32} /></span>
            : <Link href="/wg" aria-label="WG-Einstellungen"><Avatar member={me} size={32} /></Link>}
        </div>
      </div>
    </header>
  );
}

function DesktopLinks() {
  const path = usePathname();
  return useNav().map((n) => (
    <Link key={n.href} href={n.href}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${path === n.href ? "bg-accent/10 text-accent" : "text-muted hover:text-fg"}`}>
      {n.label}
    </Link>
  ));
}

export function BottomNav() {
  const path = usePathname();
  const nav = useNav();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="mx-auto grid max-w-3xl" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
        {nav.map((n) => {
          const active = path === n.href;
          return (
            <Link key={n.href} href={n.href}
              className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${active ? "text-accent" : "text-muted"}`}>
              <span className={`text-xl transition ${active ? "" : "opacity-60 grayscale"}`}>{n.icon}</span>
              {n.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
