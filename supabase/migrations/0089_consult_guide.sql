-- The consult guide (Scale Up workbook pp. 57–63): what came up on each consultation is kept so the top objections
-- can be counted and turned into content and ads (p. 61). One key per call from a fixed list (data/consult-guide.ts),
-- on the consultation itself (website bookings have no prospect row) and on prospect call logs.
alter table consult_invites add column if not exists objection text check (objection in ('think', 'partner', 'cheaper', 'looking', 'finances', 'email', 'callback', 'carrier', 'none', 'other'));
alter table consult_invites add column if not exists call_note text check (call_note is null or length(call_note) <= 2000);
alter table prospect_events add column if not exists objection text check (objection in ('think', 'partner', 'cheaper', 'looking', 'finances', 'email', 'callback', 'carrier', 'none', 'other'));

create or replace function set_consult_notes(p_invite uuid, p_objection text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare ci consult_invites; o text := nullif(p_objection, '');
begin
  if not is_staff() then raise exception 'Only the Genovus team records consultations.'; end if;
  select * into ci from consult_invites where id = p_invite for update;
  if ci.id is null then raise exception 'That consultation wasn''t found.'; end if;
  update consult_invites set objection = coalesce(o, objection), call_note = coalesce(nullif(left(trim(coalesce(p_note, '')), 2000), ''), call_note) where id = ci.id;
  perform log_event(ci.tenant_id, 'consult.notes', left(ci.label, 80) || coalesce(' · objection: ' || o, ''), null, null);
end $$;
revoke all on function set_consult_notes(uuid, text, text) from public, anon;
grant execute on function set_consult_notes(uuid, text, text) to authenticated;

drop function if exists log_prospect(uuid, text, text, text, text, timestamptz, text, text, text, text, text);
create or replace function log_prospect(p_id uuid, p_kind text, p_outcome text, p_note text, p_status text default null, p_next timestamptz default null,
  p_contact_name text default null, p_contact_email text default null, p_contact_phone text default null,
  p_known_name text default null, p_known_address text default null, p_objection text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pr prospects; nm text := nullif(left(trim(coalesce(p_known_name, '')), 160), ''); ad text := nullif(left(trim(coalesce(p_known_address, '')), 240), '');
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  select * into pr from prospects where id = p_id for update;
  if pr.id is null then raise exception 'prospect not found'; end if;
  insert into prospect_events (prospect_id, kind, outcome, note, actor, objection) values (p_id, p_kind, nullif(p_outcome, ''), nullif(left(p_note, 2000), ''), auth.uid(), nullif(p_objection, ''));
  update prospects set
    status = coalesce(nullif(p_status, ''), status),
    next_action_at = coalesce(p_next, case when nullif(p_status, '') in ('opted_out','closed','won','not_now') then null else next_action_at end),
    contact_name = coalesce(nullif(trim(p_contact_name), ''), contact_name),
    contact_email = coalesce(nullif(lower(trim(p_contact_email)), ''), contact_email),
    contact_phone = coalesce(nullif(trim(p_contact_phone), ''), contact_phone),
    known_name = coalesce(nm, known_name),
    known_address = coalesce(ad, known_address),
    known_at = case when nm is not null or ad is not null then now() else known_at end,
    known_by = case when nm is not null or ad is not null then auth.uid() else known_by end,
    owner = coalesce(owner, auth.uid())
  where id = p_id;
  if p_status = 'opted_out' then
    insert into suppression (place_id, reason) values (pr.place_id, 'opted out: ' || coalesce(p_note, p_outcome, '')) on conflict (place_id) do nothing;
    if coalesce(nullif(trim(p_contact_email), ''), pr.contact_email) is not null then
      insert into suppression (email, reason) values (lower(coalesce(nullif(trim(p_contact_email), ''), pr.contact_email)), 'opted out') on conflict (email) do nothing;
    end if;
  end if;
  perform log_event(null, 'prospect.' || p_kind, pr.code, jsonb_build_object('status', pr.status), jsonb_build_object('status', coalesce(nullif(p_status, ''), pr.status), 'outcome', p_outcome, 'objection', nullif(p_objection, '')));
end $$;

revoke all on function log_prospect(uuid, text, text, text, text, timestamptz, text, text, text, text, text, text) from public, anon;
grant execute on function log_prospect(uuid, text, text, text, text, timestamptz, text, text, text, text, text, text) to authenticated;
