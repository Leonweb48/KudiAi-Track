-- Ajo Groups: one per savings circle; each group routes contributions
-- directly to the owner's bank account via a Paystack subaccount.
-- 100% of every contribution goes to the subaccount — the platform holds no funds.

CREATE TABLE IF NOT EXISTS ajo_groups (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                 UUID          NOT NULL,
  name                     TEXT          NOT NULL,
  description              TEXT,
  -- Settlement bank account (used when creating the Paystack subaccount)
  bank_code                TEXT,          -- Paystack bank code, e.g. "057" (Zenith)
  account_number           TEXT,          -- 10-digit NUBAN
  account_name             TEXT,          -- Resolved by Paystack resolve-account
  -- Paystack subaccount (created once; stored forever)
  paystack_subaccount_code TEXT,          -- e.g. ACCT_xxxxxxxxxx
  paystack_subaccount_id   TEXT,          -- Paystack internal ID
  percentage_charge        NUMERIC(5,2)  DEFAULT 100,   -- 100 = 100% to subaccount
  -- Default contribution settings for members of this group
  contribution_amount      NUMERIC(18,2),
  contribution_frequency   TEXT          DEFAULT 'monthly'
                             CHECK (contribution_frequency IN ('daily','weekly','monthly')),
  is_active                BOOLEAN       DEFAULT true,
  created_at               TIMESTAMPTZ   DEFAULT NOW(),
  updated_at               TIMESTAMPTZ   DEFAULT NOW()
);

ALTER TABLE ajo_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_manage_ajo_groups" ON ajo_groups
  FOR ALL TO authenticated
  USING   (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_ajo_groups_owner ON ajo_groups(owner_id);

-- Link Ajo clients to their group
ALTER TABLE aso_clients
  ADD COLUMN IF NOT EXISTS ajo_group_id UUID REFERENCES ajo_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_aso_clients_group ON aso_clients(ajo_group_id);

-- Enhance contributions table for Paystack payment lifecycle tracking
ALTER TABLE ajo_contributions
  ADD COLUMN IF NOT EXISTS paystack_status  TEXT          DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS paid_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_channel  TEXT,
  ADD COLUMN IF NOT EXISTS subaccount_code  TEXT,
  ADD COLUMN IF NOT EXISTS initiated_by     TEXT          DEFAULT 'business';
  -- initiated_by: 'business' (recorded by owner/staff) | 'client' (self-pay via Paystack)

-- Idempotency log: prevents duplicate processing of Paystack webhook events
CREATE TABLE IF NOT EXISTS paystack_webhook_log (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  event        TEXT          NOT NULL,
  reference    TEXT          NOT NULL UNIQUE,
  payload      JSONB,
  processed_at TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_ref ON paystack_webhook_log(reference);

-- Allow edge functions (service role) to insert into the log
ALTER TABLE paystack_webhook_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON paystack_webhook_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
