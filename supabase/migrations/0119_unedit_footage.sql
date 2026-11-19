-- Footage Desk (lib/unedit-footage.ts): real footage for faceless clips from sources UnEdit may use (Pixabay, NASA,
-- Wikimedia Commons public domain / CC0 / CC BY). Every clip is stored in private Blob with its source page, licence,
-- the licence text as seen when it was taken, and the credit it needs. Searches are cached for 24 hours (Pixabay's
-- API terms) so the same query never hits a source twice in a day.
create table if not exists unedit_footage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  source text not null check (source in ('pixabay', 'nasa', 'commons')),
  source_id text not null,                 -- the source's own id (Pixabay id, NASA nasa_id, Commons file title)
  page_url text not null,                  -- where a person can see the clip and its licence
  blob_path text not null,                 -- our stored copy (H.264, at most 1920 wide, at most 12 s)
  license text not null check (license in ('pixabay', 'public-domain', 'cc0', 'cc-by')),
  license_note text not null,              -- the licence as the source stated it when taken (e.g. 'CC BY 4.0')
  credit text,                             -- shown on screen when the licence asks for it (CC BY); null otherwise
  author text,
  title text not null,
  tags text[] not null default '{}',
  width integer not null,
  height integer not null,
  secs numeric not null,
  query text not null,                     -- the search that found it
  uses integer not null default 0,
  last_used_vlog uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists unedit_footage_source on unedit_footage (tenant_id, source, source_id);
create index if not exists unedit_footage_tags on unedit_footage using gin (tags);
alter table unedit_footage enable row level security;
create policy r on unedit_footage for select to authenticated using ((select is_staff()));

create table if not exists unedit_footage_search (
  tenant_id uuid not null references tenants(id) on delete cascade,
  source text not null,
  query text not null,
  results jsonb not null,                  -- the candidates as found (never stored files)
  at timestamptz not null default now(),
  primary key (tenant_id, source, query)
);
alter table unedit_footage_search enable row level security;
create policy r on unedit_footage_search for select to authenticated using ((select is_staff()));
