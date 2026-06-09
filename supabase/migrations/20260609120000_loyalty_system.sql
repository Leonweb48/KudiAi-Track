-- Customer loyalty profiles
create table if not exists customer_loyalty (
  id                    uuid default gen_random_uuid() primary key,
  user_id               uuid references auth.users not null,
  customer_name         text not null,
  phone                 text,
  email                 text,
  loyalty_id            text not null,
  points_balance        integer default 0 not null,
  total_points_earned   integer default 0 not null,
  cashback_balance      numeric(12,2) default 0 not null,
  total_cashback_earned numeric(12,2) default 0 not null,
  referral_code         text not null,
  referred_by           text,
  total_referrals       integer default 0 not null,
  notes                 text,
  created_at            timestamptz default now(),
  constraint customer_loyalty_uid_loyid  unique (user_id, loyalty_id),
  constraint customer_loyalty_uid_refcode unique (user_id, referral_code)
);

-- Loyalty event history (points earned/redeemed, cashback, referral bonuses)
create table if not exists loyalty_transactions (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references auth.users not null,
  customer_id    uuid references customer_loyalty on delete cascade not null,
  type           text not null,
  points_delta   integer default 0 not null,
  cashback_delta numeric(12,2) default 0 not null,
  description    text,
  transaction_ref uuid,
  created_at     timestamptz default now(),
  constraint loyalty_tx_type_check check (
    type in ('points_earned','points_redeemed','cashback_earned','cashback_redeemed','referral_bonus')
  )
);

-- Per-business loyalty program configuration
create table if not exists loyalty_settings (
  id                    uuid default gen_random_uuid() primary key,
  user_id               uuid references auth.users not null unique,
  is_active             boolean default true not null,
  points_per_100_naira  integer default 1 not null,
  cashback_percentage   numeric(5,2) default 0 not null,
  referral_bonus_points integer default 50 not null,
  min_purchase_amount   numeric(12,2) default 0 not null,
  updated_at            timestamptz default now()
);

-- RLS
alter table customer_loyalty     enable row level security;
alter table loyalty_transactions  enable row level security;
alter table loyalty_settings      enable row level security;

create policy "owner_all_customer_loyalty"
  on customer_loyalty for all using (auth.uid() = user_id);

create policy "owner_all_loyalty_transactions"
  on loyalty_transactions for all using (auth.uid() = user_id);

create policy "owner_all_loyalty_settings"
  on loyalty_settings for all using (auth.uid() = user_id);
