-- StudioNext generation on Runway: line reads (directed, per character voice), keyframes (Gen-4 Image with the
-- cast's identity references), takes (Seedance 2.5 / Gen-4.5 guided by the shot's line reads), and designed voices.
-- Every job reserves budget first (one lock, the same monthly cap and admin threshold as every Studio generation),
-- runs as a Runway task, and records Runway's final credit cost when it finishes.

-- Runway task ids on the tables that hold Runway work (takes already have `operation`).
alter table studio_voice_clips add column if not exists task_id text, add column if not exists engine text, add column if not exists approved boolean not null default false;
alter table studio_art add column if not exists task_id text;
alter table studio_voice_clips drop constraint if exists studio_voice_clips_kind_check;
alter table studio_voice_clips add constraint studio_voice_clips_kind_check check (kind in ('audition','line','design','score'));
alter table studio_voice_clips drop constraint if exists studio_voice_clips_status_check;
alter table studio_voice_clips add constraint studio_voice_clips_status_check check (status in ('queued','running','ready','failed'));
alter table studio_voice_clips alter column character_id drop not null;
create index if not exists studio_voice_clips_running on studio_voice_clips (status) where status in ('queued','running');
create index if not exists studio_art_running on studio_art (status) where status in ('queued','running');

-- A shot's capture recipe (route, device, steps) for real product screens: how a person, or later the Studio
-- itself, records the screen.
alter table studio_shots add column if not exists capture jsonb;

-- Reserve one Runway job. p_kind: line (a line read; p_shot, p_character, p_text = the line with direction tags),
-- keyframe (p_shot, p_text = the prompt, p_refs = reference ids), take (p_shot, p_text = the prompt), design (a
-- character voice from a description; p_character, p_text = the description), score (a music cue; p_shot optional).
create or replace function studio_reserve_runway(p_kind text, p_shot uuid, p_character uuid, p_text text, p_model text, p_cents int, p_params jsonb, p_refs uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare b studio_budget; spent int; nid uuid; ep uuid; c studio_characters;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  if p_kind not in ('line','keyframe','take','design','score') then raise exception 'invalid kind'; end if;
  if length(trim(coalesce(p_text, ''))) < 2 then raise exception 'Nothing to generate.'; end if;
  if p_cents is null or p_cents < 1 then raise exception 'A Runway job needs a cost estimate.'; end if;
  if p_shot is not null then
    select episode_id into ep from studio_shots where id = p_shot;
    if ep is null then raise exception 'shot not found'; end if;
  end if;
  if p_character is not null then
    select * into c from studio_characters where id = p_character;
    if c.id is null or c.status <> 'active' then raise exception 'Pick an active cast member.'; end if;
  end if;
  select * into b from studio_budget where id;
  perform pg_advisory_xact_lock(hashtext('studio_budget'));
  spent := studio_spent_cents();
  if spent + p_cents > b.monthly_cap_cents then
    raise exception 'Monthly Studio budget reached ($% of $%). Raise the cap to keep generating.', round(spent / 100.0, 2), round(b.monthly_cap_cents / 100.0, 2);
  end if;
  if p_cents > b.approval_over_cents and not has_role('admin') then
    raise exception 'This generation costs more than $% and needs an admin to start it.', round(b.approval_over_cents / 100.0, 2);
  end if;
  if p_kind in ('line','design','score') then
    if p_kind <> 'score' and c.id is null then raise exception 'Pick a cast member.'; end if;
    if p_kind = 'line' and p_shot is null then raise exception 'A line read belongs to a shot.'; end if;
    insert into studio_voice_clips (character_id, shot_id, kind, slot, voice_name, style, text, status, cost_cents, engine, created_by)
    values (c.id, p_shot, p_kind, coalesce(p_params->>'slot', upper(p_kind)), coalesce(p_params->>'voice', p_model), p_params->>'style', trim(p_text), 'queued', p_cents, 'runway:' || p_model, auth.uid())
    returning id into nid;
  elsif p_kind = 'keyframe' then
    if p_shot is null then raise exception 'A keyframe belongs to a shot.'; end if;
    insert into studio_art (episode_id, kind, shot_id, role, prompt, model, ref_ids, cost_cents, created_by)
    values (ep, 'frame', p_shot, 'start', trim(p_text), 'runway:' || p_model, coalesce(p_refs, '{}'), p_cents, auth.uid()) returning id into nid;
  else
    if p_shot is null then raise exception 'A take belongs to a shot.'; end if;
    insert into studio_takes (shot_id, kind, model, prompt, params, ref_ids, cost_cents, created_by)
    values (p_shot, 'video', 'runway:' || p_model, trim(p_text), coalesce(p_params, '{}'::jsonb) || jsonb_build_object('engine', 'runway'), coalesce(p_refs, '{}'), p_cents, auth.uid()) returning id into nid;
    update studio_shots set status = 'generating' where id = p_shot and status = 'todo';
  end if;
  perform studio_log('studio.runway.' || p_kind, coalesce(c.name, left(p_text, 60)), null, jsonb_build_object('model', p_model, 'cents', p_cents));
  return nid;
end $$;
revoke execute on function studio_reserve_runway(text, uuid, uuid, text, text, int, jsonb, uuid[]) from public, anon;
grant execute on function studio_reserve_runway(text, uuid, uuid, text, text, int, jsonb, uuid[]) to authenticated;

-- Pick the designed voice (or a preset) a character speaks with on Runway. Recorded as a bible decision.
create or replace function studio_set_runway_voice(p_character uuid, p_engine text, p_voice text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c studio_characters; clip studio_voice_clips;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  if p_engine not in ('preset','custom') then raise exception 'invalid voice engine'; end if;
  select * into c from studio_characters where id = p_character for update;
  if c.id is null then raise exception 'character not found'; end if;
  if p_engine = 'custom' then
    select * into clip from studio_voice_clips where id = p_voice::uuid and character_id = p_character and kind = 'design' and status = 'ready';
    if clip.id is null then raise exception 'That voice design is not ready.'; end if;
    update studio_voice_clips set approved = (id = clip.id) where character_id = p_character and kind = 'design';
  end if;
  update studio_characters set voice = coalesce(c.voice, '{}'::jsonb) || jsonb_build_object('runway_engine', p_engine, case when p_engine = 'custom' then 'runway_design' else 'runway_preset' end, p_voice, 'runway_set_at', now()) where id = p_character;
  insert into studio_decisions (series_id, decision, value, asset_ref, version, reason, decided_by)
  values (c.series_id, c.name || ' speaks with ' || case when p_engine = 'custom' then 'a designed voice' else 'the ' || p_voice || ' preset' end, p_engine || ' · ' || p_voice, c.code || '_VOICE', 'v02', nullif(trim(p_reason), ''), auth.uid());
  perform studio_log('studio.voice.runway', c.name, jsonb_build_object('engine', c.voice->>'runway_engine'), jsonb_build_object('engine', p_engine, 'voice', p_voice));
end $$;
revoke execute on function studio_set_runway_voice(uuid, text, text, text) from public, anon;
grant execute on function studio_set_runway_voice(uuid, text, text, text) to authenticated;

-- Pick the line read that goes into the edit (and guides the take's lip movement).
create or replace function studio_choose_clip(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v studio_voice_clips;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into v from studio_voice_clips where id = p_id for update;
  if v.id is null or v.status <> 'ready' or v.kind <> 'line' then raise exception 'That read is not ready.'; end if;
  update studio_voice_clips set approved = (id = p_id) where shot_id = v.shot_id and character_id is not distinct from v.character_id and kind = 'line' and slot = v.slot;
  perform studio_log('studio.line.choose', v.text, null, null);
end $$;
revoke execute on function studio_choose_clip(uuid) from public, anon;
grant execute on function studio_choose_clip(uuid) to authenticated;

-- Phone screenshots count as captures too.
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
