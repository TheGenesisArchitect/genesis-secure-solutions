-- Helix Notes for agencies (Growth): the agent that knows and grows with the business keeps the office's notes.
-- An agency sees its own notes: to-dos and ideas it gave Helix (by voice or typed), private to the agency
-- (chapter 'agency'), and the questions Helix couldn't answer yet, which also go to the Genovus team (chapter
-- 'ask-helix'). A to-do becomes a follow-up in one tap. The team's inbox keeps only the questions.

alter table helix_notes add column if not exists follow_up_id uuid references follow_ups on delete set null;

create policy agency_r on helix_notes for select to authenticated
  using (tenant_id is not null and chapter in ('agency', 'ask-helix') and is_member(tenant_id));

create or replace function agency_add_helix_note(p_tenant uuid, p_kind text, p_text text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not (is_staff() or is_member(p_tenant)) then raise exception 'not allowed'; end if;
  if p_kind not in ('action_item', 'idea', 'question') then raise exception 'invalid kind'; end if;
  if length(trim(coalesce(p_text, ''))) < 2 then raise exception 'Write the note first.'; end if;
  insert into helix_notes (kind, text, chapter, source, tenant_id, asked_by)
  values (p_kind, left(trim(p_text), 600), case when p_kind = 'question' then 'ask-helix' else 'agency' end, 'person', p_tenant, auth.uid())
  returning id into nid;
  perform log_event(p_tenant, 'helix.note.add', left(trim(p_text), 80), null, null);
  return nid;
end $$;

-- Done, reopen or dismiss one of the agency's own notes (questions with the team are the team's to close).
create or replace function agency_set_helix_note(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare n helix_notes;
begin
  select * into n from helix_notes where id = p_id for update;
  if n.id is null or n.tenant_id is null or not (is_staff() or is_member(n.tenant_id)) then raise exception 'not allowed'; end if;
  if n.chapter <> 'agency' then raise exception 'This question is with the Genovus team.'; end if;
  if p_status not in ('new', 'done', 'dismissed') then raise exception 'invalid status'; end if;
  update helix_notes set status = p_status, worked_by = auth.uid(), updated_at = now() where id = p_id;
  perform log_event(n.tenant_id, 'helix.note.' || p_status, left(n.text, 80), null, null);
end $$;

-- A to-do becomes a follow-up on the day the office picks; the note is marked done and remembers it.
create or replace function agency_helix_note_follow_up(p_id uuid, p_who text, p_due date)
returns uuid language plpgsql security definer set search_path = public as $$
declare n helix_notes; fid uuid;
begin
  select * into n from helix_notes where id = p_id for update;
  if n.id is null or n.tenant_id is null or not (is_staff() or is_member(n.tenant_id)) then raise exception 'not allowed'; end if;
  if n.chapter <> 'agency' then raise exception 'not allowed'; end if;
  fid := add_follow_up(n.tenant_id, coalesce(nullif(trim(p_who), ''), left(n.text, 120)), left(n.text, 300), p_due, '09:30');
  update helix_notes set status = 'done', follow_up_id = fid, worked_by = auth.uid(), updated_at = now() where id = p_id;
  return fid;
end $$;

revoke execute on function agency_add_helix_note(uuid, text, text), agency_set_helix_note(uuid, text), agency_helix_note_follow_up(uuid, text, date) from public, anon;
grant execute on function agency_add_helix_note(uuid, text, text), agency_set_helix_note(uuid, text), agency_helix_note_follow_up(uuid, text, date) to authenticated;
