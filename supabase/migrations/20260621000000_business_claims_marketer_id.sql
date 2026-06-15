-- ============================================================
-- Business Claims (Marketer ownership claim workflow)
-- ============================================================
CREATE TABLE IF NOT EXISTS business_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id UUID NOT NULL REFERENCES brm_marketers(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  business_name TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by UUID, -- admin_users.id
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claims_marketer ON business_claims(marketer_id, status);
CREATE INDEX IF NOT EXISTS idx_claims_business ON business_claims(business_id, status);
CREATE INDEX IF NOT EXISTS idx_claims_status ON business_claims(status, created_at DESC);

-- Only one active claim per business at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_unique_active
  ON business_claims(business_id)
  WHERE status IN ('pending','approved');

-- ============================================================
-- Add marketer_id to profiles if not exists
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS marketer_id UUID REFERENCES brm_marketers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_marketer ON profiles(marketer_id);

-- ============================================================
-- Auto-approve: function to link business when claim approved
-- ============================================================
CREATE OR REPLACE FUNCTION handle_claim_approval()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    -- Link business to marketer
    UPDATE profiles
    SET marketer_id = NEW.marketer_id
    WHERE id = NEW.business_id;

    -- Queue commission calculation notification
    INSERT INTO admin_notifications(type, category, title, message, link)
    VALUES (
      'success', 'finance',
      'Business Claim Approved',
      'Marketer claim for ' || COALESCE(NEW.business_name, 'a business') || ' was approved. Commission will be calculated.',
      '/commissions'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_claim_approval ON business_claims;
CREATE TRIGGER on_claim_approval
  AFTER UPDATE ON business_claims
  FOR EACH ROW
  EXECUTE FUNCTION handle_claim_approval();

-- ============================================================
-- RLS: service role can do everything; marketers can read own claims
-- ============================================================
ALTER TABLE business_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_claims" ON business_claims
  TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Add referred_by_marketer_id alias for backwards compat
-- ============================================================
-- Many existing queries use referred_by_marketer_id; add as alias column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by_marketer_id UUID REFERENCES brm_marketers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by ON profiles(referred_by_marketer_id);

-- ============================================================
-- Platform activity log: extend category list
-- ============================================================
ALTER TABLE platform_activity_log
  DROP CONSTRAINT IF EXISTS platform_activity_log_category_check;

ALTER TABLE platform_activity_log
  ADD CONSTRAINT platform_activity_log_category_check
  CHECK (category IN (
    'auth','profile','transaction','ajo','org','staff',
    'inventory','support','system','general','marketer',
    'commission','claim','payout','subscription'
  ));

-- ============================================================
-- Add SLA and assignment fields to support_tickets if missing
-- ============================================================
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_admin_id UUID;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Update ticket_number generation function to handle longer sequences
DROP FUNCTION IF EXISTS generate_ticket_number() CASCADE;
CREATE OR REPLACE FUNCTION generate_ticket_number()
RETURNS TEXT AS $$
DECLARE
  seq BIGINT;
  priority_prefix TEXT;
BEGIN
  SELECT COALESCE(MAX(SUBSTRING(ticket_number FROM 4)::BIGINT), 0) + 1
  INTO seq FROM support_tickets WHERE ticket_number IS NOT NULL;
  RETURN 'KT-' || LPAD(seq::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;
