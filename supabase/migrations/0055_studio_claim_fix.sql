-- Fix: a step claim must be stored even when the shot has no leases yet. jsonb_set doesn't create a missing parent
-- key, so on a fresh shot the claim silently wasn't written while the update still reported success, and two
-- advancers could both "win" the same step. The claim now builds the leases object explicitly.
create or replace function studio_claim_step(p_shot uuid, p_step text, p_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update studio_shots set produce = coalesce(produce, '{}'::jsonb)
      || jsonb_build_object('leases', coalesce(produce->'leases', '{}'::jsonb) || jsonb_build_object(p_step, now() + make_interval(secs => p_seconds)))
  where id = p_shot and (produce #>> array['leases', p_step] is null or (produce #>> array['leases', p_step])::timestamptz < now());
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke execute on function studio_claim_step(uuid, text, int) from public, anon, authenticated;
