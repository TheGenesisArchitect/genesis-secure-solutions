-- SWIS™ Creative Court (Phase 2): every generated take is scored against its own Shot Contract before a person
-- reviews it. Seven weighted dimensions (performance 30, story 20, character 15, cinematography 15, continuity 10,
-- sound 5, brand 5), hard-fail conditions, beat-by-beat timing, failure tags and the usable window for the edit.
-- A director can override the verdict with a reason; overrides are the calibration data for the Court.

alter table studio_takes
  add column if not exists court jsonb not null default '{}',
  add column if not exists court_score int check (court_score is null or court_score between 0 and 100),
  add column if not exists court_status text check (court_status is null or court_status in ('running','scored','failed','skipped')),
  add column if not exists court_cost_cents int not null default 0 check (court_cost_cents >= 0),
  add column if not exists court_at timestamptz;
create index if not exists studio_takes_court on studio_takes (court_status, status) where kind = 'video';

-- The Court's own model calls count against the monthly Studio budget, even on takes that later fail.
create or replace function studio_spent_cents() returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_cents), 0)::int from (
    select cost_cents, created_at from studio_refs where status <> 'failed'
    union all select cost_cents, created_at from studio_takes where status <> 'failed'
    union all select court_cost_cents, coalesce(court_at, created_at) from studio_takes where court_cost_cents > 0
    union all select cost_cents, created_at from studio_art where status <> 'failed'
    union all select cost_cents, created_at from studio_voice_clips where status <> 'failed'
  ) g where (created_at at time zone 'America/New_York') >= date_trunc('month', now() at time zone 'America/New_York')
$$;
revoke execute on function studio_spent_cents() from public, anon;
grant execute on function studio_spent_cents() to authenticated;

-- A director's override of the Court's verdict, with the reason (kept with the take; the Court's score stays).
create or replace function studio_court_override(p_take uuid, p_verdict text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare t studio_takes;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  if p_verdict not in ('reject','review','production','hero') then raise exception 'Pick a verdict.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why: the reason calibrates the Court.'; end if;
  select * into t from studio_takes where id = p_take;
  if t.id is null then raise exception 'take not found'; end if;
  update studio_takes set court = t.court || jsonb_build_object('override', jsonb_build_object('verdict', p_verdict, 'reason', left(trim(p_reason), 500), 'by', auth.uid(), 'at', now())) where id = p_take;
end $$;
revoke execute on function studio_court_override(uuid, text, text) from public, anon;
grant execute on function studio_court_override(uuid, text, text) to authenticated;
