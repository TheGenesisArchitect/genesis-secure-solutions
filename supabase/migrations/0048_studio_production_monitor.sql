-- Production Monitor: every Runway job records what Runway last said about it (status, progress) and when it
-- finished, so the board can show a live step timeline, flag a step that's taking too long, and say why it failed.
alter table studio_voice_clips add column if not exists runway_status text, add column if not exists runway_progress real, add column if not exists done_at timestamptz;
alter table studio_art add column if not exists runway_status text, add column if not exists runway_progress real, add column if not exists done_at timestamptz;
alter table studio_takes add column if not exists runway_status text, add column if not exists runway_progress real, add column if not exists done_at timestamptz;
