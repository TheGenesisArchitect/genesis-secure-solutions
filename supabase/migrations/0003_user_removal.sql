-- People can be removed (office staff leave, test accounts end) without losing history: "who did it" columns
-- become null when the account is deleted, while the audit log keeps the actor's name and email as text.
alter table agent_records drop constraint agent_records_created_by_fkey,
  add constraint agent_records_created_by_fkey foreign key (created_by) references auth.users on delete set null;
alter table lifecycle_events drop constraint lifecycle_events_actor_fkey,
  add constraint lifecycle_events_actor_fkey foreign key (actor) references auth.users on delete set null;
alter table gates drop constraint gates_cleared_by_fkey,
  add constraint gates_cleared_by_fkey foreign key (cleared_by) references auth.users on delete set null;
alter table approvals drop constraint approvals_decided_by_fkey,
  add constraint approvals_decided_by_fkey foreign key (decided_by) references auth.users on delete set null;
alter table care_requests drop constraint care_requests_created_by_fkey,
  add constraint care_requests_created_by_fkey foreign key (created_by) references auth.users on delete set null;
