-- Follow-ups: an agency's own reminders (who to get back to, why, and when), private to that agency. The office
-- adds one in seconds after a call or a visit; Genovus lines them up by day so tomorrow's list is ready the night
-- before. Reminders only: nothing is sent to the customer from here.

create table if not exists follow_ups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  who text not null check (length(who) between 1 and 120),
  reason text check (reason is null or length(reason) <= 300),
  due_on date not null,
  due_at time,
  status text not null default 'open' check (status in ('open','done')),
  created_by uuid references auth.users on delete set null,
  done_by uuid references auth.users on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists follow_ups_due on follow_ups (tenant_id, status, due_on, due_at);
alter table follow_ups enable row level security;
create policy r on follow_ups for select to authenticated using (is_staff() or is_member(tenant_id));

create or replace function add_follow_up(p_tenant uuid, p_who text, p_reason text, p_due date, p_at text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not (is_staff() or is_member(p_tenant)) then raise exception 'not allowed'; end if;
  if length(trim(coalesce(p_who, ''))) = 0 then raise exception 'Who is this follow-up with?'; end if;
  if p_due is null then raise exception 'Pick a day.'; end if;
  insert into follow_ups (tenant_id, who, reason, due_on, due_at, created_by)
  values (p_tenant, left(trim(p_who), 120), nullif(left(trim(coalesce(p_reason, '')), 300), ''), p_due, nullif(p_at, '')::time, auth.uid())
  returning id into nid;
  perform log_event(p_tenant, 'follow_up.add', 'Follow-up for ' || to_char(p_due, 'Mon DD'), null, null);
  return nid;
end $$;

-- Done, reopen, or move to another day.
create or replace function update_follow_up(p_id uuid, p_status text, p_due date)
returns void language plpgsql security definer set search_path = public as $$
declare f follow_ups;
begin
  select * into f from follow_ups where id = p_id for update;
  if f.id is null or not (is_staff() or is_member(f.tenant_id)) then raise exception 'not allowed'; end if;
  if p_status not in ('open','done') then raise exception 'invalid status'; end if;
  update follow_ups set status = p_status, due_on = coalesce(p_due, f.due_on),
    done_by = case when p_status = 'done' then auth.uid() end, done_at = case when p_status = 'done' then now() end
  where id = p_id;
  perform log_event(f.tenant_id, 'follow_up.' || case when p_status = 'done' then 'done' when p_due is not null and p_due <> f.due_on then 'moved' else 'reopen' end,
    'Follow-up for ' || to_char(coalesce(p_due, f.due_on), 'Mon DD'), null, null);
end $$;

grant execute on function add_follow_up(uuid, text, text, date, text), update_follow_up(uuid, text, date) to authenticated;
