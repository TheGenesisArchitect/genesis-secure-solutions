-- Consultation follow-ups (0090) are for website bookings only, and stop for anyone who is already a client by any
-- route (an agency membership with their email), not only through the inquiry or prospect record.
create or replace function consult_followup_block(p_invite uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare ci consult_invites; inq inquiries; pr prospects; ev calendar_events; tid uuid;
begin
  if not (is_staff() or coalesce(auth.role(), '') = 'service_role') then raise exception 'staff only'; end if;
  select * into ci from consult_invites where id = p_invite;
  if ci.id is null then return 'not found'; end if;
  if ci.followups_stopped_at is not null then return coalesce(ci.followups_stop_reason, 'Follow-ups were stopped.'); end if;
  -- Website bookings only: the same line as the booking page's first-call wording (lib/consult.ts firstCall). Links the
  -- team sends (prospects, onboarding calls with clients) never get a sales follow-up.
  if ci.inquiry_id is null then return 'Only first consultations booked on genovus.io get follow-ups.'; end if;
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
  -- A client already, however they got there: someone on the invite signs in to an agency on Genovus.
  if exists (select 1 from memberships m join auth.users u on u.id = m.user_id join tenants t on t.id = m.tenant_id
             where t.kind = 'agency' and lower(u.email) = any(ci.emails)) then return 'They''re a client now; onboarding takes it from here.'; end if;
  if inq.status in ('converted', 'closed') then return 'The inquiry is ' || inq.status || '.'; end if;
  if pr.status in ('won', 'opted_out', 'closed', 'not_now') then return 'The prospect is marked ' || replace(pr.status, '_', ' ') || '.'; end if;
  if exists (select 1 from suppression where email = any(ci.emails)) then return 'They asked not to be contacted.'; end if;
  if exists (select 1 from consult_invites o where o.id <> ci.id and o.booked_at > ci.booked_at
             and (o.inquiry_id = ci.inquiry_id or o.prospect_id = ci.prospect_id or o.emails && ci.emails)) then return 'They booked another consultation.'; end if;
  return null;
end $$;
revoke all on function consult_followup_block(uuid) from public, anon;
grant execute on function consult_followup_block(uuid) to authenticated, service_role;
