-- Voice jobs (lib/studio-voice-jobs.ts): a script's lines voiced with the Studio's Gemini key (the same key Helix
-- uses), in an original prebuilt voice. Queued by staff; the Studio cron voices them a few lines per tick and keeps
-- each line's WAV in private storage. Used for faceless explainers rendered outside the app (genovus-motion).
create table if not exists studio_voice_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  created_by text,
  title text not null,
  voice text not null default 'Charon',
  style text,
  lines jsonb not null,               -- [{ "id": "hook", "text": "…" }, …]
  results jsonb not null default '{}', -- { "hook": { "path": "studio/voice/<job>/hook.wav", "secs": 8.42 } }
  status text not null default 'queued' check (status in ('queued', 'voicing', 'done', 'failed')),
  error text,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists studio_voice_jobs_open on studio_voice_jobs (status) where status in ('queued', 'voicing');
alter table studio_voice_jobs enable row level security;
create policy r on studio_voice_jobs for select to authenticated using ((select is_staff()));
