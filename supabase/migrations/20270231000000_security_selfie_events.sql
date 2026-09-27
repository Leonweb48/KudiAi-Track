-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Security selfie evidence — a live photo captured at a risky moment (a PIN reset, a new device signing in, a
-- large transfer) and kept as a timestamped record. It is NOT matched against anything automatically — that is
-- a deliberate, separate decision from the Youverify BVN/NIN selfie match (idCheck.ts): there is no stored
-- reference photo or plaintext BVN/NIN to compare a fresh selfie against without a real cost/privacy trade-off,
-- so this never blocks the action it accompanies. The point is deterrence + a dispute trail: a stolen phone or
-- hijacked session still needs someone physically willing to be photographed, and if an action later turns out
-- to be fraudulent there is a real photo tied to exactly which one. Logic: supabase/functions/security-selfie/index.ts.
--
-- Evidence photos are kept for 90 days then deleted (see the cleanup action + the daily cron job below) — this is
-- sensitive, biometric-adjacent material, so it is not retained indefinitely.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.security_selfie_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('pin_reset', 'new_device', 'large_transfer')),
  storage_path text        NOT NULL,
  context      jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- a small, non-sensitive detail (amount, masked recipient, device/browser) — never a full account number
  ip_address   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_selfie_events_user_idx ON public.security_selfie_events (user_id, created_at DESC);

ALTER TABLE public.security_selfie_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_selfie_events FROM PUBLIC, anon, authenticated;

-- Private bucket — never publicly readable. Zero storage.objects policies for it on purpose: a private bucket
-- with no policies is reachable only by the service role (which bypasses RLS), exactly what evidence photos need.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('security_selfies', 'security_selfies', false, 2097152, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.platform_config (key, value, description) VALUES
  ('large_transfer_selfie_threshold_kobo', '10000000', 'A bank transfer at or above this amount asks for a quick security selfie before it goes through (kobo; 10000000 = ₦100,000). 0 turns this check off.')
ON CONFLICT (key) DO NOTHING;

-- ── delete evidence older than 90 days (called by the edge function's own cleanup action, never raw SQL — the
--    Storage API, not a bare row delete, is what actually removes the underlying file) ────────────────────────────
CREATE OR REPLACE FUNCTION public.security_selfie_events_older_than_90d()
RETURNS TABLE (id uuid, storage_path text) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, storage_path FROM public.security_selfie_events WHERE created_at < now() - interval '90 days';
$$;
REVOKE ALL ON FUNCTION public.security_selfie_events_older_than_90d() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.security_selfie_events_older_than_90d() TO service_role;

CREATE OR REPLACE FUNCTION public.security_selfie_events_delete(p_ids uuid[])
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.security_selfie_events WHERE id = ANY(p_ids);
$$;
REVOKE ALL ON FUNCTION public.security_selfie_events_delete(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.security_selfie_events_delete(uuid[]) TO service_role;

-- daily, at 03:10 (quiet hour) — calls security-selfie's cleanup action, same Vault cron_secret + verify_cron_secret
-- pattern as flw_legacy_deadline_watch (20270180000000): the CRON_SECRET function secret has drifted from the
-- Vault value before, so the edge function accepts either.
DO $$
BEGIN
  PERFORM cron.unschedule('security-selfie-cleanup') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'security-selfie-cleanup');
  PERFORM cron.schedule('security-selfie-cleanup', '10 3 * * *', $cron$
    DO $inner$
    DECLARE v_secret text;
    BEGIN
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
      IF v_secret IS NOT NULL THEN
        PERFORM net.http_post(
          url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/security-selfie',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body    := jsonb_build_object('action', 'cleanup'),
          timeout_milliseconds := 55000
        );
      END IF;
    END $inner$;
  $cron$);
  RAISE NOTICE 'security_selfie | cleanup scheduled daily at 03:10';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'security_selfie | could not schedule (pg_cron unavailable?): %', SQLERRM;
END $$;

-- ── self-test (rolled back): table/bucket/config exist, only the service role can touch the table, the
--    "older than 90 days" helper genuinely filters by age ──────────────────────────────────────────────────────
DO $$
DECLARE v_err text; v_bucket boolean; v_cfg text; v_id uuid := gen_random_uuid(); v_old uuid;
BEGIN
  SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'security_selfies' AND public = false) INTO v_bucket;
  IF NOT v_bucket THEN RAISE EXCEPTION 'security_selfie self-test: bucket missing or public'; END IF;
  SELECT value INTO v_cfg FROM public.platform_config WHERE key = 'large_transfer_selfie_threshold_kobo';
  IF v_cfg IS NULL THEN RAISE EXCEPTION 'security_selfie self-test: threshold config missing'; END IF;

  IF has_table_privilege('authenticated', 'public.security_selfie_events', 'select')
     OR has_table_privilege('anon', 'public.security_selfie_events', 'insert')
     OR NOT has_function_privilege('service_role', 'public.security_selfie_events_older_than_90d()', 'execute')
  THEN RAISE EXCEPTION 'security_selfie self-test: privileges are wrong — only the service role may touch this'; END IF;

  INSERT INTO public.security_selfie_events (id, user_id, kind, storage_path, created_at)
  VALUES (v_id, gen_random_uuid(), 'pin_reset', 'x/y/z.jpg', now() - interval '91 days');
  SELECT id INTO v_old FROM public.security_selfie_events_older_than_90d() WHERE id = v_id;
  IF v_old IS NULL THEN RAISE EXCEPTION 'security_selfie self-test: a 91-day-old row was not flagged for cleanup'; END IF;
  PERFORM public.security_selfie_events_delete(ARRAY[v_id]);
  IF EXISTS (SELECT 1 FROM public.security_selfie_events WHERE id = v_id) THEN RAISE EXCEPTION 'security_selfie self-test: delete did not remove the row'; END IF;

  INSERT INTO public.security_selfie_events (id, user_id, kind, storage_path, created_at)
  VALUES (gen_random_uuid(), gen_random_uuid(), 'new_device', 'a/b/c.jpg', now() - interval '1 day');
  IF EXISTS (SELECT 1 FROM public.security_selfie_events_older_than_90d() WHERE storage_path = 'a/b/c.jpg') THEN
    RAISE EXCEPTION 'security_selfie self-test: a 1-day-old row was wrongly flagged for cleanup';
  END IF;

  BEGIN
    INSERT INTO public.security_selfie_events (user_id, kind, storage_path) VALUES (gen_random_uuid(), 'nonsense', 'p');
    RAISE EXCEPTION 'security_selfie self-test: an unknown kind was accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'security_selfie self-test%' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'security_selfie self-test passed (rolled back)';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  IF v_err NOT LIKE 'security_selfie self-test passed%' THEN RAISE; END IF;
  RAISE NOTICE 'security_selfie | self-test passed';
END $$;
