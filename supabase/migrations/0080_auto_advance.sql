-- Turnkey, step 1: the launch checks move the stage. Forward only, from the expected stage, recorded as automatic.
--  * Proposal sent (tenants.proposal_sent_at)                                   consult/propose -> deposit
--  * Deposit invoice paid                                                       consult/propose/deposit -> intake
--    (and the client's plan becomes the package on their record: the plan changes when the invoice is paid)
--  * Intake checklist done (tenants.checklist_done_at) + photo rights and kickoff cleared or waived   intake -> build
-- Build -> review and review -> care stay with a person (the "ready for review" tap, start_care's gate check).
-- Runs from triggers, so it works for the Mercury sync (service role) and for a person's tap alike.

alter table tenants
  add column if not exists proposal_sent_at timestamptz,
  add column if not exists checklist_done_at timestamptz;

create or replace function log_auto(p_tenant uuid, p_action text, p_subject text, p_before jsonb, p_after jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_events (tenant_id, actor, actor_label, action, subject, before, after, prev_hash, hash)
  values (p_tenant, null, 'Genovus (automatic)', p_action, p_subject, p_before, p_after, '', '')
$$;

create or replace function auto_advance(p_tenant uuid)
returns text language plpgsql security definer set search_path = public as $$
declare t tenants; nxt lifecycle_stage; why text; moved text;
begin
  for i in 1..4 loop
    select * into t from tenants where id = p_tenant for update;
    if t.id is null or t.kind <> 'agency' then return moved; end if;
    nxt := null;
    if t.stage in ('consult', 'propose') and t.proposal_sent_at is not null
       and not exists (select 1 from invoices where tenant_id = t.id and kind = 'deposit' and status = 'paid') then
      nxt := 'deposit'; why := 'Proposal and deposit sent';
    elsif t.stage in ('consult', 'propose', 'deposit') and exists (select 1 from invoices where tenant_id = t.id and kind = 'deposit' and status = 'paid') then
      nxt := 'intake'; why := 'Deposit paid';
    elsif t.stage = 'intake' and t.checklist_done_at is not null
       and not exists (select 1 from gates where tenant_id = t.id and kind in ('photo_rights', 'kickoff') and status not in ('cleared', 'waived')) then
      nxt := 'build'; why := 'Checklist done, photo rights and kickoff cleared';
    end if;
    exit when nxt is null;
    update tenants set stage = nxt, stage_since = now() where id = t.id;
    insert into lifecycle_events (tenant_id, from_stage, to_stage, note, actor) values (t.id, t.stage, nxt, 'Automatic: ' || why, null);
    perform log_auto(t.id, 'stage.auto', 'tenant', jsonb_build_object('stage', t.stage), jsonb_build_object('stage', nxt, 'why', why));
    moved := nxt;
  end loop;
  return moved;
end $$;

-- A paid deposit: the plan becomes the package the client chose (never lower than it is), then the stage moves.
create or replace function on_deposit_paid() returns trigger language plpgsql security definer set search_path = public as $$
declare pkg text; cur text;
begin
  if new.kind <> 'deposit' or new.status <> 'paid' or old.status = 'paid' then return new; end if;
  select data->>'package' into pkg from agent_records where tenant_id = new.tenant_id and is_current;
  select plan into cur from tenants where id = new.tenant_id;
  if pkg in ('launch', 'growth', 'premium')
     and coalesce(array_position(array['vip','launch','growth','premium'], cur), 0) < array_position(array['vip','launch','growth','premium'], pkg) then
    update tenants set plan = pkg where id = new.tenant_id;
    perform log_auto(new.tenant_id, 'plan.set', pkg, jsonb_build_object('plan', cur), jsonb_build_object('plan', pkg, 'why', 'Deposit paid'));
  end if;
  perform auto_advance(new.tenant_id);
  return new;
end $$;
drop trigger if exists deposit_paid on invoices;
create trigger deposit_paid after update of status on invoices for each row execute function on_deposit_paid();

create or replace function on_check_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform auto_advance(new.tenant_id);
  return new;
end $$;
drop trigger if exists gate_advance on gates;
create trigger gate_advance after update of status on gates for each row execute function on_check_change();

create or replace function on_tenant_progress() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform auto_advance(new.id);
  return new;
end $$;
drop trigger if exists tenant_progress on tenants;
create trigger tenant_progress after update of proposal_sent_at, checklist_done_at on tenants for each row execute function on_tenant_progress();

revoke all on function auto_advance(uuid), log_auto(uuid, text, text, jsonb, jsonb), on_deposit_paid(), on_check_change(), on_tenant_progress() from public, anon, authenticated;
