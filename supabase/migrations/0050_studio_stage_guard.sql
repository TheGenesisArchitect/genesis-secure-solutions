-- A shot the team stopped (blocked) or approved stays that way: the production advancer's routine stage updates
-- can't move it back. Only an explicit action (retry, cancel, a lock, approval) passes `force`.
create or replace function studio_shot_produce_patch(p_shot uuid, p_patch jsonb)
returns void language sql security definer set search_path = public as $$
  update studio_shots set produce = (coalesce(produce, '{}'::jsonb) || (coalesce(p_patch, '{}'::jsonb) - 'since_now' - 'force'
      - case when coalesce((p_patch->>'force')::boolean, false) = false and coalesce(produce->>'stage', '') in ('blocked', 'approved') then 'stage' else '' end))
    || case when coalesce(p_patch, '{}'::jsonb) ? 'since_now' then jsonb_build_object('since', now()) else '{}'::jsonb end
  where id = p_shot
$$;
revoke execute on function studio_shot_produce_patch(uuid, jsonb) from public, anon, authenticated;
