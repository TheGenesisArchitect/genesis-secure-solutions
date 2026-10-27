-- Visibility (Growth): how the market finds, chooses, visits and converts for an agency. Most of the board reads what
-- Genovus already holds (leads, posts). This adds the agency's own social numbers, pulled daily from its Metricool
-- brand, and a record of each pull so the board can say "not connected" or "Metricool didn't answer" instead of zero.
--  * social_daily: one value per agency, network, metric and day (the agency's own account data, from Metricool).
--  * visibility_pulls: the last pull per agency and source, with what worked and what didn't.
-- Members of the agency and staff read both; only the Genovus server writes them.

create table if not exists social_daily (
  tenant_id uuid not null references tenants on delete cascade,
  network text not null check (network in ('facebook','instagram')),
  metric text not null check (metric in ('followers','reach','views','interactions')),
  day date not null,
  value numeric not null,
  pulled_at timestamptz not null default now(),
  primary key (tenant_id, network, metric, day)
);
alter table social_daily enable row level security;
create policy r on social_daily for select to authenticated using (is_staff() or is_member(tenant_id));

create table if not exists visibility_pulls (
  tenant_id uuid not null references tenants on delete cascade,
  source text not null check (source in ('metricool')),
  pulled_at timestamptz not null default now(),
  ok boolean not null,
  detail jsonb not null default '{}',
  primary key (tenant_id, source)
);
alter table visibility_pulls enable row level security;
create policy r on visibility_pulls for select to authenticated using (is_staff() or is_member(tenant_id));
