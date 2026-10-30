-- How each booked consultation went (Scale Up workbook: show rate and close rate are tracked weekly). The team taps
-- Showed / No-show / Rescheduled on the Command Brief card after the call; /console/growth turns it into the sales
-- funnel (booked → shown → closed, cost per booked call).
alter table consult_invites add column if not exists outcome text check (outcome in ('showed', 'no_show', 'rescheduled'));
alter table consult_invites add column if not exists outcome_at timestamptz;
alter table consult_invites add column if not exists outcome_by uuid references auth.users on delete set null;

create or replace function set_consult_outcome(p_invite uuid, p_outcome text)
returns void language plpgsql security definer set search_path = public as $$
declare ci consult_invites;
begin
  if not is_staff() then raise exception 'Only the Genovus team records consultations.'; end if;
  if p_outcome not in ('showed', 'no_show', 'rescheduled') then raise exception 'Pick showed, no-show or rescheduled.'; end if;
  select * into ci from consult_invites where id = p_invite for update;
  if ci.id is null or ci.booked_at is null then raise exception 'That consultation isn''t booked.'; end if;
  update consult_invites set outcome = p_outcome, outcome_at = now(), outcome_by = auth.uid() where id = ci.id;
  perform log_event(ci.tenant_id, 'consult.outcome', left(ci.label, 80) || ' → ' || replace(p_outcome, '_', '-'), null, null);
end $$;
revoke all on function set_consult_outcome(uuid, text) from public, anon;
grant execute on function set_consult_outcome(uuid, text) to authenticated;
