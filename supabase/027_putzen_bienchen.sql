-- WG-App: Putzdienst übernehmen oder verfallen lassen · Bienchen für alles (mit Begründung) · Push „Putzplan & Bienchen“
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Bestehende Daten bleiben erhalten. Kann mehrfach ausgeführt werden.

-- ── Putzdienst: übernommen (von jemand anderem) oder verfallen (diese Runde fällt aus) ──
create table if not exists public.chore_overrides (
  household_id uuid not null references public.households on delete cascade,
  area_id      uuid not null references public.chore_areas on delete cascade,
  period       int  not null,
  kind         text not null check (kind in ('uebernommen', 'verfallen')),
  member_id    uuid references public.members on delete cascade,   -- wer übernimmt (nur bei „uebernommen“)
  reason       text check (reason is null or char_length(reason) <= 120),
  set_by       uuid default public.my_member_id() references public.members on delete set null,
  created_at   timestamptz not null default now(),
  primary key (area_id, period),
  check ((kind = 'uebernommen') = (member_id is not null))
);
alter table public.chore_overrides enable row level security;
drop policy if exists "Putz-Änderungen sehen" on public.chore_overrides;
drop policy if exists "Putz-Änderungen eintragen" on public.chore_overrides;
create policy "Putz-Änderungen sehen" on public.chore_overrides for select using (is_member(household_id));
create policy "Putz-Änderungen eintragen" on public.chore_overrides for all using (is_resident(household_id)) with check (is_resident(household_id));

-- ── Bienchen für alles Mögliche: Art „sonstiges“ mit Pflicht-Begründung ──
alter table public.praises add column if not exists reason text;
alter table public.praises drop constraint if exists praises_kind_check;
alter table public.praises add constraint praises_kind_check check (kind in ('putzen', 'todo', 'sonstiges'));
alter table public.praises drop constraint if exists praises_reason_check;
alter table public.praises add constraint praises_reason_check
  check (kind <> 'sonstiges' or char_length(trim(coalesce(reason, ''))) between 1 and 120);

-- ── Push: neuer Bereich „putzplan“ – bei allen, die Push haben, erstmal an ──
update public.push_prefs set prefs = prefs || '{"putzplan": "jeder"}'::jsonb where not prefs ? 'putzplan';

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chore_overrides') then
    alter publication supabase_realtime add table public.chore_overrides;
  end if;
end $$;
