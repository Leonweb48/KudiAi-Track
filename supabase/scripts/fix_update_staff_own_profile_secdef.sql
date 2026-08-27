-- Make update_staff_own_profile SECURITY DEFINER so it bypasses RLS.
DROP FUNCTION IF EXISTS update_staff_own_profile(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT);
-- Safe: the function enforces access control via WHERE user_id = auth.uid().
CREATE OR REPLACE FUNCTION update_staff_own_profile(
  p_phone             TEXT,
  p_address           TEXT,
  p_nok_name          TEXT,
  p_nok_phone         TEXT,
  p_nok_relationship  TEXT,
  p_profile_image_url TEXT DEFAULT NULL
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
    profile_image_url = COALESCE(p_profile_image_url, profile_image_url)
  WHERE id = v_staff_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_staff_own_profile(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION update_staff_own_profile(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;
