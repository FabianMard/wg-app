"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWG } from "@/lib/wg";
import { Avatar } from "./ui";
import { OnlineNow } from "./OnlineNow";

export const NAV = [
  { href: "/", label: "Start", icon: "🏠" },
  { href: "/putzplan", label: "Putzen", icon: "🧽" },
  { href: "/einkauf", label: "Einkauf", icon: "🛒" },
  { href: "/kosten", label: "Kosten", icon: "💶" },
  { href: "/kalender", label: "Kalender", icon: "📅" },
  { href: "/todos", label: "To-dos", icon: "✅" },
  { href: "/spiel", label: "Spiel", icon: "🎮" },
];

export function Header() {
  const { household, me } = useWG();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <Link href="/" className="min-w-0 truncate text-lg font-bold tracking-tight">{household.name}</Link>
        <nav className="hidden gap-1 md:flex">
          <DesktopLinks />
        </nav>
        <div className="flex items-center gap-2">
          <OnlineNow />
          <Link href="/wg" aria-label="WG-Einstellungen"><Avatar member={me} size={32} /></Link>
        </div>
      </div>
    </header>
  );
}

function DesktopLinks() {
  const path = usePathname();
  return NAV.map((n) => (
    <Link key={n.href} href={n.href}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${path === n.href ? "bg-accent/10 text-accent" : "text-muted hover:text-fg"}`}>
      {n.label}
    </Link>
  ));
}

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="mx-auto grid max-w-3xl grid-cols-7">
        {NAV.map((n) => {
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
