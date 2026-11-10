-- Upgrade Notes (vision: claude.ai/artifact/W5TmvJw1hX8aXhUaRNFumB, approved 2026-11-10) and the Google Search Console
-- connection that gives their check-backs real numbers.
--  * upgrade_notes: one plain-words note per upgrade to a client's systems, in five parts (what we did, what runs in
--    the background, what to expect and when, their next steps, how it scales). Helix drafts it, a person edits it, and
--    it reaches the client only after a team tap in the approvals lane (email to the owners, then the portal card and
--    Helix). On check_back_on the daily job writes the check-back with real numbers; it also waits on a tap.
--  * upgrade_note_reads: who at the agency has opened each note (per person, not per device).
--  * upgrade_note_steps: the client's answer to each next step: done, help (opens a care request) or later.
--  * tenants.search_console_site: the agency's Search Console property ("sc-domain:example.com" or
--    "https://example.com/"); Genovus's service account is added to it as a read-only user.
--  * search_daily / search_pages: Google search numbers by day, and whether each page of the site is in Google
--    (Search Console's own URL inspection). Only the server writes them; staff and the agency's members read them.
-- Members see a note only once it is sent; drafts are staff only. Members answer steps and mark reads through the
-- functions below, never by writing the tables.

alter table tenants add column if not exists search_console_site text
  check (search_console_site is null or search_console_site ~ '^(sc-domain:[a-z0-9.-]+\.[a-z]{2,}|https://[a-z0-9.-]+\.[a-z]{2,}/)$');

create table if not exists upgrade_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  title text not null check (length(title) between 3 and 120),
  summary text not null default '' check (length(summary) <= 400),
  did text[] not null default '{}',
  background text[] not null default '{}',
  expect jsonb not null default '[]',
  steps jsonb not null default '[]',
  scales text not null default '' check (length(scales) <= 600),
  status text not null default 'draft' check (status in ('draft','queued','sent')),
  check_back_on date,
  check_back jsonb,
  check_back_status text not null default 'none' check (check_back_status in ('none','draft','queued','sent')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  check_back_sent_at timestamptz,
  is_sample boolean not null default false
);
create index if not exists upgrade_notes_tenant on upgrade_notes (tenant_id, created_at desc);
create index if not exists upgrade_notes_check_back on upgrade_notes (check_back_on) where status = 'sent' and check_back_status = 'none';
alter table upgrade_notes enable row level security;
create policy r on upgrade_notes for select to authenticated using (is_staff() or (status = 'sent' and is_member(tenant_id)));

create table if not exists upgrade_note_reads (
  note_id uuid not null references upgrade_notes on delete cascade,
  user_id uuid not null,
  tenant_id uuid not null references tenants on delete cascade,
  read_at timestamptz not null default now(),
  primary key (note_id, user_id)
);
alter table upgrade_note_reads enable row level security;
create policy r on upgrade_note_reads for select to authenticated using (is_staff() or is_member(tenant_id));

create table if not exists upgrade_note_steps (
  note_id uuid not null references upgrade_notes on delete cascade,
  step_key text not null check (step_key ~ '^[a-z0-9-]{1,40}$'),
  tenant_id uuid not null references tenants on delete cascade,
  status text not null check (status in ('done','help','later')),
  by_user uuid,
  at timestamptz not null default now(),
  primary key (note_id, step_key)
);
alter table upgrade_note_steps enable row level security;
create policy r on upgrade_note_steps for select to authenticated using (is_staff() or is_member(tenant_id));

-- Opening a note marks it read for this person.
create or replace function read_upgrade_note(p_note uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n upgrade_notes;
begin
  select * into n from upgrade_notes where id = p_note;
  if n.id is null or n.status <> 'sent' or not is_member(n.tenant_id) then return; end if;
  insert into upgrade_note_reads (note_id, user_id, tenant_id) values (n.id, auth.uid(), n.tenant_id) on conflict do nothing;
end $$;
revoke execute on function read_upgrade_note(uuid) from public, anon;
grant execute on function read_upgrade_note(uuid) to authenticated;

-- A next step answered: done or later is recorded; help also opens a care request for the Genovus team (once).
create or replace function answer_upgrade_step(p_note uuid, p_step text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare n upgrade_notes; s jsonb; prior text;
begin
  select * into n from upgrade_notes where id = p_note;
  if n.id is null or n.status <> 'sent' or not (is_member(n.tenant_id) or is_staff()) then raise exception 'not allowed'; end if;
  if p_status not in ('done','help','later') then raise exception 'invalid answer'; end if;
  select v into s from jsonb_array_elements(n.steps) as j(v) where v->>'key' = p_step limit 1;
  if s is null then raise exception 'unknown step'; end if;
  select status into prior from upgrade_note_steps where note_id = n.id and step_key = p_step;
  insert into upgrade_note_steps (note_id, step_key, tenant_id, status, by_user) values (n.id, p_step, n.tenant_id, p_status, auth.uid())
  on conflict (note_id, step_key) do update set status = excluded.status, by_user = excluded.by_user, at = now();
  if p_status = 'help' and prior is distinct from 'help' then
    insert into care_requests (tenant_id, kind, title, detail, created_by)
    values (n.tenant_id, 'support', left('Help with: ' || (s->>'text'), 140), 'From the upgrade note "' || n.title || '". The client asked for help with this step.', auth.uid());
  end if;
  perform log_event(n.tenant_id, 'upgrade_note.step', left(s->>'text', 200), case when prior is null then null else jsonb_build_object('status', prior) end, jsonb_build_object('status', p_status));
end $$;
revoke execute on function answer_upgrade_step(uuid, text, text) from public, anon;
grant execute on function answer_upgrade_step(uuid, text, text) to authenticated;

-- ---------- Search Console ----------
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.visibility_pulls'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'source' loop
    execute format('alter table visibility_pulls drop constraint %I', c);
  end loop;
end $$;
alter table visibility_pulls add constraint visibility_pulls_source_check check (source in ('metricool','search_console'));

create table if not exists search_daily (
  tenant_id uuid not null references tenants on delete cascade,
  day date not null,
  clicks int not null default 0,
  impressions int not null default 0,
  position numeric,
  pulled_at timestamptz not null default now(),
  primary key (tenant_id, day)
);
alter table search_daily enable row level security;
create policy r on search_daily for select to authenticated using (is_staff() or is_member(tenant_id));

create table if not exists search_pages (
  tenant_id uuid not null references tenants on delete cascade,
  url text not null check (url ~ '^https://'),
  indexed boolean not null,
  verdict text,
  coverage text,
  last_crawl timestamptz,
  inspected_at timestamptz not null default now(),
  primary key (tenant_id, url)
);
alter table search_pages enable row level security;
create policy r on search_pages for select to authenticated using (is_staff() or is_member(tenant_id));
