-- Questions Helix can't answer yet become Helix notes: Helix tells the person "Great question. I'll make a note of
-- that and send it to the team for review," and the question lands in the Helix notes inbox, where the team (or the
-- build agent) turns it into work. A note remembers which account asked (an agency, or the Genovus house account for
-- Enterprise Helix) and who asked, so the answer can go back to them.

alter table helix_notes add column if not exists tenant_id uuid references tenants on delete set null;
alter table helix_notes add column if not exists asked_by uuid references auth.users on delete set null;
create index if not exists helix_notes_tenant on helix_notes (tenant_id, created_at desc);
