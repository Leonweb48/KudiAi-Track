-- Add creative fields to partner_offers
-- creative_type: 'none' | 'image' | 'video' | 'carousel'
-- creative_url:  single image/video URL (already existed, add IF NOT EXISTS)
-- creative_urls: array of image URLs for carousel

ALTER TABLE partner_offers
  ADD COLUMN IF NOT EXISTS creative_url   TEXT,
  ADD COLUMN IF NOT EXISTS creative_type  TEXT CHECK (creative_type IN ('none','image','video','carousel')) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS creative_urls  TEXT[] DEFAULT '{}';
