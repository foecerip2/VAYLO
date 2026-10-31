-- Keep existing conversations; add explicit operator workflow states.
alter table support_tickets drop constraint if exists support_tickets_status_check;
alter table support_tickets add constraint support_tickets_status_check
  check (status in ('open','in_progress','waiting_user','answered','closed'));
