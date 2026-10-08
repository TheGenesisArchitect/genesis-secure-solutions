-- Growth & financials for the house account: what Genovus spends (expenses), so CAC, payback and margin
-- are real. Revenue is never entered here: it comes from paid invoices and live care plans.

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null,
  category text not null check (category in ('ads','data','infrastructure','tools','people','other')),
  vendor text not null check (length(vendor) between 1 and 80),
  amount_cents int not null check (amount_cents > 0),
  recurring boolean not null default false,          -- a monthly cost: copied forward on the 1st by the daily job
  campaign_id uuid references campaigns on delete set null,
  note text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists expenses_on on expenses (spent_on);
alter table expenses enable row level security;
create policy r on expenses for select to authenticated using (has_role('admin','account_lead'));

create or replace function add_expense(p_on date, p_category text, p_vendor text, p_amount_cents int, p_recurring boolean, p_campaign uuid, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can record expenses'; end if;
  insert into expenses (spent_on, category, vendor, amount_cents, recurring, campaign_id, note, created_by)
  values (p_on, p_category, trim(p_vendor), p_amount_cents, coalesce(p_recurring, false), p_campaign, nullif(trim(p_note), ''), auth.uid()) returning id into eid;
  perform log_event((select id from tenants where slug = 'genovus'), 'expense.add', p_vendor, null, jsonb_build_object('amount_cents', p_amount_cents, 'category', p_category, 'on', p_on, 'recurring', p_recurring));
  return eid;
end $$;

create or replace function delete_expense(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e expenses;
begin
  if not has_role('admin') then raise exception 'only an admin can delete an expense'; end if;
  select * into e from expenses where id = p_id;
  delete from expenses where id = p_id;
  perform log_event((select id from tenants where slug = 'genovus'), 'expense.delete', e.vendor, to_jsonb(e), null);
end $$;

-- On the 1st: carry each recurring cost into the new month once (latest row per vendor+category).
create or replace function roll_recurring_expenses(p_month date)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into expenses (spent_on, category, vendor, amount_cents, recurring, campaign_id, note)
  select p_month, e.category, e.vendor, e.amount_cents, true, e.campaign_id, 'Recurring (carried forward)'
  from (select distinct on (vendor, category) * from expenses where recurring and spent_on < p_month order by vendor, category, spent_on desc) e
  where not exists (select 1 from expenses x where x.vendor = e.vendor and x.category = e.category and x.spent_on >= p_month and x.spent_on < (p_month + interval '1 month'));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function roll_recurring_expenses(date) from public, anon, authenticated;
grant execute on function roll_recurring_expenses(date) to service_role;
grant execute on function add_expense(date, text, text, int, boolean, uuid, text), delete_expense(uuid) to authenticated;
