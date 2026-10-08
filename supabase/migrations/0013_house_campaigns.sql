-- Genovus is its own first client: the house account (tenant "genovus", kind internal) runs our own
-- campaigns through the same platform. Campaigns carry a slug used in every outbound link (?c=<slug>);
-- inquiries remember the campaign, channel, landing page and (later) the prospect they came from.

insert into tenants (slug, name, kind, stage)
values ('genovus', 'Genovus (Genesis Secure Solutions)', 'internal', 'care')
on conflict (slug) do nothing;

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null check (length(name) between 2 and 120),
  channel text not null check (channel in ('email','calls','social','ads','mail','referral','events','other')),
  segment text not null default 'captive-agents' check (segment in ('captive-agents','independent-agencies','carriers','mixed')),
  carrier_hint text,
  status text not null default 'draft' check (status in ('draft','live','paused','done')),
  starts_on date,
  ends_on date,
  budget_cents int check (budget_cents is null or budget_cents >= 0),
  notes text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
alter table campaigns enable row level security;
create policy r on campaigns for select to authenticated using ((select is_staff()));

alter table inquiries
  add column if not exists campaign_id uuid references campaigns on delete set null,
  add column if not exists source text,
  add column if not exists landing text,
  add column if not exists prospect_id uuid;
create index if not exists inquiries_campaign on inquiries (campaign_id);

create or replace function save_campaign(p_slug text, p_name text, p_channel text, p_segment text, p_carrier text,
  p_status text, p_starts date, p_ends date, p_budget_cents int, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; before jsonb;
begin
  if not has_role('admin','account_lead') then raise exception 'only an admin or account lead can manage campaigns'; end if;
  select to_jsonb(c) into before from campaigns c where slug = p_slug;
  insert into campaigns (slug, name, channel, segment, carrier_hint, status, starts_on, ends_on, budget_cents, notes, created_by)
  values (lower(p_slug), p_name, p_channel, p_segment, nullif(trim(p_carrier), ''), p_status, p_starts, p_ends, p_budget_cents, nullif(trim(p_notes), ''), auth.uid())
  on conflict (slug) do update set name = excluded.name, channel = excluded.channel, segment = excluded.segment, carrier_hint = excluded.carrier_hint,
    status = excluded.status, starts_on = excluded.starts_on, ends_on = excluded.ends_on, budget_cents = excluded.budget_cents, notes = excluded.notes
  returning id into cid;
  perform log_event((select id from tenants where slug = 'genovus'), case when before is null then 'campaign.create' else 'campaign.update' end, p_slug, before,
    jsonb_build_object('name', p_name, 'channel', p_channel, 'status', p_status, 'budget_cents', p_budget_cents));
  return cid;
end $$;
grant execute on function save_campaign(text, text, text, text, text, text, date, date, int, text) to authenticated;
