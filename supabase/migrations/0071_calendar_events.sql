-- Calendar events: meetings that live on an agency's calendar in their own right (carrier setup with Genovus, a team
-- training, a partner lunch), beside the follow-ups, consults, posts and partner visits the calendar already shows.
-- Members and Genovus staff add, move and cancel them; Helix can too, only after the person's yes (lib/helix-act.ts).
-- Invites are outward: only Genovus staff queue them (send_event_invite), one email per attendee with the event
-- attached as a calendar invite, sent by the outbox run. Times are the office's (America/New_York).

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  title text not null check (length(title) between 1 and 160),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text check (location is null or length(location) <= 200),
  notes text check (notes is null or length(notes) <= 1000),
  attendees text[] not null default '{}' check (cardinality(attendees) <= 10),
  host text not null default 'agency' check (host in ('agency','genovus')),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  -- Bumped on every change, so a re-sent invite replaces the copy already on people's calendars.
  sequence int not null default 0,
  invited_at timestamptz,
  invited_sequence int,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '24 hours')
);
create index if not exists calendar_events_tenant_start on calendar_events (tenant_id, starts_at);
alter table calendar_events enable row level security;
create policy r on calendar_events for select to authenticated using (is_staff() or is_member(tenant_id));

-- "a@x.com, b@y.com" → a clean, de-duplicated list of addresses (at most ten).
create or replace function event_attendees(p text) returns text[] language plpgsql immutable set search_path = public as $$
declare a text; out text[] := '{}';
begin
  foreach a in array regexp_split_to_array(lower(coalesce(p, '')), '[\s,;]+') loop
    continue when a = '';
    if a !~ '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$' or length(a) > 200 then raise exception '% is not an email address', a; end if;
    if not a = any(out) then out := out || a; end if;
  end loop;
  if cardinality(out) > 10 then raise exception 'Up to ten people per invite.'; end if;
  return out;
end $$;

-- Office wall time (day + HH:MM) → an instant.
create or replace function office_time(p_day date, p_time text) returns timestamptz language sql immutable set search_path = public as $$
  select (p_day + p_time::time) at time zone 'America/New_York';
$$;

create or replace function add_event(p_tenant uuid, p_title text, p_day date, p_start text, p_end text, p_location text, p_notes text, p_attendees text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid; s timestamptz; e timestamptz;
begin
  if not (is_staff() or is_member(p_tenant)) then raise exception 'not allowed'; end if;
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'What is the event called?'; end if;
  if p_day is null or coalesce(p_start, '') !~ '^\d{2}:\d{2}$' then raise exception 'Pick a day and a start time.'; end if;
  s := office_time(p_day, p_start);
  e := case when coalesce(p_end, '') ~ '^\d{2}:\d{2}$' then office_time(p_day, p_end) else s + interval '1 hour' end;
  if e <= s then raise exception 'The end time is before the start.'; end if;
  insert into calendar_events (tenant_id, title, starts_at, ends_at, location, notes, attendees, host, created_by, updated_by)
  values (p_tenant, left(trim(p_title), 160), s, e, nullif(left(trim(coalesce(p_location, '')), 200), ''), nullif(left(trim(coalesce(p_notes, '')), 1000), ''),
    event_attendees(p_attendees), case when is_staff() and not is_member(p_tenant) then 'genovus' else 'agency' end, auth.uid(), auth.uid())
  returning id into nid;
  perform log_event(p_tenant, 'event.add', left(trim(p_title), 80) || ', ' || to_char(s at time zone 'America/New_York', 'Mon DD HH12:MI AM'), null, null);
  return nid;
end $$;

-- Move an event (a new day and/or times). Nulls keep what is there; the length is kept when only the start moves.
create or replace function move_event(p_id uuid, p_day date, p_start text, p_end text)
returns void language plpgsql security definer set search_path = public as $$
declare ev calendar_events; s timestamptz; e timestamptz; d date;
begin
  select * into ev from calendar_events where id = p_id for update;
  if ev.id is null or not (is_staff() or is_member(ev.tenant_id)) then raise exception 'not allowed'; end if;
  if ev.status = 'cancelled' then raise exception 'That event is cancelled.'; end if;
  d := coalesce(p_day, (ev.starts_at at time zone 'America/New_York')::date);
  s := office_time(d, coalesce(nullif(p_start, ''), to_char(ev.starts_at at time zone 'America/New_York', 'HH24:MI')));
  e := case when coalesce(p_end, '') ~ '^\d{2}:\d{2}$' then office_time(d, p_end) else s + (ev.ends_at - ev.starts_at) end;
  if e <= s then raise exception 'The end time is before the start.'; end if;
  update calendar_events set starts_at = s, ends_at = e, sequence = sequence + 1, updated_by = auth.uid(), updated_at = now() where id = p_id;
  perform log_event(ev.tenant_id, 'event.move', left(ev.title, 80) || ' → ' || to_char(s at time zone 'America/New_York', 'Mon DD HH12:MI AM'), null, null);
end $$;

create or replace function cancel_event(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ev calendar_events;
begin
  select * into ev from calendar_events where id = p_id for update;
  if ev.id is null or not (is_staff() or is_member(ev.tenant_id)) then raise exception 'not allowed'; end if;
  if ev.status = 'cancelled' then return; end if;
  update calendar_events set status = 'cancelled', sequence = sequence + 1, updated_by = auth.uid(), updated_at = now() where id = p_id;
  perform log_event(ev.tenant_id, 'event.cancel', left(ev.title, 80), null, null);
end $$;

-- Undo for Helix: remove an event it just added (never one already invited), or put back a move or a cancel.
create or replace function helix_remove_event(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ev calendar_events;
begin
  select * into ev from calendar_events where id = p_id for update;
  if ev.id is null or not (is_staff() or is_member(ev.tenant_id)) then raise exception 'not allowed'; end if;
  if ev.created_by is distinct from auth.uid() or ev.created_at < now() - interval '15 minutes' or ev.invited_at is not null then
    raise exception 'Too late to undo here; cancel the event instead.';
  end if;
  delete from calendar_events where id = p_id;
  perform log_event(ev.tenant_id, 'event.undo', 'Helix event undone: ' || left(ev.title, 80), null, null);
end $$;

create or replace function helix_restore_event(p_id uuid, p_expect_sequence int, p_starts timestamptz, p_ends timestamptz, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare ev calendar_events;
begin
  select * into ev from calendar_events where id = p_id for update;
  if ev.id is null or not (is_staff() or is_member(ev.tenant_id)) then raise exception 'not allowed'; end if;
  if ev.updated_by is distinct from auth.uid() or ev.updated_at < now() - interval '15 minutes' or ev.sequence <> p_expect_sequence then
    raise exception 'It changed since; edit it on the calendar instead.';
  end if;
  if p_status not in ('scheduled','cancelled') then raise exception 'invalid status'; end if;
  update calendar_events set starts_at = p_starts, ends_at = p_ends, status = p_status, sequence = sequence + 1, updated_at = now() where id = p_id;
  perform log_event(ev.tenant_id, 'event.undo', 'Helix change undone: ' || left(ev.title, 80), null, null);
end $$;

-- Send (or re-send) the invite: one outbox email per attendee, carrying the event as it is now. A cancelled event
-- sends the cancellation. Genovus staff only: an invite goes out in the team's name.
create or replace function send_event_invite(p_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare ev calendar_events; t tenants; a text; n int := 0; c int;
begin
  if not is_staff() then raise exception 'Only the Genovus team sends invites.'; end if;
  select * into ev from calendar_events where id = p_id for update;
  if ev.id is null then raise exception 'not found'; end if;
  if cardinality(ev.attendees) = 0 then raise exception 'Add at least one person to invite.'; end if;
  if ev.status = 'scheduled' and ev.ends_at < now() then raise exception 'That event is over.'; end if;
  if ev.status = 'cancelled' and ev.invited_at is null then raise exception 'Nobody was invited, so there is nothing to cancel.'; end if;
  select * into t from tenants where id = ev.tenant_id;
  foreach a in array ev.attendees loop
    insert into outbox (tenant_id, to_email, template, data, dedupe_key)
    values (ev.tenant_id, a, 'meeting_invite', jsonb_build_object(
      'event', ev.id, 'title', ev.title, 'starts', ev.starts_at, 'ends', ev.ends_at, 'location', coalesce(ev.location, ''),
      'notes', coalesce(ev.notes, ''), 'attendees', array_to_string(ev.attendees, ','), 'sequence', ev.sequence::text,
      'status', ev.status, 'agency', t.name, 'slug', t.slug),
      'invite:' || ev.id || ':' || ev.sequence || ':' || a)
    on conflict (dedupe_key) do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  update calendar_events set invited_at = now(), invited_sequence = ev.sequence where id = p_id;
  perform log_event(ev.tenant_id, case when ev.status = 'cancelled' then 'event.cancel_sent' else 'event.invite' end,
    left(ev.title, 80) || ' → ' || array_to_string(ev.attendees, ', '), null, null);
  return n;
end $$;

-- Who an invite goes to by default: the agency's owners plus the staff member sending it. Staff only.
create or replace function event_default_attendees(p_tenant uuid)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'not allowed'; end if;
  return (select string_agg(distinct lower(u.email), ', ') from auth.users u
    where u.email is not null and (u.id = auth.uid() or u.id in (select user_id from memberships where tenant_id = p_tenant and role = 'owner')));
end $$;
revoke execute on function event_default_attendees(uuid) from public, anon;
grant execute on function event_default_attendees(uuid) to authenticated;

revoke execute on function add_event(uuid, text, date, text, text, text, text, text), move_event(uuid, date, text, text), cancel_event(uuid),
  helix_remove_event(uuid), helix_restore_event(uuid, int, timestamptz, timestamptz, text), send_event_invite(uuid) from public, anon;
grant execute on function add_event(uuid, text, date, text, text, text, text, text), move_event(uuid, date, text, text), cancel_event(uuid),
  helix_remove_event(uuid), helix_restore_event(uuid, int, timestamptz, timestamptz, text), send_event_invite(uuid) to authenticated;
