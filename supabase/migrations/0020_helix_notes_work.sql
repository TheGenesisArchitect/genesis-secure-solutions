-- Helix notes become work items on the Enterprise dashboard: staff move them new → in progress → done (or
-- dismiss them), alongside the agent's draft states. Who is working a note is recorded.

alter table helix_notes drop constraint if exists helix_notes_status_check;
alter table helix_notes add constraint helix_notes_status_check
  check (status in ('new','handed_off','drafting','drafted','in_progress','done','accepted','dismissed','failed'));
alter table helix_notes add column if not exists worked_by uuid references auth.users on delete set null;

create or replace function set_helix_note_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare n helix_notes;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  if p_status not in ('new','in_progress','done','accepted','dismissed') then raise exception 'invalid status'; end if;
  select * into n from helix_notes where id = p_id for update;
  if n.id is null then raise exception 'note not found'; end if;
  update helix_notes set status = p_status, worked_by = case when p_status = 'new' then null else auth.uid() end, updated_at = now() where id = p_id;
  perform log_event((select id from tenants where slug = 'genovus'), 'helix.note.' || p_status, left(n.text, 80), jsonb_build_object('status', n.status), jsonb_build_object('status', p_status));
end $$;
grant execute on function set_helix_note_status(uuid, text) to authenticated;
