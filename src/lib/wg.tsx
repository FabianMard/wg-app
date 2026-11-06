"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Household, Member } from "./types";

type WGContext = {
  session: Session | null;
  userId: string;
  household: Household;
  members: Member[];
  me: Member | undefined;
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
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    if (session === undefined) return;
    if (!session) return setState({ status: "signed-out" });
    const { data: mine } = await supabase
      .from("members").select("household_id").eq("user_id", session.user.id).maybeSingle();
    if (!mine) return setState({ status: "no-household", session });
    const [{ data: household }, { data: members }] = await Promise.all([
      supabase.from("households").select("*").eq("id", mine.household_id).single(),
      supabase.from("members").select("*").eq("household_id", mine.household_id).order("joined_at"),
    ]);
    if (!household) return setState({ status: "no-household", session });
    setState({ status: "ready", session, household, members: members ?? [] });
  }, [session]);

  useEffect(() => { refresh(); }, [refresh]);

  // Neue Mitbewohner live übernehmen
  const householdId = state.status === "ready" ? state.household.id : null;
  useEffect(() => {
    if (!householdId) return;
    const ch = supabase.channel(`members-${householdId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [householdId, refresh]);

  const ctx: WGContext | null = state.status === "ready" ? {
    session: state.session,
    userId: state.session.user.id,
    household: state.household,
    members: state.members,
    me: state.members.find((m) => m.user_id === state.session.user.id),
    member: (id) => state.members.find((m) => m.user_id === id),
    refresh,
  } : null;

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
    const ch = supabase.channel(`${table}-${household.id}-${orderBy}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload, table, household.id, orderBy]);

  return { rows, loaded, reload };
}
