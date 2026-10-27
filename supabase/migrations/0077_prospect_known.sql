-- Prospects the team has worked keep the business name and address the team confirmed on a call, as Genovus's own
-- record (the same middle ground as partner_targets.known_name). Google's live details still lead when available;
-- these keep the office recognizable when Google lookups are paused. Staff only, like the rest of prospects.

alter table prospects
  add column if not exists known_name text check (known_name is null or length(known_name) <= 160),
  add column if not exists known_address text check (known_address is null or length(known_address) <= 240),
  add column if not exists known_at timestamptz,
  add column if not exists known_by uuid references auth.users on delete set null;

drop function if exists log_prospect(uuid, text, text, text, text, timestamptz, text, text, text);
create or replace function log_prospect(p_id uuid, p_kind text, p_outcome text, p_note text, p_status text default null, p_next timestamptz default null,
  p_contact_name text default null, p_contact_email text default null, p_contact_phone text default null,
  p_known_name text default null, p_known_address text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pr prospects; nm text := nullif(left(trim(coalesce(p_known_name, '')), 160), ''); ad text := nullif(left(trim(coalesce(p_known_address, '')), 240), '');
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  select * into pr from prospects where id = p_id for update;
  if pr.id is null then raise exception 'prospect not found'; end if;
  insert into prospect_events (prospect_id, kind, outcome, note, actor) values (p_id, p_kind, nullif(p_outcome, ''), nullif(left(p_note, 2000), ''), auth.uid());
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
  perform log_event(null, 'prospect.' || p_kind, pr.code, jsonb_build_object('status', pr.status), jsonb_build_object('status', coalesce(nullif(p_status, ''), pr.status), 'outcome', p_outcome));
end $$;

revoke all on function log_prospect(uuid, text, text, text, text, timestamptz, text, text, text, text, text) from public, anon;
grant execute on function log_prospect(uuid, text, text, text, text, timestamptz, text, text, text, text, text) to authenticated;
