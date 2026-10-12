-- Faster production runs: each step of a shot has its own claim (so a shot's keyframe and line reads run at the
-- same time), and Runway's own result links are kept so the next step can hand them straight back to Runway
-- (no re-upload of the image or the audio).
alter table studio_art add column if not exists source_url text, add column if not exists source_at timestamptz;
alter table studio_voice_clips add column if not exists source_url text, add column if not exists source_at timestamptz;

create or replace function studio_claim_step(p_shot uuid, p_step text, p_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update studio_shots set produce = jsonb_set(coalesce(produce, '{}'::jsonb), array['leases', p_step], to_jsonb(now() + make_interval(secs => p_seconds)), true)
  where id = p_shot and (produce #>> array['leases', p_step] is null or (produce #>> array['leases', p_step])::timestamptz < now());
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke execute on function studio_claim_step(uuid, text, int) from public, anon, authenticated;

create or replace function studio_release_step(p_shot uuid, p_step text)
returns void language sql security definer set search_path = public as $$
  update studio_shots set produce = produce #- array['leases', p_step] where id = p_shot
$$;
revoke execute on function studio_release_step(uuid, text) from public, anon, authenticated;

-- A shot's production state merges in place (never a whole-record write from a stale copy).
create or replace function studio_shot_produce_patch(p_shot uuid, p_patch jsonb)
returns void language sql security definer set search_path = public as $$
  update studio_shots set produce = coalesce(produce, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb) where id = p_shot
$$;
revoke execute on function studio_shot_produce_patch(uuid, jsonb) from public, anon, authenticated;
