-- Turnkey, step 5 (Growth, complete): review requests and the monthly report.
--  * request_review: the office asks a customer it won for a Google review, by email, in one tap. Every customer is
--    asked the same way (no gating, no incentives), once per customer, only with the consent they gave, and only when
--    the office's own Google listing is known. Texting waits for A2P 10DLC.
--  * leads.review_requested_at: when the ask went out.
--  * Monthly reports are kpi_snapshots rows (written by the Genovus server on the 1st) and go to the owner after the
--    team approves them (lib/monthly-report.ts).

alter table leads add column if not exists review_requested_at timestamptz;

create or replace function request_review(p_lead uuid)
returns text language plpgsql security definer set search_path = public as $$
declare l leads; t tenants; place text; first text;
begin
  select * into l from leads where id = p_lead for update;
  if l.id is null or not (is_staff() or is_member(l.tenant_id)) then raise exception 'not allowed'; end if;
  if l.status <> 'won' then raise exception 'ask after they become a customer (mark the lead won first)'; end if;
  if l.review_requested_at is not null then raise exception 'already asked on %', to_char(l.review_requested_at at time zone 'America/New_York', 'Mon DD'); end if;
  if l.email is null then raise exception 'this customer has no email on file'; end if;
  if length(coalesce(l.consent_text, '')) < 10 then raise exception 'no consent on file for this customer'; end if;
  select * into t from tenants where id = l.tenant_id;
  select google_place_id into place from agency_profiles where tenant_id = l.tenant_id;
  if place is null then raise exception 'add the office''s Google listing first (the Genovus team can)'; end if;
  first := split_part(trim(l.name), ' ', 1);
  if not t.is_sample then
    insert into outbox (tenant_id, to_email, template, data, dedupe_key)
    values (l.tenant_id, l.email, 'review_request', jsonb_build_object('agency', t.name, 'first', first, 'link', 'https://search.google.com/local/writereview?placeid=' || place), 'review:' || l.id)
    on conflict (dedupe_key) do nothing;
  end if;
  update leads set review_requested_at = now() where id = l.id;
  perform log_event(l.tenant_id, 'review.requested', l.name, null, null);
  return l.email;
end $$;
revoke all on function request_review(uuid) from public, anon;
grant execute on function request_review(uuid) to authenticated;
