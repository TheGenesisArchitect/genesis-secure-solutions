-- Helix threads, continued (Steps 3 and 7): voice turns are saved from the browser while typed answers are saved by
-- the server, so two saves can arrive at once for someone with no thread yet. helix_append now takes a per-person
-- lock first, so they continue one thread. (0066 is already applied; this replaces the function.)

create or replace function helix_append(p_thread uuid, p_tenant uuid, p_surface text, p_page text, p_turns jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; me uuid := auth.uid(); x jsonb; pg text := nullif(left(trim(coalesce(p_page, '')), 120), '');
begin
  if me is null then raise exception 'sign in first'; end if;
  if p_surface not in ('agency','enterprise','studio') then raise exception 'unknown surface'; end if;
  if p_surface = 'agency' and not (is_member(p_tenant) or is_staff()) then raise exception 'not your agency'; end if;
  if p_surface <> 'agency' and not is_staff() then raise exception 'staff only'; end if;
  if jsonb_typeof(p_turns) <> 'array' or jsonb_array_length(p_turns) > 20 then raise exception 'send 1 to 20 turns'; end if;
  -- One save at a time per person, account and surface: a spoken turn (saved from the browser) and a typed answer
  -- (saved by the server) arriving together continue one thread instead of each starting their own.
  perform pg_advisory_xact_lock(hashtext(me::text || ':' || p_tenant::text || ':' || p_surface));
  select id into tid from helix_threads
    where id = p_thread and user_id = me and tenant_id = p_tenant and surface = p_surface and archived_at is null;
  if tid is null then
    select id into tid from helix_threads
      where user_id = me and tenant_id = p_tenant and surface = p_surface and archived_at is null and last_at > now() - interval '7 days'
      order by last_at desc limit 1;
  end if;
  if tid is null then
    insert into helix_threads (tenant_id, user_id, surface, last_page) values (p_tenant, me, p_surface, pg) returning id into tid;
  end if;
  for x in select * from jsonb_array_elements(p_turns) loop
    continue when coalesce(x->>'role', '') not in ('user','helix') or length(trim(coalesce(x->>'text', ''))) = 0;
    insert into helix_messages (thread_id, tenant_id, role, channel, text, page, context, meta)
    values (tid, p_tenant, x->>'role',
      case when x->>'channel' = 'voice' then 'voice' else 'text' end,
      left(x->>'text', 4000),
      nullif(left(coalesce(x->>'page', pg, ''), 120), ''),
      nullif(left(coalesce(x->>'context', ''), 600), ''),
      case when jsonb_typeof(x->'meta') = 'object' and length((x->'meta')::text) <= 8000 then x->'meta' else '{}'::jsonb end);
  end loop;
  update helix_threads set last_at = now(), last_page = coalesce(pg, last_page),
    title = coalesce(title, (select left(text, 120) from helix_messages where thread_id = tid and role = 'user' order by id limit 1))
  where id = tid;
  return tid;
end $$;
revoke execute on function helix_append(uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function helix_append(uuid, uuid, text, text, jsonb) to authenticated;
