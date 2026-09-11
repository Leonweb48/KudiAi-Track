-- ═════════════════════════════════════════════════════════════════════════════
-- Root cause of "an Ajo approval is stuck — can't approve, can't reject":
--
-- The owner's "Pending Deposits" queue shows every ajo_contributions row with
-- status='pending', regardless of payment_method, with a generic Approve /
-- Reject button pair (Aso.jsx). Approve already calls the generic
-- ajo_approve_contribution RPC (works for any pending row) — but Reject was
-- hard-wired to ajo_reject_manual_claim, whose query required
-- payment_method = 'manual_transfer'. Any pending row from a different
-- source (a Paystack checkout that was started but never completed, an
-- owner-recorded entry, etc.) could never be rejected: the query always
-- matched zero rows and returned "Claim not found or already processed",
-- no matter how many times it was retried.
--
-- This is exactly what happened: a client began a Paystack contribution
-- right as Paystack was being retired from the client app (see the
-- initialize-payment hard-block in ajo-portal), the checkout was never
-- completed, and the resulting 'pending' row had nowhere to go — Approve
-- would have wrongly credited a payment that was never actually received,
-- and Reject always failed.
--
-- Fix: widen the match to any pending contribution (drop the payment_method
-- filter). Everything else — the reason requirement, owner-authorization
-- check, the reject itself — is unchanged, so this only removes the
-- artificial restriction, and applies to owner, staff, and any future
-- payment_method uniformly.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ajo_reject_manual_claim(p_claim_id uuid, p_owner_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_claim record;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Reason is required (min 3 characters)');
  END IF;

  SELECT * INTO v_claim
  FROM ajo_contributions
  WHERE id     = p_claim_id
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Claim not found or already processed');
  END IF;

  IF v_claim.owner_id IS NOT NULL AND v_claim.owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  UPDATE ajo_contributions SET
    status           = 'rejected',
    paystack_status  = 'rejected',
    rejected_reason  = p_reason
  WHERE id = p_claim_id;

  RETURN jsonb_build_object(
    'ok',       true,
    'claim_id', p_claim_id,
    'client_id', v_claim.aso_client_id,
    'amount',   v_claim.amount
  );
END;
$$;
