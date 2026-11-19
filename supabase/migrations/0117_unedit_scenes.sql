-- The scene plan (lib/unedit-scenes.ts): Helix reads the episode's source article and proposes purpose-built scenes
-- (model card, benchmark duel, CAD build, lab result, 3D assembly) with the article's own numbers. Code checks each
-- proposal against the article; a person approves; approved scenes become `scene` lines on the sources sheet.
-- On a recording the proposal lives here; on a newsroom production it lives in outputs.scenePlan.
alter table unedit_vlogs add column if not exists scene_plan jsonb;

-- Drafting a scene plan is a newsroom run of kind 'scenes' (it counts toward the daily and monthly Studio caps).
alter table newsroom_runs drop constraint if exists newsroom_runs_kind_check;
alter table newsroom_runs add constraint newsroom_runs_kind_check check (kind in ('wire', 'deeper', 'produce', 'brief', 'scenes'));
