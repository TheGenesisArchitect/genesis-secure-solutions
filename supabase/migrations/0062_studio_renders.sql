-- Every render of an episode besides its final (which stays on studio_episodes.final_blob): draft cuts and Shorts,
-- 16:9 or 9:16. The board lists the latest of each with a play link; posting picks from here.
create table if not exists studio_renders (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references studio_episodes on delete cascade,
  kind text not null check (kind in ('draft', 'short')),
  format text not null default 'wide' check (format in ('wide', 'vertical')),
  short_code text check (short_code is null or short_code ~ '^[a-z0-9-]{1,40}$'),
  title text,
  blob_path text not null check (blob_path ~ '^studio/renders/[A-Za-z0-9._/-]+$'),
  secs numeric,
  note text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists studio_renders_episode on studio_renders (episode_id, created_at desc);
alter table studio_renders enable row level security;
create policy r on studio_renders for select to authenticated using ((select is_staff()));

create or replace function studio_add_render(p_episode uuid, p_kind text, p_format text, p_short text, p_title text, p_blob text, p_secs numeric, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  insert into studio_renders (episode_id, kind, format, short_code, title, blob_path, secs, note, created_by)
  values (p_episode, p_kind, p_format, nullif(p_short, ''), left(p_title, 120), p_blob, p_secs, left(p_note, 600), auth.uid())
  returning id into rid;
  if p_kind = 'draft' and p_format = 'wide' and nullif(p_short, '') is null then
    update studio_episodes set draft_blob = p_blob, draft_at = now(), render_note = left(p_note, 600) where id = p_episode;
  end if;
  perform studio_log('studio.render.' || p_kind, p_episode::text, null, jsonb_build_object('blob', p_blob, 'format', p_format, 'short', p_short));
  return rid;
end $$;
revoke execute on function studio_add_render(uuid, text, text, text, text, text, numeric, text) from public, anon;
grant execute on function studio_add_render(uuid, text, text, text, text, text, numeric, text) to authenticated;
