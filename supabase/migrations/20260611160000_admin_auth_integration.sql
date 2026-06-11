-- ═══════════════════════════════════════════════════════════════
-- ADMIN AUTH INTEGRATION
-- Links admin_users to Supabase Auth so unified login works.
-- Creates is_admin() SECURITY DEFINER helper used by RLS.
-- ═══════════════════════════════════════════════════════════════

-- 1. Link admin_users to Supabase Auth users
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_admin_users_user_id ON admin_users(user_id);

-- 2. Helper: is the current session user an active admin?
--    SECURITY DEFINER so it can query admin_users despite RLS.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_users
    WHERE user_id = auth.uid()
      AND is_active = true
  );
$$;

-- 3. Replace "block everything" policies with is_admin()-gated ones
DROP POLICY IF EXISTS "admin_users_no_public"      ON admin_users;
DROP POLICY IF EXISTS "audit_log_no_public"        ON admin_audit_log;
DROP POLICY IF EXISTS "security_events_no_public"  ON security_events;
DROP POLICY IF EXISTS "system_errors_no_public"    ON system_errors;
DROP POLICY IF EXISTS "broadcasts_no_public"       ON admin_broadcasts;

-- Admin tables: only active admins can access
CREATE POLICY "admin_users_admin_only"      ON admin_users      FOR ALL USING (is_admin());
CREATE POLICY "audit_log_admin_only"        ON admin_audit_log  FOR ALL USING (is_admin());
CREATE POLICY "security_events_admin_only"  ON security_events  FOR ALL USING (is_admin());
CREATE POLICY "system_errors_admin_only"    ON system_errors    FOR ALL USING (is_admin());
CREATE POLICY "broadcasts_admin_only"       ON admin_broadcasts FOR ALL USING (is_admin());

-- 4. Allow admins to read/update all business data
DO $$ BEGIN

  -- profiles
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'admin_read_all_profiles'
  ) THEN
    CREATE POLICY "admin_read_all_profiles" ON profiles FOR SELECT USING (is_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'admin_update_profiles'
  ) THEN
    CREATE POLICY "admin_update_profiles" ON profiles FOR UPDATE USING (is_admin());
  END IF;

  -- subscriptions
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'admin_read_all_subs'
  ) THEN
    CREATE POLICY "admin_read_all_subs" ON subscriptions FOR SELECT USING (is_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'admin_update_subs'
  ) THEN
    CREATE POLICY "admin_update_subs" ON subscriptions FOR UPDATE USING (is_admin());
  END IF;

  -- transactions
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'admin_read_all_txns'
  ) THEN
    CREATE POLICY "admin_read_all_txns" ON transactions FOR SELECT USING (is_admin());
  END IF;

  -- organizations
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'organizations' AND policyname = 'admin_read_all_orgs'
  ) THEN
    CREATE POLICY "admin_read_all_orgs" ON organizations FOR SELECT USING (is_admin());
  END IF;

  -- org_members
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'org_members' AND policyname = 'admin_read_all_members'
  ) THEN
    CREATE POLICY "admin_read_all_members" ON org_members FOR SELECT USING (is_admin());
  END IF;

  -- aso_clients
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'aso_clients' AND policyname = 'admin_read_all_aso'
  ) THEN
    CREATE POLICY "admin_read_all_aso" ON aso_clients FOR SELECT USING (is_admin());
  END IF;

  -- staff
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'staff' AND policyname = 'admin_read_all_staff'
  ) THEN
    CREATE POLICY "admin_read_all_staff" ON staff FOR SELECT USING (is_admin());
  END IF;

END $$;
