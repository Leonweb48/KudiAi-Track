-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Bill provider switch: ClubKonnect or VTpass, with automatic failover between them.
-- Logic + tests: supabase/functions/_shared/billProvider.ts (routing) and _shared/vtpass.ts (the VTpass client);
-- wiring: supabase/functions/clubkonnect/index.ts (airtime, data, data-plans, verify, bill-preflight, provider-status).
--
-- Airtime and data can be served by either provider; every other bill stays on ClubKonnect. The admin picks the main
-- provider and whether an order may move to the other one when the main one is down. VTpass only ever serves customers
-- with LIVE keys (the VTPASS_ENV function secret, set together with the keys) — its sandbox is play money.
--
-- bill_provider_attempts: which provider(s) each bill order was sent to. An order is claimed for a provider BEFORE it
-- is sent there, so a retry always goes back to the same provider (which won't place it twice) and `verify` knows whom
-- to ask. Written and read only by the clubkonnect function with the service-role key.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.bill_provider_attempts (
  request_id    text PRIMARY KEY CHECK (length(request_id) BETWEEN 1 AND 64),
  service       text NOT NULL CHECK (length(service) BETWEEN 1 AND 32),
  providers     text[] NOT NULL CHECK (cardinality(providers) BETWEEN 1 AND 4 AND providers <@ ARRAY['clubkonnect', 'vtpass']::text[]),
  vt_request_id text CHECK (vt_request_id IS NULL OR length(vt_request_id) <= 64),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bill_provider_attempts_created_idx ON public.bill_provider_attempts (created_at);
ALTER TABLE public.bill_provider_attempts ENABLE ROW LEVEL SECURITY;   -- no policies: nobody but the service role
REVOKE ALL ON TABLE public.bill_provider_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.bill_provider_attempts TO service_role;

COMMENT ON TABLE public.bill_provider_attempts IS
  'Which bill provider(s) each order (by our reference) was sent to, in order; the last one is where it lives. See _shared/billProvider.ts.';

-- Claim an order for a provider. New order → recorded with that provider. Existing order → the provider is appended
-- ONLY if the caller's view (p_expect) is still current and the order has never been there; otherwise nothing changes.
-- Returns {providers, vt_request_id} after the call — the caller sends the order to the LAST provider, and to VTpass
-- always under the STORED vt_request_id (the first one recorded), so a retry can never look like a new order there.
CREATE OR REPLACE FUNCTION public.bill_provider_claim(
  p_request_id text, p_service text, p_provider text, p_expect text[], p_vt_request_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  cur    text[];
  cur_vt text;
BEGIN
  IF p_provider IS NULL OR p_provider NOT IN ('clubkonnect', 'vtpass') THEN
    RAISE EXCEPTION 'bill_provider_claim: unknown provider %', p_provider;
  END IF;

  INSERT INTO public.bill_provider_attempts (request_id, service, providers, vt_request_id)
  VALUES (p_request_id, p_service, ARRAY[p_provider], CASE WHEN p_provider = 'vtpass' THEN p_vt_request_id END)
  ON CONFLICT (request_id) DO NOTHING
  RETURNING providers, vt_request_id INTO cur, cur_vt;

  IF NOT FOUND THEN
    SELECT providers, vt_request_id INTO cur, cur_vt FROM public.bill_provider_attempts WHERE request_id = p_request_id FOR UPDATE;
    IF cur = COALESCE(p_expect, '{}'::text[]) AND NOT (p_provider = ANY (cur)) THEN
      UPDATE public.bill_provider_attempts
         SET providers     = cur || p_provider,
             vt_request_id = COALESCE(vt_request_id, CASE WHEN p_provider = 'vtpass' THEN p_vt_request_id END),
             updated_at    = now()
       WHERE request_id = p_request_id
      RETURNING providers, vt_request_id INTO cur, cur_vt;
    END IF;
  END IF;
  RETURN jsonb_build_object('providers', to_jsonb(cur), 'vt_request_id', cur_vt);
END $$;

REVOKE ALL ON FUNCTION public.bill_provider_claim(text, text, text, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bill_provider_claim(text, text, text, text[], text) TO service_role;

-- The admin's switches (Admin portal → Bill provider).
INSERT INTO public.platform_config (key, value, description) VALUES
  ('bill_provider', 'clubkonnect',
   'Main provider for airtime and data: clubkonnect or vtpass. Every other bill always uses ClubKonnect. VTpass is only used with live keys.'),
  ('bill_provider_failover', 'true',
   'When the main provider is down (or refuses an order for an account reason such as an empty wallet), send airtime/data orders to the other provider automatically. The other provider is only tried once the first has confirmed it holds no order.')
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.platform_config WHERE key IN ('bill_provider', 'bill_provider_failover');
  IF v_n <> 2 THEN RAISE EXCEPTION 'bill provider switches: expected 2 keys, found %', v_n; END IF;
  RAISE NOTICE 'bill provider | main=% failover=%',
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider'),
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider_failover');
END $$;
