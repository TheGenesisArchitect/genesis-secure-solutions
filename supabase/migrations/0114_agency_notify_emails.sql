-- Where an agency's emails go. Every notice to an agency's people (new lead, approval waiting, the morning brief,
-- reports, What's New) is queued to a member's sign-in email. Some owners sign in with a personal address but work
-- from their office inbox: tenants.notify_emails lists the inboxes in order, the first is the primary (To:), the
-- rest are copied (Cc:). Empty = unchanged (the sign-in email). Sign-in links and invites still go to the sign-in
-- email (they never pass through the outbox).
alter table tenants add column if not exists notify_emails text[] not null default '{}'
  check (cardinality(notify_emails) <= 5);

create or replace function outbox_notify_emails() returns trigger language plpgsql security definer set search_path = public as $$
declare list text[];
begin
  if new.tenant_id is null or new.to_email = 'push' then return new; end if;
  select notify_emails into list from tenants where id = new.tenant_id;
  if coalesce(cardinality(list), 0) = 0 then return new; end if;
  -- Only notices to the agency's own people; email to their customers is untouched.
  if not exists (select 1 from memberships m join auth.users u on u.id = m.user_id
                 where m.tenant_id = new.tenant_id and lower(u.email) = lower(new.to_email))
     and not (lower(new.to_email) = any (select lower(x) from unnest(list) x)) then
    return new;
  end if;
  new.data := coalesce(new.data, '{}'::jsonb) || jsonb_build_object('signin_email', new.to_email,
    'notify_cc', array_to_string(array(select x from unnest(list[2:]) x where lower(x) <> lower(list[1])), ','));
  new.to_email := list[1];
  return new;
end $$;

drop trigger if exists outbox_notify_emails on outbox;
create trigger outbox_notify_emails before insert on outbox for each row execute function outbox_notify_emails();

-- JAVA Agency: Mendez works from his GEICO inbox; his Gmail (his sign-in) gets a copy. Operator, 2026-11-17.
update tenants set notify_emails = array['menhollis@geico.com', 'dezhollis@gmail.com'] where slug = 'mendez-hollis';
