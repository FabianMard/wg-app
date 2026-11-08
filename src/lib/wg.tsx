"use client";

import { createContext, useCallback, useContext, useEffect, useId, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Household, Member } from "./types";

type WGContext = {
  session: Session | null;
  userId: string;
  /** ID des eigenen Mitbewohners (members.id) */
  myId: string;
  household: Household;
  /** nur Mitbewohner (für Putzplan, Kosten, Rotation …) */
  members: Member[];
  /** Gäste dieser WG (Mitbewohner sehen alle, Gäste nur sich selbst) */
  guests: Member[];
  /** alle Personen (Mitbewohner + Gäste) */
  everyone: Member[];
  me: Member | undefined;
  /** bin ich ein Gast? */
  isGuest: boolean;
  /** darf ich diesen Bereich sehen? (Mitbewohner immer) */
  can: (area: import("./types").GuestArea) => boolean;
  member: (id: string | null | undefined) => Member | undefined;
  refresh: () => Promise<void>;
};

type State =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "no-household"; session: Session }
  | { status: "ready"; session: Session; household: Household; members: Member[] };

const Ctx = createContext<WGContext | null>(null);
const StateCtx = createContext<{ state: State; refresh: () => Promise<void> } | null>(null);

export function WGProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  // Liest die Sitzung immer frisch, damit refresh() direkt nach dem Anmelden funktioniert
  const refresh = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return setState({ status: "signed-out" });
    const { data: mine } = await supabase
      .from("members").select("household_id").eq("user_id", session.user.id).maybeSingle();
    if (!mine) return setState({ status: "no-household", session });
    const [{ data: hh }, { data: members }] = await Promise.all([
      supabase.from("households").select("*").eq("id", mine.household_id).maybeSingle(),
      supabase.from("members").select("*").eq("household_id", mine.household_id).order("sort"),
    ]);
    let household = hh as Household | null;
    // Gäste dürfen die WG-Zeile nicht direkt lesen (dort steht der Einladungscode) → eingeschränkte Infos per RPC
    if (!household) {
      const { data: g } = await supabase.rpc("guest_household");
      if (g) household = { ...(g as Household), invite_code: "", shopping_favorites: null };
    }
    if (!household) return setState({ status: "no-household", session });
    setState({ status: "ready", session, household, members: members ?? [] });
  }, []);

  useEffect(() => {
    refresh();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // Keine Supabase-Aufrufe direkt im Callback (kann blockieren), daher setTimeout
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(refresh, 0);
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  // Neue Mitbewohner live übernehmen
  const householdId = state.status === "ready" ? state.household.id : null;
  useEffect(() => {
    if (!householdId) return;
    const ch = supabase.channel(`members-${householdId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, () => refresh())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "households" }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [householdId, refresh]);

  let ctx: WGContext | null = null;
  if (state.status === "ready") {
    const all = state.members;
    const me = all.find((m) => m.user_id === state.session.user.id);
    const isGuest = me?.role === "gast";
    ctx = {
      session: state.session,
      userId: state.session.user.id,
      myId: me?.id ?? "",
      household: state.household,
      members: all.filter((m) => m.role !== "gast"),
      guests: all.filter((m) => m.role === "gast"),
      everyone: all,
      me,
      isGuest,
      can: (area) => !isGuest || !!me?.permissions?.[area],
      member: (id) => all.find((m) => m.id === id),
      refresh,
    };
  }

  return (
    <StateCtx.Provider value={{ state, refresh }}>
      <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
    </StateCtx.Provider>
  );
}

export function useWGState() {
  const s = useContext(StateCtx);
  if (!s) throw new Error("WGProvider fehlt");
  return s;
}

/** Nur innerhalb der eingeloggten App verwenden (nach dem Gate). */
export function useWG(): WGContext {
  const c = useContext(Ctx);
  if (!c) throw new Error("Keine WG geladen");
  return c;
}

/** Lädt alle Zeilen einer Tabelle für die aktuelle WG und aktualisiert sie live. */
export function useRows<T>(table: string, orderBy: string, ascending = true) {
  const { household } = useWG();
  // Eigener Kanal je Verwendung: Zwei Komponenten mit derselben Liste dürfen sich keinen Kanal teilen
  // (Supabase wirft sonst "cannot add postgres_changes callbacks after subscribe()").
  const instance = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [rows, setRows] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const { data } = await supabase
      .from(table).select("*").eq("household_id", household.id).order(orderBy, { ascending });
    setRows((data as T[]) ?? []);
    setLoaded(true);
  }, [table, orderBy, ascending, household.id]);

  useEffect(() => {
    reload();
    const ch = supabase.channel(`${table}-${household.id}-${orderBy}-${instance}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload, table, household.id, orderBy, instance]);

  return { rows, loaded, reload };
}
