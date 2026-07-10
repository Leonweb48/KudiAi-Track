-- ═══════════════════════════════════════════════════════════════════════════
-- Fix: RLS policies for referral_config, referral_codes, and referrals tables
-- Business users must be able to read the referral program config, read/create
-- their own referral code, and see their own referred users.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── referral_config ───────────────────────────────────────────────────────
-- Global config — all authenticated users can read it.

ALTER TABLE IF EXISTS referral_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_referral_config" ON referral_config;
CREATE POLICY "authenticated_read_referral_config"
  ON referral_config FOR SELECT
  TO authenticated
  USING (true);

-- ── referral_codes ────────────────────────────────────────────────────────
-- Each user has one row. They can read and create their own.

ALTER TABLE IF EXISTS referral_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_referral_code" ON referral_codes;
CREATE POLICY "users_read_own_referral_code"
  ON referral_codes FOR SELECT
  TO authenticated
  USING (referrer_user_id = auth.uid());

DROP POLICY IF EXISTS "users_insert_own_referral_code" ON referral_codes;
CREATE POLICY "users_insert_own_referral_code"
  ON referral_codes FOR INSERT
  TO authenticated
  WITH CHECK (referrer_user_id = auth.uid());

-- ── referrals ─────────────────────────────────────────────────────────────
-- Referrers can see every referral they originated.

ALTER TABLE IF EXISTS referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_referrals" ON referrals;
CREATE POLICY "users_read_own_referrals"
  ON referrals FOR SELECT
  TO authenticated
  USING (referrer_user_id = auth.uid());
