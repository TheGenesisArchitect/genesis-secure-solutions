-- Episode Pro: the full episode gets the same polish as the clips, instead of posting the recording as it was shot.
-- The edit (what stays: no walk-up or walk-off, no "start/stop recording", no uh/um, no false starts, no dead air),
-- the look (the speaker's face and a measured grade), and the episode's render plan (parts rendered one step at a
-- time, then joined with one soundtrack) live on the recording. The finished episode is what YouTube receives.

alter table unedit_vlogs add column if not exists audio_blob text check (audio_blob is null or audio_blob ~ '^studio/vlogs/[A-Za-z0-9._/-]+$');
alter table unedit_vlogs add column if not exists edit jsonb;          -- lib/unedit-edit.ts Edit
alter table unedit_vlogs add column if not exists look jsonb;          -- lib/unedit-look.ts Look
alter table unedit_vlogs add column if not exists episode_plan jsonb;  -- lib/unedit-episode.ts EpisodePlan
alter table unedit_vlogs add column if not exists episode_path text check (episode_path is null or episode_path ~ '^studio/vlogs/[A-Za-z0-9._/-]+$');

-- The episode's parts: rendered in parallel by workers that each claim one part (an atomic update on this row),
-- with a lease so a worker that dies is retried. Server only (service role); staff read for the card's progress.
create table if not exists unedit_episode_parts (
  vlog_id uuid not null references unedit_vlogs on delete cascade,
  k int not null check (k >= 0),
  tenant_id uuid not null references tenants on delete cascade,
  segs jsonb not null,                       -- [{from, to, cam}] on the recording's timeline
  status text not null default 'todo' check (status in ('todo', 'running', 'done', 'failed')),
  lease_until timestamptz,
  attempts int not null default 0,
  blob_path text check (blob_path is null or blob_path ~ '^studio/vlogs/[A-Za-z0-9._/-]+$'),
  secs numeric,
  ms int,
  error text,
  primary key (vlog_id, k)
);
alter table unedit_episode_parts enable row level security;
create policy r on unedit_episode_parts for select to authenticated using ((select is_staff()));
