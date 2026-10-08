-- Care (monthly maintenance) as a real subscription, custom and upgrade invoices with line items,
-- removable drafts, and plan changes that apply when an upgrade invoice is paid.

alter table invoices drop constraint invoices_kind_check;
alter table invoices add constraint invoices_kind_check check (kind in ('deposit','balance','care','upgrade','custom'));
alter table invoices
  add column if not exists lines jsonb not null default '[]',
  add column if not exists upgrade_to text check (upgrade_to is null or upgrade_to in ('launch','growth','premium')),
  add column if not exists period_start date,
  add column if not exists period_end date;
-- One care invoice per client per billing period.
create unique index if not exists invoices_care_period on invoices (tenant_id, period_start) where kind = 'care';

alter table tenants
  add column if not exists care_active boolean not null default false,
  add column if not exists care_rate_cents int check (care_rate_cents is null or care_rate_cents >= 0),
  add column if not exists care_started_on date,
  add column if not exists care_ended_on date;

-- Draft an invoice with optional line items, an upgrade target and a billing period.
drop function if exists create_invoice(uuid, text, int, text, date);
create function create_invoice(p_tenant uuid, p_kind text, p_amount_cents int, p_note text default null, p_due date default null,
  p_lines jsonb default '[]', p_upgrade_to text default null, p_period_start date default null, p_period_end date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can create an invoice'; end if;
  if p_amount_cents <= 0 then raise exception 'amount must be positive'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]')) <> 'array' then raise exception 'lines must be a list'; end if;
  insert into invoices (tenant_id, kind, amount_cents, status, note, due_date, lines, upgrade_to, period_start, period_end)
  values (p_tenant, p_kind, p_amount_cents, 'draft', left(p_note, 300), p_due, coalesce(p_lines, '[]'), p_upgrade_to, p_period_start, p_period_end)
  returning id into nid;
  perform log_event(p_tenant, 'invoice.create', p_kind, null, jsonb_build_object('amount_cents', p_amount_cents, 'upgrade_to', p_upgrade_to, 'lines', p_lines));
  return nid;
end $$;

-- Drafts can be removed; anything sent can only be voided, so the record stays honest.
create function delete_invoice(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare i invoices;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can remove an invoice'; end if;
  select * into i from invoices where id = p_id for update;
  if i.id is null then raise exception 'not found'; end if;
  if i.status <> 'draft' then raise exception 'only drafts can be removed; void a sent invoice instead'; end if;
  delete from invoices where id = p_id;
  perform log_event(i.tenant_id, 'invoice.delete', i.kind, to_jsonb(i), null);
end $$;

-- Paying an upgrade invoice switches the plan (and the care rate, when care is running).
create or replace function mark_invoice_paid(p_id uuid, p_via text default 'Mercury', p_paid_on date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare i invoices; t tenants; new_rate int;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can record a payment'; end if;
  select * into i from invoices where id = p_id for update;
  if i.id is null then raise exception 'not found'; end if;
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

-- Start monthly care: sets the plan and rate, moves the client to Care, and drafts the first (prorated) month.
create function start_care(p_tenant uuid, p_care text, p_rate_cents int, p_start date, p_first_cents int, p_first_end date)
returns uuid language plpgsql security definer set search_path = public as $$
declare t tenants; nid uuid;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can start care'; end if;
  select * into t from tenants where id = p_tenant for update;
  if t.id is null then raise exception 'no such client'; end if;
  if t.care_active then raise exception 'care is already running for this client'; end if;
  update tenants set care_active = true, care_plan = p_care, care_rate_cents = p_rate_cents, care_started_on = p_start, care_ended_on = null where id = p_tenant;
  if t.stage <> 'care' then
    update tenants set stage = 'care', stage_since = now() where id = p_tenant;
    insert into lifecycle_events (tenant_id, from_stage, to_stage, note, actor) values (p_tenant, t.stage, 'care', 'Monthly care started', auth.uid());
  end if;
  insert into invoices (tenant_id, kind, amount_cents, status, note, due_date, lines, period_start, period_end)
  values (p_tenant, 'care', p_first_cents, 'draft', p_care || ', first month (prorated)', p_start + 7,
          jsonb_build_array(jsonb_build_object('label', p_care || ' ' || to_char(p_start, 'Mon DD') || ' to ' || to_char(p_first_end, 'Mon DD'), 'cents', p_first_cents)),
          p_start, p_first_end)
  on conflict do nothing returning id into nid;
  perform log_event(p_tenant, 'care.start', p_care, null, jsonb_build_object('rate_cents', p_rate_cents, 'start', p_start, 'first_cents', p_first_cents));
  return nid;
end $$;

create function stop_care(p_tenant uuid, p_end date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare t tenants;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can stop care'; end if;
  select * into t from tenants where id = p_tenant for update;
  if not t.care_active then raise exception 'care is not running'; end if;
  update tenants set care_active = false, care_ended_on = p_end where id = p_tenant;
  perform log_event(p_tenant, 'care.stop', t.care_plan, jsonb_build_object('rate_cents', t.care_rate_cents), jsonb_build_object('ended', p_end));
end $$;

-- The 1st of each month: draft a care invoice for every client with care running (idempotent per period).
create function draft_monthly_care(p_period date)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not has_role('admin','account_lead') then raise exception 'not allowed'; end if;
  insert into invoices (tenant_id, kind, amount_cents, status, note, due_date, lines, period_start, period_end)
  select t.id, 'care', t.care_rate_cents, 'draft', t.care_plan || ', ' || to_char(p_period, 'FMMonth YYYY'), p_period + 7,
         jsonb_build_array(jsonb_build_object('label', t.care_plan || ', ' || to_char(p_period, 'FMMonth YYYY'), 'cents', t.care_rate_cents)),
         p_period, (p_period + interval '1 month' - interval '1 day')::date
  from tenants t
  where t.care_active and t.care_rate_cents > 0 and not t.is_sample and t.care_started_on < p_period
  on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then perform log_event(null, 'care.month', to_char(p_period, 'YYYY-MM'), null, jsonb_build_object('drafted', n)); end if;
  return n;
end $$;

grant execute on function create_invoice(uuid, text, int, text, date, jsonb, text, date, date), delete_invoice(uuid),
  start_care(uuid, text, int, date, int, date), stop_care(uuid, date), draft_monthly_care(date) to authenticated;

-- The client email when an invoice is sent now carries its kind, lines and any upgrade target.
create or replace function on_invoice_open() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'open' or new.pay_url is null or (old.status = 'open' and old.pay_url is not distinct from new.pay_url) then return new; end if;
  if (select is_sample from tenants where id = new.tenant_id) then return new; end if;
  insert into outbox (tenant_id, to_email, template, data, dedupe_key)
  select new.tenant_id, u.email, case when new.kind = 'upgrade' then 'upgrade_ready' else 'invoice_ready' end,
    jsonb_build_object('agency', t.name, 'slug', t.slug, 'amount', to_char(new.amount_cents / 100.0, 'FM$999,999,990.00'), 'kind', new.kind,
      'due', coalesce(to_char(new.due_date, 'Mon DD, YYYY'), ''), 'upgrade_to', coalesce(new.upgrade_to, ''), 'note', coalesce(new.note, ''),
      'lines', (select coalesce(string_agg((l->>'label') || ': ' || to_char(((l->>'cents')::int) / 100.0, 'FM$999,999,990.00'), E'\n'), '') from jsonb_array_elements(new.lines) l)),
    'invoice:' || new.id || ':' || coalesce(new.pay_url, '') || ':' || u.id
  from memberships m join auth.users u on u.id = m.user_id join tenants t on t.id = m.tenant_id
  where m.tenant_id = new.tenant_id and m.role = 'owner' and u.email is not null
  on conflict (dedupe_key) do nothing;
  return new;
end $$;
