"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRows, useWG } from "@/lib/wg";
import type { ShoppingItem } from "@/lib/types";
import { btnCls, btnGhostCls, Card, Check, DeleteButton, Empty, inputCls, PageTitle, SectionTitle } from "@/components/ui";

export default function Einkauf() {
  const { household, member } = useWG();
  const { rows: items, loaded, reload } = useRows<ShoppingItem>("shopping_items", "created_at");
  const [name, setName] = useState("");

  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    // Mehrere Sachen auf einmal: "Milch, Eier, Brot"
    const names = name.split(",").map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    await supabase.from("shopping_items").insert(names.map((n) => ({ household_id: household.id, name: n })));
    setName("");
    reload();
  }
  async function toggle(i: ShoppingItem) {
    await supabase.from("shopping_items").update({ done: !i.done }).eq("id", i.id);
    reload();
  }
  async function remove(i: ShoppingItem) {
    await supabase.from("shopping_items").delete().eq("id", i.id);
    reload();
  }
  async function clearDone() {
    await supabase.from("shopping_items").delete().in("id", done.map((i) => i.id));
    reload();
  }

  return (
    <>
      <PageTitle sub="Tipp: Mehrere Sachen mit Komma trennen.">Einkaufsliste</PageTitle>
      <form onSubmit={add} className="mb-5 flex gap-2">
        <input className={inputCls} placeholder="Milch, Eier, Klopapier …" value={name} onChange={(e) => setName(e.target.value)} />
        <button className={btnCls}>+</button>
      </form>

      {loaded && items.length === 0 && <Empty>Die Liste ist leer.</Empty>}
      {open.length > 0 && (
        <Card className="divide-y divide-line p-0">
          {open.map((i) => <ItemRow key={i.id} item={i} by={member(i.added_by)?.display_name} onToggle={toggle} onRemove={remove} />)}
        </Card>
      )}

      {done.length > 0 && (
        <>
          <div className="flex items-end justify-between">
            <SectionTitle>Im Wagen ({done.length})</SectionTitle>
            <button onClick={clearDone} className={`${btnGhostCls} mb-2`}>Gekaufte entfernen</button>
          </div>
          <Card className="divide-y divide-line p-0 opacity-70">
            {done.map((i) => <ItemRow key={i.id} item={i} onToggle={toggle} onRemove={remove} />)}
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
    <div className="flex items-center gap-3 px-4 py-3">
      <Check checked={item.done} onChange={() => onToggle(item)} />
      <button onClick={() => onToggle(item)} className={`flex-1 text-left ${item.done ? "text-muted line-through" : ""}`}>
        {item.name}
      </button>
      {by && <span className="text-xs text-muted">{by}</span>}
      <DeleteButton onClick={() => onRemove(item)} />
    </div>
  );
}
