-- WG-App: merken, wer etwas eingekauft (abgehakt) hat – für den Monatsbericht
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.

alter table public.shopping_items
  add column if not exists done_by uuid references public.members on delete set null,
  add column if not exists done_at timestamptz;
