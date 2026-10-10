-- One shell, scaled by toggles: Genovus staff can turn on any module for one agency, indefinitely or as a trial
-- with an end date, on top of what its program includes. Access = the program includes it OR an active grant.
-- Grants and revocations are audited; an expired trial simply stops counting (no job needed).

create table if not exists module_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  module_key text not null check (module_key ~ '^[a-z0-9-]{2,40}$'),
  until timestamptz,
  reason text check (reason is null or length(reason) <= 200),
  granted_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists module_grants_tenant on module_grants (tenant_id) where revoked_at is null;
alter table module_grants enable row level security;
create policy r on module_grants for select to authenticated using (is_staff() or is_member(tenant_id));

-- Grant modules to an agency (staff): replaces any active grant for the same modules.
create or replace function grant_modules(p_tenant uuid, p_keys text[], p_until timestamptz, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare k text; n int := 0;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  if p_until is not null and p_until <= now() then raise exception 'Pick an end date in the future.'; end if;
  foreach k in array coalesce(p_keys, '{}') loop
    update module_grants set revoked_at = now() where tenant_id = p_tenant and module_key = k and revoked_at is null;
    insert into module_grants (tenant_id, module_key, until, reason, granted_by) values (p_tenant, k, p_until, nullif(left(trim(coalesce(p_reason, '')), 200), ''), auth.uid());
    n := n + 1;
  end loop;
  perform log_event(p_tenant, 'modules.grant', array_to_string(p_keys, ', '), null, jsonb_build_object('until', p_until, 'reason', p_reason));
  return n;
end $$;
revoke execute on function grant_modules(uuid, text[], timestamptz, text) from public, anon;
grant execute on function grant_modules(uuid, text[], timestamptz, text) to authenticated;

create or replace function revoke_modules(p_tenant uuid, p_keys text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  update module_grants set revoked_at = now() where tenant_id = p_tenant and module_key = any(p_keys) and revoked_at is null;
  perform log_event(p_tenant, 'modules.revoke', array_to_string(p_keys, ', '), null, null);
end $$;
revoke execute on function revoke_modules(uuid, text[]) from public, anon;
grant execute on function revoke_modules(uuid, text[]) to authenticated;
