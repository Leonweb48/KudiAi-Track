-- Phase 1, Step 5: RLS lockdown — INSERT-only for all authenticated principals.
-- Deploy ONLY after Step 4 RPCs are live AND all callers (app + webhook)
-- have been confirmed to use RPCs via the smoke test (Step 4d).
--
-- This drops:
--   - "ajo_contributions_owner" (FOR ALL — allowed UPDATE and DELETE)
--   - "staff_ajo_contributions_update" (FOR UPDATE — allowed staff to mutate rows)
--
-- After this migration, no authenticated client can UPDATE or DELETE
-- ajo_contributions rows directly. The service role (webhook) uses
-- ajo_confirm_payment SECURITY DEFINER which bypasses RLS entirely.

-- Remove over-permissive policies
DROP POLICY IF EXISTS "ajo_contributions_owner"          ON ajo_contributions;
DROP POLICY IF EXISTS "staff_ajo_contributions_update"   ON ajo_contributions;

-- Replace with SELECT + INSERT only (for owner)
CREATE POLICY "ajo_contrib_owner_select" ON ajo_contributions
  FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "ajo_contrib_owner_insert" ON ajo_contributions
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- "staff_ajo_contributions_insert" (existing) — kept as-is
-- "ajo_contributions_client_select" (existing, if any) — kept as-is
