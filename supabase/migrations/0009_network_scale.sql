-- Network view at national scale: each agency carries its state, and the portfolio can be read for one
-- network at a time (staff see every network; partners only their own, as before).
alter table tenants add column if not exists state text check (state is null or state ~ '^[A-Z]{2}$');
create index if not exists tenants_state on tenants (state);

drop function if exists network_portfolio();
create function network_portfolio(p_network uuid default null)
returns table (network_id uuid, network text, tenant_name text, slug text, state text, stage lifecycle_stage, stage_since timestamptz, plan text,
  gates_cleared int, gates_total int, approvals_pending int, approval_hours numeric, posts_month int, leads_month int, is_sample boolean)
language sql stable security definer set search_path = public as $$
  select n.id, n.name, t.name, t.slug, t.state, t.stage, t.stage_since, t.plan,
    (select count(*) from gates g where g.tenant_id = t.id and g.status in ('cleared','waived'))::int,
    (select count(*) from gates g where g.tenant_id = t.id)::int,
    (select count(*) from approvals a where a.tenant_id = t.id and a.status = 'pending')::int,
    (select round(avg(extract(epoch from a.decided_at - a.requested_at) / 3600)::numeric, 1) from approvals a where a.tenant_id = t.id and a.decided_at is not null),
    (select count(*) from content_items c where c.tenant_id = t.id and c.status = 'published' and c.scheduled_for >= date_trunc('month', now()))::int,
    (select coalesce((k.metrics->>'leads')::int, 0) from kpi_snapshots k where k.tenant_id = t.id order by k.period desc limit 1),
    t.is_sample
  from networks n join network_tenants nt on nt.network_id = n.id join tenants t on t.id = nt.tenant_id
  where (n.id in (select my_network_ids()) or is_staff()) and (p_network is null or n.id = p_network)
  order by n.name, t.name
$$;
grant execute on function network_portfolio(uuid) to authenticated;
