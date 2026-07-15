-- Pin-gate staff disbursements and credit repayments.
--
-- staff_disbursements: remove direct-write RLS for owner JWT — all inserts now
-- go through the coop-portal edge function which verifies the transaction PIN
-- before writing. Owners keep SELECT so they can read their own disbursement history.
--
-- debt_payments: same treatment — repayment records are now written exclusively
-- by the ajo-write edge function (record_credit_repayment action). Keeps SELECT
-- for owner and staff-read policies unchanged.

-- ── staff_disbursements ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "owner_manage_disbursements" ON public.staff_disbursements;

CREATE POLICY "owner_read_disbursements" ON public.staff_disbursements
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

-- staff_read_own_disbursements (SELECT only) is already correct — no change.

-- ── debt_payments ─────────────────────────────────────────────────────────────
-- Replace the owner FOR ALL policy with SELECT-only; drop the staff insert policy.
-- The ajo-write service-role client handles all inserts.
DROP POLICY IF EXISTS "dp_owner_all"     ON public.debt_payments;
DROP POLICY IF EXISTS "dp_staff_insert"  ON public.debt_payments;

CREATE POLICY "dp_owner_read" ON public.debt_payments
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());
