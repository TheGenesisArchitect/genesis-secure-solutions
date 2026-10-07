-- Billing through Mercury (Genesis Secure Solutions banks with Mercury; clients pay Mercury invoices).
-- The team creates the invoice in Mercury and records its payment link here; the agency pays from its
-- Billing page. Only mercury.com links are accepted, so a forged link can never reach a client.
alter table invoices
  add column number text,
  add column due_date date,
  add column pay_url text check (pay_url is null or pay_url ~ '^https://([a-z0-9-]+\.)*mercury\.com/'),
  add column paid_via text,
  add column issued_at timestamptz;

create function create_invoice(p_tenant uuid, p_kind text, p_amount_cents int, p_note text default null, p_due date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can create an invoice'; end if;
  if p_amount_cents <= 0 then raise exception 'amount must be positive'; end if;
  insert into invoices (tenant_id, kind, amount_cents, status, note, due_date)
  values (p_tenant, p_kind, p_amount_cents, 'draft', left(p_note, 300), p_due) returning id into nid;
  perform log_event(p_tenant, 'invoice.create', p_kind, null, jsonb_build_object('amount_cents', p_amount_cents, 'due', p_due));
  return nid;
end $$;

-- Publishing the Mercury link is the outward step (required lane): the invoice becomes open and the owner is emailed.
create function publish_invoice(p_id uuid, p_pay_url text, p_number text default null, p_due date default null)
returns void language plpgsql security definer set search_path = public as $$
declare i invoices;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can send an invoice'; end if;
  if p_pay_url !~ '^https://([a-z0-9-]+\.)*mercury\.com/' then raise exception 'use the payment link from your Mercury invoice (mercury.com)'; end if;
  select * into i from invoices where id = p_id for update;
  if i.id is null then raise exception 'not found'; end if;
  if i.status = 'paid' then raise exception 'this invoice is already paid'; end if;
  update invoices set pay_url = p_pay_url, number = coalesce(nullif(trim(p_number), ''), number), due_date = coalesce(p_due, due_date),
    status = 'open', issued_at = coalesce(issued_at, now()) where id = p_id;
  perform log_event(i.tenant_id, 'invoice.publish', coalesce(p_number, i.kind), jsonb_build_object('status', i.status), jsonb_build_object('status', 'open', 'pay_url', p_pay_url));
end $$;

create function mark_invoice_paid(p_id uuid, p_via text default 'Mercury', p_paid_on date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare i invoices;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can record a payment'; end if;
  select * into i from invoices where id = p_id for update;
  if i.id is null then raise exception 'not found'; end if;
  update invoices set status = 'paid', paid_via = left(p_via, 60), paid_at = p_paid_on::timestamptz + interval '12 hours' where id = p_id;
  perform log_event(i.tenant_id, 'invoice.paid', coalesce(i.number, i.kind), jsonb_build_object('status', i.status), jsonb_build_object('status', 'paid', 'via', p_via, 'on', p_paid_on));
end $$;

create function void_invoice(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare i invoices;
begin
  if not has_role('admin') then raise exception 'only an admin can void an invoice'; end if;
  select * into i from invoices where id = p_id for update;
  if i.status = 'paid' then raise exception 'a paid invoice cannot be voided'; end if;
  update invoices set status = 'void' where id = p_id;
  perform log_event(i.tenant_id, 'invoice.void', coalesce(i.number, i.kind), jsonb_build_object('status', i.status), jsonb_build_object('status', 'void'));
end $$;

grant execute on function create_invoice(uuid, text, int, text, date), publish_invoice(uuid, text, text, date),
  mark_invoice_paid(uuid, text, date), void_invoice(uuid) to authenticated;

-- Email the agency owner when an invoice is ready to pay (once per invoice and owner).
create function on_invoice_open() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'open' or new.pay_url is null or (old.status = 'open' and old.pay_url is not distinct from new.pay_url) then return new; end if;
  if (select is_sample from tenants where id = new.tenant_id) then return new; end if;
  insert into outbox (tenant_id, to_email, template, data, dedupe_key)
  select new.tenant_id, u.email, 'invoice_ready',
    jsonb_build_object('agency', t.name, 'slug', t.slug, 'amount', to_char(new.amount_cents / 100.0, 'FM$999,999,990.00'), 'kind', new.kind, 'due', coalesce(to_char(new.due_date, 'Mon DD, YYYY'), '')),
    'invoice:' || new.id || ':' || coalesce(new.pay_url, '') || ':' || u.id
  from memberships m join auth.users u on u.id = m.user_id join tenants t on t.id = m.tenant_id
  where m.tenant_id = new.tenant_id and m.role = 'owner' and u.email is not null
  on conflict (dedupe_key) do nothing;
  return new;
end $$;
create trigger invoice_open after update on invoices for each row execute function on_invoice_open();
revoke execute on function on_invoice_open() from public, anon, authenticated;
