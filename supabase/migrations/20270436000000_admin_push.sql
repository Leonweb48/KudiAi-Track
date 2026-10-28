-- Admin push alerts (2026-10-28): admins get every admin_notifications row on their phone / computer even when the admin
-- portal is closed, like owners and clients do in the app. Standard Web Push (VAPID) sent by the admin portal
-- (admin.kudiai.app, /api/push/dispatch) — no Firebase needed.
--
--   1. admin_push_subscriptions — one row per browser/device an admin switched alerts on for (service role only)
--   2. admin_notification_reads  — read / cleared state PER ADMIN for broadcast rows (before this, one admin marking a
--      broadcast read marked it read for every admin, and "Clear read" deleted it for everyone)
--   3. admin_push_vapid_keys()   — the portal's VAPID key pair, kept in Vault; the first caller's pair is stored, every
--      later caller gets the stored one back (service role only)
--   4. trigger on admin_notifications → pg_net POST {id} to the portal with the Vault cron_secret; the portal loads the
--      row itself and works out who should get it. A failure here never blocks the insert.

-- ── 1. devices ───────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE CHECK (endpoint ~ '^https://' AND length(endpoint) <= 1000),
  p256dh      text NOT NULL CHECK (length(p256dh) BETWEEN 40 AND 200),
  auth        text NOT NULL CHECK (length(auth) BETWEEN 10 AND 100),
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz,
  last_error  text
);
CREATE INDEX IF NOT EXISTS admin_push_subscriptions_admin ON public.admin_push_subscriptions(admin_id);
ALTER TABLE public.admin_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_push_subscriptions TO service_role;

-- ── 2. per-admin read / cleared ──────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_notification_reads (
  notification_id uuid NOT NULL REFERENCES public.admin_notifications(id) ON DELETE CASCADE,
  admin_id        uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  cleared_at      timestamptz,
  PRIMARY KEY (notification_id, admin_id)
);
CREATE INDEX IF NOT EXISTS admin_notification_reads_admin ON public.admin_notification_reads(admin_id);
ALTER TABLE public.admin_notification_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_notification_reads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_notification_reads TO service_role;

-- ── 3. VAPID keys in Vault ───────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_push_vapid_keys(p_public text, p_private text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, pg_temp AS $$
DECLARE v_pub text; v_priv text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('admin_push_vapid_keys'));
  SELECT decrypted_secret INTO v_pub  FROM vault.decrypted_secrets WHERE name = 'admin_push_vapid_public';
  SELECT decrypted_secret INTO v_priv FROM vault.decrypted_secrets WHERE name = 'admin_push_vapid_private';
  IF v_pub IS NULL OR v_priv IS NULL THEN
    IF COALESCE(p_public, '') !~ '^[A-Za-z0-9_-]{80,100}$' OR COALESCE(p_private, '') !~ '^[A-Za-z0-9_-]{40,50}$' THEN
      RAISE EXCEPTION 'admin_push_vapid_keys: no stored keys and the given pair is not a VAPID pair';
    END IF;
    DELETE FROM vault.secrets WHERE name IN ('admin_push_vapid_public', 'admin_push_vapid_private');
    PERFORM vault.create_secret(p_public,  'admin_push_vapid_public',  'Admin portal web-push VAPID public key');
    PERFORM vault.create_secret(p_private, 'admin_push_vapid_private', 'Admin portal web-push VAPID private key');
    v_pub := p_public; v_priv := p_private;
  END IF;
  RETURN jsonb_build_object('public', v_pub, 'private', v_priv);
END $$;
REVOKE ALL ON FUNCTION public.admin_push_vapid_keys(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_push_vapid_keys(text, text) TO service_role;

-- ── 4. every new admin notification → the portal's push dispatcher ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_notification_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, pg_temp AS $$
DECLARE v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_secret IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.admin_push_subscriptions) THEN
    PERFORM net.http_post(
      url     := 'https://admin.kudiai.app/api/push/dispatch',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body    := jsonb_build_object('id', NEW.id),
      timeout_milliseconds := 30000
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_notification_push: %', SQLERRM;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.admin_notification_push() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS admin_notification_push ON public.admin_notifications;
CREATE TRIGGER admin_notification_push
  AFTER INSERT ON public.admin_notifications
  FOR EACH ROW EXECUTE FUNCTION public.admin_notification_push();
