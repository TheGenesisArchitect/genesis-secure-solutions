-- Lead Engine P1, slice 1 (docs/LEAD_ENGINE_SPEC.md §4.1–4.2): the consent ledger and one contact per person.
--  * lead_consents: one row per time a person agreed, with the exact text shown (and its sha256 version), the channels
--    it covers, and where it was given. Append-only: only a revocation and the TrustedForm certificate can be added,
--    once each. A row goes only with its lead (deleting the lead or the agency).
--  * contacts: one per person per agency, by normalized phone (+1 and ten digits) or email (lowercase; Gmail +tags
--    dropped). Every lead points at its contact.
--  * A person who asks again within 30 days joins their open lead (lead_events 'repeat', asks + 1, "asked again"
--    alert at most once a day) instead of making a new one. A retried delivery (same ext id) stays a no-op.
--  * ingest_call matches callers through the contact instead of its own 30-day phone match.
--  * Any other insert still gets its contact (before insert) and its consent row from consent_text (at commit).
--  * consent_allows(lead, channel): the one gate the engine checks before any touch. A revocation on any of the
--    person's leads revokes every channel for this agency (the FCC revoke-all rule, 2027-01-31) until they give
--    consent again. SMS is never allowed here until A2P 10DLC.
--  * leads.partner_id gets its foreign key (deferred from P0).
-- ingest_lead and site_lead keep their arguments (new ones have defaults), so the release before this one keeps working.

-- ---------- Normalizers ----------
create or replace function norm_phone(p text) returns text language sql immutable set search_path = public as $$
  select case when d ~ '^1[2-9]\d{9}$' then '+' || d when d ~ '^[2-9]\d{9}$' then '+1' || d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x
$$;

create or replace function norm_email(p text) returns text language sql immutable set search_path = public as $$
  select case when e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(e) > 200 then null
    when split_part(e, '@', 2) in ('gmail.com', 'googlemail.com') then split_part(split_part(e, '@', 1), '+', 1) || '@gmail.com'
    else e end
  from (select lower(trim(coalesce(p, ''))) e) x
$$;

-- ---------- Contacts ----------
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+1\d{10}$'),
  email_norm text check (email_norm is null or length(email_norm) <= 200),
  household_key text check (household_key is null or length(household_key) <= 160),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  check (phone_e164 is not null or email_norm is not null)
);
create unique index if not exists contacts_phone on contacts (tenant_id, phone_e164) where phone_e164 is not null;
create unique index if not exists contacts_email on contacts (tenant_id, email_norm) where email_norm is not null;
alter table contacts enable row level security;
create policy r on contacts for select to authenticated using (is_staff() or is_member(tenant_id));

alter table leads add column if not exists contact_id uuid references contacts on delete set null;
alter table leads add column if not exists asks int not null default 1;
alter table leads add column if not exists last_asked_at timestamptz;
create index if not exists leads_contact on leads (contact_id, created_at desc) where contact_id is not null;

-- The person behind a phone and/or email (server only). Phone first, then email; fills in what the contact lacked,
-- never taking a phone or email another contact already has.
create or replace function lead_contact(p_tenant uuid, p_phone text, p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare ph text := norm_phone(p_phone); em text := norm_email(p_email); cid uuid;
begin
  if ph is null and em is null then return null; end if;
  if ph is not null then select id into cid from contacts where tenant_id = p_tenant and phone_e164 = ph; end if;
  if cid is null and em is not null then select id into cid from contacts where tenant_id = p_tenant and email_norm = em; end if;
  if cid is null then
    insert into contacts (tenant_id, phone_e164, email_norm) values (p_tenant, ph, em) on conflict do nothing returning id into cid;
    if cid is null then -- another request made it a moment ago
      select id into cid from contacts where tenant_id = p_tenant and ((ph is not null and phone_e164 = ph) or (em is not null and email_norm = em)) limit 1;
    end if;
    return cid;
  end if;
  begin
    update contacts c set last_seen = now(),
      phone_e164 = coalesce(c.phone_e164, case when not exists (select 1 from contacts o where o.tenant_id = p_tenant and o.phone_e164 = ph) then ph end),
      email_norm = coalesce(c.email_norm, case when not exists (select 1 from contacts o where o.tenant_id = p_tenant and o.email_norm = em) then em end)
    where c.id = cid;
  exception when unique_violation then
    update contacts set last_seen = now() where id = cid;
  end;
  return cid;
end $$;
revoke all on function lead_contact(uuid, text, text) from public, anon, authenticated;

-- ---------- Consent ledger ----------
create table if not exists consent_texts (
  version text primary key check (version ~ '^[0-9a-f]{64}$'),
  text text not null check (length(text) between 10 and 1000),
  first_seen timestamptz not null default now()
);
alter table consent_texts enable row level security;
create policy r on consent_texts for select to authenticated using (is_staff());

create table if not exists lead_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  lead_id uuid not null references leads on delete cascade,
  seller_name text not null check (length(seller_name) between 1 and 160),
  text text not null check (length(text) between 10 and 1000),
  text_version text not null references consent_texts,
  channels text[] not null default '{}' check (channels <@ array['call','autodial_ai','email','sms']),
  not_condition_of_purchase boolean not null default false,
  page_url text check (page_url is null or length(page_url) <= 500),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{32}$'),
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  client_at timestamptz,
  received_at timestamptz not null default now(),
  cert_id text check (cert_id is null or length(cert_id) <= 200),
  cert_retained_at timestamptz,
  revoked_at timestamptz,
  revoked_via text check (revoked_via is null or revoked_via in ('stop','unsubscribe','call','email','staff','other'))
);
create index if not exists lead_consents_lead on lead_consents (lead_id, received_at desc);
create index if not exists lead_consents_tenant on lead_consents (tenant_id, received_at desc);
alter table lead_consents enable row level security;
create policy r on lead_consents for select to authenticated using (is_staff() or is_member(tenant_id));

-- Append-only. A delete is allowed only as part of deleting its lead or agency (a cascade, so trigger depth > 1).
create or replace function lead_consents_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'consent records are kept: one goes only with its lead';
  end if;
  if (new.id, new.tenant_id, new.lead_id, new.seller_name, new.text, new.text_version, new.channels, new.not_condition_of_purchase,
      new.page_url, new.ip_hash, new.user_agent, new.client_at, new.received_at)
     is distinct from (old.id, old.tenant_id, old.lead_id, old.seller_name, old.text, old.text_version, old.channels, old.not_condition_of_purchase,
      old.page_url, old.ip_hash, old.user_agent, old.client_at, old.received_at)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     or (old.revoked_via is not null and new.revoked_via is distinct from old.revoked_via)
     or (old.cert_id is not null and new.cert_id is distinct from old.cert_id)
     or (old.cert_retained_at is not null and new.cert_retained_at is distinct from old.cert_retained_at) then
    raise exception 'consent records are append-only: only a revocation or a certificate can be added, once';
  end if;
  return new;
end $$;
drop trigger if exists lead_consents_guard on lead_consents;
create trigger lead_consents_guard before update or delete on lead_consents for each row execute function lead_consents_guard();

-- Record what a person agreed to (server only). p_meta: seller, page_url, ip_hash, user_agent, client_at (ISO, checked
-- by the caller), not_condition.
create or replace function record_consent(p_tenant uuid, p_lead uuid, p_text text, p_channels text[], p_meta jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare txt text := left(trim(coalesce(p_text, '')), 1000); v text; m jsonb := coalesce(p_meta, '{}'); nid uuid;
begin
  if length(txt) < 10 then raise exception 'consent text required'; end if;
  v := encode(sha256(convert_to(txt, 'UTF8')), 'hex');
  insert into consent_texts (version, text) values (v, txt) on conflict do nothing;
  insert into lead_consents (tenant_id, lead_id, seller_name, text, text_version, channels, not_condition_of_purchase, page_url, ip_hash, user_agent, client_at)
  values (p_tenant, p_lead, coalesce(nullif(left(trim(m->>'seller'), 160), ''), (select left(name, 160) from tenants where id = p_tenant)), txt, v,
    array(select distinct c from unnest(coalesce(p_channels, '{}')) c where c in ('call','autodial_ai','email','sms') order by 1),
    coalesce((m->>'not_condition') = 'true', false), nullif(left(m->>'page_url', 500), ''),
    case when m->>'ip_hash' ~ '^[0-9a-f]{32}$' then m->>'ip_hash' end, nullif(left(m->>'user_agent', 300), ''),
    case when m->>'client_at' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$' then (m->>'client_at')::timestamptz end)
  returning id into nid;
  return nid;
end $$;
revoke all on function record_consent(uuid, uuid, text, text[], jsonb) from public, anon, authenticated;

-- May the engine reach this lead on this channel? Needs a consent naming the channel, given after the person's latest
-- revocation with this agency (a stop covers every channel and every earlier lead; asking again later is new consent).
-- SMS: never, until A2P 10DLC is registered (CLAUDE.md).
create or replace function consent_allows(p_lead uuid, p_channel text)
returns boolean language sql stable security definer set search_path = public as $$
  with l as (select id, tenant_id, contact_id from leads where id = p_lead),
  mine as (
    select c.* from lead_consents c, l
    where c.tenant_id = l.tenant_id and (c.lead_id = l.id or (l.contact_id is not null and c.lead_id in (select id from leads where contact_id = l.contact_id)))
  )
  select p_channel in ('call','autodial_ai','email')
    and exists (select 1 from mine where p_channel = any(channels)
      and received_at > coalesce((select max(revoked_at) from mine), '-infinity'::timestamptz))
$$;
revoke all on function consent_allows(uuid, text) from public, anon, authenticated;
grant execute on function consent_allows(uuid, text) to service_role;

-- The person asked the agency to stop (members and staff): every consent this person gave this agency is revoked.
create or replace function revoke_lead_consent(p_lead uuid, p_via text)
returns int language plpgsql security definer set search_path = public as $$
declare l leads; n int;
begin
  select * into l from leads where id = p_lead;
  if l.id is null or not (is_staff() or is_member(l.tenant_id)) then raise exception 'not allowed'; end if;
  if coalesce(p_via, '') not in ('stop','unsubscribe','call','email','staff','other') then raise exception 'invalid reason'; end if;
  update lead_consents set revoked_at = now(), revoked_via = p_via
  where tenant_id = l.tenant_id and revoked_at is null
    and (lead_id = l.id or (l.contact_id is not null and lead_id in (select id from leads where contact_id = l.contact_id)));
  get diagnostics n = row_count;
  insert into lead_events (tenant_id, lead_id, kind, data) values (l.tenant_id, l.id, 'consent', jsonb_build_object('revoked', p_via, 'rows', n));
  perform log_event(l.tenant_id, 'lead.consent_revoked', l.name, null, jsonb_build_object('via', p_via));
  return n;
end $$;

-- ---------- Lead events (repeat asks now; checks, routing and the cadence in later slices) ----------
create table if not exists lead_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  lead_id uuid not null references leads on delete cascade,
  kind text not null check (kind in ('repeat','call','consent','check','score','route','escalate','cadence','status','note')),
  data jsonb not null default '{}',
  at timestamptz not null default now()
);
create index if not exists lead_events_lead on lead_events (lead_id, at desc);
create index if not exists lead_events_repeat_ext on lead_events (tenant_id, (data->>'ext_id')) where kind = 'repeat';
alter table lead_events enable row level security;
create policy r on lead_events for select to authenticated using (is_staff() or is_member(tenant_id));

revoke all on function revoke_lead_consent(uuid, text) from public, anon;
grant execute on function revoke_lead_consent(uuid, text) to authenticated;

-- ---------- Alerts: a new lead, or a person asking again ----------
-- p_key makes each alert once only: the lead id for a new lead, '<id>:again:<day>' for a repeat (once a day).
create or replace function lead_alert(p_lead leads, p_extra jsonb, p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare t tenants; d jsonb; n int;
begin
  select * into t from tenants where id = p_lead.tenant_id;
  if t.id is null or t.is_sample then return; end if;
  d := jsonb_build_object('lead', p_lead.id, 'name', p_lead.name, 'phone', coalesce(p_lead.phone, ''), 'email', coalesce(p_lead.email, ''),
    'topic', coalesce(p_lead.topic, ''), 'message', left(coalesce(p_lead.message, ''), 400), 'source', p_lead.source, 'channel', p_lead.channel,
    'slug', t.slug, 'agency', t.name) || jsonb_strip_nulls(coalesce(p_extra, '{}'));
  insert into outbox (tenant_id, to_email, template, data, dedupe_key)
  select p_lead.tenant_id, u.email, 'lead_new', d, 'lead:' || p_key || ':' || u.id
  from memberships m join auth.users u on u.id = m.user_id
  where m.tenant_id = p_lead.tenant_id and m.role = 'owner' and u.email is not null
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    insert into outbox (tenant_id, to_email, template, data, dedupe_key)
    select p_lead.tenant_id, e, 'lead_new', d || jsonb_build_object('team', 'true'), 'lead:' || p_key || ':team:' || e
    from team_emails(p_lead.tenant_id) e
    on conflict (dedupe_key) do nothing;
  end if;
  if exists (select 1 from push_subscriptions s join memberships m on m.user_id = s.user_id where m.tenant_id = p_lead.tenant_id) then
    insert into outbox (tenant_id, to_email, template, data, dedupe_key)
    values (p_lead.tenant_id, 'push', 'lead_push', d, 'push:lead:' || p_key)
    on conflict (dedupe_key) do nothing;
  end if;
end $$;
revoke all on function lead_alert(leads, jsonb, text) from public, anon, authenticated;

create or replace function on_lead_new() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform lead_alert(new, '{}', new.id::text);
  return new;
end $$;

-- ---------- Taking in a lead (both capture paths) ----------
create or replace function take_lead(p_tenant uuid, p_ext_id text, p_name text, p_email text, p_phone text, p_topic text, p_message text,
  p_source text, p_medium text, p_campaign text, p_attribution jsonb, p_consent text, p_requested_for timestamptz, p_channels text[], p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ext text := nullif(left(p_ext_id, 120), ''); cid uuid; l leads; nid uuid; topic text := nullif(left(trim(p_topic), 120), '');
  msg text := nullif(left(p_message, 2000), ''); src text := coalesce(nullif(left(lower(trim(p_source)), 80), ''), 'direct');
begin
  if length(trim(coalesce(p_consent, ''))) < 10 then raise exception 'consent text required'; end if;
  -- A retried delivery: already a lead, or already counted as someone asking again.
  if ext is not null and (exists (select 1 from leads where tenant_id = p_tenant and ext_id = ext)
      or exists (select 1 from lead_events where tenant_id = p_tenant and kind = 'repeat' and data->>'ext_id' = ext)) then
    return jsonb_build_object('id', null, 'duplicate', true);
  end if;
  cid := lead_contact(p_tenant, p_phone, p_email);
  if cid is not null then
    select * into l from leads where tenant_id = p_tenant and contact_id = cid and status not in ('won','lost') and created_at > now() - interval '30 days'
    order by created_at desc limit 1 for update;
  end if;
  if l.id is not null then
    update leads set asks = asks + 1, last_asked_at = now(), updated_at = now(),
      email = coalesce(email, nullif(lower(trim(p_email)), '')), phone = coalesce(phone, nullif(left(trim(p_phone), 40), '')),
      requested_for = coalesce(p_requested_for, requested_for)
    where id = l.id returning * into l;
    insert into lead_events (tenant_id, lead_id, kind, data)
    values (p_tenant, l.id, 'repeat', jsonb_strip_nulls(jsonb_build_object('ext_id', ext, 'topic', topic, 'message', msg, 'source', src,
      'medium', nullif(left(lower(trim(p_medium)), 80), ''), 'campaign', nullif(left(trim(p_campaign), 120), ''), 'requested_for', p_requested_for,
      'attribution', nullif(coalesce(p_attribution, '{}'), '{}'::jsonb))));
    perform record_consent(p_tenant, l.id, p_consent, p_channels, p_meta);
    perform lead_alert(l, jsonb_build_object('repeat', 'true', 'asks', l.asks::text, 'topic', topic, 'message', left(msg, 400)),
      l.id || ':again:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'));
    return jsonb_build_object('id', l.id, 'duplicate', false, 'repeat', true);
  end if;
  insert into leads (tenant_id, ext_id, name, email, phone, topic, message, source, medium, campaign, attribution, consent_text, requested_for, contact_id)
  values (p_tenant, ext, left(trim(p_name), 120), nullif(lower(trim(p_email)), ''), nullif(left(trim(p_phone), 40), ''), topic, msg, src,
    nullif(left(lower(trim(p_medium)), 80), ''), nullif(left(trim(p_campaign), 120), ''), coalesce(p_attribution, '{}'), left(trim(p_consent), 500), p_requested_for, cid)
  on conflict (tenant_id, ext_id) do nothing
  returning id into nid;
  if nid is not null then perform record_consent(p_tenant, nid, p_consent, p_channels, p_meta); end if;
  return jsonb_build_object('id', nid, 'duplicate', nid is null);
end $$;
revoke all on function take_lead(uuid, text, text, text, text, text, text, text, text, text, jsonb, text, timestamptz, text[], jsonb) from public, anon, authenticated;

-- The lead API (0036), same arguments plus the consent's channels and context.
drop function if exists ingest_lead(text, text, text, text, text, text, text, text, text, text, jsonb, text);
create or replace function ingest_lead(p_key_hash text, p_ext_id text, p_name text, p_email text, p_phone text, p_topic text,
  p_message text, p_source text, p_medium text, p_campaign text, p_attribution jsonb, p_consent text,
  p_channels text[] default '{call,email}', p_meta jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare k lead_keys; r jsonb;
begin
  select * into k from lead_keys where key_hash = p_key_hash and revoked_at is null;
  if k.id is null then raise exception 'unknown lead key'; end if;
  r := take_lead(k.tenant_id, p_ext_id, p_name, p_email, p_phone, p_topic, p_message, p_source, p_medium, p_campaign, p_attribution, p_consent, null, p_channels, p_meta);
  update lead_keys set last_used_at = now() where id = k.id;
  if r->>'repeat' = 'true' then perform log_event(k.tenant_id, 'lead.repeat', 'Asked again from ' || coalesce(nullif(lower(trim(p_source)), ''), 'direct'), null, null);
  elsif r->>'id' is not null then perform log_event(k.tenant_id, 'lead.received', 'Lead from ' || coalesce(nullif(lower(trim(p_source)), ''), 'direct'), null, null); end if;
  return r;
end $$;
revoke all on function ingest_lead(text, text, text, text, text, text, text, text, text, text, jsonb, text, text[], jsonb) from public, anon, authenticated;
grant execute on function ingest_lead(text, text, text, text, text, text, text, text, text, text, jsonb, text, text[], jsonb) to service_role;

-- The hosted site (0082), same arguments plus the consent's channels and context.
drop function if exists site_lead(uuid, text, text, text, text, text, text, text, text, text, jsonb, text, timestamptz);
create or replace function site_lead(p_tenant uuid, p_ext_id text, p_name text, p_email text, p_phone text, p_topic text,
  p_message text, p_source text, p_medium text, p_campaign text, p_attribution jsonb, p_consent text, p_requested_for timestamptz default null,
  p_channels text[] default '{call,email}', p_meta jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not exists (select 1 from tenants where id = p_tenant and kind = 'agency') then raise exception 'unknown agency'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'name required'; end if;
  if nullif(trim(p_phone), '') is null and nullif(trim(p_email), '') is null then raise exception 'a phone or email is required'; end if;
  if p_requested_for is not null and (p_requested_for < now() or p_requested_for > now() + interval '60 days') then raise exception 'pick a time in the next 60 days'; end if;
  r := take_lead(p_tenant, p_ext_id, p_name, p_email, p_phone, p_topic, p_message, coalesce(nullif(trim(p_source), ''), 'website'), p_medium, p_campaign,
    p_attribution, p_consent, p_requested_for, p_channels, p_meta);
  if r->>'repeat' = 'true' then perform log_auto(p_tenant, 'lead.repeat', 'Asked again on the website', null, null);
  elsif r->>'id' is not null then perform log_auto(p_tenant, 'lead.received', 'Lead from the website' || case when p_requested_for is not null then ' (consult request)' else '' end, null, null); end if;
  return r;
end $$;
revoke all on function site_lead(uuid, text, text, text, text, text, text, text, text, text, jsonb, text, timestamptz, text[], jsonb) from public, anon, authenticated;
grant execute on function site_lead(uuid, text, text, text, text, text, text, text, text, text, jsonb, text, timestamptz, text[], jsonb) to service_role;

-- Calls (0039): the caller's contact finds their lead; a new caller's lead records that a call is not marketing consent.
create or replace function ingest_call(p_to text, p_sid text, p_from text, p_status text, p_duration int, p_recording_sid text, p_recording_s int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n tracking_numbers; c calls; lid uuid; cid uuid; final text; today date := (now() at time zone 'America/New_York')::date; d text; pretty text;
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
  cid := lead_contact(n.tenant_id, c.from_e164, null);
  if cid is not null then
    select id into lid from leads where tenant_id = n.tenant_id and contact_id = cid and created_at > now() - interval '30 days' order by created_at desc limit 1;
  end if;
  if lid is null then
    insert into leads (tenant_id, ext_id, name, phone, topic, source, medium, channel, consent_text, contact_id)
    values (n.tenant_id, 'call:' || c.call_sid, 'Caller ' || coalesce(right(c.from_e164, 4), 'unknown'), c.from_e164, 'Phone call', n.source, 'call', 'call',
      'Called the office at ' || n.e164 || ' (' || n.label || '). No texting consent.', cid)
    returning id into lid;
    perform record_consent(n.tenant_id, lid, 'Inbound call; no marketing consent.', '{}', '{}');
    perform log_event(n.tenant_id, 'lead.received', 'Call from ' || n.source, null, null);
  else
    insert into lead_events (tenant_id, lead_id, kind, data) values (n.tenant_id, lid, 'call', jsonb_build_object('call', c.id, 'status', final));
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

-- ---------- Every lead, however it arrives, gets its contact and its consent row ----------
-- The capture paths above do both with the full context; these catch any other insert (seeds, tests, later paths).
create or replace function lead_fill_contact() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.contact_id is null then new.contact_id := lead_contact(new.tenant_id, new.phone, new.email); end if;
  return new;
end $$;
drop trigger if exists leads_contact on leads;
create trigger leads_contact before insert on leads for each row execute function lead_fill_contact();

-- At commit: a lead with no consent row gets one from its consent_text (a call: no marketing consent).
create or replace function lead_consent_fallback() returns trigger language plpgsql security definer set search_path = public as $$
declare l leads;
begin
  select * into l from leads where id = new.id;
  if l.id is null or exists (select 1 from lead_consents where lead_id = l.id) or length(trim(coalesce(l.consent_text, ''))) < 10 then return null; end if;
  perform record_consent(l.tenant_id, l.id, case when l.channel = 'call' then 'Inbound call; no marketing consent.' else l.consent_text end,
    case when l.channel = 'call' then '{}'::text[] else '{call,email}'::text[] end, jsonb_build_object('ip_hash', l.attribution->>'ip_hash'));
  return null;
end $$;
drop trigger if exists leads_consent_row on leads;
create constraint trigger leads_consent_row after insert on leads deferrable initially deferred for each row execute function lead_consent_fallback();

-- ---------- Partner credit: the foreign key deferred from P0 ----------
update leads set partner_id = null where partner_id is not null and not exists (select 1 from partner_targets p where p.id = leads.partner_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_partner_fk') then
    alter table leads add constraint leads_partner_fk foreign key (partner_id) references partner_targets on delete set null not valid;
  end if;
end $$;
alter table leads validate constraint leads_partner_fk;

-- ---------- Backfill: every existing lead gets its contact and its consent row ----------
do $$
declare r record; cid uuid;
begin
  for r in select id, tenant_id, phone, email, channel, consent_text, consent_at, attribution from leads where contact_id is null order by created_at loop
    cid := lead_contact(r.tenant_id, r.phone, r.email);
    if cid is not null then update leads set contact_id = cid where id = r.id; end if;
  end loop;
  for r in select l.id, l.tenant_id, l.channel, l.consent_text, l.consent_at, l.attribution from leads l
           where not exists (select 1 from lead_consents c where c.lead_id = l.id) and length(trim(l.consent_text)) >= 10 loop
    perform record_consent(r.tenant_id, r.id, case when r.channel = 'call' then 'Inbound call; no marketing consent.' else r.consent_text end,
      case when r.channel = 'call' then '{}'::text[] else '{call,email}'::text[] end,
      jsonb_build_object('ip_hash', r.attribution->>'ip_hash', 'page_url', r.attribution->>'page'));
  end loop;
end $$;
-- Backfilled rows carry when the lead gave it (the guard allows no update, so set it while the trigger is off).
alter table lead_consents disable trigger lead_consents_guard;
update lead_consents c set received_at = l.consent_at from leads l where l.id = c.lead_id and c.received_at > l.consent_at + interval '1 minute';
alter table lead_consents enable trigger lead_consents_guard;
update contacts c set first_seen = x.f, last_seen = x.l
from (select contact_id, min(created_at) f, max(created_at) l from leads where contact_id is not null group by contact_id) x
where c.id = x.contact_id;
