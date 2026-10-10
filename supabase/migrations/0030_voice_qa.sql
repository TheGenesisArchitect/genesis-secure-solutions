-- Voices, the bible's acceptance gate, and post metrics.
--   studio_voice_clips  audition clips per character (sample, comic, quiet, laugh, pronunciation) and voiced
--                       dialogue lines per shot, made with a fixed synthetic voice; a character's voice is locked
--                       by an approval that is recorded as a decision.
--   studio_qa           one row per episode per acceptance check (script, visual, brand); an episode can only be
--                       approved when every check passes.
--   studio_posts        hand-entered performance metrics (until the posting service reports them).

create table if not exists studio_voice_clips (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references studio_characters on delete cascade,
  shot_id uuid references studio_shots on delete cascade,
  kind text not null check (kind in ('audition','line')),
  slot text not null,
  voice_name text not null,
  style text,
  text text not null,
  status text not null default 'queued' check (status in ('queued','ready','failed')),
  blob_path text,
  cost_cents int not null default 1,
  error text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists studio_voice_clips_char on studio_voice_clips (character_id, kind, created_at desc);
alter table studio_voice_clips enable row level security;
create policy r on studio_voice_clips for select to authenticated using ((select is_staff()));

create table if not exists studio_qa (
  episode_id uuid not null references studio_episodes on delete cascade,
  check_key text not null,
  category text not null check (category in ('script','visual','brand')),
  pass boolean not null,
  note text,
  reviewed_by uuid references auth.users on delete set null,
  reviewed_at timestamptz not null default now(),
  primary key (episode_id, check_key)
);
alter table studio_qa enable row level security;
create policy r on studio_qa for select to authenticated using ((select is_staff()));

alter table studio_posts
  add column if not exists m_retention_3s numeric, add column if not exists m_avg_watch numeric, add column if not exists m_completion numeric,
  add column if not exists m_rewatches int, add column if not exists m_shares int, add column if not exists m_comments int,
  add column if not exists m_profile_visits int, add column if not exists m_transition_note text, add column if not exists metrics_at timestamptz;

-- Voice clips count toward the Studio budget.
create or replace function studio_spent_cents() returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_cents), 0)::int from (
    select cost_cents, created_at from studio_refs where status <> 'failed'
    union all select cost_cents, created_at from studio_takes where status <> 'failed'
    union all select cost_cents, created_at from studio_art where status <> 'failed'
    union all select cost_cents, created_at from studio_voice_clips where status <> 'failed'
  ) g where (created_at at time zone 'America/New_York') >= date_trunc('month', now() at time zone 'America/New_York')
$$;

create or replace function studio_reserve_voice(p_character uuid, p_shot uuid, p_kind text, p_slot text, p_voice text, p_style text, p_text text)
returns uuid language plpgsql security definer set search_path = public as $$
declare b studio_budget; nid uuid;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  if p_kind not in ('audition','line') or length(trim(coalesce(p_text, ''))) < 2 then raise exception 'Nothing to voice.'; end if;
  select * into b from studio_budget where id;
  if studio_spent_cents() + 1 > b.monthly_cap_cents then raise exception 'Monthly Studio budget reached.'; end if;
  insert into studio_voice_clips (character_id, shot_id, kind, slot, voice_name, style, text, created_by)
  values (p_character, p_shot, p_kind, p_slot, p_voice, nullif(trim(p_style), ''), trim(p_text), auth.uid()) returning id into nid;
  return nid;
end $$;

-- Lock a character's voice (after the audition and the proof-of-concept): recorded as a bible decision.
create or replace function studio_lock_voice(p_character uuid, p_voice text, p_method text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c studio_characters;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into c from studio_characters where id = p_character for update;
  if c.id is null then raise exception 'character not found'; end if;
  update studio_characters set voice = c.voice || jsonb_build_object('tts_voice', p_voice, 'locked', true, 'method', coalesce(nullif(p_method, ''), 'tts_lipsync'), 'locked_at', now()) where id = p_character;
  insert into studio_decisions (series_id, decision, value, asset_ref, version, reason, decided_by)
  values (c.series_id, 'Locked ' || c.name || '’s voice', p_voice || ' · ' || coalesce(nullif(p_method, ''), 'tts_lipsync'), c.code || '_VOICE', 'v01', nullif(trim(p_reason), ''), auth.uid());
  perform studio_log('studio.voice.lock', c.name, jsonb_build_object('voice', c.voice->>'tts_voice'), jsonb_build_object('voice', p_voice, 'method', p_method));
end $$;

-- Record one acceptance check for an episode. Changing a check on an approved episode sends it back to review.
create or replace function studio_set_qa(p_episode uuid, p_key text, p_category text, p_pass boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare e studio_episodes;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into e from studio_episodes where id = p_episode;
  if e.id is null then raise exception 'episode not found'; end if;
  if not p_pass and length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Say what needs fixing.'; end if;
  insert into studio_qa (episode_id, check_key, category, pass, note, reviewed_by, reviewed_at)
  values (p_episode, p_key, p_category, p_pass, nullif(trim(p_note), ''), auth.uid(), now())
  on conflict (episode_id, check_key) do update set pass = excluded.pass, note = excluded.note, reviewed_by = excluded.reviewed_by, reviewed_at = now();
  if not p_pass and e.status in ('approved','live') then
    update studio_episodes set status = 'review', approved_by = null, approved_at = null where id = p_episode;
  end if;
  perform studio_log('studio.qa', e.title || ' · ' || p_key, null, jsonb_build_object('pass', p_pass));
end $$;

create or replace function studio_save_metrics(p_post uuid, p_m jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  update studio_posts set m_retention_3s = (p_m->>'retention_3s')::numeric, m_avg_watch = (p_m->>'avg_watch')::numeric, m_completion = (p_m->>'completion')::numeric,
    m_rewatches = (p_m->>'rewatches')::int, m_shares = (p_m->>'shares')::int, m_comments = (p_m->>'comments')::int, m_profile_visits = (p_m->>'profile_visits')::int,
    m_transition_note = nullif(p_m->>'transition_note', ''), metrics_at = now() where id = p_post;
end $$;

grant execute on function studio_reserve_voice(uuid, uuid, text, text, text, text, text), studio_lock_voice(uuid, text, text, text),
  studio_set_qa(uuid, text, text, boolean, text), studio_save_metrics(uuid, jsonb) to authenticated;

-- Episode approval: the fork and rights rules (0029) plus the bible's acceptance checks, every one passing.
create or replace function studio_set_episode(p_id uuid, p_status text, p_final_url text)
returns void language plpgsql security definer set search_path = public as $$
declare e studio_episodes; v_url text := nullif(trim(p_final_url), ''); v_status text := p_status; bad text; src studio_sources; v_need int; v_pass int; v_fail int;
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
    if e.kind = 'episode' then
      select coalesce(jsonb_array_length(b->'script'), 0) + coalesce(jsonb_array_length(b->'visual'), 0) + coalesce(jsonb_array_length(b->'brand'), 0) into v_need
        from (select bible->'cast_bible'->'acceptance' as b from studio_series where id = e.series_id) s;
      select count(*) filter (where pass), count(*) filter (where not pass) into v_pass, v_fail from studio_qa where episode_id = p_id;
      if coalesce(v_need, 0) > 0 and (v_fail > 0 or v_pass < v_need) then
        raise exception 'Acceptance checks: % of % passed%. Every check must pass before approval.', v_pass, v_need, case when v_fail > 0 then format(', %s failing', v_fail) else '' end;
      end if;
    end if;
  end if;
  update studio_episodes set status = v_status, final_url = v_url,
    approved_by = case when v_status = 'approved' then auth.uid() when v_status = 'live' then e.approved_by else null end,
    approved_at = case when v_status = 'approved' then now() when v_status = 'live' then e.approved_at else null end,
    updated_at = now() where id = p_id;
  if v_status not in ('approved','live') then update studio_posts set status = 'draft', approved_by = null, approved_at = null where episode_id = p_id and status = 'approved'; end if;
  perform studio_log('studio.episode.' || v_status, e.title, jsonb_build_object('status', e.status, 'final_url', e.final_url), jsonb_build_object('status', v_status, 'final_url', v_url));
end $$;
