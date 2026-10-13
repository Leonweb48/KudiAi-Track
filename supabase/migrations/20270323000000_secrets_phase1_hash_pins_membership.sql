-- Secret columns, phase 1 (2026-10-13). Safe to apply before phones update:
--   1. aso_clients.portal_pin is never stored in plain text again. A trigger turns any plain PIN written (older app
--      versions still send one when an owner adds a client) into portal_pin_hash and clears it; existing plain PINs are
--      hashed once (only where no hash exists — a client who set their own PIN keeps it) and cleared.
--   2. get_my_membership() returned the caller's whole org_members row, including OTP codes, portal/session tokens and
--      PIN hashes — those keys are now stripped (edited in place so the rest of the function can't drift).
-- Phase 2 (after phones run the new app): signed-in users lose SELECT on the secret columns themselves.

CREATE OR REPLACE FUNCTION public.aso_clients_hash_plain_pin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NEW.portal_pin IS NOT NULL AND NEW.portal_pin <> '' THEN
    NEW.portal_pin_hash := extensions.crypt(NEW.portal_pin, extensions.gen_salt('bf', 8));
    NEW.portal_pin := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.aso_clients_hash_plain_pin() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_aso_clients_hash_plain_pin ON public.aso_clients;
CREATE TRIGGER trg_aso_clients_hash_plain_pin BEFORE INSERT OR UPDATE OF portal_pin ON public.aso_clients
  FOR EACH ROW EXECUTE FUNCTION public.aso_clients_hash_plain_pin();

DO $$
DECLARE n_hashed int; n_cleared int;
BEGIN
  ALTER TABLE public.aso_clients DISABLE TRIGGER trg_aso_clients_hash_plain_pin;
  UPDATE public.aso_clients SET portal_pin_hash = extensions.crypt(portal_pin, extensions.gen_salt('bf', 8)), portal_pin = NULL
   WHERE portal_pin IS NOT NULL AND portal_pin <> '' AND portal_pin_hash IS NULL;
  GET DIAGNOSTICS n_hashed = ROW_COUNT;
  UPDATE public.aso_clients SET portal_pin = NULL WHERE portal_pin IS NOT NULL;
  GET DIAGNOSTICS n_cleared = ROW_COUNT;
  ALTER TABLE public.aso_clients ENABLE TRIGGER trg_aso_clients_hash_plain_pin;
  RAISE NOTICE 'secrets | plain client PINs: % hashed, % stale cleared', n_hashed, n_cleared;
END $$;

DO $mem$
DECLARE d text; n text;
BEGIN
  SELECT pg_get_functiondef('public.get_my_membership()'::regprocedure) INTO d;
  n := replace(d, 'to_jsonb(v_row)',
    '(to_jsonb(v_row) - ARRAY[''portal_pin'', ''portal_pin_hash'', ''otp_code'', ''otp_expires_at'', ''portal_token'', ''member_session_token'', ''member_session_expires_at'', ''pin_reset_otp_hash'', ''pin_reset_otp_exp''])');
  IF n <> d THEN EXECUTE n; RAISE NOTICE 'secrets | get_my_membership no longer returns tokens, OTPs or PIN hashes';
  ELSE RAISE NOTICE 'secrets | get_my_membership: to_jsonb(v_row) not found — check by hand'; END IF;
EXCEPTION WHEN undefined_function THEN RAISE NOTICE 'secrets | get_my_membership not found, skipped';
END $mem$;
