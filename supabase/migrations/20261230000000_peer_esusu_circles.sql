-- Peer-to-peer Esusu circles: a client can create their own rotating
-- savings group and invite ANY other KudiAI user (by wallet account
-- number, regardless of which business they're a client of, or of none)
-- to join. Deliberately a NEW, parallel subsystem — does not touch
-- aso_clients/ajo_groups/ajo_contributions. Membership is keyed on
-- auth.users.id throughout, sidestepping aso_clients.client_user_id's
-- table-wide UNIQUE constraint (one person can only ever be a client of
-- one business owner system-wide — confirmed by investigation this
-- session — which is why peer-circle membership cannot route through the
-- existing aso_client_group_memberships machinery).
--
-- Money movement reuses the wallets table as-is (confirmed fully generic:
-- wallets.user_id -> auth.users, no dependency on profiles/aso_clients).
-- Both contribution and payout are immediate, atomic wallet-to-wallet RPCs
-- (not the withdrawal-request/cron-settlement path used elsewhere, which
-- models "assume cash was handed over physically" — every peer-circle
-- naira arrives via wallet in the first place, so there's no such gap to
-- model here).

-- ── peer_esusu_groups ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.peer_esusu_groups (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                   TEXT        NOT NULL,
  contribution_amount    NUMERIC(18,2) NOT NULL CHECK (contribution_amount > 0),
  frequency              TEXT        NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('daily','weekly','monthly','custom')),
  custom_interval_days   INT         CHECK (custom_interval_days IS NULL OR custom_interval_days > 0),
  payout_slots_per_round INT         NOT NULL DEFAULT 1 CHECK (payout_slots_per_round >= 1),
  status                 TEXT        NOT NULL DEFAULT 'forming' CHECK (status IN ('forming','active','completed','cancelled')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT peer_esusu_groups_custom_interval CHECK (frequency <> 'custom' OR custom_interval_days IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS peer_esusu_groups_creator_idx ON public.peer_esusu_groups(creator_user_id);

-- ── peer_esusu_members ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.peer_esusu_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID        NOT NULL REFERENCES public.peer_esusu_groups(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position   INT,
  status     TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','left','removed')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS peer_esusu_members_group_idx ON public.peer_esusu_members(group_id);
CREATE INDEX IF NOT EXISTS peer_esusu_members_user_idx  ON public.peer_esusu_members(user_id);

-- ── peer_esusu_invites ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.peer_esusu_invites (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID        NOT NULL REFERENCES public.peer_esusu_groups(id) ON DELETE CASCADE,
  inviter_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invitee_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS peer_esusu_invites_pending_unique
  ON public.peer_esusu_invites(group_id, invitee_user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS peer_esusu_invites_invitee_idx ON public.peer_esusu_invites(invitee_user_id);
CREATE INDEX IF NOT EXISTS peer_esusu_invites_group_idx   ON public.peer_esusu_invites(group_id);

-- ── peer_esusu_rounds ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.peer_esusu_rounds (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID        NOT NULL REFERENCES public.peer_esusu_groups(id) ON DELETE CASCADE,
  round_number  INT         NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  UNIQUE (group_id, round_number)
);
CREATE INDEX IF NOT EXISTS peer_esusu_rounds_group_idx ON public.peer_esusu_rounds(group_id);

-- ── peer_esusu_turns ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.peer_esusu_turns (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id                UUID        NOT NULL REFERENCES public.peer_esusu_rounds(id) ON DELETE CASCADE,
  user_id                 UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position                INT         NOT NULL,
  status                  TEXT        NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','current','paid')),
  expected_payout_date    DATE,
  payout_contribution_id  UUID
);
CREATE INDEX IF NOT EXISTS peer_esusu_turns_round_idx ON public.peer_esusu_turns(round_id);
CREATE INDEX IF NOT EXISTS peer_esusu_turns_user_idx  ON public.peer_esusu_turns(user_id);

-- ── peer_esusu_contributions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.peer_esusu_contributions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID        NOT NULL REFERENCES public.peer_esusu_groups(id) ON DELETE CASCADE,
  round_id    UUID        REFERENCES public.peer_esusu_rounds(id) ON DELETE SET NULL,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount      NUMERIC(18,2) NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('contribution','payout')),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS peer_esusu_contributions_group_idx ON public.peer_esusu_contributions(group_id);
CREATE INDEX IF NOT EXISTS peer_esusu_contributions_round_idx ON public.peer_esusu_contributions(round_id);
CREATE INDEX IF NOT EXISTS peer_esusu_contributions_user_idx  ON public.peer_esusu_contributions(user_id);

ALTER TABLE public.peer_esusu_turns
  ADD CONSTRAINT peer_esusu_turns_payout_contribution_fkey
  FOREIGN KEY (payout_contribution_id) REFERENCES public.peer_esusu_contributions(id) ON DELETE SET NULL;

-- ── search rate-limit log (defense-in-depth against brute-forcing the
--    10-digit account-number space) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.peer_esusu_search_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  searcher_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS peer_esusu_search_log_searcher_idx ON public.peer_esusu_search_log(searcher_id, created_at);

-- ── RLS — SELECT only; all writes go through the peer-esusu edge
--    function's service-role client ─────────────────────────────────────
ALTER TABLE public.peer_esusu_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_esusu_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_esusu_invites       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_esusu_rounds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_esusu_turns         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_esusu_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_esusu_search_log    ENABLE ROW LEVEL SECURITY;

CREATE POLICY peer_esusu_groups_select ON public.peer_esusu_groups
  FOR SELECT TO authenticated USING (
    creator_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.peer_esusu_members m WHERE m.group_id = id AND m.user_id = auth.uid())
  );

CREATE POLICY peer_esusu_members_select ON public.peer_esusu_members
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.peer_esusu_groups g WHERE g.id = group_id AND g.creator_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.peer_esusu_members m2 WHERE m2.group_id = group_id AND m2.user_id = auth.uid())
  );

CREATE POLICY peer_esusu_invites_select ON public.peer_esusu_invites
  FOR SELECT TO authenticated USING (inviter_user_id = auth.uid() OR invitee_user_id = auth.uid());

CREATE POLICY peer_esusu_rounds_select ON public.peer_esusu_rounds
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.peer_esusu_groups g WHERE g.id = group_id AND g.creator_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.peer_esusu_members m WHERE m.group_id = group_id AND m.user_id = auth.uid())
  );

CREATE POLICY peer_esusu_turns_select ON public.peer_esusu_turns
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.peer_esusu_rounds r
      JOIN public.peer_esusu_groups g ON g.id = r.group_id
      WHERE r.id = round_id AND (
        g.creator_user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.peer_esusu_members m WHERE m.group_id = g.id AND m.user_id = auth.uid())
      )
    )
  );

CREATE POLICY peer_esusu_contributions_select ON public.peer_esusu_contributions
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.peer_esusu_groups g WHERE g.id = group_id AND g.creator_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.peer_esusu_members m WHERE m.group_id = group_id AND m.user_id = auth.uid())
  );

CREATE POLICY peer_esusu_search_log_select ON public.peer_esusu_search_log
  FOR SELECT TO authenticated USING (searcher_id = auth.uid());

REVOKE ALL ON public.peer_esusu_groups, public.peer_esusu_members, public.peer_esusu_invites,
  public.peer_esusu_rounds, public.peer_esusu_turns, public.peer_esusu_contributions,
  public.peer_esusu_search_log FROM PUBLIC, anon;
GRANT SELECT ON public.peer_esusu_groups, public.peer_esusu_members, public.peer_esusu_invites,
  public.peer_esusu_rounds, public.peer_esusu_turns, public.peer_esusu_contributions,
  public.peer_esusu_search_log TO authenticated;
GRANT ALL ON public.peer_esusu_groups, public.peer_esusu_members, public.peer_esusu_invites,
  public.peer_esusu_rounds, public.peer_esusu_turns, public.peer_esusu_contributions,
  public.peer_esusu_search_log TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- RPC 1: peer_esusu_pay_contribution — atomic member-wallet -> creator-
-- wallet debit/credit, mirrors wallet_pay_ajo_contribution's proven
-- mechanics (row locks, wallet_ledger pairs, daily-free-transfer fee).
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.peer_esusu_pay_contribution(
  p_group_id     UUID,
  p_amount_kobo  BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_group         public.peer_esusu_groups;
  v_member        public.peer_esusu_members;
  v_round         public.peer_esusu_rounds;
  v_wallet        public.wallets;
  v_creator_wallet public.wallets;
  v_new           BIGINT;
  v_creator_new   BIGINT;
  v_contrib_id    UUID;
  v_amount        NUMERIC;
  v_already_paid  NUMERIC;
  v_wfee          BIGINT;
  v_wfee_new      BIGINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter an amount to contribute');
  END IF;

  SELECT * INTO v_group FROM public.peer_esusu_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Circle not found'); END IF;
  IF v_group.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This circle has not started yet');
  END IF;

  SELECT * INTO v_member FROM public.peer_esusu_members
    WHERE group_id = p_group_id AND user_id = v_uid AND status = 'active';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'You are not a member of this circle'); END IF;

  SELECT * INTO v_round FROM public.peer_esusu_rounds
    WHERE group_id = p_group_id AND status = 'active' ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'No active round for this circle'); END IF;

  v_amount := p_amount_kobo::numeric / 100;

  SELECT COALESCE(SUM(amount), 0) INTO v_already_paid FROM public.peer_esusu_contributions
    WHERE group_id = p_group_id AND round_id = v_round.id AND user_id = v_uid AND type = 'contribution';
  IF v_already_paid >= v_group.contribution_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You have already paid for this round');
  END IF;

  -- ── debit the member's own wallet ──────────────────────────────────────
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Activate your wallet first'); END IF;
  IF v_wallet.status <> 'active' THEN RETURN jsonb_build_object('ok', false, 'error', 'Wallet is not active'); END IF;
  IF v_wallet.balance_kobo < p_amount_kobo THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient wallet balance', 'code', 'insufficient_balance');
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  v_new := v_wallet.balance_kobo - p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  -- ── credit the circle creator's wallet — the collection account every
  --    member pays into by default (the circle's "owner" for settlement). ──
  SELECT * INTO v_creator_wallet FROM public.wallets WHERE user_id = v_group.creator_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id) VALUES (v_group.creator_user_id)
    ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
    RETURNING * INTO v_creator_wallet;
  END IF;
  v_creator_new := v_creator_wallet.balance_kobo + p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_creator_new WHERE id = v_creator_wallet.id;

  INSERT INTO public.peer_esusu_contributions (group_id, round_id, user_id, amount, type, notes)
    VALUES (p_group_id, v_round.id, v_uid, v_amount, 'contribution', 'Paid from KudiAI Wallet')
    RETURNING id INTO v_contrib_id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, reference, narration, related_txn_id
  ) VALUES (
    v_wallet.id, v_uid, 'debit', p_amount_kobo, v_new,
    'peer_esusu_contribution', 'completed', v_contrib_id::text,
    'Circle contribution — ' || v_group.name, v_contrib_id
  );

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, reference, narration, related_txn_id
  ) VALUES (
    v_creator_wallet.id, v_group.creator_user_id, 'credit', p_amount_kobo, v_creator_new,
    'peer_esusu_collection', 'completed', v_contrib_id::text,
    'Circle contribution received — ' || v_group.name, v_contrib_id
  );

  -- ── daily-free-transfer wallet fee — same platform-wide rule as any
  --    other wallet-to-wallet transfer (first 3/day free). ──
  IF public.wallet_daily_transfer_count(v_uid) > 3 THEN
    v_wfee := public.wallet_transfer_fee_kobo(p_amount_kobo);
    IF v_wfee > 0 THEN
      SELECT * INTO v_wallet FROM public.wallets WHERE id = v_wallet.id FOR UPDATE;
      IF v_wallet.balance_kobo >= v_wfee THEN
        v_wfee_new := v_wallet.balance_kobo - v_wfee;
        UPDATE public.wallets SET balance_kobo = v_wfee_new WHERE id = v_wallet.id;
        INSERT INTO public.wallet_ledger (
          wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
          source, status, reference, narration, related_txn_id
        ) VALUES (
          v_wallet.id, v_uid, 'debit', v_wfee, v_wfee_new,
          'wallet_fee', 'completed', v_contrib_id::text,
          'Wallet transfer fee (daily free transfers used)', v_contrib_id
        );
        PERFORM public.wallet_credit_settlement(v_wfee, 'wallet_fee',
          'Wallet fee — circle contribution ' || v_contrib_id::text, v_contrib_id);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'contribution_id', v_contrib_id, 'amount', v_amount, 'new_wallet_balance', v_new
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.peer_esusu_pay_contribution(UUID, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peer_esusu_pay_contribution(UUID, BIGINT) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- RPC 2: peer_esusu_execute_payout — creator-only, hard-blocks on any
-- unpaid member (same solvency-gate design as the business-run system's
-- current ajo_execute_payout), splits the round's pot across
-- payout_slots_per_round winners, atomic creator-wallet -> winner-wallet(s).
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.peer_esusu_execute_payout(
  p_group_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid              UUID := auth.uid();
  v_group            public.peer_esusu_groups;
  v_round            public.peer_esusu_rounds;
  v_member_count     INT;
  v_missing_count    INT;
  v_pot              NUMERIC;
  v_per_winner       NUMERIC;
  v_winner_turn      RECORD;
  v_winners          JSONB := '[]'::jsonb;
  v_winner_wallet    public.wallets;
  v_creator_wallet   public.wallets;
  v_new              BIGINT;
  v_winner_new       BIGINT;
  v_payout_id        UUID;
  v_next_turns_left  INT;
  v_new_round_id     UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_group FROM public.peer_esusu_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Circle not found'); END IF;
  IF v_group.creator_user_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only the circle creator can execute a payout');
  END IF;
  IF v_group.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This circle is not active');
  END IF;

  SELECT * INTO v_round FROM public.peer_esusu_rounds
    WHERE group_id = p_group_id AND status = 'active' ORDER BY round_number DESC LIMIT 1
    FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'No active round for this circle'); END IF;

  -- ── solvency gate — block entirely if anyone active hasn't fully paid ──
  SELECT COUNT(*) INTO v_member_count FROM public.peer_esusu_members
    WHERE group_id = p_group_id AND status = 'active';

  SELECT COUNT(*) INTO v_missing_count FROM public.peer_esusu_members m
    WHERE m.group_id = p_group_id AND m.status = 'active'
      AND COALESCE((
        SELECT SUM(c.amount) FROM public.peer_esusu_contributions c
        WHERE c.group_id = p_group_id AND c.round_id = v_round.id AND c.user_id = m.user_id AND c.type = 'contribution'
      ), 0) < v_group.contribution_amount;

  IF v_missing_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'blocked', true,
      'error', v_missing_count || ' member(s) have not completed their contribution for this round yet.');
  END IF;

  v_pot := v_group.contribution_amount * v_member_count;
  v_per_winner := ROUND(v_pot / v_group.payout_slots_per_round, 2);

  -- ── lock + debit the creator's wallet for the full pot ─────────────────
  SELECT * INTO v_creator_wallet FROM public.wallets WHERE user_id = v_group.creator_user_id FOR UPDATE;
  IF NOT FOUND OR v_creator_wallet.balance_kobo < ROUND(v_pot * 100) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Circle wallet balance is short of the pot — this should not happen if everyone has paid; contact support');
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  v_new := v_creator_wallet.balance_kobo - ROUND(v_pot * 100)::bigint;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_creator_wallet.id;

  -- ── pay each winner (this round's `current` turns, up to payout_slots_per_round) ──
  FOR v_winner_turn IN
    SELECT * FROM public.peer_esusu_turns
    WHERE round_id = v_round.id AND status = 'current'
    ORDER BY position ASC
    LIMIT v_group.payout_slots_per_round
  LOOP
    SELECT * INTO v_winner_wallet FROM public.wallets WHERE user_id = v_winner_turn.user_id FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.wallets (user_id) VALUES (v_winner_turn.user_id)
      ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
      RETURNING * INTO v_winner_wallet;
    END IF;
    v_winner_new := v_winner_wallet.balance_kobo + ROUND(v_per_winner * 100)::bigint;
    UPDATE public.wallets SET balance_kobo = v_winner_new WHERE id = v_winner_wallet.id;

    INSERT INTO public.peer_esusu_contributions (group_id, round_id, user_id, amount, type, notes)
      VALUES (p_group_id, v_round.id, v_winner_turn.user_id, v_per_winner, 'payout', 'Circle payout — ' || v_group.name)
      RETURNING id INTO v_payout_id;

    UPDATE public.peer_esusu_turns SET status = 'paid', payout_contribution_id = v_payout_id
      WHERE id = v_winner_turn.id;

    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
      source, status, reference, narration, related_txn_id
    ) VALUES (
      v_winner_wallet.id, v_winner_turn.user_id, 'credit', ROUND(v_per_winner * 100)::bigint, v_winner_new,
      'peer_esusu_payout', 'completed', v_payout_id::text, 'Circle payout — ' || v_group.name, v_payout_id
    );

    v_winners := v_winners || jsonb_build_object('user_id', v_winner_turn.user_id, 'amount', v_per_winner);
  END LOOP;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, reference, narration, related_txn_id
  ) VALUES (
    v_creator_wallet.id, v_group.creator_user_id, 'debit', ROUND(v_pot * 100)::bigint, v_new,
    'peer_esusu_payout_sweep', 'completed', v_round.id::text, 'Circle pot paid out — ' || v_group.name, v_round.id
  );

  -- ── activate the next batch of turns, or close the round / advance ────
  SELECT COUNT(*) INTO v_next_turns_left FROM public.peer_esusu_turns
    WHERE round_id = v_round.id AND status = 'upcoming';

  IF v_next_turns_left > 0 THEN
    UPDATE public.peer_esusu_turns SET status = 'current'
    WHERE id IN (
      SELECT id FROM public.peer_esusu_turns
      WHERE round_id = v_round.id AND status = 'upcoming'
      ORDER BY position ASC LIMIT v_group.payout_slots_per_round
    );
  ELSE
    UPDATE public.peer_esusu_rounds SET status = 'completed', completed_at = now() WHERE id = v_round.id;

    INSERT INTO public.peer_esusu_rounds (group_id, round_number, status)
      VALUES (p_group_id, v_round.round_number + 1, 'active')
      RETURNING id INTO v_new_round_id;

    INSERT INTO public.peer_esusu_turns (round_id, user_id, position, status)
    SELECT v_new_round_id, m.user_id, m.position,
      CASE WHEN m.position <= v_group.payout_slots_per_round THEN 'current' ELSE 'upcoming' END
    FROM public.peer_esusu_members m
    WHERE m.group_id = p_group_id AND m.status = 'active'
    ORDER BY m.position;
  END IF;

  RETURN jsonb_build_object('ok', true, 'winners', v_winners, 'per_winner_amount', v_per_winner, 'pot_amount', v_pot);
END;
$function$;

REVOKE ALL ON FUNCTION public.peer_esusu_execute_payout(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peer_esusu_execute_payout(UUID) TO authenticated, service_role;
