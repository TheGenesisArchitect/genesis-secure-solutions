-- The GENOVUS Cast Character Bible (v1.0) inside the Studio: character records, episode wardrobe looks, the
-- identity package (portrait / performance / ensemble / look slots with versioned asset codes such as
-- MAYA01_FACE_v01_FRONT), and the bible's approval record. Production order is enforced: every other slot is
-- derived from a character's approved front portrait, so all angles start from one face.

create table if not exists studio_characters (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references studio_series on delete cascade,
  code text not null unique check (code ~ '^[A-Z]{2,8}[0-9]{2}$'),
  name text not null,
  archetype text,
  age int,
  role text,
  profile jsonb not null default '{}'::jsonb,       -- the bible's sections: sentence, history, flaw, ladder, funny, never…
  identity_prompt text not null,
  visual_anchors text,
  wardrobe text,
  voice jsonb not null default '{}'::jsonb,         -- direction, timing, tts voice, pronunciation
  status text not null default 'active' check (status in ('active','retired')),
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists studio_looks (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references studio_characters on delete cascade,
  episode_id uuid references studio_episodes on delete cascade,
  code text not null unique,                         -- e.g. EP001_MAYA_LOOK01
  description text not null,
  prop_hand text,
  phone_case text,
  notes text
);

alter table studio_refs
  add column if not exists character_id uuid references studio_characters on delete cascade,
  add column if not exists ref_set text check (ref_set in ('portrait','performance','ensemble','look')),
  add column if not exists slot text,
  add column if not exists version int,
  add column if not exists asset_code text,
  add column if not exists approved boolean not null default false;
create index if not exists studio_refs_character on studio_refs (character_id, slot, created_at desc);

create table if not exists studio_decisions (
  id uuid primary key default gen_random_uuid(),
  series_id uuid references studio_series on delete cascade,
  decision text not null,
  value text,
  asset_ref text,
  version text,
  reason text,
  episodes text[] not null default '{}',
  decided_by uuid references auth.users on delete set null,
  decided_at timestamptz not null default now()
);

alter table studio_characters enable row level security;
alter table studio_looks enable row level security;
alter table studio_decisions enable row level security;
create policy r on studio_characters for select to authenticated using ((select is_staff()));
create policy r on studio_looks for select to authenticated using ((select is_staff()));
create policy r on studio_decisions for select to authenticated using ((select is_staff()));

-- Reserve a generation (all kinds). Identity slots: FACE_FRONT comes from the bible's identity prompt; every other
-- slot needs that character's approved FACE_FRONT; ensemble slots need all three fronts approved.
create or replace function studio_reserve(p_kind text, p_target uuid, p_character text, p_prompt text, p_model text, p_cents int, p_params jsonb, p_refs uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare b studio_budget; spent int; nid uuid; c studio_characters; v_slot text := p_params->>'slot'; v_set text := p_params->>'set';
  v_char uuid := nullif(p_params->>'character_id', '')::uuid; v_ver int; v_group text := p_params->>'group'; v_view text := p_params->>'view';
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  if p_kind not in ('ref','video','thumb') then raise exception 'invalid kind'; end if;
  if length(trim(coalesce(p_prompt, ''))) < 10 then raise exception 'The prompt is too short.'; end if;
  select * into b from studio_budget where id;
  perform pg_advisory_xact_lock(hashtext('studio_budget'));
  spent := studio_spent_cents();
  if spent + p_cents > b.monthly_cap_cents then
    raise exception 'Monthly Studio budget reached ($% of $%). Raise the cap to keep generating.', round(spent / 100.0, 2), round(b.monthly_cap_cents / 100.0, 2);
  end if;
  if p_cents > b.approval_over_cents and not has_role('admin') then
    raise exception 'This generation costs more than $% and needs an admin to start it.', round(b.approval_over_cents / 100.0, 2);
  end if;
  if p_kind = 'ref' then
    if v_slot is not null then
      if v_set = 'ensemble' then
        if (select count(*) from studio_characters sc where sc.series_id = p_target and sc.status = 'active'
              and exists (select 1 from studio_refs r where r.character_id = sc.id and r.slot = 'FACE_FRONT' and r.approved)) <
           (select count(*) from studio_characters where series_id = p_target and status = 'active') then
          raise exception 'Approve every character''s front portrait before the ensemble set.';
        end if;
      else
        select * into c from studio_characters where id = v_char;
        if c.id is null or c.status <> 'active' then raise exception 'Pick an active character.'; end if;
        if v_slot <> 'FACE_FRONT' and not exists (select 1 from studio_refs where character_id = v_char and slot = 'FACE_FRONT' and approved) then
          raise exception 'Approve %''s front portrait first: every other view is derived from it.', c.name;
        end if;
      end if;
      select coalesce(max(version), 0) + 1 into v_ver from studio_refs where coalesce(character_id::text, 'ens') = coalesce(v_char::text, 'ens') and slot = v_slot and series_id = coalesce(c.series_id, p_target);
    end if;
    insert into studio_refs (series_id, character, prompt, model, cost_cents, created_by, character_id, ref_set, slot, version, asset_code)
    values (coalesce(c.series_id, p_target), coalesce(c.name, trim(p_character)), trim(p_prompt), p_model, p_cents, auth.uid(), v_char, v_set, v_slot, v_ver,
      case when v_slot is null then null else format('%s_%s_v%s_%s', coalesce(c.code, 'ENSEMBLE'), coalesce(v_group, v_slot), lpad(v_ver::text, 2, '0'), coalesce(v_view, v_slot)) end)
    returning id into nid;
  elsif p_kind = 'thumb' then
    insert into studio_art (episode_id, prompt, model, ref_ids, cost_cents, created_by)
    values (p_target, trim(p_prompt), p_model, coalesce(p_refs, '{}'), p_cents, auth.uid()) returning id into nid;
  else
    insert into studio_takes (shot_id, kind, model, prompt, params, ref_ids, cost_cents, created_by)
    values (p_target, 'video', p_model, trim(p_prompt), coalesce(p_params, '{}'::jsonb), coalesce(p_refs, '{}'), p_cents, auth.uid()) returning id into nid;
    update studio_shots set status = 'generating' where id = p_target and status = 'todo';
  end if;
  perform studio_log('studio.generate.' || p_kind, coalesce(c.name, p_character, left(p_prompt, 60)), null, jsonb_build_object('model', p_model, 'cents', p_cents, 'slot', v_slot));
  return nid;
end $$;

-- Approve an identity slot: it becomes that character's reference for the slot, and the decision is recorded.
create or replace function studio_approve_ref(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r studio_refs;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select * into r from studio_refs where id = p_id for update;
  if r.id is null or r.status <> 'ready' or r.slot is null then raise exception 'That image is not ready.'; end if;
  update studio_refs set approved = (id = p_id), canonical = (id = p_id)
    where series_id = r.series_id and slot = r.slot and coalesce(character_id::text, 'ens') = coalesce(r.character_id::text, 'ens');
  insert into studio_decisions (series_id, decision, value, asset_ref, version, reason, decided_by)
  values (r.series_id, 'Approved ' || coalesce(r.character, 'ensemble') || ' · ' || r.slot, r.slot, r.asset_code, 'v' || lpad(r.version::text, 2, '0'), nullif(trim(p_reason), ''), auth.uid());
  perform studio_log('studio.identity.approve', coalesce(r.asset_code, r.slot), null, jsonb_build_object('asset', r.asset_code));
end $$;

grant execute on function studio_approve_ref(uuid, text) to authenticated;
