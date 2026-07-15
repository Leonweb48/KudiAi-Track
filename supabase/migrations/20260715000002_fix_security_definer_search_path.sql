-- Fix SECURITY DEFINER functions missing SET search_path that were created after the
-- retropatching migrations (20260630200000 + 20260630400000). Those ALTER FUNCTION
-- statements ran before these functions existed, so the patch had no effect.
-- Each statement is wrapped in a DO block so a wrong/missing signature does not abort
-- the whole migration — any skipped function needs a manual follow-up with the correct sig.

CREATE OR REPLACE FUNCTION _apply_search_path(fn TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER FUNCTION %s SET search_path = public', fn);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not patch %: %', fn, SQLERRM;
END $$;

-- Support (20260705000002)
SELECT _apply_search_path('set_ticket_timestamps()');

-- Community foundation (20260707000000)
SELECT _apply_search_path('is_org_admin');
SELECT _apply_search_path('is_org_mod_or_above');

-- Community content (20260707000001)
SELECT _apply_search_path('update_event_rsvp_count()');
SELECT _apply_search_path('update_poll_vote_counts()');

-- Voice rooms (20260707000002)
SELECT _apply_search_path('update_voice_room_counts()');
SELECT _apply_search_path('update_session_rsvp_count()');

-- Personal media (20260707000003)
SELECT _apply_search_path('auto_index_group_media()');

-- Moderation (20260707000004)
SELECT _apply_search_path('audit_on_ban()');
SELECT _apply_search_path('audit_on_mute()');
SELECT _apply_search_path('audit_on_msg_delete()');
SELECT _apply_search_path('audit_on_join_request()');
SELECT _apply_search_path('check_slow_mode');

-- Reputation (20260707000005)
SELECT _apply_search_path('sync_badge_count()');
SELECT _apply_search_path('rep_on_message()');
SELECT _apply_search_path('rep_on_poll_vote()');
SELECT _apply_search_path('rep_on_voice_join()');
SELECT _apply_search_path('check_auto_badges()');

-- Automation (20260707000006)
SELECT _apply_search_path('set_message_expiry()');
SELECT _apply_search_path('expire_disappearing_messages()');
SELECT _apply_search_path('increment_invite_use()');
SELECT _apply_search_path('expire_mutes()');
SELECT _apply_search_path('sync_org_member_count()');
SELECT _apply_search_path('welcome_new_member()');

-- Approvals (20260806000003)
SELECT _apply_search_path('expire_stale_approval_requests()');

-- Coupon system (20260728000004)
SELECT _apply_search_path('check_coupon');
SELECT _apply_search_path('validate_coupon');
SELECT _apply_search_path('redeem_coupon');

-- Clean up helper
DROP FUNCTION _apply_search_path(TEXT);
