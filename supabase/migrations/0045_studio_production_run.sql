-- StudioNext production runs: one approval produces many shots. A person (by tap or by voice through Helix) gets a
-- quote for a set of shots, then approves that exact quote; the server then reads the lines, draws a keyframe,
-- renders a take and parks each shot for review, all inside the approved ceiling and the monthly cap. Approvals are
-- quote-bound so a misheard "yes" can't approve anything that wasn't priced and read back.

alter table studio_episodes add column if not exists production jsonb not null default '{}';
alter table studio_shots add column if not exists produce jsonb not null default '{}';

create table if not exists studio_quotes (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references studio_episodes on delete cascade,
  shots uuid[] not null,
  cents int not null check (cents > 0),
  detail jsonb not null default '{}',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  used_at timestamptz,
  used_via text
);
alter table studio_quotes enable row level security;
create policy r on studio_quotes for select to authenticated using ((select is_staff()));

-- What a production run has spent on an episode since it started: line reads, keyframes, takes and score.
create or replace function studio_production_spent(p_episode uuid, p_since timestamptz)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(c), 0)::int from (
    select a.cost_cents c from studio_art a where a.episode_id = p_episode and a.model like 'runway:%' and a.status <> 'failed' and a.created_at >= p_since
    union all select t.cost_cents from studio_takes t join studio_shots s on s.id = t.shot_id where s.episode_id = p_episode and t.model like 'runway:%' and t.status <> 'failed' and t.created_at >= p_since
    union all select v.cost_cents from studio_voice_clips v join studio_shots s on s.id = v.shot_id where s.episode_id = p_episode and v.engine like 'runway:%' and v.status <> 'failed' and v.created_at >= p_since
  ) g
$$;
revoke execute on function studio_production_spent(uuid, timestamptz) from public, anon, authenticated;

-- A priced quote for producing a set of shots (staff). The amount is the server's estimate.
create or replace function studio_quote_production(p_episode uuid, p_shots uuid[], p_cents int, p_detail jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  if coalesce(array_length(p_shots, 1), 0) = 0 or p_cents < 1 then raise exception 'Nothing to produce.'; end if;
  if exists (select 1 from unnest(p_shots) x where not exists (select 1 from studio_shots s where s.id = x and s.episode_id = p_episode)) then raise exception 'shot not in this episode'; end if;
  insert into studio_quotes (episode_id, shots, cents, detail, created_by) values (p_episode, p_shots, p_cents, coalesce(p_detail, '{}'), auth.uid()) returning id into nid;
  return nid;
end $$;
revoke execute on function studio_quote_production(uuid, uuid[], int, jsonb) from public, anon;
grant execute on function studio_quote_production(uuid, uuid[], int, jsonb) to authenticated;

-- Approve a quote exactly as priced (staff, the same person who asked for it, within 15 minutes). Starts the run with
-- a ceiling 25% above the estimate (Runway's final costs vary a little); the admin threshold and the cap apply.
create or replace function studio_approve_production(p_quote uuid, p_via text)
returns void language plpgsql security definer set search_path = public as $$
declare q studio_quotes; e studio_episodes; b studio_budget; v_ceiling int; v_run jsonb;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into q from studio_quotes where id = p_quote for update;
  if q.id is null then raise exception 'That quote doesn''t exist. Ask for a new one.'; end if;
  if q.used_at is not null then raise exception 'That quote was already approved.'; end if;
  if q.expires_at < now() then raise exception 'That quote expired. Ask for a fresh one.'; end if;
  if q.created_by is distinct from auth.uid() then raise exception 'Only the person who asked for the quote can approve it.'; end if;
  select * into b from studio_budget where id;
  perform pg_advisory_xact_lock(hashtext('studio_budget'));
  v_ceiling := ceil(q.cents * 1.25);
  if q.cents > b.approval_over_cents and not has_role('admin') then
    raise exception 'This run costs more than $% and needs an admin to approve it.', round(b.approval_over_cents / 100.0, 2);
  end if;
  if studio_spent_cents() + q.cents > b.monthly_cap_cents then
    raise exception 'This run would pass the monthly Studio budget ($% of $% used).', round(studio_spent_cents() / 100.0, 2), round(b.monthly_cap_cents / 100.0, 2);
  end if;
  select * into e from studio_episodes where id = q.episode_id for update;
  -- A run already going on this episode is extended: its shots and ceiling grow, its start time stays.
  if coalesce((e.production->>'on')::boolean, false) then
    v_run := e.production || jsonb_build_object('ceiling_cents', coalesce((e.production->>'ceiling_cents')::int, 0) + v_ceiling,
      'shots', (select jsonb_agg(distinct x) from (select jsonb_array_elements_text(e.production->'shots') x union select unnest(q.shots)::text) u));
  else
    v_run := jsonb_build_object('on', true, 'by', auth.uid(), 'at', now(), 'ceiling_cents', v_ceiling, 'shots', to_jsonb(q.shots));
  end if;
  update studio_episodes set production = v_run || jsonb_build_object('quote', q.id, 'via', p_via) where id = e.id;
  update studio_shots set produce = jsonb_build_object('stage', 'queued', 'since', now()) where id = any(q.shots) and coalesce(produce->>'stage', '') not in ('approved');
  update studio_quotes set used_at = now(), used_via = left(coalesce(p_via, 'tap'), 20) where id = q.id;
  insert into studio_decisions (series_id, decision, value, asset_ref, version, reason, decided_by)
  values (e.series_id, 'Approved production of ' || array_length(q.shots, 1) || ' shots of ' || e.title, '$' || round(q.cents / 100.0, 2) || ' estimate · ceiling $' || round(v_ceiling / 100.0, 2), e.code, null, 'Approved by ' || coalesce(p_via, 'tap'), auth.uid());
  perform studio_log('studio.production.approve', e.code, null, jsonb_build_object('quote', q.id, 'cents', q.cents, 'shots', array_length(q.shots, 1), 'via', p_via));
end $$;
revoke execute on function studio_approve_production(uuid, text) from public, anon;
grant execute on function studio_approve_production(uuid, text) to authenticated;

-- Pause a run (staff). Work already started finishes; nothing new starts.
create or replace function studio_pause_production(p_episode uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  update studio_episodes set production = production || jsonb_build_object('on', false, 'paused_at', now(), 'paused_reason', 'Paused by the team') where id = p_episode;
  perform studio_log('studio.production.pause', p_episode::text, null, null);
end $$;
revoke execute on function studio_pause_production(uuid) from public, anon;
grant execute on function studio_pause_production(uuid) to authenticated;

-- Review a produced shot (staff): approve it, or send it back with a note (a new keyframe and take, inside the run).
create or replace function studio_review_shot(p_shot uuid, p_action text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare s studio_shots; e studio_episodes;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into s from studio_shots where id = p_shot for update;
  if s.id is null then raise exception 'shot not found'; end if;
  select * into e from studio_episodes where id = s.episode_id;
  if p_action = 'approve' then
    if not exists (select 1 from studio_takes where shot_id = p_shot and chosen and status = 'ready') and s.tool <> 'edit' then raise exception 'There''s no picked take to approve yet.'; end if;
    update studio_shots set status = 'approved', produce = produce || jsonb_build_object('stage', 'approved', 'approved_at', now(), 'approved_by', auth.uid()) where id = p_shot;
  elsif p_action = 'redo' then
    if not coalesce((e.production->>'on')::boolean, false) then raise exception 'Start a production run first: redos come out of its approved budget.'; end if;
    if not (e.production->'shots') ? p_shot::text then raise exception 'That shot isn''t in the approved run.'; end if;
    update studio_art set chosen = false where shot_id = p_shot and kind = 'frame';
    update studio_shots set status = 'generating', produce = jsonb_build_object('stage', 'queued', 'since', now(), 'redo_note', nullif(trim(p_note), ''), 'redos', coalesce((s.produce->>'redos')::int, 0) + 1),
      log = case when nullif(trim(p_note), '') is null then log else log || jsonb_build_object('acting', left(coalesce(log->>'acting', '') || case when coalesce(log->>'acting', '') = '' then '' else '. ' end || trim(p_note), 300)) end
    where id = p_shot;
  else raise exception 'invalid action'; end if;
  perform studio_log('studio.review.' || p_action, coalesce(s.shot_code, s.n::text), null, jsonb_build_object('note', p_note));
end $$;
revoke execute on function studio_review_shot(uuid, text, text) from public, anon;
grant execute on function studio_review_shot(uuid, text, text) to authenticated;

-- The server's reservation for a production run (service role only): run on, inside its ceiling and the cap.
create or replace function studio_reserve_runway_auto(p_kind text, p_shot uuid, p_character uuid, p_text text, p_model text, p_cents int, p_params jsonb, p_refs uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare b studio_budget; e studio_episodes; nid uuid; v_by uuid; v_since timestamptz; v_ceiling int;
begin
  if p_kind not in ('line','keyframe','take') then raise exception 'invalid kind'; end if;
  select ep.* into e from studio_episodes ep join studio_shots s on s.episode_id = ep.id where s.id = p_shot;
  if e.id is null then raise exception 'shot not found'; end if;
  if coalesce((e.production->>'on')::boolean, false) is not true then raise exception 'The production run is paused.'; end if;
  if not (e.production->'shots') ? p_shot::text then raise exception 'That shot isn''t in the approved run.'; end if;
  v_by := nullif(e.production->>'by', '')::uuid;
  v_since := (e.production->>'at')::timestamptz;
  v_ceiling := coalesce((e.production->>'ceiling_cents')::int, 0);
  select * into b from studio_budget where id;
  perform pg_advisory_xact_lock(hashtext('studio_budget'));
  if studio_spent_cents() + p_cents > b.monthly_cap_cents then raise exception 'Monthly Studio budget reached ($% of $%).', round(studio_spent_cents() / 100.0, 2), round(b.monthly_cap_cents / 100.0, 2); end if;
  if studio_production_spent(e.id, v_since) + p_cents > v_ceiling then raise exception 'The run reached its approved ceiling ($%).', round(v_ceiling / 100.0, 2); end if;
  if p_kind = 'line' then
    insert into studio_voice_clips (character_id, shot_id, kind, slot, voice_name, style, text, status, cost_cents, engine, created_by)
    values (p_character, p_shot, 'line', coalesce(p_params->>'slot', 'L1'), coalesce(p_params->>'voice', p_model), p_params->>'style', trim(p_text), 'queued', p_cents, 'runway:' || p_model, v_by) returning id into nid;
  elsif p_kind = 'keyframe' then
    insert into studio_art (episode_id, kind, shot_id, role, prompt, model, ref_ids, cost_cents, created_by)
    values (e.id, 'frame', p_shot, 'start', trim(p_text), 'runway:' || p_model, coalesce(p_refs, '{}'), p_cents, v_by) returning id into nid;
  else
    insert into studio_takes (shot_id, kind, model, prompt, params, ref_ids, cost_cents, created_by)
    values (p_shot, 'video', 'runway:' || p_model, trim(p_text), coalesce(p_params, '{}'::jsonb) || jsonb_build_object('engine', 'runway', 'run', true), coalesce(p_refs, '{}'), p_cents, v_by) returning id into nid;
  end if;
  perform studio_log('studio.production.' || p_kind, e.code, null, jsonb_build_object('model', p_model, 'cents', p_cents, 'shot', p_shot));
  return nid;
end $$;
revoke execute on function studio_reserve_runway_auto(text, uuid, uuid, text, text, int, jsonb, uuid[]) from public, anon, authenticated;

-- Single-flight: claim a shot's next step for a few minutes before calling Runway (service role only). Only the
-- caller that wins the claim starts the work, so the cron, the board and an approval kick can't double-spend.
create or replace function studio_claim_step(p_shot uuid, p_step text, p_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update studio_shots set produce = produce || jsonb_build_object('lease_step', p_step, 'lease_until', now() + make_interval(secs => p_seconds))
  where id = p_shot and (produce->>'lease_until' is null or (produce->>'lease_until')::timestamptz < now());
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke execute on function studio_claim_step(uuid, text, int) from public, anon, authenticated;
