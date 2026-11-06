"use client";

import type { Member } from "@/lib/types";
import { useSignedUrl } from "@/lib/photos";

export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-bold tracking-tight">{children}</h1>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-card p-4 shadow-sm ${className}`}>{children}</div>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-muted">{children}</h2>;
}

export function Avatar({ member, size = 28 }: { member?: Member; size?: number }) {
  const photo = useSignedUrl(member?.photo_path);
  if (!member) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-line text-xs text-muted"
        style={{ width: size, height: size }}>?</span>
    );
  }
  if (photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photo} alt={member.display_name} title={member.display_name} width={size} height={size}
        className="inline-block shrink-0 rounded-full object-cover"
        style={{ width: size, height: size, boxShadow: `0 0 0 2px ${member.color}` }} />
    );
  }
  return (
    <span title={member.display_name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: member.color, fontSize: size * 0.45 }}>
      {member.display_name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">{children}</p>;
}

export const inputCls =
  "w-full rounded-xl border border-line bg-card px-3 py-2.5 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
export const btnCls =
  "inline-flex items-center justify-center gap-1 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:opacity-90 active:scale-[.98] disabled:opacity-50";
export const btnGhostCls =
  "inline-flex items-center justify-center gap-1 rounded-xl border border-line px-3 py-2 text-sm font-medium transition hover:bg-line/40 active:scale-[.98]";

export function DeleteButton({ onClick, label = "Löschen" }: { onClick: () => void; label?: string }) {
  return (
    <button aria-label={label} title={label} onClick={onClick}
      className="rounded-lg p-1.5 text-muted transition hover:bg-red-500/10 hover:text-red-600">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
      </svg>
    </button>
  );
}

export function Check({ checked, onChange, color }: { checked: boolean; onChange: () => void; color?: string }) {
  return (
    <button role="checkbox" aria-checked={checked} onClick={onChange}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition"
      style={{ borderColor: checked ? (color ?? "var(--accent)") : "var(--line)", background: checked ? (color ?? "var(--accent)") : "transparent" }}>
      {checked && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
    </button>
  );
}
