-- The Viral Fork episode format and the bible's shot log.
--   format     original | viral_fork
--   fork_mode  split (the original plays whole beside our fork, made in-app) | sequential (their hook, then ours,
--              in-app) | seamless (an edited intercut: only with the creator's written license on file)
-- Shots carry the bible's continuity record (shot code, beat, kind, camera side, gaze, prop hand, emotional state in
-- and out, reference versions, screen asset, source in/out, dialogue, sound). Source shots are the creator's
-- footage: they can never be generated or altered.

alter table studio_episodes
  add column if not exists format text not null default 'original' check (format in ('original','viral_fork')),
  add column if not exists fork_mode text check (fork_mode in ('split','sequential','seamless')),
  add column if not exists source_id uuid references studio_sources on delete set null,
  add column if not exists target_s int,
  add column if not exists cut_family text check (cut_family in ('quick','signature','extended')),
  add column if not exists seat_map jsonb;

alter table studio_shots drop constraint if exists studio_shots_tool_check;
alter table studio_shots add constraint studio_shots_tool_check check (tool in ('flow','nano-banana','capture','edit','veo','source'));
alter table studio_shots
  add column if not exists shot_code text,
  add column if not exists beat int check (beat between 1 and 8),
  add column if not exists shot_kind text check (shot_kind in ('source','fork','product','signature','sting','pickup')),
  add column if not exists cast_codes text[] not null default '{}',
  add column if not exists log jsonb not null default '{}'::jsonb,   -- camera, gaze, prop_hand, mood_in, mood_out, screen_asset, src_in, src_out, sound, look_codes, ref_versions
  add column if not exists lines jsonb not null default '[]'::jsonb; -- [{ who: 'TRENT01', text: '…' }]

-- The creator's footage is never generated: a take can't be started on a source shot.
create or replace function studio_takes_no_source() returns trigger language plpgsql as $$
begin
  if new.kind = 'video' and exists (select 1 from studio_shots where id = new.shot_id and (shot_kind = 'source' or tool = 'source')) then
    raise exception 'That shot is the original creator''s footage. It plays in the app as-is; it is never generated or altered.';
  end if;
  return new;
end $$;
drop trigger if exists studio_takes_no_source on studio_takes;
create trigger studio_takes_no_source before insert on studio_takes for each row execute function studio_takes_no_source();

-- Episode format and fork mode. A fork needs a Remix/Stitch source; seamless also needs the written license.
create or replace function studio_set_format(p_id uuid, p_format text, p_mode text, p_target int, p_source uuid, p_cut text)
returns void language plpgsql security definer set search_path = public as $$
declare e studio_episodes;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into e from studio_episodes where id = p_id for update;
  if e.id is null then raise exception 'episode not found'; end if;
  if p_format = 'viral_fork' and p_mode is null then raise exception 'Pick a fork mode.'; end if;
  update studio_episodes set format = p_format, fork_mode = case when p_format = 'viral_fork' then p_mode end,
    target_s = p_target, source_id = case when p_format = 'viral_fork' then p_source end, cut_family = p_cut,
    status = case when e.status in ('approved','live') then 'review' else e.status end, updated_at = now()
  where id = p_id;
  if p_format = 'viral_fork' and p_source is not null then update studio_sources set episode_id = p_id where id = p_source; end if;
  perform studio_log('studio.episode.format', e.title, jsonb_build_object('format', e.format, 'mode', e.fork_mode), jsonb_build_object('format', p_format, 'mode', p_mode));
end $$;

-- The shot log (continuity record) for one shot.
create or replace function studio_update_shot_log(p_id uuid, p_log jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare s studio_shots;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into s from studio_shots where id = p_id for update;
  if s.id is null then raise exception 'shot not found'; end if;
  update studio_shots set log = s.log || coalesce(p_log, '{}'::jsonb) where id = p_id;
  perform studio_log('studio.shot.log', coalesce(s.shot_code, 'Shot ' || s.n), null, p_log);
end $$;

-- Episode approval: rights per source (0026) plus the fork rules.
create or replace function studio_set_episode(p_id uuid, p_status text, p_final_url text)
returns void language plpgsql security definer set search_path = public as $$
declare e studio_episodes; v_url text := nullif(trim(p_final_url), ''); v_status text := p_status; bad text; src studio_sources;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  select * into e from studio_episodes where id = p_id for update;
  if e.id is null then raise exception 'episode not found'; end if;
  if v_status not in ('writing','shooting','editing','review','approved','live') then raise exception 'invalid status'; end if;
  if v_url is distinct from e.final_url and e.status in ('approved','live') and v_status in ('approved','live') then v_status := 'review'; end if;
  if v_status = 'approved' and v_url is null then raise exception 'Add the final render link before approving.'; end if;
  if v_status = 'approved' then
    if e.format = 'viral_fork' then
      select * into src from studio_sources where id = e.source_id;
      if src.id is null then raise exception 'A Viral Fork needs its source on the trend board.'; end if;
      if src.route <> 'stitch' or src.remix_allowed is not true then raise exception 'Confirm the source allows Remix/Stitch before approving this fork.'; end if;
      if e.fork_mode = 'seamless' and (src.license_status <> 'granted' or src.license_blob is null) then
        raise exception 'A Seamless Fork edits the creator''s footage: upload their written license first, or switch to Split or Sequential.';
      end if;
    end if;
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

grant execute on function studio_set_format(uuid, text, text, int, uuid, text), studio_update_shot_log(uuid, jsonb) to authenticated;
