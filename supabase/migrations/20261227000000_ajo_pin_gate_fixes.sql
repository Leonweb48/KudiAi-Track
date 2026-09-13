-- Fixes a real PIN-lockout brute-force weakening: the portal PIN gate in
-- ajo-portal/index.ts previously read portal_pin_attempts, then wrote back
-- attempts+1 in a separate statement — two concurrent wrong-PIN submissions
-- can both read the same old value and both write the same incremented
-- value, undercounting attempts and letting the 5-try lockout be bypassed
-- under concurrency. This does the increment atomically in one UPDATE, whose
-- row lock serializes concurrent callers correctly.

CREATE OR REPLACE FUNCTION public.ajo_client_pin_fail(
  p_client_id       uuid,
  p_max_attempts    int DEFAULT 5,
  p_lockout_minutes int DEFAULT 30
)
RETURNS TABLE (attempts int, locked boolean, locked_until timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts     int;
  v_locked_until timestamptz;
BEGIN
  UPDATE aso_clients
  SET portal_pin_attempts = CASE WHEN portal_pin_attempts + 1 >= p_max_attempts THEN 0 ELSE portal_pin_attempts + 1 END,
      portal_pin_locked_until = CASE WHEN portal_pin_attempts + 1 >= p_max_attempts
        THEN now() + (p_lockout_minutes || ' minutes')::interval
        ELSE portal_pin_locked_until
      END
  WHERE id = p_client_id
  RETURNING aso_clients.portal_pin_attempts, aso_clients.portal_pin_locked_until
  INTO v_attempts, v_locked_until;

  RETURN QUERY SELECT v_attempts, (v_locked_until IS NOT NULL AND v_locked_until > now()), v_locked_until;
END;
$$;

REVOKE ALL ON FUNCTION public.ajo_client_pin_fail(uuid, int, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_client_pin_fail(uuid, int, int) TO service_role;

-- Same atomicity fix for a correct-PIN reset (idempotent either way, but
-- kept as an RPC for symmetry and so both paths go through one code path).
CREATE OR REPLACE FUNCTION public.ajo_client_pin_reset(p_client_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE aso_clients SET portal_pin_attempts = 0, portal_pin_locked_until = NULL WHERE id = p_client_id;
$$;

REVOKE ALL ON FUNCTION public.ajo_client_pin_reset(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_client_pin_reset(uuid) TO service_role;
