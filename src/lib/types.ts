export type Household = { id: string; name: string; invite_code: string; cleaning_start: string };

export type Member = {
  id: string;
  household_id: string;
  display_name: string;
  color: string;
  sort: number;
  user_id: string | null;
  avatar: import("@/components/game/avatar").AvatarLook | null;
};

export type ChoreArea = { id: string; household_id: string; name: string; icon: string; sort: number };
export type ChoreTask = { id: string; household_id: string; area_id: string; title: string; sort: number };
export type ChoreCheck = {
  id: string;
  household_id: string;
  area_id: string;
  task_id: string;
  period: number;
  done_by: string | null;
  done_at: string;
};

export type StoreId = "hit" | "rewe" | "konsum" | "baumarkt" | "egal" | "sonstiges";

export type ShoppingItem = {
  id: string;
  household_id: string;
  name: string;
  store: StoreId;
  store_note: string | null;
  done: boolean;
  archived: boolean;
  added_by: string | null;
  created_at: string;
};

export type Expense = {
  id: string;
  household_id: string;
  title: string;
  amount: number;
  paid_by: string;
  participants: string[];
  is_settlement: boolean;
  spent_on: string;
  created_at: string;
};

export type CalEvent = {
  id: string;
  household_id: string;
  title: string;
  day: string;
  time: string | null;
  note: string | null;
};

export type Todo = {
  id: string;
  household_id: string;
  title: string;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  assignee: string | null;
  due_date: string | null;
  created_at: string;
};

export type Praise = {
  id: string;
  household_id: string;
  from_member: string;
  to_member: string;
  kind: "putzen" | "todo";
  ref: string;
  created_at: string;
};
