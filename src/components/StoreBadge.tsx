"use client";

import type { StoreId } from "@/lib/types";
import { storeById } from "@/lib/stores";

export function StoreBadge({ store, size = 28 }: { store: StoreId; size?: number }) {
  const s = storeById(store);
  if (s.logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={s.logo} alt={s.label} width={size} height={size} className="shrink-0 rounded-md object-contain" />;
  }
  const isText = /^[A-Za-z]+$/.test(s.short);
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-md font-black leading-none tracking-tight"
      style={{ width: size, height: size, background: s.bg, color: s.fg, fontSize: isText ? size * (s.short.length > 3 ? 0.3 : 0.38) : size * 0.55 }}>
      {s.short}
    </span>
  );
}

