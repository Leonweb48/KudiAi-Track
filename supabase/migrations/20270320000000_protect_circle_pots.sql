-- Esusu circle pots are protected (2026-10-13, owner: "do all of it"). Members' contributions for the current round sit
-- in the circle creator's own wallet until payout; nothing stopped the creator spending them (open risk since 232ff07).
-- Now every wallet DEBIT (transfer hold, bills, Ajo payments, anything) is refused if it would leave the creator with less
-- than the pot of their active circles. Only the circle payout itself is let through (kudi.circle_payout). Transfer
-- charges that would dip into a pot are skipped instead (they run after Flutterwave accepted the transfer).

CREATE INDEX IF NOT EXISTS peer_esusu_groups_creator_active_idx ON public.peer_esusu_groups (creator_user_id) WHERE status = 'active';

-- What a user's active circles hold right now: this round's contributions (a payout empties the round and moves cycle_no on)
CREATE OR REPLACE FUNCTION public.peer_circle_pot_held_kobo(p_user_id uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(ROUND(c.amount * 100)), 0)::bigint
    FROM public.peer_esusu_groups g
    JOIN public.peer_esusu_contributions c ON c.group_id = g.id AND c.cycle_no = g.cycle_no AND c.type = 'contribution'
   WHERE g.creator_user_id = p_user_id AND g.status = 'active'
$$;
REVOKE ALL ON FUNCTION public.peer_circle_pot_held_kobo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.peer_circle_pot_held_kobo(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_circle_pot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_held bigint;
BEGIN
  IF NEW.balance_kobo >= OLD.balance_kobo OR COALESCE(current_setting('kudi.circle_payout', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  v_held := public.peer_circle_pot_held_kobo(NEW.user_id);
  IF v_held > 0 AND NEW.balance_kobo < v_held THEN
    RAISE EXCEPTION '₦% of your balance is your circle members'' pot. Pay out the circle first, or keep that much in your wallet.',
      to_char(v_held / 100.0, 'FM999,999,999,990.00') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_circle_pot() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_circle_pot ON public.wallets;
CREATE TRIGGER trg_guard_circle_pot BEFORE UPDATE OF balance_kobo ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.guard_circle_pot();

-- Transfer charges skip rather than dip into a pot (same function as 20270307 plus that one line)
CREATE OR REPLACE FUNCTION public.wallet_take_transfer_charge(p_wd public.wallet_withdrawals, p_amount bigint, p_source text, p_label text, p_meta jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wallet public.wallets; v_new bigint;
BEGIN
  IF COALESCE(p_amount, 0) <= 0 THEN RETURN; END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wd.wallet_id FOR UPDATE;
  IF NOT FOUND OR v_wallet.balance_kobo < p_amount THEN RETURN; END IF;
  -- never dip into a circle pot for a charge: skip it (the transfer itself already went through)
  IF v_wallet.balance_kobo - p_amount < public.peer_circle_pot_held_kobo(v_wallet.user_id) THEN RETURN; END IF;
  v_new := v_wallet.balance_kobo - p_amount;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;
  INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, reference, narration, related_txn_id, meta)
  VALUES (v_wallet.id, p_wd.user_id, 'debit', p_amount, v_new, p_source, 'completed', p_wd.id::text, p_label, p_wd.id, COALESCE(p_meta, '{}'::jsonb));
  PERFORM public.wallet_credit_settlement(p_amount, p_source, p_label || ' — withdrawal ' || p_wd.id::text, p_wd.id);
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_take_transfer_charge(public.wallet_withdrawals, bigint, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_take_transfer_charge(public.wallet_withdrawals, bigint, text, text, jsonb) TO service_role;

-- The circle payout (same as 20270308) marks itself so the guard lets its sweep through
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
  v_fee_kobo         BIGINT;
  v_fees_total       BIGINT := 0;
  v_paid_total       BIGINT := 0;
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

  -- the pot must still be in the creator's wallet (the fee part simply stays there)
  SELECT * INTO v_creator_wallet FROM public.wallets WHERE user_id = v_group.creator_user_id FOR UPDATE;
  IF NOT FOUND OR v_creator_wallet.balance_kobo < v_pot_kobo THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Your wallet no longer holds the full pot — top it up before paying out (the members'' contributions are collected in your wallet)');
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  PERFORM set_config('kudi.circle_payout', '1', true);   -- the pot guard lets the circle's own payout through

  -- ── pay each winner (this round's `current` turns, up to payout_slots_per_round) ──
  FOR v_winner_turn IN
    SELECT * FROM public.peer_esusu_turns
    WHERE round_id = v_round.id AND status = 'current'
    ORDER BY position ASC
    LIMIT v_group.payout_slots_per_round
  LOOP
    v_idx := v_idx + 1;
    v_this_kobo := v_base_kobo + CASE WHEN v_idx = v_winner_count THEN v_rem_kobo ELSE 0 END;

    -- the organiser's fee on this collector's share (never on the organiser's own turn, never more than the share)
    v_fee_kobo := CASE
      WHEN v_winner_turn.user_id = v_group.creator_user_id THEN 0
      WHEN v_group.payout_fee_type = 'percent' THEN ROUND(v_this_kobo * v_group.payout_fee_value / 100)::bigint
      WHEN v_group.payout_fee_type = 'fixed'   THEN ROUND(v_group.payout_fee_value * 100)::bigint
      ELSE 0 END;
    v_fee_kobo  := LEAST(GREATEST(v_fee_kobo, 0), v_this_kobo);
    v_this_kobo := v_this_kobo - v_fee_kobo;
    v_fees_total := v_fees_total + v_fee_kobo;
    v_paid_total := v_paid_total + v_this_kobo;

    INSERT INTO public.peer_esusu_contributions (group_id, round_id, cycle_no, user_id, amount, fee_amount, type, notes)
      VALUES (p_group_id, v_round.id, v_group.cycle_no, v_winner_turn.user_id, v_this_kobo::numeric / 100, v_fee_kobo::numeric / 100, 'payout',
              'Circle payout — ' || v_group.name || CASE WHEN v_fee_kobo > 0 THEN ' (organiser fee ₦' || to_char(v_fee_kobo / 100.0, 'FM999,999,990.00') || ')' ELSE '' END)
      RETURNING id INTO v_payout_id;

    UPDATE public.peer_esusu_turns SET status = 'paid', payout_contribution_id = v_payout_id
      WHERE id = v_winner_turn.id;

    IF v_this_kobo > 0 THEN
      SELECT * INTO v_winner_wallet FROM public.wallets WHERE user_id = v_winner_turn.user_id FOR UPDATE;
      IF NOT FOUND THEN
        INSERT INTO public.wallets (user_id) VALUES (v_winner_turn.user_id)
        ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
        RETURNING * INTO v_winner_wallet;
      END IF;
      v_winner_new := v_winner_wallet.balance_kobo + v_this_kobo;
      UPDATE public.wallets SET balance_kobo = v_winner_new WHERE id = v_winner_wallet.id;

      INSERT INTO public.wallet_ledger (
        wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
        source, status, reference, narration, related_txn_id, meta
      ) VALUES (
        v_winner_wallet.id, v_winner_turn.user_id, 'credit', v_this_kobo, v_winner_new,
        'peer_esusu_payout', 'completed', v_payout_id::text,
        'Circle payout — ' || v_group.name || CASE WHEN v_fee_kobo > 0 THEN ' (after ₦' || to_char(v_fee_kobo / 100.0, 'FM999,999,990.00') || ' organiser fee)' ELSE '' END,
        v_payout_id, jsonb_build_object('gross_kobo', v_this_kobo + v_fee_kobo, 'organiser_fee_kobo', v_fee_kobo)
      );
    END IF;

    v_winners := v_winners || jsonb_build_object('user_id', v_winner_turn.user_id, 'amount', v_this_kobo::numeric / 100,
                                                 'fee', v_fee_kobo::numeric / 100);
  END LOOP;

  -- ── the creator's wallet gives exactly what was paid out; the fees stay in it ──
  IF v_paid_total > 0 THEN
    SELECT * INTO v_creator_wallet FROM public.wallets WHERE user_id = v_group.creator_user_id FOR UPDATE;
    IF v_creator_wallet.balance_kobo < v_paid_total THEN
      RAISE EXCEPTION 'Circle payout: creator wallet short at sweep';
    END IF;
    v_new := v_creator_wallet.balance_kobo - v_paid_total;
    UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_creator_wallet.id;
    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
      source, status, reference, narration, related_txn_id, meta
    ) VALUES (
      v_creator_wallet.id, v_group.creator_user_id, 'debit', v_paid_total, v_new,
      'peer_esusu_payout_sweep', 'completed', v_round.id::text,
      'Circle pot paid out — ' || v_group.name || CASE WHEN v_fees_total > 0 THEN ' (you keep ₦' || to_char(v_fees_total / 100.0, 'FM999,999,990.00') || ' organiser fee)' ELSE '' END,
      v_round.id, jsonb_build_object('pot_kobo', v_pot_kobo, 'organiser_fee_kobo', v_fees_total)
    );
  END IF;

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
    'per_winner_amount', (v_paid_total / v_winner_count)::numeric / 100,
    'pot_amount', v_pot_kobo::numeric / 100, 'organiser_fee', v_fees_total::numeric / 100);
END;
$function$;

REVOKE ALL ON FUNCTION public.peer_esusu_execute_payout(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peer_esusu_execute_payout(UUID) TO authenticated, service_role;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.peer_esusu_groups WHERE status = 'active';
  RAISE NOTICE 'circle pots | guard on; active circles now: %', n;
END $$;
