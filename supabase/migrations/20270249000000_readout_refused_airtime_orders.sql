-- READ-ONLY diagnostic (2026-09-30): two airtime orders at ~12:30 / 12:45 UTC were refused by ClubKonnect (its error page,
-- shown as "temporarily unavailable") while orders before and after went through. Compare them with the successful ones —
-- amount, network, the number's SHAPE (length, first 4 digits, +234 form, stray characters), same number as a success?,
-- who paid (owner / staff / other) and the gate's view of the payment. Never the full number, a name or an id: CI logs are
-- public. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    WITH t AS (
      SELECT t.*, regexp_replace(coalesce(t.customer_name, ''), '\D', '', 'g') AS digits,
             nullif(substring(t.note FROM 'Network: ([A-Za-z0-9]+)'), '') AS net,
             substring(t.note FROM '(KDT-BILL-[A-Za-z0-9]+)') AS ref
        FROM public.transactions t
       WHERE t.payment_type = 'bill_payment' AND t.category IN ('airtime', 'data') AND t.created_at > now() - interval '6 hours'
    )
    SELECT to_char(t.created_at, 'HH24:MI') AS at, t.category AS cat, t.bill_status AS st, t.amount,
           coalesce(t.net, '?') AS net, length(t.digits) AS len, left(t.digits, 4) AS pfx,
           (t.customer_name ~ '[^0-9]') AS odd_chars, (t.digits LIKE '234%') AS intl,
           EXISTS (SELECT 1 FROM t s WHERE s.bill_status = 'success' AND s.digits = t.digits AND s.id <> t.id) AS same_no_as_success,
           (SELECT string_agg(DISTINCT s.net, '/') FROM t s WHERE s.bill_status = 'success' AND s.digits = t.digits) AS success_net,
           CASE WHEN t.staff_id IS NOT NULL THEN 'staff' WHEN p.id IS NOT NULL THEN 'owner' ELSE 'other' END AS payer,
           (SELECT count(DISTINCT s.user_id) FROM t s) AS payers,
           g.face_kobo, g.paid_kobo, g.verdict,
           left(regexp_replace(coalesce(nullif(split_part(split_part(t.note, 'FAILED: ', 2), ' | PS:', 1), ''), '-'), '\d{5,}', '#', 'g'), 90) AS err
      FROM t
      LEFT JOIN public.profiles p ON p.id = t.user_id
      LEFT JOIN public.bill_gate_claims g ON g.request_id = t.ref
     ORDER BY t.created_at
  LOOP
    RAISE NOTICE 'order % % % amt=% net=% len=% pfx=% odd=% intl=% sameNoAsSuccess=% successNet=% payer=% payers=% gate(face=%,paid=%,%) err=%',
      r.at, r.cat, r.st, r.amount, r.net, r.len, r.pfx, r.odd_chars, r.intl, r.same_no_as_success, r.success_net, r.payer, r.payers,
      r.face_kobo, r.paid_kobo, r.verdict, r.err;
  END LOOP;
  RAISE NOTICE 'readout time (UTC): %', to_char(now(), 'YYYY-MM-DD HH24:MI');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'refused-orders readout failed: %', SQLERRM;
END $$;
