-- Studio key art: thumbnails for each episode (Nano Banana Pro, with the cast's reference sheets), framed with the
-- Genovus signature at render time. Same reserve-first budget as every other generation.

create table if not exists studio_art (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references studio_episodes on delete cascade,
  kind text not null default 'thumbnail' check (kind in ('thumbnail')),
  prompt text not null,
  model text not null,
  ref_ids uuid[] not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','ready','failed')),
  blob_path text,
  chosen boolean not null default false,
  cost_cents int not null default 0,
  error text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studio_art_episode on studio_art (episode_id, created_at desc);
alter table studio_art enable row level security;
create policy r on studio_art for select to authenticated using ((select is_staff()));

create or replace function studio_spent_cents() returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_cents), 0)::int from (
    select cost_cents, created_at from studio_refs where status <> 'failed'
    union all select cost_cents, created_at from studio_takes where status <> 'failed'
    union all select cost_cents, created_at from studio_art where status <> 'failed'
  ) g where (created_at at time zone 'America/New_York') >= date_trunc('month', now() at time zone 'America/New_York')
$$;

create or replace function studio_reserve(p_kind text, p_target uuid, p_character text, p_prompt text, p_model text, p_cents int, p_params jsonb, p_refs uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare b studio_budget; spent int; nid uuid;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  if p_kind not in ('ref','video','thumb') then raise exception 'invalid kind'; end if;
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
  elsif p_kind = 'thumb' then
    insert into studio_art (episode_id, prompt, model, ref_ids, cost_cents, created_by)
    values (p_target, trim(p_prompt), p_model, coalesce(p_refs, '{}'), p_cents, auth.uid()) returning id into nid;
  else
    insert into studio_takes (shot_id, kind, model, prompt, params, ref_ids, cost_cents, created_by)
    values (p_target, 'video', p_model, trim(p_prompt), coalesce(p_params, '{}'::jsonb), coalesce(p_refs, '{}'), p_cents, auth.uid()) returning id into nid;
    update studio_shots set status = 'generating' where id = p_target and status = 'todo';
  end if;
  perform studio_log('studio.generate.' || p_kind, coalesce(p_character, left(p_prompt, 60)), null, jsonb_build_object('model', p_model, 'cents', p_cents));
  return nid;
end $$;

-- The thumbnail every post of the episode uses.
create or replace function studio_choose_art(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a studio_art;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into a from studio_art where id = p_id;
  if a.id is null or a.status <> 'ready' then raise exception 'That thumbnail is not ready.'; end if;
  update studio_art set chosen = (id = p_id), updated_at = now() where episode_id = a.episode_id;
  perform studio_log('studio.thumbnail.choose', 'Thumbnail chosen', null, jsonb_build_object('art', p_id));
end $$;
grant execute on function studio_choose_art(uuid) to authenticated;
