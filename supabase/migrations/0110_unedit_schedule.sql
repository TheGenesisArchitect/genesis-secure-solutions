-- UnEdit posting plan (lib/unedit-plan.ts): every approved post carries the time it goes out. Post now, Helix's plan
-- (flood, drip or steady) or the user's calendar all write scheduled_at; the studio cron sends each post to Metricool
-- shortly before its time, so a post can be moved or cancelled until then. Additive: existing rows keep working
-- (a null scheduled_at means "as soon as possible", the old behaviour).
alter table unedit_posts add column if not exists scheduled_at timestamptz;

-- A post the user took off the calendar before it went out.
alter table unedit_posts drop constraint if exists unedit_posts_status_check;
alter table unedit_posts add constraint unedit_posts_status_check check (status in ('queued', 'sent', 'posted', 'error', 'skipped', 'cancelled'));

-- Networks Metricool can post to for the brand (Metricool's own names; X is 'twitter'). Posts are only created for
-- networks that are connected and whose post format has been checked against Metricool.
alter table unedit_posts drop constraint if exists unedit_posts_platform_check;
alter table unedit_posts add constraint unedit_posts_platform_check check (platform in ('instagram', 'facebook', 'youtube', 'tiktok', 'twitter', 'linkedin'));

-- The posts waiting for their time, found every minute by the studio cron.
create index if not exists unedit_posts_due on unedit_posts (scheduled_at) where status = 'queued';

-- How the campaign was approved: {mode: now|plan|calendar, rhythm: flood|drip|steady, why, by, at}.
alter table unedit_vlogs add column if not exists post_plan jsonb;
