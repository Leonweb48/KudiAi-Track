-- Every document the app makes is verifiable (2026-10-03, owner request): invoices and invoice receipts, a customer's
-- credit payment history, the transaction and bill payment statements and the Ajo contribution card now carry a KDR
-- reference + QR code like reports and statements, saved here with their headline figures.
--   1. report_verifications accepts invoice, invoice_receipt, credit_statement, transaction_statement, bill_statement,
--      contribution_card
--   2. verify_receipt names them and says what kind of document each is ('doc': report | statement | invoice | receipt |
--      card) for the verify page's wording; re-created from 20270276 with those lines added — it keeps its name (the anon
--      lockdown allow-lists it); receipts (KDT) behave exactly as before

ALTER TABLE public.report_verifications DROP CONSTRAINT IF EXISTS report_verifications_report_type_check;
ALTER TABLE public.report_verifications ADD CONSTRAINT report_verifications_report_type_check
  CHECK (report_type IN ('sales', 'credit', 'aso', 'bills', 'staff', 'stock', 'general',
                         'savings_statement', 'wallet_statement', 'monthly_statement',
                         'invoice', 'invoice_receipt', 'credit_statement', 'transaction_statement', 'bill_statement',
                         'contribution_card'));

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
  -- An owner's report (2026-10-02): KDR-YYYYMM-XXXXXXXX, issued when the report PDF was generated. Shows what the report
  -- is, for which business and period, when it was made, and its headline figures, so whoever holds the PDF can check
  -- the printed figures were not changed.
  IF v_ref ~ '^KDR-[0-9]{6}-[A-Z2-9]{8}$' THEN
    SELECT jsonb_build_object('found', true, 'is_report', true,
             'kind', CASE r.report_type
               WHEN 'sales'  THEN 'Sales report'
               WHEN 'credit' THEN 'Credit report'
               WHEN 'aso'    THEN 'Ajo savings report'
               WHEN 'bills'  THEN 'Bills report'
               WHEN 'staff'  THEN 'Staff performance report'
               WHEN 'stock'  THEN 'Stock report'
               WHEN 'general' THEN 'Business report'
               WHEN 'savings_statement' THEN 'Savings statement'
               WHEN 'wallet_statement'  THEN 'Wallet statement'
               WHEN 'monthly_statement' THEN 'Monthly statement'
               WHEN 'invoice'               THEN 'Invoice'
               WHEN 'invoice_receipt'       THEN 'Payment receipt'
               WHEN 'credit_statement'      THEN 'Credit payment history'
               WHEN 'transaction_statement' THEN 'Transaction statement'
               WHEN 'bill_statement'        THEN 'Bill payment statement'
               WHEN 'contribution_card'     THEN 'Contribution card'
               ELSE 'Report' END,
             'is_statement', r.report_type LIKE '%\_statement',
             -- what the document is, for the verify page's wording (older pages read is_statement)
             'doc', CASE WHEN r.report_type LIKE '%\_statement' THEN 'statement'
                         WHEN r.report_type = 'invoice'           THEN 'invoice'
                         WHEN r.report_type = 'invoice_receipt'   THEN 'receipt'
                         WHEN r.report_type = 'contribution_card' THEN 'card'
                         ELSE 'report' END,
             'status', 'successful',
             'business', COALESCE(NULLIF(btrim(r.business_name), ''), p.business_name),
             'account_business', p.business_name,
             'period_from', r.period_from, 'period_to', r.period_to,
             'occurred_at', r.generated_at,
             'summary', r.summary)
      INTO v_out FROM public.report_verifications r LEFT JOIN public.profiles p ON p.id = r.owner_id WHERE r.ref = v_ref;
    RETURN COALESCE(v_out, jsonb_build_object('found', false));
  END IF;
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
