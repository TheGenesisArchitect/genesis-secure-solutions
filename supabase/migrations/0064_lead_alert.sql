-- New-lead alert: every new lead (website callback, call, partner referral) queues an email to the agency's owners
-- through the outbox, so the agent knows to call within minutes without watching the dashboard. Genovus is the
-- system of record, so the agency's site doesn't need its own email setup for the agent to hear about a lead.
-- Sample agencies (the fictional demo tenant) never email anyone.
-- An agency with no owner signed up yet alerts the Genovus team (admins and its account lead) instead, so no lead
-- goes unseen while the agent's invite is pending.
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
  return new;
end $$;
drop trigger if exists lead_new on leads;
create trigger lead_new after insert on leads for each row execute function on_lead_new();
