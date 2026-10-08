-- National Network Scanner: a researched carrier catalog, the scan's own bookkeeping, and prospects.
-- Google Places terms: only the place ID may be kept indefinitely, so prospects store the place ID plus our
-- own data (carrier classification, state, pipeline, notes, and contact details a person confirms or the
-- office gives us). Names, addresses, phones and websites are fetched live from Google when shown.

create table if not exists carriers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null,
  aliases text[] not null default '{}',          -- name fragments that identify one of its offices
  query text,                                     -- the Places text query used to find its offices
  model text not null check (model in ('captive','exclusive','independent','direct','hybrid')),
  lines text[] not null default '{}',
  agent_count int,                                -- as published by the carrier, null when not published
  count_label text,                               -- what the published figure counts
  source_url text,
  as_of date,
  marketing_notes text,
  fit_score int not null default 50 check (fit_score between 0 and 100),
  fit_reasons text[] not null default '{}',
  scan_enabled boolean not null default false,
  verified boolean not null default false,        -- figures checked against the carrier's own document
  updated_at timestamptz not null default now()
);

create table if not exists scan_cells (
  id bigint generated always as identity primary key,
  state text not null check (state ~ '^[A-Z]{2}$'),
  south double precision not null, west double precision not null, north double precision not null, east double precision not null,
  depth int not null default 0,
  status text not null default 'pending' check (status in ('pending','done','split')),
  last_scanned timestamptz,
  results int not null default 0,
  unique (state, south, west, north, east)
);
create index if not exists scan_cells_pending on scan_cells (status, state);

create table if not exists scan_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  requests int not null default 0,
  est_cost_cents int not null default 0,
  found_new int not null default 0,
  status text not null default 'running' check (status in ('running','done','budget','error')),
  note text
);

create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  place_id text not null unique,
  code text not null unique default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  carrier_id uuid references carriers on delete set null,
  segment text not null check (segment in ('captive','independent')),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  cell_id bigint references scan_cells on delete set null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  missed_sweeps int not null default 0,
  status text not null default 'new' check (status in ('new','verified','contacting','replied','consult','proposal','won','not_now','opted_out','closed')),
  owner uuid references auth.users on delete set null,
  next_action_at timestamptz,
  fit_score int not null default 50,
  contact_name text, contact_email text, contact_phone text, website_own text,
  notes text,
  tenant_id uuid references tenants on delete set null
);
create index if not exists prospects_state on prospects (state, status);
create index if not exists prospects_carrier on prospects (carrier_id, status);
create index if not exists prospects_next on prospects (next_action_at) where status in ('new','verified','contacting');

create table if not exists prospect_events (
  id bigint generated always as identity primary key,
  prospect_id uuid not null references prospects on delete cascade,
  kind text not null check (kind in ('call','email','note','status','reply')),
  outcome text,
  note text,
  actor uuid references auth.users on delete set null,
  at timestamptz not null default now()
);
create index if not exists prospect_events_p on prospect_events (prospect_id, at desc);

create table if not exists suppression (
  id bigint generated always as identity primary key,
  email text unique,
  place_id text unique,
  reason text not null,
  at timestamptz not null default now(),
  check (email is not null or place_id is not null)
);

alter table inquiries drop constraint if exists inquiries_prospect_fk;
alter table inquiries add constraint inquiries_prospect_fk foreign key (prospect_id) references prospects on delete set null;

do $$ declare t text; begin
  foreach t in array array['carriers','scan_cells','scan_runs','prospects','prospect_events','suppression'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists r on %I', t);
    execute format('create policy r on %I for select to authenticated using ((select is_staff()))', t);
  end loop;
end $$;

-- Staff work on prospects: outcomes, notes, status, first-party contact details. Opt-outs go to suppression.
create or replace function log_prospect(p_id uuid, p_kind text, p_outcome text, p_note text, p_status text default null, p_next timestamptz default null,
  p_contact_name text default null, p_contact_email text default null, p_contact_phone text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pr prospects;
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

create or replace function save_carrier(p_slug text, p_scan boolean, p_fit int, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare before jsonb;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can edit the carrier catalog'; end if;
  select jsonb_build_object('scan_enabled', scan_enabled, 'fit_score', fit_score) into before from carriers where slug = p_slug;
  update carriers set scan_enabled = p_scan, fit_score = greatest(0, least(100, p_fit)), marketing_notes = coalesce(nullif(trim(p_notes), ''), marketing_notes), updated_at = now() where slug = p_slug;
  perform log_event(null, 'carrier.update', p_slug, before, jsonb_build_object('scan_enabled', p_scan, 'fit_score', p_fit));
end $$;

grant execute on function log_prospect(uuid, text, text, text, text, timestamptz, text, text, text), save_carrier(text, boolean, int, text) to authenticated;

-- The starting catalog. Counts are only filled where the carrier's own document states them (verified);
-- the rest stay blank for review. Edits made later in the console are kept (on conflict do nothing).
insert into carriers (slug, name, aliases, query, model, lines, agent_count, count_label, source_url, as_of, fit_score, fit_reasons, verified, marketing_notes) values
 ('state-farm', 'State Farm', '{"State Farm"}', 'State Farm insurance agent', 'exclusive', '{"auto","home","life","business"}',
   19200, 'agent offices', 'https://newsroom.statefarm.com/statefarm-to-enter-massachusetts/', '2025-10-23', 90,
   '{"Largest exclusive agent network in the US","Agent-owned offices market locally","Uniform brand rules suit a repeatable Launch"}', true, null),
 ('allstate', 'Allstate', '{"Allstate"}', 'Allstate insurance agent', 'exclusive', '{"auto","home","life","business"}',
   27400, 'exclusive agents and licensed sales professionals (US)', 'https://www.sec.gov/Archives/edgar/data/899051/000089905126000031/all-20251231.htm', '2025-12-31', 88,
   '{"Large exclusive agency network","Agency owners fund their own local marketing","Same platform across many offices"}', true, null),
 ('farmers', 'Farmers Insurance', '{"Farmers Insurance"}', 'Farmers Insurance agent', 'exclusive', '{"auto","home","life","business"}',
   null, null, 'https://newsroom.farmers.com/2026-03-31-Farmers-Insurance-R-Sets-Ambitious-2026-Growth-Goal-1,700-New-Agency-Owners-Nationwide,-Expansion-Plan-Includes-New-Elite-Owner-Program-for-High-Capital-Entrepreneurs', '2026-03-31', 86,
   '{"Exclusive agency owners","Plans nearly 1,700 new agency owners in 2026: new offices need a presence from day one"}', false, 'Total agent count not published in the cited release.'),
 ('geico', 'GEICO', '{"GEICO"}', 'GEICO Local Agent', 'exclusive', '{"auto","home","renters","motorcycle"}',
   null, null, null, null, 84,
   '{"Client #1 (JAVA Agency) proves the playbook","Local agents need their own site and social","Strict brand rules favor a compliant-by-design build"}', false, 'GEICO publishes no local-agent count; its agent directory blocks automated reads.'),
 ('american-family', 'American Family Insurance', '{"American Family Insurance","AmFam"}', 'American Family Insurance agent', 'exclusive', '{"auto","home","life","business"}',
   null, null, null, null, 80, '{"Exclusive agency owners in a defined multi-state footprint"}', false, 'Agent count to be confirmed from a carrier document.'),
 ('farm-bureau-fs', 'Farm Bureau Financial Services', '{"Farm Bureau Financial Services","FBFS"}', 'Farm Bureau Financial Services agent', 'exclusive', '{"auto","home","farm","life"}',
   null, null, null, null, 72, '{"Exclusive regional agent force","Rural and small-town offices with thin web presence"}', false, 'Regional; count to be confirmed.'),
 ('country-financial', 'COUNTRY Financial', '{"COUNTRY Financial","Country Financial"}', 'COUNTRY Financial representative', 'exclusive', '{"auto","home","farm","life"}',
   null, null, null, null, 70, '{"Exclusive financial representatives in a regional footprint"}', false, 'Regional; count to be confirmed.'),
 ('shelter', 'Shelter Insurance', '{"Shelter Insurance"}', 'Shelter Insurance agent', 'exclusive', '{"auto","home","life","farm"}',
   null, null, null, null, 68, '{"Exclusive agents in a regional footprint"}', false, 'Regional; count to be confirmed.'),
 ('independent', 'Independent agencies', '{}', 'insurance agency', 'independent', '{"auto","home","life","business"}',
   null, null, null, null, 60, '{"Many carriers, one local brand to build","Owner decides marketing spend directly"}', false, 'Found by the generic insurance-agency search; anything not matching a carrier above.')
on conflict (slug) do nothing;
