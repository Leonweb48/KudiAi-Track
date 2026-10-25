-- READ-ONLY (2026-10-25, audit follow-up): the bill orders that paid under 97% of the server's price in the last 60 days —
-- bundle sub-orders sharing one payment, or real underpayments? Amounts, dates and counts only (no users, no refs). No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.cat, to_char(c.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI') at_l, c.face_kobo / 100 face, c.paid_kobo / 100 paid,
           c.verdict, (c.request_id <> c.base_ref) is_sub_order,
           (SELECT count(*) FROM public.bill_gate_claims x WHERE x.base_ref = c.base_ref) orders_on_payment,
           (SELECT sum(face_kobo) / 100 FROM public.bill_gate_claims x WHERE x.base_ref = c.base_ref) face_on_payment,
           (SELECT count(*) FROM public.bill_gate_claims x WHERE x.user_id = c.user_id) user_orders,
           (SELECT bill_status FROM public.transactions t WHERE t.payment_type = 'bill_payment' AND t.note ILIKE '%' || c.base_ref || '%' LIMIT 1) bill_status
      FROM public.bill_gate_claims c
     WHERE c.created_at > now() - interval '60 days' AND c.face_kobo > 0 AND c.paid_kobo > 0 AND c.paid_kobo < c.face_kobo * 0.97
     ORDER BY c.created_at LOOP
    RAISE NOTICE 'U1 % % | price ₦% paid ₦% | verdict % | sub-order % | orders on this payment % (price total ₦%) | this user''s orders % | bill %',
      r.at_l, r.cat, r.face, r.paid, r.verdict, r.is_sub_order, r.orders_on_payment, r.face_on_payment, r.user_orders, coalesce(r.bill_status, '?');
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
