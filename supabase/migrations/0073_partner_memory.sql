-- Helix Knows the partners the agency has worked. Partners are stored as Google place IDs (Google's terms); a
-- business's name becomes the agency's own record only when someone in the agency confirms it: logging a call or a
-- visit on the card that shows the name, or typing it when booking. That name is theirs, kept with who confirmed it
-- and when. Helix also keeps a log of its own lookups (what was asked, which partner it matched, when; never
-- Google's data), so "the brokers I looked up yesterday" can be answered.

alter table partner_targets add column if not exists known_name text check (known_name is null or length(known_name) between 1 and 120);
alter table partner_targets add column if not exists known_name_at timestamptz;
alter table partner_targets add column if not exists known_name_by uuid references auth.users on delete set null;

-- The agency confirms (or corrects) a partner's business name for its records. Members and staff.
create or replace function set_partner_name(p_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare t partner_targets; n text := nullif(left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 120), '');
begin
  select * into t from partner_targets where id = p_id for update;
  if t.id is null or not (is_staff() or is_member(t.tenant_id)) then raise exception 'not allowed'; end if;
  if n is not distinct from t.known_name then return; end if;
  update partner_targets set known_name = n, known_name_at = case when n is null then null else now() end, known_name_by = case when n is null then null else auth.uid() end, updated_at = now() where id = p_id;
  perform log_event(t.tenant_id, 'partner.name', t.category, null, null);
end $$;
revoke execute on function set_partner_name(uuid, text) from public, anon;
grant execute on function set_partner_name(uuid, text) to authenticated;

create table if not exists helix_lookups (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  tool text not null check (tool ~ '^[a-z_]{2,30}$'),
  -- What was asked, in the person's (or Helix's) words, e.g. "SPL Realty" or "sort: best"; never Google's data.
  query text check (query is null or length(query) <= 200),
  partner_id uuid references partner_targets on delete set null,
  at timestamptz not null default now()
);
create index if not exists helix_lookups_tenant on helix_lookups (tenant_id, at desc);
alter table helix_lookups enable row level security;
create policy r on helix_lookups for select to authenticated using (user_id = auth.uid() or is_staff() or is_owner(tenant_id));
create policy w on helix_lookups for insert to authenticated with check (user_id = auth.uid() and (is_staff() or is_member(tenant_id)));
