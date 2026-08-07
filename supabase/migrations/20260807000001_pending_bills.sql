-- pending_bills: stores the full bill payment intent server-side at Paystack
-- initialization time. The paystack-webhook uses this to fulfill the bill if
-- the user never returns to the app (phone dies, browser closed after payment).
create table if not exists pending_bills (
  reference     text primary key,
  user_id       uuid references auth.users(id) on delete set null,
  cat           text     not null,
  form_data     jsonb    not null default '{}',
  paid_amount   numeric  not null,
  verify_name   text,
  meter_address text,
  status        text     not null default 'pending'
                check (status in ('pending','processing','fulfilled','failed')),
  fulfillment   jsonb,
  created_at    timestamptz default now(),
  fulfilled_at  timestamptz
);

comment on table pending_bills is
  'Bill payment intents written at Paystack init; consumed by paystack-webhook for server-side fulfillment';

alter table pending_bills enable row level security;

-- Owners read/insert their own rows (anon insert blocked by RLS).
create policy "pending_bills_owner_select" on pending_bills
  for select using (auth.uid() = user_id);

create policy "pending_bills_owner_insert" on pending_bills
  for insert with check (auth.uid() = user_id);

-- Service role (webhook) bypasses RLS — no extra policy needed.
