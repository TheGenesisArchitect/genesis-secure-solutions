-- Lead Engine P1, slice 3 (docs/LEAD_ENGINE_SPEC.md §4.5): every lead has an owner and a 5-minute first-call timer.
--  * agency_profiles.office_hours: {mon: ["09:00","18:00"], ..., sat: null} in the agency's own time zone (default
--    Mon–Fri 9–6). A lead after hours starts its timer when the office opens.
--  * leads.owner_id: the agency owner who has gone longest without a new lead (round robin among owners).
--  * lead_timers: due 5 minutes after the lead (or the opening). Still not contacted at that point: an alert to the
--    rest of the team (push and email: "still waiting"). At 15 minutes: the owners are emailed and Today shows it in red.
--    Any contact, booking or status change closes the timer. Nothing here reaches the lead.
--  * The lead paths use the agency's time zone, not Eastern: a missed call's call-back, the booking log and the review
--    message (JAVA is also licensed in Alabama, which is Central).

alter table agency_profiles add column if not exists office_hours jsonb not null
  default '{"mon":["09:00","18:00"],"tue":["09:00","18:00"],"wed":["09:00","18:00"],"thu":["09:00","18:00"],"fri":["09:00","18:00"],"sat":null,"sun":null}';

-- The agency's time zone (Eastern when it has no profile yet).
create or replace function tenant_tz(p_tenant uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from agency_profiles where tenant_id = p_tenant), 'America/New_York')
$$;

-- The first moment at or after p_at that the office is open (p_at itself when open; p_at when no hours are set).
create or replace function office_open_at(p_tenant uuid, p_at timestamptz)
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare tz text := tenant_tz(p_tenant); h jsonb; loc timestamp; d date; win jsonb; o time; c time;
  days text[] := array['sun','mon','tue','wed','thu','fri','sat'];
begin
  select office_hours into h from agency_profiles where tenant_id = p_tenant;
  h := coalesce(h, '{"mon":["09:00","18:00"],"tue":["09:00","18:00"],"wed":["09:00","18:00"],"thu":["09:00","18:00"],"fri":["09:00","18:00"]}');
  loc := p_at at time zone tz;
  for i in 0..7 loop
    d := loc::date + i;
    win := h -> days[extract(dow from d)::int + 1];
    if win is null or jsonb_typeof(win) <> 'array' or jsonb_array_length(win) < 2 then continue; end if;
    o := (win->>0)::time; c := (win->>1)::time;
    if i > 0 or loc::time < o then return (d + o) at time zone tz; end if;
    if loc::time < c then return p_at; end if;
  end loop;
  return p_at;
end $$;
revoke all on function office_open_at(uuid, timestamptz) from public, anon, authenticated;
grant execute on function office_open_at(uuid, timestamptz) to service_role;

-- ---------- Owner ----------
alter table leads add column if not exists owner_id uuid references auth.users on delete set null;

create or replace function lead_pick_owner() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is null then
    select m.user_id into new.owner_id from memberships m
    where m.tenant_id = new.tenant_id and m.role = 'owner'
    order by (select max(l.created_at) from leads l where l.tenant_id = new.tenant_id and l.owner_id = m.user_id) asc nulls first, m.created_at
    limit 1;
  end if;
  return new;
end $$;
drop trigger if exists leads_owner on leads;
create trigger leads_owner before insert on leads for each row execute function lead_pick_owner();

-- ---------- The first-call timer ----------
create table if not exists lead_timers (
  lead_id uuid primary key references leads on delete cascade,
  tenant_id uuid not null references tenants on delete cascade,
  stage text not null default 'first_touch' check (stage in ('first_touch')),
  started_at timestamptz not null,
  due_at timestamptz not null,
  level int not null default 0 check (level between 0 and 2),
  escalated_at timestamptz,
  done_at timestamptz
);
create index if not exists lead_timers_due on lead_timers (due_at) where done_at is null and level < 2;
create index if not exists lead_timers_red on lead_timers (tenant_id) where done_at is null and level = 2;
alter table lead_timers enable row level security;
create policy r on lead_timers for select to authenticated using (is_staff() or is_member(tenant_id));

-- A new lead (0094's alert) also starts its timer, unless it's already contacted (an answered call) or a sample agency's.
create or replace function on_lead_new() returns trigger language plpgsql security definer set search_path = public as $$
declare s timestamptz;
begin
  perform lead_alert(new, '{}', new.id::text);
  if new.status = 'new' and new.first_contact_at is null and not coalesce((select is_sample from tenants where id = new.tenant_id), true) then
    s := office_open_at(new.tenant_id, new.created_at);
    insert into lead_timers (lead_id, tenant_id, started_at, due_at) values (new.id, new.tenant_id, s, s + interval '5 minutes')
    on conflict (lead_id) do nothing;
  end if;
  return new;
end $$;

-- Any contact or status change closes the timer.
create or replace function lead_close_timer() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'new' or new.first_contact_at is not null then
    update lead_timers set done_at = now() where lead_id = new.id and done_at is null;
  end if;
  return new;
end $$;
drop trigger if exists leads_close_timer on leads;
create trigger leads_close_timer after update of status, first_contact_at on leads for each row execute function lead_close_timer();

-- The minute's run (server only): timers that came due. 5 minutes: the rest of the team (or the owner when they work
-- alone) gets "still waiting". 15 minutes: the owners (or the Genovus team when no owner has signed in) and a red card.
create or replace function run_lead_timers()
returns int language plpgsql security definer set search_path = public as $$
declare r record; l leads; t tenants; mins int; d jsonb; n int := 0; sent int;
begin
  for r in select * from lead_timers where done_at is null and level < 2 and due_at <= now() order by due_at limit 100 for update skip locked loop
    select * into l from leads where id = r.lead_id;
    if l.id is null or l.status <> 'new' or l.first_contact_at is not null then
      update lead_timers set done_at = now() where lead_id = r.lead_id; continue;
    end if;
    select * into t from tenants where id = l.tenant_id;
    mins := greatest(1, round(extract(epoch from now() - r.started_at) / 60)::int);
    d := jsonb_build_object('lead', l.id, 'name', l.name, 'phone', coalesce(l.phone, ''), 'topic', coalesce(l.topic, ''), 'source', l.source,
      'channel', l.channel, 'slug', t.slug, 'agency', t.name, 'waiting', mins::text, 'level', (r.level + 1)::text);
    if r.level = 0 then
      insert into outbox (tenant_id, to_email, template, data, dedupe_key)
      select l.tenant_id, u.email, 'lead_waiting', d, 'wait:' || l.id || ':1:' || u.id
      from memberships m join auth.users u on u.id = m.user_id
      where m.tenant_id = l.tenant_id and u.email is not null
        and (m.user_id is distinct from l.owner_id or not exists (select 1 from memberships o where o.tenant_id = l.tenant_id and o.user_id is distinct from l.owner_id))
      on conflict (dedupe_key) do nothing;
      if exists (select 1 from push_subscriptions s join memberships m on m.user_id = s.user_id where m.tenant_id = l.tenant_id) then
        insert into outbox (tenant_id, to_email, template, data, dedupe_key) values (l.tenant_id, 'push', 'lead_push', d, 'push:wait:' || l.id || ':1')
        on conflict (dedupe_key) do nothing;
      end if;
      update lead_timers set level = 1, escalated_at = now(), due_at = r.started_at + interval '15 minutes' where lead_id = l.id;
    else
      insert into outbox (tenant_id, to_email, template, data, dedupe_key)
      select l.tenant_id, u.email, 'lead_waiting', d, 'wait:' || l.id || ':2:' || u.id
      from memberships m join auth.users u on u.id = m.user_id
      where m.tenant_id = l.tenant_id and m.role = 'owner' and u.email is not null
      on conflict (dedupe_key) do nothing;
      get diagnostics sent = row_count;
      if sent = 0 then
        insert into outbox (tenant_id, to_email, template, data, dedupe_key)
        select l.tenant_id, e, 'lead_waiting', d || jsonb_build_object('team', 'true'), 'wait:' || l.id || ':2:team:' || e from team_emails(l.tenant_id) e
        on conflict (dedupe_key) do nothing;
      end if;
      update lead_timers set level = 2, escalated_at = now() where lead_id = l.id;
    end if;
    insert into lead_events (tenant_id, lead_id, kind, data) values (l.tenant_id, l.id, 'escalate', jsonb_build_object('level', r.level + 1, 'waiting_min', mins));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function run_lead_timers() from public, anon, authenticated;
grant execute on function run_lead_timers() to service_role;

-- ---------- The agency's own time zone in the lead paths ----------
create or replace function ingest_call(p_to text, p_sid text, p_from text, p_status text, p_duration int, p_recording_sid text, p_recording_s int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n tracking_numbers; c calls; lid uuid; cid uuid; final text; tz text; today date; d text; pretty text;
begin
  select * into n from tracking_numbers where e164 = p_to and released_at is null;
  if n.id is null then raise exception 'unknown tracking number'; end if;
  tz := tenant_tz(n.tenant_id); today := (now() at time zone tz)::date;
  insert into calls (tenant_id, number_id, call_sid, from_e164) values (n.tenant_id, n.id, left(p_sid, 64), nullif(left(p_from, 20), ''))
  on conflict (call_sid) do nothing;
  select * into c from calls where call_sid = p_sid for update;
  if p_recording_sid is not null then
    update calls set recording_sid = left(p_recording_sid, 64), recording_s = p_recording_s where id = c.id;
  end if;
  if p_status is null or c.status <> 'ringing' then return jsonb_build_object('call', c.id, 'lead', c.lead_id); end if;
  d := right(regexp_replace(coalesce(c.from_e164, ''), '\D', '', 'g'), 10);
  pretty := case when length(d) = 10 then '(' || substr(d, 1, 3) || ') ' || substr(d, 4, 3) || '-' || substr(d, 7, 4) else 'unknown number' end;
  final := case when p_status = 'answered' then 'answered' else 'missed' end;
  cid := lead_contact(n.tenant_id, c.from_e164, null);
  if cid is not null then
    select id into lid from leads where tenant_id = n.tenant_id and contact_id = cid and created_at > now() - interval '30 days' order by created_at desc limit 1;
  end if;
  if lid is null then
    -- An answered call is the first contact, so no timer starts; a missed one is a lead to call back within minutes.
    insert into leads (tenant_id, ext_id, name, phone, topic, source, medium, channel, consent_text, contact_id, first_contact_at)
    values (n.tenant_id, 'call:' || c.call_sid, 'Caller ' || coalesce(right(c.from_e164, 4), 'unknown'), c.from_e164, 'Phone call', n.source, 'call', 'call',
      'Called the office at ' || n.e164 || ' (' || n.label || '). No texting consent.', cid, case when final = 'answered' then now() end)
    returning id into lid;
    perform record_consent(n.tenant_id, lid, 'Inbound call; no marketing consent.', '{}', '{}');
    perform log_event(n.tenant_id, 'lead.received', 'Call from ' || n.source, null, null);
  else
    insert into lead_events (tenant_id, lead_id, kind, data) values (n.tenant_id, lid, 'call', jsonb_build_object('call', c.id, 'status', final));
    if final = 'answered' then update leads set first_contact_at = coalesce(first_contact_at, now()) where id = lid; end if;
  end if;
  update calls set status = final, duration_s = coalesce(p_duration, 0), lead_id = lid where id = c.id;
  if final = 'missed' then
    insert into follow_ups (tenant_id, who, reason, due_on, due_at)
    values (n.tenant_id, 'Caller ' || pretty, 'Missed call to the ' || n.label || ' line: call back', today, to_char(now() at time zone tz, 'HH24:MI')::time);
  end if;
  return jsonb_build_object('call', c.id, 'lead', lid, 'status', final);
end $$;
revoke execute on function ingest_call(text, text, text, text, int, text, int) from public, anon, authenticated;
grant execute on function ingest_call(text, text, text, text, int, text, int) to service_role;

create or replace function book_lead(p_id uuid, p_when timestamptz, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare l leads;
begin
  select * into l from leads where id = p_id for update;
  if l.id is null or not (is_staff() or is_member(l.tenant_id)) then raise exception 'not allowed'; end if;
  if p_when is null then raise exception 'Pick a day and time.'; end if;
  update leads set status = 'booked', booked_for = p_when,
    first_contact_at = coalesce(l.first_contact_at, now()),
    note = coalesce(nullif(left(trim(coalesce(p_note, '')), 2000), ''), l.note), updated_by = auth.uid(), updated_at = now()
  where id = p_id;
  perform log_event(l.tenant_id, 'lead.booked', 'Consult ' || to_char(p_when at time zone tenant_tz(l.tenant_id), 'Mon DD HH12:MI AM'), jsonb_build_object('status', l.status), jsonb_build_object('status', 'booked'));
end $$;
revoke execute on function book_lead(uuid, timestamptz, text) from public, anon;
grant execute on function book_lead(uuid, timestamptz, text) to authenticated;

create or replace function request_review(p_lead uuid)
returns text language plpgsql security definer set search_path = public as $$
declare l leads; t tenants; place text; first text;
begin
  select * into l from leads where id = p_lead for update;
  if l.id is null or not (is_staff() or is_member(l.tenant_id)) then raise exception 'not allowed'; end if;
  if l.status <> 'won' then raise exception 'ask after they become a customer (mark the lead won first)'; end if;
  if l.review_requested_at is not null then raise exception 'already asked on %', to_char(l.review_requested_at at time zone tenant_tz(l.tenant_id), 'Mon DD'); end if;
  if l.email is null then raise exception 'this customer has no email on file'; end if;
  if length(coalesce(l.consent_text, '')) < 10 then raise exception 'no consent on file for this customer'; end if;
  select * into t from tenants where id = l.tenant_id;
  select google_place_id into place from agency_profiles where tenant_id = l.tenant_id;
  if place is null then raise exception 'add the office''s Google listing first (the Genovus team can)'; end if;
  first := split_part(trim(l.name), ' ', 1);
  if not t.is_sample then
    insert into outbox (tenant_id, to_email, template, data, dedupe_key)
    values (l.tenant_id, l.email, 'review_request', jsonb_build_object('agency', t.name, 'first', first, 'link', 'https://search.google.com/local/writereview?placeid=' || place), 'review:' || l.id)
    on conflict (dedupe_key) do nothing;
  end if;
  update leads set review_requested_at = now() where id = l.id;
  perform log_event(l.tenant_id, 'review.requested', l.name, null, null);
  return l.email;
end $$;
revoke all on function request_review(uuid) from public, anon;
grant execute on function request_review(uuid) to authenticated;
