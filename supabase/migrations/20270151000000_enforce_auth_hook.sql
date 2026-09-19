-- Turn on fail-closed enforcement for the auth-email-hook.
--
-- Precondition met: real Supabase Auth traffic was observed in shadow mode as
--   "[auth-hook] signature VERIFIED (pass_standard_webhooks) action=magiclink"
-- (2026-09-19 09:29 WAT), i.e. HOOK_SECRET matches what the dashboard signs with.
--
-- From now on a request whose signature is missing, wrong or replayed gets
-- an immediate `{}` and NO email. Rejections are always written to
-- email_delivery_log as "[auth-hook] signature REJECTED …".
--
-- Rollback (if ever needed): UPDATE public.internal_flags SET value = 'false'
-- WHERE key = 'auth_hook_enforce';
UPDATE public.internal_flags
   SET value = 'true', updated_at = now()
 WHERE key = 'auth_hook_enforce';
