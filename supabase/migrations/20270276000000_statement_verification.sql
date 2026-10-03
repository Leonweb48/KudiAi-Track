-- Statement PDFs get verified like owner reports (2026-10-03): every savings / wallet / monthly statement PDF — made in
-- the app or attached to the monthly email — carries a KDR reference + QR code, saved here with its headline figures.
--   1. report_verifications accepts savings_statement, wallet_statement, monthly_statement
--   2. verify_receipt names them and says they are statements (is_statement → "Account holder" on the verify page);
--      re-created from 20270271 with those lines added — it keeps its name (the anon lockdown allow-lists it)
--   3. client_savings_statement also returns the client's email and address (printed on the statement) and the
--      business's id (who owns a reference made for a client without a login); re-created from 20270273 otherwise as is

ALTER TABLE public.report_verifications DROP CONSTRAINT IF EXISTS report_verifications_report_type_check;
ALTER TABLE public.report_verifications ADD CONSTRAINT report_verifications_report_type_check
  CHECK (report_type IN ('sales', 'credit', 'aso', 'bills', 'staff', 'stock', 'general',
                         'savings_statement', 'wallet_statement', 'monthly_statement'));

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
               ELSE 'Report' END,
             'is_statement', r.report_type LIKE '%\_statement',
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

CREATE OR REPLACE FUNCTION public.client_savings_statement(p_client_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_c        record;
  v_biz      jsonb;
  v_total    numeric;
  v_before   numeric;
  v_forward  numeric;
  v_entries  jsonb;
  v_in       numeric;
  v_out      numeric;
BEGIN
  SELECT c.id, c.full_name, c.membership_number, c.phone, c.email, c.address, c.lga, c.state,
         c.current_balance, c.user_id, c.client_user_id
    INTO v_c FROM public.aso_clients c WHERE c.id = p_client_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT to_jsonb(p) INTO v_biz FROM public.profiles p WHERE p.id = v_c.user_id;

  WITH e AS (
    SELECT a.id, a.created_at, a.amount::numeric AS amount, public.ajo_entry_sign(a.type) AS sgn
      FROM public.ajo_contributions a
     WHERE a.aso_client_id = p_client_id AND a.status = 'completed' AND public.ajo_entry_sign(a.type) <> 0
  )
  SELECT COALESCE(SUM(sgn * amount), 0),
         COALESCE(SUM(sgn * amount) FILTER (WHERE created_at < p_from), 0)
    INTO v_total, v_before
    FROM e;

  v_forward := COALESCE(v_c.current_balance, 0) - v_total;

  WITH e AS (
    SELECT a.id, a.created_at, a.type, a.amount::numeric AS amount, a.receipt_ref, a.contribution_context, a.cycle_id,
           g.name AS group_name, public.ajo_entry_sign(a.type) AS sgn
      FROM public.ajo_contributions a
      LEFT JOIN public.ajo_groups g ON g.id = a.group_id
     WHERE a.aso_client_id = p_client_id AND a.status = 'completed' AND public.ajo_entry_sign(a.type) <> 0
  ), r AS (
    SELECT e.*, SUM(e.sgn * e.amount) OVER (ORDER BY e.created_at, e.id) AS run FROM e
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'at',      r.created_at,
           'type',    r.type,
           'label',   public.ajo_entry_label(r.type, r.contribution_context, r.group_name, r.cycle_id),
           'ref',     COALESCE(r.receipt_ref, ''),
           'credit',  r.sgn > 0,
           'amount',  r.amount,
           'balance', round(v_forward + r.run, 2)
         ) ORDER BY r.created_at, r.id), '[]'::jsonb),
         COALESCE(SUM(r.amount) FILTER (WHERE r.sgn > 0), 0),
         COALESCE(SUM(r.amount) FILTER (WHERE r.sgn < 0), 0)
    INTO v_entries, v_in, v_out
    FROM r
   WHERE r.created_at >= p_from AND r.created_at < p_to;

  RETURN jsonb_build_object(
    'client', jsonb_build_object('id', v_c.id, 'name', v_c.full_name, 'membership_number', v_c.membership_number,
                                 'phone', v_c.phone, 'email', COALESCE(v_c.email, ''), 'address', COALESCE(v_c.address, ''),
                                 'lga', COALESCE(v_c.lga, ''), 'state', COALESCE(v_c.state, ''),
                                 'user_id', v_c.client_user_id, 'current_balance', COALESCE(v_c.current_balance, 0)),
    'business', jsonb_build_object(
       'id',      v_c.user_id,
       'name',    COALESCE(v_biz->>'business_name', ''),
       'phone',   COALESCE(NULLIF(v_biz->>'business_phone', ''), v_biz->>'phone', ''),
       'address', COALESCE(NULLIF(v_biz->>'business_address', ''), v_biz->>'address', '')),
    'from', p_from, 'to', p_to,
    'opening', round(v_forward + v_before, 2),
    'total_in', round(v_in, 2),
    'total_out', round(v_out, 2),
    'closing', round(v_forward + v_before + v_in - v_out, 2),
    'brought_forward', round(v_forward, 2),
    'entries', v_entries
  );
END;
$function$;
