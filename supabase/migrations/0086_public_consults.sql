-- Book a consultation from genovus.io: a prospect fills the short form (lib/intake.ts) and goes straight to the
-- open times. Those invitations come from the website rather than a team member, so they carry the inquiry and,
-- when booked, the team is invited too (app_settings consult_team_emails, else every admin). Every booking gets the
-- standing video room when one is set (app_settings consult_video_url).

alter table consult_invites add column if not exists inquiry_id uuid references inquiries on delete set null;
create index if not exists consult_invites_inquiry on consult_invites (inquiry_id);

-- The website's invitation (server only, after the intake checks): 30 minutes, one email, the house calendar.
create or replace function create_public_consult(p_inquiry uuid, p_label text, p_email text, p_prospect uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare house uuid; em text[]; nid uuid;
begin
  select id into house from tenants where slug = 'genovus';
  if house is null then raise exception 'The Genovus house account is missing.'; end if;
  em := event_attendees(p_email);
  if cardinality(em) <> 1 then raise exception 'One valid email.'; end if;
  insert into consult_invites (tenant_id, label, emails, minutes, prospect_id, inquiry_id, created_by, expires_at)
  values (house, left(trim(p_label), 120), em, 30, p_prospect, p_inquiry, null, now() + interval '14 days') returning id into nid;
  return nid;
end $$;
revoke all on function create_public_consult(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function create_public_consult(uuid, text, text, uuid) to service_role;

-- The pick, as 0084, plus: the team on website bookings, the standing video room, and the inquiry marked contacted.
create or replace function book_consult(p_invite uuid, p_start timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare ci consult_invites; ev uuid; who text[]; me text; my_name text; a text; t tenants; place text; team text[]; note text;
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
  if ci.created_by is null then
    select event_attendees(value) into team from app_settings where key = 'consult_team_emails';
    if coalesce(cardinality(team), 0) = 0 then
      select coalesce(array_agg(distinct lower(u.email)), '{}') into team from staff s join auth.users u on u.id = s.user_id where s.role = 'admin' and u.email is not null;
    end if;
    who := who || array(select x from unnest(team) x where not (x = any(who)));
    if me is null and cardinality(team) > 0 then me := team[1]; end if;
  end if;
  select nullif(trim(value), '') into place from app_settings where key = 'consult_video_url';
  place := coalesce(place, 'Video call (link to follow)');
  note := case when ci.inquiry_id is not null then 'Booked on genovus.io: a first conversation about their agency.' else 'Booked from the Genovus pick-a-time link.' end;
  insert into calendar_events (tenant_id, title, starts_at, ends_at, location, notes, attendees, host, created_by)
  values (ci.tenant_id, left('Genovus consultation: ' || ci.label, 160), p_start, p_start + make_interval(mins => ci.minutes),
    place, note, who, 'genovus', ci.created_by) returning id into ev;
  select * into t from tenants where id = ci.tenant_id;
  foreach a in array who loop
    insert into outbox (tenant_id, to_email, template, data, dedupe_key)
    values (ci.tenant_id, a, 'meeting_invite', jsonb_build_object(
      'event', ev, 'title', 'Genovus consultation: ' || ci.label, 'starts', p_start, 'ends', p_start + make_interval(mins => ci.minutes),
      'location', place, 'notes', note, 'attendees', array_to_string(who, ','),
      'sequence', '0', 'status', 'scheduled', 'agency', t.name, 'slug', t.slug, 'from_email', coalesce(me, ''), 'from_name', coalesce(my_name, 'Genovus')),
      'invite:' || ev || ':0:' || a)
    on conflict (dedupe_key) do nothing;
  end loop;
  update calendar_events set invited_at = now(), invited_sequence = 0 where id = ev;
  update consult_invites set event_id = ev, booked_at = now() where id = ci.id;
  if ci.inquiry_id is not null then update inquiries set status = 'contacted' where id = ci.inquiry_id and status = 'new'; end if;
  perform log_auto(ci.tenant_id, 'consult.booked', left(ci.label, 80) || ' at ' || to_char(p_start at time zone 'America/New_York', 'Mon DD HH12:MI AM'), null, null);
  return ev;
end $$;
revoke all on function book_consult(uuid, timestamptz) from public, anon, authenticated;
grant execute on function book_consult(uuid, timestamptz) to service_role;
