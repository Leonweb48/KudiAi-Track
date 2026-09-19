-- ═════════════════════════════════════════════════════════════════════════════
-- verify_cron_secret(): let an edge function check an x-cron-secret header
-- against the Vault — the same store the SQL callers (pg_cron / triggers) read
-- it from — instead of against a separate CRON_SECRET function secret.
--
-- Why: probing showed the Vault secret and the CRON_SECRET function secret do
-- NOT match (every pg_net → edge-function call answered HTTP 401, including the
-- long-standing flutterwave `process-scheduled-transfer` path). Each side is
-- only ever compared with the other, so there is no way to tell which is
-- "right" — but the callers ARE the Vault, so authenticating against the Vault
-- is what makes the SQL → edge path work without anyone having to re-enter a
-- secret. An env CRON_SECRET that does match still works (checked first).
--
-- Service role only; returns a boolean, never the secret.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.verify_cron_secret(p_secret text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
  SELECT COALESCE(p_secret, '') <> ''
     AND EXISTS (
       SELECT 1 FROM vault.decrypted_secrets
       WHERE name = 'cron_secret' AND decrypted_secret = p_secret
     )
$function$;

REVOKE ALL ON FUNCTION public.verify_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verify_cron_secret(text) TO service_role;
