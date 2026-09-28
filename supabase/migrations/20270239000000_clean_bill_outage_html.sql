-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Cleans up the raw HTML page that today's ClubKonnect outage left in customers' own history. The provider answered
-- with an IIS "500 - Internal server error" page instead of JSON, and until 4fc5847 the clubkonnect function passed
-- that whole page through as the error message — so it was saved in the failed bill's history note
-- ("FAILED: <!DOCTYPE html …> | PS: <ref>") and in the refund line of the wallet history ("Bill delivery failed
-- (<!DOCTYPE html …>) — refunded to wallet"). Every affected customer WAS refunded (20270238000000 readout: 8 of 8
-- wallet debits reversed, ₦0 outstanding); only the wording is wrong.
--
-- This swaps just the HTML chunk for the exact message the fixed function now returns, so these rows read the same
-- as any future failure. The reference, amounts, statuses and balances are not touched. If any HTML survives the
-- swap, the whole migration aborts (nothing half-cleaned).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  c_msg  CONSTANT text := 'The bill payment service is temporarily unavailable. Please try again shortly.';
  c_html CONSTANT text := '<!DOCTYPE.*</html>\s*';
  v_tx int; v_wl int; v_nt int; v_left int;
BEGIN
  -- bill history notes: "FAILED: <html> | PS: ref"  →  "FAILED: <message> | PS: ref"
  UPDATE public.transactions
     SET note = regexp_replace(note, c_html, c_msg || ' ')
   WHERE payment_type = 'bill_payment' AND bill_status = 'failed' AND note LIKE '%<!DOCTYPE%';
  GET DIAGNOSTICS v_tx = ROW_COUNT;

  -- wallet history refund lines: "Bill delivery failed (<html>) — refunded to wallet". Migrations pass the wallet
  -- write guard (it only stops signed-in users writing directly); only the narration text changes.
  UPDATE public.wallet_ledger
     SET narration = regexp_replace(narration, c_html, c_msg)
   WHERE source = 'bill_reversal' AND narration LIKE '%<!DOCTYPE%';
  GET DIAGNOSTICS v_wl = ROW_COUNT;

  -- any customer notification that quoted the error
  UPDATE public.notifications
     SET body = regexp_replace(body, c_html, c_msg)
   WHERE body LIKE '%<!DOCTYPE%';
  GET DIAGNOSTICS v_nt = ROW_COUNT;

  SELECT (SELECT count(*) FROM public.transactions  WHERE payment_type = 'bill_payment' AND bill_status = 'failed' AND note LIKE '%<!DOCTYPE%')
       + (SELECT count(*) FROM public.wallet_ledger WHERE source = 'bill_reversal' AND narration LIKE '%<!DOCTYPE%')
       + (SELECT count(*) FROM public.notifications  WHERE body LIKE '%<!DOCTYPE%')
    INTO v_left;
  IF v_left > 0 THEN RAISE EXCEPTION 'bill outage cleanup: % row(s) still contain the raw HTML page — aborting, nothing changed', v_left; END IF;

  RAISE NOTICE 'bill outage cleanup: % bill history note(s), % wallet refund line(s), % notification(s) cleaned', v_tx, v_wl, v_nt;
END $$;
