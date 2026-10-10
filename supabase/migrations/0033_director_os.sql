-- Director OS, slice 1: every generated shot carries a Shot Contract (story function, states, composition,
-- continuity, a timed performance, negatives, sound) and a render tier; the Frame Forge makes start/end frame
-- candidates with Nano Banana Pro, a person chooses them, and Veo animates the chosen frames.

alter table studio_shots
  add column if not exists contract jsonb not null default '{}',
  add column if not exists tier text not null default 'production' check (tier in ('draft','production','hero'));

-- Frame candidates live with the thumbnails (same storage, budget and status), tied to a shot and a role.
alter table studio_art drop constraint if exists studio_art_kind_check;
alter table studio_art add constraint studio_art_kind_check check (kind in ('thumbnail','frame'));
alter table studio_art
  add column if not exists shot_id uuid references studio_shots on delete cascade,
  add column if not exists role text check (role is null or role in ('start','end'));
create index if not exists studio_art_shot on studio_art (shot_id, role, created_at desc) where shot_id is not null;

-- Reserve one frame candidate against the monthly Studio budget (same rules as every other generation).
create or replace function studio_reserve_frame(p_shot uuid, p_role text, p_prompt text, p_model text, p_cents int, p_refs uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare b studio_budget; spent int; ep uuid; nid uuid;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  if p_role not in ('start','end') then raise exception 'A frame is a start or an end frame.'; end if;
  if length(trim(coalesce(p_prompt, ''))) < 10 then raise exception 'The prompt is too short.'; end if;
  select episode_id into ep from studio_shots where id = p_shot;
  if ep is null then raise exception 'shot not found'; end if;
  select * into b from studio_budget where id;
  perform pg_advisory_xact_lock(hashtext('studio_budget'));
  spent := studio_spent_cents();
  if spent + p_cents > b.monthly_cap_cents then
    raise exception 'Monthly Studio budget reached ($% of $%). Raise the cap to keep generating.', round(spent / 100.0, 2), round(b.monthly_cap_cents / 100.0, 2);
  end if;
  insert into studio_art (episode_id, kind, shot_id, role, prompt, model, ref_ids, cost_cents, created_by)
  values (ep, 'frame', p_shot, p_role, trim(p_prompt), p_model, coalesce(p_refs, '{}'), p_cents, auth.uid()) returning id into nid;
  return nid;
end $$;
revoke execute on function studio_reserve_frame(uuid, text, text, text, int, uuid[]) from public, anon;
grant execute on function studio_reserve_frame(uuid, text, text, text, int, uuid[]) to authenticated;

-- Choose a frame: one chosen start and one chosen end per shot.
create or replace function studio_choose_frame(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a studio_art;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into a from studio_art where id = p_id and kind = 'frame';
  if a.id is null then raise exception 'frame not found'; end if;
  if a.status <> 'ready' then raise exception 'That frame is not ready.'; end if;
  update studio_art set chosen = false where shot_id = a.shot_id and role = a.role and kind = 'frame' and id <> a.id;
  update studio_art set chosen = not a.chosen, updated_at = now() where id = a.id;
end $$;
revoke execute on function studio_choose_frame(uuid) from public, anon;
grant execute on function studio_choose_frame(uuid) to authenticated;
