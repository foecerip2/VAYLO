-- Identity and evidence survive deletion; no passwords, subscription URLs or payment tokens.
alter table trial_cleanup_tombstones
  add column source_user_id uuid,
  add column rw_id bigint,
  add column rw_username text,
  add column rw_uuid text,
  add column deletion_verified_at timestamptz,
  add column last_verified_at timestamptz,
  add column verification jsonb;
create index trial_cleanup_tombstones_cleaned_idx on trial_cleanup_tombstones(cleaned_at desc,tg_id);
