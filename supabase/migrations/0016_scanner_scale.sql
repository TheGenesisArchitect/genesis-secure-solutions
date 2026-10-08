-- Scanner at scale: counts come from one aggregate (no 1,000-row page limits), every Google Places call is
-- metered against the monthly budget (not only the sweep's searches), and staff-only reads stay staff-only.

create or replace function prospect_counts()
returns table (carrier_id uuid, state text, status text, segment text, n bigint)
language sql stable security definer set search_path = public as $$
  select carrier_id, state, status, segment, count(*) from prospects where (select is_staff()) group by 1, 2, 3, 4
$$;
grant execute on function prospect_counts() to authenticated;

create or replace function scan_cell_counts()
returns table (state text, status text, n bigint, last_scanned timestamptz)
language sql stable security definer set search_path = public as $$
  select state, status, count(*), max(last_scanned) from scan_cells where (select is_staff()) group by 1, 2
$$;
grant execute on function scan_cell_counts() to authenticated;

-- Google Places usage by day and SKU (searches by the sweep, details shown on screen).
create table if not exists places_usage (
  day date not null default current_date,
  sku text not null check (sku in ('text_search','details','summary')),
  calls int not null default 0,
  cost_cents numeric not null default 0,
  primary key (day, sku)
);
alter table places_usage enable row level security;
create policy r on places_usage for select to authenticated using ((select is_staff()));

create or replace function bump_places_usage(p_sku text, p_calls int, p_cost_cents numeric)
returns void language sql security definer set search_path = public as $$
  insert into places_usage (day, sku, calls, cost_cents) values (current_date, p_sku, p_calls, p_cost_cents)
  on conflict (day, sku) do update set calls = places_usage.calls + excluded.calls, cost_cents = places_usage.cost_cents + excluded.cost_cents
$$;
revoke execute on function bump_places_usage(text, int, numeric) from public, anon, authenticated;
grant execute on function bump_places_usage(text, int, numeric) to service_role;

create or replace function places_month_cents()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_cents), 0) from places_usage where day >= date_trunc('month', current_date)
$$;
revoke execute on function places_month_cents() from public, anon;
grant execute on function places_month_cents() to authenticated, service_role;
