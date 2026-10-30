-- The kickoff is a meeting the Genovus team made (the console's Meetings panel or Helix for a team member, or one on
-- the house calendar), never an agency's own meeting that happens to say "kickoff" (their customers' meetings).
create or replace function kickoff_event(p_tenant uuid)
returns calendar_events language plpgsql stable security definer set search_path = public as $$
declare ev calendar_events; house uuid; who text[];
begin
  if not (auth.role() = 'service_role' or is_staff() or is_member(p_tenant)) then raise exception 'not allowed'; end if;
  select id into house from tenants where slug = 'genovus';
  select coalesce(array_agg(lower(u.email)), '{}') into who from memberships m join auth.users u on u.id = m.user_id where m.tenant_id = p_tenant and u.email is not null;
  select * into ev from calendar_events e
   where e.status = 'scheduled' and e.ends_at > now() - interval '2 hours' and e.title ~* 'kick.?off'
     and (e.host = 'genovus' or exists (select 1 from staff s where s.user_id = e.created_by))
     and (e.tenant_id = p_tenant or (e.tenant_id = house and e.attendees && who))
   order by e.starts_at limit 1;
  return ev;
end $$;
revoke all on function kickoff_event(uuid) from public, anon;
grant execute on function kickoff_event(uuid) to authenticated, service_role;
