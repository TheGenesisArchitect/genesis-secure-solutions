-- Agency desks, slice 5-6: the agency's look on its clips, and alerts on the owner's phone.
-- 1. JAVA's crest and colors (lib/desk.ts profile.brand): Unedit Pro puts the crest in the corner of every clip, his
--    colors on the captions, and an end card "JAVA Agency LLC · A GEICO Exclusive Agency" (never Genovus's look).
-- 2. A campaign waiting for the owner's approval already emails the owners (approval_waiting); it now also alerts
--    every device where an agency member turned alerts on (approval_push), tap to open Approvals.
-- 3. The morning brief's email and alert (agency_brief, brief_push) are queued by the newsroom cron, only while
--    newsroom_settings.brief_on is true (off until the operator approves a preview).
update newsroom_settings set profile = profile || jsonb_build_object('brand', jsonb_build_object(
    'mark', '/brand/agencies/mendez-hollis/crest-white.png', 'markDark', '/brand/agencies/mendez-hollis/crest-navy.png',
    'navy', '#071d43', 'accent', '#acd137', 'said', '#d9ec9a'))
  where tenant_id = (select id from tenants where slug = 'mendez-hollis') and profile is not null and not (profile ? 'brand');

create or replace function on_approval_pending() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'pending' or new.is_sample or new.approver <> 'client' or new.body ? 'batch' then return new; end if;
  insert into outbox (tenant_id, to_email, template, data, dedupe_key)
  select new.tenant_id, u.email, 'approval_waiting', jsonb_build_object('title', new.title, 'approval', new.id, 'slug', t.slug, 'agency', t.name),
         'approval:' || new.id || ':' || u.id
  from memberships m join auth.users u on u.id = m.user_id join tenants t on t.id = m.tenant_id
  where m.tenant_id = new.tenant_id and m.role = 'owner' and u.email is not null
  on conflict (dedupe_key) do nothing;
  -- The same notice on the phone, when anyone at the agency has alerts on.
  if exists (select 1 from push_subscriptions s join memberships m on m.user_id = s.user_id where m.tenant_id = new.tenant_id) then
    insert into outbox (tenant_id, to_email, template, data, dedupe_key)
    select new.tenant_id, 'push', 'approval_push',
           jsonb_build_object('title', 'Ready for your approval', 'body', left(new.title, 120) || '. Nothing posts until you approve it.',
                              'url', '/app/' || t.slug || '/approvals', 'slug', t.slug, 'tag', 'approval-' || left(new.id::text, 18)),
           'approval-push:' || new.id
    from tenants t where t.id = new.tenant_id
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end $$;
