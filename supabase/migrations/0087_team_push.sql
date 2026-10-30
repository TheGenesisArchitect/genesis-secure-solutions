-- Speed to lead for Genovus itself: every new inquiry also queues one push alert to the team's devices (outbox
-- template team_push, sent by lib/push.ts sendTeamPush to admins and account leads), next to the team email.
create or replace function on_inquiry() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into outbox (to_email, template, data, dedupe_key)
  select e, 'team_inquiry', jsonb_build_object('org', new.org, 'name', new.name, 'kind', new.kind, 'inquiry', new.id), 'inquiry:' || new.id || ':' || e
  from team_emails(null) e on conflict (dedupe_key) do nothing;
  insert into outbox (to_email, template, data, dedupe_key)
  values ('push', 'team_push', jsonb_build_object(
    'title', 'New inquiry · ' || left(new.org, 60),
    'body', left(new.name, 60) || case when new.kind = 'carrier' then ' · carrier or network' else ' · agency' end || ' · reply while it’s fresh',
    'url', '/console/inquiries', 'tag', 'inquiry-' || left(new.id::text, 24)),
    'inquiry-push:' || new.id)
  on conflict (dedupe_key) do nothing;
  return new;
end $$;
