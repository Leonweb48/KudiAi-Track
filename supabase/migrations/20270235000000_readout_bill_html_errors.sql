-- READ-ONLY diagnostic — how widespread/recent is the raw-HTML-leaked-as-error-message problem right now?
-- No writes, nothing to roll back, safe to leave applied.
DO $$
DECLARE v_count int; v_latest timestamptz; v_earliest timestamptz; v_sample text;
BEGIN
  SELECT count(*), max(created_at), min(created_at)
    INTO v_count, v_latest, v_earliest
    FROM public.transactions
   WHERE bill_status = 'failed' AND note LIKE '%<!DOCTYPE%' AND created_at > now() - interval '7 days';
  RAISE NOTICE 'raw-HTML bill failures in the last 7 days: count=% earliest=% latest=%', v_count, v_earliest, v_latest;

  SELECT left(note, 200) INTO v_sample FROM public.transactions
   WHERE bill_status = 'failed' AND note LIKE '%<!DOCTYPE%' AND created_at > now() - interval '7 days'
   ORDER BY created_at DESC LIMIT 1;
  RAISE NOTICE 'most recent sample note (first 200 chars): %', v_sample;

  SELECT count(*) INTO v_count FROM public.transactions
   WHERE bill_status = 'failed' AND created_at > now() - interval '24 hours';
  RAISE NOTICE 'ALL failed bill transactions in the last 24h (any reason): %', v_count;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
