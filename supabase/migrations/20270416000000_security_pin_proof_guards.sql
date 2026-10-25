-- Security audit 2026-10-25, part 2 of 20270415: each money function, called by a USER, now requires a correct
-- transaction PIN within the last 5 minutes (txn_pin_recently_verified). Server-run work is unaffected.
-- Edited in place (each function's own code is untouched apart from one check at the top).
DO $mig$
DECLARE
  f      text;
  r      record;
  v_def  text;
  pos    int;
  guard  constant text := E'\n  IF NOT public.txn_pin_recently_verified() THEN   -- a correct transaction PIN in the last 5 minutes (2026-10-25)\n    RAISE EXCEPTION ''Enter your transaction PIN to continue'' USING ERRCODE = ''42501'';\n  END IF;\n';
BEGIN
  FOREACH f IN ARRAY ARRAY['wallet_debit_for_bill', 'wallet_hold_transfer', 'wallet_create_scheduled_transfer',
                           'wallet_pay_ajo_contribution', 'peer_esusu_pay_contribution', 'wallet_submit_withdrawal'] LOOP
    FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
              WHERE ns.nspname = 'public' AND p.proname = f LOOP
      v_def := pg_get_functiondef(r.oid);
      IF position('a correct transaction PIN in the last 5 minutes' IN v_def) > 0 THEN
        RAISE NOTICE 'pin proof | % already guarded', f; CONTINUE;
      END IF;
      pos := position(E'\nBEGIN\n' IN v_def);
      IF pos = 0 THEN RAISE EXCEPTION 'pin proof | % has no top-level BEGIN line — refusing to guess', f; END IF;
      EXECUTE substr(v_def, 1, pos + 6) || guard || substr(v_def, pos + 7);
      RAISE NOTICE 'pin proof | % guarded', f;
    END LOOP;
  END LOOP;
END $mig$;
