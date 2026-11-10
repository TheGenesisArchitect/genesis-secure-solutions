-- 0100 first set visibility_pulls' sources to metricool and search_console only, leaving out metricool-posts (the
-- per-post engagement record from 0085). Production never applied that version (the deploy stopped on the existing
-- rows); the preview database did. This puts all three back wherever it runs.
alter table visibility_pulls drop constraint if exists visibility_pulls_source_check;
alter table visibility_pulls add constraint visibility_pulls_source_check check (source in ('metricool','metricool-posts','search_console'));
