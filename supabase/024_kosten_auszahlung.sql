-- WG-App: Kosten einreichen läuft getrennt von "Kosten teilen" – größere Ausgaben werden direkt ausgezahlt
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Voraussetzung: 023_kosten_freigabe.sql
-- Ablauf: offen → freigegeben → ausgezahlt (oder abgelehnt). Es wird NICHTS mehr unter "Kosten teilen" eingetragen.

alter table public.cost_requests add column if not exists paid_out_at timestamptz;
alter table public.cost_requests drop constraint if exists cost_requests_status_check;
alter table public.cost_requests add constraint cost_requests_status_check check (status in ('offen', 'freigegeben', 'ausgezahlt', 'abgelehnt'));

-- Freigeben oder ablehnen (nur der Vorsitz) – ohne Eintrag unter "Kosten teilen"
create or replace function public.decide_cost_request(p_id uuid, p_approve boolean, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare r cost_requests%rowtype; chair uuid; me uuid := my_member_id();
begin
  select * into r from cost_requests where id = p_id for update;
  if not found then raise exception 'Antrag nicht gefunden'; end if;
  select finance_chair into chair from households where id = r.household_id;
  if me is null or me <> chair then raise exception 'Nur der Vorsitz des Haushaltsausschusses kann freigeben'; end if;
  if r.status <> 'offen' then return r.status; end if;
  update cost_requests set status = case when p_approve then 'freigegeben' else 'abgelehnt' end,
    decided_by = me, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = r.id;
  return case when p_approve then 'freigegeben' else 'abgelehnt' end;
end $$;

-- Als ausgezahlt markieren (nur der Vorsitz, nur nach Freigabe)
create or replace function public.mark_cost_paid(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare r cost_requests%rowtype; chair uuid; me uuid := my_member_id();
begin
  select * into r from cost_requests where id = p_id for update;
  if not found then raise exception 'Antrag nicht gefunden'; end if;
  select finance_chair into chair from households where id = r.household_id;
  if me is null or me <> chair then raise exception 'Nur der Vorsitz des Haushaltsausschusses kann auszahlen'; end if;
  if r.status <> 'freigegeben' then return r.status; end if;
  update cost_requests set status = 'ausgezahlt', paid_out_at = now() where id = r.id;
  return 'ausgezahlt';
end $$;
grant execute on function public.mark_cost_paid(uuid) to authenticated;
