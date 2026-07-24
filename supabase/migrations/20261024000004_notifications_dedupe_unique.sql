-- Fix: ON CONFLICT (dedupe_key) in manager_update_staff_permission and
-- notify_owner_of_staff_change RPCs requires a UNIQUE constraint on
-- notifications.dedupe_key, not just an index.
--
-- The existing notifications_dedupe index is a plain (non-unique) index used
-- for query performance only. It does NOT satisfy ON CONFLICT resolution.
-- Adding UNIQUE(dedupe_key) here; PostgreSQL allows multiple NULLs under
-- a UNIQUE constraint so nullable rows are unaffected.

-- ── 1. Remove any duplicate dedupe_key rows (keep the earliest by created_at) ─
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY dedupe_key ORDER BY created_at ASC) AS rn
  FROM public.notifications
  WHERE dedupe_key IS NOT NULL
)
DELETE FROM public.notifications
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── 2. Drop the old non-unique index (superseded by the unique constraint) ───
DROP INDEX IF EXISTS public.notifications_dedupe;

-- ── 3. Add UNIQUE constraint — also serves as the index ──────────────────────
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_dedupe_key_unique;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_dedupe_key_unique UNIQUE (dedupe_key);
