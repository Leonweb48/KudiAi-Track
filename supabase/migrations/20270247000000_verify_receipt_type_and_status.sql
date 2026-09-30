-- The public receipt check (kudiai.app/verify) now says WHAT the transaction was and WHETHER it went through:
--   kind   — a specific type ("Airtime purchase", "Transfer", "Esusu contribution"…) instead of "Cash in" / "Wallet debit"
--   status — 'successful' | 'pending' | 'failed' | 'reversed' (the app's own history vocabulary, see utils/historyEntries.js
--            statusOf), so a receipt for a failed or still-pending payment is no longer shown as plain "verified".
-- Still only non-identifying facts: no names, balances, phone / meter numbers, narrations or contact details. The kind is
-- always one of the fixed labels below — never free text from the row.

-- A bill's label from its stored category, or — for a wallet ledger row, which only has a narration — guessed from the text
-- (mirrors guessCategory in src/utils/historyEntries.js; \y is Postgres' word boundary).
CREATE OR REPLACE FUNCTION public.receipt_bill_label(p_category text, p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE COALESCE(NULLIF(lower(trim(p_category)), ''), CASE
             WHEN p_text ~* 'electric|\ymeter\y|\ytoken\y|prepaid|postpaid' THEN 'electricity'
             WHEN p_text ~* 'dstv|gotv|startimes?|showmax|cable' THEN 'cable'
             WHEN p_text ~* 'spectranet' THEN 'spectranet'
             WHEN p_text ~* '\ysmile\y' THEN 'smile'
             WHEN p_text ~* 'waec' THEN 'waec'
             WHEN p_text ~* 'jamb' THEN 'jamb'
             WHEN p_text ~* 'wallet top-?up|\ybet' THEN 'betting'
             WHEN p_text ~* 'airtime' THEN 'airtime'
             WHEN p_text ~* '\ydata\y|[0-9]\s?(gb|mb)\y' THEN 'data'
           END)
    WHEN 'airtime'        THEN 'Airtime purchase'
    WHEN 'airtime-bundle' THEN 'Airtime purchase'
    WHEN 'data'           THEN 'Data purchase'
    WHEN 'print-airtime'  THEN 'Airtime PIN purchase'
    WHEN 'print-data'     THEN 'Data PIN purchase'
    WHEN 'cable'          THEN 'Cable TV subscription'
    WHEN 'electricity'    THEN 'Electricity bill'
    WHEN 'betting'        THEN 'Betting wallet funding'
    WHEN 'waec'           THEN 'WAEC PIN purchase'
    WHEN 'jamb'           THEN 'JAMB PIN purchase'
    WHEN 'spectranet'     THEN 'Spectranet internet'
    WHEN 'smile'          THEN 'Smile internet'
    ELSE 'Bill payment'
  END
$function$;
REVOKE ALL ON FUNCTION public.receipt_bill_label(text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.receipt_bill_label(text, text) TO service_role;

-- Any stored status word → the four the verify page shows. Unknown / empty = successful, as in the app's history.
CREATE OR REPLACE FUNCTION public.receipt_status(p_status text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN lower(trim(p_status)) IN ('pending', 'processing', 'pending_approval', 'awaiting_approval', 'queued') THEN 'pending'
    WHEN lower(trim(p_status)) IN ('failed', 'rejected', 'declined', 'cancelled', 'canceled', 'error') THEN 'failed'
    WHEN lower(trim(p_status)) IN ('reversed', 'refunded') THEN 'reversed'
    ELSE 'successful'
  END
$function$;
REVOKE ALL ON FUNCTION public.receipt_status(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.receipt_status(text) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_receipt(p_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ref  text := upper(trim(COALESCE(p_ref, '')));
  v_src  record;
  v_out  jsonb;
BEGIN
  IF v_ref !~ '^KDT-[0-9]{6}-[A-Z2-9]{8}$' THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT source_table, source_id INTO v_src FROM public.receipt_references WHERE ref = v_ref;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  IF v_src.source_table = 'transactions' THEN
    SELECT jsonb_build_object('found', true,
             'kind', CASE
               -- a bill (same test as txEntry in historyEntries.js)
               WHEN t.payment_type = 'bill_payment'
                 OR (t.type IS DISTINCT FROM 'in' AND lower(COALESCE(t.category, '')) IN
                     ('airtime', 'data', 'cable', 'electricity', 'betting', 'waec', 'jamb', 'spectranet', 'smile',
                      'print-airtime', 'print-data', 'airtime-bundle'))
                 THEN public.receipt_bill_label(
                        CASE WHEN lower(COALESCE(t.category, '')) IN
                               ('airtime', 'data', 'cable', 'electricity', 'betting', 'waec', 'jamb', 'spectranet', 'smile',
                                'print-airtime', 'print-data', 'airtime-bundle') THEN t.category END,
                        COALESCE(t.item_name, '') || ' ' || COALESCE(t.note, ''))
               WHEN t.type = 'in' THEN CASE lower(COALESCE(t.category, ''))
                 WHEN 'credit sale'    THEN 'Credit sale'
                 WHEN 'debt repayment' THEN 'Debt repayment'
                 WHEN 'sale'           THEN 'Sale'
                 WHEN ''               THEN 'Sale'
                 ELSE 'Money received' END
               WHEN lower(COALESCE(t.category, '')) = 'stock' THEN 'Stock purchase'
               WHEN t.payment_type = 'wallet' THEN 'Wallet transfer'
               ELSE 'Expense'
             END,
             'status', public.receipt_status(t.bill_status),
             'amount', t.amount, 'occurred_at', t.created_at, 'business', p.business_name)
      INTO v_out FROM public.transactions t LEFT JOIN public.profiles p ON p.id = t.user_id WHERE t.id::text = v_src.source_id;
  ELSIF v_src.source_table = 'debt_payments' THEN
    SELECT jsonb_build_object('found', true, 'kind', 'Debt repayment', 'status', 'successful',
             'amount', d.amount, 'occurred_at', d.created_at, 'business', p.business_name)
      INTO v_out FROM public.debt_payments d LEFT JOIN public.profiles p ON p.id = d.owner_id WHERE d.id::text = v_src.source_id;
  ELSIF v_src.source_table = 'ajo_contributions' THEN
    SELECT jsonb_build_object('found', true,
             'kind', CASE
               WHEN a.type = 'contribution' THEN CASE a.contribution_context
                 WHEN 'esusu_rotation' THEN 'Esusu contribution'
                 WHEN 'group_savings'  THEN 'Group savings contribution'
                 ELSE 'Savings contribution' END
               WHEN a.type = 'withdrawal'             THEN 'Savings withdrawal'
               WHEN a.type = 'withdrawal_fee'         THEN 'Withdrawal fee'
               WHEN a.type = 'registration_fee'       THEN 'Registration fee'
               WHEN a.type IN ('esusu_payout', 'payout') THEN 'Esusu payout'
               WHEN a.type = 'deposit'                THEN 'Savings deposit'
               WHEN a.type = 'adjustment'             THEN 'Savings adjustment'
               WHEN a.type LIKE 'reversal%'           THEN 'Savings reversal'
               ELSE 'Savings entry'
             END,
             'status', public.receipt_status(a.status),
             'amount', a.amount, 'occurred_at', a.created_at, 'business', p.business_name)
      INTO v_out FROM public.ajo_contributions a LEFT JOIN public.profiles p ON p.id = a.owner_id WHERE a.id::text = v_src.source_id;
  ELSIF v_src.source_table = 'org_savings' THEN
    SELECT jsonb_build_object('found', true,
             'kind', CASE WHEN s.type = 'withdrawal' THEN 'Cooperative savings withdrawal' ELSE 'Cooperative savings deposit' END,
             'status', 'successful',
             'amount', s.amount, 'occurred_at', s.created_at, 'business', o.name)
      INTO v_out FROM public.org_savings s LEFT JOIN public.organizations o ON o.id = s.org_id WHERE s.id::text = v_src.source_id;
  ELSIF v_src.source_table = 'org_loan_repayments' THEN
    SELECT jsonb_build_object('found', true, 'kind', 'Cooperative loan repayment', 'status', 'successful',
             'amount', r.amount, 'occurred_at', r.created_at, 'business', o.name)
      INTO v_out FROM public.org_loan_repayments r LEFT JOIN public.organizations o ON o.id = r.org_id WHERE r.id::text = v_src.source_id;
  ELSIF v_src.source_table = 'wallet_ledger' THEN
    SELECT jsonb_build_object('found', true,
             -- the labels of src/utils/walletSources.js (WALLET_SOURCE)
             'kind', CASE w.source
               WHEN 'topup'                   THEN 'Wallet funding'
               WHEN 'sale'                    THEN 'Payment received'
               WHEN 'bill_spend'              THEN public.receipt_bill_label(NULL, COALESCE(w.narration, ''))
               WHEN 'bill_reversal'           THEN 'Bill refund'
               WHEN 'withdrawal'              THEN 'Transfer'
               WHEN 'withdrawal_reversal'     THEN 'Transfer refund'
               WHEN 'adjustment'              THEN 'Wallet adjustment'
               WHEN 'ajo_contribution'        THEN 'Savings contribution'
               WHEN 'ajo_collection'          THEN 'Contribution received'
               WHEN 'ajo_payout'              THEN 'Savings withdrawal'
               WHEN 'peer_esusu_contribution' THEN 'Circle contribution'
               WHEN 'peer_esusu_collection'   THEN 'Circle contribution received'
               WHEN 'peer_esusu_payout'       THEN 'Circle payout'
               WHEN 'peer_esusu_payout_sweep' THEN 'Circle pot paid out'
               WHEN 'subscription_spend'      THEN 'Subscription payment'
               WHEN 'subscription_reversal'   THEN 'Subscription refund'
               WHEN 'transfer_fee'            THEN 'Transfer fee'
               WHEN 'cbn_levy'                THEN 'CBN transfer levy'
               WHEN 'wallet_fee'              THEN 'Wallet transfer fee'
               ELSE 'Wallet ' || CASE WHEN w.direction = 'credit' THEN 'credit' ELSE 'debit' END
             END,
             'status', public.receipt_status(w.status),
             'amount', w.amount_kobo / 100.0, 'occurred_at', w.created_at, 'business', p.business_name)
      INTO v_out FROM public.wallet_ledger w LEFT JOIN public.profiles p ON p.id = w.user_id WHERE w.id::text = v_src.source_id;
  END IF;
  RETURN COALESCE(v_out, jsonb_build_object('found', false));
END;
$function$;
REVOKE ALL ON FUNCTION public.verify_receipt(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.verify_receipt(text) TO anon, authenticated, service_role;

-- Visibility: how the stored statuses spread across what the page will show (counts only — CI logs are public).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT 'transactions' AS tbl, public.receipt_status(t.bill_status) AS st, count(*) AS n
      FROM public.receipt_references rr JOIN public.transactions t ON t.id::text = rr.source_id
     WHERE rr.source_table = 'transactions' GROUP BY 1, 2
    UNION ALL
    SELECT 'ajo_contributions', public.receipt_status(a.status), count(*)
      FROM public.receipt_references rr JOIN public.ajo_contributions a ON a.id::text = rr.source_id
     WHERE rr.source_table = 'ajo_contributions' GROUP BY 1, 2
    UNION ALL
    SELECT 'wallet_ledger', public.receipt_status(w.status), count(*)
      FROM public.receipt_references rr JOIN public.wallet_ledger w ON w.id::text = rr.source_id
     WHERE rr.source_table = 'wallet_ledger' GROUP BY 1, 2
    ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'verify_receipt status | % % = %', r.tbl, r.st, r.n;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'verify_receipt status readout failed: %', SQLERRM;
END $$;
