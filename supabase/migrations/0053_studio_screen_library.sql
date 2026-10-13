-- The Studio's Screen Library: real Genovus screens (desktop and phone), captured automatically with fictional
-- data, ready to pull into any episode so nobody records and uploads screens by hand. The library arrives with each
-- release (data/screen-library.json + data/screen-library-assets.json → the Studio sync), like the season and cast.
create table if not exists studio_screens (
  code text not null,
  device text not null check (device in ('desktop','phone')),
  title text not null,
  side text not null check (side in ('agency','enterprise')),
  chapter text not null,
  route text not null,
  clip_path text,
  still_path text,
  secs numeric,
  captured_at timestamptz,
  captured_on text,
  pending text,
  primary key (code, device)
);
alter table studio_screens enable row level security;
create policy r on studio_screens for select to authenticated using ((select is_staff()));

-- A shot's screens: library entries ("code:device") that fill a product shot, in order.
alter table studio_shots add column if not exists screens text[] not null default '{}';

create or replace function studio_set_shot_screens(p_shot uuid, p_screens text[])
returns void language plpgsql security definer set search_path = public as $$
declare bad text;
begin
  if not (select is_staff()) then raise exception 'not allowed'; end if;
  select x into bad from unnest(coalesce(p_screens, '{}')) x
    where not exists (select 1 from studio_screens s where s.code || ':' || s.device = x and s.clip_path is not null) limit 1;
  if bad is not null then raise exception 'That screen isn''t in the library: %', bad; end if;
  update studio_shots set screens = coalesce(p_screens, '{}') where id = p_shot;
  perform studio_log('studio.shot.screens', array_to_string(p_screens, ', '), null, null);
end $$;
revoke execute on function studio_set_shot_screens(uuid, text[]) from public, anon;
grant execute on function studio_set_shot_screens(uuid, text[]) to authenticated;
