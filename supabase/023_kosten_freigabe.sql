-- WG-App: Kosten einreichen → Vorsitz des Haushaltsausschusses gibt frei (oder lehnt ab)
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.
-- Freigegebene Anträge werden automatisch als Ausgabe eingetragen (bezahlt von der einreichenden Person, geteilt durch alle Mitbewohner).

alter table public.households add column if not exists finance_chair uuid references public.members on delete set null;
-- Vorsitz zu Beginn: Fabian
update public.households h set finance_chair = (
  select m.id from public.members m where m.household_id = h.id and m.role = 'mitbewohner' and m.display_name ilike 'Fabian%' order by m.sort limit 1)
where h.finance_chair is null;

create table if not exists public.cost_requests (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households on delete cascade,
  created_by    uuid not null default public.my_member_id() references public.members on delete cascade,
  title         text not null check (char_length(title) between 1 and 120),
  amount        numeric(10,2) not null check (amount > 0 and amount < 100000),
  spent_on      date not null default current_date,
  note          text check (note is null or char_length(note) <= 500),
  status        text not null default 'offen' check (status in ('offen', 'freigegeben', 'abgelehnt')),
  decided_by    uuid references public.members on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  expense_id    uuid references public.expenses on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.cost_requests enable row level security;
drop policy if exists "Anträge sehen" on public.cost_requests;
drop policy if exists "Antrag einreichen" on public.cost_requests;
drop policy if exists "Eigenen offenen Antrag zurückziehen" on public.cost_requests;
create policy "Anträge sehen"     on public.cost_requests for select using (is_resident(household_id));
create policy "Antrag einreichen" on public.cost_requests for insert
  with check (is_resident(household_id) and created_by = my_member_id() and status = 'offen' and decided_by is null and expense_id is null);
create policy "Eigenen offenen Antrag zurückziehen" on public.cost_requests for delete
  using (created_by = my_member_id() and status = 'offen');

-- Entscheiden: nur der Vorsitz. Bei Freigabe wird die Ausgabe eingetragen.
create or replace function public.decide_cost_request(p_id uuid, p_approve boolean, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare r cost_requests%rowtype; chair uuid; me uuid := my_member_id(); ex uuid; everyone uuid[];
begin
  select * into r from cost_requests where id = p_id for update;
  if not found then raise exception 'Antrag nicht gefunden'; end if;
  select finance_chair into chair from households where id = r.household_id;
  if me is null or me <> chair then raise exception 'Nur der Vorsitz des Haushaltsausschusses kann freigeben'; end if;
  if r.status <> 'offen' then return r.status; end if;
  if p_approve then
    select array_agg(id order by sort) into everyone from members where household_id = r.household_id and role = 'mitbewohner';
    insert into expenses (household_id, title, amount, paid_by, participants, spent_on, created_by)
    values (r.household_id, r.title, r.amount, r.created_by, everyone, r.spent_on, me) returning id into ex;
  end if;
  update cost_requests set status = case when p_approve then 'freigegeben' else 'abgelehnt' end,
    decided_by = me, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''), expense_id = ex
  where id = r.id;
  return case when p_approve then 'freigegeben' else 'abgelehnt' end;
end $$;
grant execute on function public.decide_cost_request(uuid, boolean, text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cost_requests') then
    alter publication supabase_realtime add table public.cost_requests;
  end if;
end $$;
