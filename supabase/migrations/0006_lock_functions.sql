-- Anonymous visitors may call no database function. Supabase grants new functions to anon by default, so
-- revoke everything now and change the default so functions created later start locked down too.
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;
