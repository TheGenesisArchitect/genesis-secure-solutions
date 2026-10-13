-- Runway Model Routers, one per job (hero video, production video, quick drafts, keyframes, fast images), named
-- in Studio settings so they can be changed without a release. Production runs gain a pass: a quick draft of every
-- shot first (fast, cheap, for review), then a final render of the approved drafts on the hero / production routers.
alter table studio_budget add column if not exists routers jsonb not null default jsonb_build_object(
  'hero', 'genovus-video-hero', 'production', 'genovus-video-production', 'draft', 'genovus-video-draft',
  'keyframe', 'genovus-image-keyframe', 'image_fast', 'genovus-image-fast');

create or replace function studio_set_routers(p_routers jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare k text; v text; clean jsonb := '{}'::jsonb;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  for k in select unnest(array['hero','production','draft','keyframe','image_fast']) loop
    v := trim(coalesce(p_routers->>k, ''));
    if v <> '' and v !~ '^[a-z0-9][a-z0-9-]{1,62}$' then raise exception 'Router names are lowercase letters, numbers and dashes (%).', k; end if;
    if v <> '' then clean := clean || jsonb_build_object(k, v); end if;
  end loop;
  update studio_budget set routers = routers || clean where id;
  perform studio_log('studio.routers', 'Runway routers', null, clean);
end $$;
revoke execute on function studio_set_routers(jsonb) from public, anon;
grant execute on function studio_set_routers(jsonb) to authenticated;

create or replace function studio_approve_production(p_quote uuid, p_via text)
returns void language plpgsql security definer set search_path = public as $$
declare q studio_quotes; e studio_episodes; b studio_budget; v_ceiling int; v_run jsonb; v_pass text;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into q from studio_quotes where id = p_quote for update;
  if q.id is null then raise exception 'That quote doesn''t exist. Ask for a new one.'; end if;
  if q.used_at is not null then raise exception 'That quote was already approved.'; end if;
  if q.expires_at < now() then raise exception 'That quote expired. Ask for a fresh one.'; end if;
  if q.created_by is distinct from auth.uid() then raise exception 'Only the person who asked for the quote can approve it.'; end if;
  v_pass := case when q.detail->>'pass' = 'draft' then 'draft' else 'final' end;
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
  update studio_shots set produce = jsonb_build_object('stage', 'queued', 'since', now(), 'pass', v_pass) where id = any(q.shots) and coalesce(produce->>'stage', '') not in ('approved');
  update studio_quotes set used_at = now(), used_via = left(coalesce(p_via, 'tap'), 20) where id = q.id;
  insert into studio_decisions (series_id, decision, value, asset_ref, version, reason, decided_by)
  values (e.series_id, 'Approved ' || v_pass || ' production of ' || array_length(q.shots, 1) || ' shots of ' || e.title, '$' || round(q.cents / 100.0, 2) || ' estimate · ceiling $' || round(v_ceiling / 100.0, 2), e.code, null, 'Approved by ' || coalesce(p_via, 'tap'), auth.uid());
  perform studio_log('studio.production.approve', e.code, null, jsonb_build_object('quote', q.id, 'cents', q.cents, 'shots', array_length(q.shots, 1), 'via', p_via));
end $$;


-- Approving a shot in a draft pass approves the draft (ready for its final render); in a final pass it approves the shot.
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
    if coalesce(s.produce->>'pass', 'final') = 'draft' then
      -- A draft approval: the shot is ready for its final render.
      update studio_shots set produce = produce || jsonb_build_object('stage', 'draft_ok', 'draft_ok_at', now(), 'draft_ok_by', auth.uid()) where id = p_shot;
    else
      update studio_shots set status = 'approved', produce = produce || jsonb_build_object('stage', 'approved', 'approved_at', now(), 'approved_by', auth.uid()) where id = p_shot;
    end if;
  elsif p_action = 'redo' then
    if not coalesce((e.production->>'on')::boolean, false) then raise exception 'Start a production run first: redos come out of its approved budget.'; end if;
    if not (e.production->'shots') ? p_shot::text then raise exception 'That shot isn''t in the approved run.'; end if;
    update studio_art set chosen = false where shot_id = p_shot and kind = 'frame';
    update studio_shots set status = 'generating', produce = jsonb_build_object('stage', 'queued', 'since', now(), 'pass', coalesce(s.produce->>'pass', 'final'), 'redo_note', nullif(trim(p_note), ''), 'redos', coalesce((s.produce->>'redos')::int, 0) + 1),
      log = case when nullif(trim(p_note), '') is null then log else log || jsonb_build_object('acting', left(coalesce(log->>'acting', '') || case when coalesce(log->>'acting', '') = '' then '' else '. ' end || trim(p_note), 300)) end
    where id = p_shot;
  else raise exception 'invalid action'; end if;
  perform studio_log('studio.review.' || p_action, coalesce(s.shot_code, s.n::text), null, jsonb_build_object('note', p_note));
end $$;

