-- Social setup wizard (app/app/[slug]/social): one row per agency per channel. The agency either has the profile
-- ("have": paste the link, give us access, connect it to Metricool) or builds it with our help ("create": the guided
-- steps, then the same access and Metricool steps), or skips it. Google first asks who runs the listing; when the
-- carrier does, we leave it alone.
-- The agency marks its side ("access sent", "Metricool connected"); only Genovus staff confirm what they can see on
-- their side (access granted, the network showing in the agency's Metricool brand). Writes go through the server
-- (service role) after the dashboard checks membership; members and staff read their rows under RLS.
create table if not exists social_setup (
  tenant_id uuid not null references tenants(id) on delete cascade,
  channel text not null check (channel in ('facebook', 'instagram', 'google', 'linkedin', 'youtube', 'tiktok', 'nextdoor')),
  path text check (path in ('have', 'create', 'skip')),
  google_owner text check (google_owner in ('me', 'carrier', 'none', 'unsure')),
  link text check (link is null or (link ~ '^https://' and length(link) <= 400)),
  steps text[] not null default '{}' check (cardinality(steps) <= 40),
  copy jsonb not null default '{}'::jsonb,
  copy_ok_at timestamptz,
  copy_ok_by text,
  access text not null default 'none' check (access in ('none', 'sent', 'granted')),
  access_at timestamptz,
  metricool text not null default 'none' check (metricool in ('none', 'sent', 'connected', 'na')),
  metricool_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, channel)
);
alter table social_setup enable row level security;
drop policy if exists r on social_setup;
create policy r on social_setup for select to authenticated using ((select is_staff()) or (select is_member(tenant_id)));
grant select on social_setup to authenticated;

-- The agency's Metricool connection link: made in Metricool for the agency's brand (Brand settings, share the
-- connection link) and pasted by staff. The agency opens it to connect each network without sharing a password.
alter table tenants add column if not exists metricool_connect_url text
  check (metricool_connect_url is null or (metricool_connect_url ~ '^https://' and length(metricool_connect_url) <= 500));
