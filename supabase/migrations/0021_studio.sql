-- Genovus Studio: series → episodes → shots, and the posts that publish an episode on each platform.
-- Staff only. Approval is bound to the exact final render: changing the render link reopens review, and a post
-- can only be approved once its episode is approved and only marked posted once the platform's AI label is on.
-- Every change is sealed in the audit log under the Genovus house account.

create table if not exists studio_series (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null,
  division text not null default 'Genovus Originals',
  logline text,
  bible jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists studio_episodes (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references studio_series on delete cascade,
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  kind text not null default 'episode' check (kind in ('teaser','episode','proof')),
  title text not null,
  runtime_s int,
  logline text,
  script text,
  music text,
  sort int not null default 0,
  status text not null default 'writing' check (status in ('writing','shooting','editing','review','approved','live')),
  final_url text,
  approved_by uuid references auth.users on delete set null,
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists studio_shots (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references studio_episodes on delete cascade,
  n int not null,
  timing text,
  description text not null,
  camera text,
  dialogue text,
  prompt text,
  tool text not null default 'flow' check (tool in ('flow','nano-banana','capture','edit','veo')),
  status text not null default 'todo' check (status in ('todo','generating','take_ok','approved')),
  take_url text,
  notes text,
  unique (episode_id, n)
);

create table if not exists studio_posts (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references studio_episodes on delete cascade,
  platform text not null check (platform in ('facebook','instagram','tiktok','youtube')),
  caption text not null,
  title text,
  link text not null,
  scheduled_for timestamptz,
  status text not null default 'draft' check (status in ('draft','approved','posted')),
  ai_label boolean not null default false,
  approved_by uuid references auth.users on delete set null,
  approved_at timestamptz,
  posted_url text,
  posted_at timestamptz,
  unique (episode_id, platform)
);

alter table studio_series enable row level security;
alter table studio_episodes enable row level security;
alter table studio_shots enable row level security;
alter table studio_posts enable row level security;
create policy r on studio_series for select to authenticated using ((select is_staff()));
create policy r on studio_episodes for select to authenticated using ((select is_staff()));
create policy r on studio_shots for select to authenticated using ((select is_staff()));
create policy r on studio_posts for select to authenticated using ((select is_staff()));

create or replace function studio_log(p_action text, p_subject text, p_before jsonb, p_after jsonb)
returns void language sql security definer set search_path = public as $$
  select log_event((select id from tenants where slug = 'genovus'), p_action, p_subject, p_before, p_after)
$$;
revoke execute on function studio_log(text, text, jsonb, jsonb) from public, anon, authenticated;

-- Shot progress: status, the take's link, notes.
create or replace function studio_update_shot(p_id uuid, p_status text, p_take_url text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare s studio_shots;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  select * into s from studio_shots where id = p_id for update;
  if s.id is null then raise exception 'shot not found'; end if;
  update studio_shots set status = coalesce(nullif(p_status, ''), s.status), take_url = nullif(trim(p_take_url), ''), notes = nullif(trim(p_notes), '') where id = p_id;
  perform studio_log('studio.shot.update', 'Shot ' || s.n, jsonb_build_object('status', s.status), jsonb_build_object('status', coalesce(nullif(p_status, ''), s.status)));
end $$;

-- Episode stage and final render. A new render link reopens review; approval needs a render and records who.
create or replace function studio_set_episode(p_id uuid, p_status text, p_final_url text)
returns void language plpgsql security definer set search_path = public as $$
declare e studio_episodes; v_url text := nullif(trim(p_final_url), ''); v_status text := p_status;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  select * into e from studio_episodes where id = p_id for update;
  if e.id is null then raise exception 'episode not found'; end if;
  if v_status not in ('writing','shooting','editing','review','approved','live') then raise exception 'invalid status'; end if;
  if v_url is distinct from e.final_url and e.status in ('approved','live') and v_status in ('approved','live') then
    v_status := 'review';  -- the render changed after approval: it must be approved again
  end if;
  if v_status = 'approved' and v_url is null then raise exception 'Add the final render link before approving.'; end if;
  update studio_episodes set status = v_status, final_url = v_url,
    approved_by = case when v_status = 'approved' then auth.uid() when v_status = 'live' then e.approved_by else null end,
    approved_at = case when v_status = 'approved' then now() when v_status = 'live' then e.approved_at else null end,
    updated_at = now() where id = p_id;
  if v_status not in ('approved','live') then update studio_posts set status = 'draft', approved_by = null, approved_at = null where episode_id = p_id and status = 'approved'; end if;
  perform studio_log('studio.episode.' || v_status, e.title, jsonb_build_object('status', e.status, 'final_url', e.final_url), jsonb_build_object('status', v_status, 'final_url', v_url));
end $$;

-- Post copy and timing. Editing an approved post sends it back to draft.
create or replace function studio_save_post(p_id uuid, p_caption text, p_title text, p_scheduled timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare p studio_posts;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  select * into p from studio_posts where id = p_id for update;
  if p.id is null then raise exception 'post not found'; end if;
  if p.status = 'posted' then raise exception 'Already posted: edit it on the platform.'; end if;
  if length(trim(p_caption)) < 2 then raise exception 'Caption is empty.'; end if;
  update studio_posts set caption = trim(p_caption), title = nullif(trim(p_title), ''), scheduled_for = p_scheduled,
    status = 'draft', approved_by = null, approved_at = null where id = p_id;
  perform studio_log('studio.post.edit', p.platform, jsonb_build_object('status', p.status), jsonb_build_object('status', 'draft'));
end $$;

-- Lane 3: a named person approves each post, only after its episode's render is approved.
create or replace function studio_approve_post(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p studio_posts; e studio_episodes;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  select * into p from studio_posts where id = p_id for update;
  if p.id is null then raise exception 'post not found'; end if;
  select * into e from studio_episodes where id = p.episode_id;
  if e.status not in ('approved','live') then raise exception 'Approve the episode’s final render first.'; end if;
  if p.status = 'posted' then raise exception 'Already posted.'; end if;
  update studio_posts set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
  perform studio_log('studio.post.approve', e.title || ' · ' || p.platform, jsonb_build_object('status', p.status), jsonb_build_object('status', 'approved', 'render', e.final_url));
end $$;

-- Record that a person published it, with the live link. The platform's AI-content label must be on.
create or replace function studio_mark_posted(p_id uuid, p_url text, p_ai_label boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p studio_posts;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  select * into p from studio_posts where id = p_id for update;
  if p.id is null then raise exception 'post not found'; end if;
  if p.status <> 'approved' then raise exception 'Approve the post before publishing it.'; end if;
  if not p_ai_label then raise exception 'Turn on the platform’s AI-content label, then confirm it here.'; end if;
  if nullif(trim(p_url), '') is null or trim(p_url) !~ '^https://' then raise exception 'Paste the live post link (https://…).'; end if;
  update studio_posts set status = 'posted', ai_label = true, posted_url = trim(p_url), posted_at = now() where id = p_id;
  update studio_episodes set status = 'live', updated_at = now() where id = p.episode_id and status = 'approved';
  perform studio_log('studio.post.posted', p.platform, jsonb_build_object('status', p.status), jsonb_build_object('status', 'posted', 'url', trim(p_url)));
end $$;

grant execute on function studio_update_shot(uuid, text, text, text), studio_set_episode(uuid, text, text),
  studio_save_post(uuid, text, text, timestamptz), studio_approve_post(uuid), studio_mark_posted(uuid, text, boolean) to authenticated;

-- Which campaign and platform brought each Helix tour.
alter table helix_tour_sessions add column if not exists campaign text, add column if not exists src text;
