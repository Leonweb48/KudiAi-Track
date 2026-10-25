-- READ-ONLY (2026-10-25): are correct transaction PINs being recorded (step 1 of the PIN-checked money functions)?
-- Counts only. No writes.
DO $$
BEGIN
  RAISE NOTICE 'pin proofs | rows % | newest % min ago | service_role may write: %',
    (SELECT count(*) FROM public.txn_pin_verifications),
    (SELECT round(extract(epoch FROM now() - max(verified_at)) / 60) FROM public.txn_pin_verifications),
    has_table_privilege('service_role', 'public.txn_pin_verifications', 'INSERT');
  RAISE NOTICE 'pin proofs | transaction PIN checks in the last hour (profiles touched): %',
    (SELECT count(*) FROM public.profiles WHERE txn_pin_attempts = 0 AND updated_at > now() - interval '1 hour');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
