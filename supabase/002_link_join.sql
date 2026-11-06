-- Beitritt per Link ohne E-Mail (anonyme Anmeldung)
-- Im Supabase-Dashboard unter "SQL Editor" ausführen.
-- Voraussetzung: Authentication → Sign In / Providers → "Allow anonymous sign-ins" aktivieren.

-- WG-Name und Mitbewohner anhand des Einladungscodes anzeigen (vor dem Beitritt)
create or replace function public.household_preview(p_code text)
returns json language sql security definer stable set search_path = public as $$
  select json_build_object(
    'name', h.name,
    'members', coalesce((
      select json_agg(json_build_object('user_id', m.user_id, 'display_name', m.display_name, 'color', m.color) order by m.joined_at)
      from members m where m.household_id = h.id), '[]'::json))
  from households h
  where h.invite_code = upper(trim(p_code))
$$;

-- "Ich bin schon dabei": Ein neues Gerät übernimmt einen bestehenden Mitbewohner
-- samt Aufgaben, Ausgaben usw.
create or replace function public.claim_member(p_code text, p_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  h  uuid;
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Nicht eingeloggt'; end if;
  if me = p_user_id then return null; end if;
  select id into h from households where invite_code = upper(trim(p_code));
  if h is null then raise exception 'Einladungscode ungültig'; end if;
  if not exists (select 1 from members where household_id = h and user_id = p_user_id) then
    raise exception 'Mitbewohner nicht gefunden';
  end if;
  if exists (select 1 from members where user_id = me) then
    raise exception 'Dieses Gerät gehört schon zu einer WG';
  end if;

  update members        set user_id      = me where household_id = h and user_id      = p_user_id;
  update chores         set assignee     = me where household_id = h and assignee     = p_user_id;
  update chores         set last_done_by = me where household_id = h and last_done_by = p_user_id;
  update shopping_items set added_by     = me where household_id = h and added_by     = p_user_id;
  update expenses       set paid_by      = me where household_id = h and paid_by      = p_user_id;
  update expenses       set created_by   = me where household_id = h and created_by   = p_user_id;
  update expenses       set participants = array_replace(participants, p_user_id, me)
                                              where household_id = h and p_user_id = any(participants);
  update events         set created_by   = me where household_id = h and created_by   = p_user_id;
  update todos          set assignee     = me where household_id = h and assignee     = p_user_id;
  update todos          set created_by   = me where household_id = h and created_by   = p_user_id;
  return h;
end $$;
