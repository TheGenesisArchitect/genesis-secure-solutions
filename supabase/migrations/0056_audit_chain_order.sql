-- The audit chain was always serialized (one writer at a time, advisory lock 4207001), but each row's id is drawn
-- before its writer takes the lock, so two simultaneous writes could take the lock in the opposite order from
-- their ids. The chain itself stayed intact (every row links to the row written just before it); the verifier,
-- walking by id, reported a false break. Two fixes, neither weakens tamper evidence:
--   1. New rows draw their id while holding the lock, so id order is chain order from here on.
--   2. The verifier follows the chain link by link from genesis (prev_hash → hash) instead of trusting id order:
--      an edited row fails its hash, a deleted row orphans its successor, a forged row forks or orphans.
create index if not exists audit_events_prev_hash on audit_events (prev_hash);
create index if not exists audit_events_hash on audit_events (hash);
alter table audit_checkpoint add column if not exists verified_count bigint;

create or replace function audit_chain() returns trigger language plpgsql as $$
declare last text;
begin
  perform pg_advisory_xact_lock(4207001);
  -- Draw the id under the lock: the chain order and the id order can no longer disagree.
  new.id := nextval(pg_get_serial_sequence('audit_events', 'id'));
  select hash into last from audit_events order by id desc limit 1;
  new.prev_hash := coalesce(last, 'genesis');
  new.at := clock_timestamp();
  new.hash := encode(extensions.digest(new.prev_hash || '|' || coalesce(new.tenant_id::text,'') || '|' || coalesce(new.actor::text,'') || '|' ||
    coalesce(new.actor_label,'') || '|' || new.action || '|' || coalesce(new.subject,'') || '|' || coalesce(new.before::text,'') || '|' ||
    coalesce(new.after::text,'') || '|' || to_char(new.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex');
  return new;
end $$;

-- Verifies the chain by following its links (from the last checkpoint, or from genesis when full). Returns the
-- first problem row's id (a row whose hash doesn't match, a fork, or a row that isn't on the chain), -1 if the
-- counts disagree without a locatable row, or null when the whole chain verifies.
create or replace function verify_audit_chain(p_full boolean default false) returns bigint language plpgsql security definer set search_path = public as $$
declare cur text := 'genesis'; r record; n int; h text; visited bigint := 0; base bigint := 0; total bigint; last_id bigint := 0; ck record;
begin
  if auth.uid() is not null and not is_staff() then raise exception 'staff only'; end if;
  if not p_full then
    select * into ck from audit_checkpoint where id = 1;
    if found and ck.verified_count is not null then cur := ck.last_hash; base := ck.verified_count; last_id := ck.last_id; end if;
  end if;
  loop
    select count(*) into n from audit_events where prev_hash = cur;
    exit when n = 0;
    if n > 1 then return (select min(id) from audit_events where prev_hash = cur); end if; -- a fork: two rows claim the same parent
    select * into r from audit_events where prev_hash = cur;
    h := encode(extensions.digest(cur || '|' || coalesce(r.tenant_id::text,'') || '|' || coalesce(r.actor::text,'') || '|' ||
      coalesce(r.actor_label,'') || '|' || r.action || '|' || coalesce(r.subject,'') || '|' || coalesce(r.before::text,'') || '|' ||
      coalesce(r.after::text,'') || '|' || to_char(r.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex');
    if r.hash <> h then return r.id; end if;
    cur := r.hash; visited := visited + 1; last_id := r.id;
  end loop;
  -- Every row must be on the chain: an orphan means its parent was deleted or it was inserted out of band.
  select count(*) into total from audit_events;
  if base + visited <> total then
    return coalesce((select min(a.id) from audit_events a where a.prev_hash <> 'genesis' and not exists (select 1 from audit_events b where b.hash = a.prev_hash)), -1);
  end if;
  if visited > 0 or base > 0 then
    insert into audit_checkpoint (id, last_id, last_hash, checked_at, verified_count) values (1, last_id, cur, now(), base + visited)
    on conflict (id) do update set last_id = excluded.last_id, last_hash = excluded.last_hash, checked_at = now(), verified_count = excluded.verified_count;
  end if;
  return null;
end $$;
grant execute on function verify_audit_chain(boolean) to authenticated;

-- Known race forks from before fix 1: a row written in the same instant as another can be left as a dead-end side
-- branch (its record intact, its hash valid). An admin acknowledges each one, the acknowledgment is itself
-- audited, and the verifier then accepts that one dead end. Any unacknowledged fork still fails verification.
create table if not exists audit_exceptions (
  leaf_id bigint primary key references audit_events (id),
  reason text not null,
  acknowledged_by uuid,
  acknowledged_at timestamptz not null default now()
);
alter table audit_exceptions enable row level security;
revoke all on audit_exceptions from anon, authenticated;
grant select on audit_exceptions to authenticated;
create policy r on audit_exceptions for select to authenticated using ((select is_staff()));

create or replace function acknowledge_audit_fork(p_leaf bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare leaf audit_events;
begin
  if auth.uid() is not null and not has_role('admin') then raise exception 'Only an admin can acknowledge an audit fork.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Say why this fork is a known race, not tampering.'; end if;
  select * into leaf from audit_events where id = p_leaf;
  if leaf.id is null then raise exception 'No such audit row.'; end if;
  if exists (select 1 from audit_events where prev_hash = leaf.hash) then raise exception 'That row has a successor: it is not a dead-end branch.'; end if;
  if (select count(*) from audit_events where prev_hash = leaf.prev_hash) < 2 then raise exception 'That row is not on a fork.'; end if;
  insert into audit_exceptions (leaf_id, reason, acknowledged_by) values (p_leaf, trim(p_reason), auth.uid()) on conflict (leaf_id) do nothing;
  perform log_event(null, 'audit.fork.acknowledge', p_leaf::text, null, jsonb_build_object('reason', trim(p_reason)));
end $$;
revoke execute on function acknowledge_audit_fork(bigint, text) from public, anon;
grant execute on function acknowledge_audit_fork(bigint, text) to authenticated;

-- The verifier, aware of acknowledged dead ends.
create or replace function verify_audit_chain(p_full boolean default false) returns bigint language plpgsql security definer set search_path = public as $$
declare cur text := 'genesis'; r record; n int; h text; visited bigint := 0; base bigint := 0; total bigint; last_id bigint := 0; ck record; leaf record; cont int;
begin
  if auth.uid() is not null and not is_staff() then raise exception 'staff only'; end if;
  if not p_full then
    select * into ck from audit_checkpoint where id = 1;
    if found and ck.verified_count is not null then cur := ck.last_hash; base := ck.verified_count; last_id := ck.last_id; end if;
  end if;
  loop
    select count(*) into n from audit_events where prev_hash = cur;
    exit when n = 0;
    if n > 1 then
      -- A fork is accepted only when every extra branch is an acknowledged dead end with a valid hash.
      select count(*) into cont from audit_events a where a.prev_hash = cur and not exists (select 1 from audit_exceptions x where x.leaf_id = a.id);
      if cont <> 1 then return (select min(id) from audit_events where prev_hash = cur); end if;
      for leaf in select a.* from audit_events a join audit_exceptions x on x.leaf_id = a.id where a.prev_hash = cur loop
        if exists (select 1 from audit_events where prev_hash = leaf.hash) then return leaf.id; end if;
        h := encode(extensions.digest(cur || '|' || coalesce(leaf.tenant_id::text,'') || '|' || coalesce(leaf.actor::text,'') || '|' ||
          coalesce(leaf.actor_label,'') || '|' || leaf.action || '|' || coalesce(leaf.subject,'') || '|' || coalesce(leaf.before::text,'') || '|' ||
          coalesce(leaf.after::text,'') || '|' || to_char(leaf.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex');
        if leaf.hash <> h then return leaf.id; end if;
        visited := visited + 1;
      end loop;
      select a.* into r from audit_events a where a.prev_hash = cur and not exists (select 1 from audit_exceptions x where x.leaf_id = a.id);
    else
      select * into r from audit_events where prev_hash = cur;
    end if;
    h := encode(extensions.digest(cur || '|' || coalesce(r.tenant_id::text,'') || '|' || coalesce(r.actor::text,'') || '|' ||
      coalesce(r.actor_label,'') || '|' || r.action || '|' || coalesce(r.subject,'') || '|' || coalesce(r.before::text,'') || '|' ||
      coalesce(r.after::text,'') || '|' || to_char(r.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex');
    if r.hash <> h then return r.id; end if;
    cur := r.hash; visited := visited + 1; last_id := r.id;
  end loop;
  select count(*) into total from audit_events;
  if base + visited <> total then
    return coalesce((select min(a.id) from audit_events a where a.prev_hash <> 'genesis' and not exists (select 1 from audit_events b where b.hash = a.prev_hash)), -1);
  end if;
  if visited > 0 or base > 0 then
    insert into audit_checkpoint (id, last_id, last_hash, checked_at, verified_count) values (1, last_id, cur, now(), base + visited)
    on conflict (id) do update set last_id = excluded.last_id, last_hash = excluded.last_hash, checked_at = now(), verified_count = excluded.verified_count;
  end if;
  return null;
end $$;
grant execute on function verify_audit_chain(boolean) to authenticated;
