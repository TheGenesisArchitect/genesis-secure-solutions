-- A shot's production pass start ("since") always comes from the database clock (the same clock that stamps every
-- job), so a restart never misses the job it just started because the app server's clock runs a little ahead.
create or replace function studio_shot_produce_patch(p_shot uuid, p_patch jsonb)
returns void language sql security definer set search_path = public as $$
  update studio_shots set produce = (coalesce(produce, '{}'::jsonb) || (coalesce(p_patch, '{}'::jsonb) - 'since_now'))
    || case when coalesce(p_patch, '{}'::jsonb) ? 'since_now' then jsonb_build_object('since', now()) else '{}'::jsonb end
  where id = p_shot
$$;
revoke execute on function studio_shot_produce_patch(uuid, jsonb) from public, anon, authenticated;
