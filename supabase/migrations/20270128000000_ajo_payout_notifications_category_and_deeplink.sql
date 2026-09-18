-- ═════════════════════════════════════════════════════════════════════════════
-- Notification redesign — Phase A producer fix: category + deep-link on the
-- Ajo wallet-payout SQL-direct notifications.
--
-- 1. category: these are pure-SQL inserts (pg_cron / reactive trigger), so
--    they never passed through notify-send's persistence — every one of
--    them was landing with category = NULL until now.
--
-- 2. Deep-link: the success-path 'ajo_payout' notification used
--    jsonb_build_object('screen', 'wallet') — confirmed dead on tap: the
--    Ajo client portal's onNavigate (AjoMemberPortal.jsx) only reads
--    `.openWallet` and `.tab`, never `.screen`. The failure/delayed/
--    shortfall notifications already got this right when they were added
--    (openWallet for the client, tab:'aso' for the owner) — this fixes the
--    one that was missed at the time.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ajo_settle_due_wallet_payouts(
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
  -- cron secret for the pg_net → flutterwave payout-email call (best effort;
  -- NULL just means no email gets sent, money still moves normally)
  v_secret         TEXT;
BEGIN
  IF NOT p_skip_business_day_check AND NOT public.ajo_is_business_day(CURRENT_DATE) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';

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

        INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
        VALUES (
          v_row.owner_id, 'ajo_payout_failed', 'money', 'Client payout failed — top up your wallet',
          'A ₦' || to_char(v_row.amount_kobo / 100.0, 'FM999,999,990.00') ||
            ' Ajo/Esusu payout could not be paid — your wallet balance was too low. Top up, then retry it from Aso.',
          jsonb_build_object('tab', 'aso'), 'high',
          format('ajo_payout_failed_%s_%s', v_row.id, v_row.scheduled_date)
        )
        ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;

        INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
        VALUES (
          v_row.client_user_id, 'ajo_payout_delayed', 'savings', 'Payout delayed',
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
      -- to look. deep_link fixed from {screen:'wallet'} (dead — the client
      -- portal's onNavigate never reads .screen) to {openWallet:true}.
      INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority)
      VALUES (
        v_row.client_user_id, 'ajo_payout', 'money', 'Payout received',
        '₦' || to_char(v_row.amount_kobo / 100.0, 'FM999,999,990.00') || ' from your Ajo/Esusu withdrawal landed in your KudiAI wallet',
        jsonb_build_object('openWallet', true), 'high'
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

      -- Payout is already committed as 'paid' above — an email hiccup below
      -- must never be allowed to flip it back to 'failed' via the outer
      -- EXCEPTION handler, so it's isolated in its own sub-block.
      BEGIN
        IF v_secret IS NOT NULL THEN
          PERFORM net.http_post(
            url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/flutterwave',
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
            body    := jsonb_build_object(
              'action', 'send-ajo-payout-email',
              'client_user_id', v_row.client_user_id,
              'amount_kobo', v_row.amount_kobo,
              'balance_after_kobo', v_client_new,
              'payout_id', v_row.id
            )
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'ajo_settle_due_wallet_payouts: payout email dispatch failed for %: %', v_row.id, SQLERRM;
      END;

    EXCEPTION WHEN OTHERS THEN
      UPDATE public.ajo_wallet_payouts
      SET status = 'failed', failure_reason = SQLERRM
      WHERE id = v_row.id;

      INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
      VALUES (
        v_row.owner_id, 'ajo_payout_failed', 'money', 'Client payout failed',
        'A ₦' || to_char(v_row.amount_kobo / 100.0, 'FM999,999,990.00') ||
          ' Ajo/Esusu payout hit an error and did not go through. Check Aso and retry it.',
        jsonb_build_object('tab', 'aso'), 'high',
        format('ajo_payout_failed_%s_%s', v_row.id, v_row.scheduled_date)
      )
      ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;

      INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
      VALUES (
        v_row.client_user_id, 'ajo_payout_delayed', 'savings', 'Payout delayed',
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

-- ── ajo_check_wallet_payout_shortfall: add category ─────────────────────────
CREATE OR REPLACE FUNCTION public.ajo_check_wallet_payout_shortfall()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next_date DATE := public.ajo_next_business_day(CURRENT_DATE);
  v_row       RECORD;
BEGIN
  FOR v_row IN
    SELECT
      p.owner_id,
      SUM(p.amount_kobo)             AS total_due_kobo,
      COUNT(*)                       AS n_due,
      COALESCE(w.balance_kobo, 0)    AS balance_kobo,
      COALESCE(w.status, 'missing')  AS wallet_status
    FROM public.ajo_wallet_payouts p
    LEFT JOIN public.wallets w ON w.user_id = p.owner_id
    WHERE p.status = 'pending' AND p.scheduled_date <= v_next_date
    GROUP BY p.owner_id, w.balance_kobo, w.status
    HAVING COALESCE(w.balance_kobo, 0) < SUM(p.amount_kobo)
        OR COALESCE(w.status, 'missing') <> 'active'
  LOOP
    INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
    VALUES (
      v_row.owner_id, 'ajo_payout_shortfall', 'money', 'Wallet balance too low for upcoming payouts',
      v_row.n_due::text || ' client payout' || CASE WHEN v_row.n_due = 1 THEN '' ELSE 's' END ||
        ' totalling ₦' || to_char(v_row.total_due_kobo / 100.0, 'FM999,999,990.00') || ' ' ||
        (CASE WHEN v_next_date = CURRENT_DATE + 1 THEN 'is due tomorrow' ELSE 'is due by ' || to_char(v_next_date, 'DD Mon') END) ||
        ', but your wallet balance is only ₦' || to_char(v_row.balance_kobo / 100.0, 'FM999,999,990.00') ||
        '. Top up before settlement to avoid a failed payout.',
      jsonb_build_object('tab', 'aso'), 'high',
      format('ajo_payout_shortfall_%s_%s', v_row.owner_id, CURRENT_DATE)
    )
    ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.ajo_check_wallet_payout_shortfall() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_check_wallet_payout_shortfall() TO service_role;
