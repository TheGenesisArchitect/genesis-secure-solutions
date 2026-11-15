-- Faceless videos (lib/unedit-faceless.ts): a Newsroom package voiced by an original narrator over the Genovus moving
-- background, then cut by the normal Unedit pipeline with every face step turned off.
--   unedit_vlogs.faceless          {voice, production, length}: set on a recording made this way (null = a real take)
--   newsroom_productions.faceless  {status: voicing|ready|failed, error, vlog_id, voice, length, at}
alter table unedit_vlogs add column if not exists faceless jsonb;
alter table newsroom_productions add column if not exists faceless jsonb;
