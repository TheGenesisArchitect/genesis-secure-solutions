-- The Agency Growth Engine: one market-aware loop per agency. The agency profile (office, lines, radius) is the
-- single source of truth the radar, calls, Market and Helix read. Calls through tracking numbers become leads; a
-- missed call becomes a "Call back" follow-up. The partner radar maps referral partners near the office (only
-- businesses whose customers buy the agency's lines) and stores only place IDs and our own classification.
-- Helix's morning brief is cached per agency per day. Everything is tenant-scoped; members read, staff manage.

-- ---------- Agency profile ----------
create table if not exists agency_profiles (
  tenant_id uuid primary key references tenants on delete cascade,
  address text check (address is null or length(address) <= 200),
  city text check (city is null or length(city) <= 80),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  zip text check (zip is null or zip ~ '^\d{5}$'),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  lines text[] not null default '{}',
  service_radius_mi int not null default 15 check (service_radius_mi between 3 and 50),
  licensed_states text[] not null default '{}',
  carrier text check (carrier is null or length(carrier) <= 80),
  main_phone_e164 text check (main_phone_e164 is null or main_phone_e164 ~ '^\+1\d{10}$'),
  website text check (website is null or website ~ '^https://\S{3,200}$'),
  timezone text not null default 'America/New_York',
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now()
);
alter table agency_profiles enable row level security;
create policy r on agency_profiles for select to authenticated using (is_staff() or is_member(tenant_id));

create or replace function save_agency_profile(p_tenant uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare lines text[]; states text[];
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  select coalesce(array_agg(x), '{}') into lines from jsonb_array_elements_text(coalesce(p->'lines', '[]')) x
    where x in ('auto','home','renters','boat','rv','motorcycle','condo','umbrella','life','commercial');
  select coalesce(array_agg(upper(x)), '{}') into states from jsonb_array_elements_text(coalesce(p->'licensed_states', '[]')) x where upper(x) ~ '^[A-Z]{2}$';
  insert into agency_profiles (tenant_id, address, city, state, zip, lat, lng, lines, service_radius_mi, licensed_states, carrier, main_phone_e164, website, updated_by, updated_at)
  values (p_tenant, nullif(trim(p->>'address'), ''), nullif(trim(p->>'city'), ''), nullif(upper(trim(p->>'state')), ''), nullif(trim(p->>'zip'), ''),
    (p->>'lat')::double precision, (p->>'lng')::double precision, lines, coalesce((p->>'service_radius_mi')::int, 15), states,
    nullif(trim(p->>'carrier'), ''), nullif(trim(p->>'main_phone_e164'), ''), nullif(rtrim(trim(p->>'website'), '/'), ''), auth.uid(), now())
  on conflict (tenant_id) do update set address = excluded.address, city = excluded.city, state = excluded.state, zip = excluded.zip,
    lat = excluded.lat, lng = excluded.lng, lines = excluded.lines, service_radius_mi = excluded.service_radius_mi,
    licensed_states = excluded.licensed_states, carrier = excluded.carrier, main_phone_e164 = excluded.main_phone_e164, website = excluded.website,
    updated_by = excluded.updated_by, updated_at = now();
  perform log_event(p_tenant, 'agency_profile.save', array_to_string(lines, ', '), null, null);
end $$;
revoke execute on function save_agency_profile(uuid, jsonb) from public, anon;
grant execute on function save_agency_profile(uuid, jsonb) to authenticated;

-- ---------- Leads: how they reached the agency, and the partner who sent them ----------
alter table leads add column if not exists channel text not null default 'form' check (channel in ('form','call','partner','meta'));
alter table leads add column if not exists partner_id uuid;

-- ---------- Call tracking ----------
create table if not exists tracking_numbers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  e164 text not null unique check (e164 ~ '^\+1\d{10}$'),
  twilio_sid text unique,
  label text not null default 'Website',
  source text not null default 'website' check (source ~ '^[a-z0-9-]{2,40}$'),
  forward_to text not null check (forward_to ~ '^\+1\d{10}$'),
  record boolean not null default true,
  created_at timestamptz not null default now(),
  released_at timestamptz
);
alter table tracking_numbers enable row level security;
create policy r on tracking_numbers for select to authenticated using (is_staff() or is_member(tenant_id));

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  number_id uuid references tracking_numbers on delete set null,
  call_sid text not null unique,
  from_e164 text,
  started_at timestamptz not null default now(),
  duration_s int not null default 0,
  status text not null default 'ringing' check (status in ('ringing','answered','missed')),
  recording_sid text,
  recording_s int,
  summary text check (summary is null or length(summary) <= 1500),
  lead_id uuid references leads on delete set null
);
create index if not exists calls_tenant_recent on calls (tenant_id, started_at desc);
alter table calls enable row level security;
create policy r on calls for select to authenticated using (is_staff() or is_member(tenant_id));

-- Record a number Genovus bought for an agency (server, after Twilio confirms the purchase).
create or replace function add_tracking_number(p_tenant uuid, p_e164 text, p_sid text, p_label text, p_source text, p_forward text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  insert into tracking_numbers (tenant_id, e164, twilio_sid, label, source, forward_to) values (p_tenant, p_e164, p_sid, left(p_label, 60), p_source, p_forward) returning id into nid;
  perform log_event(p_tenant, 'tracking_number.add', p_label || ' ' || p_e164, null, null);
  return nid;
end $$;
revoke execute on function add_tracking_number(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function add_tracking_number(uuid, text, text, text, text, text) to service_role;

-- One call event from Twilio (server only, after the signature check). The first event for a call creates it;
-- when it ends, the call joins a lead from the same number in the last 30 days or starts a new one, and a missed
-- call adds a "Call back" follow-up due now.
create or replace function ingest_call(p_to text, p_sid text, p_from text, p_status text, p_duration int, p_recording_sid text, p_recording_s int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n tracking_numbers; c calls; lid uuid; final text; today date := (now() at time zone 'America/New_York')::date; d text; pretty text;
begin
  select * into n from tracking_numbers where e164 = p_to and released_at is null;
  if n.id is null then raise exception 'unknown tracking number'; end if;
  insert into calls (tenant_id, number_id, call_sid, from_e164) values (n.tenant_id, n.id, left(p_sid, 64), nullif(left(p_from, 20), ''))
  on conflict (call_sid) do nothing;
  select * into c from calls where call_sid = p_sid for update;
  if p_recording_sid is not null then
    update calls set recording_sid = left(p_recording_sid, 64), recording_s = p_recording_s where id = c.id;
  end if;
  if p_status is null or c.status <> 'ringing' then return jsonb_build_object('call', c.id, 'lead', c.lead_id); end if;
  d := right(regexp_replace(coalesce(c.from_e164, ''), '\D', '', 'g'), 10);
  pretty := case when length(d) = 10 then '(' || substr(d, 1, 3) || ') ' || substr(d, 4, 3) || '-' || substr(d, 7, 4) else 'unknown number' end;
  final := case when p_status = 'answered' then 'answered' else 'missed' end;
  select id into lid from leads where tenant_id = n.tenant_id and length(regexp_replace(coalesce(c.from_e164, ''), '\D', '', 'g')) >= 10 and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(c.from_e164, '\D', '', 'g'), 10) and created_at > now() - interval '30 days' order by created_at desc limit 1;
  if lid is null then
    insert into leads (tenant_id, ext_id, name, phone, topic, source, medium, channel, consent_text)
    values (n.tenant_id, 'call:' || c.call_sid, 'Caller ' || coalesce(right(c.from_e164, 4), 'unknown'), c.from_e164, 'Phone call', n.source, 'call', 'call',
      'Called the office at ' || n.e164 || ' (' || n.label || '). No texting consent.')
    returning id into lid;
    perform log_event(n.tenant_id, 'lead.received', 'Call from ' || n.source, null, null);
  end if;
  update calls set status = final, duration_s = coalesce(p_duration, 0), lead_id = lid where id = c.id;
  if final = 'missed' then
    insert into follow_ups (tenant_id, who, reason, due_on, due_at)
    values (n.tenant_id, 'Caller ' || pretty, 'Missed call to the ' || n.label || ' line: call back', today, to_char(now() at time zone 'America/New_York', 'HH24:MI')::time);
  end if;
  return jsonb_build_object('call', c.id, 'lead', lid, 'status', final);
end $$;
revoke execute on function ingest_call(text, text, text, text, int, text, int) from public, anon, authenticated;
grant execute on function ingest_call(text, text, text, text, int, text, int) to service_role;

-- ---------- Referral partner radar ----------
create table if not exists partner_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  place_id text not null,
  line text not null,
  category text not null,
  distance_mi numeric(5,1),
  fit int not null default 50,
  status text not null default 'new' check (status in ('new','called','meeting','partner','referring','not_now','opted_out')),
  ref_code text not null default substr(md5(gen_random_uuid()::text), 1, 8),
  next_action_at timestamptz,
  contact_name text check (contact_name is null or length(contact_name) <= 120),
  contact_phone text check (contact_phone is null or length(contact_phone) <= 40),
  contact_email text check (contact_email is null or length(contact_email) <= 200),
  notes text check (notes is null or length(notes) <= 2000),
  first_seen timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, place_id),
  unique (tenant_id, ref_code)
);
create index if not exists partner_targets_desk on partner_targets (tenant_id, status, fit desc);
alter table partner_targets enable row level security;
create policy r on partner_targets for select to authenticated using (is_staff() or is_member(tenant_id));

create table if not exists partner_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  partner_id uuid not null references partner_targets on delete cascade,
  kind text not null check (kind in ('call','visit','note','status','referral')),
  outcome text,
  note text check (note is null or length(note) <= 2000),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
alter table partner_events enable row level security;
create policy r on partner_events for select to authenticated using (is_staff() or is_member(tenant_id));

create table if not exists partner_scans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  cap_cents int not null default 2500 check (cap_cents between 0 and 10000),
  radius_mi int not null,
  queue jsonb not null default '[]',
  requests int not null default 0,
  cost_cents numeric not null default 0,
  found int not null default 0,
  status text not null default 'running' check (status in ('running','done','budget','stopped')),
  started_by uuid references auth.users on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table partner_scans enable row level security;
create policy r on partner_scans for select to authenticated using (is_staff());

-- Work a partner (members and staff): log a call or visit outcome, move its status, note a contact.
create or replace function log_partner(p_id uuid, p_kind text, p_status text, p_note text, p_next timestamptz, p_contact jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare t partner_targets;
begin
  select * into t from partner_targets where id = p_id for update;
  if t.id is null or not (is_staff() or is_member(t.tenant_id)) then raise exception 'not allowed'; end if;
  if p_status is not null and p_status not in ('new','called','meeting','partner','referring','not_now','opted_out') then raise exception 'invalid status'; end if;
  insert into partner_events (tenant_id, partner_id, kind, outcome, note, created_by)
  values (t.tenant_id, t.id, coalesce(p_kind, 'note'), p_status, nullif(left(trim(coalesce(p_note, '')), 2000), ''), auth.uid());
  update partner_targets set status = coalesce(p_status, status), next_action_at = coalesce(p_next, next_action_at),
    contact_name = coalesce(nullif(trim(p_contact->>'name'), ''), contact_name),
    contact_phone = coalesce(nullif(trim(p_contact->>'phone'), ''), contact_phone),
    contact_email = coalesce(nullif(lower(trim(p_contact->>'email')), ''), contact_email),
    notes = coalesce(nullif(left(trim(coalesce(p_note, '')), 2000), ''), notes), updated_at = now()
  where id = p_id;
  if p_status = 'opted_out' then insert into suppression (place_id, reason) values (t.place_id, 'Partner asked not to be contacted') on conflict do nothing; end if;
  perform log_event(t.tenant_id, 'partner.' || coalesce(p_status, p_kind, 'note'), t.category, null, null);
end $$;
revoke execute on function log_partner(uuid, text, text, text, timestamptz, jsonb) from public, anon;
grant execute on function log_partner(uuid, text, text, text, timestamptz, jsonb) to authenticated;

-- A referral from a partner's link (utm_source=partner&utm_campaign=<ref_code>): ingest_lead tags it.
create or replace function link_partner_lead() returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if new.source = 'partner' and new.campaign is not null and new.partner_id is null then
    select id into pid from partner_targets where tenant_id = new.tenant_id and ref_code = lower(new.campaign);
    if pid is not null then
      new.partner_id := pid; new.channel := 'partner';
      update partner_targets set status = 'referring', updated_at = now() where id = pid and status in ('new','called','meeting','partner');
      insert into partner_events (tenant_id, partner_id, kind, note) values (new.tenant_id, pid, 'referral', 'Referred ' || new.name);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists leads_partner on leads;
create trigger leads_partner before insert on leads for each row execute function link_partner_lead();

-- ---------- What sources cost (for cost per lead against the $50 vendor price) ----------
create table if not exists source_costs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  month date not null check (extract(day from month) = 1),
  source text not null check (source ~ '^[a-z0-9-]{2,40}$'),
  cents int not null check (cents between 0 and 10000000),
  note text,
  updated_at timestamptz not null default now(),
  unique (tenant_id, month, source)
);
alter table source_costs enable row level security;
create policy r on source_costs for select to authenticated using (is_staff() or is_member(tenant_id));

create or replace function set_source_cost(p_tenant uuid, p_month date, p_source text, p_cents int, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_staff() or is_member(p_tenant)) then raise exception 'not allowed'; end if;
  insert into source_costs (tenant_id, month, source, cents, note) values (p_tenant, date_trunc('month', p_month)::date, lower(p_source), p_cents, nullif(left(trim(coalesce(p_note, '')), 200), ''))
  on conflict (tenant_id, month, source) do update set cents = excluded.cents, note = excluded.note, updated_at = now();
  perform log_event(p_tenant, 'source_cost.set', p_source || ' ' || to_char(p_month, 'Mon YYYY'), null, jsonb_build_object('cents', p_cents));
end $$;
revoke execute on function set_source_cost(uuid, date, text, int, text) from public, anon;
grant execute on function set_source_cost(uuid, date, text, int, text) to authenticated;

-- ---------- Helix's morning brief (made once a day per agency, read by Home) ----------
create table if not exists helix_briefs (
  tenant_id uuid not null references tenants on delete cascade,
  day date not null,
  body jsonb not null,
  model text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, day)
);
alter table helix_briefs enable row level security;
create policy r on helix_briefs for select to authenticated using (is_staff() or is_member(tenant_id));

-- A recording finished (server only): attach it to its call, and later the call summary Helix writes.
create or replace function attach_call_recording(p_call_sid text, p_recording_sid text, p_seconds int)
returns uuid language sql security definer set search_path = public as $$
  update calls set recording_sid = left(p_recording_sid, 64), recording_s = p_seconds where call_sid = p_call_sid returning tenant_id
$$;
revoke execute on function attach_call_recording(text, text, int) from public, anon, authenticated;
grant execute on function attach_call_recording(text, text, int) to service_role;

create or replace function set_call_summary(p_call_sid text, p_summary text)
returns void language sql security definer set search_path = public as $$
  update calls set summary = left(p_summary, 1500) where call_sid = p_call_sid
$$;
revoke execute on function set_call_summary(text, text) from public, anon, authenticated;
grant execute on function set_call_summary(text, text) to service_role;

-- Release a tracking number (staff, after Twilio releases it): it stops ringing the office; its calls stay.
create or replace function release_tracking_number(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n tracking_numbers;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  update tracking_numbers set released_at = now() where id = p_id and released_at is null returning * into n;
  if n.id is not null then perform log_event(n.tenant_id, 'tracking_number.release', n.label || ' ' || n.e164, null, null); end if;
end $$;
revoke execute on function release_tracking_number(uuid) from public, anon;
grant execute on function release_tracking_number(uuid) to authenticated;
