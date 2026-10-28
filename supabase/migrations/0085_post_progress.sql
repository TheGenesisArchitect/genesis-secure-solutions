-- Post progress: the agency hears when its posts go live, the team hears when one can't, and each post keeps its
-- own engagement.
--  * content_items gains Metricool's lasting post uuid (its id changes on every edit), the network's own post id,
--    when it went live, and its engagement (metrics, read from Metricool after it posts; null = not read yet).
--  * A post going live queues ONE email to the owners per slot (Facebook and Instagram at the same time share an
--    email: the second network's link joins the waiting email), sent ten minutes later, plus one push per network
--    to members' devices.
--  * A post Metricool refuses, or one approved too late for its time, alerts the Genovus team (once per post a day).

alter table content_items
  add column if not exists mc_uuid text,
  add column if not exists network_post_id text,
  add column if not exists published_at timestamptz,
  add column if not exists metrics jsonb,
  add column if not exists metrics_at timestamptz;

create index if not exists content_items_live on content_items (published_at) where status = 'published';

create or replace function on_post_progress() returns trigger language plpgsql security definer set search_path = public as $$
declare
  d jsonb;
  slot text;
  t tenants;
  net text := case new.channel when 'facebook' then 'Facebook' when 'instagram' then 'Instagram' else initcap(new.channel) end;
begin
  if new.is_sample then return new; end if;
  select * into t from tenants where id = new.tenant_id;

  if new.status = 'published' and old.status is distinct from 'published' then
    update content_items set published_at = coalesce(published_at, now()) where id = new.id;
    slot := to_char(coalesce(new.scheduled_for, now()) at time zone 'America/New_York', 'YYYY-MM-DD"T"HH24');
    d := jsonb_build_object('agency', t.name, 'slug', t.slug, 'networks', net, 'format', new.format,
      'copy', left(coalesce(new.copy, ''), 280), lower(net) || '_url', coalesce(new.post_url, ''));
    insert into outbox (tenant_id, to_email, template, data, dedupe_key, send_after)
    select new.tenant_id, u.email, 'post_live', d, 'postlive:' || new.tenant_id || ':' || coalesce(new.asset_id::text, new.id::text) || ':' || slot || ':' || u.id, now() + interval '10 minutes'
    from memberships m join auth.users u on u.id = m.user_id
    where m.tenant_id = new.tenant_id and m.role = 'owner' and u.email is not null
    on conflict (dedupe_key) do update
      set data = outbox.data || jsonb_build_object(lower(net) || '_url', coalesce(new.post_url, ''),
                   'networks', case when position(net in outbox.data->>'networks') > 0 then outbox.data->>'networks' else (outbox.data->>'networks') || ' and ' || net end)
      where outbox.status = 'pending';
    if exists (select 1 from push_subscriptions s join memberships m on m.user_id = s.user_id where m.tenant_id = new.tenant_id) then
      insert into outbox (tenant_id, to_email, template, data, dedupe_key)
      values (new.tenant_id, 'push', 'post_push', d || jsonb_build_object('item', new.id), 'push:post:' || new.id)
      on conflict (dedupe_key) do nothing;
    end if;
  end if;

  if new.mc_status in ('ERROR', 'NEEDS_TIME') and old.mc_status is distinct from new.mc_status then
    insert into outbox (tenant_id, to_email, template, data, dedupe_key)
    select new.tenant_id, e, 'team_post_issue',
      jsonb_build_object('agency', t.name, 'slug', t.slug, 'networks', net, 'format', new.format, 'status', new.mc_status,
        'error', left(coalesce(new.mc_error, ''), 300), 'when', to_char(new.scheduled_for at time zone 'America/New_York', 'Dy Mon DD, HH12:MI AM')),
      'postissue:' || new.id || ':' || new.mc_status || ':' || to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD') || ':' || e
    from team_emails(new.tenant_id) e
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists content_items_progress on content_items;
create trigger content_items_progress after update of status, mc_status on content_items
  for each row execute function on_post_progress();

revoke execute on function on_post_progress() from public, anon, authenticated;

-- The per-post engagement read keeps its own record of what answered, beside the account-level one.
alter table visibility_pulls drop constraint if exists visibility_pulls_source_check;
alter table visibility_pulls add constraint visibility_pulls_source_check check (source in ('metricool', 'metricool-posts'));

-- Posts already live before this: when they went live, so their engagement is read too (no alert: only status
-- and mc_status changes alert).
update content_items set published_at = least(coalesce(scheduled_for, now()), now()) where status = 'published' and published_at is null;
