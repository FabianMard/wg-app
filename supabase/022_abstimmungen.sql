-- WG-App: Abstimmungen (Reiter im Kalender) – Termine finden, Ja/Nein, Auswahl
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten.
-- Abstimmen dürfen Mitbewohner. Entschieden wird in der Datenbank (poll_check), Termine landen automatisch im Kalender.

create table if not exists public.polls (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  created_by   uuid default public.my_member_id() references public.members on delete set null,
  title        text not null check (char_length(title) between 1 and 120),
  note         text check (note is null or char_length(note) <= 500),
  kind         text not null check (kind in ('termin', 'janein', 'auswahl')),
  rule         text not null default 'mehrheit' check (rule in ('mehrheit', 'einstimmig')),
  multi        boolean not null default false,          -- mehrere Optionen ankreuzbar (z. B. alle passenden Termine)
  deadline     timestamptz,
  closed_at    timestamptz,
  result       uuid,                                    -- gewählte Option (null = keine Einigung)
  event_id     uuid references public.events on delete set null,
  created_at   timestamptz not null default now()
);
create table if not exists public.poll_options (
  id           uuid primary key default gen_random_uuid(),
  poll_id      uuid not null references public.polls on delete cascade,
  household_id uuid not null references public.households on delete cascade,
  label        text not null check (char_length(label) between 1 and 120),
  day          date,                                    -- bei Terminen
  time         time,
  sort         int not null default 0
);
create table if not exists public.poll_votes (
  option_id    uuid not null references public.poll_options on delete cascade,
  poll_id      uuid not null references public.polls on delete cascade,
  household_id uuid not null references public.households on delete cascade,
  member_id    uuid not null default public.my_member_id() references public.members on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (option_id, member_id)
);
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists "Abstimmungen sehen" on public.polls;
drop policy if exists "Abstimmung anlegen" on public.polls;
drop policy if exists "Eigene Abstimmung ändern" on public.polls;
drop policy if exists "Eigene Abstimmung löschen" on public.polls;
create policy "Abstimmungen sehen"        on public.polls for select using (is_resident(household_id));
create policy "Abstimmung anlegen"        on public.polls for insert with check (is_resident(household_id) and created_by = my_member_id() and closed_at is null);
create policy "Eigene Abstimmung löschen" on public.polls for delete using (is_resident(household_id) and created_by = my_member_id());

drop policy if exists "Optionen sehen" on public.poll_options;
drop policy if exists "Optionen anlegen" on public.poll_options;
create policy "Optionen sehen"   on public.poll_options for select using (is_resident(household_id));
create policy "Optionen anlegen" on public.poll_options for insert with check (
  is_resident(household_id) and exists (select 1 from polls p where p.id = poll_id and p.created_by = my_member_id() and p.closed_at is null));

drop policy if exists "Stimmen sehen" on public.poll_votes;
drop policy if exists "Abstimmen" on public.poll_votes;
drop policy if exists "Stimme zurücknehmen" on public.poll_votes;
create policy "Stimmen sehen" on public.poll_votes for select using (is_resident(household_id));
create policy "Abstimmen" on public.poll_votes for insert with check (
  is_resident(household_id) and member_id = my_member_id()
  and exists (select 1 from polls p join poll_options o on o.poll_id = p.id where o.id = option_id and p.id = poll_id and p.closed_at is null));
create policy "Stimme zurücknehmen" on public.poll_votes for delete using (
  member_id = my_member_id() and exists (select 1 from polls p where p.id = poll_id and p.closed_at is null));

-- Prüft eine Abstimmung und entscheidet sie, wenn die Regel erfüllt ist.
-- Mehrheit: mehr als die Hälfte aller Mitbewohner. Einstimmig: alle.
-- p_force (Frist vorbei oder Ersteller beendet): Mehrheit → meiste Stimmen (bei Gleichstand keine Einigung); Einstimmig → nur wenn erfüllt.
-- Termine werden dabei genau einmal in den Kalender eingetragen.
create or replace function public.poll_check(p_poll uuid, p_force boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  p polls%rowtype; n int; need int; voted int; win uuid; top int; second int; opt poll_options%rowtype; ev uuid; may_force boolean;
begin
  select * into p from polls where id = p_poll for update;
  if not found or not is_resident(p.household_id) then raise exception 'Nicht erlaubt'; end if;
  if p.closed_at is not null then return 'schon_entschieden'; end if;
  select count(*) into n from members where household_id = p.household_id and role = 'mitbewohner';
  select count(distinct v.member_id) into voted from poll_votes v join members m on m.id = v.member_id and m.role = 'mitbewohner' where v.poll_id = p.id;
  -- Endgültig auswerten: Ersteller*in beendet, Frist vorbei oder alle haben abgestimmt
  may_force := (p_force and p.created_by = my_member_id())
            or (p.deadline is not null and now() >= p.deadline)
            or voted >= n;
  need := case when p.rule = 'einstimmig' then n else n / 2 + 1 end;

  with c as (
    select o.id, o.sort, count(v.member_id) as votes
    from poll_options o left join poll_votes v on v.option_id = o.id
    where o.poll_id = p.id group by o.id, o.sort
  ), r as (select id, votes, row_number() over (order by votes desc, sort) as rn from c)
  select (select id from r where rn = 1), (select votes from r where rn = 1), coalesce((select votes from r where rn = 2), 0)
  into win, top, second;

  -- Ja/Nein: nur "Ja" (erste Option) kann gewinnen
  if p.kind = 'janein' then
    select o.id, count(v.member_id) into win, top from poll_options o left join poll_votes v on v.option_id = o.id
    where o.poll_id = p.id and o.sort = 0 group by o.id;
    second := 0;
  end if;

  if coalesce(top, 0) >= need then
    null; -- Regel erfüllt
  elsif may_force and p.rule = 'mehrheit' and p.kind <> 'janein' and coalesce(top, 0) > 0 and top > second then
    null; -- Frist vorbei: meiste Stimmen gewinnen
  elsif may_force then
    update polls set closed_at = now(), result = null where id = p.id;
    return 'keine_einigung';
  else
    return 'offen';
  end if;

  if p.kind = 'termin' then
    select * into opt from poll_options where id = win;
    insert into events (household_id, title, day, time, created_by) values (p.household_id, p.title, opt.day, opt.time, p.created_by) returning id into ev;
  end if;
  update polls set closed_at = now(), result = win, event_id = ev where id = p.id;
  return 'entschieden';
end $$;
grant execute on function public.poll_check(uuid, boolean) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['polls', 'poll_options', 'poll_votes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
