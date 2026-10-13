-- Approvals can be undone: "reopen" puts an approved (or draft-approved) shot back in review, audited, so its
-- dialogue or anything else can be finished. (Approvals also record what they covered; see the board.)
create or replace function studio_review_shot(p_shot uuid, p_action text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare s studio_shots; e studio_episodes;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into s from studio_shots where id = p_shot for update;
  if s.id is null then raise exception 'shot not found'; end if;
  select * into e from studio_episodes where id = s.episode_id;
  if p_action = 'approve' then
    if not exists (select 1 from studio_takes where shot_id = p_shot and chosen and status = 'ready') and s.tool <> 'edit' and coalesce(array_length(s.screens, 1), 0) = 0 then raise exception 'There''s no picked take to approve yet.'; end if;
    if coalesce(s.produce->>'pass', 'final') = 'draft' then
      -- A draft approval: the shot is ready for its final render.
      update studio_shots set produce = produce || jsonb_build_object('stage', 'draft_ok', 'draft_ok_at', now(), 'draft_ok_by', auth.uid()) where id = p_shot;
    else
      update studio_shots set status = 'approved', produce = produce || jsonb_build_object('stage', 'approved', 'approved_at', now(), 'approved_by', auth.uid()) where id = p_shot;
    end if;
  elsif p_action = 'reopen' then
    -- Undo an approval (picture, draft or full): the shot goes back to review so it can be finished.
    if coalesce(s.produce->>'stage', '') not in ('approved', 'draft_ok') and s.status <> 'approved' then raise exception 'That shot isn''t approved.'; end if;
    update studio_shots set status = case when exists (select 1 from studio_takes where shot_id = p_shot and chosen and status = 'ready') then 'take_ok' else 'generating' end,
      produce = (produce - 'approved_at' - 'approved_by' - 'draft_ok_at' - 'draft_ok_by') || jsonb_build_object('stage', 'review', 'reopened_at', now(), 'reopened_by', auth.uid(), 'reopen_note', nullif(trim(p_note), ''))
    where id = p_shot;
  elsif p_action = 'redo' then
    if not coalesce((e.production->>'on')::boolean, false) then raise exception 'Start a production run first: redos come out of its approved budget.'; end if;
    if not (e.production->'shots') ? p_shot::text then raise exception 'That shot isn''t in the approved run.'; end if;
    update studio_art set chosen = false where shot_id = p_shot and kind = 'frame';
    update studio_shots set status = 'generating', produce = jsonb_build_object('stage', 'queued', 'since', now(), 'pass', coalesce(s.produce->>'pass', 'final'), 'redo_note', nullif(trim(p_note), ''), 'redos', coalesce((s.produce->>'redos')::int, 0) + 1),
      log = case when nullif(trim(p_note), '') is null then log else log || jsonb_build_object('acting', left(coalesce(log->>'acting', '') || case when coalesce(log->>'acting', '') = '' then '' else '. ' end || trim(p_note), 300)) end
    where id = p_shot;
  else raise exception 'invalid action'; end if;
  perform studio_log('studio.review.' || p_action, coalesce(s.shot_code, s.n::text), null, jsonb_build_object('note', p_note));
end $$;

