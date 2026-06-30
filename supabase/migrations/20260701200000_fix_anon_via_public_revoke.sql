-- ════════════════════════════════════════════════════════════════════════════
--  Remove anon access from remaining user-callable SECURITY DEFINER functions
--
--  These functions still show anon_security_definer_function_executable because
--  anon inherits EXECUTE from PUBLIC. REVOKE FROM anon alone does nothing when
--  the grant comes through PUBLIC inheritance. The correct fix is:
--    1. REVOKE FROM PUBLIC  (removes the inherited base)
--    2. GRANT TO authenticated (restore explicit access for signed-in users)
--
--  After this:
--  • anon_security_definer_function_executable  → CLEARED for all listed fns
--  • authenticated_security_definer_function_executable → REMAINS (intentional;
--    these functions ARE meant to be called by signed-in users via RPC)
-- ════════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.award_reputation(uuid, uuid, integer, text, uuid)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.award_reputation(uuid, uuid, integer, text, uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.can_access_org_chat(uuid)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.can_access_org_chat(uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.check_auto_badges(uuid, uuid)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_auto_badges(uuid, uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.check_coupon(text)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_coupon(text)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.check_slow_mode(uuid, uuid)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_slow_mode(uuid, uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_group_analytics(uuid, integer)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_group_analytics(uuid, integer)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_membership()
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_membership()
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_org()
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_org()
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_owner_plan()
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_owner_plan()
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_plan_limit(text, text)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_plan_limit(text, text)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_user_plan_usage(uuid)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_user_plan_usage(uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_invite_use(text)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.increment_invite_use(text)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_active_staff_for(uuid)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_active_staff_for(uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_admin()
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_admin()
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_org_admin(uuid)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_org_admin(uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_org_mod_or_above(uuid)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_org_mod_or_above(uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_owner_of_staff(uuid)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_owner_of_staff(uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.my_member_org_id()
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.my_member_org_id()
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.my_owned_org_ids()
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.my_owned_org_ids()
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.next_invoice_number(uuid)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.next_invoice_number(uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.redeem_coupon(text, text, text, numeric, numeric, numeric, text)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.redeem_coupon(text, text, text, numeric, numeric, numeric, text)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.search_group_media(uuid, text, text, uuid, timestamptz, timestamptz, integer, integer)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.search_group_media(uuid, text, text, uuid, timestamptz, timestamptz, integer, integer)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.search_group_messages(uuid, text, text, uuid, timestamptz, timestamptz, integer, integer)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.search_group_messages(uuid, text, text, uuid, timestamptz, timestamptz, integer, integer)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.staff_can(uuid, text, boolean)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.staff_can(uuid, text, boolean)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_my_member_profile(text, text, text)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_my_member_profile(text, text, text)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.validate_coupon(text, text, text, numeric)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.validate_coupon(text, text, text, numeric)
  TO authenticated;
