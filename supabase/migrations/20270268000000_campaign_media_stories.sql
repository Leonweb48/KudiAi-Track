-- Campaign upgrade (2026-10-02, owner request): any kind of media in every placement, plus a new "stories" placement.
--
--   media_type  — what creative_url is: image | gif | video | lottie (an animation JSON) | youtube (a YouTube link).
--                 NULL = old rows; the app works it out from the URL.
--   poster_url  — the still picture for a video / animation / YouTube link: shown while it loads, on data-saver or slow
--                 networks, and when the phone asks for reduced motion.
--   stories     — for slot 'stories': 1–10 frames, each { media_type, url, poster_url?, duration_ms?, headline?, body?,
--                 cta_label?, cta_action_type?, cta_action_value? }. creative_url is then the round thumbnail.
-- Events gain video/story progress: 'view_start' (a video or story started playing) and 'view_complete' (watched to the end).
-- The media bucket accepts AVIF pictures and Lottie animation JSON as well.
-- Nothing is live in ad_campaigns today (5 paused rows), so no existing campaign changes behaviour.

ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS media_type TEXT,
  ADD COLUMN IF NOT EXISTS poster_url TEXT,
  ADD COLUMN IF NOT EXISTS stories    JSONB;

ALTER TABLE public.ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_media_type_check;
ALTER TABLE public.ad_campaigns ADD CONSTRAINT ad_campaigns_media_type_check
  CHECK (media_type IS NULL OR media_type IN ('image', 'gif', 'video', 'lottie', 'youtube'));

ALTER TABLE public.ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_slot_check;
ALTER TABLE public.ad_campaigns ADD CONSTRAINT ad_campaigns_slot_check
  CHECK (slot IN (
    'home_banner', 'announcement_bar', 'feed_card', 'popup', 'upsell_inline',
    'offers_section', 'powered_by_card', 'tab_card_quad', 'tab_card_duo', 'stories'
  ));

ALTER TABLE public.ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_stories_check;
ALTER TABLE public.ad_campaigns ADD CONSTRAINT ad_campaigns_stories_check
  CHECK (
    slot <> 'stories'
    OR (stories IS NOT NULL AND jsonb_typeof(stories) = 'array' AND jsonb_array_length(stories) BETWEEN 1 AND 10)
  );

-- the admin form only ever offered these three; normalise anything else on the (paused) rows before constraining
UPDATE public.ad_campaigns SET frequency_cap = 'always'
 WHERE frequency_cap IS NOT NULL AND frequency_cap NOT IN ('always', 'once_per_day', 'once_ever');
ALTER TABLE public.ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_frequency_cap_check;
ALTER TABLE public.ad_campaigns ADD CONSTRAINT ad_campaigns_frequency_cap_check
  CHECK (frequency_cap IS NULL OR frequency_cap IN ('always', 'once_per_day', 'once_ever'));

ALTER TABLE public.ad_campaign_events DROP CONSTRAINT IF EXISTS ace_event_type_check;
ALTER TABLE public.ad_campaign_events ADD CONSTRAINT ace_event_type_check
  CHECK (event_type IN ('impression', 'click', 'dismiss', 'conversion', 'view_start', 'view_complete'));

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm', 'application/json']
 WHERE id = 'promotions';
