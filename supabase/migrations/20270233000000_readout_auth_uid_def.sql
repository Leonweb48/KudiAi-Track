-- READ-ONLY diagnostic — prints auth.uid()'s real definition so a follow-up migration's self-test can set the
-- exact GUC it reads instead of guessing. No writes, nothing to roll back, safe to leave applied.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('auth.uid()'::regprocedure) INTO v_def;
  RAISE NOTICE 'auth.uid() definition: %', v_def;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'could not read auth.uid() definition: %', SQLERRM;
END $$;
