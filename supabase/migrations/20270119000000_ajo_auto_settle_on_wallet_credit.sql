-- ═════════════════════════════════════════════════════════════════════════════
-- Auto-settle Ajo/Esusu payouts the moment money lands in the owner's wallet,
-- instead of making a client wait for the next 7:30am UTC cron run.
--
-- ajo_settle_due_wallet_payouts() gains two optional, defaulted parameters:
--   p_owner_id                — when set, only that owner's due rows are
--                                processed (NULL = every owner, the cron's
--                                existing whole-platform sweep — unchanged).
--   p_skip_business_day_check — the scheduled cron run stays weekday-gated
--                                (ajo_is_business_day), but this is now a
--                                purely internal wallet-to-wallet ledger move
--                                with no external bank leg, so a reactive
--                                settle triggered by money actually arriving
--                                has no reason to make a client wait until
--                                Monday. Cron keeps calling the function with
--                                no arguments, so its behaviour is identical.
--
-- Note: CREATE OR REPLACE cannot widen a function's parameter list without
-- creating an ambiguous overload (the old zero-arg form would still resolve
-- for `ajo_settle_due_wallet_payouts()` calls alongside the new all-defaulted
-- one) — so the old signature is dropped explicitly first.
--
-- A new AFTER INSERT trigger on wallet_ledger (every credit path in this app
-- already funnels through this one guarded table per 20261205000000's
-- trg_guard_wallet_ledger_writes, so this catches topups, sale settlement,
-- subscriptions, admin credits, everything, without touching each call site)
-- reacts to a credit landing in an owner's wallet:
--   1. resets any of that owner's payouts that were only 'failed' because the
--      balance was short (failure_reason = 'Owner wallet balance insufficient
--      at settlement time') back to 'pending', scheduled_date = today — the
--      exact same reset the manual Retry button already performs
--      (ajo-write's retry_wallet_payout action), just automatic and
--      immediate instead of "next business day".
--   2. calls ajo_settle_due_wallet_payouts(owner, skip_business_day_check :=
--      true) scoped to that one owner.
-- A genuine error failure (SQLERRM, not a balance shortfall) is left alone —
-- that needs a human look, not a blind auto-retry.
--
-- Recursion is bounded and safe: the function's own client-credit ledger
-- insert re-fires this same trigger for the client, which is a no-op unless
-- that client is *also* an owner with their own due payouts — in which case
-- cascading them further is the correct, desired behaviour, and each hop
-- strictly reduces the pending set it's acting on.
-- ═════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.ajo_settle_due_wallet_payouts();

CREATE FUNCTION public.ajo_settle_due_wallet_payouts(
  p_owner_id                 uuid    DEFAULT NULL,
  p_skip_business_day_check  boolean DEFAULT false
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row            RECORD;
  v_owner_wallet   public.wallets;
  v_client_wallet  public.wallets;
  v_owner_new      BIGINT;
  v_client_new     BIGINT;
  v_owner_ledger   UUID;
  v_client_ledger  UUID;
  -- daily-free-transfer fee
  v_wfee           BIGINT;
  v_wfee_new       BIGINT;
BEGIN
  IF NOT p_skip_business_day_check AND NOT public.ajo_is_business_day(CURRENT_DATE) THEN
    RETURN;
  END IF;

  FOR v_row IN
    SELECT * FROM public.ajo_wallet_payouts
    WHERE status = 'pending' AND scheduled_date <= CURRENT_DATE
      AND (p_owner_id IS NULL OR owner_id = p_owner_id)
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT * INTO v_owner_wallet FROM public.wallets WHERE user_id = v_row.owner_id FOR UPDATE;
      IF NOT FOUND OR v_owner_wallet.status <> 'active' OR v_owner_wallet.balance_kobo < v_row.amount_kobo THEN
        UPDATE public.ajo_wallet_payouts
        SET status = 'failed', failure_reason = 'Owner wallet balance insufficient at settlement time'
        WHERE id = v_row.id;

        INSERT INTO public.notifications (user_id, type, title, body, deep_link, priority, dedupe_key)
        VALUES (
          v_row.owner_id, 'ajo_payout_failed', 'Client payout failed — top up your wallet',
          'A ₦' || to_char(v_row.amount_kobo / 100.0, 'FM999,999,990.00') ||
            ' Ajo/Esusu payout could not be paid — your wallet balance was too low. Top up, then retry it from Aso.',
          jsonb_build_object('tab', 'aso'), 'high',
          format('ajo_payout_failed_%s_%s', v_row.id, v_row.scheduled_date)
        )
        ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;

        INSERT INTO public.notifications (user_id, type, title, body, deep_link, priority, dedupe_key)
        VALUES (
          v_row.client_user_id, 'ajo_payout_delayed', 'Payout delayed',
          'Your Ajo/Esusu withdrawal payout is taking a little longer than expected — it will land in your wallet as soon as it settles.',
          jsonb_build_object('openWallet', true), 'normal',
          format('ajo_payout_delayed_%s_%s', v_row.id, v_row.scheduled_date)
        )
        ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;

        CONTINUE;
      END IF;

      SELECT * INTO v_client_wallet FROM public.wallets WHERE user_id = v_row.client_user_id FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM set_config('kudi.allow_wallet_write', '1', true);
        INSERT INTO public.wallets (user_id) VALUES (v_row.client_user_id)
        ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
        RETURNING * INTO v_client_wallet;
      END IF;

      PERFORM set_config('kudi.allow_wallet_write', '1', true);
      v_owner_new  := v_owner_wallet.balance_kobo  - v_row.amount_kobo;
      v_client_new := v_client_wallet.balance_kobo + v_row.amount_kobo;

      UPDATE public.wallets SET balance_kobo = v_owner_new  WHERE id = v_owner_wallet.id;
      UPDATE public.wallets SET balance_kobo = v_client_new WHERE id = v_client_wallet.id;

      INSERT INTO public.wallet_ledger (
        wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
        source, status, reference, narration, related_txn_id
      ) VALUES (
        v_owner_wallet.id, v_row.owner_id, 'debit', v_row.amount_kobo, v_owner_new,
        'ajo_payout', 'completed', v_row.id::text, 'Ajo withdrawal payout', v_row.withdrawal_id
      ) RETURNING id INTO v_owner_ledger;

      INSERT INTO public.wallet_ledger (
        wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
        source, status, reference, narration, related_txn_id
      ) VALUES (
        v_client_wallet.id, v_row.client_user_id, 'credit', v_row.amount_kobo, v_client_new,
        'ajo_payout', 'completed', v_row.id::text, 'Ajo withdrawal payout', v_row.withdrawal_id
      ) RETURNING id INTO v_client_ledger;

      -- Tell the client their payout has landed — the wallet balance itself
      -- already updates live via realtime, but nothing previously told them
      -- to look.
      INSERT INTO public.notifications (user_id, type, title, body, deep_link, priority)
      VALUES (
        v_row.client_user_id, 'ajo_payout', 'Payout received',
        '₦' || to_char(v_row.amount_kobo / 100.0, 'FM999,999,990.00') || ' from your Ajo/Esusu withdrawal landed in your KudiAI wallet',
        jsonb_build_object('screen', 'wallet'), 'high'
      );

      -- ── daily-free-transfer wallet fee, charged to the OWNER (whose wallet
      --    funds the payout) — same shared quota, same best-effort. ──
      IF public.wallet_daily_transfer_count(v_row.owner_id) > 3 THEN
        v_wfee := public.wallet_transfer_fee_kobo(v_row.amount_kobo);
        IF v_wfee > 0 THEN
          SELECT * INTO v_owner_wallet FROM public.wallets WHERE id = v_owner_wallet.id FOR UPDATE;
          IF v_owner_wallet.balance_kobo >= v_wfee THEN
            v_wfee_new := v_owner_wallet.balance_kobo - v_wfee;
            UPDATE public.wallets SET balance_kobo = v_wfee_new WHERE id = v_owner_wallet.id;
            INSERT INTO public.wallet_ledger (
              wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
              source, status, reference, narration, related_txn_id
            ) VALUES (
              v_owner_wallet.id, v_row.owner_id, 'debit', v_wfee, v_wfee_new,
              'wallet_fee', 'completed', v_row.id::text,
              'Wallet transfer fee (daily free transfers used)', v_row.withdrawal_id
            );
            PERFORM public.wallet_credit_settlement(v_wfee, 'wallet_fee',
              'Wallet fee — payout ' || v_row.id::text, v_row.withdrawal_id);
          END IF;
        END IF;
      END IF;

      UPDATE public.ajo_wallet_payouts
      SET status = 'paid', paid_at = now(), owner_ledger_id = v_owner_ledger, client_ledger_id = v_client_ledger
      WHERE id = v_row.id;

    EXCEPTION WHEN OTHERS THEN
      UPDATE public.ajo_wallet_payouts
      SET status = 'failed', failure_reason = SQLERRM
      WHERE id = v_row.id;

      INSERT INTO public.notifications (user_id, type, title, body, deep_link, priority, dedupe_key)
      VALUES (
        v_row.owner_id, 'ajo_payout_failed', 'Client payout failed',
        'A ₦' || to_char(v_row.amount_kobo / 100.0, 'FM999,999,990.00') ||
          ' Ajo/Esusu payout hit an error and did not go through. Check Aso and retry it.',
        jsonb_build_object('tab', 'aso'), 'high',
        format('ajo_payout_failed_%s_%s', v_row.id, v_row.scheduled_date)
      )
      ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;

      INSERT INTO public.notifications (user_id, type, title, body, deep_link, priority, dedupe_key)
      VALUES (
        v_row.client_user_id, 'ajo_payout_delayed', 'Payout delayed',
        'Your Ajo/Esusu withdrawal payout is taking a little longer than expected — it will land in your wallet as soon as it settles.',
        jsonb_build_object('openWallet', true), 'normal',
        format('ajo_payout_delayed_%s_%s', v_row.id, v_row.scheduled_date)
      )
      ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;
    END;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.ajo_settle_due_wallet_payouts(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_settle_due_wallet_payouts(uuid, boolean) TO service_role;

-- ── Reactive trigger: fires whenever a credit lands in any wallet ──────────
CREATE OR REPLACE FUNCTION public.ajo_settle_payouts_on_wallet_credit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.direction <> 'credit' THEN
    RETURN NEW;
  END IF;

  UPDATE public.ajo_wallet_payouts
  SET status = 'pending', scheduled_date = CURRENT_DATE, failure_reason = NULL
  WHERE owner_id = NEW.user_id
    AND status = 'failed'
    AND failure_reason = 'Owner wallet balance insufficient at settlement time';

  IF EXISTS (
    SELECT 1 FROM public.ajo_wallet_payouts
    WHERE owner_id = NEW.user_id AND status = 'pending' AND scheduled_date <= CURRENT_DATE
  ) THEN
    PERFORM public.ajo_settle_due_wallet_payouts(NEW.user_id, true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ajo_settle_payouts_on_credit ON public.wallet_ledger;
CREATE TRIGGER trg_ajo_settle_payouts_on_credit
  AFTER INSERT ON public.wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.ajo_settle_payouts_on_wallet_credit();
