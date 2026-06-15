-- Add Paystack subaccount support to organizations
-- Each org gets one subaccount; member contributions go directly to the org's bank account.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS bank_code                TEXT,
  ADD COLUMN IF NOT EXISTS account_number           TEXT,
  ADD COLUMN IF NOT EXISTS account_name             TEXT,
  ADD COLUMN IF NOT EXISTS paystack_subaccount_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_subaccount_id   TEXT,
  ADD COLUMN IF NOT EXISTS percentage_charge        NUMERIC(5,2) DEFAULT 100;

-- Member-initiated withdrawal requests (distinct from admin-initiated org_withdrawals)
CREATE TABLE IF NOT EXISTS org_member_withdrawal_requests (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id    UUID          NOT NULL REFERENCES org_members(id) ON DELETE CASCADE,
  amount       NUMERIC(12,2) NOT NULL,
  reason       TEXT,
  status       TEXT          NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','approved','rejected')),
  admin_notes  TEXT,
  reviewed_by  TEXT,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ   DEFAULT NOW()
);

ALTER TABLE org_member_withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- Members manage their own requests
CREATE POLICY "member_own_withdrawal_requests"
  ON org_member_withdrawal_requests
  FOR ALL TO authenticated
  USING (member_id IN (SELECT id FROM org_members WHERE user_id = auth.uid()))
  WITH CHECK (member_id IN (SELECT id FROM org_members WHERE user_id = auth.uid()));

-- Org owners and portal admins manage all requests in their org
CREATE POLICY "owner_manage_withdrawal_requests"
  ON org_member_withdrawal_requests
  FOR ALL TO authenticated
  USING (org_id IN (
    SELECT id FROM organizations WHERE owner_id = auth.uid()
    UNION
    SELECT org_id FROM org_members
    WHERE user_id = auth.uid() AND role IN ('admin','president','chairman','treasurer')
  ));

-- Service role has full access (edge functions)
CREATE POLICY "service_role_withdrawal_requests"
  ON org_member_withdrawal_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_org_wd_req_org    ON org_member_withdrawal_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_org_wd_req_member ON org_member_withdrawal_requests(member_id);
CREATE INDEX IF NOT EXISTS idx_org_wd_req_status ON org_member_withdrawal_requests(status);
