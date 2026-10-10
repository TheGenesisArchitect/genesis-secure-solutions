-- Identity lineage: every reference image records what it was made from (its basis). A front portrait's basis is
-- the approved casting sheet (if any); every other slot's basis is the approved front portrait. Approving a new
-- casting or front portrait unapproves everything made from the previous face, and an image made from an older
-- face can no longer be approved, so a shot can never mix two versions of the same person.

alter table studio_refs add column if not exists basis_id uuid references studio_refs on delete set null;

-- Backfill from the decision record: the front portrait approved when each image was generated.
update studio_refs r set basis_id = (
  select f.id from studio_decisions d
  join studio_refs f on f.asset_code = d.asset_ref and f.slot = 'FACE_FRONT' and f.character_id = r.character_id
  where d.decided_at <= r.created_at and d.asset_ref like '%\_FACE\_v%\_FRONT' escape '\'
  order by d.decided_at desc limit 1)
where r.character_id is not null and r.slot is not null and r.slot not in ('FACE_FRONT','CASTING') and r.basis_id is null;

update studio_refs r set basis_id = (
  select c.id from studio_decisions d
  join studio_refs c on c.asset_code = d.asset_ref and c.slot = 'CASTING' and c.character_id = r.character_id
  where d.decided_at <= r.created_at order by d.decided_at desc limit 1)
where r.character_id is not null and r.slot = 'FACE_FRONT' and r.basis_id is null;

create or replace function studio_approve_ref(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r studio_refs; v_front uuid; v_cast uuid; n int;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into r from studio_refs where id = p_id for update;
  if r.id is null or r.status <> 'ready' or r.slot is null then raise exception 'That image is not ready.'; end if;
  if r.character_id is not null then
    select id into v_cast from studio_refs where character_id = r.character_id and slot = 'CASTING' and approved;
    select id into v_front from studio_refs where character_id = r.character_id and slot = 'FACE_FRONT' and approved;
    -- Stale images can't be approved: a front portrait made before the current casting, or a view made from an
    -- older front portrait.
    if r.slot = 'FACE_FRONT' and v_cast is not null and r.basis_id is distinct from v_cast then
      raise exception 'This front portrait was made before the current casting sheet. Generate a new one from the casting.';
    end if;
    if r.slot not in ('FACE_FRONT','CASTING') and r.basis_id is distinct from v_front then
      raise exception 'This image was made from an older front portrait. Generate a new version from the current face.';
    end if;
  end if;
  update studio_refs set approved = (id = p_id), canonical = (id = p_id)
    where series_id = r.series_id and slot = r.slot and coalesce(character_id::text, 'ens') = coalesce(r.character_id::text, 'ens');
  -- A new face invalidates everything made from the previous one.
  if r.slot = 'CASTING' then
    update studio_refs set approved = false, canonical = false
      where character_id = r.character_id and slot = 'FACE_FRONT' and approved and basis_id is distinct from p_id;
    get diagnostics n = row_count;
    if n > 0 then
      update studio_refs set approved = false, canonical = false where character_id = r.character_id and slot not in ('FACE_FRONT','CASTING') and approved;
    end if;
  elsif r.slot = 'FACE_FRONT' then
    update studio_refs set approved = false, canonical = false
      where character_id = r.character_id and slot not in ('FACE_FRONT','CASTING') and approved and basis_id is distinct from p_id;
    -- Ensemble images made with the previous face are no longer valid either.
    update studio_refs set approved = false, canonical = false where character_id is null and ref_set = 'ensemble' and series_id = r.series_id and approved;
  end if;
  insert into studio_decisions (series_id, decision, value, asset_ref, version, reason, decided_by)
  values (r.series_id, 'Approved ' || coalesce(r.character, 'ensemble') || ' · ' || r.slot, r.slot, r.asset_code, 'v' || lpad(r.version::text, 2, '0'), nullif(trim(p_reason), ''), auth.uid());
  perform studio_log('studio.identity.approve', coalesce(r.asset_code, r.slot), null, jsonb_build_object('asset', r.asset_code));
end $$;
