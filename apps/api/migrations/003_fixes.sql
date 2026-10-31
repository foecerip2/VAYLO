-- Версия 3: постоянные сбои выдачи, возвраты, возврат на баланс.
alter table payments
  add column fulfill_failed_at     timestamptz,
  add column refunded_to_balance   boolean not null default false,
  add column refunded_at           timestamptz;
create index payments_unfulfilled_idx on payments (paid_at) where status = 'succeeded' and fulfilled_at is null and fulfill_failed_at is null;
