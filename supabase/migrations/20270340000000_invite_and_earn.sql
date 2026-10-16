-- ═════════════════════════════════════════════════════════════════════════════
-- Invite & Earn — referral rewards for business owners AND Ajo clients.
--
-- How it works
--   • Every user gets one invite code (invite_codes) and shares kudiai.app/?invite=CODE.
--   • A NEW account (≤ 3 days old) claims the code once (invite_claim) → an `invites` row.
--   • The friend qualifies when, within `referral_window_days` of joining, they
--       1. open their KudiAI wallet (virtual account provisioned = BVN/NIN done), and
--       2. move at least `referral_min_spend_kobo` OUT of it themselves
--          (bank transfer, bills, plan payment, Ajo / circle contribution).
--     Money sent TO the friend never counts, so an inviter can't buy the reward.
--   • Rewards per 7-day campaign (invite_campaigns): tier 1/2/3 = referral_tiers_kobo
--     (₦500 / ₦700 / ₦1,000). Friends past the 3rd still earn their own welcome bonus.
--   • The friend gets referral_friend_bonus_kobo (₦200) when they qualify.
--   • Payouts are real double-entry moves: debit the platform settlement wallet
--     (fee income) → credit the user, source 'referral_reward', idempotent on
--     flw_reference 'invite:<id>:<who>'. If settlement can't cover it, the invite
--     stays 'qualified' and the 10-minute cron retries — nothing is half-paid.
--   • Fraud guards: same BVN as the inviter → rejected; a BVN can earn the welcome
--     bonus once; own code refused; old accounts can't claim.
--   • Kill switch: platform_config.referral_enabled ('true' | 'false').
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 0. config ────────────────────────────────────────────────────────────────
INSERT INTO public.platform_config (key, value, description) VALUES
  ('referral_enabled',           'true',                 'Invite & Earn on/off (owner + client portals)'),
  ('referral_tiers_kobo',        '50000,70000,100000',   'Invite & Earn: inviter reward per qualified friend in one campaign, tier 1,2,3 (kobo)'),
  ('referral_friend_bonus_kobo', '20000',                'Invite & Earn: welcome bonus for the invited friend (kobo)'),
  ('referral_min_spend_kobo',    '200000',               'Invite & Earn: friend must move this much out of their wallet (kobo)'),
  ('referral_window_days',       '7',                    'Invite & Earn: days the friend has to qualify'),
  ('referral_campaign_days',     '7',                    'Invite & Earn: length of an inviter campaign (tiers reset after)')
ON CONFLICT (key) DO NOTHING;

-- ── 1. ledger source ─────────────────────────────────────────────────────────
DO $$
DECLARE v_def text; v_have text[]; v_all text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.wallet_ledger'::regclass AND conname = 'wallet_ledger_source_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'wallet_ledger_source_check not found — refusing to guess its contents'; END IF;
  SELECT COALESCE(array_agg(DISTINCT m[1]), ARRAY[]::text[]) INTO v_have FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m;
  IF 'referral_reward' = ANY (v_have) THEN RETURN; END IF;
  IF COALESCE(array_length(v_have, 1), 0) < 10 THEN
    RAISE EXCEPTION 'wallet_ledger_source_check parsed to only % sources — refusing to rewrite it. Definition: %', COALESCE(array_length(v_have, 1), 0), v_def;
  END IF;
  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_all FROM unnest(v_have || ARRAY['referral_reward']) AS s;
  ALTER TABLE public.wallet_ledger DROP CONSTRAINT wallet_ledger_source_check;
  EXECUTE format('ALTER TABLE public.wallet_ledger ADD CONSTRAINT wallet_ledger_source_check CHECK (source IN (%s))',
                 (SELECT string_agg(quote_literal(s), ', ' ORDER BY s) FROM unnest(v_all) AS s));
END $$;

-- ── 2. tables ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invite_codes (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invite_campaigns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS invite_campaigns_user_ends ON public.invite_campaigns (user_id, ends_at DESC);

CREATE TABLE IF NOT EXISTS public.invites (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id           uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id         uuid REFERENCES public.invite_campaigns(id) ON DELETE SET NULL,
  code                text NOT NULL,
  friend_portal       text NOT NULL DEFAULT 'owner' CHECK (friend_portal IN ('owner', 'client')),
  status              text NOT NULL DEFAULT 'joined'
                      CHECK (status IN ('joined', 'wallet_open', 'qualified', 'rewarded', 'expired', 'rejected')),
  joined_at           timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  wallet_opened_at    timestamptz,
  spent_kobo          bigint NOT NULL DEFAULT 0,
  qualified_at        timestamptz,
  tier                smallint,
  inviter_reward_kobo bigint NOT NULL DEFAULT 0,
  friend_reward_kobo  bigint NOT NULL DEFAULT 0,
  inviter_paid_at     timestamptz,
  friend_paid_at      timestamptz,
  reject_reason       text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (inviter_id <> friend_id)
);
CREATE INDEX IF NOT EXISTS invites_inviter ON public.invites (inviter_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS invites_open    ON public.invites (status) WHERE status IN ('joined', 'wallet_open', 'qualified');

ALTER TABLE public.invite_codes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invite_codes_own ON public.invite_codes;
CREATE POLICY invite_codes_own ON public.invite_codes FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS invite_campaigns_own ON public.invite_campaigns;
CREATE POLICY invite_campaigns_own ON public.invite_campaigns FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS invites_party ON public.invites;
CREATE POLICY invites_party ON public.invites FOR SELECT TO authenticated USING (inviter_id = auth.uid() OR friend_id = auth.uid());

-- all writes go through the SECURITY DEFINER functions below
REVOKE INSERT, UPDATE, DELETE ON public.invite_codes, public.invite_campaigns, public.invites FROM anon, authenticated;
GRANT SELECT ON public.invite_codes, public.invite_campaigns, public.invites TO authenticated;
GRANT ALL ON public.invite_codes, public.invite_campaigns, public.invites TO service_role;

-- ── 3. helpers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invite_cfg()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'enabled',     COALESCE((SELECT value FROM platform_config WHERE key = 'referral_enabled'), 'false') = 'true',
    'tiers',       COALESCE((SELECT to_jsonb(string_to_array(regexp_replace(value, '\s', '', 'g'), ',')::bigint[])
                               FROM platform_config WHERE key = 'referral_tiers_kobo'), '[50000,70000,100000]'::jsonb),
    'friend_bonus', COALESCE((SELECT value::bigint FROM platform_config WHERE key = 'referral_friend_bonus_kobo'), 20000),
    'min_spend',    COALESCE((SELECT value::bigint FROM platform_config WHERE key = 'referral_min_spend_kobo'), 200000),
    'window_days',  COALESCE((SELECT value::int FROM platform_config WHERE key = 'referral_window_days'), 7),
    'campaign_days',COALESCE((SELECT value::int FROM platform_config WHERE key = 'referral_campaign_days'), 7)
  );
$$;

-- best display name we have for a user (owner profile, Ajo client record, or signup metadata)
CREATE OR REPLACE FUNCTION public.invite_display_name(p_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    NULLIF(btrim((SELECT full_name FROM profiles WHERE id = p_user)), ''),
    NULLIF(btrim((SELECT full_name FROM aso_clients WHERE client_user_id = p_user AND full_name IS NOT NULL LIMIT 1)), ''),
    NULLIF(btrim((SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = p_user)), ''),
    NULLIF(btrim((SELECT business_name FROM profiles WHERE id = p_user)), ''),
    'Your friend');
$$;

-- "Chinedu Okafor" → "Chinedu O."
CREATE OR REPLACE FUNCTION public.invite_short_name(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_name IS NULL OR btrim(p_name) = '' THEN 'Your friend'
    WHEN position(' ' IN btrim(p_name)) = 0 THEN btrim(p_name)
    ELSE split_part(btrim(p_name), ' ', 1) || ' ' || upper(left(split_part(btrim(p_name), ' ', 2), 1)) || '.'
  END;
$$;

CREATE OR REPLACE FUNCTION public.invite_wallet_open(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM wallets WHERE user_id = p_user AND status = 'active'
                   AND flw_account_number IS NOT NULL AND flw_virtual_account_id IS NOT NULL);
$$;

CREATE OR REPLACE FUNCTION public.invite_bvn_hash(p_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT bvn_hash FROM profiles WHERE id = p_user AND bvn_hash IS NOT NULL),
    (SELECT bvn_hash FROM aso_clients WHERE client_user_id = p_user AND bvn_hash IS NOT NULL ORDER BY bvn_verified_at DESC NULLS LAST LIMIT 1));
$$;

-- money the user moved OUT of their own wallet (completed) between two instants
CREATE OR REPLACE FUNCTION public.invite_spent_kobo(p_user uuid, p_from timestamptz, p_to timestamptz)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(amount_kobo), 0)::bigint FROM wallet_ledger
   WHERE user_id = p_user AND direction = 'debit' AND status = 'completed'
     AND source IN ('withdrawal', 'bill_spend', 'subscription_spend', 'ajo_contribution', 'peer_esusu_contribution')
     AND created_at >= p_from AND created_at <= p_to;
$$;

-- the inviter's live campaign; starts a fresh one when the last has ended
CREATE OR REPLACE FUNCTION public.invite_current_campaign(p_user uuid)
RETURNS public.invite_campaigns LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.invite_campaigns; v_days int := (invite_cfg()->>'campaign_days')::int;
BEGIN
  SELECT * INTO v FROM invite_campaigns WHERE user_id = p_user AND ends_at > now() ORDER BY ends_at DESC LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO invite_campaigns (user_id, started_at, ends_at) VALUES (p_user, now(), now() + make_interval(days => v_days))
    RETURNING * INTO v;
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.invite_code_for(p_user uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text; v_alpha CONSTANT text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
BEGIN
  SELECT code INTO v_code FROM invite_codes WHERE user_id = p_user;
  IF FOUND THEN RETURN v_code; END IF;
  LOOP
    v_code := 'KD';
    FOR i IN 1..6 LOOP v_code := v_code || substr(v_alpha, 1 + floor(random() * 32)::int, 1); END LOOP;
    BEGIN
      INSERT INTO invite_codes (user_id, code) VALUES (p_user, v_code);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      SELECT code INTO v_code FROM invite_codes WHERE user_id = p_user;   -- raced with ourselves
      IF FOUND THEN RETURN v_code; END IF;                               -- else the code collided: try again
    END;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.invite_notify(p_user uuid, p_type text, p_category text, p_title text, p_body text, p_dedupe text, p_high boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
  VALUES (p_user, p_type, p_category, p_title, p_body, jsonb_build_object('tab', 'home', 'openInvite', true),
          CASE WHEN p_high THEN 'high' ELSE 'normal' END, p_dedupe)
  ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'invite_notify skipped: %', SQLERRM;   -- a notification must never block a payout
END $$;

-- ── 4. payout leg: settlement → user, exactly once per p_ref ─────────────────
CREATE OR REPLACE FUNCTION public.invite_pay(p_user uuid, p_amount_kobo bigint, p_ref text, p_narration text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settlement_id CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  v_set  public.wallets;
  v_usr  public.wallets;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM wallet_ledger WHERE source = 'referral_reward' AND flw_reference = p_ref) THEN
    RETURN true;                                                   -- already paid
  END IF;

  SELECT * INTO v_set FROM wallets WHERE user_id = v_settlement_id FOR UPDATE;
  IF NOT FOUND OR v_set.balance_kobo < p_amount_kobo THEN
    RAISE NOTICE 'invite_pay %: settlement wallet cannot cover %', p_ref, p_amount_kobo;
    RETURN false;                                                  -- retried by the cron
  END IF;
  SELECT * INTO v_usr FROM wallets WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND OR v_usr.status <> 'active' THEN RETURN false; END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE wallets SET balance_kobo = balance_kobo - p_amount_kobo WHERE id = v_set.id;
  UPDATE wallets SET balance_kobo = balance_kobo + p_amount_kobo WHERE id = v_usr.id;

  INSERT INTO wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, flw_reference, narration, meta)
  VALUES (v_set.id, v_settlement_id, 'debit', p_amount_kobo, v_set.balance_kobo - p_amount_kobo,
          'referral_reward', 'completed', p_ref || ':fund', 'Invite & Earn reward funding', jsonb_build_object('to_user', p_user));
  INSERT INTO wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, flw_reference, narration, meta)
  VALUES (v_usr.id, p_user, 'credit', p_amount_kobo, v_usr.balance_kobo + p_amount_kobo,
          'referral_reward', 'completed', p_ref, p_narration, jsonb_build_object('kind', 'invite_reward'));
  RETURN true;
END $$;

-- ── 5. claim (called by the friend right after sign-up) ──────────────────────
CREATE OR REPLACE FUNCTION public.invite_claim(p_code text, p_portal text DEFAULT 'owner')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me      uuid := auth.uid();
  v_code    text := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_inviter uuid;
  v_created timestamptz;
  v_camp    public.invite_campaigns;
  v_cfg     jsonb := invite_cfg();
  v_name    text;
  v_id      uuid;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in'); END IF;
  IF NOT (v_cfg->>'enabled')::boolean THEN RETURN jsonb_build_object('ok', false, 'reason', 'disabled'); END IF;
  IF v_code = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;

  SELECT user_id INTO v_inviter FROM invite_codes WHERE code = v_code;
  IF v_inviter IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  IF v_inviter = v_me THEN RETURN jsonb_build_object('ok', false, 'reason', 'own_code'); END IF;
  IF EXISTS (SELECT 1 FROM invites WHERE friend_id = v_me) THEN RETURN jsonb_build_object('ok', false, 'reason', 'already_invited'); END IF;
  IF EXISTS (SELECT 1 FROM invites WHERE inviter_id = v_me AND friend_id = v_inviter) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'mutual');                     -- A invited B, B can't invite A back
  END IF;
  SELECT created_at INTO v_created FROM auth.users WHERE id = v_me;
  IF v_created IS NULL OR v_created < now() - interval '3 days' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_new');
  END IF;

  v_camp := invite_current_campaign(v_inviter);
  INSERT INTO invites (inviter_id, friend_id, campaign_id, code, friend_portal, expires_at)
  VALUES (v_inviter, v_me, v_camp.id, v_code, CASE WHEN p_portal = 'client' THEN 'client' ELSE 'owner' END,
          now() + make_interval(days => (v_cfg->>'window_days')::int))
  ON CONFLICT (friend_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'already_invited'); END IF;

  v_name := invite_short_name(invite_display_name(v_me));
  PERFORM invite_notify(v_inviter, 'invite_joined', 'milestone',
    '🎉 ' || v_name || ' joined with your invite',
    format('When they open their wallet and spend ₦%s within %s days, you earn your reward.',
           to_char((v_cfg->>'min_spend')::bigint / 100, 'FM999,999,999'), v_cfg->>'window_days'),
    'invite_joined_' || v_id, false);
  PERFORM invite_notify(v_me, 'invite_welcome', 'milestone',
    format('Welcome! A ₦%s bonus is waiting for you 🎁', to_char((v_cfg->>'friend_bonus')::bigint / 100, 'FM999,999,999')),
    format('Open your KudiAI wallet and spend ₦%s within %s days to unlock it.',
           to_char((v_cfg->>'min_spend')::bigint / 100, 'FM999,999,999'), v_cfg->>'window_days'),
    'invite_welcome_' || v_id, false);

  RETURN jsonb_build_object('ok', true, 'inviter_name', invite_short_name(invite_display_name(v_inviter)));
END $$;

-- ── 6. the engine: advance every open invite (cron + on dashboard open) ──────
CREATE OR REPLACE FUNCTION public.invite_process(p_user uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r        public.invites;
  v_cfg    jsonb := invite_cfg();
  v_tiers  bigint[];
  v_min    bigint := (v_cfg->>'min_spend')::bigint;
  v_open   boolean;
  v_spent  bigint;
  v_fbvn   text;
  v_n      int;
  v_done   int := 0;
  v_fname  text;
BEGIN
  SELECT array_agg(x::bigint) INTO v_tiers FROM jsonb_array_elements_text(v_cfg->'tiers') AS x;

  FOR r IN
    SELECT * FROM invites
     WHERE status IN ('joined', 'wallet_open', 'qualified')
       AND (p_user IS NULL OR inviter_id = p_user OR friend_id = p_user)
     ORDER BY joined_at
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v_fname := invite_short_name(invite_display_name(r.friend_id));

      IF r.status IN ('joined', 'wallet_open') THEN
        v_open  := invite_wallet_open(r.friend_id);
        v_spent := invite_spent_kobo(r.friend_id, r.joined_at, LEAST(now(), r.expires_at));
        IF v_open AND r.wallet_opened_at IS NULL THEN
          r.wallet_opened_at := now();
          r.status := 'wallet_open';
        END IF;
        r.spent_kobo := v_spent;

        IF v_open AND v_spent >= v_min THEN
          -- fraud guards
          v_fbvn := invite_bvn_hash(r.friend_id);
          IF v_fbvn IS NOT NULL AND v_fbvn = invite_bvn_hash(r.inviter_id) THEN
            r.status := 'rejected'; r.reject_reason := 'same_bvn_as_inviter';
          ELSIF v_fbvn IS NOT NULL AND EXISTS (
                  SELECT 1 FROM invites o WHERE o.id <> r.id AND o.status IN ('qualified', 'rewarded')
                     AND invite_bvn_hash(o.friend_id) = v_fbvn) THEN
            r.status := 'rejected'; r.reject_reason := 'bvn_already_rewarded';
          ELSE
            -- one inviter's tiers are handed out one at a time (cron + dashboard may race)
            PERFORM pg_advisory_xact_lock(hashtextextended('invite_tier:' || r.inviter_id::text, 0));
            SELECT count(*) INTO v_n FROM invites
             WHERE inviter_id = r.inviter_id AND campaign_id IS NOT DISTINCT FROM r.campaign_id
               AND tier IS NOT NULL AND id <> r.id;
            r.status := 'qualified';
            r.qualified_at := now();
            IF v_n < COALESCE(array_length(v_tiers, 1), 0) THEN
              r.tier := v_n + 1;
              r.inviter_reward_kobo := v_tiers[v_n + 1];
            ELSE
              r.tier := NULL; r.inviter_reward_kobo := 0;          -- campaign cap reached
            END IF;
            r.friend_reward_kobo := (v_cfg->>'friend_bonus')::bigint;
          END IF;
        ELSIF now() > r.expires_at THEN
          r.status := 'expired';
          PERFORM invite_notify(r.inviter_id, 'invite_expired', 'milestone',
            v_fname || '''s invite has expired',
            'They didn''t open a wallet and spend in time. Invite someone new — your next reward is waiting.',
            'invite_expired_' || r.id, false);
        END IF;
      END IF;

      -- pay whatever is owed (idempotent; safe to retry)
      IF r.status = 'qualified' THEN
        IF r.friend_paid_at IS NULL THEN
          IF r.friend_reward_kobo <= 0 THEN r.friend_paid_at := now();
          ELSIF invite_pay(r.friend_id, r.friend_reward_kobo, 'invite:' || r.id || ':friend', 'Invite & Earn welcome bonus') THEN
            r.friend_paid_at := now();
            PERFORM invite_notify(r.friend_id, 'invite_bonus_paid', 'money',
              format('₦%s welcome bonus added to your wallet 🎁', to_char(r.friend_reward_kobo / 100, 'FM999,999,999')),
              'Thanks for joining KudiAI Track. Invite your own friends and earn too.',
              'invite_bonus_' || r.id);
          END IF;
        END IF;
        IF r.inviter_paid_at IS NULL THEN
          IF r.inviter_reward_kobo <= 0 THEN r.inviter_paid_at := now();
          ELSIF NOT invite_wallet_open(r.inviter_id) THEN
            PERFORM invite_notify(r.inviter_id, 'invite_reward_waiting', 'money',
              format('₦%s reward is waiting for you', to_char(r.inviter_reward_kobo / 100, 'FM999,999,999')),
              v_fname || ' qualified! Open your KudiAI wallet to receive your reward.',
              'invite_waiting_' || r.id);
          ELSIF invite_pay(r.inviter_id, r.inviter_reward_kobo, 'invite:' || r.id || ':inviter',
                           'Invite & Earn reward — ' || v_fname) THEN
            r.inviter_paid_at := now();
            PERFORM invite_notify(r.inviter_id, 'invite_reward_paid', 'money',
              format('You earned ₦%s 🎉', to_char(r.inviter_reward_kobo / 100, 'FM999,999,999')),
              v_fname || ' qualified — your Invite & Earn reward is in your wallet.',
              'invite_reward_' || r.id);
          END IF;
        END IF;
        IF r.friend_paid_at IS NOT NULL AND r.inviter_paid_at IS NOT NULL THEN
          r.status := 'rewarded';
        END IF;
      END IF;

      UPDATE invites SET status = r.status, wallet_opened_at = r.wallet_opened_at, spent_kobo = r.spent_kobo,
             qualified_at = r.qualified_at, tier = r.tier, inviter_reward_kobo = r.inviter_reward_kobo,
             friend_reward_kobo = r.friend_reward_kobo, inviter_paid_at = r.inviter_paid_at,
             friend_paid_at = r.friend_paid_at, reject_reason = r.reject_reason, updated_at = now()
       WHERE id = r.id;
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'invite_process % failed: %', r.id, SQLERRM;    -- one bad row never blocks the rest
    END;
  END LOOP;
  RETURN v_done;
END $$;

-- ── 7. everything the Invite & Earn screen needs, in one call ────────────────
CREATE OR REPLACE FUNCTION public.invite_dashboard()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me   uuid := auth.uid();
  v_cfg  jsonb := invite_cfg();
  v_camp public.invite_campaigns;
  v_mine jsonb;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  IF NOT (v_cfg->>'enabled')::boolean THEN RETURN jsonb_build_object('enabled', false); END IF;

  PERFORM invite_process(v_me);
  v_camp := invite_current_campaign(v_me);

  SELECT jsonb_build_object(
           'inviter_name', invite_short_name(invite_display_name(i.inviter_id)), 'status', i.status,
           'spent_kobo', i.spent_kobo, 'wallet_open', invite_wallet_open(i.friend_id),
           'expires_at', i.expires_at, 'bonus_kobo', COALESCE(NULLIF(i.friend_reward_kobo, 0), (v_cfg->>'friend_bonus')::bigint),
           'paid', i.friend_paid_at IS NOT NULL)
    INTO v_mine FROM invites i WHERE i.friend_id = v_me;

  RETURN jsonb_build_object(
    'enabled', true,
    'config', v_cfg,
    'code', invite_code_for(v_me),
    'campaign', jsonb_build_object('id', v_camp.id, 'started_at', v_camp.started_at, 'ends_at', v_camp.ends_at),
    'slots', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tier', i.tier, 'amount_kobo', i.inviter_reward_kobo,
                                          'name', invite_short_name(invite_display_name(i.friend_id)),
                                          'paid', i.inviter_paid_at IS NOT NULL) ORDER BY i.tier)
        FROM invites i WHERE i.inviter_id = v_me AND i.campaign_id = v_camp.id AND i.tier IS NOT NULL), '[]'::jsonb),
    'invites', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'joined_at') DESC) FROM (
        SELECT jsonb_build_object('id', i.id, 'name', invite_short_name(invite_display_name(i.friend_id)),
                 'status', i.status, 'joined_at', i.joined_at, 'expires_at', i.expires_at,
                 'wallet_open', i.wallet_opened_at IS NOT NULL OR invite_wallet_open(i.friend_id),
                 'spent_kobo', i.spent_kobo, 'reward_kobo', i.inviter_reward_kobo,
                 'paid', i.inviter_paid_at IS NOT NULL, 'in_campaign', i.campaign_id = v_camp.id) AS x
          FROM invites i WHERE i.inviter_id = v_me ORDER BY i.joined_at DESC LIMIT 50) s), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
                 'invited', count(*),
                 'rewarded', count(*) FILTER (WHERE inviter_paid_at IS NOT NULL AND inviter_reward_kobo > 0),
                 'earned_kobo', COALESCE(sum(inviter_reward_kobo) FILTER (WHERE inviter_paid_at IS NOT NULL), 0),
                 'pending', count(*) FILTER (WHERE status IN ('joined', 'wallet_open', 'qualified')))
                 FROM invites WHERE inviter_id = v_me),
    'wallet_open', invite_wallet_open(v_me),
    'mine', v_mine);
END $$;

-- ── 8. grants ────────────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.invite_cfg()', 'public.invite_display_name(uuid)', 'public.invite_wallet_open(uuid)', 'public.invite_bvn_hash(uuid)',
    'public.invite_spent_kobo(uuid, timestamptz, timestamptz)', 'public.invite_current_campaign(uuid)', 'public.invite_code_for(uuid)',
    'public.invite_notify(uuid, text, text, text, text, text, boolean)', 'public.invite_pay(uuid, bigint, text, text)',
    'public.invite_process(uuid)', 'public.invite_claim(text, text)', 'public.invite_dashboard()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.invite_claim(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_dashboard()       TO authenticated;

-- ── 9. cron: advance + pay every 10 minutes ──────────────────────────────────
DO $$ BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'invite-process';
  PERFORM cron.schedule('invite-process', '*/10 * * * *', 'SELECT public.invite_process(NULL)');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'could not schedule invite-process: %', SQLERRM; END $$;
