-- Studio money tells the truth (Runway Studio Audit, phase 1):
--   estimate_cents  what the router's dry run (or the fallback price table) quoted before the job started
--   cost_cents      reserved while running; Runway's final billed credits once it finishes
--   refund_status   n/a · refunded (Runway reported 0 after a failure or cancel) · unconfirmed (we stopped tracking
--                   before Runway confirmed: the reserved amount keeps counting against the budget)
-- and one expense per Runway task, however many pollers notice it finished.
alter table studio_takes add column if not exists estimate_cents int, add column if not exists refund_status text;
alter table studio_art add column if not exists estimate_cents int, add column if not exists refund_status text;
alter table studio_voice_clips add column if not exists estimate_cents int, add column if not exists refund_status text;
alter table expenses add column if not exists source_ref text;
create unique index if not exists expenses_source_ref on expenses (source_ref) where source_ref is not null;
