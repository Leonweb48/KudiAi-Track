-- Supabase auto-grants EXECUTE to anon and authenticated when functions are
-- created — REVOKE FROM PUBLIC (000011) did not remove those explicit grants.
-- This migration revokes them so only service_role can call the write RPCs.

REVOKE EXECUTE ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID)   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION ajo_reverse_contribution(UUID, UUID, TEXT)                           FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION ajo_archive_client(UUID, UUID)                                       FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION ajo_confirm_payment(TEXT, TIMESTAMPTZ, TEXT)                         FROM anon, authenticated;

-- Verify
DO $$
DECLARE
  v_auth_can_exec BOOLEAN;
BEGIN
  SELECT has_function_privilege(
    'authenticated',
    'ajo_record_contribution(uuid,uuid,numeric,text,text,text,uuid)',
    'execute'
  ) INTO v_auth_can_exec;

  IF NOT v_auth_can_exec THEN
    RAISE NOTICE 'T10 ✓ CONFIRMED — authenticated role cannot call ajo_record_contribution directly';
  ELSE
    RAISE WARNING 'T10 STILL FAILING — authenticated role still has EXECUTE; check pg_proc.proacl manually';
  END IF;
END;
$$;
