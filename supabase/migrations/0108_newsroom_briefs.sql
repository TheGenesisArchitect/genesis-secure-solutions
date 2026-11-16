-- Helix's morning brief (lib/newsroom-morning.ts): every morning the newsroom researches every beat on its own, then
-- Helix writes the day's brief: what changed overnight and the hot topics to review, each pointing at a story on the
-- desk with why it is hot now and a suggested angle. One brief per tenant per day. Staff read; the server writes.
create table if not exists newsroom_briefs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  day date not null,
  summary text not null default '',
  hot jsonb not null default '[]',      -- [{story_id, why, angle, heat}]
  stats jsonb not null default '{}',    -- {beats, added, cents}
  cents integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, day)
);
alter table newsroom_briefs enable row level security;
drop policy if exists r on newsroom_briefs;
create policy r on newsroom_briefs for select to authenticated using ((select is_staff()));

-- The brief's own cost is a run of kind 'brief' (it counts toward the newsroom's daily and monthly caps).
alter table newsroom_runs drop constraint if exists newsroom_runs_kind_check;
alter table newsroom_runs add constraint newsroom_runs_kind_check check (kind in ('wire', 'deeper', 'produce', 'brief'));
