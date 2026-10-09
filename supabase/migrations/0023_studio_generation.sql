-- Studio generation: character sheets (Nano Banana Pro) and shot takes (Veo 3.1 Fast, or an uploaded recording),
-- generated and stored inside Genovus. Every generation reserves its estimated cost against a monthly cap first;
-- one costing more than the approval threshold can only be started by an admin. Finished generations are
-- recorded as expenses so Growth & financials stays true. Final cuts are bound to their sha256: a new upload
-- reopens review. Staff only (suite seats arrive in 0025). Provider calls and status updates run server-side.

create table if not exists studio_budget (
  id boolean primary key default true check (id),
  monthly_cap_cents int not null default 15000 check (monthly_cap_cents >= 0),
  approval_over_cents int not null default 500 check (approval_over_cents >= 0)
);
insert into studio_budget (id) values (true) on conflict do nothing;

create table if not exists studio_refs (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references studio_series on delete cascade,
  character text not null,
  prompt text not null,
  model text not null,
  status text not null default 'queued' check (status in ('queued','running','ready','failed')),
  blob_path text,
  canonical boolean not null default false,
  cost_cents int not null default 0,
  error text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studio_refs_series on studio_refs (series_id, character, created_at desc);

create table if not exists studio_takes (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references studio_shots on delete cascade,
  kind text not null check (kind in ('video','upload')),
  model text,
  prompt text,
  params jsonb not null default '{}'::jsonb,
  ref_ids uuid[] not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','ready','failed')),
  operation text,
  blob_path text,
  chosen boolean not null default false,
  cost_cents int not null default 0,
  error text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studio_takes_shot on studio_takes (shot_id, created_at desc);
create index if not exists studio_takes_running on studio_takes (status) where status in ('queued','running');

alter table studio_episodes add column if not exists final_blob text, add column if not exists final_sha256 text;

alter table studio_budget enable row level security;
alter table studio_refs enable row level security;
alter table studio_takes enable row level security;
create policy r on studio_budget for select to authenticated using ((select is_staff()));
create policy r on studio_refs for select to authenticated using ((select is_staff()));
create policy r on studio_takes for select to authenticated using ((select is_staff()));

-- Spend this calendar month (Eastern), counting work in flight as reserved.
create or replace function studio_spent_cents() returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_cents), 0)::int from (
    select cost_cents, created_at from studio_refs where status <> 'failed'
    union all select cost_cents, created_at from studio_takes where status <> 'failed'
  ) g where (created_at at time zone 'America/New_York') >= date_trunc('month', now() at time zone 'America/New_York')
$$;
revoke execute on function studio_spent_cents() from public, anon;
grant execute on function studio_spent_cents() to authenticated;

-- Reserve a generation: checks permission, the monthly cap and the approval threshold, then queues it.
create or replace function studio_reserve(p_kind text, p_target uuid, p_character text, p_prompt text, p_model text, p_cents int, p_params jsonb, p_refs uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare b studio_budget; spent int; nid uuid;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  if p_kind not in ('ref','video') then raise exception 'invalid kind'; end if;
  if length(trim(coalesce(p_prompt, ''))) < 10 then raise exception 'The prompt is too short.'; end if;
  select * into b from studio_budget where id;
  perform pg_advisory_xact_lock(hashtext('studio_budget'));
  spent := studio_spent_cents();
  if spent + p_cents > b.monthly_cap_cents then
    raise exception 'Monthly Studio budget reached ($% of $%). Raise the cap to keep generating.', round(spent / 100.0, 2), round(b.monthly_cap_cents / 100.0, 2);
  end if;
  if p_cents > b.approval_over_cents and not has_role('admin') then
    raise exception 'This generation costs more than $% and needs an admin to start it.', round(b.approval_over_cents / 100.0, 2);
  end if;
  if p_kind = 'ref' then
    insert into studio_refs (series_id, character, prompt, model, cost_cents, created_by)
    values (p_target, trim(p_character), trim(p_prompt), p_model, p_cents, auth.uid()) returning id into nid;
  else
    insert into studio_takes (shot_id, kind, model, prompt, params, ref_ids, cost_cents, created_by)
    values (p_target, 'video', p_model, trim(p_prompt), coalesce(p_params, '{}'::jsonb), coalesce(p_refs, '{}'), p_cents, auth.uid()) returning id into nid;
    update studio_shots set status = 'generating' where id = p_target and status = 'todo';
  end if;
  perform studio_log('studio.generate.' || p_kind, coalesce(p_character, left(p_prompt, 60)), null, jsonb_build_object('model', p_model, 'cents', p_cents));
  return nid;
end $$;

-- A recording uploaded by a person becomes a take (no cost).
create or replace function studio_add_upload_take(p_shot uuid, p_blob text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  if p_blob !~ '^studio/uploads/[A-Za-z0-9._/-]+$' then raise exception 'invalid upload'; end if;
  insert into studio_takes (shot_id, kind, status, blob_path, created_by) values (p_shot, 'upload', 'ready', p_blob, auth.uid()) returning id into nid;
  perform studio_log('studio.take.upload', 'Shot take uploaded', null, null);
  return nid;
end $$;

-- Pick the take that goes into the edit; the shot then has a good take.
create or replace function studio_choose_take(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t studio_takes;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into t from studio_takes where id = p_id for update;
  if t.id is null or t.status <> 'ready' then raise exception 'That take is not ready.'; end if;
  update studio_takes set chosen = (id = p_id), updated_at = now() where shot_id = t.shot_id;
  update studio_shots set status = case when status = 'approved' then 'approved' else 'take_ok' end, take_url = '/api/studio/media/take/' || p_id where id = t.shot_id;
  perform studio_log('studio.take.choose', 'Take chosen', null, jsonb_build_object('take', p_id));
end $$;

create or replace function studio_set_canonical(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r studio_refs;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into r from studio_refs where id = p_id;
  if r.id is null or r.status <> 'ready' then raise exception 'That sheet is not ready.'; end if;
  update studio_refs set canonical = (id = p_id) where series_id = r.series_id and character = r.character;
  perform studio_log('studio.cast.canonical', r.character, null, null);
end $$;

-- The final cut, bound to its hash: a different file reopens review and sends approved posts back to draft.
create or replace function studio_set_final(p_episode uuid, p_blob text, p_sha256 text)
returns void language plpgsql security definer set search_path = public as $$
declare e studio_episodes; v_url text;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  if p_blob !~ '^studio/finals/[A-Za-z0-9._/-]+$' or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid final'; end if;
  select * into e from studio_episodes where id = p_episode for update;
  if e.id is null then raise exception 'episode not found'; end if;
  v_url := '/api/studio/media/final/' || p_episode || '?v=' || left(p_sha256, 12);
  update studio_episodes set final_blob = p_blob, final_sha256 = p_sha256, final_url = v_url,
    status = case when e.status in ('approved','live') then 'review' when e.status in ('writing','shooting') then 'editing' else e.status end,
    approved_by = case when e.status in ('approved','live') then null else e.approved_by end,
    approved_at = case when e.status in ('approved','live') then null else e.approved_at end, updated_at = now()
  where id = p_episode;
  if e.status in ('approved','live') then update studio_posts set status = 'draft', approved_by = null, approved_at = null where episode_id = p_episode and status = 'approved'; end if;
  perform studio_log('studio.final.upload', e.title, jsonb_build_object('sha256', e.final_sha256), jsonb_build_object('sha256', p_sha256));
end $$;

create or replace function studio_set_budget(p_cap_cents int, p_approval_cents int)
returns void language plpgsql security definer set search_path = public as $$
declare b studio_budget;
begin
  if not has_role('admin') then raise exception 'Only an admin can change the Studio budget.'; end if;
  select * into b from studio_budget where id;
  update studio_budget set monthly_cap_cents = greatest(0, p_cap_cents), approval_over_cents = greatest(0, p_approval_cents) where id;
  perform studio_log('studio.budget', 'Studio budget', jsonb_build_object('cap', b.monthly_cap_cents, 'approval', b.approval_over_cents), jsonb_build_object('cap', p_cap_cents, 'approval', p_approval_cents));
end $$;

grant execute on function studio_reserve(text, uuid, text, text, text, int, jsonb, uuid[]), studio_add_upload_take(uuid, text),
  studio_choose_take(uuid), studio_set_canonical(uuid), studio_set_final(uuid, text, text), studio_set_budget(int, int) to authenticated;

-- AI generation is its own expense category.
alter table expenses drop constraint if exists expenses_category_check;
alter table expenses add constraint expenses_category_check check (category in ('ads','data','infrastructure','tools','people','ai','other'));
