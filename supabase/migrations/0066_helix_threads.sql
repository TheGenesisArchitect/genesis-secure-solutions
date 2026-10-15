-- Helix travels with you: every Ask Helix conversation is a thread saved to the account, so it carries on after a
-- reload, in another tab and on another device, and Helix answers with the whole conversation in mind.
-- One person's thread per surface (agency dashboard, Enterprise console, Studio); the active one is the most recent
-- in the last week. Who can read a thread (operator decision 2026-10-15): the person who had it, their agency's
-- owner, and the Genovus team. Writes go through the server only (the Helix routes check access first).

create table if not exists helix_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  surface text not null check (surface in ('agency','enterprise','studio')),
  title text check (title is null or length(title) <= 120),
  -- A rolling summary of the turns before summarized_through, so long threads stay small for Helix.
  summary text check (summary is null or length(summary) <= 4000),
  summarized_through bigint,
  last_page text check (last_page is null or length(last_page) <= 120),
  last_at timestamptz not null default now(),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists helix_threads_active on helix_threads (user_id, tenant_id, surface, last_at desc) where archived_at is null;
create index if not exists helix_threads_tenant on helix_threads (tenant_id, last_at desc);

create table if not exists helix_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references helix_threads on delete cascade,
  tenant_id uuid not null references tenants on delete cascade,
  role text not null check (role in ('user','helix')),
  channel text not null default 'text' check (channel in ('text','voice')),
  text text not null check (length(text) between 1 and 4000),
  page text check (page is null or length(page) <= 120),
  context text check (context is null or length(context) <= 600),
  -- What came with a Helix answer: follow-ups, drafts, "Remember this?" suggestions, a filed note.
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists helix_messages_thread on helix_messages (thread_id, id);

alter table helix_threads enable row level security;
alter table helix_messages enable row level security;
create policy r on helix_threads for select to authenticated
  using (user_id = auth.uid() or is_staff() or is_owner(tenant_id));
-- A message is readable wherever its thread is.
create policy r on helix_messages for select to authenticated
  using (exists (select 1 from helix_threads t where t.id = thread_id));

-- Add turns to the signed-in person's thread on a surface, and return the thread. p_thread continues that thread
-- when it is theirs (same account and surface, not archived); otherwise the most recent one from the last week
-- continues, or a new one starts. The agency surface is for that agency's members (and the Genovus team);
-- Enterprise and Studio are for the Genovus team. The Helix routes also check the Helix module first.
-- p_turns: [{ role, text, channel?, page?, context?, meta? }], at most 20.
create or replace function helix_append(p_thread uuid, p_tenant uuid, p_surface text, p_page text, p_turns jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; me uuid := auth.uid(); x jsonb; pg text := nullif(left(trim(coalesce(p_page, '')), 120), '');
begin
  if me is null then raise exception 'sign in first'; end if;
  if p_surface not in ('agency','enterprise','studio') then raise exception 'unknown surface'; end if;
  if p_surface = 'agency' and not (is_member(p_tenant) or is_staff()) then raise exception 'not your agency'; end if;
  if p_surface <> 'agency' and not is_staff() then raise exception 'staff only'; end if;
  if jsonb_typeof(p_turns) <> 'array' or jsonb_array_length(p_turns) > 20 then raise exception 'send 1 to 20 turns'; end if;
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
