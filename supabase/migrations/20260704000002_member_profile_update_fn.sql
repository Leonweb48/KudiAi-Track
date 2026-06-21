-- SECURITY DEFINER function so members can update their own profile
-- regardless of whether org_members.user_id was already set.
-- Tries user_id match first; falls back to email and auto-fixes user_id.

CREATE OR REPLACE FUNCTION public.update_my_member_profile(
  p_full_name text,
  p_phone     text,
  p_avatar_url text
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
  -- Primary: match by user_id (fast path)
  UPDATE public.org_members
  SET full_name  = p_full_name,
      phone      = p_phone,
      avatar_url = p_avatar_url
  WHERE user_id = v_uid;

  -- Fallback: match by email and auto-fix user_id for next time
  IF NOT FOUND THEN
    UPDATE public.org_members
    SET full_name  = p_full_name,
        phone      = p_phone,
        avatar_url = p_avatar_url,
        user_id    = v_uid
    WHERE lower(email) = v_email;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_my_member_profile(text, text, text) TO authenticated;
