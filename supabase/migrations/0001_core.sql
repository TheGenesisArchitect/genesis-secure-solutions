-- Genovus core schema: tenants, people, records, work items, audit.
-- Rules (CLAUDE.md): every tenant-owned table carries tenant_id and row-level security enforces it;
-- clients and network users never write tables directly, only through the security-definer functions
-- in 0002, each of which writes the audit log. Staff work across tenants.

create extension if not exists pgcrypto with schema extensions;

create type lifecycle_stage as enum ('attract','consult','propose','deposit','intake','build','review','care');

create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]{2,64}$'),
  name text not null,
  kind text not null default 'agency' check (kind in ('agency','internal')),
  stage lifecycle_stage not null default 'attract',
  stage_since timestamptz not null default now(),
  plan text check (plan in ('vip','launch','growth','premium')),
  care_plan text,
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);

create table staff (
  user_id uuid primary key references auth.users on delete cascade,
  role text not null check (role in ('admin','account_lead','operator','reviewer')),
  display_name text not null,
  created_at timestamptz not null default now()
);

create table memberships (
  tenant_id uuid not null references tenants on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table networks (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  kind text not null check (kind in ('carrier','agency_network')),
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);
create table network_members (
  network_id uuid not null references networks on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  primary key (network_id, user_id)
);
create table network_tenants (
  network_id uuid not null references networks on delete cascade,
  tenant_id uuid not null references tenants on delete cascade,
  primary key (network_id, tenant_id)
);

-- The agent record: versioned, one current version per tenant.
create table agent_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  version int not null,
  data jsonb not null,
  is_current boolean not null default false,
  note text,
  created_by uuid references auth.users,
  created_at timestamptz not null default now(),
  unique (tenant_id, version)
);
create unique index agent_records_one_current on agent_records (tenant_id) where is_current;

create table lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  from_stage lifecycle_stage,
  to_stage lifecycle_stage not null,
  note text,
  actor uuid references auth.users,
  at timestamptz not null default now()
);

create table gates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  kind text not null check (kind in ('photo_rights','carrier_approval','carrier_rules','meta_access','domain','privacy_notice','kickoff')),
  status text not null default 'open' check (status in ('open','cleared','blocked','waived')),
  evidence text,
  cleared_by uuid references auth.users,
  cleared_at timestamptz,
  unique (tenant_id, kind)
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  kind text not null check (kind in ('film','image','kit','deck','document','page','wizard','site','brand')),
  title text not null,
  location_kind text not null check (location_kind in ('public','route','blob','external','file')),
  location text not null,
  preview text,
  audience text not null default 'internal' check (audience in ('internal','client','public')),
  rights_status text not null default 'cleared' check (rights_status in ('cleared','pending','restricted','not_needed')),
  notes text,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, title)
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  subject_kind text not null check (subject_kind in ('copy','post','site_change','invoice','launch','ad','report')),
  title text not null,
  body jsonb not null default '{}',
  lane text not null check (lane in ('auto','queued','required')),
  approver text not null default 'client' check (approver in ('client','team')),
  status text not null default 'pending' check (status in ('pending','approved','changes_requested')),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users,
  decided_at timestamptz,
  decision_note text,
  is_sample boolean not null default false
);

create table care_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  kind text not null check (kind in ('change','content','report','support')),
  title text not null check (length(title) between 3 and 140),
  detail text check (length(detail) <= 4000),
  status text not null default 'new' check (status in ('new','in_progress','waiting_client','done')),
  created_by uuid references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_sample boolean not null default false
);

create table content_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  channel text not null check (channel in ('facebook','instagram','google','linkedin')),
  copy text not null,
  status text not null default 'draft' check (status in ('draft','in_review','approved','scheduled','published')),
  scheduled_for timestamptz,
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);

create table kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  period date not null,
  metrics jsonb not null,
  is_sample boolean not null default false,
  unique (tenant_id, period)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  kind text not null check (kind in ('deposit','balance','care','upgrade')),
  amount_cents int not null check (amount_cents >= 0),
  status text not null check (status in ('draft','open','paid','void')),
  note text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- Public intake. Not tenant-owned yet (a prospect has no tenant); staff-only, written by the server.
create table inquiries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('agency','carrier')),
  name text not null check (length(name) between 2 and 120),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text,
  org text not null check (length(org) between 2 and 160),
  details jsonb not null default '{}',
  consent_text text not null,
  consent_at timestamptz not null default now(),
  ip_hash text,
  status text not null default 'new' check (status in ('new','contacted','converted','closed')),
  tenant_id uuid references tenants on delete set null,
  created_at timestamptz not null default now()
);
create index inquiries_ip_recent on inquiries (ip_hash, created_at);

-- Append-only, hash-chained audit log. tenant_id is null only for platform events.
create table audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid references tenants on delete restrict,
  actor uuid,
  actor_label text,
  action text not null,
  subject text,
  before jsonb,
  after jsonb,
  at timestamptz not null default clock_timestamp(),
  prev_hash text not null,
  hash text not null
);

create function audit_chain() returns trigger language plpgsql as $$
declare last text;
begin
  perform pg_advisory_xact_lock(4207001);
  select hash into last from audit_events order by id desc limit 1;
  new.prev_hash := coalesce(last, 'genesis');
  new.at := clock_timestamp();
  new.hash := encode(extensions.digest(new.prev_hash || '|' || coalesce(new.tenant_id::text,'') || '|' || coalesce(new.actor::text,'') || '|' ||
    coalesce(new.actor_label,'') || '|' || new.action || '|' || coalesce(new.subject,'') || '|' || coalesce(new.before::text,'') || '|' ||
    coalesce(new.after::text,'') || '|' || to_char(new.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex');
  return new;
end $$;
create trigger audit_chain before insert on audit_events for each row execute function audit_chain();

create function audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_events is append-only'; end $$;
create trigger audit_no_update before update or delete on audit_events for each row execute function audit_immutable();
create trigger audit_no_truncate before truncate on audit_events execute function audit_immutable();
