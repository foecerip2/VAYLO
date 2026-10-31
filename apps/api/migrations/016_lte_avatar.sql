alter table addon_products drop constraint addon_products_kind_check;
alter table addon_products add constraint addon_products_kind_check check(kind in ('devices','traffic','location','lte'));
create table user_avatars(user_id uuid primary key references users(id) on delete cascade,token uuid not null unique default gen_random_uuid(),mime text not null,data bytea not null,version bigint not null default 1,updated_at timestamptz not null default now());
