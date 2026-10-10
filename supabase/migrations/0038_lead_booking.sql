-- A booked lead carries its consult time, so the pipeline and the agency calendar show when it is.
alter table leads add column if not exists booked_for timestamptz;
create index if not exists leads_booked on leads (tenant_id, booked_for) where booked_for is not null;

-- Book a consult for a lead (agency members and staff): moves it to Booked with the time.
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
  perform log_event(l.tenant_id, 'lead.booked', 'Consult ' || to_char(p_when at time zone 'America/New_York', 'Mon DD HH12:MI AM'), jsonb_build_object('status', l.status), jsonb_build_object('status', 'booked'));
end $$;
revoke execute on function book_lead(uuid, timestamptz, text) from public, anon;
grant execute on function book_lead(uuid, timestamptz, text) to authenticated;
