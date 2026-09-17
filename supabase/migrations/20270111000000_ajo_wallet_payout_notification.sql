-- ═════════════════════════════════════════════════════════════════════════════
-- ajo_settle_due_wallet_payouts credits a client's KudiAI wallet (and debits
-- the owner's) every business day for approved Ajo/Esusu withdrawals, but is
-- pure SQL run from pg_cron — it never had any notification call at all,
-- unlike every other wallet-crediting path in the app (flutterwave-webhook
-- calls notify-send for external deposits/sales). The wallet_ledger INSERT
-- itself is realtime-visible (wallets/wallet_ledger were added to the
-- supabase_realtime publication in 20270108000000), so the balance figure
-- does update live once the client has the wallet screen open — but there is
-- no bell notification telling them money just landed, since nothing ever
-- wrote a row to `notifications` for this event. Other SQL functions in this
-- codebase already insert into `notifications` directly (no HTTP call
-- needed) — e.g. staff/ticket/marketer notifications — so this follows that
-- same established pattern rather than trying to call the notify-send edge
-- function from SQL.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ajo_settle_due_wallet_payouts()
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
  IF NOT public.ajo_is_business_day(CURRENT_DATE) THEN
    RETURN;
  END IF;

  FOR v_row IN
    SELECT * FROM public.ajo_wallet_payouts
    WHERE status = 'pending' AND scheduled_date <= CURRENT_DATE
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT * INTO v_owner_wallet FROM public.wallets WHERE user_id = v_row.owner_id FOR UPDATE;
      IF NOT FOUND OR v_owner_wallet.status <> 'active' OR v_owner_wallet.balance_kobo < v_row.amount_kobo THEN
        UPDATE public.ajo_wallet_payouts
        SET status = 'failed', failure_reason = 'Owner wallet balance insufficient at settlement time'
        WHERE id = v_row.id;
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
    END;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.ajo_settle_due_wallet_payouts() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_settle_due_wallet_payouts() TO service_role;
