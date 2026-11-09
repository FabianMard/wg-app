-- WG-App: WG-Chat für alle (Gruppenchat) – Nachrichten ohne Empfänger gehen an alle in der WG
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Nachrichten bleiben erhalten.
-- Voraussetzung: 010_chat.sql

alter table public.messages alter column to_member drop not null;

drop policy if exists "Eigene Nachrichten lesen" on public.messages;
drop policy if exists "Nachricht schreiben" on public.messages;
-- Private Nachrichten: nur Absender & Empfänger. Gruppen-Nachrichten (to_member leer): alle in der WG.
create policy "Eigene Nachrichten lesen" on public.messages for select
  using (is_member(household_id) and (to_member is null or my_member_id() in (from_member, to_member)));
create policy "Nachricht schreiben" on public.messages for insert
  with check (is_member(household_id) and from_member = my_member_id() and (to_member is null or to_member <> from_member));
