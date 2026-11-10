-- JAVA Agency's hours, matched to Mendez's official GEICO profile (Anthony, 2026-11-09): Mon–Fri 9–5, Sat 9–1,
-- Sunday closed (Eastern). Replaces 0098's Saturday 9–5 and the 0096 weekday default (9–6), so lead timers, the
-- website's structured data and the GEICO profile all say the same thing. Does nothing where JAVA's agency doesn't
-- exist (preview).
update agency_profiles
set office_hours = '{"mon":["09:00","17:00"],"tue":["09:00","17:00"],"wed":["09:00","17:00"],"thu":["09:00","17:00"],"fri":["09:00","17:00"],"sat":["09:00","13:00"],"sun":null}'::jsonb
where tenant_id = (select id from tenants where slug = 'mendez-hollis');
