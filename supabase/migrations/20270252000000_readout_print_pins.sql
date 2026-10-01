-- READ-ONLY diagnostic (2026-10-01): "Print Airtime and Print Data are not working — like there is a conflict".
-- Every print-airtime / print-data attempt of the last 36 hours: the order record and error text, the payment gate's
-- decisions (bill_gate_log / bill_gate_claims), provider claims and wallet debits. Digit runs (phone numbers, references,
-- PINs) masked; no names, no PINs — CI logs are public. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT to_char(created_at, 'MM-DD HH24:MI') AS at, category AS cat, coalesce(bill_status, '?') AS st, amount,
           left(regexp_replace(coalesce(item_name, ''), '\d{5,}', '#', 'g'), 50) AS item,
           left(regexp_replace(coalesce(nullif(split_part(split_part(note, 'FAILED: ', 2), ' | PS:', 1), ''), '-'), '\d{5,}', '#', 'g'), 160) AS err,
           (note ~ '__PINS__') AS has_pins
      FROM public.transactions
     WHERE category IN ('print-airtime', 'print-data', 'airtime-bundle') AND created_at > now() - interval '36 hours'
     ORDER BY created_at
  LOOP
    RAISE NOTICE 'print order % % % amt=% item=% pins=% err=%', r.at, r.cat, r.st, r.amount, r.item, r.has_pins, r.err;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part A failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT to_char(created_at, 'MM-DD HH24:MI') AS at, cat, reason, enforced, face_kobo, paid_kobo, required_kobo,
           left(regexp_replace(coalesce(detail, ''), '\d{5,}', '#', 'g'), 160) AS detail
      FROM public.bill_gate_log
     WHERE created_at > now() - interval '36 hours' AND (cat ILIKE 'print%' OR cat = 'airtime-bundle')
     ORDER BY created_at
  LOOP
    RAISE NOTICE 'gate log % % reason=% enforced=% face=% paid=% required=% detail=%', r.at, r.cat, r.reason, r.enforced, r.face_kobo, r.paid_kobo, r.required_kobo, r.detail;
  END LOOP;
  FOR r IN
    SELECT to_char(created_at, 'MM-DD HH24:MI') AS at, cat, verdict, face_kobo, paid_kobo, allowance_kobo, (coupon_code IS NOT NULL) AS coupon,
           (request_id <> base_ref) AS sub_order
      FROM public.bill_gate_claims
     WHERE created_at > now() - interval '36 hours' AND (cat ILIKE 'print%')
     ORDER BY created_at
  LOOP
    RAISE NOTICE 'gate claim % % verdict=% face=% paid=% allowance=% coupon=% sub_order=%', r.at, r.cat, r.verdict, r.face_kobo, r.paid_kobo, r.allowance_kobo, r.coupon, r.sub_order;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part B failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT to_char(created_at, 'MM-DD HH24:MI') AS at, service, array_to_string(providers, '>') AS prov
      FROM public.bill_provider_attempts
     WHERE created_at > now() - interval '36 hours' AND service ILIKE 'print%'
     ORDER BY created_at
  LOOP
    RAISE NOTICE 'provider claim % % %', r.at, r.service, r.prov;
  END LOOP;
  FOR r IN
    SELECT to_char(created_at, 'MM-DD HH24:MI') AS at, source, status, amount_kobo / 100 AS naira,
           left(regexp_replace(coalesce(narration, ''), '\d{5,}', '#', 'g'), 60) AS narration
      FROM public.wallet_ledger
     WHERE created_at > now() - interval '36 hours' AND source IN ('bill_spend', 'bill_reversal')
       AND narration ~* 'print|pin|bundle'
     ORDER BY created_at
  LOOP
    RAISE NOTICE 'wallet % % % N% %', r.at, r.source, r.status, r.naira, r.narration;
  END LOOP;
  RAISE NOTICE 'readout time (UTC): %', to_char(now(), 'MM-DD HH24:MI');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part C failed: %', SQLERRM;
END $$;
