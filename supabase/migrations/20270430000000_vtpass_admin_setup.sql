-- VTpass set up from the admin portal (2026-10-26, owner: "when we get the live API we just input it there and switch it
-- as our default provider"). Until now the keys could only be installed by the GitHub workflow "VTpass live keys"
-- (repository secrets → function secrets → redeploy).
--   • The keys are kept in Supabase Vault (encrypted at rest), written and read only through the service-role functions
--     below. The admin portal (Super Admin) saves them and never gets them back — only their last 4 characters.
--   • vtpass_settings (one row): the environment (live / sandbox — the sandbox never serves a customer), who saved what and
--     when. Switching to sandbox is the kill switch; the keys stay.
--   • The clubkonnect function reads vtpass_get_config() once a minute; when nothing is saved here it still uses its own
--     VTPASS_* secrets (the GitHub workflow), as before.
--   • VTpass may only accept calls from a whitelisted IP: platform_config.vtpass_via_relay = "true" sends them through the
--     payout relay (209.71.82.233), like ClubKonnect's.
--   • The Bills account checks VTpass's wallet too (finance_bills_report, copied from 20270428 with 'vtpass' added).

CREATE TABLE IF NOT EXISTS public.vtpass_settings (
  id               int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  env              text NOT NULL DEFAULT 'sandbox' CHECK (env IN ('sandbox', 'live')),
  api_key_last4    text, secret_key_last4 text, public_key_last4 text,
  keys_saved_by    text, keys_saved_at timestamptz,
  env_set_by       text, env_set_at timestamptz
);
INSERT INTO public.vtpass_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.vtpass_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vtpass_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vtpass_settings TO service_role;

INSERT INTO public.platform_config (key, value, description) VALUES
  ('vtpass_via_relay', 'false', 'Send VTpass API calls through the fixed-IP relay (209.71.82.233) — needed when VTpass only accepts whitelisted IPs. Admin portal → VTpass setup.')
ON CONFLICT (key) DO NOTHING;

-- one Vault secret by name: create, replace, or (NULL) remove
CREATE OR REPLACE FUNCTION public._vtpass_vault_put(p_name text, p_value text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = p_name;
  IF p_value IS NULL THEN
    IF v_id IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_id; END IF;
  ELSIF v_id IS NULL THEN
    PERFORM vault.create_secret(p_value, p_name, 'VTpass key — saved from the admin portal (VTpass setup)');
  ELSE
    PERFORM vault.update_secret(v_id, p_value);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._vtpass_vault_put(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- save the keys (all three replaced together; the public key may be left out) and the environment they belong to
CREATE OR REPLACE FUNCTION public.vtpass_save_keys(p_env text, p_api_key text, p_secret_key text, p_public_key text, p_admin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k text; v_pub text := NULLIF(btrim(COALESCE(p_public_key, '')), '');
BEGIN
  IF p_env NOT IN ('live', 'sandbox') THEN RETURN jsonb_build_object('ok', false, 'error', 'Choose Live or Sandbox'); END IF;
  IF COALESCE(btrim(p_admin), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'who is saving?'); END IF;
  FOREACH k IN ARRAY ARRAY[btrim(COALESCE(p_api_key, '')), btrim(COALESCE(p_secret_key, '')), COALESCE(v_pub, 'PUBLICKEYNOTGIVEN')] LOOP
    IF k !~ '^[A-Za-z0-9_-]{8,200}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Each key is 8–200 letters, digits, _ or - (copy it again from vtpass.com → Settings → API Keys)');
    END IF;
  END LOOP;
  IF btrim(p_api_key) = btrim(p_secret_key) THEN RETURN jsonb_build_object('ok', false, 'error', 'The API key and the secret key are the same — paste each into its own box'); END IF;
  PERFORM public._vtpass_vault_put('vtpass_api_key', btrim(p_api_key));
  PERFORM public._vtpass_vault_put('vtpass_secret_key', btrim(p_secret_key));
  PERFORM public._vtpass_vault_put('vtpass_public_key', v_pub);
  UPDATE public.vtpass_settings SET env = p_env, api_key_last4 = right(btrim(p_api_key), 4), secret_key_last4 = right(btrim(p_secret_key), 4),
         public_key_last4 = right(v_pub, 4), keys_saved_by = p_admin, keys_saved_at = now(), env_set_by = p_admin, env_set_at = now()
   WHERE id = 1;
  RETURN jsonb_build_object('ok', true);
END $$;

-- live / sandbox only (the kill switch); live needs saved keys
CREATE OR REPLACE FUNCTION public.vtpass_set_env(p_env text, p_admin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_env NOT IN ('live', 'sandbox') THEN RETURN jsonb_build_object('ok', false, 'error', 'Choose Live or Sandbox'); END IF;
  IF p_env = 'live' AND NOT EXISTS (SELECT 1 FROM public.vtpass_settings WHERE id = 1 AND api_key_last4 IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Save the live keys first');
  END IF;
  UPDATE public.vtpass_settings SET env = p_env, env_set_by = p_admin, env_set_at = now() WHERE id = 1;
  RETURN jsonb_build_object('ok', true);
END $$;

-- remove the saved keys (the function falls back to its own secrets, if any)
CREATE OR REPLACE FUNCTION public.vtpass_clear_keys(p_admin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._vtpass_vault_put('vtpass_api_key', NULL);
  PERFORM public._vtpass_vault_put('vtpass_secret_key', NULL);
  PERFORM public._vtpass_vault_put('vtpass_public_key', NULL);
  UPDATE public.vtpass_settings SET env = 'sandbox', api_key_last4 = NULL, secret_key_last4 = NULL, public_key_last4 = NULL,
         keys_saved_by = p_admin, keys_saved_at = now(), env_set_by = p_admin, env_set_at = now() WHERE id = 1;
  RETURN jsonb_build_object('ok', true);
END $$;

-- what the clubkonnect function uses (keys in clear) — the service role only
CREATE OR REPLACE FUNCTION public.vtpass_get_config() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, vault, pg_temp AS $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM public.vtpass_settings WHERE id = 1;
  IF s IS NULL OR s.api_key_last4 IS NULL THEN RETURN jsonb_build_object('saved', false); END IF;
  RETURN jsonb_build_object('saved', true, 'env', s.env,
    'api_key',    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'vtpass_api_key'),
    'secret_key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'vtpass_secret_key'),
    'public_key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'vtpass_public_key'));
END $$;

REVOKE ALL ON FUNCTION public.vtpass_save_keys(text, text, text, text, text), public.vtpass_set_env(text, text), public.vtpass_clear_keys(text),
  public.vtpass_get_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vtpass_save_keys(text, text, text, text, text), public.vtpass_set_env(text, text), public.vtpass_clear_keys(text),
  public.vtpass_get_config() TO service_role;

-- self-test against the real Vault (rolled back, nothing stays): save, read back, replace, clear
DO $$
DECLARE r jsonb; v_err text;
BEGIN
  r := public.vtpass_save_keys('live', 'selftestapikey01', 'selftestsecret01', NULL, 'selftest');
  IF NOT (r ->> 'ok')::boolean THEN RAISE EXCEPTION 'vtpass self-test: save refused: %', r; END IF;
  r := public.vtpass_get_config();
  IF r ->> 'api_key' <> 'selftestapikey01' OR r ->> 'secret_key' <> 'selftestsecret01' OR r ->> 'env' <> 'live' OR r ->> 'public_key' IS NOT NULL THEN
    RAISE EXCEPTION 'vtpass self-test: read back wrong';
  END IF;
  PERFORM public.vtpass_save_keys('sandbox', 'selftestapikey02', 'selftestsecret02', 'selftestpublic02', 'selftest');
  r := public.vtpass_get_config();
  IF r ->> 'api_key' <> 'selftestapikey02' OR r ->> 'public_key' <> 'selftestpublic02' OR r ->> 'env' <> 'sandbox' THEN RAISE EXCEPTION 'vtpass self-test: replace wrong'; END IF;
  PERFORM public.vtpass_clear_keys('selftest');
  IF (public.vtpass_get_config() ->> 'saved')::boolean OR EXISTS (SELECT 1 FROM vault.secrets WHERE name LIKE 'vtpass\_%') THEN RAISE EXCEPTION 'vtpass self-test: clear left keys'; END IF;
  RAISE EXCEPTION 'vtpass self-test passed (rolled back)';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  IF v_err NOT LIKE 'vtpass self-test passed%' THEN RAISE; END IF;
  RAISE NOTICE 'vtpass | vault self-test passed';
END $$;

-- Bills account: VTpass's wallet checked like the others
CREATE OR REPLACE FUNCTION public.finance_bills_report(p_from timestamptz, p_to timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_out jsonb; v_wallets jsonb := '[]'::jsonb; p text;
  v_open record; v_close record; v_latest record; v_top bigint; v_cost bigint;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN RAISE EXCEPTION 'a valid period is required'; END IF;


  -- each provider wallet: opening and closing readings around the period, top-ups and recorded cost between those two readings
  FOREACH p IN ARRAY ARRAY['clubkonnect', 'bigisub', 'vtpass'] LOOP
    SELECT balance_kobo, observed_at INTO v_open FROM public.bill_provider_balances
     WHERE provider = p AND observed_at <= p_from ORDER BY observed_at DESC LIMIT 1;
    IF v_open IS NULL OR v_open.observed_at IS NULL THEN
      SELECT balance_kobo, observed_at INTO v_open FROM public.bill_provider_balances
       WHERE provider = p AND observed_at > p_from AND observed_at < p_to ORDER BY observed_at LIMIT 1;
    END IF;
    SELECT balance_kobo, observed_at INTO v_close FROM public.bill_provider_balances
     WHERE provider = p AND observed_at < p_to ORDER BY observed_at DESC LIMIT 1;
    SELECT balance_kobo, observed_at INTO v_latest FROM public.bill_provider_balances WHERE provider = p ORDER BY observed_at DESC LIMIT 1;
    v_top := NULL; v_cost := NULL;
    IF v_open.observed_at IS NOT NULL AND v_close.observed_at IS NOT NULL AND v_close.observed_at > v_open.observed_at THEN
      SELECT COALESCE(sum(amount_kobo), 0) INTO v_top FROM public.bill_provider_topups
       WHERE provider = p AND voided_at IS NULL AND paid_at >= v_open.observed_at AND paid_at < v_close.observed_at;
      SELECT COALESCE(-sum(e.amount_kobo), 0) INTO v_cost
        FROM public.finance_entries e
        LEFT JOIN LATERAL (SELECT x.meta FROM public.finance_entries x
                            WHERE e.source_type IN ('bill_cost_reversal', 'bill_cost_rate_void') AND x.line_code = 'bills.provider_cost'
                              AND x.source_type || ':' || x.source_id = CASE WHEN e.source_type = 'bill_cost_rate_void' THEN 'bill_cost_rate:' || e.source_id ELSE e.source_id END
                            LIMIT 1) o ON true
       WHERE e.line_code = 'bills.provider_cost' AND e.occurred_at >= v_open.observed_at AND e.occurred_at < v_close.observed_at
         AND COALESCE(e.meta ->> 'provider', o.meta ->> 'provider', 'clubkonnect') = p;
    END IF;
    v_wallets := v_wallets || jsonb_build_array(jsonb_build_object(
      'provider', p,
      'opening_kobo', v_open.balance_kobo, 'opening_at', v_open.observed_at,
      'closing_kobo', CASE WHEN v_close.observed_at > v_open.observed_at THEN v_close.balance_kobo END,
      'closing_at',   CASE WHEN v_close.observed_at > v_open.observed_at THEN v_close.observed_at END,
      'topups_kobo', v_top,
      'spent_kobo', CASE WHEN v_top IS NOT NULL THEN v_open.balance_kobo + v_top - v_close.balance_kobo END,
      'recorded_cost_kobo', v_cost,
      'difference_kobo', CASE WHEN v_top IS NOT NULL THEN (v_open.balance_kobo + v_top - v_close.balance_kobo) - v_cost END,
      'latest_kobo', v_latest.balance_kobo, 'latest_at', v_latest.observed_at));
    v_open := NULL; v_close := NULL; v_latest := NULL;
  END LOOP;

  WITH _bills_e (occurred_at, kind, amount_kobo, estimated, cat, provider, reference) AS (
  SELECT e.occurred_at,
         CASE e.line_code WHEN 'bills.sales' THEN 'sale' WHEN 'bills.refunds' THEN 'refund' WHEN 'bills.provider_cost' THEN 'cost' ELSE 'fee' END,
         e.amount_kobo, e.estimated, COALESCE(NULLIF(lower(e.category), ''), 'other'),
         CASE WHEN e.line_code = 'bills.provider_cost' THEN COALESCE(e.meta ->> 'provider', o.meta ->> 'provider', 'clubkonnect') END,
         regexp_replace(COALESCE(e.reference, ''), '-(MTN|AIR|9MB|GLO)$', '')
    FROM public.finance_entries e
    LEFT JOIN LATERAL (SELECT x.meta FROM public.finance_entries x
                        WHERE e.source_type IN ('bill_cost_reversal', 'bill_cost_rate_void') AND x.line_code = 'bills.provider_cost'
                          AND x.source_type || ':' || x.source_id = CASE WHEN e.source_type = 'bill_cost_rate_void' THEN 'bill_cost_rate:' || e.source_id ELSE e.source_id END
                        LIMIT 1) o ON true
   WHERE e.occurred_at >= p_from AND e.occurred_at < p_to
     AND (e.line_code IN ('bills.sales', 'bills.refunds', 'bills.provider_cost') OR (e.line_code = 'payments.processor_fee' AND e.meta ->> 'stream' = 'bills'))
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', (SELECT jsonb_build_object(
        'sales_kobo',          COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'sale'), 0),
        'refunds_kobo',        COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'refund'), 0),
        'cost_kobo',           COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'cost'), 0),
        'cost_estimated_kobo', COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'cost' AND estimated), 0),
        'card_fees_kobo',      COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'fee'), 0),
        'profit_kobo',         COALESCE(sum(amount_kobo), 0),
        'orders',              count(*) FILTER (WHERE kind = 'sale'),
        'refunded_orders',     count(*) FILTER (WHERE kind = 'refund')) FROM _bills_e),
    -- sales kept (not refunded) that have no cost of any kind: their profit is overstated until a cost is booked
    'uncosted', (SELECT jsonb_build_object('orders', count(*), 'sales_kobo', COALESCE(sum(s.amount_kobo), 0))
                   FROM _bills_e s
                  WHERE s.kind = 'sale' AND s.reference <> ''
                    AND NOT EXISTS (SELECT 1 FROM public.finance_entries c WHERE c.line_code = 'bills.provider_cost'
                                      AND regexp_replace(COALESCE(c.reference, ''), '-(MTN|AIR|9MB|GLO)$', '') = s.reference)
                    AND NOT EXISTS (SELECT 1 FROM public.finance_entries r WHERE r.line_code = 'bills.refunds' AND r.reference = s.reference)),
    'by_service', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY t.sales_kobo DESC) FROM (
        SELECT cat AS service,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'sale'), 0)   AS sales_kobo,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'refund'), 0) AS refunds_kobo,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'cost'), 0)   AS cost_kobo,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'cost' AND estimated), 0) AS cost_estimated_kobo,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'fee'), 0)    AS card_fees_kobo,
               COALESCE(sum(amount_kobo), 0) AS profit_kobo,
               count(*) FILTER (WHERE kind = 'sale') AS orders,
               count(*) FILTER (WHERE kind = 'refund') AS refunded_orders
          FROM _bills_e GROUP BY cat) t), '[]'::jsonb),
    'by_provider', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY t.cost_kobo) FROM (
        SELECT provider, COALESCE(sum(amount_kobo), 0) AS cost_kobo,
               COALESCE(sum(amount_kobo) FILTER (WHERE estimated), 0) AS cost_estimated_kobo,
               count(DISTINCT reference) FILTER (WHERE amount_kobo < 0) AS orders
          FROM _bills_e WHERE kind = 'cost' GROUP BY provider) t), '[]'::jsonb),
    'daily', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY t.day) FROM (
        SELECT (occurred_at AT TIME ZONE 'Africa/Lagos')::date AS day,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'sale'), 0)   AS sales_kobo,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'refund'), 0) AS refunds_kobo,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'cost'), 0)   AS cost_kobo,
               COALESCE(sum(amount_kobo), 0) AS profit_kobo,
               count(*) FILTER (WHERE kind = 'sale') AS orders
          FROM _bills_e GROUP BY 1) t), '[]'::jsonb),
    'wallets', v_wallets,
    'topups', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'provider', provider, 'amount_kobo', amount_kobo, 'paid_at', paid_at, 'note', note,
                                                             'created_by', created_by, 'voided_at', voided_at, 'voided_by', voided_by) ORDER BY paid_at DESC)
                          FROM public.bill_provider_topups WHERE paid_at >= p_from AND paid_at < p_to), '[]'::jsonb),
    'last_sync', (SELECT last_run FROM public.finance_sync_state WHERE key = 'main')
  ) INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.finance_bills_report(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_bills_report(timestamptz, timestamptz) TO service_role;
