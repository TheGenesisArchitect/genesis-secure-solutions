-- Helix's confirm lane (Step 8): Helix proposes a change ("mark Dana called?"), the person says yes or taps it, and the
-- change runs through the same functions as the buttons (update_lead, book_lead, add_follow_up). Every one of those
-- can be undone for a short while from the "Done · Undo" bar. These two functions are the undo, audited like the rest.

-- Put a lead back exactly as it was before Helix changed it (status, consult time, first contact), as long as nobody
-- has changed it since.
create or replace function helix_restore_lead(p_id uuid, p_expect_status text, p_status text, p_booked_for timestamptz, p_first_contact_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare l leads;
begin
  select * into l from leads where id = p_id for update;
  if l.id is null or not (is_staff() or is_member(l.tenant_id)) then raise exception 'not allowed'; end if;
  if l.status <> p_expect_status then raise exception 'This lead changed since; undo it by hand.'; end if;
  if p_status not in ('new','contacted','booked','won','lost') then raise exception 'invalid status'; end if;
  update leads set status = p_status, booked_for = p_booked_for, first_contact_at = p_first_contact_at, updated_by = auth.uid(), updated_at = now()
  where id = p_id;
  perform log_event(l.tenant_id, 'lead.undo', 'Helix change undone: back to ' || p_status, jsonb_build_object('status', l.status), jsonb_build_object('status', p_status));
end $$;
revoke execute on function helix_restore_lead(uuid, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function helix_restore_lead(uuid, text, text, timestamptz, timestamptz) to authenticated;

-- Take back a follow-up Helix just added for this person (only theirs, only within 15 minutes).
create or replace function helix_remove_follow_up(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare f follow_ups;
begin
  select * into f from follow_ups where id = p_id for update;
  if f.id is null or not (is_staff() or is_member(f.tenant_id)) then raise exception 'not allowed'; end if;
  if f.created_by is distinct from auth.uid() or f.created_at < now() - interval '15 minutes' then raise exception 'Too late to undo here; mark it done instead.'; end if;
  delete from follow_ups where id = p_id;
  perform log_event(f.tenant_id, 'follow_up.undo', 'Helix follow-up undone: ' || f.who, null, null);
end $$;
revoke execute on function helix_remove_follow_up(uuid) from public, anon;
grant execute on function helix_remove_follow_up(uuid) to authenticated;
