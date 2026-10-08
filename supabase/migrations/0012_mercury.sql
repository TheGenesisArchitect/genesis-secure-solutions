-- Mercury invoicing connection. Genovus creates each invoice in Mercury through its API, sends the client the
-- Mercury pay page, and records the payment when Mercury reports it paid. The Mercury key lives only in a
-- server environment variable; the functions here that act without a signed-in person run only for the
-- service role (the server's own jobs), and every one of them writes the audit log as "Mercury".

alter table tenants
  add column if not exists mercury_customer_id text,
  add column if not exists care_autosend boolean not null default false;

alter table invoices
  add column if not exists mercury_invoice_id text unique,
  add column if not exists mercury_slug text,
  add column if not exists mercury_status text,
  add column if not exists mercury_synced_at timestamptz;

-- Genovus invoice numbers (GV-2026-0001…), also used as Mercury's invoice number so a retry never duplicates.
create sequence if not exists invoice_number_seq;
create or replace function next_invoice_number() returns text language sql security definer set search_path = public as
$$ select 'GV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 4, '0') $$;
revoke execute on function next_invoice_number() from public, anon, authenticated;

-- Settings the server learns at runtime (the Mercury pay-page pattern). Service role only: no policies.
create table if not exists app_settings (key text primary key, value text not null, updated_at timestamptz not null default now());
alter table app_settings enable row level security;

-- Audit entries for the server's own Mercury work carry the label "Mercury".
create or replace function log_system(p_tenant uuid, p_action text, p_subject text, p_before jsonb, p_after jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_events (tenant_id, actor, actor_label, action, subject, before, after, prev_hash, hash)
  values (p_tenant, null, 'Mercury', p_action, p_subject, p_before, p_after, '', '')
$$;

-- Attach a created Mercury invoice and open it (the open trigger emails the client their pay link).
create or replace function mercury_attach_invoice(p_id uuid, p_mercury_id text, p_slug text, p_number text, p_pay_url text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare i invoices;
begin
  if p_pay_url !~ '^https://([a-z0-9-]+\.)*mercury\.com/' then raise exception 'not a Mercury pay link'; end if;
  select * into i from invoices where id = p_id for update;
  if i.id is null then raise exception 'not found'; end if;
  if i.status in ('paid','void') then raise exception 'this invoice is already %', i.status; end if;
  update invoices set mercury_invoice_id = p_mercury_id, mercury_slug = p_slug, mercury_status = p_status, mercury_synced_at = now(),
    number = coalesce(number, p_number), pay_url = p_pay_url, status = 'open', issued_at = coalesce(issued_at, now()) where id = p_id;
  perform log_system(i.tenant_id, 'invoice.publish', p_number, jsonb_build_object('status', i.status), jsonb_build_object('status', 'open', 'mercury_invoice_id', p_mercury_id, 'pay_url', p_pay_url));
end $$;

-- Record what Mercury reports. Paid applies the same plan switch as a manual payment.
create or replace function mercury_sync_status(p_id uuid, p_status text, p_paid_on date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare i invoices; t tenants; new_rate int;
begin
  select * into i from invoices where id = p_id for update;
  if i.id is null then return; end if;
  update invoices set mercury_status = p_status, mercury_synced_at = now() where id = p_id;
  if p_status = 'Paid' and i.status = 'open' then
    update invoices set status = 'paid', paid_via = 'Mercury', paid_at = now() where id = p_id;
    perform log_system(i.tenant_id, 'invoice.paid', coalesce(i.number, i.kind), jsonb_build_object('status', i.status), jsonb_build_object('status', 'paid', 'via', 'Mercury', 'on', p_paid_on));
    if i.kind = 'upgrade' and i.upgrade_to is not null then
      select * into t from tenants where id = i.tenant_id for update;
      new_rate := case i.upgrade_to when 'growth' then 39900 when 'premium' then 79900 else 24900 end;
      update tenants set plan = i.upgrade_to,
        care_rate_cents = case when care_active then new_rate else care_rate_cents end,
        care_plan = case when care_active then (case i.upgrade_to when 'growth' then 'Growth Care' when 'premium' then 'Optimization Care' else 'Essential Care' end) else care_plan end
      where id = i.tenant_id;
      perform log_system(i.tenant_id, 'plan.upgrade', i.upgrade_to, jsonb_build_object('plan', t.plan), jsonb_build_object('plan', i.upgrade_to));
    end if;
  elsif p_status = 'Cancelled' and i.status = 'open' then
    update invoices set status = 'void' where id = p_id;
    perform log_system(i.tenant_id, 'invoice.void', coalesce(i.number, i.kind), jsonb_build_object('status', i.status), jsonb_build_object('status', 'void', 'reason', 'cancelled in Mercury'));
  end if;
end $$;

revoke execute on function log_system(uuid, text, text, jsonb, jsonb), mercury_attach_invoice(uuid, text, text, text, text, text),
  mercury_sync_status(uuid, text, date) from public, anon, authenticated;
grant execute on function next_invoice_number(), log_system(uuid, text, text, jsonb, jsonb), mercury_attach_invoice(uuid, text, text, text, text, text),
  mercury_sync_status(uuid, text, date) to service_role;

-- Starting care now records whether monthly invoices go out automatically (the owner's standing approval).
create or replace function set_care_autosend(p_tenant uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can change automatic care billing'; end if;
  update tenants set care_autosend = p_on where id = p_tenant;
  perform log_event(p_tenant, 'care.autosend', case when p_on then 'on' else 'off' end, null, jsonb_build_object('autosend', p_on));
end $$;
grant execute on function set_care_autosend(uuid, boolean) to authenticated;
