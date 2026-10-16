-- New-lead alerts on the phone (and desktop): each person turns them on per device. A device's push subscription is
-- theirs alone; a new lead queues one push for the agency (outbox template lead_push), which the minute's outbox run
-- sends to every subscribed device of that agency's members. Tapping it opens Today with that lead, ready to call.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique check (length(endpoint) between 10 and 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  device text check (device is null or length(device) <= 120),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures int not null default 0
);
create index if not exists push_subscriptions_user on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;
create policy r on push_subscriptions for select to authenticated using (user_id = auth.uid());

-- Turn alerts on for this device (or move a device to the signed-in person).
create or replace function push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if p_endpoint !~ '^https://' then raise exception 'not a push endpoint'; end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, device)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, nullif(left(coalesce(p_device, ''), 120), ''))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, failures = 0;
end $$;
revoke execute on function push_subscribe(text, text, text, text) from public, anon;
grant execute on function push_subscribe(text, text, text, text) to authenticated;

-- Turn alerts off for this device.
create or replace function push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke execute on function push_unsubscribe(text) from public, anon;
grant execute on function push_unsubscribe(text) to authenticated;

-- The new-lead alert (0064), now also one push for the agency when any member has alerts on.
create or replace function on_lead_new() returns trigger language plpgsql security definer set search_path = public as $$
declare t tenants; d jsonb; n int;
begin
  select * into t from tenants where id = new.tenant_id;
  if t.id is null or t.is_sample then return new; end if;
  d := jsonb_build_object('lead', new.id, 'name', new.name, 'phone', coalesce(new.phone, ''), 'email', coalesce(new.email, ''),
    'topic', coalesce(new.topic, ''), 'message', left(coalesce(new.message, ''), 400), 'source', new.source, 'channel', new.channel,
    'slug', t.slug, 'agency', t.name);
  insert into outbox (tenant_id, to_email, template, data, dedupe_key)
  select new.tenant_id, u.email, 'lead_new', d, 'lead:' || new.id || ':' || u.id
  from memberships m join auth.users u on u.id = m.user_id
  where m.tenant_id = new.tenant_id and m.role = 'owner' and u.email is not null
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    insert into outbox (tenant_id, to_email, template, data, dedupe_key)
    select new.tenant_id, e, 'lead_new', d || jsonb_build_object('team', 'true'), 'lead:' || new.id || ':team:' || e
    from team_emails(new.tenant_id) e
    on conflict (dedupe_key) do nothing;
  end if;
  if exists (select 1 from push_subscriptions s join memberships m on m.user_id = s.user_id where m.tenant_id = new.tenant_id) then
    insert into outbox (tenant_id, to_email, template, data, dedupe_key)
    values (new.tenant_id, 'push', 'lead_push', d, 'push:lead:' || new.id)
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end $$;
