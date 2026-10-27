-- Turnkey, step 4: one website app for every agency (app/s/[slug]), built from the agency's record and profile.
--  * tenants.site_live: the site is public on its own domain (the Launch step turns it on; nothing is indexed before).
--  * tenant_domains: the agency's own domains, mapped to its site (used once a site is live).
--  * agency_profiles.google_place_id: the office's own Google listing, for the review link.
--  * leads.requested_for: a consult time a visitor asked for on the site (Growth's online booking); the agency confirms it.
--  * site_lead: a lead from the agency's hosted site (server only; the site resolves the agency, never the visitor).

alter table tenants add column if not exists site_live boolean not null default false;
alter table agency_profiles add column if not exists google_place_id text check (google_place_id is null or google_place_id ~ '^[A-Za-z0-9_-]{10,200}$');
alter table leads add column if not exists requested_for timestamptz;

create table if not exists tenant_domains (
  domain text primary key check (domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  tenant_id uuid not null references tenants on delete cascade,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
alter table tenant_domains enable row level security;
create policy r on tenant_domains for select to authenticated using (is_staff() or is_member(tenant_id));

create or replace function site_lead(p_tenant uuid, p_ext_id text, p_name text, p_email text, p_phone text, p_topic text,
  p_message text, p_source text, p_medium text, p_campaign text, p_attribution jsonb, p_consent text, p_requested_for timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not exists (select 1 from tenants where id = p_tenant and kind = 'agency') then raise exception 'unknown agency'; end if;
  if length(trim(coalesce(p_consent, ''))) < 10 then raise exception 'consent text required'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'name required'; end if;
  if nullif(trim(p_phone), '') is null and nullif(trim(p_email), '') is null then raise exception 'a phone or email is required'; end if;
  if p_requested_for is not null and (p_requested_for < now() or p_requested_for > now() + interval '60 days') then raise exception 'pick a time in the next 60 days'; end if;
  insert into leads (tenant_id, ext_id, name, email, phone, topic, message, source, medium, campaign, attribution, consent_text, requested_for)
  values (p_tenant, nullif(left(p_ext_id, 120), ''), left(trim(p_name), 120), nullif(lower(trim(p_email)), ''), nullif(left(trim(p_phone), 40), ''),
    nullif(left(trim(p_topic), 120), ''), nullif(left(p_message, 2000), ''), coalesce(nullif(left(lower(trim(p_source)), 80), ''), 'website'),
    nullif(left(lower(trim(p_medium)), 80), ''), nullif(left(trim(p_campaign), 120), ''), coalesce(p_attribution, '{}'), left(trim(p_consent), 500), p_requested_for)
  on conflict (tenant_id, ext_id) do nothing
  returning id into nid;
  if nid is not null then perform log_auto(p_tenant, 'lead.received', 'Lead from the website' || case when p_requested_for is not null then ' (consult request)' else '' end, null, null); end if;
  return jsonb_build_object('id', nid, 'duplicate', nid is null);
end $$;
revoke all on function site_lead(uuid, text, text, text, text, text, text, text, text, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function site_lead(uuid, text, text, text, text, text, text, text, text, text, jsonb, text, timestamptz) to service_role;
