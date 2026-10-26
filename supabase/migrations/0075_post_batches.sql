-- A month of posts lands on the owner's Approvals as one batch with ONE email ("22 posts ready for your approval"),
-- not one email per post. Each post still has its own approval; only the notice is combined.
--  * plan_post_row: the shared checks and inserts behind propose_post (one post) and plan_post_batch (many).
--  * on_approval_pending skips approvals that belong to a batch; the batch sends its own single notice.
--  * plan_post_batch is for the Genovus team's server (service role) only.

create or replace function plan_post_row(p_tenant uuid, p_asset uuid, p_channel text, p_format text, p_copy text, p_when timestamptz, p_batch text)
returns uuid language plpgsql security definer set search_path = public as $$
declare ci uuid; a assets; label text;
begin
  if p_channel not in ('facebook','instagram','google') then raise exception 'channel must be facebook, instagram or google'; end if;
  if p_format not in ('post','story') then raise exception 'format must be post or story'; end if;
  if p_format = 'story' and p_channel = 'google' then raise exception 'Google has no stories'; end if;
  if p_when is null or p_when < now() + interval '15 minutes' then raise exception 'pick a time at least 15 minutes ahead'; end if;
  if p_format = 'post' and coalesce(trim(p_copy), '') = '' then raise exception 'a feed post needs a caption'; end if;
  select * into a from assets where id = p_asset;
  if a.id is null or a.tenant_id <> p_tenant or a.kind <> 'image' or a.audience = 'internal' then raise exception 'pick an image from this agency''s Library'; end if;
  insert into content_items (tenant_id, channel, copy, status, scheduled_for, asset_id, format)
    values (p_tenant, p_channel, left(coalesce(trim(p_copy), ''), 2200), 'in_review', p_when, p_asset, p_format) returning id into ci;
  label := initcap(p_channel) || case when p_format = 'story' then ' story' else ' post' end;
  insert into approvals (tenant_id, subject_kind, title, body, lane, approver, content_item_id)
    values (p_tenant, 'post', label || ': ' || a.title,
      jsonb_strip_nulls(jsonb_build_object('text', left(coalesce(trim(p_copy), ''), 2200), 'channel', initcap(p_channel), 'format', p_format,
        'asset_id', a.id, 'asset_title', a.title, 'when', to_char(p_when at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM'), 'batch', p_batch)),
      'required', 'client', ci);
  perform log_event(p_tenant, 'post.proposed', label, null, jsonb_strip_nulls(jsonb_build_object('content_item', ci, 'asset', a.title, 'when', p_when, 'batch', p_batch)));
  return ci;
end $$;

create or replace function propose_post(p_tenant uuid, p_asset uuid, p_channel text, p_format text, p_copy text, p_when timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not has_role('admin','account_lead','operator') then raise exception 'not allowed to plan posts'; end if;
  return plan_post_row(p_tenant, p_asset, p_channel, p_format, p_copy, p_when, null);
end $$;

-- p_posts: [{asset, channel, format, copy, when}]. All or nothing; one email to the owner(s) for the whole batch.
create or replace function plan_post_batch(p_tenant uuid, p_posts jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare p jsonb; n int := 0; batch text := gen_random_uuid()::text; nets text;
begin
  if jsonb_typeof(p_posts) <> 'array' or jsonb_array_length(p_posts) = 0 then raise exception 'no posts'; end if;
  if jsonb_array_length(p_posts) > 60 then raise exception 'at most 60 posts at a time'; end if;
  for p in select * from jsonb_array_elements(p_posts) loop
    perform plan_post_row(p_tenant, (p->>'asset')::uuid, p->>'channel', coalesce(p->>'format', 'post'), p->>'copy', (p->>'when')::timestamptz, batch);
    n := n + 1;
  end loop;
  select string_agg(distinct initcap(x->>'channel'), ' and ') into nets from jsonb_array_elements(p_posts) x;
  insert into outbox (tenant_id, to_email, template, data, dedupe_key)
  select p_tenant, u.email, 'approval_waiting', jsonb_build_object('title', n || ' posts for ' || nets, 'count', n, 'slug', t.slug, 'agency', t.name),
         'approval-batch:' || batch || ':' || u.id
  from memberships m join auth.users u on u.id = m.user_id join tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant and m.role = 'owner' and u.email is not null and not t.is_sample
  on conflict (dedupe_key) do nothing;
  return n;
end $$;

-- Same notice as before (0004), except approvals that belong to a batch: the batch sent one notice for all of them.
create or replace function on_approval_pending() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'pending' or new.is_sample or new.approver <> 'client' or new.body ? 'batch' then return new; end if;
  insert into outbox (tenant_id, to_email, template, data, dedupe_key)
  select new.tenant_id, u.email, 'approval_waiting', jsonb_build_object('title', new.title, 'approval', new.id, 'slug', t.slug, 'agency', t.name),
         'approval:' || new.id || ':' || u.id
  from memberships m join auth.users u on u.id = m.user_id join tenants t on t.id = m.tenant_id
  where m.tenant_id = new.tenant_id and m.role = 'owner' and u.email is not null
  on conflict (dedupe_key) do nothing;
  return new;
end $$;

revoke all on function plan_post_row(uuid, uuid, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function plan_post_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function plan_post_batch(uuid, jsonb) to service_role;
grant execute on function plan_post_row(uuid, uuid, text, text, text, timestamptz, text) to service_role;
