-- A program for life at a locked monthly rate (a founding-client thank-you), and JAVA Agency as the first.
--  lifetime_plan        the program the agency keeps for life ('growth' | 'premium')
--  lifetime_rate_cents  the monthly care rate locked with it (startCare charges this for that program)
--  lifetime_waived_cents the upgrade fee waived with it (shown to the client as part of the thank-you)
--  lifetime_since       when it was given
--  lifetime_note        why, for the record (staff only; never shown to the client)
--  lifetime_seen_at     when the owner closed the congratulations card on their Home page
alter table tenants
  add column if not exists lifetime_plan text check (lifetime_plan is null or lifetime_plan in ('growth', 'premium')),
  add column if not exists lifetime_rate_cents int check (lifetime_rate_cents is null or lifetime_rate_cents >= 0),
  add column if not exists lifetime_waived_cents int check (lifetime_waived_cents is null or lifetime_waived_cents >= 0),
  add column if not exists lifetime_since date,
  add column if not exists lifetime_note text,
  add column if not exists lifetime_seen_at timestamptz;

-- Operator, 2026-11-16: JAVA Agency (Mendez Hollis), our first client, gets Growth for life at the launch rate he
-- pays now ($249/mo), with the Growth upgrade fee waived. Off the trial: Growth is now his program, not a grant.
do $$
declare t tenants;
begin
  select * into t from tenants where slug = 'mendez-hollis';
  if not found then return; end if; -- preview and local databases don't have him
  update tenants set
    plan = 'growth',
    care_plan = case when care_active then 'Growth Care' else care_plan end,
    care_rate_cents = case when care_active then coalesce(care_rate_cents, 24900) else care_rate_cents end,
    lifetime_plan = 'growth',
    lifetime_rate_cents = coalesce(t.care_rate_cents, 24900),
    -- Growth setup $2,500 less the $375 he paid toward setup = the $2,125 upgrade fee, waived.
    lifetime_waived_cents = 212500,
    lifetime_since = date '2026-11-16',
    lifetime_note = 'Founding client: Growth for life at his launch rate ($249/mo); Growth upgrade fee waived. Operator, 2026-11-16.'
  where id = t.id;
  perform log_event(t.id, 'program.lifetime', 'growth',
    jsonb_build_object('plan', t.plan, 'care_plan', t.care_plan, 'care_rate_cents', t.care_rate_cents),
    jsonb_build_object('plan', 'growth', 'lifetime_plan', 'growth', 'lifetime_rate_cents', coalesce(t.care_rate_cents, 24900)));
end $$;
