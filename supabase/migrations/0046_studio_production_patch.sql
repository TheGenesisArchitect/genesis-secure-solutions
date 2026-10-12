-- Production run updates from the server merge in place (never a whole-record write from a stale copy), so a
-- concurrent approval, ceiling change or pause is never undone by the advancer.
create or replace function studio_production_patch(p_episode uuid, p_patch jsonb, p_remove text[])
returns void language sql security definer set search_path = public as $$
  update studio_episodes set production = (production - coalesce(p_remove, '{}')) || coalesce(p_patch, '{}'::jsonb) where id = p_episode
$$;
revoke execute on function studio_production_patch(uuid, jsonb, text[]) from public, anon, authenticated;
