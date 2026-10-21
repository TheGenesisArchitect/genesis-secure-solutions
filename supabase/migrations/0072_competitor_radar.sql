-- Competitor Radar (Growth): the insurance offices around an agency, mapped once by a capped Google sweep and then
-- filtered for free (radius, carrier, ZIP) on screen. Google terms, as for the partner radar: only the place ID is
-- stored, with our own classification (carrier and segment from the scanner's classifier, a distance in miles and a
-- compass bearing from the office); names, ratings, reviews, addresses and websites are fetched live when shown.
-- Saved views keep a radius, carriers and ZIP codes per agency.

create table if not exists competitor_offices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  place_id text not null,
  carrier_id uuid references carriers on delete set null,
  -- The carrier's display name ("State Farm", or "Independent"): the catalog itself is staff-only.
  carrier text not null check (length(carrier) between 1 and 80),
  segment text not null check (segment in ('captive','independent')),
  distance_mi numeric(5,1) not null,
  bearing_deg smallint not null check (bearing_deg between 0 and 359),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (tenant_id, place_id)
);
create index if not exists competitor_offices_near on competitor_offices (tenant_id, distance_mi);
alter table competitor_offices enable row level security;
create policy r on competitor_offices for select to authenticated using (is_staff() or is_member(tenant_id));

create table if not exists competitor_scans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  status text not null default 'running' check (status in ('running','done','budget','stopped','failed')),
  radius_mi int not null check (radius_mi between 1 and 25),
  cap_cents int not null check (cap_cents between 100 and 10000),
  queue jsonb not null default '[]',
  requests int not null default 0,
  cost_cents numeric(10,2) not null default 0,
  found int not null default 0,
  -- The agency's own Google listing, when the sweep passes it (shown as "you", with its live rating).
  own_place_id text,
  started_by uuid references auth.users on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists competitor_scans_tenant on competitor_scans (tenant_id, started_at desc);
alter table competitor_scans enable row level security;
create policy r on competitor_scans for select to authenticated using (is_staff() or is_member(tenant_id));

create table if not exists radar_views (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  name text not null check (length(name) between 1 and 80),
  radius_mi int not null check (radius_mi between 1 and 25),
  carriers text[] not null default '{}' check (cardinality(carriers) <= 20),
  zips text[] not null default '{}' check (cardinality(zips) <= 30),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
alter table radar_views enable row level security;
create policy r on radar_views for select to authenticated using (is_staff() or is_member(tenant_id));

-- Save (or replace, by name) a view. Members and staff.
create or replace function save_radar_view(p_tenant uuid, p_name text, p_radius int, p_carriers text[], p_zips text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare vid uuid;
begin
  if not (is_staff() or is_member(p_tenant)) then raise exception 'not allowed'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Name the view.'; end if;
  if p_radius is null or p_radius not between 1 and 25 then raise exception 'Radius is 1 to 25 miles.'; end if;
  if exists (select 1 from unnest(coalesce(p_zips, '{}')) z where z !~ '^\d{5}$') then raise exception 'ZIP codes are five digits.'; end if;
  if (select count(*) from radar_views where tenant_id = p_tenant) >= 30 and not exists (select 1 from radar_views where tenant_id = p_tenant and name = left(trim(p_name), 80)) then
    raise exception 'Thirty saved views at most; delete one first.';
  end if;
  insert into radar_views (tenant_id, name, radius_mi, carriers, zips, created_by)
  values (p_tenant, left(trim(p_name), 80), p_radius, coalesce(p_carriers, '{}'), coalesce(p_zips, '{}'), auth.uid())
  on conflict (tenant_id, name) do update set radius_mi = excluded.radius_mi, carriers = excluded.carriers, zips = excluded.zips
  returning id into vid;
  perform log_event(p_tenant, 'radar.view', left(trim(p_name), 80), null, null);
  return vid;
end $$;

create or replace function delete_radar_view(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v radar_views;
begin
  select * into v from radar_views where id = p_id;
  if v.id is null or not (is_staff() or is_member(v.tenant_id)) then raise exception 'not allowed'; end if;
  delete from radar_views where id = p_id;
  perform log_event(v.tenant_id, 'radar.view_delete', v.name, null, null);
end $$;

revoke execute on function save_radar_view(uuid, text, int, text[], text[]), delete_radar_view(uuid) from public, anon;
grant execute on function save_radar_view(uuid, text, int, text[], text[]), delete_radar_view(uuid) to authenticated;
