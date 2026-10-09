-- Token usage per Helix tour session, so the daily cap can be priced from real data.
alter table helix_tour_sessions add column if not exists tokens int;
