-- Allow 'client_reactivation' as a valid request_type in admin_approval_requests.
-- The reactivation flow (ajo-write approve_reactivation) inserts rows with this
-- type so the admin portal can review and action them via execute_client_reactivation.

ALTER TABLE public.admin_approval_requests
  DROP CONSTRAINT IF EXISTS admin_approval_requests_request_type_check;

ALTER TABLE public.admin_approval_requests
  ADD CONSTRAINT admin_approval_requests_request_type_check
  CHECK (request_type IN ('group_edit','group_delete','credit_delete','client_archive','org_archive','client_reactivation'));

-- Update submit_approval_request to also allow client_reactivation submissions
CREATE OR REPLACE FUNCTION public.submit_approval_request(
  p_type    TEXT,
  p_owner   UUID,
  p_biz     TEXT,
  p_target  UUID,
  p_payload JSONB DEFAULT NULL,
  p_reason  TEXT  DEFAULT ''
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF p_type NOT IN ('group_edit','group_delete','credit_delete','client_archive','org_archive','client_reactivation') THEN
    RAISE EXCEPTION 'Unknown request type: %', p_type;
  END IF;
  INSERT INTO admin_approval_requests(request_type, requester, business, target_id, payload, reason)
  VALUES (p_type, p_owner, p_biz, p_target, p_payload, p_reason)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
