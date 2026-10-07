-- Sign-in support for the server only: who may receive a sign-in email, and the user id behind an email.
-- Neither function is callable by browsers (anon or signed-in users), so they can't be used to probe emails.
create function signin_user_id(p_email text) returns uuid language sql stable security definer set search_path = public as $$
  select u.id from auth.users u
  where lower(u.email) = lower(trim(p_email))
    and (exists (select 1 from staff s where s.user_id = u.id)
      or exists (select 1 from memberships m where m.user_id = u.id)
      or exists (select 1 from network_members n where n.user_id = u.id))
  limit 1
$$;
create function user_id_by_email(p_email text) returns uuid language sql stable security definer set search_path = public as
$$ select id from auth.users where lower(email) = lower(trim(p_email)) limit 1 $$;
revoke execute on function signin_user_id(text), user_id_by_email(text) from public, anon, authenticated;
grant execute on function signin_user_id(text), user_id_by_email(text) to service_role;
