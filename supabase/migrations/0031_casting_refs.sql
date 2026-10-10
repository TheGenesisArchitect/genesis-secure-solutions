-- Casting references: an uploaded casting sheet for a character (the face the team chose). Once approved, the
-- front portrait is generated from it, so every derived view starts from the cast face rather than text alone.
create or replace function studio_add_casting(p_character uuid, p_blob text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c studio_characters; v_ver int; nid uuid;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  if p_blob !~ '^studio/casting/[A-Za-z0-9._/-]+$' then raise exception 'invalid upload'; end if;
  select * into c from studio_characters where id = p_character;
  if c.id is null then raise exception 'character not found'; end if;
  select coalesce(max(version), 0) + 1 into v_ver from studio_refs where character_id = p_character and slot = 'CASTING';
  insert into studio_refs (series_id, character, prompt, model, status, blob_path, cost_cents, created_by, character_id, ref_set, slot, version, asset_code)
  values (c.series_id, c.name, 'Uploaded casting reference sheet', 'upload', 'ready', p_blob, 0, auth.uid(), c.id, 'portrait', 'CASTING', v_ver, format('%s_CASTING_v%s_SHEET', c.code, lpad(v_ver::text, 2, '0')))
  returning id into nid;
  perform studio_log('studio.casting.upload', c.name, null, jsonb_build_object('version', v_ver));
  return nid;
end $$;
grant execute on function studio_add_casting(uuid, text) to authenticated;
