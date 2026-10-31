-- Stable ordering for messages written together in a single transaction.
alter table support_messages add column if not exists sequence bigserial;
create index if not exists support_messages_order_idx on support_messages(ticket_id, created_at, sequence);

-- Private photos belong to a support message and are removed with its history.
create table if not exists support_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references support_messages(id) on delete cascade,
  name text not null,
  mime text not null check (mime = 'image/jpeg'),
  data bytea not null,
  size integer not null check (size > 0 and size <= 2097152),
  width integer not null check (width > 0 and width <= 2048),
  height integer not null check (height > 0 and height <= 4096),
  position smallint not null check (position between 0 and 2),
  created_at timestamptz not null default now(),
  unique(message_id, position),
  check (octet_length(data) = size)
);
create index if not exists support_attachments_message_idx on support_attachments(message_id);
