-- Onboarding picks the package: convert_prospect now takes the package (Launch, Growth or Premium) and keeps it, with
-- the address the team confirmed, on the client's draft record. The plan itself still changes only when the upgrade
-- invoice is paid; the package's features are switched on as a 30-day trial by the server (lib/scan-actions.ts),
-- the same way an agency gets a trial grant.

drop function if exists convert_prospect(uuid, text, text, text, text, text, text, text, text, text);
create or replace function convert_prospect(p_id uuid, p_slug text, p_name text, p_contact text default null, p_email text default null,
  p_phone text default null, p_city text default null, p_state text default null, p_website text default null, p_note text default null,
  p_package text default 'launch')
returns uuid language plpgsql security definer set search_path = public as $$
declare pr prospects; tid uuid; carrier_name text; nm text := nullif(left(trim(coalesce(p_name, '')), 160), '');
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can start onboarding'; end if;
  select * into pr from prospects where id = p_id for update;
  if pr.id is null then raise exception 'prospect not found'; end if;
  if pr.tenant_id is not null then return pr.tenant_id; end if;
  if pr.status = 'opted_out' then raise exception 'this office asked not to be contacted'; end if;
  if nm is null then raise exception 'the agency name is needed'; end if;
  if coalesce(p_package, '') not in ('launch','growth','premium') then raise exception 'pick a package: Launch, Growth or Premium'; end if;
  if coalesce(p_slug, '') !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then raise exception 'pick a web address of 3 to 50 lowercase letters, numbers and dashes'; end if;
  if nullif(trim(coalesce(p_email, '')), '') is not null and trim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'that email doesn''t look right'; end if;
  select name into carrier_name from carriers where id = pr.carrier_id;
  insert into tenants (slug, name, stage, account_lead) values (p_slug, nm, 'consult', auth.uid()) returning id into tid;
  insert into lifecycle_events (tenant_id, from_stage, to_stage, note, actor) values (tid, 'attract', 'consult', coalesce(nullif(left(trim(coalesce(p_note, '')), 300), ''), 'From a prospect the scanner found'), auth.uid());
  insert into agent_records (tenant_id, version, data, is_current, note, created_by)
  values (tid, 1, jsonb_strip_nulls(jsonb_build_object(
      'agencyName', nm,
      'contactName', nullif(left(trim(coalesce(p_contact, '')), 120), ''),
      'email', nullif(lower(left(trim(coalesce(p_email, '')), 200)), ''),
      'phone', nullif(left(trim(coalesce(p_phone, '')), 40), ''),
      'city', nullif(left(trim(coalesce(p_city, '')), 80), ''),
      'state', nullif(upper(left(trim(coalesce(p_state, pr.state, '')), 2)), ''),
      'website', nullif(left(trim(coalesce(p_website, '')), 200), ''),
      'carrier', carrier_name,
      'address', pr.known_address,
      'package', p_package,
      'segment', pr.segment,
      'prospectCode', pr.code)),
    true, 'Draft from prospect ' || pr.code, auth.uid());
  insert into gates (tenant_id, kind) select tid, k from unnest(array['photo_rights','carrier_approval','carrier_rules','meta_access','domain','privacy_notice','kickoff']) k;
  update prospects set status = 'consult', tenant_id = tid, known_name = coalesce(known_name, nm), known_at = coalesce(known_at, now()), known_by = coalesce(known_by, auth.uid()),
    contact_name = coalesce(nullif(trim(p_contact), ''), contact_name), contact_email = coalesce(nullif(lower(trim(p_email)), ''), contact_email), contact_phone = coalesce(nullif(trim(p_phone), ''), contact_phone),
    owner = coalesce(owner, auth.uid()) where id = p_id;
  insert into prospect_events (prospect_id, kind, outcome, note, actor) values (p_id, 'note', null, 'Onboarding started: client ' || p_slug, auth.uid());
  perform log_event(tid, 'prospect.convert', nm, null, jsonb_build_object('slug', p_slug, 'prospect', pr.code, 'package', p_package));
  return tid;
end $$;


revoke all on function convert_prospect(uuid, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function convert_prospect(uuid, text, text, text, text, text, text, text, text, text, text) to authenticated;
