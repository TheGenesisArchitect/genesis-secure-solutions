-- Studio auto-produce: a run inside the approval line ($5, studio_budget.approval_over_cents) approves itself
-- (studio_approve_production with via 'auto', same audit and monthly cap), and when every shot of the run has
-- landed the server finishes the episode: the final cut and every Short render with no one pressing a button.
-- A person still decides what goes public: one Publish tap per episode (studio_publish_episode).

-- The finisher runs as the server (service role), so it records renders through these two; nobody else can call them.
create or replace function studio_system_set_final(p_episode uuid, p_blob text, p_sha256 text)
returns void language plpgsql security definer set search_path = public as $$
declare e studio_episodes; v_url text;
begin
  if p_blob !~ '^studio/finals/[A-Za-z0-9._/-]+$' or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid final'; end if;
  select * into e from studio_episodes where id = p_episode for update;
  if e.id is null then raise exception 'episode not found'; end if;
  v_url := '/api/studio/media/final/' || p_episode || '?v=' || left(p_sha256, 12);
  -- A new final always goes back to review: an approved episode never silently changes its picture.
  update studio_episodes set final_blob = p_blob, final_sha256 = p_sha256, final_url = v_url,
    status = case when e.status in ('approved','live','writing','shooting','editing') then 'review' else e.status end,
    approved_by = null, approved_at = null, updated_at = now()
  where id = p_episode;
  update studio_posts set status = 'draft', approved_by = null, approved_at = null where episode_id = p_episode and status = 'approved';
  perform studio_log('studio.final.auto', e.title, jsonb_build_object('sha256', e.final_sha256), jsonb_build_object('sha256', p_sha256));
end $$;
revoke execute on function studio_system_set_final(uuid, text, text) from public, anon, authenticated;
grant execute on function studio_system_set_final(uuid, text, text) to service_role;

create or replace function studio_system_add_render(p_episode uuid, p_kind text, p_format text, p_short text, p_title text, p_blob text, p_secs numeric, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  insert into studio_renders (episode_id, kind, format, short_code, title, blob_path, secs, note, created_by)
  values (p_episode, p_kind, p_format, nullif(p_short, ''), left(p_title, 120), p_blob, p_secs, left(p_note, 600), null)
  returning id into rid;
  perform studio_log('studio.render.auto.' || p_kind, p_episode::text, null, jsonb_build_object('blob', p_blob, 'format', p_format, 'short', p_short));
  return rid;
end $$;
revoke execute on function studio_system_add_render(uuid, text, text, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function studio_system_add_render(uuid, text, text, text, text, text, numeric, text) to service_role;

-- One Publish tap per episode: the person who taps signs off every acceptance check not already recorded (a check
-- someone failed stays failed and blocks), approves the episode (rights and the final cut are still checked by
-- studio_set_episode), and approves every post that isn't out yet. Returns what it did.
create or replace function studio_publish_episode(p_episode uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e studio_episodes; acc jsonb; cat text; n int; i int; v_failed text; v_signed int := 0; v_posts int;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  select * into e from studio_episodes where id = p_episode;
  if e.id is null then raise exception 'episode not found'; end if;
  if e.final_url is null then raise exception 'The final cut isn''t rendered yet.'; end if;
  select string_agg(check_key || coalesce(' (' || note || ')', ''), '; ') into v_failed from studio_qa where episode_id = p_episode and not pass;
  if v_failed is not null then raise exception 'A check was marked failing: %. Fix it or re-check it first.', v_failed; end if;
  select bible->'cast_bible'->'acceptance' into acc from studio_series where id = e.series_id;
  if e.kind = 'episode' and acc is not null then
    foreach cat in array array['script','visual','brand'] loop
      n := coalesce(jsonb_array_length(acc->cat), 0);
      for i in 1..n loop
        insert into studio_qa (episode_id, check_key, category, pass, note, reviewed_by, reviewed_at)
        values (p_episode, cat || '-' || i, cat, true, 'Signed off with Publish', auth.uid(), now())
        on conflict (episode_id, check_key) do nothing;
        if found then v_signed := v_signed + 1; end if;
      end loop;
    end loop;
  end if;
  if e.status not in ('approved','live') then perform studio_set_episode(p_episode, 'approved', e.final_url); end if;
  update studio_posts set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where episode_id = p_episode and status not in ('approved','posted');
  get diagnostics v_posts = row_count;
  perform studio_log('studio.episode.publish', e.title, jsonb_build_object('status', e.status), jsonb_build_object('status', 'approved', 'checks_signed', v_signed, 'posts', v_posts));
  return jsonb_build_object('checks_signed', v_signed, 'posts', v_posts);
end $$;
revoke execute on function studio_publish_episode(uuid) from public, anon;
grant execute on function studio_publish_episode(uuid) to authenticated;
