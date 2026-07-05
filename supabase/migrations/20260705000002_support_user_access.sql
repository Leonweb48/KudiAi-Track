-- ═══════════════════════════════════════════════════════════════════════════════
--  Support Tickets — User Access Policies + Missing Columns
--  Migration: 20260705000002_support_user_access.sql
--
--  The support_tickets and support_ticket_comments tables were created in
--  20260612000000 with admin-only RLS. This migration adds user-facing access
--  policies and the columns needed by the Help & Support screen.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Add missing columns to support_tickets ────────────────────────────────
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS rating       int         CHECK (rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS resolved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at    timestamptz;

-- ── 2. User RLS policies on support_tickets ──────────────────────────────────
-- Allow authenticated users to read their own tickets
DROP POLICY IF EXISTS "support_tickets_user_select" ON public.support_tickets;
CREATE POLICY "support_tickets_user_select"
  ON public.support_tickets
  FOR SELECT
  USING (auth.uid() = user_id);

-- Allow authenticated users to create tickets for themselves
DROP POLICY IF EXISTS "support_tickets_user_insert" ON public.support_tickets;
CREATE POLICY "support_tickets_user_insert"
  ON public.support_tickets
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Allow users to submit a rating on their own resolved ticket only
DROP POLICY IF EXISTS "support_tickets_user_rating" ON public.support_tickets;
CREATE POLICY "support_tickets_user_rating"
  ON public.support_tickets
  FOR UPDATE
  USING (
    auth.uid() = user_id
    AND status IN ('resolved', 'open')
  )
  WITH CHECK (
    auth.uid() = user_id
  );

-- ── 3. User RLS policy on support_ticket_comments ────────────────────────────
-- Users can read non-internal comments on their own tickets
DROP POLICY IF EXISTS "ticket_comments_user_select" ON public.support_ticket_comments;
CREATE POLICY "ticket_comments_user_select"
  ON public.support_ticket_comments
  FOR SELECT
  USING (
    is_internal = false
    AND ticket_id IN (
      SELECT id FROM public.support_tickets WHERE user_id = auth.uid()
    )
  );

-- ── 4. Auto-set resolved_at / closed_at via trigger ──────────────────────────
CREATE OR REPLACE FUNCTION public.set_ticket_timestamps()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'resolved' AND OLD.status <> 'resolved' THEN
    NEW.resolved_at = now();
  END IF;
  IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
    NEW.closed_at = now();
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_timestamps ON public.support_tickets;
CREATE TRIGGER trg_ticket_timestamps
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_ticket_timestamps();

DO $$ BEGIN
  RAISE NOTICE 'Migration 20260705000002 applied: user RLS + rating/resolved_at/closed_at columns added to support_tickets';
END $$;
