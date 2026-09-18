-- ═════════════════════════════════════════════════════════════════════════════
-- Real bug found in production testing: after a genuine wallet top-up, the
-- new auto-settle-on-credit trigger (20270119000000) never actually paid the
-- client out, and Retry (ajo-write's retry_wallet_payout) reported success
-- even though no money moved.
--
-- Root cause: the trigger was mounted AFTER INSERT ON wallet_ledger. But
-- wallet_credit() — the RPC every real top-up (Flutterwave webhook deposit)
-- and sale settlement runs through — INSERTs the wallet_ledger row BEFORE it
-- UPDATEs wallets.balance_kobo:
--
--     INSERT INTO wallet_ledger (..., balance_after_kobo) VALUES (...);  -- ← trigger fires HERE
--     UPDATE wallets SET balance_kobo = v_new WHERE id = v_wallet.id;    -- ← balance not yet written
--
-- So by the time the old trigger ran ajo_settle_due_wallet_payouts(), it
-- re-queried wallets.balance_kobo and saw the OLD, pre-credit balance —
-- concluding funds were still insufficient and marking the payout 'failed'
-- again (with a fresh, confusingly-timed failure notification), a few
-- statements before the real credit landed. ajo_settle_due_wallet_payouts()
-- itself was never wrong; it was asked the question too early.
--
-- Not every credit path orders these two writes the same way either
-- (ajo_settle_due_wallet_payouts's own client-credit branch, and
-- wallet_credit_settlement, both update wallets.balance_kobo BEFORE
-- inserting the ledger row) — so "insert-then-update" can't be assumed
-- project-wide, which rules out simply reordering wallet_credit() as a fix
-- (it would just move the same fragility onto whichever path is inverted
-- next). The reliable fix is to react to the thing we actually care about —
-- the balance itself changing — not a ledger row that may or may not have
-- been written before it.
--
-- Fix: move the trigger onto wallets itself, AFTER UPDATE, firing only when
-- balance_kobo increases. By construction this can only run once the new
-- balance is the row's live value, regardless of which function performed
-- the update or what order it wrote its ledger row in.
-- ═════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_ajo_settle_payouts_on_credit ON public.wallet_ledger;

CREATE OR REPLACE FUNCTION public.ajo_settle_payouts_on_wallet_credit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Bring back any payout that only failed because the balance was short —
  -- same reset the manual Retry button performs — scheduled for right now
  -- since money just actually landed, not "next business day".
  UPDATE public.ajo_wallet_payouts
  SET status = 'pending', scheduled_date = CURRENT_DATE, failure_reason = NULL
  WHERE owner_id = NEW.user_id
    AND status = 'failed'
    AND failure_reason = 'Owner wallet balance insufficient at settlement time';

  IF EXISTS (
    SELECT 1 FROM public.ajo_wallet_payouts
    WHERE owner_id = NEW.user_id AND status = 'pending' AND scheduled_date <= CURRENT_DATE
  ) THEN
    PERFORM public.ajo_settle_due_wallet_payouts(NEW.user_id, true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ajo_settle_payouts_on_credit ON public.wallets;
CREATE TRIGGER trg_ajo_settle_payouts_on_credit
  AFTER UPDATE ON public.wallets
  FOR EACH ROW
  WHEN (NEW.balance_kobo > OLD.balance_kobo)
  EXECUTE FUNCTION public.ajo_settle_payouts_on_wallet_credit();
