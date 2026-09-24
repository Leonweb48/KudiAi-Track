-- ════════════════════════════════════════════════════════════════════════════
-- WALLET TIERS (owner, Ajo/Esusu client, staff, manager — every wallet holder).
--
--   Tier 1 Basic          email + phone + a BVN or NIN (what opening a wallet already needs)
--                         max balance ₦300,000 · daily transfers ₦100,000 · single transfer ₦50,000
--   Tier 2 Verified       + full name, residential address, and BOTH BVN and NIN
--                         max balance ₦500,000 · daily ₦200,000 · single ₦200,000
--   Tier 3 Fully Verified + valid ID, utility bill (proof of address), passport photograph — reviewed by our team
--                         max balance unlimited · daily ₦5,000,000 · single ₦5,000,000
--
-- EVERYONE starts at Tier 1 — every existing wallet (column default) and every new one. Tier 1's numbers are the limits the
-- wallet already had (daily ₦100k, single ₦50k) except the max balance, which rises from ₦200k to ₦300k, so nobody loses
-- anything. All limits live in platform_config (wallet_tier{1,2,3}_{max_balance,daily_limit,per_transfer}_kobo) so they can be
-- changed without a deploy; max_balance 0 means unlimited.
--
-- ENFORCEMENT: the three functions that cap transfers (wallet_hold_transfer, wallet_submit_withdrawal,
-- wallet_hold_scheduled_transfer) now read the caller's tier limits — re-created at the bottom from their current definitions
-- with only the two cap lookups swapped. The max balance is enforced where external deposits arrive (flutterwave-webhook).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS tier            smallint    NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tier_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallets_tier_check') THEN
    ALTER TABLE public.wallets ADD CONSTRAINT wallets_tier_check CHECK (tier BETWEEN 1 AND 3);
  END IF;
END $$;

INSERT INTO public.platform_config (key, value) VALUES
  ('wallet_tier1_max_balance_kobo',  '30000000'),   -- ₦300,000
  ('wallet_tier1_daily_limit_kobo',  '10000000'),   -- ₦100,000
  ('wallet_tier1_per_transfer_kobo', '5000000'),    -- ₦50,000
  ('wallet_tier2_max_balance_kobo',  '50000000'),   -- ₦500,000
  ('wallet_tier2_daily_limit_kobo',  '20000000'),   -- ₦200,000
  ('wallet_tier2_per_transfer_kobo', '20000000'),   -- ₦200,000
  ('wallet_tier3_max_balance_kobo',  '0'),          -- unlimited
  ('wallet_tier3_daily_limit_kobo',  '500000000'),  -- ₦5,000,000
  ('wallet_tier3_per_transfer_kobo', '500000000')   -- ₦5,000,000
ON CONFLICT (key) DO NOTHING;

-- ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- A user with no wallet row is Tier 1.
CREATE OR REPLACE FUNCTION public.wallet_tier_of(p_user_id uuid)
RETURNS smallint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT tier FROM public.wallets WHERE user_id = p_user_id), 1)::smallint;
$$;

-- The limit (kobo) for a user's tier: p_metric = 'max_balance' | 'daily_limit' | 'per_transfer'. Falls back to the old global
-- caps if a tier key is ever missing, so a config slip can never remove a limit. (max_balance 0 = unlimited.)
CREATE OR REPLACE FUNCTION public.wallet_tier_cfg(p_user_id uuid, p_metric text)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fallback bigint;
BEGIN
  v_fallback := CASE p_metric
    WHEN 'max_balance'  THEN public.wallet_cfg('wallet_max_balance_kobo', 20000000)
    WHEN 'daily_limit'  THEN public.wallet_cfg('wallet_daily_withdrawal_cap_kobo', 10000000)
    WHEN 'per_transfer' THEN public.wallet_cfg('wallet_max_withdrawal_kobo', 5000000)
  END;
  IF v_fallback IS NULL THEN RAISE EXCEPTION 'unknown wallet tier metric %', p_metric; END IF;
  RETURN public.wallet_cfg('wallet_tier' || public.wallet_tier_of(p_user_id) || '_' || p_metric || '_kobo', v_fallback);
END;
$$;

-- The message shown when a tier limit stops a transfer (no colon in it: the app trims text before a colon).
CREATE OR REPLACE FUNCTION public.wallet_tier_limit_msg(p_user_id uuid, p_metric text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tier smallint := public.wallet_tier_of(p_user_id);
  v_amt  text     := to_char(public.wallet_tier_cfg(p_user_id, p_metric) / 100, 'FM999,999,999,990');
  v_tail text     := CASE WHEN public.wallet_tier_of(p_user_id) >= 3 THEN 'Contact support if you need it raised.' ELSE 'Upgrade your account to raise it.' END;
BEGIN
  IF p_metric = 'per_transfer' THEN
    RETURN format('That is above your Tier %s per-transfer limit of ₦%s. %s', v_tier, v_amt, v_tail);
  END IF;
  RETURN format('You have reached your Tier %s daily transfer limit of ₦%s. %s', v_tier, v_amt, v_tail);
END;
$$;

-- ── upgrade data ──────────────────────────────────────────────────────────────────────────────────────────────────
-- What a user submitted for Tier 2. The BVN / NIN are stored ONLY as keyed hashes (computed by the edge function), never in
-- the clear — they are here to spot the same number being used on several wallets. RLS on, no policies: service role only.
CREATE TABLE IF NOT EXISTS public.wallet_kyc (
  user_id      uuid        PRIMARY KEY,
  tier         smallint    NOT NULL,
  full_name    text,
  address      text,
  state        text,
  lga          text,
  bvn_hmac     text,
  nin_hmac     text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_kyc_bvn_idx ON public.wallet_kyc (bvn_hmac) WHERE bvn_hmac IS NOT NULL;
CREATE INDEX IF NOT EXISTS wallet_kyc_nin_idx ON public.wallet_kyc (nin_hmac) WHERE nin_hmac IS NOT NULL;
ALTER TABLE public.wallet_kyc ENABLE ROW LEVEL SECURITY;

-- A request to move up a tier that needs a person to review it (Tier 3: ID, proof of address, photograph).
CREATE TABLE IF NOT EXISTS public.wallet_tier_requests (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,
  target_tier smallint    NOT NULL CHECK (target_tier IN (2, 3)),
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text
);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_tier_requests_one_pending ON public.wallet_tier_requests (user_id, target_tier) WHERE status = 'pending';
ALTER TABLE public.wallet_tier_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_tier_requests_own ON public.wallet_tier_requests;
CREATE POLICY wallet_tier_requests_own ON public.wallet_tier_requests FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ── RPCs (service role only — the edge function validates, hashes, then calls these) ────────────────────────────────

-- Tier 1 → 2. Idempotent (a wallet already at Tier 2+ is left alone). The same BVN/NIN on another wallet does NOT block the
-- upgrade (one person can legitimately hold several accounts) but raises an admin notification.
CREATE OR REPLACE FUNCTION public.wallet_apply_tier2(
  p_user_id uuid, p_full_name text, p_address text, p_state text, p_lga text, p_bvn_hmac text, p_nin_hmac text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tier smallint; v_dup boolean;
BEGIN
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  SELECT tier INTO v_tier FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No wallet'; END IF;
  IF v_tier >= 2 THEN RETURN jsonb_build_object('tier', v_tier, 'changed', false, 'duplicate', false); END IF;

  v_dup := EXISTS (SELECT 1 FROM public.wallet_kyc k
                    WHERE k.user_id <> p_user_id
                      AND ((p_bvn_hmac IS NOT NULL AND k.bvn_hmac = p_bvn_hmac) OR (p_nin_hmac IS NOT NULL AND k.nin_hmac = p_nin_hmac)));

  INSERT INTO public.wallet_kyc (user_id, tier, full_name, address, state, lga, bvn_hmac, nin_hmac)
  VALUES (p_user_id, 2, p_full_name, p_address, p_state, p_lga, p_bvn_hmac, p_nin_hmac)
  ON CONFLICT (user_id) DO UPDATE SET tier = 2, full_name = EXCLUDED.full_name, address = EXCLUDED.address, state = EXCLUDED.state,
    lga = EXCLUDED.lga, bvn_hmac = EXCLUDED.bvn_hmac, nin_hmac = EXCLUDED.nin_hmac, submitted_at = now();

  UPDATE public.wallets SET tier = 2, tier_updated_at = now() WHERE user_id = p_user_id;

  IF v_dup THEN
    INSERT INTO public.admin_notifications (type, category, title, message, metadata)
    VALUES ('warning', 'user', 'Tier 2 upgrade: BVN or NIN already used on another wallet',
            'A wallet was upgraded to Tier 2 with a BVN or NIN that another wallet also used. This can be one person with several accounts — review it if it looks wrong.',
            jsonb_build_object('user_id', p_user_id));
  END IF;
  RETURN jsonb_build_object('tier', 2, 'changed', true, 'duplicate', v_dup);
END;
$$;

-- A request for a tier that needs review (Tier 3). One pending request per user+tier; tells the admins.
CREATE OR REPLACE FUNCTION public.wallet_request_tier(p_user_id uuid, p_target smallint, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tier smallint; v_id uuid;
BEGIN
  SELECT tier INTO v_tier FROM public.wallets WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No wallet'; END IF;
  IF v_tier >= p_target THEN RETURN jsonb_build_object('requested', false, 'already_at_tier', true); END IF;
  INSERT INTO public.wallet_tier_requests (user_id, target_tier, note) VALUES (p_user_id, p_target, left(p_note, 500))
  ON CONFLICT (user_id, target_tier) WHERE status = 'pending' DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('requested', false, 'already_pending', true); END IF;
  INSERT INTO public.admin_notifications (type, category, title, message, metadata)
  VALUES ('info', 'user', 'Wallet Tier ' || p_target || ' upgrade requested',
          'A wallet holder asked to move up to Tier ' || p_target || '. Ask them for a valid ID, proof of address and a passport photograph, then approve with wallet_set_tier().',
          jsonb_build_object('user_id', p_user_id, 'request_id', v_id, 'target_tier', p_target));
  RETURN jsonb_build_object('requested', true, 'request_id', v_id);
END;
$$;

-- Manual approval (Tier 3) or correction: sets the tier and closes any pending request for it. Never used automatically.
CREATE OR REPLACE FUNCTION public.wallet_set_tier(p_user_id uuid, p_tier smallint, p_by text DEFAULT 'admin')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_tier NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'tier must be 1, 2 or 3'; END IF;
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallets SET tier = p_tier, tier_updated_at = now() WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No wallet'; END IF;
  UPDATE public.wallet_tier_requests SET status = 'approved', reviewed_at = now(), reviewed_by = p_by
   WHERE user_id = p_user_id AND status = 'pending' AND target_tier <= p_tier;
END;
$$;

-- ── the three transfer functions, re-created with tier limits ─────────────────────────────────────────────────────

-- ── wallet_hold_transfer (current definition, only the two cap lookups changed) ──
CREATE OR REPLACE FUNCTION public.wallet_hold_transfer(p_amount_kobo bigint, p_bank_code text, p_account_number text, p_account_name text DEFAULT NULL::text, p_narration text DEFAULT ''::text, p_book_expense boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_wallet    public.wallets;
  v_ledger    public.wallet_ledger;
  v_new       BIGINT;
  v_wd_id     UUID;
  v_today_out BIGINT;
  v_narr      TEXT := COALESCE(NULLIF(trim(p_narration), ''), 'Transfer to bank');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo < 10000 THEN RAISE EXCEPTION 'Minimum transfer is ₦100'; END IF;
  IF COALESCE(p_bank_code,'') = '' OR COALESCE(p_account_number,'') = '' THEN
    RAISE EXCEPTION 'Bank and account number are required';
  END IF;
  IF p_amount_kobo > public.wallet_tier_cfg(v_uid, 'per_transfer') THEN
    RAISE EXCEPTION '%', public.wallet_tier_limit_msg(v_uid, 'per_transfer');
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No wallet'; END IF;
  IF v_wallet.balance_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'Insufficient wallet balance' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_today_out
  FROM public.wallet_ledger
  WHERE user_id = v_uid AND source = 'withdrawal'
    AND status IN ('pending','completed')
    AND created_at >= date_trunc('day', now());
  IF v_today_out + p_amount_kobo > public.wallet_tier_cfg(v_uid, 'daily_limit') THEN
    RAISE EXCEPTION '%', public.wallet_tier_limit_msg(v_uid, 'daily_limit');
  END IF;

  v_new := v_wallet.balance_kobo - p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, narration
  ) VALUES (
    v_wallet.id, v_uid, 'debit', p_amount_kobo, v_new, 'withdrawal', 'pending', v_narr
  ) RETURNING * INTO v_ledger;

  INSERT INTO public.wallet_withdrawals (
    wallet_id, user_id, amount_kobo, bank_code, account_number, account_name,
    status, ledger_id, narration, book_expense
  ) VALUES (
    v_wallet.id, v_uid, p_amount_kobo, p_bank_code, p_account_number, p_account_name,
    'processing', v_ledger.id, v_narr, COALESCE(p_book_expense, false)
  ) RETURNING id INTO v_wd_id;

  RETURN v_wd_id;
END;
$function$;

-- ── wallet_submit_withdrawal (current definition, only the two cap lookups changed) ──
CREATE OR REPLACE FUNCTION public.wallet_submit_withdrawal(p_amount_kobo bigint, p_bank_code text, p_account_number text, p_account_name text DEFAULT NULL::text, p_narration text DEFAULT ''::text, p_book_expense boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_wallet    public.wallets;
  v_ledger    public.wallet_ledger;
  v_new       BIGINT;
  v_business  TEXT;
  v_req_id    UUID;
  v_wd_id     UUID;
  v_today_out BIGINT;
  v_narr      TEXT := COALESCE(NULLIF(trim(p_narration), ''), 'Transfer to bank');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF COALESCE(p_bank_code,'') = '' OR COALESCE(p_account_number,'') = '' THEN
    RAISE EXCEPTION 'Bank and account number are required';
  END IF;
  IF p_amount_kobo > public.wallet_tier_cfg(v_uid, 'per_transfer') THEN
    RAISE EXCEPTION '%', public.wallet_tier_limit_msg(v_uid, 'per_transfer');
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No wallet'; END IF;
  IF v_wallet.balance_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'Insufficient wallet balance' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_today_out
  FROM public.wallet_ledger
  WHERE user_id = v_uid AND source = 'withdrawal'
    AND status IN ('pending','completed')
    AND created_at >= date_trunc('day', now());
  IF v_today_out + p_amount_kobo > public.wallet_tier_cfg(v_uid, 'daily_limit') THEN
    RAISE EXCEPTION '%', public.wallet_tier_limit_msg(v_uid, 'daily_limit');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admin_approval_requests
    WHERE requester = v_uid AND request_type = 'wallet_withdrawal' AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'You already have a transfer awaiting approval';
  END IF;

  v_new := v_wallet.balance_kobo - p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, narration
  ) VALUES (
    v_wallet.id, v_uid, 'debit', p_amount_kobo, v_new, 'withdrawal', 'pending',
    v_narr || ' — awaiting admin approval'
  ) RETURNING * INTO v_ledger;

  INSERT INTO public.wallet_withdrawals (
    wallet_id, user_id, amount_kobo, bank_code, account_number, account_name,
    status, ledger_id, narration, book_expense
  ) VALUES (
    v_wallet.id, v_uid, p_amount_kobo, p_bank_code, p_account_number, p_account_name,
    'pending', v_ledger.id, v_narr, COALESCE(p_book_expense, false)
  ) RETURNING id INTO v_wd_id;

  SELECT business_name INTO v_business FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.admin_approval_requests(
    request_type, requester, business, target_id, payload, reason, status
  ) VALUES (
    'wallet_withdrawal', v_uid, COALESCE(v_business, ''), v_wd_id,
    jsonb_build_object(
      'withdrawal_id',  v_wd_id,
      'ledger_id',      v_ledger.id,
      'amount_kobo',    p_amount_kobo,
      'bank_code',      p_bank_code,
      'account_number', p_account_number,
      'account_name',   p_account_name,
      'narration',      v_narr,
      'book_expense',   COALESCE(p_book_expense, false),
      'submitted_at',   now()
    ),
    v_narr || ' — awaiting admin approval',
    'pending'
  ) RETURNING id INTO v_req_id;

  UPDATE public.wallet_withdrawals SET approval_request_id = v_req_id WHERE id = v_wd_id;
  RETURN v_req_id;
END;
$function$;

-- ── wallet_hold_scheduled_transfer (current definition, only the two cap lookups changed) ──
CREATE OR REPLACE FUNCTION public.wallet_hold_scheduled_transfer(p_owner_id uuid, p_scheduled_id uuid, p_amount_kobo bigint, p_bank_code text, p_account_number text, p_account_name text, p_narration text DEFAULT ''::text, p_book_expense boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wallet    public.wallets;
  v_ledger    public.wallet_ledger;
  v_new       BIGINT;
  v_wd_id     UUID;
  v_today_out BIGINT;
  v_narr      TEXT := COALESCE(NULLIF(trim(p_narration), ''), 'Scheduled transfer');
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo < 10000 THEN RAISE EXCEPTION 'Minimum transfer is ₦100'; END IF;
  IF COALESCE(p_bank_code, '') = '' OR COALESCE(p_account_number, '') = '' THEN
    RAISE EXCEPTION 'Bank and account number are required';
  END IF;
  IF p_amount_kobo > public.wallet_tier_cfg(p_owner_id, 'per_transfer') THEN
    RAISE EXCEPTION '%', public.wallet_tier_limit_msg(p_owner_id, 'per_transfer');
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No wallet'; END IF;
  IF v_wallet.status <> 'active' THEN RAISE EXCEPTION 'Wallet is not active'; END IF;
  IF v_wallet.balance_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'Insufficient wallet balance' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_today_out
  FROM public.wallet_ledger
  WHERE user_id = p_owner_id AND source = 'withdrawal'
    AND status IN ('pending', 'completed')
    AND created_at >= date_trunc('day', now());
  IF v_today_out + p_amount_kobo > public.wallet_tier_cfg(p_owner_id, 'daily_limit') THEN
    RAISE EXCEPTION '%', public.wallet_tier_limit_msg(p_owner_id, 'daily_limit');
  END IF;

  v_new := v_wallet.balance_kobo - p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, narration, meta
  ) VALUES (
    v_wallet.id, p_owner_id, 'debit', p_amount_kobo, v_new, 'withdrawal', 'pending', v_narr,
    jsonb_build_object('scheduled_transfer_id', p_scheduled_id)
  ) RETURNING * INTO v_ledger;

  INSERT INTO public.wallet_withdrawals (
    wallet_id, user_id, amount_kobo, bank_code, account_number, account_name,
    status, ledger_id, narration, book_expense
  ) VALUES (
    v_wallet.id, p_owner_id, p_amount_kobo, p_bank_code, p_account_number, p_account_name,
    'processing', v_ledger.id, v_narr, COALESCE(p_book_expense, false)
  ) RETURNING id INTO v_wd_id;

  RETURN v_wd_id;
END;
$function$;

-- ── privileges: the helpers are called from SECURITY DEFINER functions (which run as their owner); the RPCs by the edge function ──
REVOKE ALL ON FUNCTION public.wallet_tier_of(uuid)                                                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_tier_cfg(uuid, text)                                                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_tier_limit_msg(uuid, text)                                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_apply_tier2(uuid, text, text, text, text, text, text)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_request_tier(uuid, smallint, text)                                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_set_tier(uuid, smallint, text)                                       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_tier_of(uuid)                                                     TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_tier_cfg(uuid, text)                                              TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_tier_limit_msg(uuid, text)                                        TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_apply_tier2(uuid, text, text, text, text, text, text)             TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_request_tier(uuid, smallint, text)                                TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_set_tier(uuid, smallint, text)                                    TO service_role;

-- ── self-test: if anything below is wrong the whole migration rolls back and nothing changes ─────────────────────────────
DO $$
DECLARE v_uid uuid; v_name text;
BEGIN
  SELECT user_id INTO v_uid FROM public.wallets ORDER BY created_at LIMIT 1;
  IF v_uid IS NOT NULL THEN
    RAISE NOTICE 'tier self-test: tier=% per_transfer=% daily=% max_balance=%', public.wallet_tier_of(v_uid),
      public.wallet_tier_cfg(v_uid, 'per_transfer'), public.wallet_tier_cfg(v_uid, 'daily_limit'), public.wallet_tier_cfg(v_uid, 'max_balance');
    RAISE NOTICE 'tier self-test messages: % | %', public.wallet_tier_limit_msg(v_uid, 'per_transfer'), public.wallet_tier_limit_msg(v_uid, 'daily_limit');
  END IF;
  FOR v_name IN
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('wallet_hold_transfer', 'wallet_submit_withdrawal', 'wallet_hold_scheduled_transfer')
       AND pg_get_functiondef(p.oid) NOT LIKE '%wallet_tier_cfg%'
  LOOP
    RAISE EXCEPTION 'tier migration: % was not updated to use tier limits', v_name;
  END LOOP;
  RAISE NOTICE 'wallets by tier: %', (SELECT jsonb_object_agg(tier::text, n) FROM (SELECT tier, count(*) AS n FROM public.wallets GROUP BY tier) t);
END $$;
