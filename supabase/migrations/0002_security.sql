-- Row-level security, read grants, and the only write paths (security-definer functions that audit).
-- Signed-in users may SELECT what RLS shows them and nothing more; every write is a function below.
-- The anon role gets nothing. The service role (server only) is used for seeding and public intake.

-- ---------- helpers ----------
create function is_staff() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from staff where user_id = auth.uid()) $$;
create function staff_role() returns text language sql stable security definer set search_path = public as
$$ select role from staff where user_id = auth.uid() $$;
create function is_member(t uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from memberships where tenant_id = t and user_id = auth.uid()) $$;
create function is_owner(t uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from memberships where tenant_id = t and user_id = auth.uid() and role = 'owner') $$;
create function my_network_ids() returns setof uuid language sql stable security definer set search_path = public as
$$ select network_id from network_members where user_id = auth.uid() $$;

create function log_event(p_tenant uuid, p_action text, p_subject text, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into audit_events (tenant_id, actor, actor_label, action, subject, before, after, prev_hash, hash)
  values (p_tenant, auth.uid(),
    coalesce((select display_name from staff where user_id = auth.uid()), (select email from auth.users where id = auth.uid()), 'system'),
    p_action, p_subject, p_before, p_after, '', '');
end $$;

-- ---------- RLS ----------
do $$ declare t text; begin
  foreach t in array array['tenants','staff','memberships','networks','network_members','network_tenants','agent_records',
    'lifecycle_events','gates','assets','approvals','care_requests','content_items','kpi_snapshots','invoices','inquiries','audit_events']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;

create policy r on tenants for select to authenticated using (is_staff() or is_member(id));
create policy r on staff for select to authenticated using (is_staff() or user_id = auth.uid());
create policy r on memberships for select to authenticated using (is_staff() or user_id = auth.uid() or is_owner(tenant_id));
create policy r on networks for select to authenticated using (is_staff() or id in (select my_network_ids()));
create policy r on network_members for select to authenticated using (is_staff() or user_id = auth.uid());
create policy r on network_tenants for select to authenticated using (is_staff());
create policy r on agent_records for select to authenticated using (is_staff() or is_member(tenant_id));
create policy r on lifecycle_events for select to authenticated using (is_staff() or is_member(tenant_id));
create policy r on gates for select to authenticated using (is_staff() or is_member(tenant_id));
create policy r on assets for select to authenticated using (is_staff() or (is_member(tenant_id) and audience <> 'internal'));
create policy r on approvals for select to authenticated using (is_staff() or is_member(tenant_id));
create policy r on care_requests for select to authenticated using (is_staff() or is_member(tenant_id));
create policy r on content_items for select to authenticated using (is_staff() or is_member(tenant_id));
create policy r on kpi_snapshots for select to authenticated using (is_staff() or is_member(tenant_id));
create policy r on invoices for select to authenticated using (is_staff() or is_owner(tenant_id));
create policy r on inquiries for select to authenticated using (is_staff());
create policy r on audit_events for select to authenticated using (is_staff() or (tenant_id is not null and is_owner(tenant_id)));

-- ---------- write paths ----------
create function move_stage(p_tenant uuid, p_to lifecycle_stage, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare cur lifecycle_stage;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select stage into cur from tenants where id = p_tenant for update;
  if cur is null then raise exception 'no such client'; end if;
  if cur = p_to then return; end if;
  update tenants set stage = p_to, stage_since = now() where id = p_tenant;
  insert into lifecycle_events (tenant_id, from_stage, to_stage, note, actor) values (p_tenant, cur, p_to, left(p_note, 500), auth.uid());
  perform log_event(p_tenant, 'stage.move', 'tenant', jsonb_build_object('stage', cur), jsonb_build_object('stage', p_to, 'note', p_note));
end $$;

create function set_gate(p_tenant uuid, p_kind text, p_status text, p_evidence text default null)
returns void language plpgsql security definer set search_path = public as $$
declare old jsonb;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select to_jsonb(g) into old from gates g where tenant_id = p_tenant and kind = p_kind;
  insert into gates (tenant_id, kind, status, evidence, cleared_by, cleared_at)
  values (p_tenant, p_kind, p_status, left(p_evidence, 1000),
          case when p_status in ('cleared','waived') then auth.uid() end, case when p_status in ('cleared','waived') then now() end)
  on conflict (tenant_id, kind) do update set status = excluded.status, evidence = coalesce(excluded.evidence, gates.evidence),
    cleared_by = excluded.cleared_by, cleared_at = excluded.cleared_at;
  perform log_event(p_tenant, 'gate.set', p_kind, old, jsonb_build_object('status', p_status, 'evidence', p_evidence));
end $$;

-- Client approvals are decided only by the tenant owner; team approvals only by staff.
create function decide_approval(p_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a approvals;
begin
  if p_decision not in ('approved','changes_requested') then raise exception 'bad decision'; end if;
  select * into a from approvals where id = p_id for update;
  if a.id is null then raise exception 'not found'; end if;
  if a.approver = 'client' and not is_owner(a.tenant_id) then raise exception 'only the agency owner can decide this'; end if;
  if a.approver = 'team' and not is_staff() then raise exception 'staff only'; end if;
  if a.status <> 'pending' then raise exception 'already decided'; end if;
  if p_decision = 'changes_requested' and coalesce(trim(p_note), '') = '' then raise exception 'say what should change'; end if;
  update approvals set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = left(p_note, 2000) where id = p_id;
  perform log_event(a.tenant_id, 'approval.' || p_decision, a.title, jsonb_build_object('status', a.status), jsonb_build_object('status', p_decision, 'note', p_note));
end $$;

create function create_care_request(p_tenant uuid, p_kind text, p_title text, p_detail text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not (is_staff() or is_member(p_tenant)) then raise exception 'not allowed'; end if;
  insert into care_requests (tenant_id, kind, title, detail, created_by) values (p_tenant, p_kind, trim(p_title), nullif(trim(p_detail), ''), auth.uid())
  returning id into nid;
  perform log_event(p_tenant, 'care.request', p_title, null, jsonb_build_object('kind', p_kind));
  return nid;
end $$;

create function set_care_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare c care_requests;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into c from care_requests where id = p_id for update;
  if c.id is null then raise exception 'not found'; end if;
  update care_requests set status = p_status, updated_at = now() where id = p_id;
  perform log_event(c.tenant_id, 'care.status', c.title, jsonb_build_object('status', c.status), jsonb_build_object('status', p_status));
end $$;

create function save_agent_record(p_tenant uuid, p_data jsonb, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v int; prev jsonb;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'record must be an object'; end if;
  select data into prev from agent_records where tenant_id = p_tenant and is_current;
  if prev = p_data then return (select version from agent_records where tenant_id = p_tenant and is_current); end if;
  select coalesce(max(version), 0) + 1 into v from agent_records where tenant_id = p_tenant;
  update agent_records set is_current = false where tenant_id = p_tenant and is_current;
  insert into agent_records (tenant_id, version, data, is_current, note, created_by) values (p_tenant, v, p_data, true, left(p_note, 500), auth.uid());
  perform log_event(p_tenant, 'record.save', 'v' || v, prev, p_data);
  return v;
end $$;

create function set_inquiry_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare i inquiries;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into i from inquiries where id = p_id for update;
  if i.id is null then raise exception 'not found'; end if;
  update inquiries set status = p_status where id = p_id;
  perform log_event(null, 'inquiry.status', i.org, jsonb_build_object('status', i.status), jsonb_build_object('status', p_status));
end $$;

-- An agency inquiry becomes a client in Consult with a first record draft built from the form.
create function convert_inquiry(p_id uuid, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare i inquiries; tid uuid;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into i from inquiries where id = p_id for update;
  if i.id is null then raise exception 'not found'; end if;
  if i.kind <> 'agency' then raise exception 'carrier inquiries become a network, not a client'; end if;
  if i.tenant_id is not null then return i.tenant_id; end if;
  insert into tenants (slug, name, stage) values (p_slug, i.org, 'consult') returning id into tid;
  insert into lifecycle_events (tenant_id, from_stage, to_stage, note, actor) values (tid, 'attract', 'consult', 'From website inquiry', auth.uid());
  insert into agent_records (tenant_id, version, data, is_current, note, created_by)
  values (tid, 1, jsonb_build_object('agencyName', i.org, 'contactName', i.name, 'email', i.email, 'phone', i.phone) || coalesce(i.details, '{}'),
          true, 'Draft from website inquiry', auth.uid());
  insert into gates (tenant_id, kind) select tid, k from unnest(array['photo_rights','carrier_approval','carrier_rules','meta_access','domain','privacy_notice','kickoff']) k;
  update inquiries set status = 'converted', tenant_id = tid where id = p_id;
  perform log_event(tid, 'inquiry.convert', i.org, null, jsonb_build_object('slug', p_slug, 'inquiry', p_id));
  return tid;
end $$;

-- Network members see aggregates for their network's agencies, never leads or records.
create function network_portfolio()
returns table (network text, tenant_name text, slug text, stage lifecycle_stage, stage_since timestamptz, plan text,
  gates_cleared int, gates_total int, approvals_pending int, approval_hours numeric, posts_month int, leads_month int, is_sample boolean)
language sql stable security definer set search_path = public as $$
  select n.name, t.name, t.slug, t.stage, t.stage_since, t.plan,
    (select count(*) from gates g where g.tenant_id = t.id and g.status in ('cleared','waived'))::int,
    (select count(*) from gates g where g.tenant_id = t.id)::int,
    (select count(*) from approvals a where a.tenant_id = t.id and a.status = 'pending')::int,
    (select round(avg(extract(epoch from a.decided_at - a.requested_at) / 3600)::numeric, 1) from approvals a where a.tenant_id = t.id and a.decided_at is not null),
    (select count(*) from content_items c where c.tenant_id = t.id and c.status = 'published' and c.scheduled_for >= date_trunc('month', now()))::int,
    (select coalesce((k.metrics->>'leads')::int, 0) from kpi_snapshots k where k.tenant_id = t.id order by k.period desc limit 1),
    t.is_sample
  from networks n join network_tenants nt on nt.network_id = n.id join tenants t on t.id = nt.tenant_id
  where n.id in (select my_network_ids()) or is_staff()
  order by n.name, t.name
$$;

-- Recompute the chain; returns the first broken id, or null when intact.
create function verify_audit_chain() returns bigint language plpgsql stable security definer set search_path = public as $$
declare r record; prev text := 'genesis'; h text;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  for r in select * from audit_events order by id loop
    h := encode(extensions.digest(prev || '|' || coalesce(r.tenant_id::text,'') || '|' || coalesce(r.actor::text,'') || '|' ||
      coalesce(r.actor_label,'') || '|' || r.action || '|' || coalesce(r.subject,'') || '|' || coalesce(r.before::text,'') || '|' ||
      coalesce(r.after::text,'') || '|' || to_char(r.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex');
    if r.prev_hash <> prev or r.hash <> h then return r.id; end if;
    prev := r.hash;
  end loop;
  return null;
end $$;

-- Functions: nobody by default; signed-in users get the entry points (each checks its own permission).
revoke execute on all functions in schema public from public, anon;
grant execute on function is_staff(), staff_role(), is_member(uuid), is_owner(uuid), my_network_ids(),
  move_stage(uuid, lifecycle_stage, text), set_gate(uuid, text, text, text), decide_approval(uuid, text, text),
  create_care_request(uuid, text, text, text), set_care_status(uuid, text), save_agent_record(uuid, jsonb, text),
  set_inquiry_status(uuid, text), convert_inquiry(uuid, text), network_portfolio(), verify_audit_chain() to authenticated;
revoke execute on function log_event(uuid, text, text, jsonb, jsonb) from authenticated;
