-- Helix Live guided tour of the vision: voice sessions (rate-limited, capped per day) and the notes Helix
-- takes during a tour. Staff can hand a note to a background agent, which drafts a plan (draft only).
-- Written by server routes with the service role; staff read everything; nobody else reads anything.

create table if not exists helix_tour_sessions (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  viewer_id uuid references auth.users on delete set null,
  is_staff boolean not null default false,
  model text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  seconds int
);
create index if not exists helix_tour_sessions_recent on helix_tour_sessions (ip_hash, started_at desc);
create index if not exists helix_tour_sessions_day on helix_tour_sessions (started_at);

create table if not exists helix_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references helix_tour_sessions on delete set null,
  kind text not null check (kind in ('idea','action_item','question','risk')),
  chapter text,
  text text not null check (length(text) between 2 and 600),
  source text not null default 'helix' check (source in ('helix','person')),
  status text not null default 'new' check (status in ('new','handed_off','drafting','drafted','accepted','dismissed','failed')),
  work jsonb,
  handed_off_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists helix_notes_session on helix_notes (session_id, created_at);
create index if not exists helix_notes_status on helix_notes (status, created_at desc);

alter table helix_tour_sessions enable row level security;
alter table helix_notes enable row level security;
create policy r on helix_tour_sessions for select to authenticated using ((select is_staff()));
create policy r on helix_notes for select to authenticated using ((select is_staff()));

-- Staff decide what happens to a drafted note.
create or replace function set_helix_note_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare n helix_notes;
begin
  if not (select is_staff()) then raise exception 'staff only'; end if;
  if p_status not in ('accepted','dismissed','new') then raise exception 'invalid status'; end if;
  select * into n from helix_notes where id = p_id for update;
  if n.id is null then raise exception 'note not found'; end if;
  update helix_notes set status = p_status, updated_at = now() where id = p_id;
  perform log_event((select id from tenants where slug = 'genovus'), 'helix.note.' || p_status, left(n.text, 80), jsonb_build_object('status', n.status), jsonb_build_object('status', p_status));
end $$;
grant execute on function set_helix_note_status(uuid, text) to authenticated;
