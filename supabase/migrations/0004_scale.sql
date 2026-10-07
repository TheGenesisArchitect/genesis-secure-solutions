-- Scale foundations: indexes, set-based access checks, staff roles enforced in the write functions,
-- account leads, network roles, an email outbox fed by database events, and sign-in throttling.

-- ---------- indexes ----------
create index if not exists approvals_tenant on approvals (tenant_id, status);
create index if not exists care_requests_tenant on care_requests (tenant_id, status);
create index if not exists content_items_tenant on content_items (tenant_id, scheduled_for);
create index if not exists invoices_tenant on invoices (tenant_id);
create index if not exists lifecycle_events_tenant on lifecycle_events (tenant_id, at desc);
create index if not exists audit_events_tenant on audit_events (tenant_id, id desc);
create index if not exists memberships_user on memberships (user_id);
create index if not exists network_members_user on network_members (user_id);
create index if not exists network_tenants_tenant on network_tenants (tenant_id);
create index if not exists inquiries_status on inquiries (status, created_at desc);

-- ---------- set-based access checks (evaluated once per query, not once per row) ----------
create function my_tenant_ids() returns setof uuid language sql stable security definer set search_path = public as
$$ select tenant_id from memberships where user_id = (select auth.uid()) $$;
create function my_owned_tenant_ids() returns setof uuid language sql stable security definer set search_path = public as
$$ select tenant_id from memberships where user_id = (select auth.uid()) and role = 'owner' $$;
grant execute on function my_tenant_ids(), my_owned_tenant_ids() to authenticated;

do $$ declare t text; begin
  foreach t in array array['agent_records','lifecycle_events','gates','approvals','care_requests','content_items','kpi_snapshots'] loop
    execute format('drop policy r on %I', t);
    execute format('create policy r on %I for select to authenticated using ((select is_staff()) or tenant_id in (select my_tenant_ids()))', t);
  end loop;
end $$;
drop policy r on tenants;
create policy r on tenants for select to authenticated using ((select is_staff()) or id in (select my_tenant_ids()));
drop policy r on assets;
create policy r on assets for select to authenticated using ((select is_staff()) or (audience <> 'internal' and tenant_id in (select my_tenant_ids())));
drop policy r on invoices;
create policy r on invoices for select to authenticated using ((select is_staff()) or tenant_id in (select my_owned_tenant_ids()));
drop policy r on audit_events;
create policy r on audit_events for select to authenticated using ((select is_staff()) or tenant_id in (select my_owned_tenant_ids()));
drop policy r on memberships;
create policy r on memberships for select to authenticated using ((select is_staff()) or user_id = (select auth.uid()) or tenant_id in (select my_owned_tenant_ids()));
drop policy r on inquiries;
create policy r on inquiries for select to authenticated using ((select is_staff()));

-- ---------- roles ----------
alter table tenants add column account_lead uuid references auth.users on delete set null;
alter table network_members add column role text not null default 'viewer' check (role in ('viewer','compliance'));

create function has_role(variadic roles text[]) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from staff where user_id = (select auth.uid()) and role = any(roles)) $$;
grant execute on function has_role(text[]) to authenticated;

-- Re-declare the staff write paths with role checks (bodies otherwise unchanged from 0002).
create or replace function move_stage(p_tenant uuid, p_to lifecycle_stage, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare cur lifecycle_stage;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can move a stage'; end if;
  select stage into cur from tenants where id = p_tenant for update;
  if cur is null then raise exception 'no such client'; end if;
  if cur = p_to then return; end if;
  update tenants set stage = p_to, stage_since = now() where id = p_tenant;
  insert into lifecycle_events (tenant_id, from_stage, to_stage, note, actor) values (p_tenant, cur, p_to, left(p_note, 500), auth.uid());
  perform log_event(p_tenant, 'stage.move', 'tenant', jsonb_build_object('stage', cur), jsonb_build_object('stage', p_to, 'note', p_note));
end $$;

create or replace function set_gate(p_tenant uuid, p_kind text, p_status text, p_evidence text default null)
returns void language plpgsql security definer set search_path = public as $$
declare old jsonb;
begin
  if not has_role('admin','account_lead','reviewer') then raise exception 'only an admin, account lead or reviewer can change a gate'; end if;
  select to_jsonb(g) into old from gates g where tenant_id = p_tenant and kind = p_kind;
  insert into gates (tenant_id, kind, status, evidence, cleared_by, cleared_at)
  values (p_tenant, p_kind, p_status, left(p_evidence, 1000),
          case when p_status in ('cleared','waived') then auth.uid() end, case when p_status in ('cleared','waived') then now() end)
  on conflict (tenant_id, kind) do update set status = excluded.status, evidence = coalesce(excluded.evidence, gates.evidence),
    cleared_by = excluded.cleared_by, cleared_at = excluded.cleared_at;
  perform log_event(p_tenant, 'gate.set', p_kind, old, jsonb_build_object('status', p_status, 'evidence', p_evidence));
end $$;

-- Team approvals: anyone on staff for the queued lane; the required lane needs a reviewer or admin.
create or replace function decide_approval(p_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a approvals;
begin
  if p_decision not in ('approved','changes_requested') then raise exception 'bad decision'; end if;
  select * into a from approvals where id = p_id for update;
  if a.id is null then raise exception 'not found'; end if;
  if a.approver = 'client' and not is_owner(a.tenant_id) then raise exception 'only the agency owner can decide this'; end if;
  if a.approver = 'team' and not is_staff() then raise exception 'staff only'; end if;
  if a.approver = 'team' and a.lane = 'required' and not has_role('admin','reviewer') then raise exception 'a required approval needs a reviewer'; end if;
  if a.status <> 'pending' then raise exception 'already decided'; end if;
  if p_decision = 'changes_requested' and coalesce(trim(p_note), '') = '' then raise exception 'say what should change'; end if;
  update approvals set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = left(p_note, 2000) where id = p_id;
  perform log_event(a.tenant_id, 'approval.' || p_decision, a.title, jsonb_build_object('status', a.status), jsonb_build_object('status', p_decision, 'note', p_note));
end $$;

create or replace function save_agent_record(p_tenant uuid, p_data jsonb, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v int; prev jsonb;
begin
  if not has_role('admin','account_lead','operator') then raise exception 'not allowed to edit records'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'record must be an object'; end if;
  select data into prev from agent_records where tenant_id = p_tenant and is_current;
  if prev = p_data then return (select version from agent_records where tenant_id = p_tenant and is_current); end if;
  select coalesce(max(version), 0) + 1 into v from agent_records where tenant_id = p_tenant;
  update agent_records set is_current = false where tenant_id = p_tenant and is_current;
  insert into agent_records (tenant_id, version, data, is_current, note, created_by) values (p_tenant, v, p_data, true, left(p_note, 500), auth.uid());
  perform log_event(p_tenant, 'record.save', 'v' || v, prev, p_data);
  return v;
end $$;

create or replace function convert_inquiry(p_id uuid, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare i inquiries; tid uuid;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can convert an inquiry'; end if;
  select * into i from inquiries where id = p_id for update;
  if i.id is null then raise exception 'not found'; end if;
  if i.kind <> 'agency' then raise exception 'carrier inquiries become a network, not a client'; end if;
  if i.tenant_id is not null then return i.tenant_id; end if;
  insert into tenants (slug, name, stage, account_lead) values (p_slug, i.org, 'consult', auth.uid()) returning id into tid;
  insert into lifecycle_events (tenant_id, from_stage, to_stage, note, actor) values (tid, 'attract', 'consult', 'From website inquiry', auth.uid());
  insert into agent_records (tenant_id, version, data, is_current, note, created_by)
  values (tid, 1, jsonb_build_object('agencyName', i.org, 'contactName', i.name, 'email', i.email, 'phone', i.phone) || coalesce(i.details, '{}'),
          true, 'Draft from website inquiry', auth.uid());
  insert into gates (tenant_id, kind) select tid, k from unnest(array['photo_rights','carrier_approval','carrier_rules','meta_access','domain','privacy_notice','kickoff']) k;
  update inquiries set status = 'converted', tenant_id = tid where id = p_id;
  perform log_event(tid, 'inquiry.convert', i.org, null, jsonb_build_object('slug', p_slug, 'inquiry', p_id));
  return tid;
end $$;

create function set_account_lead(p_tenant uuid, p_lead uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('admin','account_lead') then raise exception 'not allowed'; end if;
  if p_lead is not null and not exists (select 1 from staff where user_id = p_lead) then raise exception 'the lead must be on staff'; end if;
  update tenants set account_lead = p_lead where id = p_tenant;
  perform log_event(p_tenant, 'tenant.lead', 'account lead', null, jsonb_build_object('lead', p_lead));
end $$;
grant execute on function set_account_lead(uuid, uuid) to authenticated;

-- ---------- outbox: every platform email, written by the event that causes it ----------
create table outbox (
  id bigint generated always as identity primary key,
  tenant_id uuid references tenants on delete cascade,
  to_email text not null,
  template text not null,
  data jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  attempts int not null default 0,
  last_error text,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  send_after timestamptz not null default now(),
  sent_at timestamptz
);
create index outbox_due on outbox (status, send_after) where status in ('pending','sending');
alter table outbox enable row level security;
revoke all on outbox from anon, authenticated;
grant select on outbox to authenticated;
create policy r on outbox for select to authenticated using ((select is_staff()));

-- Team recipients: admins and account leads (the lead first when a client has one).
create function team_emails(p_tenant uuid) returns setof text language sql stable security definer set search_path = public as $$
  select u.email from staff s join auth.users u on u.id = s.user_id
  where u.email is not null and (s.role = 'admin' or (s.role = 'account_lead' and (p_tenant is null or s.user_id = (select account_lead from tenants where id = p_tenant))))
$$;

create function on_approval_pending() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'pending' or new.is_sample or new.approver <> 'client' then return new; end if;
  insert into outbox (tenant_id, to_email, template, data, dedupe_key)
  select new.tenant_id, u.email, 'approval_waiting', jsonb_build_object('title', new.title, 'approval', new.id, 'slug', t.slug, 'agency', t.name),
         'approval:' || new.id || ':' || u.id
  from memberships m join auth.users u on u.id = m.user_id join tenants t on t.id = m.tenant_id
  where m.tenant_id = new.tenant_id and m.role = 'owner' and u.email is not null
  on conflict (dedupe_key) do nothing;
  return new;
end $$;
create trigger approval_pending after insert on approvals for each row execute function on_approval_pending();

create function on_inquiry() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into outbox (to_email, template, data, dedupe_key)
  select e, 'team_inquiry', jsonb_build_object('org', new.org, 'name', new.name, 'kind', new.kind, 'inquiry', new.id), 'inquiry:' || new.id || ':' || e
  from team_emails(null) e on conflict (dedupe_key) do nothing;
  return new;
end $$;
create trigger inquiry_new after insert on inquiries for each row execute function on_inquiry();

create function on_care_request() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_sample then return new; end if;
  insert into outbox (tenant_id, to_email, template, data, dedupe_key)
  select new.tenant_id, e, 'team_care', jsonb_build_object('title', new.title, 'kind', new.kind, 'agency', (select name from tenants where id = new.tenant_id), 'slug', (select slug from tenants where id = new.tenant_id)),
         'care:' || new.id || ':' || e
  from team_emails(new.tenant_id) e on conflict (dedupe_key) do nothing;
  return new;
end $$;
create trigger care_new after insert on care_requests for each row execute function on_care_request();

revoke execute on function team_emails(uuid), on_approval_pending(), on_inquiry(), on_care_request() from public, anon, authenticated;

-- ---------- sign-in throttle (server-side only) ----------
create table signin_requests (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip_hash text,
  at timestamptz not null default now()
);
create index signin_requests_recent on signin_requests (email_hash, at desc);
alter table signin_requests enable row level security;
revoke all on signin_requests from anon, authenticated;

-- ---------- incremental audit verification ----------
create table audit_checkpoint (id int primary key default 1 check (id = 1), last_id bigint not null, last_hash text not null, checked_at timestamptz not null default now());
alter table audit_checkpoint enable row level security;
revoke all on audit_checkpoint from anon, authenticated;

-- Verifies from the last checkpoint (or from the start when full); returns the first broken id or null.
create or replace function verify_audit_chain(p_full boolean default false) returns bigint language plpgsql security definer set search_path = public as $$
declare r record; prev text := 'genesis'; h text; start_id bigint := 0; last_ok bigint;
begin
  if auth.uid() is not null and not is_staff() then raise exception 'staff only'; end if;
  if not p_full then select last_id, last_hash into start_id, prev from audit_checkpoint where id = 1; end if;
  start_id := coalesce(start_id, 0); prev := coalesce(prev, 'genesis'); last_ok := start_id;
  for r in select * from audit_events where id > start_id order by id loop
    h := encode(extensions.digest(prev || '|' || coalesce(r.tenant_id::text,'') || '|' || coalesce(r.actor::text,'') || '|' ||
      coalesce(r.actor_label,'') || '|' || r.action || '|' || coalesce(r.subject,'') || '|' || coalesce(r.before::text,'') || '|' ||
      coalesce(r.after::text,'') || '|' || to_char(r.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex');
    if r.prev_hash <> prev or r.hash <> h then return r.id; end if;
    prev := r.hash; last_ok := r.id;
  end loop;
  if last_ok > 0 then
    insert into audit_checkpoint (id, last_id, last_hash, checked_at) values (1, last_ok, prev, now())
    on conflict (id) do update set last_id = excluded.last_id, last_hash = excluded.last_hash, checked_at = now();
  end if;
  return null;
end $$;
drop function if exists verify_audit_chain();
grant execute on function verify_audit_chain(boolean) to authenticated;
