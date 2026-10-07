-- Welcome links for clients onboarded from the database (no code deploy per client). Only a hash of each
-- token is stored; the link is shown once to the person who issues it. Staff can read them; nobody writes
-- them from the browser (the server issues and revokes them after a role check).
create table client_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  token_hash text not null unique,
  key16 text not null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index client_links_tenant on client_links (tenant_id, created_at desc);
alter table client_links enable row level security;
revoke all on client_links from anon, authenticated;
grant select on client_links to authenticated;
create policy r on client_links for select to authenticated using ((select is_staff()));

-- The agency's Genovus contact, for its own dashboard (members can't read the staff list).
create function my_account_lead(p_tenant uuid) returns table (name text, email text) language sql stable security definer set search_path = public as $$
  select s.display_name, u.email from tenants t join staff s on s.user_id = t.account_lead join auth.users u on u.id = s.user_id
  where t.id = p_tenant and (is_staff() or p_tenant in (select my_tenant_ids()))
$$;
revoke execute on function my_account_lead(uuid) from public, anon;
grant execute on function my_account_lead(uuid) to authenticated;
