-- SWIS™ autopilot: once a staff member starts it on an episode (with a spending ceiling), the server paints frame
-- candidates, auto-chooses production-shot frames, starts takes, and picks each shot's best take from the Creative
-- Court. Hero-shot frames still wait for a person (the look decision). Every reservation is checked here, under
-- the same lock as all Studio spend: the episode's autopilot must be on, within its ceiling and the monthly cap.

alter table studio_episodes add column if not exists autopilot jsonb not null default '{}';

-- What the autopilot has spent on an episode since it was started (frames, takes and Court reviews).
create or replace function studio_episode_auto_spent(p_episode uuid, p_since timestamptz)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(c), 0)::int from (
    select a.cost_cents c from studio_art a where a.episode_id = p_episode and a.kind = 'frame' and a.status <> 'failed' and a.created_at >= p_since
    union all select t.cost_cents from studio_takes t join studio_shots s on s.id = t.shot_id where s.episode_id = p_episode and t.status <> 'failed' and t.created_at >= p_since
    union all select t.court_cost_cents from studio_takes t join studio_shots s on s.id = t.shot_id where s.episode_id = p_episode and t.court_cost_cents > 0 and coalesce(t.court_at, t.created_at) >= p_since
  ) g
$$;
revoke execute on function studio_episode_auto_spent(uuid, timestamptz) from public, anon, authenticated;

-- Reserve a frame candidate or a video take for the autopilot (server only).
create or replace function studio_reserve_auto(p_kind text, p_shot uuid, p_role text, p_prompt text, p_model text, p_cents int, p_params jsonb, p_refs uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare b studio_budget; e studio_episodes; spent int; nid uuid; v_by uuid; v_since timestamptz; v_ceiling int;
begin
  if p_kind not in ('frame','video') then raise exception 'invalid kind'; end if;
  select ep.* into e from studio_episodes ep join studio_shots s on s.episode_id = ep.id where s.id = p_shot;
  if e.id is null then raise exception 'shot not found'; end if;
  if coalesce((e.autopilot->>'on')::boolean, false) is not true then raise exception 'Autopilot is off for this episode.'; end if;
  v_by := nullif(e.autopilot->>'by', '')::uuid;
  v_since := (e.autopilot->>'at')::timestamptz;
  v_ceiling := coalesce((e.autopilot->>'ceiling_cents')::int, 0);
  select * into b from studio_budget where id;
  perform pg_advisory_xact_lock(hashtext('studio_budget'));
  spent := studio_spent_cents();
  if spent + p_cents > b.monthly_cap_cents then raise exception 'Monthly Studio budget reached ($% of $%).', round(spent / 100.0, 2), round(b.monthly_cap_cents / 100.0, 2); end if;
  if studio_episode_auto_spent(e.id, v_since) + p_cents > v_ceiling then raise exception 'Autopilot ceiling reached for this episode ($%).', round(v_ceiling / 100.0, 2); end if;
  if p_kind = 'frame' then
    insert into studio_art (episode_id, kind, shot_id, role, prompt, model, ref_ids, cost_cents, created_by)
    values (e.id, 'frame', p_shot, coalesce(p_role, 'start'), trim(p_prompt), p_model, coalesce(p_refs, '{}'), p_cents, v_by) returning id into nid;
  else
    insert into studio_takes (shot_id, kind, model, prompt, params, ref_ids, cost_cents, created_by)
    values (p_shot, 'video', p_model, trim(p_prompt), coalesce(p_params, '{}'::jsonb) || jsonb_build_object('autopilot', true), coalesce(p_refs, '{}'), p_cents, v_by) returning id into nid;
    update studio_shots set status = 'generating' where id = p_shot and status = 'todo';
  end if;
  perform studio_log('studio.autopilot.' || p_kind, e.code, null, jsonb_build_object('model', p_model, 'cents', p_cents, 'shot', p_shot));
  return nid;
end $$;
revoke execute on function studio_reserve_auto(text, uuid, text, text, text, int, jsonb, uuid[]) from public, anon, authenticated;

-- The autopilot's picks, recorded the same way a person's are.
create or replace function studio_auto_choose_frame(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a studio_art;
begin
  select * into a from studio_art where id = p_id and kind = 'frame' and status = 'ready';
  if a.id is null then raise exception 'frame not ready'; end if;
  update studio_art set chosen = (id = p_id), updated_at = now() where shot_id = a.shot_id and role = a.role and kind = 'frame';
end $$;
revoke execute on function studio_auto_choose_frame(uuid) from public, anon, authenticated;

create or replace function studio_auto_choose_take(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t studio_takes;
begin
  select * into t from studio_takes where id = p_id for update;
  if t.id is null or t.status <> 'ready' then raise exception 'That take is not ready.'; end if;
  update studio_takes set chosen = (id = p_id), updated_at = now() where shot_id = t.shot_id;
  update studio_shots set status = case when status = 'approved' then 'approved' else 'take_ok' end, take_url = '/api/studio/media/take/' || p_id where id = t.shot_id;
  perform studio_log('studio.autopilot.pick', 'Court pick', null, jsonb_build_object('take', p_id));
end $$;
revoke execute on function studio_auto_choose_take(uuid) from public, anon, authenticated;

-- Start, pause or resume the autopilot on an episode (staff; starting records who authorized it and the ceiling).
create or replace function studio_set_autopilot(p_episode uuid, p_on boolean, p_ceiling_cents int)
returns void language plpgsql security definer set search_path = public as $$
declare e studio_episodes;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into e from studio_episodes where id = p_episode for update;
  if e.id is null then raise exception 'episode not found'; end if;
  if p_on and (p_ceiling_cents is null or p_ceiling_cents < 100) then raise exception 'Set a spending ceiling for the autopilot.'; end if;
  update studio_episodes set autopilot = case
    when p_on then jsonb_build_object('on', true, 'by', auth.uid(), 'at', coalesce(case when (e.autopilot->>'on')::boolean then e.autopilot->>'at' end, now()::text), 'ceiling_cents', p_ceiling_cents)
    else e.autopilot || jsonb_build_object('on', false, 'paused_at', now()) end
  where id = p_episode;
  perform studio_log(case when p_on then 'studio.autopilot.start' else 'studio.autopilot.pause' end, e.code, null, jsonb_build_object('ceiling_cents', p_ceiling_cents));
end $$;
revoke execute on function studio_set_autopilot(uuid, boolean, int) from public, anon;
grant execute on function studio_set_autopilot(uuid, boolean, int) to authenticated;

-- The server (service role) runs the autopilot.
grant execute on function studio_episode_auto_spent(uuid, timestamptz) to service_role;
grant execute on function studio_reserve_auto(text, uuid, text, text, text, int, jsonb, uuid[]) to service_role;
grant execute on function studio_auto_choose_frame(uuid) to service_role;
grant execute on function studio_auto_choose_take(uuid) to service_role;
