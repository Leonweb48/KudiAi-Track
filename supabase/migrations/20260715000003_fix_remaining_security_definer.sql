-- Fix SECURITY DEFINER functions that were skipped in 20260715000002 due to signature mismatch.
-- The previous migration called these as zero-arg but they have parameters.

-- Reputation (20260707000005)
ALTER FUNCTION check_auto_badges(uuid, uuid) SET search_path = public;
ALTER FUNCTION award_reputation(uuid, uuid, integer, text, uuid) SET search_path = public;

-- Automation (20260707000006)
ALTER FUNCTION increment_invite_use(text) SET search_path = public;
ALTER FUNCTION get_group_analytics(uuid, integer) SET search_path = public;
