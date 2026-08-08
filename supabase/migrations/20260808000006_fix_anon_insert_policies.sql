-- Fix: attribution_tokens and partner_offer_events were tightened to
-- TO authenticated in 20260808000003, but AjoMemberPortal ("ajo_client")
-- and CoopMemberPortal ("org_member") use the anon key — storeToken and
-- recordEvent now fail silently for those portals.
--
-- Keep the field constraints (token/offer_id non-null) but drop the
-- TO authenticated restriction so anon can still insert. This preserves
-- the security improvement (no longer always-true) while restoring
-- attribution tracking for unauthenticated member portals.

-- attribution_tokens
DROP POLICY IF EXISTS "authenticated_insert_tokens" ON attribution_tokens;
CREATE POLICY "insert_tokens" ON attribution_tokens
  FOR INSERT
  WITH CHECK (token IS NOT NULL AND offer_id IS NOT NULL);

-- partner_offer_events
DROP POLICY IF EXISTS "authenticated_insert_offer_events" ON partner_offer_events;
CREATE POLICY "insert_poe" ON partner_offer_events
  FOR INSERT
  WITH CHECK (offer_id IS NOT NULL AND attribution_token IS NOT NULL);
