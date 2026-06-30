-- ════════════════════════════════════════════════════════════════════════════
--  Fix security definer warnings — revoke direct grants from anon/authenticated
--
--  Previous migrations revoked from PUBLIC only. Supabase issues explicit
--  GRANT EXECUTE to both anon and authenticated on every function at creation,
--  so revoking from PUBLIC alone has no effect on those direct grants.
--
--  Strategy:
--   A) Trigger/server functions  → REVOKE from PUBLIC + anon + authenticated
--   B) Admin-only functions      → REVOKE from PUBLIC + anon + authenticated
--                                  GRANT to service_role only
--   C) User-callable functions   → REVOKE from anon only
--                                  (authenticated keeps access — those linter
--                                   warnings are intentional/acceptable)
-- ════════════════════════════════════════════════════════════════════════════


-- ── A. Trigger / server-only functions ───────────────────────────────────
-- These are never meant to be called via RPC — only by the trigger mechanism.

DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.audit_on_ban()                 FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.audit_on_join_request()        FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.audit_on_msg_delete()          FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.audit_on_mute()                FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.auto_create_commission()       FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.auto_index_group_media()       FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.expire_disappearing_messages() FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.expire_mutes()                 FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.handle_claim_approval()        FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.notify_admin_new_ticket()      FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.notify_admin_security_event()  FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.queue_transaction_email()      FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.rep_on_message()               FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.rep_on_poll_vote()             FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.rep_on_voice_join()            FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.set_message_expiry()           FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.set_updated_at()               FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.sync_badge_count()             FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.sync_org_member_count()        FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.trg_check_ajo_group_limit()    FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.trg_check_org_limit()          FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.trg_check_org_member_limit()   FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.trg_queue_ajo_welcome()        FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.trg_queue_business_welcome()   FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.trg_queue_org_member_welcome() FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.trg_queue_staff_welcome()      FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.update_event_rsvp_count()      FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.update_poll_vote_counts()      FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.update_session_rsvp_count()    FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.update_voice_room_counts()     FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.welcome_new_member()           FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.log_audit_event(uuid, uuid, text, text, text, uuid, text, jsonb)
                                                                   FROM PUBLIC, anon, authenticated;
END $$;


-- ── B. Admin-only functions ───────────────────────────────────────────────
-- Only service_role (server-side API calls) should ever invoke these.

REVOKE EXECUTE ON FUNCTION public.hash_admin_password(text)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_admin_password(uuid, text)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_admin_password(text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.hash_admin_password(text)         TO service_role;
GRANT EXECUTE ON FUNCTION public.set_admin_password(uuid, text)    TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_admin_password(text, text) TO service_role;


-- ── C. User-callable functions — revoke anon only ────────────────────────
-- authenticated users legitimately call these via RPC.
-- The authenticated_security_definer_function_executable warnings for
-- these will remain — that is intentional (they ARE meant to be called
-- by signed-in users; the linter just flags for awareness).

REVOKE EXECUTE ON FUNCTION public.award_reputation(uuid, uuid, integer, text, uuid)         FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_access_org_chat(uuid)                                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_auto_badges(uuid, uuid)                              FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_coupon(text)                                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_slow_mode(uuid, uuid)                                FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_group_analytics(uuid, integer)                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_membership()                                        FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_org()                                               FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_owner_plan()                                           FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_plan_limit(text, text)                                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_plan_usage(uuid)                                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_invite_use(text)                                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_active_staff_for(uuid)                                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin()                                                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_org_admin(uuid)                                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_org_mod_or_above(uuid)                                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_owner_of_staff(uuid)                                    FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_member_org_id()                                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_owned_org_ids()                                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number(uuid)                                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.redeem_coupon(text, text, text, numeric, numeric, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_group_media(uuid, text, text, uuid, timestamptz, timestamptz, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_group_messages(uuid, text, text, uuid, timestamptz, timestamptz, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.staff_can(uuid, text, boolean)                             FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_my_member_profile(text, text, text)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_coupon(text, text, text, numeric)                 FROM anon;
