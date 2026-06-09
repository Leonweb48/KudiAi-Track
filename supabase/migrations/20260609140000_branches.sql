-- Branches (sub-locations of a business)
create table if not exists branches (
  id          uuid default gen_random_uuid() primary key,
  owner_id    uuid references auth.users not null,
  name        text not null,
  address     text,
  phone       text,
  manager_id  uuid,         -- references staff.id (no FK to avoid circular dep)
  is_active   boolean default true not null,
  created_at  timestamptz default now()
);

alter table branches enable row level security;
create policy "owner_all_branches" on branches for all using (auth.uid() = owner_id);

-- Tag existing data tables with branch
alter table transactions    add column if not exists branch_id uuid references branches;
alter table credits         add column if not exists branch_id uuid references branches;
alter table aso_clients     add column if not exists branch_id uuid references branches;
alter table products        add column if not exists branch_id uuid references branches;
alter table stock_movements add column if not exists branch_id uuid references branches;

-- Assign staff to a branch (role column already exists on staff table)
alter table staff add column if not exists branch_id uuid references branches;

-- Indexes for branch-filtered queries
create index if not exists transactions_branch_idx    on transactions    (branch_id) where branch_id is not null;
create index if not exists credits_branch_idx         on credits         (branch_id) where branch_id is not null;
create index if not exists aso_clients_branch_idx     on aso_clients     (branch_id) where branch_id is not null;
create index if not exists products_branch_idx        on products        (branch_id) where branch_id is not null;
create index if not exists staff_branch_idx           on staff           (branch_id) where branch_id is not null;
