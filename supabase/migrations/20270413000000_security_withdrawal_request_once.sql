-- Security audit 2026-10-25: approving a client's withdrawal REQUEST could pay it twice. ajo_record_withdrawal(p_request_id)
-- never checked that the request was still pending, nor that it belonged to this client and business — a double tap, two
-- staff approving at once, or a request id from another client recorded (and paid into a wallet) again.
-- Now, with a request id: the request row is locked, must be this client's and this business's, and must be pending —
-- otherwise nothing is recorded. Edited in place (the rest of the live function is untouched); stops if the text isn't
-- found exactly once.
DO $mig$
DECLARE
  v_def text; n int;
  anchor constant text := 'IF p_gross_amount IS NULL OR p_gross_amount <= 0 THEN';
  guard  constant text :=
'IF p_request_id IS NOT NULL THEN   -- a client request is approved once, for its own client and business (2026-10-25)
    PERFORM 1 FROM ajo_withdrawal_requests
      WHERE id = p_request_id AND aso_client_id = p_client_id AND owner_id = p_owner_id AND status = ''pending''
      FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(''ok'', false, ''error'', ''This withdrawal request was already handled or isn''''t for this client'');
    END IF;
  END IF;

  ';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'ajo_record_withdrawal';
  IF v_def IS NULL THEN RAISE EXCEPTION 'ajo_record_withdrawal not found'; END IF;
  IF position('a client request is approved once' IN v_def) > 0 THEN RAISE NOTICE 'withdrawal once | already applied'; RETURN; END IF;
  n := (length(v_def) - length(replace(v_def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'ajo_record_withdrawal: anchor found % times — refusing to guess', n; END IF;
  EXECUTE replace(v_def, anchor, guard || anchor);
  RAISE NOTICE 'withdrawal once | request check added';
END $mig$;
