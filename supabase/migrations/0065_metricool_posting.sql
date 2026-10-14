-- Metricool posting: a published episode's approved posts go to Metricool (lib/studio-distribute.ts), which posts
-- them to the networks; the minute's sync marks each one posted with its live link, or records why it failed.
alter table studio_posts
  add column if not exists mc_post_id bigint,
  add column if not exists mc_status text,
  add column if not exists mc_error text,
  add column if not exists mc_sent_at timestamptz;

-- The server records a send (service role only): Metricool's post id, its status, or the error that stopped it.
create or replace function studio_system_post_sent(p_id uuid, p_mc_id bigint, p_status text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare p studio_posts;
begin
  select * into p from studio_posts where id = p_id for update;
  if p.id is null then raise exception 'post not found'; end if;
  update studio_posts set mc_post_id = coalesce(p_mc_id, mc_post_id), mc_status = left(p_status, 40), mc_error = nullif(left(coalesce(p_error, ''), 500), ''),
    mc_sent_at = case when p_mc_id is not null then now() else mc_sent_at end
  where id = p_id;
  perform studio_log('studio.post.metricool', p.platform, jsonb_build_object('status', p.mc_status), jsonb_build_object('status', p_status, 'mc_post', p_mc_id, 'error', p_error));
end $$;
revoke execute on function studio_system_post_sent(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function studio_system_post_sent(uuid, bigint, text, text) to service_role;

-- Metricool reports the post live: it went out with the network's AI label set by Genovus (isAiGenerated), so the
-- post is marked posted with its link, and the episode goes live (service role only).
create or replace function studio_system_mark_posted(p_id uuid, p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare p studio_posts;
begin
  select * into p from studio_posts where id = p_id for update;
  if p.id is null then raise exception 'post not found'; end if;
  if p.status <> 'approved' then return; end if;
  if nullif(trim(p_url), '') is null or trim(p_url) !~ '^https://' then raise exception 'live link must be https'; end if;
  update studio_posts set status = 'posted', ai_label = true, posted_url = trim(p_url), posted_at = now(), mc_status = 'PUBLISHED', mc_error = null where id = p_id;
  update studio_episodes set status = 'live', updated_at = now() where id = p.episode_id and status = 'approved';
  perform studio_log('studio.post.posted', p.platform, jsonb_build_object('status', p.status), jsonb_build_object('status', 'posted', 'url', trim(p_url), 'via', 'metricool'));
end $$;
revoke execute on function studio_system_mark_posted(uuid, text) from public, anon, authenticated;
grant execute on function studio_system_mark_posted(uuid, text) to service_role;
