-- Phase 1 security fix: revoke PUBLIC execute from all write RPCs.
-- Migration 000004 added GRANT TO service_role but never revoked from PUBLIC,
-- leaving all write RPCs callable by any authenticated user — bypassing the
-- ajo-write PIN gate entirely.
--
-- After this migration only service_role can call these functions.
-- ajo-write edge function (which verifies PIN) runs as service_role.

REVOKE ALL ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID)   FROM PUBLIC;
REVOKE ALL ON FUNCTION ajo_reverse_contribution(UUID, UUID, TEXT)                           FROM PUBLIC;
REVOKE ALL ON FUNCTION ajo_archive_client(UUID, UUID)                                       FROM PUBLIC;
REVOKE ALL ON FUNCTION ajo_confirm_payment(TEXT, TIMESTAMPTZ, TEXT)                         FROM PUBLIC;

-- Confirm service_role still has execute (belt-and-suspenders)
GRANT EXECUTE ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID)   TO service_role;
GRANT EXECUTE ON FUNCTION ajo_reverse_contribution(UUID, UUID, TEXT)                           TO service_role;
GRANT EXECUTE ON FUNCTION ajo_archive_client(UUID, UUID)                                       TO service_role;
GRANT EXECUTE ON FUNCTION ajo_confirm_payment(TEXT, TIMESTAMPTZ, TEXT)                         TO service_role;
