-- The Unedit asset library: every B-roll shot an episode renders is kept with what it shows (its prompt, topic tags)
-- and the model that made it. A shot from an approved episode is an approved asset; once three episodes are approved,
-- the director reuses an approved shot wherever it fits a sentence as well as a new one would (lib/unedit.ts), so the
-- series builds a consistent, free-to-reuse set of its own pictures. Staff read; the server writes.
create table if not exists unedit_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  vlog_id uuid references unedit_vlogs on delete set null,     -- the episode that made it
  kind text not null default 'broll' check (kind in ('broll')),
  blob_path text not null,
  prompt text not null,
  model text,
  tags text[] not null default '{}',
  cents integer not null default 0,
  uses integer not null default 0,                              -- times reused in later episodes
  last_used_vlog uuid,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists unedit_assets_path on unedit_assets (blob_path);
create index if not exists unedit_assets_tenant on unedit_assets (tenant_id, approved, kind);
alter table unedit_assets enable row level security;
drop policy if exists r on unedit_assets;
create policy r on unedit_assets for select to authenticated using ((select is_staff()));
