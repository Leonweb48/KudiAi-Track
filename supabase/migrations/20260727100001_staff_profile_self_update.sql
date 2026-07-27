-- Staff and Managers cannot write to the `staff` table via RLS (UPDATE policies
-- are scoped to user_id, but PostgREST WITH CHECK evaluation rejects the write).
-- This SECURITY DEFINER function bypasses RLS and restricts writes to only the
-- self-service columns a staff/manager is allowed to change.

CREATE OR REPLACE FUNCTION update_staff_own_profile(
  p_phone             TEXT    DEFAULT NULL,
  p_address           TEXT    DEFAULT NULL,
  p_nok_name          TEXT    DEFAULT NULL,
  p_nok_phone         TEXT    DEFAULT NULL,
  p_nok_relationship  TEXT    DEFAULT NULL,
  p_profile_image_url TEXT    DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id UUID;
BEGIN
  SELECT id INTO v_staff_id
  FROM staff
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Staff record not found for current user';
  END IF;

  UPDATE staff SET
    phone             = p_phone,
    address           = p_address,
    nok_name          = p_nok_name,
    nok_phone         = p_nok_phone,
    nok_relationship  = p_nok_relationship,
    -- NULL means "no new photo uploaded" — preserve the existing avatar
    profile_image_url = COALESCE(p_profile_image_url, profile_image_url)
  WHERE id = v_staff_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_staff_own_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
