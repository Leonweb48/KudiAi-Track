-- Tighten attribution_tokens and partner_offer_events INSERT policies.
--
-- Anon inserts are intentionally allowed (AjoMemberPortal and CoopMemberPortal
-- use the anon key), so we cannot require auth.uid(). However the previous
-- NOT NULL field checks let any anon session fabricate rows for any offer_id
-- or against any token string — enabling commission inflation via forged
-- attribution data.
--
-- Fix: add EXISTS sub-selects so inserts can only reference records that
-- actually exist in the parent tables.

-- attribution_tokens: token must map to a real offer
DROP POLICY IF EXISTS "insert_tokens" ON attribution_tokens;
CREATE POLICY "insert_tokens" ON attribution_tokens
  FOR INSERT
  WITH CHECK (
    token IS NOT NULL
    AND offer_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM partner_offers WHERE id = offer_id)
  );

-- partner_offer_events: event must reference a real attribution token
DROP POLICY IF EXISTS "insert_poe" ON partner_offer_events;
CREATE POLICY "insert_poe" ON partner_offer_events
  FOR INSERT
  WITH CHECK (
    offer_id IS NOT NULL
    AND attribution_token IS NOT NULL
    AND EXISTS (SELECT 1 FROM attribution_tokens WHERE token = attribution_token)
  );

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260815000003',
  'tighten_attribution_insert_rls',
  ARRAY[
    'DROP POLICY insert_tokens ON attribution_tokens',
    'CREATE POLICY insert_tokens ON attribution_tokens WITH CHECK exists(partner_offers.id = offer_id)',
    'DROP POLICY insert_poe ON partner_offer_events',
    'CREATE POLICY insert_poe ON partner_offer_events WITH CHECK exists(attribution_tokens.token = attribution_token)'
  ]
)
ON CONFLICT (version) DO NOTHING;
