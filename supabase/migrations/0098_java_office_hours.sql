-- JAVA Agency (Mendez Hollis) is open Saturdays 9–5 (Anthony, 2026-11-09), so a Saturday lead starts its first-call
-- timer the same day instead of Monday. Weekdays keep the 0096 default (9–6, Eastern). Does nothing where JAVA's
-- agency doesn't exist (preview).
update agency_profiles
set office_hours = jsonb_set(office_hours, '{sat}', '["09:00","17:00"]'::jsonb)
where tenant_id = (select id from tenants where slug = 'mendez-hollis');
