-- UnEdit on agency desks (lib/desk.ts): a campaign approved by the Genovus team does NOT go out. Its posts wait as
-- 'awaiting_owner' and one approval lands in the agency owner's Approvals; only the owner's Approve (decide_approval,
-- which already checks is_owner) moves them to 'queued', where the studio cron sends each at its time through the
-- agency's own Metricool brand (tenants.metricool_blog_id, never Genovus's). Changes requested take them off the
-- calendar and put the recording back in review. The Genovus house desk is unchanged.
alter table unedit_posts drop constraint if exists unedit_posts_status_check;
alter table unedit_posts add constraint unedit_posts_status_check check (status in ('queued', 'awaiting_owner', 'sent', 'posted', 'error', 'skipped', 'cancelled'));

alter table approvals add column if not exists unedit_vlog_id uuid references unedit_vlogs on delete set null;
create index if not exists approvals_unedit_vlog on approvals (unedit_vlog_id) where unedit_vlog_id is not null;

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
  -- An UnEdit campaign: the owner's yes puts its posts on the calendar (a time already too close moves to 20 minutes
  -- from now); changes requested take them off and send the recording back to review with the owner's note.
  if a.unedit_vlog_id is not null then
    if p_decision = 'approved' then
      update unedit_posts set status = 'queued', scheduled_at = greatest(coalesce(scheduled_at, now()), now() + interval '20 minutes')
        where vlog_id = a.unedit_vlog_id and tenant_id = a.tenant_id and status = 'awaiting_owner';
    else
      update unedit_posts set status = 'cancelled', mc_error = 'Owner asked for changes: ' || left(p_note, 300)
        where vlog_id = a.unedit_vlog_id and tenant_id = a.tenant_id and status = 'awaiting_owner';
      update unedit_vlogs set stage = 'review', stage_at = now(), approved_at = null, approved_by = null
        where id = a.unedit_vlog_id and tenant_id = a.tenant_id and stage = 'published';
      update unedit_clips set status = 'ready' where vlog_id = a.unedit_vlog_id and tenant_id = a.tenant_id and status = 'approved';
    end if;
  end if;
  perform log_event(a.tenant_id, 'approval.' || p_decision, a.title, jsonb_build_object('status', a.status), jsonb_build_object('status', p_decision, 'note', p_note));
end $$;

-- JAVA posts only to the networks connected on his Metricool brand (Facebook and Instagram); YouTube joins when it is
-- connected there (edit profile.networks).
update newsroom_settings set profile = profile || '{"networks":["instagram","facebook"]}'::jsonb
  where tenant_id = (select id from tenants where slug = 'mendez-hollis') and profile is not null and not (profile ? 'networks');
