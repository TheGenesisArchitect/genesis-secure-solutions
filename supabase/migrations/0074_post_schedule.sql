-- Posting schedule: a post carries its approved ad from the Library, the owner's approval moves the post itself,
-- and approved posts go out through the agency's own Metricool brand.
--  * content_items gains the ad (asset_id), its format (feed post or story) and Metricool tracking.
--  * approvals gains content_item_id: deciding a post's approval moves that post (approved / back to draft).
--  * tenants gains metricool_blog_id: each agency posts from its own brand, never Genovus's.
--  * propose_post (staff): one post plus the owner's approval, in one step, with an ad from that agency's Library only.

alter table content_items
  add column if not exists asset_id uuid references assets(id) on delete set null,
  add column if not exists format text not null default 'post' check (format in ('post', 'story')),
  add column if not exists mc_post_id bigint,
  add column if not exists mc_status text,
  add column if not exists mc_error text,
  add column if not exists mc_sent_at timestamptz,
  add column if not exists post_url text;

alter table approvals add column if not exists content_item_id uuid references content_items(id) on delete cascade;
create index if not exists approvals_content_item on approvals (content_item_id) where content_item_id is not null;

alter table tenants add column if not exists metricool_blog_id text check (metricool_blog_id ~ '^[0-9]{4,12}$');

-- Same rules as before (0004); a post's approval now also moves the post.
create or replace function decide_approval(p_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a approvals;
begin
  if p_decision not in ('approved','changes_requested') then raise exception 'bad decision'; end if;
  select * into a from approvals where id = p_id for update;
  if a.id is null then raise exception 'not found'; end if;
  if a.approver = 'client' and not is_owner(a.tenant_id) then raise exception 'only the agency owner can decide this'; end if;
  if a.approver = 'team' and not is_staff() then raise exception 'staff only'; end if;
  if a.approver = 'team' and a.lane = 'required' and not has_role('admin','reviewer') then raise exception 'a required approval needs a reviewer'; end if;
  if a.status <> 'pending' then raise exception 'already decided'; end if;
  if p_decision = 'changes_requested' and coalesce(trim(p_note), '') = '' then raise exception 'say what should change'; end if;
  update approvals set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = left(p_note, 2000) where id = p_id;
  if a.content_item_id is not null then
    update content_items set status = case when p_decision = 'approved' then 'approved' else 'draft' end
      where id = a.content_item_id and tenant_id = a.tenant_id and status in ('draft', 'in_review');
  end if;
  perform log_event(a.tenant_id, 'approval.' || p_decision, a.title, jsonb_build_object('status', a.status), jsonb_build_object('status', p_decision, 'note', p_note));
end $$;

-- Staff propose a post for the owner's yes. The ad must be an image in that agency's own Library (never another
-- agency's, never an internal file). Stories carry no caption on the networks, so the text is kept for the record.
create or replace function propose_post(p_tenant uuid, p_asset uuid, p_channel text, p_format text, p_copy text, p_when timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare ci uuid; a assets; label text;
begin
  if not has_role('admin','account_lead','operator') then raise exception 'not allowed to plan posts'; end if;
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
      jsonb_build_object('text', left(coalesce(trim(p_copy), ''), 2200), 'channel', initcap(p_channel), 'format', p_format,
        'asset_id', a.id, 'asset_title', a.title, 'when', to_char(p_when at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM')),
      'required', 'client', ci);
  perform log_event(p_tenant, 'post.proposed', label, null, jsonb_build_object('content_item', ci, 'asset', a.title, 'when', p_when));
  return ci;
end $$;

revoke all on function propose_post(uuid, uuid, text, text, text, timestamptz) from public;
grant execute on function propose_post(uuid, uuid, text, text, text, timestamptz) to authenticated;
