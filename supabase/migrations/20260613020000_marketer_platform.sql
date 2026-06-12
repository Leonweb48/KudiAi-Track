-- ============================================================
-- Marketer Platform Migration
-- 20260613020000_marketer_platform.sql
-- ============================================================

-- ── 1. Extend brm_marketers ─────────────────────────────────
ALTER TABLE brm_marketers
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'bronze'
    CHECK (tier IN ('bronze','silver','gold','platinum','diamond')),
  ADD COLUMN IF NOT EXISTS national_rank INT,
  ADD COLUMN IF NOT EXISTS performance_score INT DEFAULT 0;

-- ── 2. Extend profiles ──────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referred_by_marketer_id UUID
    REFERENCES brm_marketers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_code_used TEXT;

-- ── 3. Generate referral codes for existing marketers ────────
UPDATE brm_marketers
SET referral_code = 'MKT' || UPPER(SUBSTRING(MD5(id::text), 1, 6))
WHERE referral_code IS NULL;

-- ── 4. Commission config table ──────────────────────────────
CREATE TABLE IF NOT EXISTS marketer_commission_config (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('registration','subscription','renewal','organization','enterprise','bonus')),
  percentage   DECIMAL(5,4),
  amount       DECIMAL(10,2),
  is_percentage BOOLEAN NOT NULL DEFAULT true,
  plan         TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. Commissions table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketer_commissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id  UUID NOT NULL REFERENCES brm_marketers(id) ON DELETE CASCADE,
  business_id  UUID,
  config_id    UUID REFERENCES marketer_commission_config(id) ON DELETE SET NULL,
  type         TEXT NOT NULL,
  amount       DECIMAL(12,2) NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','paid','rejected')),
  reference    TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at  TIMESTAMPTZ,
  paid_at      TIMESTAMPTZ
);

-- ── 6. Bank accounts table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS marketer_bank_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id    UUID NOT NULL UNIQUE REFERENCES brm_marketers(id) ON DELETE CASCADE,
  bank_name      TEXT NOT NULL,
  bank_code      TEXT,
  account_number TEXT NOT NULL,
  account_name   TEXT NOT NULL,
  is_verified    BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 7. Payouts table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketer_payouts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id    UUID NOT NULL REFERENCES brm_marketers(id) ON DELETE CASCADE,
  amount         DECIMAL(12,2) NOT NULL,
  bank_name      TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','processing','paid','rejected')),
  reference      TEXT UNIQUE,
  notes          TEXT,
  admin_notes    TEXT,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMPTZ,
  processed_by   TEXT
);

-- ── 8. Notifications table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS marketer_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id UUID NOT NULL REFERENCES brm_marketers(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 9. Campaigns table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketer_campaigns (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT,
  bonus_type   TEXT NOT NULL CHECK (bonus_type IN ('flat','percentage','multiplier')),
  bonus_value  DECIMAL(10,4) NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  target_type  TEXT,
  target_value TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 10. Default commission config ───────────────────────────
INSERT INTO marketer_commission_config (name, type, percentage, is_percentage, is_active)
VALUES
  ('Business Registration',     'registration',  0.05, true, true),
  ('Basic Subscription',        'subscription',  0.10, true, true),
  ('Professional Subscription', 'subscription',  0.12, true, true),
  ('Enterprise Subscription',   'subscription',  0.15, true, true),
  ('Subscription Renewal',      'renewal',       0.05, true, true),
  ('Organisation Onboarding',   'organization',  0.08, true, true),
  ('Enterprise Package',        'enterprise',    0.15, true, true)
ON CONFLICT DO NOTHING;

-- ── 11. Auto-commission trigger ──────────────────────────────
CREATE OR REPLACE FUNCTION auto_create_commission()
RETURNS TRIGGER AS $$
DECLARE
  v_mid       UUID;
  v_cfg       RECORD;
  v_amt       DECIMAL;
  v_plan_price DECIMAL;
BEGIN
  SELECT m.id INTO v_mid
  FROM brm_marketers m
  JOIN profiles p ON p.referred_by_marketer_id = m.id
  WHERE p.id = NEW.user_id AND m.status = 'active'
  LIMIT 1;

  IF v_mid IS NULL THEN RETURN NEW; END IF;

  v_plan_price := CASE NEW.plan
    WHEN 'basic'        THEN 2000
    WHEN 'professional' THEN 5000
    WHEN 'enterprise'   THEN 15000
    ELSE 0
  END;

  IF v_plan_price = 0 THEN RETURN NEW; END IF;

  SELECT * INTO v_cfg
  FROM marketer_commission_config
  WHERE type = 'subscription'
    AND is_active = true
    AND (plan = NEW.plan OR plan IS NULL)
  ORDER BY plan NULLS LAST
  LIMIT 1;

  IF v_cfg IS NULL THEN RETURN NEW; END IF;

  IF v_cfg.is_percentage THEN
    v_amt := v_plan_price * v_cfg.percentage;
  ELSE
    v_amt := v_cfg.amount;
  END IF;

  INSERT INTO marketer_commissions (marketer_id, business_id, config_id, type, amount, status, reference)
  VALUES (v_mid, NEW.user_id, v_cfg.id, 'subscription', v_amt, 'pending', NEW.id::TEXT);

  INSERT INTO marketer_notifications (marketer_id, type, title, message)
  VALUES (
    v_mid,
    'commission',
    'Commission Earned!',
    '₦' || v_amt::TEXT || ' commission for a ' || NEW.plan || ' subscription'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_commission ON subscriptions;
CREATE TRIGGER trg_auto_commission
AFTER INSERT ON subscriptions
FOR EACH ROW EXECUTE FUNCTION auto_create_commission();

-- ── 12. RLS ──────────────────────────────────────────────────

-- marketer_commission_config (admins full, marketers read-only)
ALTER TABLE marketer_commission_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_commission_config" ON marketer_commission_config;
CREATE POLICY "admin_all_commission_config" ON marketer_commission_config
  FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "marketer_read_commission_config" ON marketer_commission_config;
CREATE POLICY "marketer_read_commission_config" ON marketer_commission_config
  FOR SELECT USING (is_active = true);

-- marketer_commissions
ALTER TABLE marketer_commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_commissions" ON marketer_commissions;
CREATE POLICY "admin_all_commissions" ON marketer_commissions
  FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "marketer_own_commissions" ON marketer_commissions;
CREATE POLICY "marketer_own_commissions" ON marketer_commissions
  FOR SELECT USING (
    marketer_id IN (SELECT id FROM brm_marketers WHERE owner_id = auth.uid())
  );

-- marketer_bank_accounts
ALTER TABLE marketer_bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_bank_accounts" ON marketer_bank_accounts;
CREATE POLICY "admin_all_bank_accounts" ON marketer_bank_accounts
  FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "marketer_own_bank_account" ON marketer_bank_accounts;
CREATE POLICY "marketer_own_bank_account" ON marketer_bank_accounts
  FOR ALL USING (
    marketer_id IN (SELECT id FROM brm_marketers WHERE owner_id = auth.uid())
  );

-- marketer_payouts
ALTER TABLE marketer_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_payouts" ON marketer_payouts;
CREATE POLICY "admin_all_payouts" ON marketer_payouts
  FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "marketer_own_payouts" ON marketer_payouts;
CREATE POLICY "marketer_own_payouts" ON marketer_payouts
  FOR ALL USING (
    marketer_id IN (SELECT id FROM brm_marketers WHERE owner_id = auth.uid())
  );

-- marketer_notifications
ALTER TABLE marketer_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_notifications" ON marketer_notifications;
CREATE POLICY "admin_all_notifications" ON marketer_notifications
  FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "marketer_own_notifications" ON marketer_notifications;
CREATE POLICY "marketer_own_notifications" ON marketer_notifications
  FOR ALL USING (
    marketer_id IN (SELECT id FROM brm_marketers WHERE owner_id = auth.uid())
  );

-- marketer_campaigns
ALTER TABLE marketer_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_campaigns" ON marketer_campaigns;
CREATE POLICY "admin_all_campaigns" ON marketer_campaigns
  FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "marketer_read_campaigns" ON marketer_campaigns;
CREATE POLICY "marketer_read_campaigns" ON marketer_campaigns
  FOR SELECT USING (is_active = true);
