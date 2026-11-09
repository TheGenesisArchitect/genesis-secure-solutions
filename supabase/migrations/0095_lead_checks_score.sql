-- Lead Engine P1, slice 2 (docs/LEAD_ENGINE_SPEC.md §4.3–4.4): check and score every lead.
--  * lead_checks: one result per lead per kind: 'phone' (well-formed US number), 'line_type' (Twilio Lookup, only
--    when LEAD_LOOKUP_ON=1: it costs $0.008), 'email' (the domain takes mail, over DNS). A failed check never deletes
--    or hides a lead.
--  * leads.score (0–100) with its reasons, leads.verified, leads.scored_at. The score only sets order and routing;
--    it never decides eligibility or price and never uses protected traits.
--  * The minute's /api/cron/leads run scores new leads and rescores a lead when it changes (asked again, status).

create table if not exists lead_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  lead_id uuid not null references leads on delete cascade,
  kind text not null check (kind in ('phone','line_type','email')),
  ok boolean,
  result jsonb not null default '{}',
  at timestamptz not null default now(),
  unique (lead_id, kind)
);
alter table lead_checks enable row level security;
create policy r on lead_checks for select to authenticated using (is_staff() or is_member(tenant_id));

alter table leads add column if not exists score int check (score is null or score between 0 and 100);
alter table leads add column if not exists score_reasons text[] not null default '{}';
alter table leads add column if not exists out_of_line boolean not null default false;
alter table leads add column if not exists verified boolean;
alter table leads add column if not exists scored_at timestamptz;
create index if not exists leads_to_score on leads (created_at) where scored_at is null;

-- Leads waiting for a score: new ones, and ones that changed since (server only). Last 30 days.
create or replace function leads_to_score(p_limit int)
returns setof leads language sql stable security definer set search_path = public as $$
  select * from leads
  where created_at > now() - interval '30 days' and (scored_at is null or scored_at < updated_at)
  order by created_at desc limit least(greatest(p_limit, 1), 200)
$$;
revoke all on function leads_to_score(int) from public, anon, authenticated;
grant execute on function leads_to_score(int) to service_role;

-- Save a lead's checks and score (server only). Leaves updated_at alone; scored_at is the updated_at the score was made
-- from (p_seen), so a change that lands while scoring still gets its own pass.
-- p_checks: [{kind, ok, result}]. A score change is a lead event.
create or replace function save_lead_score(p_lead uuid, p_checks jsonb, p_score int, p_reasons text[], p_out_of_line boolean, p_verified boolean, p_seen timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare l leads; c jsonb;
begin
  select * into l from leads where id = p_lead for update;
  if l.id is null then return; end if;
  for c in select * from jsonb_array_elements(coalesce(p_checks, '[]')) loop
    insert into lead_checks (tenant_id, lead_id, kind, ok, result)
    values (l.tenant_id, l.id, c->>'kind', (c->>'ok')::boolean, coalesce(c->'result', '{}'))
    on conflict (lead_id, kind) do update set ok = excluded.ok, result = excluded.result, at = now();
  end loop;
  update leads set score = greatest(0, least(100, p_score)), score_reasons = coalesce(p_reasons, '{}'), out_of_line = coalesce(p_out_of_line, false),
    verified = p_verified, scored_at = coalesce(p_seen, l.updated_at)
  where id = l.id;
  if l.score is distinct from greatest(0, least(100, p_score)) then
    insert into lead_events (tenant_id, lead_id, kind, data)
    values (l.tenant_id, l.id, 'score', jsonb_build_object('from', l.score, 'to', greatest(0, least(100, p_score)), 'reasons', to_jsonb(coalesce(p_reasons, '{}'))));
  end if;
end $$;
revoke all on function save_lead_score(uuid, jsonb, int, text[], boolean, boolean, timestamptz) from public, anon, authenticated;
grant execute on function save_lead_score(uuid, jsonb, int, text[], boolean, boolean, timestamptz) to service_role;
