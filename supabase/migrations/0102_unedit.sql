-- Unedit (Studio): a one-take vlog becomes captioned 9:16 clips, the full episode and thumbnail options on one
-- Approve card, then Metricool drafts. Three tables: the recording (one per file, deduped by its fingerprint), the
-- clips Claude picked from its transcript, and the posts the Approve tap creates. Staff read; the server writes
-- (service role) and every step is audited under the 'genovus' tenant through unedit_log. Every row carries its
-- tenant (Genovus for now; agencies get Unedit later through module_grants).

create table if not exists unedit_vlogs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  title text,
  file_name text,
  blob_path text not null check (blob_path ~ '^studio/vlogs/[A-Za-z0-9._/-]+$'),
  blob_url text not null,
  bytes bigint not null check (bytes > 0),
  -- size + hashes of the first and last 4 MB: the same recording uploaded twice opens the same job
  fingerprint text not null check (fingerprint ~ '^[0-9]+:[0-9a-f]{64}:[0-9a-f]{64}$'),
  duration_s numeric,
  width int,
  height int,
  rotation int,
  vcodec text,
  stage text not null default 'uploaded' check (stage in ('uploaded', 'transcribing', 'finding', 'rendering', 'review', 'publishing', 'published', 'failed')),
  stage_at timestamptz not null default now(),
  lease_until timestamptz,
  attempts int not null default 0,
  error text,
  provider text check (provider is null or provider in ('deepgram', 'assemblyai', 'mock')),
  transcript_blob text check (transcript_blob is null or transcript_blob ~ '^studio/vlogs/[A-Za-z0-9._/-]+$'),
  words int,
  episode jsonb not null default '{}'::jsonb,       -- {title, description, tags[]} for the full video
  thumbs jsonb not null default '[]'::jsonb,        -- [{blob, text, t}] three options
  thumb_pick int,
  cost_cents int not null default 0 check (cost_cents >= 0),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users on delete set null,
  approved_at timestamptz,
  unique (tenant_id, fingerprint)
);
create index if not exists unedit_vlogs_stage on unedit_vlogs (stage, stage_at);

create table if not exists unedit_clips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  vlog_id uuid not null references unedit_vlogs on delete cascade,
  n int not null check (n between 1 and 20),
  start_s numeric not null check (start_s >= 0),
  end_s numeric not null,
  hook_start_s numeric,
  hook_end_s numeric,
  title text not null,
  caption text not null default '',
  copy jsonb not null default '{}'::jsonb,          -- {instagram, facebook, youtube}
  features jsonb not null default '{}'::jsonb,      -- what it was picked on (hook type, topic, position): the learning loop's input
  blob_path text check (blob_path is null or blob_path ~ '^studio/vlogs/[A-Za-z0-9._/-]+$'),
  secs numeric,
  status text not null default 'rendering' check (status in ('rendering', 'ready', 'approved', 'redo', 'dropped', 'failed')),
  note text,
  error text,
  created_at timestamptz not null default now(),
  unique (vlog_id, n),
  check (end_s > start_s)
);

create table if not exists unedit_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  vlog_id uuid not null references unedit_vlogs on delete cascade,
  clip_id uuid references unedit_clips on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook', 'youtube')),
  kind text not null check (kind in ('reel', 'short', 'video')),
  title text,
  body text not null default '',
  ai_label boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'sent', 'posted', 'error', 'skipped')),
  mc_post_id bigint,
  mc_status text,
  mc_error text,
  posted_url text,
  created_at timestamptz not null default now()
);
create unique index if not exists unedit_posts_one on unedit_posts (vlog_id, coalesce(clip_id, '00000000-0000-0000-0000-000000000000'::uuid), platform);

alter table unedit_vlogs enable row level security;
alter table unedit_clips enable row level security;
alter table unedit_posts enable row level security;
create policy r on unedit_vlogs for select to authenticated using ((select is_staff()));
create policy r on unedit_clips for select to authenticated using ((select is_staff()));
create policy r on unedit_posts for select to authenticated using ((select is_staff()));

-- The audit trail for Unedit's server steps (studio_log is not callable from outside the database).
create or replace function unedit_log(p_action text, p_subject text, p_after jsonb)
returns void language sql security definer set search_path = public as $$
  select studio_log(p_action, p_subject, null, p_after)
$$;
revoke execute on function unedit_log(text, text, jsonb) from public, anon, authenticated;
grant execute on function unedit_log(text, text, jsonb) to service_role;

-- Unedit's transcription and Claude costs count against the monthly Studio budget like every other Studio spend.
create or replace function studio_spent_cents() returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_cents), 0)::int from (
    select cost_cents, created_at from studio_refs where status <> 'failed'
    union all select cost_cents, created_at from studio_takes where status <> 'failed'
    union all select court_cost_cents, coalesce(court_at, created_at) from studio_takes where court_cost_cents > 0
    union all select cost_cents, created_at from studio_art where status <> 'failed'
    union all select cost_cents, created_at from studio_voice_clips where status <> 'failed'
    union all select cost_cents, created_at from unedit_vlogs where cost_cents > 0
  ) g where (created_at at time zone 'America/New_York') >= date_trunc('month', now() at time zone 'America/New_York')
$$;
revoke execute on function studio_spent_cents() from public, anon;
grant execute on function studio_spent_cents() to authenticated, service_role;

-- Add a step's cost, refusing when it would pass the monthly cap (under the Studio budget lock).
create or replace function unedit_spend(p_vlog uuid, p_cents int, p_what text)
returns void language plpgsql security definer set search_path = public as $$
declare b studio_budget;
begin
  perform pg_advisory_xact_lock(hashtext('studio_budget'));
  select * into b from studio_budget limit 1;
  if p_cents > 0 and studio_spent_cents() + p_cents > b.monthly_cap_cents then
    raise exception 'This would pass the monthly Studio budget ($% of $% used).', round(studio_spent_cents() / 100.0, 2), round(b.monthly_cap_cents / 100.0, 2);
  end if;
  update unedit_vlogs set cost_cents = cost_cents + greatest(p_cents, 0) where id = p_vlog;
  perform studio_log('studio.unedit.spend', p_vlog::text, null, jsonb_build_object('cents', p_cents, 'what', left(p_what, 80)));
end $$;
revoke execute on function unedit_spend(uuid, int, text) from public, anon, authenticated;
grant execute on function unedit_spend(uuid, int, text) to service_role;
