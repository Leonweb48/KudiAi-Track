-- The original unique constraint on notifications.dedupe_key has no WHERE guard,
-- so after a notification is read (read_at IS NOT NULL) any new INSERT with the
-- same key fails with a duplicate-key error instead of starting a fresh rollup row.
--
-- Fix: drop the global unique constraint and replace it with a partial unique index
-- that only enforces uniqueness while the row is unread. Once read, the slot is
-- free and a new rollup row can start for the same event type.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_dedupe_key_unique;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_unread
  ON public.notifications (dedupe_key)
  WHERE read_at IS NULL AND dedupe_key IS NOT NULL;
