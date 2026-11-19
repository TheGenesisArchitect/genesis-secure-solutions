-- Footage Desk: public figures (operator 2026-11-19). A stored item can be a still photo as well as video, and records
-- the public figure its source names (identity comes from the source's own title or description, never a face).
alter table unedit_footage add column if not exists kind text not null default 'video';
alter table unedit_footage drop constraint if exists unedit_footage_kind_check;
alter table unedit_footage add constraint unedit_footage_kind_check check (kind in ('video', 'photo'));
alter table unedit_footage add column if not exists person text;
