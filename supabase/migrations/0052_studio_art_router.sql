-- Keyframes remember which Model Router made them (the Router report measures each router separately).
alter table studio_art add column if not exists router text;
