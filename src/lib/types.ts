export type Household = {
  id: string;
  name: string;
  invite_code: string;
  cleaning_start: string;
  /** "Oft gebraucht" in der Einkaufsliste; null = automatisch */
  shopping_favorites: string[] | null;
  /** WG-Foto (ab 009_wg_foto.sql) */
  photo_path?: string | null;
};

export type Member = {
  id: string;
  household_id: string;
  display_name: string;
  color: string;
  sort: number;
  user_id: string | null;
  avatar: import("@/components/game/avatar").AvatarLook | null;
  /** Profilfoto im Storage-Bucket "pinnwand" (ab 008_profilfoto.sql) */
  photo_path?: string | null;
  /** "Ich lese gerade" (ab 011_buecher.sql) */
  reading?: Reading | null;
  /** ab 012: Mitbewohner oder Gast */
  role?: "mitbewohner" | "gast";
  /** Freigaben eines Gastes */
  permissions?: Partial<Record<GuestArea, boolean>>;
  /** persönlicher Gast-Code (nur für Mitbewohner sichtbar) */
  guest_code?: string | null;
};

/** Bereiche, die man Gästen freigeben kann */
export type GuestArea = "kalender" | "pinnwand" | "watchlist" | "musik";
export const GUEST_AREAS: { id: GuestArea; label: string; icon: string }[] = [
  { id: "kalender", label: "Kalender", icon: "📅" },
  { id: "pinnwand", label: "Pinnwand", icon: "📌" },
  { id: "watchlist", label: "Watchlist", icon: "📺" },
  { id: "musik", label: "Musik", icon: "🎵" },
];

export type Playlist = {
  id: string;
  household_id: string;
  title: string;
  url: string;
  mood: "party" | "putzen" | "chillen" | "kochen" | "sport" | "sonstiges";
  added_by: string | null;
  created_at: string;
};

export type WatchItem = {
  id: string;
  household_id: string;
  title: string;
  kind: "film" | "serie" | "doku" | "anderes";
  platform: string | null;
  note: string | null;
  fans: string[];
  watched: boolean;
  added_by: string | null;
  created_at: string;
};

export type Reading = { title: string; author?: string; progress?: number; url?: string; updated_at?: string };

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
  /** wer hat es eingekauft (abgehakt) – ab 006_eingekauft_von.sql */
  done_by?: string | null;
  done_at?: string | null;
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
  /** ab 012: letzter Tag bei mehrtägigen Einträgen */
  end_day?: string | null;
  recurrence?: "keine" | "woechentlich" | "monatlich" | "jaehrlich";
  /** null = alle; sonst nur diese Personen (+ wer es eingetragen hat) */
  visible_to?: string[] | null;
  created_by?: string | null;
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

export type NoteColor = "gelb" | "rosa" | "gruen" | "blau" | "orange";
export type Note = {
  id: string;
  household_id: string;
  text: string;
  color: NoteColor;
  /** Foto im Storage-Bucket "pinnwand" (ab 007_pinnwand_fotos.sql) */
  image_path?: string | null;
  author: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  household_id: string;
  from_member: string;
  to_member: string;
  text: string;
  read_at: string | null;
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

export type GameScore = {
  household_id: string;
  member_id: string;
  game: "spuelmaschine" | "kite" | "tennis" | "giessen";
  best: number;
  updated_at: string;
};

export type KiteSpot = {
  id: string;
  household_id: string;
  name: string;
  place: string | null;
  cc: string | null;
  lat: number;
  lon: number;
  sort: number;
};

export type TennisMatch = {
  id: string;
  household_id: string;
  winner: string;
  loser: string;
  winner_points: number;
  loser_points: number;
  created_at: string;
};
