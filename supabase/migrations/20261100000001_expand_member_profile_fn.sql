-- Drop the 3-param overload so the new 9-param version (with defaults) is unambiguous
DROP FUNCTION IF EXISTS public.update_my_member_profile(text, text, text);

-- New signature: extra params default to NULL so old 3-field callers still work
CREATE OR REPLACE FUNCTION public.update_my_member_profile(
  p_full_name       text,
  p_phone           text,
  p_avatar_url      text,
  p_address         text  DEFAULT NULL,
  p_occupation      text  DEFAULT NULL,
  p_next_of_kin     text  DEFAULT NULL,
  p_nok_phone       text  DEFAULT NULL,
  p_gender          text  DEFAULT NULL,
  p_date_of_birth   date  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text := lower(auth.jwt() ->> 'email');
BEGIN
  -- Primary: match by user_id
  UPDATE public.org_members
  SET full_name         = p_full_name,
      phone             = p_phone,
      avatar_url        = p_avatar_url,
      address           = COALESCE(p_address,      address),
      occupation        = COALESCE(p_occupation,   occupation),
      next_of_kin       = COALESCE(p_next_of_kin,  next_of_kin),
      next_of_kin_phone = COALESCE(p_nok_phone,    next_of_kin_phone),
      gender            = COALESCE(p_gender,        gender),
      date_of_birth     = COALESCE(p_date_of_birth, date_of_birth)
  WHERE user_id = v_uid;

  -- Fallback: match by email and auto-fix user_id for next time
  IF NOT FOUND THEN
    UPDATE public.org_members
    SET full_name         = p_full_name,
        phone             = p_phone,
        avatar_url        = p_avatar_url,
        address           = COALESCE(p_address,      address),
        occupation        = COALESCE(p_occupation,   occupation),
        next_of_kin       = COALESCE(p_next_of_kin,  next_of_kin),
        next_of_kin_phone = COALESCE(p_nok_phone,    next_of_kin_phone),
        gender            = COALESCE(p_gender,        gender),
        date_of_birth     = COALESCE(p_date_of_birth, date_of_birth),
        user_id           = v_uid
    WHERE lower(email) = v_email;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_my_member_profile(text, text, text, text, text, text, text, text, date) TO authenticated;
