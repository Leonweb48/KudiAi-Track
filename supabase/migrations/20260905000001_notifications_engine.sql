-- ─────────────────────────────────────────────────────────────────────────────
-- Notification Engine — Part 1
-- Tables: notifications · push_tokens · notification_preferences
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. notifications ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text        NOT NULL,
  title       text        NOT NULL,
  body        text,
  deep_link   jsonb,
  priority    text        NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_dedupe
  ON public.notifications (dedupe_key, user_id)
  WHERE dedupe_key IS NOT NULL AND read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Owners read / mark-read their own notifications
CREATE POLICY "notifications_own_select" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notifications_own_update" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Only service_role inserts (edge functions / triggers)
-- No INSERT policy for authenticated users; edge function uses service_role.

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ── 2. push_tokens ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token       text        NOT NULL,
  platform    text        NOT NULL DEFAULT 'android' CHECK (platform IN ('android','ios','web')),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_tokens_own" ON public.push_tokens
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 3. notification_preferences ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id      uuid    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  push_enabled boolean NOT NULL DEFAULT true,
  pref_money   boolean NOT NULL DEFAULT true,
  pref_savings boolean NOT NULL DEFAULT true,
  pref_stock   boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_prefs_own" ON public.notification_preferences
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
