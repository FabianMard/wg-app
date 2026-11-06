"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { ShoppingItem, StoreId } from "@/lib/types";
import { DEFAULT_SUGGESTIONS, STORES, storeById } from "@/lib/stores";
import { StoreBadge } from "@/components/StoreBadge";
import { Checkout } from "@/components/Checkout";
import { btnCls, btnGhostCls, Card, Check, DeleteButton, Empty, inputCls, PageTitle, SectionTitle } from "@/components/ui";

const fmtAdded = (iso: string) =>
  new Date(iso).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });

export default function Einkauf() {
  const { household, member, refresh, myId } = useWG();
  const { rows: items, loaded, reload } = useRows<ShoppingItem>("shopping_items", "created_at");
  const [name, setName] = useState("");
  const [store, setStore] = useState<StoreId>("egal");
  const [note, setNote] = useState("");
  const [checkout, setCheckout] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [editFavs, setEditFavs] = useState(false);
  const [newFav, setNewFav] = useState("");
  const [favErr, setFavErr] = useState<string | null>(null);
  // Sofort anzeigen, bevor die Datenbank antwortet (undefined = Wert aus der Datenbank nehmen)
  const [favOverride, setFavOverride] = useState<string[] | null | undefined>(undefined);

  const visible = items.filter((i) => !i.archived);
  const open = visible.filter((i) => !i.done);
  const done = visible.filter((i) => i.done);

  // Was bei euch oft gekauft wird (mind. 2×), häufigstes zuerst
  const learned = useMemo(() => {
    const count = new Map<string, { name: string; n: number }>();
    for (const i of items) {
      const k = i.name.trim().toLowerCase();
      const e = count.get(k);
      count.set(k, { name: e?.name ?? i.name.trim(), n: (e?.n ?? 0) + 1 });
    }
    return [...count.values()].filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).map((x) => x.name);
  }, [items]);

  const dedupe = (list: string[]) => {
    const seen = new Set<string>();
    return list.filter((n) => { const k = n.trim().toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  };
  // Automatische Liste, solange niemand sie bearbeitet hat
  const autoFavs = useMemo(() => dedupe([...learned, ...DEFAULT_SUGGESTIONS]).slice(0, 14), [learned]);
  const stored = favOverride !== undefined ? favOverride : household.shopping_favorites;
  const favorites = stored ?? autoFavs;
  const openNames = new Set(open.map((i) => i.name.trim().toLowerCase()));
  const suggestions = favorites.filter((n) => !openNames.has(n.trim().toLowerCase()));
  const notYetFav = learned.filter((n) => !favorites.some((f) => f.trim().toLowerCase() === n.trim().toLowerCase())).slice(0, 10);

  async function saveFavs(list: string[] | null) {
    setFavErr(null);
    setFavOverride(list);
    const { error } = await supabase.from("households").update({ shopping_favorites: list }).eq("id", household.id);
    if (error) {
      setFavOverride(undefined);
      setFavErr(error.message.includes("shopping_favorites")
        ? "Datenbank-Update fehlt: Bitte supabase/004_einkauf_favoriten.sql im SQL Editor ausführen."
        : error.message);
      return;
    }
    await refresh();
    setFavOverride(undefined);
  }
  const addFav = (n: string) => { const t = n.trim(); if (t) saveFavs(dedupe([...favorites, t])); };
  const removeFav = (n: string) => saveFavs(favorites.filter((f) => f !== n));
  const moveFav = (n: string, dir: -1 | 1) => {
    const i = favorites.indexOf(n), j = i + dir;
    if (i < 0 || j < 0 || j >= favorites.length) return;
    const next = [...favorites];
    [next[i], next[j]] = [next[j], next[i]];
    saveFavs(next);
  };

  async function addNames(names: string[]) {
    if (!names.length) return;
    await supabase.from("shopping_items").insert(names.map((n) => ({
      household_id: household.id, name: n, store, store_note: store === "sonstiges" ? note.trim() || null : null,
    })));
    reload();
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    // Mehrere Sachen auf einmal: "Milch, Eier, Brot"
    await addNames(name.split(",").map((s) => s.trim()).filter(Boolean));
    setName("");
  }
  async function toggle(i: ShoppingItem) {
    const done = !i.done;
    const { error } = await supabase.from("shopping_items")
      .update({ done, done_by: done ? myId : null, done_at: done ? new Date().toISOString() : null }).eq("id", i.id);
    // Ohne 006_eingekauft_von.sql gibt es done_by noch nicht – dann ohne abhaken
    if (error) await supabase.from("shopping_items").update({ done }).eq("id", i.id);
    reload();
  }
  async function remove(i: ShoppingItem) {
    await supabase.from("shopping_items").delete().eq("id", i.id);
    reload();
  }
  async function clearDone() {
    await supabase.from("shopping_items").update({ archived: true }).in("id", done.map((i) => i.id));
    reload();
  }

  const groups = STORES.map((s) => ({ store: s, items: open.filter((i) => i.store === s.id) })).filter((g) => g.items.length);

  return (
    <>
      <PageTitle sub="Tipp: Mehrere Sachen mit Komma trennen.">Einkaufsliste</PageTitle>

      <Card className="mb-5 space-y-3">
        <form onSubmit={add} className="flex gap-2">
          <input className={inputCls} placeholder="Milch, Eier, Klopapier …" value={name} onChange={(e) => setName(e.target.value)} />
          <button className={btnCls} aria-label="Hinzufügen">+</button>
        </form>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Wo kaufen?</p>
          <div className="flex flex-wrap gap-1.5">
            {STORES.map((s) => (
              <button key={s.id} type="button" onClick={() => setStore(s.id)}
                className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-sm font-medium transition ${
                  store === s.id ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-fg"}`}>
                <StoreBadge store={s.id} size={22} />{s.label}
              </button>
            ))}
          </div>
          {store === "sonstiges" && (
            <input className={`${inputCls} mt-2 py-2 text-sm`} placeholder="Welcher Laden? z. B. Drogerie, Apotheke …"
              value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted">{editFavs ? "Oft gebraucht bearbeiten" : "Oft gebraucht, antippen zum Hinzufügen"}</p>
            <button type="button" onClick={() => { setEditFavs(!editFavs); setFavErr(null); }}
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${editFavs ? "bg-accent text-white" : "text-accent hover:bg-accent/10"}`}>
              {editFavs ? "Fertig" : "✏️ Bearbeiten"}
            </button>
          </div>
          {!editFavs ? (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => addNames([s])}
                  className="rounded-full bg-line/50 px-3 py-1 text-sm transition hover:bg-accent/15 hover:text-accent active:scale-95">
                  + {s}
                </button>
              ))}
              {suggestions.length === 0 && <span className="text-sm text-muted">Alles schon auf der Liste 👍</span>}
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-dashed border-accent/40 p-3">
              <ul className="space-y-1">
                {favorites.map((f, i) => (
                  <li key={f} className="flex items-center gap-1 rounded-lg bg-line/40 py-1 pl-3 pr-1 text-sm">
                    <span className="min-w-0 flex-1 truncate">{f}</span>
                    <button type="button" onClick={() => moveFav(f, -1)} disabled={i === 0} aria-label={`${f} nach oben`}
                      className="rounded-md px-2 py-1 text-muted hover:bg-line disabled:opacity-25">↑</button>
                    <button type="button" onClick={() => moveFav(f, 1)} disabled={i === favorites.length - 1} aria-label={`${f} nach unten`}
                      className="rounded-md px-2 py-1 text-muted hover:bg-line disabled:opacity-25">↓</button>
                    <button type="button" onClick={() => removeFav(f)} aria-label={`${f} entfernen`}
                      className="rounded-md px-2 py-1 text-muted hover:bg-red-500/10 hover:text-red-600">✕</button>
                  </li>
                ))}
                {favorites.length === 0 && <li className="text-sm text-muted">Noch nichts in der Liste.</li>}
              </ul>
              <form onSubmit={(e) => { e.preventDefault(); addFav(newFav); setNewFav(""); }} className="flex gap-2">
                <input className={`${inputCls} py-2`} placeholder="Neuer Artikel, z. B. Hafermilch" value={newFav} onChange={(e) => setNewFav(e.target.value)} />
                <button className="rounded-xl bg-accent px-4 font-medium text-white">+</button>
              </form>
              {notYetFav.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs text-muted">Kauft ihr oft, steht aber noch nicht drin:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {notYetFav.map((n) => (
                      <button key={n} type="button" onClick={() => addFav(n)}
                        className="rounded-full border border-dashed border-line px-3 py-1 text-sm text-muted hover:border-accent hover:text-accent">+ {n}</button>
                    ))}
                  </div>
                </div>
              )}
              {stored && (
                <button type="button" onClick={() => saveFavs(null)} className="text-xs text-muted underline hover:text-fg">
                  Zurücksetzen auf automatische Vorschläge
                </button>
              )}
            </div>
          )}
          {favErr && <p className="mt-2 text-sm text-red-600">{favErr}</p>}
        </div>
      </Card>

      {flash && <p className="mb-4 rounded-2xl bg-emerald-500/15 px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">{flash}</p>}
      {loaded && open.length === 0 && done.length === 0 && <Empty>Die Liste ist leer.</Empty>}

      <div className="space-y-4">
        {groups.map(({ store: s, items: list }) => (
          <div key={s.id}>
            <div className="mb-2 flex items-center gap-2">
              <StoreBadge store={s.id} size={24} />
              <h2 className="font-semibold">{s.label}</h2>
              <span className="text-sm text-muted">{list.length}</span>
            </div>
            <Card className="divide-y divide-line p-0">
              {list.map((i) => (
                <ItemRow key={i.id} item={i} by={member(i.added_by)?.display_name} onToggle={toggle} onRemove={remove} />
              ))}
            </Card>
          </div>
        ))}
      </div>

      {done.length > 0 && (
        <>
          <SectionTitle>Im Wagen ({done.length})</SectionTitle>
          {checkout ? (
            <Checkout items={done} onCancel={() => setCheckout(false)}
              onDone={(msg) => { setCheckout(false); setFlash(msg); setTimeout(() => setFlash(null), 5000); reload(); }} />
          ) : (
            <div className="mb-3 flex flex-wrap gap-2">
              <button onClick={() => setCheckout(true)} className={`${btnCls} flex-1`}>💶 Bezahlt? Betrag eintragen & aufteilen</button>
              <button onClick={clearDone} className={btnGhostCls}>Nur entfernen</button>
            </div>
          )}
          <Card className="divide-y divide-line p-0 opacity-70">
            {done.map((i) => <ItemRow key={i.id} item={i} by={member(i.added_by)?.display_name} onToggle={toggle} onRemove={remove} />)}
          </Card>
        </>
      )}
    </>
  );
}

function ItemRow({ item, by, onToggle, onRemove }: {
  item: ShoppingItem; by?: string; onToggle: (i: ShoppingItem) => void; onRemove: (i: ShoppingItem) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Check checked={item.done} onChange={() => onToggle(item)} />
      <button onClick={() => onToggle(item)} className="min-w-0 flex-1 text-left">
        <span className={`block truncate ${item.done ? "text-muted line-through" : ""}`}>{item.name}</span>
        <span className="block text-xs text-muted">
          {fmtAdded(item.created_at)}{by && ` · ${by}`}
          {item.store === "sonstiges" && item.store_note && ` · 📍 ${item.store_note}`}
          {item.done && ` · ${storeById(item.store).label}`}
        </span>
      </button>
      <DeleteButton onClick={() => onRemove(item)} />
    </div>
  );
}
