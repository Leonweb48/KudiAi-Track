-- Owner, 2026-10-12:
--  1. "a client can register without owner approval" — self-registered savings clients are active at once (the edge
--     function now inserts them active); the ones still waiting for approval are activated here.
--  2. "Esusu savings, group savings, and card cycle savings, upon approval by the owner, should move from the business
--     wallet to the client wallet" — the payout used to wait for the next business day (07:30 cron). It now moves the
--     moment the owner approves: same ajo_wallet_payouts row, same settlement, same ledger rows (ajo_payout), but
--     dated today and settled in the approval's own transaction. If the business wallet can't cover it, the approval
--     itself is refused (nothing is booked, the request stays pending) instead of approving and failing later.
--  3. "On client circles, a client who creates the esusu can decide to set a percentage or fixed amount to charge before
--     payout to that particular collector" — peer_esusu_groups.payout_fee_type ('none'|'percent'|'fixed') +
--     payout_fee_value, fixed when the circle is created. At each payout the fee is taken off each collector's share and
--     stays in the creator's wallet (where the pot already sits); the creator's own turn is never charged.

-- ── 1. pending self-registrations → active ───────────────────────────────────────────────────────────────────────
DO $act$
DECLARE n int;
BEGIN
  UPDATE public.aso_clients
     SET status = 'active', next_contribution_date = COALESCE(next_contribution_date, CURRENT_DATE)
   WHERE status = 'pending_approval' AND client_user_id IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'registration | % waiting client(s) activated', n;
END $act$;

-- ── 2. approved withdrawals pay into the client's wallet immediately ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ajo_wallet_payout_now_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bal bigint; v_status text;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  NEW.scheduled_date := CURRENT_DATE;
  SELECT balance_kobo, status INTO v_bal, v_status FROM public.wallets WHERE user_id = NEW.owner_id;
  IF v_bal IS NULL OR v_status <> 'active' THEN
    RAISE EXCEPTION 'Your business wallet isn''t active, so this payout can''t be sent to the client''s wallet. Open or reactivate your wallet, then approve again.';
  END IF;
  IF v_bal < NEW.amount_kobo THEN
    RAISE EXCEPTION 'Your wallet has ₦% but this payout to the client''s wallet is ₦%. Top up your wallet, then approve again.',
      to_char(v_bal / 100.0, 'FM999,999,999,990.00'), to_char(NEW.amount_kobo / 100.0, 'FM999,999,999,990.00');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ajo_wallet_payout_now_check() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ajo_wallet_payout_now_settle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM public.ajo_settle_due_wallet_payouts(NEW.owner_id, true);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ajo_wallet_payout_now_settle() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ajo_wallet_payout_now_check ON public.ajo_wallet_payouts;
CREATE TRIGGER trg_ajo_wallet_payout_now_check BEFORE INSERT ON public.ajo_wallet_payouts
  FOR EACH ROW EXECUTE FUNCTION public.ajo_wallet_payout_now_check();
DROP TRIGGER IF EXISTS trg_ajo_wallet_payout_now_settle ON public.ajo_wallet_payouts;
CREATE TRIGGER trg_ajo_wallet_payout_now_settle AFTER INSERT ON public.ajo_wallet_payouts
  FOR EACH ROW EXECUTE FUNCTION public.ajo_wallet_payout_now_settle();

-- ── 3. circle organiser's payout fee ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.peer_esusu_groups
  ADD COLUMN IF NOT EXISTS payout_fee_type  text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS payout_fee_value numeric(18,2) NOT NULL DEFAULT 0;
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'peer_esusu_groups_payout_fee_check') THEN
    ALTER TABLE public.peer_esusu_groups ADD CONSTRAINT peer_esusu_groups_payout_fee_check CHECK (
      (payout_fee_type = 'none' AND payout_fee_value = 0)
      OR (payout_fee_type = 'percent' AND payout_fee_value > 0 AND payout_fee_value <= 50)
      OR (payout_fee_type = 'fixed' AND payout_fee_value > 0 AND payout_fee_value <= contribution_amount));
  END IF;
END $c$;
ALTER TABLE public.peer_esusu_contributions ADD COLUMN IF NOT EXISTS fee_amount numeric(18,2) NOT NULL DEFAULT 0;

-- Same payout as before (see 20270187), plus the organiser's fee: each collector gets their share minus the fee, the
-- creator's wallet is debited only what is actually paid out (debit == sum of credits still holds), the fee stays there.
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
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ajo_wallet_payout_now_settle') THEN RAISE EXCEPTION 'payout trigger missing'; END IF;
  RAISE NOTICE 'payouts | approved withdrawals now pay into the client wallet at once';
  RAISE NOTICE 'circles | organiser payout fee columns ready';
END $$;
