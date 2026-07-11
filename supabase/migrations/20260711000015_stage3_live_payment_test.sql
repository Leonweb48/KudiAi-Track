-- Stage 3 live payment test: simulate webhook processing of the real pending
-- contribution created by initialize-payment for Victor John.
-- Reference: AJO-1783794024235-21G19G  client: d79a9873-e798-4685-a001-728e948c44ce
--
-- This is the exact code path the paystack-webhook edge function takes:
--   1. paystack_webhook_log INSERT (unique constraint dedup layer)
--   2. ajo_confirm_payment(reference, paid_at, channel)  [atomic RPC]
--
-- Tests:
--   T1: RPC call returns ok=true
--   T2: Victor John's balance increased by exactly ₦100
--   T3: total_saved increased by exactly ₦100
--   T4: next_contribution_date advanced 1 day
--   T5: contribution status = completed
--   T6: webhook_log INSERT for same reference is silently swallowed (ON CONFLICT DO NOTHING)
--   T7: replay RPC call returns ok=false
--   T8: balance unchanged after replay

DO $$
DECLARE
  v_ref           TEXT    := 'AJO-1783794024235-21G19G';
  v_client_id     UUID    := 'd79a9873-e798-4685-a001-728e948c44ce';
  v_pre_balance   NUMERIC;
  v_pre_total     NUMERIC;
  v_pre_next      DATE;
  v_result        JSONB;
  v_result2       JSONB;
  v_post_balance  NUMERIC;
  v_post_total    NUMERIC;
  v_post_next     DATE;
  v_post_status   TEXT;
  v_dup_count     INT;
  v_contrib_id    UUID;
  v_pass          INT := 0;
  v_fail          INT := 0;
BEGIN

  -- Confirm the pending contribution actually exists
  SELECT id INTO v_contrib_id
    FROM ajo_contributions
    WHERE paystack_ref = v_ref AND status = 'pending'
    LIMIT 1;

  IF v_contrib_id IS NULL THEN
    RAISE WARNING 'SETUP: no pending contribution found for ref % — cannot run live test', v_ref;
    RETURN;
  END IF;

  -- Record pre-call state
  SELECT current_balance, total_saved, next_contribution_date
    INTO v_pre_balance, v_pre_total, v_pre_next
    FROM aso_clients WHERE id = v_client_id;

  RAISE WARNING '── Stage 3 LIVE: Victor John payment simulation ─────────────────────────';
  RAISE WARNING '  ref: %', v_ref;
  RAISE WARNING '  contrib_id: %', v_contrib_id;
  RAISE WARNING '  pre_balance: %  pre_total_saved: %  pre_next_date: %',
    v_pre_balance, v_pre_total, v_pre_next;

  -- ── Simulate webhook dedup layer (first delivery) ─────────────────────────
  INSERT INTO paystack_webhook_log (event, reference, payload)
    VALUES ('charge.success', v_ref, jsonb_build_object(
      'event',  'charge.success',
      'data',   jsonb_build_object('reference', v_ref, 'amount', 10000, 'channel', 'card'),
      'source', 'live_test_migration'
    ))
    ON CONFLICT (reference) DO NOTHING;

  -- ── T1: Call ajo_confirm_payment (webhook's actual call) ──────────────────
  SELECT rpc INTO v_result
    FROM ajo_confirm_payment(v_ref, NOW(), 'card') AS rpc;

  IF (v_result->>'ok')::boolean THEN
    RAISE WARNING '  PASS  T1: ajo_confirm_payment returns ok=true';
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T1: expected ok=true, got: %', v_result;
    v_fail := v_fail + 1;
  END IF;

  -- Read updated state
  SELECT current_balance, total_saved, next_contribution_date
    INTO v_post_balance, v_post_total, v_post_next
    FROM aso_clients WHERE id = v_client_id;

  SELECT status INTO v_post_status FROM ajo_contributions WHERE id = v_contrib_id;

  -- ── T2: Balance increased by ₦100 ─────────────────────────────────────────
  IF v_post_balance = v_pre_balance + 100 THEN
    RAISE WARNING '  PASS  T2: balance % = pre(%) + 100', v_post_balance, v_pre_balance;
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T2: balance % ≠ expected %', v_post_balance, v_pre_balance + 100;
    v_fail := v_fail + 1;
  END IF;

  -- ── T3: total_saved increased by ₦100 ────────────────────────────────────
  IF v_post_total = v_pre_total + 100 THEN
    RAISE WARNING '  PASS  T3: total_saved % = pre(%) + 100', v_post_total, v_pre_total;
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T3: total_saved % ≠ expected %', v_post_total, v_pre_total + 100;
    v_fail := v_fail + 1;
  END IF;

  -- ── T4: next_contribution_date advanced ───────────────────────────────────
  IF v_post_next > v_pre_next THEN
    RAISE WARNING '  PASS  T4: next_date advanced: % → %', v_pre_next, v_post_next;
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T4: next_date unchanged: %', v_post_next;
    v_fail := v_fail + 1;
  END IF;

  -- ── T5: Contribution status = completed ───────────────────────────────────
  IF v_post_status = 'completed' THEN
    RAISE WARNING '  PASS  T5: contribution status = completed';
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T5: status = % (expected completed)', v_post_status;
    v_fail := v_fail + 1;
  END IF;

  -- ── T6: Webhook replay dedup (second delivery silently no-ops) ────────────
  INSERT INTO paystack_webhook_log (event, reference, payload)
    VALUES ('charge.success', v_ref, jsonb_build_object('replay', true))
    ON CONFLICT (reference) DO NOTHING;

  SELECT COUNT(*)::INT INTO v_dup_count
    FROM paystack_webhook_log WHERE reference = v_ref;

  IF v_dup_count = 1 THEN
    RAISE WARNING '  PASS  T6: webhook_log has exactly 1 row — replay INSERT ignored';
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T6: webhook_log has % rows (expected 1)', v_dup_count;
    v_fail := v_fail + 1;
  END IF;

  -- ── T7: Replay RPC returns ok=false ──────────────────────────────────────
  SELECT rpc INTO v_result2
    FROM ajo_confirm_payment(v_ref, NOW(), 'card') AS rpc;

  IF NOT (v_result2->>'ok')::boolean THEN
    RAISE WARNING '  PASS  T7: replay returns ok=false — no double-credit';
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T7: replay returned ok=true — DOUBLE-CREDIT! result: %', v_result2;
    v_fail := v_fail + 1;
  END IF;

  -- ── T8: Balance unchanged after replay ────────────────────────────────────
  SELECT current_balance INTO v_post_balance FROM aso_clients WHERE id = v_client_id;

  IF v_post_balance = v_pre_balance + 100 THEN
    RAISE WARNING '  PASS  T8: balance still % after replay (no double-credit)', v_post_balance;
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T8: balance % after replay (expected %, double-credit?)', v_post_balance, v_pre_balance + 100;
    v_fail := v_fail + 1;
  END IF;

  -- ── Summary ───────────────────────────────────────────────────────────────
  RAISE WARNING '────────────────────────────────────────────────────────────────────────';
  RAISE WARNING 'Stage 3 LIVE result: PASS=% FAIL=%', v_pass, v_fail;
  RAISE WARNING '  Victor John new_balance=% new_total_saved=% new_next_date=%',
    v_post_balance, v_post_total, v_post_next;
  RAISE WARNING '  (₦100 real pending contribution confirmed; reversal NOT done — stays in ledger)';

END;
$$;
