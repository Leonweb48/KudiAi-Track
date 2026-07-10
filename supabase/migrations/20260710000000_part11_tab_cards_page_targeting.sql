-- ═══════════════════════════════════════════════════════════════════════════
-- Part 11 Migration — Page-level placement + Tab Card slots
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extend ad_campaigns with page targeting + tile data ───────────────────

ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS target_pages text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tiles        jsonb;

-- Expand slot constraint to include tab card types
ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_slot_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_slot_check
  CHECK (slot IN (
    'home_banner','announcement_bar','feed_card','popup','upsell_inline',
    'offers_section','powered_by_card','tab_card_quad','tab_card_duo'
  ));

-- Tab card tile completeness constraint:
-- tab_card_quad must have exactly 4 tiles; tab_card_duo must have exactly 2.
ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_tab_card_tiles_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_tab_card_tiles_check
  CHECK (
    (slot NOT IN ('tab_card_quad','tab_card_duo'))
    OR (
      tiles IS NOT NULL
      AND (
        (slot = 'tab_card_quad' AND jsonb_array_length(tiles) = 4)
        OR (slot = 'tab_card_duo'  AND jsonb_array_length(tiles) = 2)
      )
    )
  );

-- ── Extend ad_campaign_events with page/tile tracking ─────────────────────
-- Table may already exist from an earlier migration; add new columns safely.

CREATE TABLE IF NOT EXISTS ad_campaign_events (
  id           uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id  uuid    NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  user_id      uuid,
  event_type   text    NOT NULL,
  portal_type  text,
  platform     text,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE ad_campaign_events
  ADD COLUMN IF NOT EXISTS page_key   text,
  ADD COLUMN IF NOT EXISTS tile_index int;

-- Replace event_type constraint to include conversion
ALTER TABLE ad_campaign_events DROP CONSTRAINT IF EXISTS ace_event_type_check;
ALTER TABLE ad_campaign_events ADD CONSTRAINT ace_event_type_check
  CHECK (event_type IN ('impression','click','dismiss','conversion'));

CREATE INDEX IF NOT EXISTS idx_ace_campaign   ON ad_campaign_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ace_page_key   ON ad_campaign_events(page_key);
CREATE INDEX IF NOT EXISTS idx_ace_created    ON ad_campaign_events(created_at);
CREATE INDEX IF NOT EXISTS idx_ace_tile       ON ad_campaign_events(campaign_id, tile_index) WHERE tile_index IS NOT NULL;

ALTER TABLE ad_campaign_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_insert_ace" ON ad_campaign_events;
CREATE POLICY "authenticated_insert_ace"
  ON ad_campaign_events FOR INSERT TO authenticated WITH CHECK (true);
