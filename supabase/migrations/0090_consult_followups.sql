-- Follow-up after a first consultation (Scale Up workbook pp. 19–20): a short sequence for people who showed and
-- haven't started, and for no-shows. Drafts are written from templates (data/consult-followups.ts); a person reads,
-- edits and sends each one (CLAUDE.md: people approve anything outward). The database is the authority on whether a
-- step may go: it stops for good once they're a client or paid a deposit, booked again, asked to stop, were closed,
-- or opted out, and each step goes once.
alter table consult_invites add column if not exists followups_stopped_at timestamptz;
alter table consult_invites add column if not exists followups_stop_reason text;

create table if not exists consult_followups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,      -- the Genovus house account
  invite_id uuid not null references consult_invites on delete cascade,
  step text not null check (step in ('s1', 's3', 's7', 's14', 'n0', 'n2', 'n7')),
  to_emails text[] not null,
  subject text not null check (length(subject) between 3 and 140),
  body text not null check (length(body) between 10 and 3000),
  sent_by uuid references auth.users on delete set null,
  sent_at timestamptz not null default now(),
  unique (invite_id, step)
);
alter table consult_followups enable row level security;
create policy r on consult_followups for select to authenticated using (is_staff());

-- Days after the call each step becomes due.
create or replace function followup_offset(p_step text) returns int language sql immutable as $$
  select case p_step when 's1' then 1 when 's3' then 3 when 's7' then 7 when 's14' then 14 when 'n0' then 0 when 'n2' then 2 when 'n7' then 7 end
$$;
revoke all on function followup_offset(text) from public, anon;

-- Why this consultation's follow-ups can't go (null: they can). Staff, or the server.
create or replace function consult_followup_block(p_invite uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare ci consult_invites; inq inquiries; pr prospects; ev calendar_events; tid uuid;
begin
  if not (is_staff() or coalesce(auth.role(), '') = 'service_role') then raise exception 'staff only'; end if;
  select * into ci from consult_invites where id = p_invite;
  if ci.id is null then return 'not found'; end if;
  if ci.followups_stopped_at is not null then return coalesce(ci.followups_stop_reason, 'Follow-ups were stopped.'); end if;
  if ci.inquiry_id is null and ci.prospect_id is null then return 'Only first consultations with a new agency get follow-ups.'; end if;
  select * into ev from calendar_events where id = ci.event_id;
  if ev.id is null or ci.booked_at is null then return 'They haven''t booked a time.'; end if;
  if ev.status = 'cancelled' then return 'The consultation was cancelled.'; end if;
  if ci.outcome is null then return 'Mark how the call went first.'; end if;
  if ci.outcome = 'rescheduled' then return 'It was rescheduled; follow up on the new time.'; end if;
  if ci.inquiry_id is not null then select * into inq from inquiries where id = ci.inquiry_id; end if;
  if ci.prospect_id is not null then select * into pr from prospects where id = ci.prospect_id; end if;
  tid := coalesce(inq.tenant_id, pr.tenant_id);
  if tid is not null then
    if exists (select 1 from invoices where tenant_id = tid and kind = 'deposit' and status = 'paid') then return 'Their deposit is paid.'; end if;
    return 'They''re a client now; onboarding takes it from here.';
  end if;
  if inq.status in ('converted', 'closed') then return 'The inquiry is ' || inq.status || '.'; end if;
  if pr.status in ('won', 'opted_out', 'closed', 'not_now') then return 'The prospect is marked ' || replace(pr.status, '_', ' ') || '.'; end if;
  if exists (select 1 from suppression where email = any(ci.emails)) then return 'They asked not to be contacted.'; end if;
  if exists (select 1 from consult_invites o where o.id <> ci.id and o.booked_at > ci.booked_at
             and (o.inquiry_id = ci.inquiry_id or o.prospect_id = ci.prospect_id or o.emails && ci.emails)) then return 'They booked another consultation.'; end if;
  return null;
end $$;
revoke all on function consult_followup_block(uuid) from public, anon;
grant execute on function consult_followup_block(uuid) to authenticated, service_role;

-- Send one step, as the person who read it: checked again here, once per step, never before it's due, never to a
-- suppressed address. The email itself goes out through the outbox (lib/email.ts consult_followup).
create or replace function send_consult_followup(p_invite uuid, p_step text, p_subject text, p_body text, p_data jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare ci consult_invites; why text; ends timestamptz; a text; n int := 0;
begin
  if not is_staff() then raise exception 'Only the Genovus team sends follow-ups.'; end if;
  select * into ci from consult_invites where id = p_invite for update;
  if ci.id is null then raise exception 'That consultation wasn''t found.'; end if;
  why := consult_followup_block(p_invite);
  if why is not null then raise exception '%', why; end if;
  if followup_offset(p_step) is null then raise exception 'Unknown follow-up step.'; end if;
  if (left(p_step, 1) = 's') <> (ci.outcome = 'showed') then raise exception 'That follow-up doesn''t match how the call went.'; end if;
  select ends_at into ends from calendar_events where id = ci.event_id;
  if ends + make_interval(days => followup_offset(p_step)) > now() + interval '2 hours' then raise exception 'That follow-up isn''t due yet.'; end if;
  if exists (select 1 from consult_followups where invite_id = ci.id and step = p_step) then raise exception 'That follow-up was already sent.'; end if;
  if p_subject ~* 'guarantee' or p_body ~* 'guarantee' then raise exception 'Genovus copy never says "guarantee".'; end if;
  insert into consult_followups (tenant_id, invite_id, step, to_emails, subject, body, sent_by)
  values (ci.tenant_id, ci.id, p_step, ci.emails, left(trim(p_subject), 140), left(trim(p_body), 3000), auth.uid());
  foreach a in array ci.emails loop
    continue when exists (select 1 from suppression where email = a);
    insert into outbox (tenant_id, to_email, template, data, dedupe_key)
    values (ci.tenant_id, a, 'consult_followup', coalesce(p_data, '{}'::jsonb) || jsonb_build_object('subject', left(trim(p_subject), 140), 'body', left(trim(p_body), 3000)),
      'followup:' || ci.id || ':' || p_step || ':' || a) on conflict (dedupe_key) do nothing;
    n := n + 1;
  end loop;
  perform log_event(ci.tenant_id, 'consult.followup', left(ci.label, 80) || ' · ' || p_step || ' → ' || array_to_string(ci.emails, ', '), null, null);
  return n;
end $$;
revoke all on function send_consult_followup(uuid, text, text, text, jsonb) from public, anon;
grant execute on function send_consult_followup(uuid, text, text, text, jsonb) to authenticated;

-- Stop: the team's button (staff) or the person's own link (the server, after checking the signed link). Asking to
-- stop also puts their address on the suppression list (checked by these follow-ups and the scanner's outreach).
create or replace function stop_consult_followups(p_invite uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare ci consult_invites; a text; theirs boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if not (is_staff() or theirs) then raise exception 'staff only'; end if;
  select * into ci from consult_invites where id = p_invite for update;
  if ci.id is null then raise exception 'not found'; end if;
  update consult_invites set followups_stopped_at = coalesce(followups_stopped_at, now()),
    followups_stop_reason = coalesce(followups_stop_reason, left(coalesce(nullif(trim(p_reason), ''), 'Stopped by the team.'), 200)) where id = ci.id;
  if theirs then
    foreach a in array ci.emails loop
      insert into suppression (email, reason) values (lower(a), 'asked to stop consultation follow-ups') on conflict (email) do nothing;
    end loop;
  end if;
  perform log_event(ci.tenant_id, 'consult.followups_stopped', left(ci.label, 80) || case when theirs then ' (they asked)' else '' end, null, null);
end $$;
revoke all on function stop_consult_followups(uuid, text) from public, anon;
grant execute on function stop_consult_followups(uuid, text) to authenticated, service_role;
