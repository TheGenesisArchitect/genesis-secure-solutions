-- Trend Remix: viral moments we build on, through one of three legitimate routes, with rights checked before
-- anything is approved.
--   stitch    · the platform's own Stitch (TikTok) / Remix (Instagram, Facebook): their first seconds, then ours,
--               credited and linked by the platform, posted in-app, only when the creator allows remixing.
--   licensed  · the creator's written permission is on file before the episode can be approved.
--   inspired  · an original made in the same energy: someone attests it copies no person, character or footage.

create table if not exists studio_sources (
  id uuid primary key default gen_random_uuid(),
  series_id uuid references studio_series on delete set null,
  episode_id uuid references studio_episodes on delete set null,
  url text not null check (url ~ '^https://'),
  platform text not null default 'other' check (platform in ('instagram','tiktok','youtube','facebook','other')),
  creator text,
  title text not null,
  route text not null default 'inspired' check (route in ('stitch','licensed','inspired')),
  remix_allowed boolean,
  license_status text not null default 'none' check (license_status in ('none','requested','granted')),
  license_blob text,
  original_attested boolean not null default false,
  notes text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studio_sources_episode on studio_sources (episode_id);
alter table studio_sources enable row level security;
create policy r on studio_sources for select to authenticated using ((select is_staff()));

alter table studio_posts add column if not exists method text not null default 'upload' check (method in ('upload','stitch','remix')),
  add column if not exists source_id uuid references studio_sources on delete set null;

-- Add or update a source (the trend board).
create or replace function studio_save_source(p_id uuid, p_url text, p_platform text, p_creator text, p_title text, p_route text, p_episode uuid, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; s studio_sources;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  if coalesce(p_url, '') !~ '^https://' then raise exception 'Paste the full link (https://…).'; end if;
  if p_route not in ('stitch','licensed','inspired') then raise exception 'Pick a route.'; end if;
  if p_route = 'stitch' and p_platform not in ('tiktok','instagram','facebook') then raise exception 'Stitch and Remix only exist on TikTok, Instagram and Facebook.'; end if;
  if v_id is null then
    insert into studio_sources (series_id, episode_id, url, platform, creator, title, route, notes, created_by)
    values ((select series_id from studio_episodes where id = p_episode), p_episode, trim(p_url), p_platform, nullif(trim(p_creator), ''), trim(p_title), p_route, nullif(trim(p_notes), ''), auth.uid())
    returning id into v_id;
  else
    select * into s from studio_sources where id = v_id for update;
    if s.id is null then raise exception 'source not found'; end if;
    update studio_sources set url = trim(p_url), platform = p_platform, creator = nullif(trim(p_creator), ''), title = trim(p_title), route = p_route,
      episode_id = p_episode, notes = nullif(trim(p_notes), ''), updated_at = now(),
      -- a different route resets the rights evidence it needed
      remix_allowed = case when p_route = s.route then s.remix_allowed end,
      original_attested = case when p_route = s.route then s.original_attested else false end
    where id = v_id;
  end if;
  perform studio_log('studio.source.save', trim(p_title), null, jsonb_build_object('route', p_route, 'url', trim(p_url)));
  return v_id;
end $$;

-- Record the rights evidence for a source: remix allowed (seen on the post), license requested/granted with proof,
-- or the originality attestation.
create or replace function studio_source_rights(p_id uuid, p_remix_allowed boolean, p_license_status text, p_license_blob text, p_attested boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s studio_sources;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into s from studio_sources where id = p_id for update;
  if s.id is null then raise exception 'source not found'; end if;
  if p_license_status = 'granted' and coalesce(nullif(p_license_blob, ''), s.license_blob) is null then raise exception 'Upload the creator''s written permission first.'; end if;
  if nullif(p_license_blob, '') is not null and p_license_blob !~ '^studio/rights/[A-Za-z0-9._/-]+$' then raise exception 'invalid file'; end if;
  update studio_sources set
    remix_allowed = coalesce(p_remix_allowed, s.remix_allowed),
    license_status = coalesce(nullif(p_license_status, ''), s.license_status),
    license_blob = coalesce(nullif(p_license_blob, ''), s.license_blob),
    original_attested = coalesce(p_attested, s.original_attested),
    updated_at = now()
  where id = p_id;
  perform studio_log('studio.source.rights', s.title, jsonb_build_object('remix', s.remix_allowed, 'license', s.license_status, 'attested', s.original_attested),
    jsonb_build_object('remix', coalesce(p_remix_allowed, s.remix_allowed), 'license', coalesce(nullif(p_license_status, ''), s.license_status), 'attested', coalesce(p_attested, s.original_attested)));
end $$;

-- How a post goes out: a normal upload, or the platform's own Stitch/Remix of a source.
create or replace function studio_set_post_method(p_post uuid, p_method text, p_source uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p studio_posts; s studio_sources;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into p from studio_posts where id = p_post for update;
  if p.id is null then raise exception 'post not found'; end if;
  if p.status = 'posted' then raise exception 'Already posted.'; end if;
  if p_method = 'stitch' and p.platform <> 'tiktok' then raise exception 'Stitch is a TikTok feature.'; end if;
  if p_method = 'remix' and p.platform not in ('instagram','facebook') then raise exception 'Remix is an Instagram and Facebook feature.'; end if;
  if p_method in ('stitch','remix') then
    select * into s from studio_sources where id = p_source;
    if s.id is null or s.route <> 'stitch' then raise exception 'Pick a source set to the Stitch / Remix route.'; end if;
    if s.platform <> p.platform and not (s.platform = 'instagram' and p.platform = 'facebook') then raise exception 'The source must be on the same platform as the post.'; end if;
  end if;
  update studio_posts set method = p_method, source_id = case when p_method = 'upload' then null else p_source end,
    status = 'draft', approved_by = null, approved_at = null where id = p_post;
  perform studio_log('studio.post.method', p.platform, jsonb_build_object('method', p.method), jsonb_build_object('method', p_method));
end $$;

-- Episode approval now also checks the rights of every source attached to it.
create or replace function studio_set_episode(p_id uuid, p_status text, p_final_url text)
returns void language plpgsql security definer set search_path = public as $$
declare e studio_episodes; v_url text := nullif(trim(p_final_url), ''); v_status text := p_status; bad text;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  select * into e from studio_episodes where id = p_id for update;
  if e.id is null then raise exception 'episode not found'; end if;
  if v_status not in ('writing','shooting','editing','review','approved','live') then raise exception 'invalid status'; end if;
  if v_url is distinct from e.final_url and e.status in ('approved','live') and v_status in ('approved','live') then
    v_status := 'review';
  end if;
  if v_status = 'approved' and v_url is null then raise exception 'Add the final render link before approving.'; end if;
  if v_status = 'approved' then
    select string_agg(title || case route when 'licensed' then ' (needs the creator''s written permission)' when 'inspired' then ' (needs the originality check)' else ' (needs remixing confirmed as allowed)' end, '; ')
      into bad from studio_sources
      where episode_id = p_id and ((route = 'licensed' and (license_status <> 'granted' or license_blob is null))
        or (route = 'inspired' and not original_attested) or (route = 'stitch' and remix_allowed is not true));
    if bad is not null then raise exception 'Rights not cleared: %', bad; end if;
  end if;
  update studio_episodes set status = v_status, final_url = v_url,
    approved_by = case when v_status = 'approved' then auth.uid() when v_status = 'live' then e.approved_by else null end,
    approved_at = case when v_status = 'approved' then now() when v_status = 'live' then e.approved_at else null end,
    updated_at = now() where id = p_id;
  if v_status not in ('approved','live') then update studio_posts set status = 'draft', approved_by = null, approved_at = null where episode_id = p_id and status = 'approved'; end if;
  perform studio_log('studio.episode.' || v_status, e.title, jsonb_build_object('status', e.status, 'final_url', e.final_url), jsonb_build_object('status', v_status, 'final_url', v_url));
end $$;

grant execute on function studio_save_source(uuid, text, text, text, text, text, uuid, text), studio_source_rights(uuid, boolean, text, text, boolean),
  studio_set_post_method(uuid, text, uuid) to authenticated;
