-- Lead Engine P1, slice 4 (docs/LEAD_ENGINE_SPEC.md §4.6–4.7): the 48-hour follow-up steps and the outcome of each lead.
--  * lead_cadence: after a new lead, the steps the office takes if nobody has reached them yet: an email right away
--    (when there's an address), a second call at 2 hours, an email at 24 hours, calls at 26 and 47 hours (each at the
--    next open office time). Each step becomes a priority task on Today (follow_ups.lead_id). Nothing is sent to the lead
--    from here: an email step is a task for a person, with Helix's draft; no standing rules exist yet, so every outward
--    step is a tap. Texting steps don't exist (CLAUDE.md: no texting before A2P 10DLC).
--  * The steps stop, and their open tasks close, on contact, booking, any status change, or a stop request; a step
--    the person's consent doesn't cover (consent_allows) is skipped.
--  * Outcomes: status adds 'quoted' between booked and won ('won' is shown as Bound: old rows and the review ask keep
--    working). quoted_at, bound_at, premium_cents, lines_bound, lost_reason, x_date (the renewal date they gave).
--  * A renewal date makes call tasks 45, 30 and 15 days before it (those still ahead).

alter table follow_ups add column if not exists lead_id uuid references leads on delete cascade;
create index if not exists follow_ups_lead on follow_ups (lead_id) where lead_id is not null;

-- ---------- Outcomes ----------
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.leads'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'status' loop
    execute format('alter table leads drop constraint %I', c);
  end loop;
end $$;
alter table leads add constraint leads_status_check check (status in ('new','contacted','booked','quoted','won','lost'));
alter table leads add column if not exists quoted_at timestamptz;
alter table leads add column if not exists bound_at timestamptz;
alter table leads add column if not exists premium_cents int check (premium_cents is null or premium_cents between 0 and 100000000);
alter table leads add column if not exists lines_bound text[] not null default '{}';
alter table leads add column if not exists lost_reason text check (lost_reason is null or lost_reason in ('price','coverage','carrier_declined','no_response','went_elsewhere','not_eligible','other'));
alter table leads add column if not exists x_date date;

create or replace function update_lead(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare l leads;
begin
  select * into l from leads where id = p_id for update;
  if l.id is null or not (is_staff() or is_member(l.tenant_id)) then raise exception 'not allowed'; end if;
  if p_status not in ('new','contacted','booked','quoted','won','lost') then raise exception 'invalid status'; end if;
  update leads set status = p_status,
    first_contact_at = case when l.first_contact_at is null and p_status <> 'new' then now() else l.first_contact_at end,
    quoted_at = case when p_status = 'quoted' then coalesce(l.quoted_at, now()) else l.quoted_at end,
    bound_at = case when p_status = 'won' then coalesce(l.bound_at, now()) else l.bound_at end,
    note = coalesce(nullif(left(trim(coalesce(p_note, '')), 2000), ''), l.note), updated_by = auth.uid(), updated_at = now()
  where id = p_id;
  perform log_event(l.tenant_id, 'lead.' || p_status, 'Lead from ' || l.source, jsonb_build_object('status', l.status), jsonb_build_object('status', p_status));
end $$;
revoke execute on function update_lead(uuid, text, text) from public, anon;
grant execute on function update_lead(uuid, text, text) to authenticated;

-- Renewal-date call tasks (server side of record_outcome): 45, 30 and 15 days before, only those still ahead.
create or replace function lead_renewal_tasks(p_lead uuid)
returns int language plpgsql security definer set search_path = public as $$
declare l leads; d int; due date; n int := 0; today date;
begin
  select * into l from leads where id = p_lead;
  if l.id is null or l.x_date is null or not consent_allows(l.id, 'call') then return 0; end if;
  today := (now() at time zone tenant_tz(l.tenant_id))::date;
  delete from follow_ups where lead_id = l.id and status = 'open' and reason like 'Renews %';
  foreach d in array array[45, 30, 15] loop
    due := l.x_date - d;
    if due >= today then
      insert into follow_ups (tenant_id, who, reason, due_on, due_at, lead_id)
      values (l.tenant_id, l.name, left('Renews ' || to_char(l.x_date, 'Mon FMDD') || ' (' || d || ' days): call ' || l.name || ' about their renewal' || coalesce(' (' || l.topic || ')', ''), 300), due, '10:00', l.id);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function lead_renewal_tasks(uuid) from public, anon, authenticated;

-- Record how a lead ended up (members and staff): quoted, bound (won) or lost, with what the office learned.
-- p: {premium_cents, lines, lost_reason, x_date, note}.
create or replace function record_outcome(p_id uuid, p_status text, p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare l leads; lines text[]; xd date; reason text; tasks int := 0;
begin
  select * into l from leads where id = p_id for update;
  if l.id is null or not (is_staff() or is_member(l.tenant_id)) then raise exception 'not allowed'; end if;
  if p_status not in ('quoted','won','lost') then raise exception 'invalid outcome'; end if;
  select coalesce(array_agg(distinct x), '{}') into lines from jsonb_array_elements_text(coalesce(p->'lines', '[]')) x
    where x in ('auto','home','renters','boat','rv','motorcycle','condo','umbrella','life','commercial');
  reason := nullif(p->>'lost_reason', '');
  if p_status = 'lost' and reason is not null and reason not in ('price','coverage','carrier_declined','no_response','went_elsewhere','not_eligible','other') then raise exception 'invalid reason'; end if;
  xd := case when coalesce(p->>'x_date', '') ~ '^\d{4}-\d\d-\d\d$' then (p->>'x_date')::date end;
  if xd is not null and (xd < current_date - 1 or xd > current_date + 400) then raise exception 'pick a renewal date in the next 13 months'; end if;
  update leads set status = p_status,
    first_contact_at = coalesce(l.first_contact_at, now()),
    quoted_at = case when p_status in ('quoted','won') then coalesce(l.quoted_at, now()) else l.quoted_at end,
    bound_at = case when p_status = 'won' then coalesce(l.bound_at, now()) else l.bound_at end,
    premium_cents = case when p_status = 'won' and (p->>'premium_cents') ~ '^\d{1,9}$' then (p->>'premium_cents')::int else l.premium_cents end,
    lines_bound = case when p_status = 'won' and cardinality(lines) > 0 then lines else l.lines_bound end,
    lost_reason = case when p_status = 'lost' then coalesce(reason, 'other') else null end,
    x_date = coalesce(xd, l.x_date),
    note = coalesce(nullif(left(trim(coalesce(p->>'note', '')), 2000), ''), l.note), updated_by = auth.uid(), updated_at = now()
  where id = p_id;
  if xd is not null and p_status <> 'won' then tasks := lead_renewal_tasks(p_id); end if;
  perform log_event(l.tenant_id, 'lead.' || p_status, 'Lead from ' || l.source, jsonb_build_object('status', l.status),
    jsonb_strip_nulls(jsonb_build_object('status', p_status, 'reason', reason, 'x_date', xd, 'lines', to_jsonb(lines))));
  return tasks;
end $$;
revoke all on function record_outcome(uuid, text, jsonb) from public, anon;
grant execute on function record_outcome(uuid, text, jsonb) to authenticated;

-- ---------- The 48-hour cadence ----------
create table if not exists lead_cadence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  lead_id uuid not null references leads on delete cascade,
  step int not null check (step between 1 and 9),
  kind text not null check (kind in ('call','email')),
  lane text not null default 'tap' check (lane in ('auto','tap')),
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','done','skipped','stopped')),
  follow_up_id uuid references follow_ups on delete set null,
  note text,
  unique (lead_id, step)
);
create index if not exists lead_cadence_due on lead_cadence (due_at) where status = 'pending';
alter table lead_cadence enable row level security;
create policy r on lead_cadence for select to authenticated using (is_staff() or is_member(tenant_id));

-- New lead: its timer (0096) and its steps. Each step lands at the next open office time.
create or replace function on_lead_new() returns trigger language plpgsql security definer set search_path = public as $$
declare s timestamptz;
begin
  perform lead_alert(new, '{}', new.id::text);
  if new.status = 'new' and new.first_contact_at is null and not coalesce((select is_sample from tenants where id = new.tenant_id), true) then
    s := office_open_at(new.tenant_id, new.created_at);
    insert into lead_timers (lead_id, tenant_id, started_at, due_at) values (new.id, new.tenant_id, s, s + interval '5 minutes')
    on conflict (lead_id) do nothing;
    insert into lead_cadence (tenant_id, lead_id, step, kind, lane, due_at)
    select new.tenant_id, new.id, x.step, x.kind, x.lane, office_open_at(new.tenant_id, new.created_at + x.after)
    from (values (1, 'email', 'tap', interval '0'), (2, 'call', 'auto', interval '2 hours'), (3, 'email', 'tap', interval '24 hours'),
                 (4, 'call', 'auto', interval '26 hours'), (5, 'call', 'auto', interval '47 hours')) as x(step, kind, lane, after)
    where x.kind = 'call' or new.email is not null
    on conflict (lead_id, step) do nothing;
  end if;
  return new;
end $$;

-- Contact, booking or any status change: the timer closes (0096) and the steps stop, their open tasks closed.
create or replace function lead_stop_steps(p_lead uuid, p_why text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update lead_cadence set status = 'stopped', note = p_why where lead_id = p_lead and status = 'pending';
  update follow_ups set status = 'done', done_at = now() where lead_id = p_lead and status = 'open'
    and id in (select follow_up_id from lead_cadence where lead_id = p_lead and follow_up_id is not null);
end $$;
revoke all on function lead_stop_steps(uuid, text) from public, anon, authenticated;

create or replace function lead_close_timer() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'new' or new.first_contact_at is not null then
    update lead_timers set done_at = now() where lead_id = new.id and done_at is null;
    perform lead_stop_steps(new.id, 'reached or moved to ' || new.status);
  end if;
  return new;
end $$;

-- A stop request also stops the steps on every one of the person's leads (redefines 0094).
create or replace function revoke_lead_consent(p_lead uuid, p_via text)
returns int language plpgsql security definer set search_path = public as $$
declare l leads; n int; x uuid;
begin
  select * into l from leads where id = p_lead;
  if l.id is null or not (is_staff() or is_member(l.tenant_id)) then raise exception 'not allowed'; end if;
  if coalesce(p_via, '') not in ('stop','unsubscribe','call','email','staff','other') then raise exception 'invalid reason'; end if;
  update lead_consents set revoked_at = now(), revoked_via = p_via
  where tenant_id = l.tenant_id and revoked_at is null
    and (lead_id = l.id or (l.contact_id is not null and lead_id in (select id from leads where contact_id = l.contact_id)));
  get diagnostics n = row_count;
  for x in select id from leads where id = l.id or (l.contact_id is not null and contact_id = l.contact_id) loop
    perform lead_stop_steps(x, 'asked us to stop');
  end loop;
  insert into lead_events (tenant_id, lead_id, kind, data) values (l.tenant_id, l.id, 'consent', jsonb_build_object('revoked', p_via, 'rows', n));
  perform log_event(l.tenant_id, 'lead.consent_revoked', l.name, null, jsonb_build_object('via', p_via));
  return n;
end $$;
revoke all on function revoke_lead_consent(uuid, text) from public, anon;
grant execute on function revoke_lead_consent(uuid, text) to authenticated;

-- The minute's run (server only): steps that came due become priority tasks on Today, due now in the office's time.
create or replace function run_lead_cadence()
returns int language plpgsql security definer set search_path = public as $$
declare r record; l leads; tz text; fid uuid; what text; n int := 0;
begin
  for r in select * from lead_cadence where status = 'pending' and due_at <= now() order by due_at limit 200 for update skip locked loop
    select * into l from leads where id = r.lead_id;
    if l.id is null or l.status <> 'new' or l.first_contact_at is not null then
      update lead_cadence set status = 'stopped', note = 'reached or moved on' where id = r.id; continue;
    end if;
    if not consent_allows(l.id, r.kind) then
      update lead_cadence set status = 'skipped', note = 'their consent doesn''t cover ' || r.kind where id = r.id; continue;
    end if;
    tz := tenant_tz(l.tenant_id);
    what := case
      when r.step = 1 then 'Email ' || l.name || ': got your request, here''s when we''ll call (Helix can draft it)'
      when r.kind = 'email' then 'Email ' || l.name || ': still want to help (Helix can draft it)'
      else 'Call ' || l.name || ' again: no contact yet (' || case r.step when 2 then '2nd' when 4 then '3rd' else '4th' end || ' try)' end
      || coalesce(' · ' || l.topic, '');
    insert into follow_ups (tenant_id, who, reason, due_on, due_at, priority, lead_id)
    values (l.tenant_id, l.name, left(what, 300), (now() at time zone tz)::date, to_char(now() at time zone tz, 'HH24:MI')::time, true, l.id)
    returning id into fid;
    update lead_cadence set status = 'done', follow_up_id = fid where id = r.id;
    insert into lead_events (tenant_id, lead_id, kind, data) values (l.tenant_id, l.id, 'cadence', jsonb_build_object('step', r.step, 'kind', r.kind, 'lane', r.lane));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function run_lead_cadence() from public, anon, authenticated;
grant execute on function run_lead_cadence() to service_role;
