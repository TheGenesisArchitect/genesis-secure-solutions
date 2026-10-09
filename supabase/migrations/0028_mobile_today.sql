-- Genovus Mobile "Today": an agency can star a follow-up as a priority. Members of the agency (or staff) only.
alter table follow_ups add column if not exists priority boolean not null default false;

create or replace function set_follow_up_priority(p_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare f follow_ups;
begin
  select * into f from follow_ups where id = p_id for update;
  if f.id is null or not (is_staff() or is_member(f.tenant_id)) then raise exception 'not allowed'; end if;
  update follow_ups set priority = coalesce(p_on, false) where id = p_id;
  perform log_event(f.tenant_id, 'follow_up.' || case when p_on then 'starred' else 'unstarred' end, 'Follow-up for ' || to_char(f.due_on, 'Mon DD'), null, null);
end $$;
grant execute on function set_follow_up_priority(uuid, boolean) to authenticated;
