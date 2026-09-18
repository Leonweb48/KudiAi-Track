-- ═════════════════════════════════════════════════════════════════════════════
-- Notification redesign — Phase B: swipe-to-dismiss support.
--
-- No DELETE policy exists on notifications today (by design — the table is
-- an audit trail, and every insert is service_role/SECURITY DEFINER only).
-- A soft dismiss (a timestamp, filtered out of the drawer's query) keeps
-- that invariant intact rather than adding a new DELETE policy.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

-- The drawer's default query excludes dismissed rows — index the common case.
CREATE INDEX IF NOT EXISTS notifications_user_visible
  ON public.notifications (user_id, created_at DESC)
  WHERE dismissed_at IS NULL;
