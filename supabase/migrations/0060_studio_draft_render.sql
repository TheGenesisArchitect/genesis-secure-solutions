-- A draft cut (rendered with problems still open, e.g. unverified lip-sync) is kept apart from the episode's final,
-- so a work-in-progress render never replaces or approves the real one.
alter table studio_episodes add column if not exists draft_blob text, add column if not exists draft_at timestamptz, add column if not exists render_note text;

create or replace function studio_set_draft_render(p_episode uuid, p_blob text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  if p_blob !~ '^studio/renders/[A-Za-z0-9._/-]+$' then raise exception 'invalid render'; end if;
  update studio_episodes set draft_blob = p_blob, draft_at = now(), render_note = left(p_note, 600) where id = p_episode;
  perform studio_log('studio.render.draft', p_episode::text, null, jsonb_build_object('blob', p_blob));
end $$;
revoke execute on function studio_set_draft_render(uuid, text, text) from public, anon;
grant execute on function studio_set_draft_render(uuid, text, text) to authenticated;
