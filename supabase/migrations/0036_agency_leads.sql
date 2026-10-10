-- Agency leads: every callback from an agency's own website lands in its Genovus dashboard, tagged with where it
-- came from, with the consent the visitor gave. Leads arrive only through ingest_lead (server to server, with the
-- agency's lead key; the key decides the agency, never the payload). Members and staff read them; status changes
-- go through update_lead and are written to the audit log.

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  ext_id text,
  name text not null check (length(name) between 1 and 120),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or length(phone) <= 40),
  topic text check (topic is null or length(topic) <= 120),
  message text check (message is null or length(message) <= 2000),
  source text not null default 'direct',
  medium text,
  campaign text,
  attribution jsonb not null default '{}',
  consent_text text not null,
  consent_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new','contacted','booked','won','lost')),
  first_contact_at timestamptz,
  note text check (note is null or length(note) <= 2000),
  updated_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, ext_id)
);
create index if not exists leads_tenant_recent on leads (tenant_id, created_at desc);
create index if not exists leads_tenant_status on leads (tenant_id, status);
alter table leads enable row level security;
create policy r on leads for select to authenticated using (is_staff() or is_member(tenant_id));

-- An agency's lead keys: only a hash is stored; the key itself is shown once to staff when issued.
create table if not exists lead_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  key_hash text not null unique,
  label text not null default 'Website',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table lead_keys enable row level security;
create policy r on lead_keys for select to authenticated using (is_staff());

-- Issue a key for an agency (staff): the server generates the key and passes only its hash.
create or replace function issue_lead_key(p_tenant uuid, p_label text, p_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid key hash'; end if;
  insert into lead_keys (tenant_id, key_hash, label, created_by) values (p_tenant, p_hash, coalesce(nullif(trim(p_label), ''), 'Website'), auth.uid()) returning id into nid;
  perform log_event(p_tenant, 'lead_key.issue', coalesce(nullif(trim(p_label), ''), 'Website'), null, null);
  return nid;
end $$;
revoke execute on function issue_lead_key(uuid, text, text) from public, anon;
grant execute on function issue_lead_key(uuid, text, text) to authenticated;

create or replace function revoke_lead_key(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare k lead_keys;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  update lead_keys set revoked_at = now() where id = p_id and revoked_at is null returning * into k;
  if k.id is not null then perform log_event(k.tenant_id, 'lead_key.revoke', k.label, null, null); end if;
end $$;
revoke execute on function revoke_lead_key(uuid) from public, anon;
grant execute on function revoke_lead_key(uuid) to authenticated;

-- Take in one lead (server only). The key's hash picks the agency; ext_id makes a retried delivery a no-op.
create or replace function ingest_lead(p_key_hash text, p_ext_id text, p_name text, p_email text, p_phone text, p_topic text,
  p_message text, p_source text, p_medium text, p_campaign text, p_attribution jsonb, p_consent text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k lead_keys; nid uuid;
begin
  select * into k from lead_keys where key_hash = p_key_hash and revoked_at is null;
  if k.id is null then raise exception 'unknown lead key'; end if;
  if length(trim(coalesce(p_consent, ''))) < 10 then raise exception 'consent text required'; end if;
  insert into leads (tenant_id, ext_id, name, email, phone, topic, message, source, medium, campaign, attribution, consent_text)
  values (k.tenant_id, nullif(left(p_ext_id, 120), ''), left(trim(p_name), 120), nullif(lower(trim(p_email)), ''), nullif(left(trim(p_phone), 40), ''),
    nullif(left(trim(p_topic), 120), ''), nullif(left(p_message, 2000), ''), coalesce(nullif(left(lower(trim(p_source)), 80), ''), 'direct'),
    nullif(left(lower(trim(p_medium)), 80), ''), nullif(left(trim(p_campaign), 120), ''), coalesce(p_attribution, '{}'), left(trim(p_consent), 500))
  on conflict (tenant_id, ext_id) do nothing
  returning id into nid;
  update lead_keys set last_used_at = now() where id = k.id;
  if nid is not null then perform log_event(k.tenant_id, 'lead.received', 'Lead from ' || coalesce(nullif(lower(trim(p_source)), ''), 'direct'), null, null); end if;
  return jsonb_build_object('id', nid, 'duplicate', nid is null);
end $$;
revoke execute on function ingest_lead(text, text, text, text, text, text, text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function ingest_lead(text, text, text, text, text, text, text, text, text, text, jsonb, text) to service_role;

-- Work a lead (agency members and staff): contacted, booked, won, lost, or back to new; with a note.
create or replace function update_lead(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare l leads;
begin
  select * into l from leads where id = p_id for update;
  if l.id is null or not (is_staff() or is_member(l.tenant_id)) then raise exception 'not allowed'; end if;
  if p_status not in ('new','contacted','booked','won','lost') then raise exception 'invalid status'; end if;
  update leads set status = p_status,
    first_contact_at = case when l.first_contact_at is null and p_status <> 'new' then now() else l.first_contact_at end,
    note = coalesce(nullif(left(trim(coalesce(p_note, '')), 2000), ''), l.note), updated_by = auth.uid(), updated_at = now()
  where id = p_id;
  perform log_event(l.tenant_id, 'lead.' || p_status, 'Lead from ' || l.source, jsonb_build_object('status', l.status), jsonb_build_object('status', p_status));
end $$;
revoke execute on function update_lead(uuid, text, text) from public, anon;
grant execute on function update_lead(uuid, text, text) to authenticated;

-- A staff member copied a one-time sign-in link for a member of this agency: recorded under that staff member.
create or replace function log_staff_signin_link(p_tenant uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  perform log_event(p_tenant, 'signin.staff_link', lower(trim(p_email)), null, null);
end $$;
revoke execute on function log_staff_signin_link(uuid, text) from public, anon;
grant execute on function log_staff_signin_link(uuid, text) to authenticated;
