-- Turnkey, step 3: the client fills their own checklist from their welcome link (lib/checklist.ts). Their answers go
-- on their record (a new version, under record.intake); when every required item is in, checklist_done_at is set,
-- which moves them to Build once photo rights and kickoff clear (0080). Their photo-rights statement is kept as the
-- photo-rights check's evidence; a person on the team still clears it.
-- Called only by the Genovus server (the welcome link has no sign-in), with the tenant the link resolved to.

alter table tenants add column if not exists checklist_link_sent_at timestamptz;

create or replace function save_intake(p_tenant uuid, p_intake jsonb, p_done boolean, p_attest text default null)
returns int language plpgsql security definer set search_path = public as $$
declare cur agent_records; v int; merged jsonb;
begin
  if jsonb_typeof(p_intake) <> 'object' then raise exception 'intake must be an object'; end if;
  select * into cur from agent_records where tenant_id = p_tenant and is_current for update;
  merged := coalesce(cur.data, '{}'::jsonb) || jsonb_build_object('intake', coalesce(cur.data->'intake', '{}'::jsonb) || p_intake);
  if cur.id is not null and merged = cur.data then return cur.version; end if;
  v := coalesce(cur.version, 0) + 1;
  update agent_records set is_current = false where tenant_id = p_tenant and is_current;
  insert into agent_records (tenant_id, version, data, is_current, note) values (p_tenant, v, merged, true, 'From the client checklist');
  if p_attest is not null then
    update gates set evidence = left(p_attest, 500) where tenant_id = p_tenant and kind = 'photo_rights' and status not in ('cleared', 'waived');
  end if;
  if p_done then update tenants set checklist_done_at = coalesce(checklist_done_at, now()) where id = p_tenant; end if;
  perform log_auto(p_tenant, 'checklist.save', 'client checklist', null, jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p_intake) k), 'done', p_done));
  return v;
end $$;

revoke all on function save_intake(uuid, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function save_intake(uuid, jsonb, boolean, text) to service_role;
