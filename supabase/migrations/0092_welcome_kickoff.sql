-- The client's welcome page (app/app/[slug]/welcome): their kickoff, confirmed or moved by them in one tap.
-- The kickoff is the meeting on their calendar (or on the Genovus house calendar with one of their people invited)
-- whose title says "kickoff", however it was made (the console's Meetings panel or Helix). Moving it re-sends the
-- calendar invite (when one went out) and tells the team's phones; confirming tells the team.

alter table calendar_events add column if not exists confirmed_at timestamptz;
alter table calendar_events add column if not exists confirmed_by uuid references auth.users on delete set null;

create or replace function kickoff_event(p_tenant uuid)
returns calendar_events language plpgsql stable security definer set search_path = public as $$
declare ev calendar_events; house uuid; who text[];
begin
  if not (auth.role() = 'service_role' or is_staff() or is_member(p_tenant)) then raise exception 'not allowed'; end if;
  select id into house from tenants where slug = 'genovus';
  select coalesce(array_agg(lower(u.email)), '{}') into who from memberships m join auth.users u on u.id = m.user_id where m.tenant_id = p_tenant and u.email is not null;
  select * into ev from calendar_events e
   where e.status = 'scheduled' and e.ends_at > now() - interval '2 hours' and e.title ~* 'kick.?off'
     and (e.tenant_id = p_tenant or (e.tenant_id = house and e.attendees && who))
   order by e.starts_at limit 1;
  return ev;
end $$;
revoke all on function kickoff_event(uuid) from public, anon;
grant execute on function kickoff_event(uuid) to authenticated, service_role;

create or replace function confirm_kickoff(p_tenant uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare ev calendar_events; t tenants;
begin
  ev := kickoff_event(p_tenant);
  if ev.id is null then raise exception 'There’s no kickoff on the calendar yet.'; end if;
  select * into t from tenants where id = p_tenant;
  update calendar_events set confirmed_at = now(), confirmed_by = auth.uid() where id = ev.id;
  perform log_event(p_tenant, 'kickoff.confirmed', to_char(ev.starts_at at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM'), null, null);
  insert into outbox (to_email, template, data, dedupe_key)
  values ('push', 'team_push', jsonb_build_object(
    'title', 'Kickoff confirmed · ' || left(t.name, 60),
    'body', to_char(ev.starts_at at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM') || ' Eastern',
    'url', '/console/clients/' || t.slug, 'tag', 'kickoff-' || left(ev.id::text, 24)),
    'kickoff-confirm:' || ev.id || ':' || ev.sequence)
  on conflict (dedupe_key) do nothing;
  return ev.starts_at;
end $$;
revoke all on function confirm_kickoff(uuid) from public, anon;
grant execute on function confirm_kickoff(uuid) to authenticated;

-- A new time (the page offers only open team times; this checks the basics again): same length, the invite re-sent
-- to everyone on it when one went out, and the team told. Picking a time is also confirming it.
create or replace function move_kickoff(p_tenant uuid, p_start timestamptz)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare ev calendar_events; t tenants; len interval; a text; me text; my_name text; seq int;
begin
  ev := kickoff_event(p_tenant);
  if ev.id is null then raise exception 'There’s no kickoff on the calendar yet.'; end if;
  if p_start is null or p_start < now() + interval '2 hours' then raise exception 'Pick a time at least two hours from now.'; end if;
  if p_start > now() + interval '21 days' then raise exception 'Pick a time in the next three weeks.'; end if;
  if extract(minute from p_start) not in (0, 30) or extract(second from p_start) <> 0 then raise exception 'Pick one of the times offered.'; end if;
  if p_start = ev.starts_at then return ev.starts_at; end if;
  select * into t from tenants where id = p_tenant;
  len := ev.ends_at - ev.starts_at;
  seq := ev.sequence + 1;
  update calendar_events set starts_at = p_start, ends_at = p_start + len, sequence = seq, confirmed_at = now(), confirmed_by = auth.uid(),
    updated_by = auth.uid(), updated_at = now() where id = ev.id;
  -- The calendar invite follows the new time, from the team member who made the meeting.
  if ev.invited_at is not null and cardinality(ev.attendees) > 0 then
    select lower(u.email), coalesce(nullif(s.display_name, ''), 'Genovus') into me, my_name from auth.users u join staff s on s.user_id = u.id where u.id = ev.created_by;
    foreach a in array ev.attendees loop
      insert into outbox (tenant_id, to_email, template, data, dedupe_key)
      values (ev.tenant_id, a, 'meeting_invite', jsonb_build_object(
        'event', ev.id, 'title', ev.title, 'starts', p_start, 'ends', p_start + len, 'location', coalesce(ev.location, ''),
        'notes', coalesce(ev.notes, ''), 'attendees', array_to_string(ev.attendees, ','), 'sequence', seq::text,
        'status', 'scheduled', 'agency', t.name, 'slug', t.slug, 'from_email', coalesce(me, ''), 'from_name', coalesce(my_name, 'Genovus')),
        'invite:' || ev.id || ':' || seq || ':' || a)
      on conflict (dedupe_key) do nothing;
    end loop;
    update calendar_events set invited_at = now(), invited_sequence = seq where id = ev.id;
  end if;
  perform log_event(p_tenant, 'kickoff.moved', to_char(ev.starts_at at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM') || ' → ' || to_char(p_start at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM'), null, null);
  insert into outbox (to_email, template, data, dedupe_key)
  values ('push', 'team_push', jsonb_build_object(
    'title', 'Kickoff moved · ' || left(t.name, 60),
    'body', 'Now ' || to_char(p_start at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM') || ' Eastern',
    'url', '/console/clients/' || t.slug, 'tag', 'kickoff-' || left(ev.id::text, 24)),
    'kickoff-move:' || ev.id || ':' || seq)
  on conflict (dedupe_key) do nothing;
  return p_start;
end $$;
revoke all on function move_kickoff(uuid, timestamptz) from public, anon;
grant execute on function move_kickoff(uuid, timestamptz) to authenticated;
