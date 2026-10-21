-- Bigisub as the third bill provider — a BACKUP for airtime and data (owner's decision 2026-10-21; see
-- supabase/functions/_shared/bigisub.ts). It takes no reference from us, so the order's claim row keeps Bigisub's own
-- transaction id (bg_tranx_id) and what we sent (bg_meta: number, service, time) for finding a lost order in its history.
-- OFF until a live test passes: platform_config.bill_provider_bigisub = 'false' (the workflow "Bigisub keys" turns it on).

ALTER TABLE public.bill_provider_attempts DROP CONSTRAINT IF EXISTS bill_provider_attempts_providers_check;
ALTER TABLE public.bill_provider_attempts ADD CONSTRAINT bill_provider_attempts_providers_check
  CHECK (cardinality(providers) BETWEEN 1 AND 4 AND providers <@ ARRAY['clubkonnect', 'vtpass', 'bigisub']::text[]);
ALTER TABLE public.bill_provider_attempts
  ADD COLUMN IF NOT EXISTS bg_tranx_id text CHECK (bg_tranx_id IS NULL OR length(bg_tranx_id) <= 64),
  ADD COLUMN IF NOT EXISTS bg_meta     jsonb;
CREATE INDEX IF NOT EXISTS bill_provider_attempts_bg_tranx_idx ON public.bill_provider_attempts (bg_tranx_id) WHERE bg_tranx_id IS NOT NULL;

-- Same function as 20270244000000, accepting 'bigisub' too.
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
  IF p_provider IS NULL OR p_provider NOT IN ('clubkonnect', 'vtpass', 'bigisub') THEN
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

INSERT INTO public.platform_config (key, value, description) VALUES
  ('bill_provider_bigisub', 'false',
   'Bigisub as the backup for airtime and data: when ClubKonnect (and VTpass) can''t take an order, or ClubKonnect''s wallet is too low for data, orders go to Bigisub. Needs its token + PIN (workflow "Bigisub keys"). true / false.')
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE 'bigisub | switch=% | claim accepts bigisub: %',
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider_bigisub'),
    (SELECT pg_get_functiondef('public.bill_provider_claim(text,text,text,text[],text)'::regprocedure) LIKE '%''bigisub''%');
END $$;
