-- Pick-a-time consultations: the team sends a private link (lib/consult.ts); the client picks one of the Genovus
-- calendar's open times; the session lands on the Genovus calendar and the meeting invite (with the .ics) goes to
-- everyone on the invitation plus the team member who sent it. One booking per link; links expire after 14 days.

create table if not exists consult_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,     -- the Genovus house account (whose calendar)
  label text not null check (length(label) between 2 and 120),       -- who it's for: "Tyson Barrett, Barrett Insurance"
  emails text[] not null check (cardinality(emails) between 1 and 6),
  minutes int not null default 60 check (minutes in (30, 45, 60, 90)),
  prospect_id uuid references prospects on delete set null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  event_id uuid references calendar_events on delete set null,
  booked_at timestamptz
);
alter table consult_invites enable row level security;
create policy r on consult_invites for select to authenticated using (is_staff());

create or replace function create_consult_invite(p_label text, p_emails text, p_minutes int, p_prospect uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare house uuid; em text[]; nid uuid;
begin
  if not is_staff() then raise exception 'Only the Genovus team sends consultation links.'; end if;
  select id into house from tenants where slug = 'genovus';
  if house is null then raise exception 'The Genovus house account is missing.'; end if;
  em := event_attendees(p_emails);
  if cardinality(em) = 0 then raise exception 'Add at least one email.'; end if;
  if cardinality(em) > 6 then raise exception 'Up to six people per invitation.'; end if;
  insert into consult_invites (tenant_id, label, emails, minutes, prospect_id, created_by)
  values (house, left(trim(p_label), 120), em, coalesce(p_minutes, 60), p_prospect, auth.uid()) returning id into nid;
  perform log_event(house, 'consult.invite', left(trim(p_label), 80) || ' → ' || array_to_string(em, ', '), null, null);
  return nid;
end $$;
revoke all on function create_consult_invite(text, text, int, uuid) from public, anon;
grant execute on function create_consult_invite(text, text, int, uuid) to authenticated;

-- The client's pick (server only, from the private link): the event on the Genovus calendar and the invite to all.
create or replace function book_consult(p_invite uuid, p_start timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare ci consult_invites; ev uuid; who text[]; me text; my_name text; a text; t tenants;
begin
  select * into ci from consult_invites where id = p_invite for update;
  if ci.id is null then raise exception 'not found'; end if;
  if ci.booked_at is not null then raise exception 'already booked'; end if;
  if ci.expires_at < now() then raise exception 'expired'; end if;
  if p_start < now() + interval '1 hour' or p_start > now() + interval '30 days' then raise exception 'pick another time'; end if;
  if exists (select 1 from calendar_events where tenant_id = ci.tenant_id and status = 'scheduled'
             and starts_at < p_start + make_interval(mins => ci.minutes) and ends_at > p_start) then raise exception 'taken'; end if;
  select lower(u.email), coalesce(nullif(s.display_name, ''), 'Genovus') into me, my_name from auth.users u left join staff s on s.user_id = u.id where u.id = ci.created_by;
  who := ci.emails || case when me is not null and not (me = any(ci.emails)) then array[me] else '{}'::text[] end;
  insert into calendar_events (tenant_id, title, starts_at, ends_at, location, notes, attendees, host, created_by)
  values (ci.tenant_id, left('Genovus consultation: ' || ci.label, 160), p_start, p_start + make_interval(mins => ci.minutes),
    'Video call (link to follow)', 'Booked from the Genovus pick-a-time link.', who, 'genovus', ci.created_by) returning id into ev;
  select * into t from tenants where id = ci.tenant_id;
  foreach a in array who loop
    insert into outbox (tenant_id, to_email, template, data, dedupe_key)
    values (ci.tenant_id, a, 'meeting_invite', jsonb_build_object(
      'event', ev, 'title', 'Genovus consultation: ' || ci.label, 'starts', p_start, 'ends', p_start + make_interval(mins => ci.minutes),
      'location', 'Video call (link to follow)', 'notes', 'Booked from the Genovus pick-a-time link.', 'attendees', array_to_string(who, ','),
      'sequence', '0', 'status', 'scheduled', 'agency', t.name, 'slug', t.slug, 'from_email', coalesce(me, ''), 'from_name', coalesce(my_name, 'Genovus')),
      'invite:' || ev || ':0:' || a)
    on conflict (dedupe_key) do nothing;
  end loop;
  update calendar_events set invited_at = now(), invited_sequence = 0 where id = ev;
  update consult_invites set event_id = ev, booked_at = now() where id = ci.id;
  perform log_auto(ci.tenant_id, 'consult.booked', left(ci.label, 80) || ' at ' || to_char(p_start at time zone 'America/New_York', 'Mon DD HH12:MI AM'), null, null);
  return ev;
end $$;
revoke all on function book_consult(uuid, timestamptz) from public, anon, authenticated;
grant execute on function book_consult(uuid, timestamptz) to service_role;
