-- Guards: care starts only after the launch checklist is cleared (care is the post-launch stage), a payment
-- is recorded once, and an upgrade supersedes any unpaid setup invoices so nobody is billed twice.

create or replace function start_care(p_tenant uuid, p_care text, p_rate_cents int, p_start date, p_first_cents int, p_first_end date)
returns uuid language plpgsql security definer set search_path = public as $$
declare t tenants; nid uuid; open_gates int;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can start care'; end if;
  select * into t from tenants where id = p_tenant for update;
  if t.id is null then raise exception 'no such client'; end if;
  if t.care_active then raise exception 'care is already running for this client'; end if;
  if t.stage <> 'care' then
    select count(*) into open_gates from gates where tenant_id = p_tenant and status not in ('cleared','waived');
    if open_gates > 0 then raise exception 'finish the launch checklist first: % item(s) still open', open_gates; end if;
    update tenants set stage = 'care', stage_since = now() where id = p_tenant;
    insert into lifecycle_events (tenant_id, from_stage, to_stage, note, actor) values (p_tenant, t.stage, 'care', 'Launched; monthly care started', auth.uid());
    perform log_event(p_tenant, 'stage.move', 'tenant', jsonb_build_object('stage', t.stage), jsonb_build_object('stage', 'care', 'note', 'monthly care started'));
  end if;
  update tenants set care_active = true, care_plan = p_care, care_rate_cents = p_rate_cents, care_started_on = p_start, care_ended_on = null where id = p_tenant;
  insert into invoices (tenant_id, kind, amount_cents, status, note, due_date, lines, period_start, period_end)
  values (p_tenant, 'care', p_first_cents, 'draft', p_care || ', first month (prorated)', p_start + 7,
          jsonb_build_array(jsonb_build_object('label', p_care || ' ' || to_char(p_start, 'Mon DD') || ' to ' || to_char(p_first_end, 'Mon DD'), 'cents', p_first_cents)),
          p_start, p_first_end)
  on conflict do nothing returning id into nid;
  perform log_event(p_tenant, 'care.start', p_care, null, jsonb_build_object('rate_cents', p_rate_cents, 'start', p_start, 'first_cents', p_first_cents));
  return nid;
end $$;

create or replace function mark_invoice_paid(p_id uuid, p_via text default 'Mercury', p_paid_on date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare i invoices; t tenants; new_rate int; s record;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can record a payment'; end if;
  select * into i from invoices where id = p_id for update;
  if i.id is null then raise exception 'not found'; end if;
  if i.status in ('paid','void') then raise exception 'this invoice is already %', i.status; end if;
  update invoices set status = 'paid', paid_via = left(p_via, 60), paid_at = p_paid_on::timestamptz + interval '12 hours' where id = p_id;
  perform log_event(i.tenant_id, 'invoice.paid', coalesce(i.number, i.kind), jsonb_build_object('status', i.status), jsonb_build_object('status', 'paid', 'via', p_via, 'on', p_paid_on));
  if i.kind = 'upgrade' and i.upgrade_to is not null then
    select * into t from tenants where id = i.tenant_id for update;
    new_rate := case i.upgrade_to when 'growth' then 39900 when 'premium' then 79900 else 24900 end;
    update tenants set plan = i.upgrade_to,
      care_rate_cents = case when care_active then new_rate else care_rate_cents end,
      care_plan = case when care_active then (case i.upgrade_to when 'growth' then 'Growth Care' when 'premium' then 'Optimization Care' else 'Essential Care' end) else care_plan end
    where id = i.tenant_id;
    perform log_event(i.tenant_id, 'plan.upgrade', i.upgrade_to, jsonb_build_object('plan', t.plan), jsonb_build_object('plan', i.upgrade_to, 'care_rate_cents', case when t.care_active then new_rate end));
  end if;
end $$;

-- Draft an upgrade and retire the unpaid setup invoices it replaces (drafts removed, sent ones voided), in one step.
create function create_upgrade(p_tenant uuid, p_to text, p_amount_cents int, p_note text, p_due date, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid; s invoices;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can create an upgrade'; end if;
  nid := create_invoice(p_tenant, 'upgrade', p_amount_cents, p_note, p_due, p_lines, p_to);
  for s in select * from invoices where tenant_id = p_tenant and kind in ('deposit','balance') and status in ('draft','open') for update loop
    if s.status = 'draft' then delete from invoices where id = s.id; else update invoices set status = 'void' where id = s.id; end if;
    perform log_event(p_tenant, 'invoice.superseded', s.kind, to_jsonb(s), jsonb_build_object('by', nid));
  end loop;
  return nid;
end $$;
grant execute on function create_upgrade(uuid, text, int, text, date, jsonb) to authenticated;
