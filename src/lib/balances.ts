import type { Expense } from "./types";

/** Saldo pro Person in Cent: positiv = bekommt Geld, negativ = schuldet Geld. */
export function computeBalances(expenses: Expense[], memberIds: string[]): Record<string, number> {
  const bal: Record<string, number> = Object.fromEntries(memberIds.map((id) => [id, 0]));
  for (const e of expenses) {
    const cents = Math.round(Number(e.amount) * 100);
    const parts = [...e.participants].sort();
    const share = Math.floor(cents / parts.length);
    let rest = cents - share * parts.length;
    bal[e.paid_by] = (bal[e.paid_by] ?? 0) + cents;
    for (const p of parts) {
      const extra = rest > 0 ? 1 : 0;
      rest -= extra;
      bal[p] = (bal[p] ?? 0) - share - extra;
    }
  }
  return bal;
}

export type Transfer = { from: string; to: string; cents: number };

/** Möglichst wenige Überweisungen, um alle Salden auszugleichen. */
export function suggestTransfers(balances: Record<string, number>): Transfer[] {
  const debtors = Object.entries(balances).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  const creditors = Object.entries(balances).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  debtors.sort((a, b) => b.v - a.v);
  creditors.sort((a, b) => b.v - a.v);
  const out: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].v, creditors[j].v);
    if (amt > 0) out.push({ from: debtors[i].id, to: creditors[j].id, cents: amt });
    debtors[i].v -= amt;
    creditors[j].v -= amt;
    if (debtors[i].v === 0) i++;
    if (creditors[j].v === 0) j++;
  }
  return out;
}
