-- Hide conversations from the staff queue without changing the customer's history or status.
alter table support_tickets add column if not exists admin_archived_at timestamptz;
alter table support_tickets add column if not exists admin_archived_by uuid references admins(id) on delete set null;
create index if not exists support_active_updated_idx on support_tickets(updated_at desc) where admin_archived_at is null;
