-- Helix Knows: the copilot that knows the business better over time. What Helix has learned lives here, one short
-- line per item, by department. Nothing is remembered silently: Helix suggests ("Remember this?") and a person keeps
-- it with one tap, edits it, or retires it. Enterprise memories belong to the house account (tenant "genovus");
-- agencies use the same table later, scoped to their own tenant. Cash on hand (for runway) is entered by an admin.

create table if not exists helix_memory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  department text not null check (department in ('sales','pipeline','clients','finance','studio','operations','general')),
  kind text not null default 'fact' check (kind in ('fact','preference','outcome','goal')),
  text text not null check (length(text) between 3 and 400),
  source text not null default 'conversation' check (source in ('conversation','person','weekly')),
  status text not null default 'kept' check (status in ('proposed','kept','retired')),
  proposed_by uuid,
  decided_by uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  last_used_at timestamptz
);
create index if not exists helix_memory_tenant on helix_memory (tenant_id, status, created_at desc);
alter table helix_memory enable row level security;
-- Enterprise (house) memories: staff. Agency memories later: that agency's members too.
create policy r on helix_memory for select to authenticated using (is_staff() or is_member(tenant_id));

-- Keep something Helix suggested, or add one by hand. Staff only for now (Enterprise); audited.
create or replace function remember(p_tenant uuid, p_department text, p_kind text, p_text text, p_source text)
returns uuid language plpgsql security definer set search_path = public as $$
declare mid uuid; t text := left(trim(coalesce(p_text, '')), 400);
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  if length(t) < 3 then raise exception 'too short'; end if;
  -- The same line twice is one memory.
  select id into mid from helix_memory where tenant_id = p_tenant and status <> 'retired' and lower(text) = lower(t);
  if mid is not null then return mid; end if;
  insert into helix_memory (tenant_id, department, kind, text, source, status, proposed_by, decided_by, decided_at)
  values (p_tenant, coalesce(nullif(p_department, ''), 'general'), coalesce(nullif(p_kind, ''), 'fact'), t,
    coalesce(nullif(p_source, ''), 'conversation'), 'kept', auth.uid(), auth.uid(), now())
  returning id into mid;
  perform log_event(p_tenant, 'helix.memory.keep', left(t, 80), null, jsonb_build_object('department', p_department, 'source', p_source));
  return mid;
end $$;
revoke execute on function remember(uuid, text, text, text, text) from public, anon;
grant execute on function remember(uuid, text, text, text, text) to authenticated;

-- Edit, keep or retire one memory. Staff only; audited with the before and after.
create or replace function decide_memory(p_id uuid, p_status text, p_text text, p_department text)
returns void language plpgsql security definer set search_path = public as $$
declare m helix_memory;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  select * into m from helix_memory where id = p_id;
  if m.id is null then raise exception 'unknown memory'; end if;
  update helix_memory set
    status = coalesce(nullif(p_status, ''), status),
    text = coalesce(nullif(left(trim(coalesce(p_text, '')), 400), ''), text),
    department = coalesce(nullif(p_department, ''), department),
    decided_by = auth.uid(), decided_at = now()
  where id = p_id;
  perform log_event(m.tenant_id, 'helix.memory.' || coalesce(nullif(p_status, ''), 'edit'), left(m.text, 80),
    jsonb_build_object('text', m.text, 'status', m.status), jsonb_build_object('text', p_text, 'status', p_status));
end $$;
revoke execute on function decide_memory(uuid, text, text, text) from public, anon;
grant execute on function decide_memory(uuid, text, text, text) to authenticated;

-- Helix used these memories in an answer (server only): the least-used ones can be reviewed later.
create or replace function touch_memories(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update helix_memory set last_used_at = now() where id = any(p_ids);
$$;
revoke execute on function touch_memories(uuid[]) from public, anon, authenticated;
grant execute on function touch_memories(uuid[]) to service_role;

-- Cash on hand, for runway. Entered by an admin; read by admin and account lead (the people who see money).
create or replace function set_cash_on_hand(p_cents bigint)
returns void language plpgsql security definer set search_path = public as $$
declare before text;
begin
  if not has_role('admin') then raise exception 'admin only'; end if;
  if p_cents is null or p_cents < 0 then raise exception 'enter an amount'; end if;
  select value into before from app_settings where key = 'cash_on_hand_cents';
  insert into app_settings (key, value, updated_at) values ('cash_on_hand_cents', p_cents::text, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform log_event((select id from tenants where slug = 'genovus'), 'finance.cash_on_hand', null,
    case when before is null then null else jsonb_build_object('cents', before::bigint) end, jsonb_build_object('cents', p_cents));
end $$;
revoke execute on function set_cash_on_hand(bigint) from public, anon;
grant execute on function set_cash_on_hand(bigint) to authenticated;

create or replace function cash_on_hand()
returns table (cents bigint, updated_at timestamptz) language sql stable security definer set search_path = public as $$
  select value::bigint, updated_at from app_settings where key = 'cash_on_hand_cents' and has_role('admin', 'account_lead');
$$;
revoke execute on function cash_on_hand() from public, anon;
grant execute on function cash_on_hand() to authenticated;
