-- Gate 1 verification: check email_delivery_log for recent ajo_* events
-- This migration just reads and reports — no writes.

DO $$
DECLARE
  r RECORD;
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM email_delivery_log
    WHERE created_at > NOW() - INTERVAL '24 hours'
      AND subject ILIKE '%ajo%' OR subject ILIKE '%contribution%' OR subject ILIKE '%reversal%' OR subject ILIKE '%withdrawal%';

  RAISE WARNING '── Gate 1 email_delivery_log check ────────────────────────────────────────';
  RAISE WARNING '  Ajo-related emails in last 24h: %', v_count;

  FOR r IN
    SELECT id, to_email, subject, status, error_msg, created_at
      FROM email_delivery_log
      WHERE created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 20
  LOOP
    RAISE WARNING '  [%] to=% subject=% status=% err=%',
      r.created_at::TEXT, r.to_email, LEFT(r.subject, 60), r.status, COALESCE(r.error_msg, '');
  END LOOP;

  IF v_count = 0 THEN
    RAISE WARNING '  ⚠  No ajo emails found — emails may not have fired yet or email_delivery_log is not populated by this endpoint';
  END IF;
END;
$$;
