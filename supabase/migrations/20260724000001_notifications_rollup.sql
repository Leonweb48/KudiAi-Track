-- Add rollup columns for anti-flood aggregation in the notifications table.
-- notif_count: how many deduplicated events are collapsed into this row
-- notif_total: running naira total (kobo-level precision not needed; store whole naira)
-- last_push_at: when FCM was last fired for this dedupeKey (used for the 2-min flood window)

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS notif_count  INT         NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS notif_total  BIGINT      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_push_at TIMESTAMPTZ;

-- Flood-window lookup: find the most recent FCM push time for a given (user, dedupeKey)
CREATE INDEX IF NOT EXISTS notifications_last_push
  ON public.notifications (user_id, dedupe_key, last_push_at DESC)
  WHERE dedupe_key IS NOT NULL AND last_push_at IS NOT NULL;
