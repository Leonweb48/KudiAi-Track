-- Stage 3: Live test suite for ajo_confirm_payment idempotency + webhook dedup
-- Tests T1-T8 run against a dedicated Stage 3 test client (created + cleaned up here).
-- Uses RAISE WARNING so the migration commits even if tests fail — never rolls back.

DO $$
DECLARE
  v_owner_id      UUID    := 'fc5df36d-70d7-4aff-bb54-2bdb832a5e6d';
  v_client_id     UUID;
  v_contrib_id    UUID;
  v_test_ref      TEXT    := 'STAGE3_TEST_' || gen_random_uuid()::TEXT;
  v_pre_balance   NUMERIC;
  v_pre_total     NUMERIC;
  v_pre_next_date DATE;
  v_result        JSONB;
  v_result2       JSONB;
  v_post_balance  NUMERIC;
  v_post_total    NUMERIC;
  v_post_next     DATE;
  v_post_status   TEXT;
  v_dup_count     INT;
  v_pass          INT := 0;
  v_fail          INT := 0;
BEGIN

  -- ── Setup ──────────────────────────────────────────────────────────────────
  INSERT INTO aso_clients (
    user_id, full_name, phone, address, status,
    current_balance, total_saved, contribution_amount, contribution_frequency,
    next_contribution_date, registration_charge, withdrawal_fee_percent
  ) VALUES (
    v_owner_id, 'Stage3 Test Client', '08000000099', 'Test Addr', 'active',
    5000, 5000, 200, 'daily',
    CURRENT_DATE + 1, 0, 0
  ) RETURNING id INTO v_client_id;

  SELECT current_balance, total_saved, next_contribution_date
    INTO v_pre_balance, v_pre_total, v_pre_next_date
    FROM aso_clients WHERE id = v_client_id;

  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, type, amount, status,
    paystack_ref, paystack_status, notes
  ) VALUES (
    v_client_id, v_owner_id, 'contribution', 200, 'pending',
    v_test_ref, 'pending', 'Stage3 test contribution'
  ) RETURNING id INTO v_contrib_id;

  RAISE WARNING '── Stage 3: ajo_confirm_payment tests ──────────────────────────────────';
  RAISE WARNING '  client_id: %  ref: %  pre_balance: %', v_client_id, v_test_ref, v_pre_balance;

  -- ── T1: First call returns ok=true ────────────────────────────────────────
  SELECT rpc INTO v_result
    FROM ajo_confirm_payment(v_test_ref, NOW(), 'card') AS rpc;

  IF (v_result->>'ok')::boolean THEN
    RAISE WARNING '  PASS  T1: first call returns ok=true';
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T1: expected ok=true, got: %', v_result;
    v_fail := v_fail + 1;
  END IF;

  -- Read updated client state once
  SELECT current_balance, total_saved, next_contribution_date
    INTO v_post_balance, v_post_total, v_post_next
    FROM aso_clients WHERE id = v_client_id;

  SELECT status INTO v_post_status FROM ajo_contributions WHERE id = v_contrib_id;

  -- ── T2: Balance increased by exact amount ──────────────────────────────────
  IF v_post_balance = v_pre_balance + 200 THEN
    RAISE WARNING '  PASS  T2: balance = % (pre=% +200)', v_post_balance, v_pre_balance;
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T2: balance % ≠ expected %', v_post_balance, v_pre_balance + 200;
    v_fail := v_fail + 1;
  END IF;

  -- ── T3: total_saved increased by exact amount ──────────────────────────────
  IF v_post_total = v_pre_total + 200 THEN
    RAISE WARNING '  PASS  T3: total_saved = % (pre=% +200)', v_post_total, v_pre_total;
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T3: total_saved % ≠ expected %', v_post_total, v_pre_total + 200;
    v_fail := v_fail + 1;
  END IF;

  -- ── T4: next_contribution_date advanced by 1 day (daily frequency) ────────
  IF v_post_next = v_pre_next_date + 1 THEN
    RAISE WARNING '  PASS  T4: next_date advanced 1 day: % → %', v_pre_next_date, v_post_next;
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T4: next_date % ≠ expected %', v_post_next, v_pre_next_date + 1;
    v_fail := v_fail + 1;
  END IF;

  -- ── T5: Contribution status flipped to completed ───────────────────────────
  IF v_post_status = 'completed' THEN
    RAISE WARNING '  PASS  T5: contribution status = completed';
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T5: status = % (expected completed)', v_post_status;
    v_fail := v_fail + 1;
  END IF;

  -- ── T6: Replay (same reference) returns ok=false ──────────────────────────
  SELECT rpc INTO v_result2
    FROM ajo_confirm_payment(v_test_ref, NOW(), 'card') AS rpc;

  IF NOT (v_result2->>'ok')::boolean THEN
    RAISE WARNING '  PASS  T6: replay returns ok=false — idempotent, no double-credit';
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T6: replay returned ok=true — DOUBLE-CREDIT! result: %', v_result2;
    v_fail := v_fail + 1;
  END IF;

  -- ── T7: Balance unchanged after replay ────────────────────────────────────
  SELECT current_balance INTO v_post_balance FROM aso_clients WHERE id = v_client_id;

  IF v_post_balance = v_pre_balance + 200 THEN
    RAISE WARNING '  PASS  T7: balance unchanged after replay: %', v_post_balance;
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T7: balance after replay = % (expected %, double-credit?)', v_post_balance, v_pre_balance + 200;
    v_fail := v_fail + 1;
  END IF;

  -- ── T8: paystack_webhook_log UNIQUE constraint swallows duplicate ──────────
  INSERT INTO paystack_webhook_log (event, reference, payload)
    VALUES ('charge.success', v_test_ref, '{"test":true}'::jsonb);

  INSERT INTO paystack_webhook_log (event, reference, payload)
    VALUES ('charge.success', v_test_ref, '{"test":true,"replay":true}'::jsonb)
    ON CONFLICT (reference) DO NOTHING;

  SELECT COUNT(*)::INT INTO v_dup_count
    FROM paystack_webhook_log WHERE reference = v_test_ref;

  IF v_dup_count = 1 THEN
    RAISE WARNING '  PASS  T8: webhook_log UNIQUE keeps exactly 1 row for replayed reference';
    v_pass := v_pass + 1;
  ELSE
    RAISE WARNING '  FAIL  T8: webhook_log has % rows for same reference (expected 1)', v_dup_count;
    v_fail := v_fail + 1;
  END IF;

  -- ── Summary ───────────────────────────────────────────────────────────────
  RAISE WARNING '────────────────────────────────────────────────────────────────────────';
  RAISE WARNING 'Stage 3 result: PASS=% FAIL=%', v_pass, v_fail;

  -- ── Cleanup ───────────────────────────────────────────────────────────────
  DELETE FROM paystack_webhook_log WHERE reference = v_test_ref;
  DELETE FROM ajo_contributions WHERE aso_client_id = v_client_id;
  DELETE FROM aso_clients WHERE id = v_client_id;
  RAISE WARNING '  cleanup done';

END;
$$;
