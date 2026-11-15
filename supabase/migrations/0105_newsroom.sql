-- The Genovus Newsroom (staff only for now): Helix researches beats live, each story keeps a ledger of claims with
-- the exact source passage behind them, and one Produce turns a chosen angle into the script, teleprompter text,
-- sources sheet, B-roll list, article and posts that the next Unedit upload is cut against.
-- Every row carries tenant_id; staff read through row-level security; the server writes with the service role.

create table if not exists newsroom_settings (
  tenant_id uuid primary key references tenants on delete cascade,
  beats jsonb not null default '[]'::jsonb,          -- [{id, label, brief, subs[]}]
  voice jsonb not null default '[]'::jsonb,          -- ["Direct and warm…", …]
  daily_cap_cents int not null default 200 check (daily_cap_cents >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists newsroom_stories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  beat text not null,
  sub text,
  headline text not null,
  source text not null,
  url text not null check (url ~ '^https?://'),
  published_on date,
  thumb_url text check (thumb_url is null or thumb_url ~ '^https://'),
  why text,
  fit int check (fit between 0 and 100),
  status text not null default 'new' check (status in ('new', 'drafting', 'in_studio', 'watching', 'background', 'dismissed')),
  angles jsonb not null default '[]'::jsonb,         -- [{title, line}]
  chosen_angle int,
  build jsonb not null default '[]'::jsonb,          -- the parts Helix will build, in order: [text]
  voiced boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, url)
);
create index if not exists newsroom_stories_recent on newsroom_stories (tenant_id, created_at desc);

create table if not exists newsroom_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  story_id uuid not null references newsroom_stories on delete cascade,
  text text not null,
  status text not null check (status in ('confirmed', 'reported', 'alleged', 'opinion', 'unsupported')),
  attribution text,                                  -- who says so
  denial text,                                       -- the other side, required for an allegation about a person
  names_person boolean not null default false,
  source_title text,
  source_url text not null check (source_url ~ '^https?://'),
  cited_text text,                                   -- the exact passage the search returned for it
  passage_verified boolean not null default false,   -- the passage came back as a search citation
  approved boolean not null default true,            -- live "research deeper" claims wait for a person
  retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists newsroom_claims_story on newsroom_claims (story_id);

create table if not exists newsroom_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  kind text not null check (kind in ('wire', 'deeper', 'produce')),
  beat text,
  story_id uuid references newsroom_stories on delete set null,
  searches int not null default 0,
  cost_cents int not null default 0 check (cost_cents >= 0),
  stories int not null default 0,
  error text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists newsroom_runs_day on newsroom_runs (tenant_id, created_at desc);

create table if not exists newsroom_productions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  story_id uuid not null references newsroom_stories on delete cascade,
  angle text not null,
  formats text[] not null default '{}',
  outputs jsonb not null default '{}'::jsonb,        -- {script, teleprompter, sheet, broll[], article, social{}}
  next_upload boolean not null default false,        -- the next Unedit upload is cut against this production
  vlog_id uuid references unedit_vlogs on delete set null,
  cost_cents int not null default 0 check (cost_cents >= 0),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

alter table newsroom_settings enable row level security;
alter table newsroom_stories enable row level security;
alter table newsroom_claims enable row level security;
alter table newsroom_runs enable row level security;
alter table newsroom_productions enable row level security;
create policy r on newsroom_settings for select to authenticated using ((select is_staff()));
create policy r on newsroom_stories for select to authenticated using ((select is_staff()));
create policy r on newsroom_claims for select to authenticated using ((select is_staff()));
create policy r on newsroom_runs for select to authenticated using ((select is_staff()));
create policy r on newsroom_productions for select to authenticated using ((select is_staff()));

-- Newsroom research and production count against the monthly Studio budget like every other Studio spend.
create or replace function studio_spent_cents() returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_cents), 0)::int from (
    select cost_cents, created_at from studio_refs where status <> 'failed'
    union all select cost_cents, created_at from studio_takes where status <> 'failed'
    union all select court_cost_cents, coalesce(court_at, created_at) from studio_takes where court_cost_cents > 0
    union all select cost_cents, created_at from studio_art where status <> 'failed'
    union all select cost_cents, created_at from studio_voice_clips where status <> 'failed'
    union all select cost_cents, created_at from unedit_vlogs where cost_cents > 0
    union all select cost_cents, created_at from newsroom_runs where cost_cents > 0
  ) g where (created_at at time zone 'America/New_York') >= date_trunc('month', now() at time zone 'America/New_York')
$$;
revoke execute on function studio_spent_cents() from public, anon;
grant execute on function studio_spent_cents() to authenticated, service_role;
