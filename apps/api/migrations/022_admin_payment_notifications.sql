-- Only future confirmations are queued. Existing successful payments are not backfilled.
-- The trigger commits with the payment, including balance purchases and provider reconciliation.
create table admin_payment_events (
  payment_id uuid primary key references payments(id) on delete cascade,
  created_at timestamptz not null default now(),
  prepared_at timestamptz,
  skipped_at timestamptz,
  skip_reason text
);
create index admin_payment_events_pending_idx on admin_payment_events(created_at)
  where prepared_at is null and skipped_at is null;

create table admin_payment_deliveries (
  payment_id uuid not null references admin_payment_events(payment_id) on delete cascade,
  chat_id bigint not null,
  sent_at timestamptz,
  attempted_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  primary key(payment_id,chat_id)
);
create index admin_payment_deliveries_pending_idx on admin_payment_deliveries(next_attempt_at)
  where sent_at is null;

create function queue_admin_payment_event() returns trigger language plpgsql as $$
begin
  if new.status='succeeded' and new.amount>0 and new.provider<>'promo' then
    if tg_op='INSERT' then
      insert into admin_payment_events(payment_id) values(new.id) on conflict do nothing;
    elsif old.status is distinct from new.status then
      insert into admin_payment_events(payment_id) values(new.id) on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;
create trigger payments_queue_admin_notification
  after insert or update of status on payments
  for each row execute function queue_admin_payment_event();
