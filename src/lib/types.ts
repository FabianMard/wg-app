export type Household = { id: string; name: string; invite_code: string };

export type Member = {
  household_id: string;
  user_id: string;
  display_name: string;
  color: string;
  joined_at: string;
};

export type Chore = {
  id: string;
  household_id: string;
  title: string;
  interval_days: number;
  assignee: string | null;
  next_due: string;
  last_done_at: string | null;
  last_done_by: string | null;
};

export type ShoppingItem = {
  id: string;
  household_id: string;
  name: string;
  done: boolean;
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
  assignee: string | null;
  due_date: string | null;
  created_at: string;
};
