-- Pause all facial verification, at the owner's request.
--   security_selfie_enabled (new): master switch for the capture-only security selfies — PIN reset, large transfer and
--     new-device sign-in (see usePlatformConfig.securitySelfieEnabled). 'false' = none of them is asked for.
--   kyc_selfie_required: the Youverify selfie-vs-BVN/NIN photo match on ID checks — set back to 'false' (name match only).
-- Both are turned back on from platform_config (admin portal) — no rebuild. Nothing already stored is deleted; the
-- existing 90-day cleanup of security selfies keeps running.

INSERT INTO public.platform_config (key, value, description) VALUES
  ('security_selfie_enabled', 'false',
   'Ask for a security selfie at PIN reset, large transfers and new-device sign-in (capture only, never face-matched). false = paused.')
ON CONFLICT (key) DO UPDATE SET value = 'false', updated_at = now();

UPDATE public.platform_config SET value = 'false', updated_at = now() WHERE key = 'kyc_selfie_required';
