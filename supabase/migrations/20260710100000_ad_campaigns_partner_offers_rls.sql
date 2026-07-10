-- ═══════════════════════════════════════════════════════════════════════════
-- Fix: RLS SELECT policies for ad_campaigns, partner_offers, and related tables
-- Authenticated app users must be able to read active campaigns and live offers.
-- Admin writes already bypass RLS via supabaseAdmin (service role).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ad_campaigns ──────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS ad_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_active_campaigns" ON ad_campaigns;
CREATE POLICY "authenticated_read_active_campaigns"
  ON ad_campaigns FOR SELECT
  TO authenticated
  USING (status IN ('active', 'live'));

-- ── partners ───────────────────────────────────────────────────────────────
-- partner_offers joins partners; authenticated users need to read the join.

ALTER TABLE IF EXISTS partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_partners" ON partners;
CREATE POLICY "authenticated_read_partners"
  ON partners FOR SELECT
  TO authenticated
  USING (true);

-- ── partner_offers ────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS partner_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_live_offers" ON partner_offers;
CREATE POLICY "authenticated_read_live_offers"
  ON partner_offers FOR SELECT
  TO authenticated
  USING (status = 'live');

-- ── attribution_tokens ────────────────────────────────────────────────────

ALTER TABLE IF EXISTS attribution_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_insert_tokens" ON attribution_tokens;
CREATE POLICY "authenticated_insert_tokens"
  ON attribution_tokens FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ── partner_offer_events ──────────────────────────────────────────────────

ALTER TABLE IF EXISTS partner_offer_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_insert_offer_events" ON partner_offer_events;
CREATE POLICY "authenticated_insert_offer_events"
  ON partner_offer_events FOR INSERT
  TO authenticated
  WITH CHECK (true);
