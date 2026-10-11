-- Voice Ask Helix everywhere: a Helix Live session now says what it was for (the vision tour, the Studio, Enterprise
-- Ask Helix or an agency's Ask Helix) and, for an agency, which one, so notes Helix takes by voice land in the Helix
-- notes inbox tagged with the right account and wait for review.

alter table helix_tour_sessions add column if not exists context text not null default 'tour';
alter table helix_tour_sessions add column if not exists tenant_id uuid references tenants on delete set null;
