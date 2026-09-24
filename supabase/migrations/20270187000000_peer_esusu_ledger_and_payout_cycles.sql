-- Client-started (peer) esusu circles: make the money flow actually work, and keep it balanced.
--
-- Intended behaviour (the user's spec): when a CLIENT starts an esusu circle, members' contributions are paid into
-- that client's own wallet (the circle's collection account), and every payout is deducted from that same wallet.
-- The RPCs already tried to do exactly that, but these faults meant it could never have worked with real money:
--
--  1. wallet_ledger.source is CHECK-constrained, and none of the four peer_esusu_* sources the RPCs write were in it
--     (20261231 redefined the constraint the day after the circles migration, without them). Every contribution
--     failed on its ledger insert and rolled back. Nothing has ever been contributed or paid out in production.
--  2. Contributions were fenced once per ROUND but payouts happen once per TURN, so after the first payout in a
--     round nobody could pay again (already paid for this round) while the next payout still took a full pot out
--     of the creator's wallet, i.e. the creator's own money would have funded every winner after the first.
--     A new cycle_no (bumped by every payout) fences contributions per payout instead.
--  3. The payout debited the creator's wallet for the full pot but credited only payout_slots_per_round shares, so a
--     final batch with fewer winners than slots destroyed the difference. The pot is now what was actually collected
--     for that cycle, split across the winners actually being paid, and the debit always equals the credits.
--  Also: a member could over-pay their share through the RPC (the surplus was never returned); now capped.
--
-- Nothing has run in production (one circle exists, still forming, no contributions), so there is no data to migrate.

-- ── 1. ledger sources ─────────────────────────────────────────────────────────────────────────────────────────
-- Extend whatever list is live (read from the constraint itself, so this stays correct if the repo and the database
-- have drifted) rather than re-typing it.
DO $$
DECLARE
  v_def  text;
  v_have text[];
  v_all  text[];
  v_peer text[] := ARRAY['peer_esusu_contribution','peer_esusu_collection','peer_esusu_payout','peer_esusu_payout_sweep'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.wallet_ledger'::regclass AND conname = 'wallet_ledger_source_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'wallet_ledger_source_check not found — refusing to guess its contents'; END IF;

  SELECT COALESCE(array_agg(DISTINCT m[1]), ARRAY[]::text[]) INTO v_have
    FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m;
  IF v_peer <@ v_have THEN RETURN; END IF;

  -- Never rewrite the constraint from a list we could not read properly (that would silently drop every existing
  -- source): the live list has well over 10 entries.
  IF COALESCE(array_length(v_have, 1), 0) < 10 THEN
    RAISE EXCEPTION 'wallet_ledger_source_check parsed to only % sources — refusing to rewrite it. Definition: %', COALESCE(array_length(v_have, 1), 0), v_def;
  END IF;

  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_all FROM unnest(v_have || v_peer) AS s;
  ALTER TABLE public.wallet_ledger DROP CONSTRAINT wallet_ledger_source_check;
  -- IN ('a','b',…) is stored/printed as ANY (ARRAY['a'::text, …]), the same shape as before, so this stays readable
  -- by the next migration that needs to extend it.
  EXECUTE format('ALTER TABLE public.wallet_ledger ADD CONSTRAINT wallet_ledger_source_check CHECK (source IN (%s))',
                 (SELECT string_agg(quote_literal(s), ', ' ORDER BY s) FROM unnest(v_all) AS s));
END $$;

-- ── 2. per-payout collection cycle ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.peer_esusu_groups        ADD COLUMN IF NOT EXISTS cycle_no INT NOT NULL DEFAULT 1;
ALTER TABLE public.peer_esusu_contributions ADD COLUMN IF NOT EXISTS cycle_no INT NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS peer_esusu_contributions_cycle_idx ON public.peer_esusu_contributions (group_id, cycle_no);

-- ── 3. member pays their share: member wallet -> circle creator's wallet ─────────────────────────────────────────
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
  v_uid            UUID := auth.uid();
  v_group          public.peer_esusu_groups;
  v_member         public.peer_esusu_members;
  v_round          public.peer_esusu_rounds;
  v_wallet         public.wallets;
  v_creator_wallet public.wallets;
  v_new            BIGINT;
  v_creator_new    BIGINT;
  v_contrib_id     UUID;
  v_amount         NUMERIC;
  v_already_paid   NUMERIC;
  v_remaining      NUMERIC;
  v_wfee           BIGINT;
  v_wfee_new       BIGINT;
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

  -- What this member has already put in for the CURRENT payout (cycle), and what is still owed.
  SELECT COALESCE(SUM(amount), 0) INTO v_already_paid FROM public.peer_esusu_contributions
    WHERE group_id = p_group_id AND cycle_no = v_group.cycle_no AND user_id = v_uid AND type = 'contribution';
  v_remaining := v_group.contribution_amount - v_already_paid;
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You have already paid your share for this payout');
  END IF;
  IF v_amount > v_remaining THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'That is more than your share — you only owe ₦' || to_char(v_remaining, 'FM999,999,990.00') || ' for this payout');
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

  -- ── credit the circle creator's wallet — the circle's collection account ──
  SELECT * INTO v_creator_wallet FROM public.wallets WHERE user_id = v_group.creator_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id) VALUES (v_group.creator_user_id)
    ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
    RETURNING * INTO v_creator_wallet;
  END IF;
  v_creator_new := v_creator_wallet.balance_kobo + p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_creator_new WHERE id = v_creator_wallet.id;

  INSERT INTO public.peer_esusu_contributions (group_id, round_id, cycle_no, user_id, amount, type, notes)
    VALUES (p_group_id, v_round.id, v_group.cycle_no, v_uid, v_amount, 'contribution', 'Paid from KudiAI Wallet')
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

  -- ── daily-free-transfer wallet fee — same platform-wide rule as any other wallet-to-wallet transfer ──
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

-- ── 4. creator pays out the current turn: creator's wallet -> winner wallet(s) ───────────────────────────────────
-- Blocks unless every active member has paid their share for THIS payout. The pot is exactly what was collected for
-- this cycle; it is split across the winners actually being paid (any odd kobo goes to the last winner), so the
-- amount debited from the creator's wallet always equals the sum credited to winners.
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
  v_missing_count    INT;
  v_pot_kobo         BIGINT;
  v_winner_count     INT;
  v_base_kobo        BIGINT;
  v_rem_kobo         BIGINT;
  v_this_kobo        BIGINT;
  v_idx              INT := 0;
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

  -- ── solvency gate — block entirely if anyone active hasn't paid their share for THIS payout ──
  SELECT COUNT(*) INTO v_missing_count FROM public.peer_esusu_members m
    WHERE m.group_id = p_group_id AND m.status = 'active'
      AND COALESCE((
        SELECT SUM(c.amount) FROM public.peer_esusu_contributions c
        WHERE c.group_id = p_group_id AND c.cycle_no = v_group.cycle_no AND c.user_id = m.user_id AND c.type = 'contribution'
      ), 0) < v_group.contribution_amount;

  IF v_missing_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'blocked', true,
      'error', v_missing_count || ' member(s) have not completed their contribution for this payout yet.');
  END IF;

  -- ── the pot is what was actually collected for this cycle ──
  SELECT COALESCE(ROUND(SUM(amount) * 100), 0)::bigint INTO v_pot_kobo FROM public.peer_esusu_contributions
    WHERE group_id = p_group_id AND cycle_no = v_group.cycle_no AND type = 'contribution';
  IF v_pot_kobo <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Nothing has been collected for this payout yet'); END IF;

  SELECT COUNT(*) INTO v_winner_count FROM (
    SELECT 1 FROM public.peer_esusu_turns
     WHERE round_id = v_round.id AND status = 'current' LIMIT v_group.payout_slots_per_round
  ) w;
  IF v_winner_count = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'No one is due a payout this round'); END IF;

  v_base_kobo := v_pot_kobo / v_winner_count;
  v_rem_kobo  := v_pot_kobo - v_base_kobo * v_winner_count;

  -- ── lock + debit the creator's wallet for exactly the pot ──────────────
  SELECT * INTO v_creator_wallet FROM public.wallets WHERE user_id = v_group.creator_user_id FOR UPDATE;
  IF NOT FOUND OR v_creator_wallet.balance_kobo < v_pot_kobo THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Your wallet no longer holds the full pot — top it up before paying out (the members'' contributions are collected in your wallet)');
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  v_new := v_creator_wallet.balance_kobo - v_pot_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_creator_wallet.id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, reference, narration, related_txn_id
  ) VALUES (
    v_creator_wallet.id, v_group.creator_user_id, 'debit', v_pot_kobo, v_new,
    'peer_esusu_payout_sweep', 'completed', v_round.id::text, 'Circle pot paid out — ' || v_group.name, v_round.id
  );

  -- ── pay each winner (this round's `current` turns, up to payout_slots_per_round) ──
  FOR v_winner_turn IN
    SELECT * FROM public.peer_esusu_turns
    WHERE round_id = v_round.id AND status = 'current'
    ORDER BY position ASC
    LIMIT v_group.payout_slots_per_round
  LOOP
    v_idx := v_idx + 1;
    v_this_kobo := v_base_kobo + CASE WHEN v_idx = v_winner_count THEN v_rem_kobo ELSE 0 END;

    SELECT * INTO v_winner_wallet FROM public.wallets WHERE user_id = v_winner_turn.user_id FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.wallets (user_id) VALUES (v_winner_turn.user_id)
      ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
      RETURNING * INTO v_winner_wallet;
    END IF;
    v_winner_new := v_winner_wallet.balance_kobo + v_this_kobo;
    UPDATE public.wallets SET balance_kobo = v_winner_new WHERE id = v_winner_wallet.id;

    INSERT INTO public.peer_esusu_contributions (group_id, round_id, cycle_no, user_id, amount, type, notes)
      VALUES (p_group_id, v_round.id, v_group.cycle_no, v_winner_turn.user_id, v_this_kobo::numeric / 100, 'payout', 'Circle payout — ' || v_group.name)
      RETURNING id INTO v_payout_id;

    UPDATE public.peer_esusu_turns SET status = 'paid', payout_contribution_id = v_payout_id
      WHERE id = v_winner_turn.id;

    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
      source, status, reference, narration, related_txn_id
    ) VALUES (
      v_winner_wallet.id, v_winner_turn.user_id, 'credit', v_this_kobo, v_winner_new,
      'peer_esusu_payout', 'completed', v_payout_id::text, 'Circle payout — ' || v_group.name, v_payout_id
    );

    v_winners := v_winners || jsonb_build_object('user_id', v_winner_turn.user_id, 'amount', v_this_kobo::numeric / 100);
  END LOOP;

  -- this payout is done: the next one starts a fresh collection cycle
  UPDATE public.peer_esusu_groups SET cycle_no = cycle_no + 1, updated_at = now() WHERE id = p_group_id;

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

    -- next rotation: ranked by the members' order (rank, not the raw position value, so a gap can never leave a
    -- round with nobody due)
    INSERT INTO public.peer_esusu_turns (round_id, user_id, position, status)
    SELECT v_new_round_id, r.user_id, r.rn,
           CASE WHEN r.rn <= v_group.payout_slots_per_round THEN 'current' ELSE 'upcoming' END
      FROM (
        SELECT m.user_id, ROW_NUMBER() OVER (ORDER BY m.position, m.joined_at)::int AS rn
          FROM public.peer_esusu_members m
         WHERE m.group_id = p_group_id AND m.status = 'active'
      ) r
     ORDER BY r.rn;
  END IF;

  RETURN jsonb_build_object('ok', true, 'winners', v_winners,
    'per_winner_amount', v_base_kobo::numeric / 100, 'pot_amount', v_pot_kobo::numeric / 100);
END;
$function$;

REVOKE ALL ON FUNCTION public.peer_esusu_execute_payout(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peer_esusu_execute_payout(UUID) TO authenticated, service_role;
