-- cancel_approval_request — owner-callable, requires auth.uid() to be the requester
CREATE OR REPLACE FUNCTION public.cancel_approval_request(
  p_target_id UUID,
  p_type      TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  WITH cancelled AS (
    UPDATE admin_approval_requests SET
      status     = 'cancelled',
      decided_at = NOW()
    WHERE requester    = auth.uid()
      AND target_id    = p_target_id
      AND request_type = p_type
      AND status       = 'pending'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_rows FROM cancelled;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'No pending % request found for this item', p_type;
  END IF;
  -- Side effects (resetting pending_archive flags) are handled by the existing
  -- trg_aar_reset_client_pending_archive and trg_aar_reset_org_pending_archive triggers.
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_approval_request(UUID, TEXT) TO authenticated;
